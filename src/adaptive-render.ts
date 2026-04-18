// ═══════════════════════════════════════════════════════════════════
// Lingua Franca — Adaptive Render Engine
// Intelligently selects between SDK methods based on what changed:
//
//   TEXT-ONLY change  → textContainerUpgrade()   (instant, no flicker)
//   LAYOUT change     → rebuildPageContainer()   (~5 fps, full rebuild)
//   PIXEL push        → Direct BLE tile write    (~20 fps small tiles)
//
// The engine tracks container state and diffs against incoming updates
// to pick the fastest path automatically.
// ═══════════════════════════════════════════════════════════════════

import {
  EvenAppBridge, RebuildPageContainer, TextContainerUpgrade,
} from '@evenrealities/even_hub_sdk';
import {
  encode4BitGrayscale, crc16ccitt, wrapEnvelope,
  type BleConfig, DEFAULT_BLE_CONFIG,
} from './ble-bridge';
import { log } from './ui';

// ── Render mode enum ──
export type RenderMode = 'text-upgrade' | 'rebuild' | 'ble-tile';

// ── Container state snapshot (tracks what's currently on the glasses) ──
interface TextState {
  containerID: number;
  containerName: string;
  content: string;
}

interface PageSnapshot {
  /** Text containers currently on the glasses (by containerID) */
  texts: Map<number, TextState>;
  /** Number of containers in current layout */
  containerCount: number;
  /** Whether BLE direct is connected */
  bleConnected: boolean;
  /** Timestamp of last full rebuild */
  lastRebuildMs: number;
  /** Timestamp of last text upgrade */
  lastTextUpgradeMs: number;
}

// ── Adaptive render stats (for debug log) ──
interface RenderStats {
  textUpgrades: number;
  rebuilds: number;
  bleTiles: number;
  avgTextLatencyMs: number;
  avgRebuildLatencyMs: number;
}

// ── Module state ──
let bridge: EvenAppBridge | null = null;
let bleDevice: BluetoothDevice | null = null;  // Web Bluetooth (when available)
let bleTxChar: BluetoothRemoteGATTCharacteristic | null = null;
let bleConfig: BleConfig = { ...DEFAULT_BLE_CONFIG };

const snapshot: PageSnapshot = {
  texts: new Map(),
  containerCount: 0,
  bleConnected: false,
  lastRebuildMs: 0,
  lastTextUpgradeMs: 0,
};

const stats: RenderStats = {
  textUpgrades: 0,
  rebuilds: 0,
  bleTiles: 0,
  avgTextLatencyMs: 0,
  avgRebuildLatencyMs: 0,
};

// Rate limiter: don't spam rebuilds faster than the glasses can handle
const MIN_REBUILD_INTERVAL_MS = 200;   // ~5 fps cap for rebuilds
const MIN_TEXT_INTERVAL_MS = 50;        // ~20 fps cap for text upgrades
let rebuildQueued = false;
let pendingRebuild: RebuildPageContainer | null = null;

// ═══════════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════════

/** Initialize the adaptive renderer with the SDK bridge */
export function initAdaptiveRender(sdkBridge: EvenAppBridge): void {
  bridge = sdkBridge;
  log("[Render] Adaptive engine ready");
}

/** Optionally connect BLE direct for tile pushes (Phase 2) */
export async function connectBLE(): Promise<boolean> {
  if (!navigator.bluetooth) {
    log("[Render] Web Bluetooth not available — SDK-only mode");
    return false;
  }

  try {
    bleDevice = await navigator.bluetooth.requestDevice({
      filters: [{ namePrefix: bleConfig.deviceNameFilter }],
      optionalServices: ['6e400001-b5a3-f393-e0a9-e50e24dcca9e'],
    });

    const server = await bleDevice.gatt!.connect();
    const service = await server.getPrimaryService('6e400001-b5a3-f393-e0a9-e50e24dcca9e');
    bleTxChar = await service.getCharacteristic('6e400002-b5a3-f393-e0a9-e50e24dcca9e');

    snapshot.bleConnected = true;
    log("[Render] BLE direct connected — tile mode available", "success");
    return true;
  } catch (err) {
    log(`[Render] BLE connect failed: ${err}`);
    snapshot.bleConnected = false;
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════
// DECISION ENGINE — picks the fastest render path
// ═══════════════════════════════════════════════════════════════════

/**
 * Decide render mode by diffing incoming page against snapshot.
 *
 * Rules:
 *   1. If layout changed (container count, IDs, positions) → REBUILD
 *   2. If only text content changed → TEXT-UPGRADE (fast path)
 *   3. If we need pixel-level updates and BLE is connected → BLE-TILE
 *   4. Fallback → REBUILD
 */
function decideMode(
  page: RebuildPageContainer | null,
  textUpdates: TextUpdate[] | null,
): RenderMode {
  // If we have explicit text-only updates, use the fast path
  if (textUpdates && textUpdates.length > 0 && !page) {
    // Verify all target containers exist in snapshot
    const allExist = textUpdates.every(u => snapshot.texts.has(u.containerID));
    if (allExist) return 'text-upgrade';
  }

  // If BLE is connected and we're pushing a small tile, use direct BLE
  if (snapshot.bleConnected && bleTxChar) {
    return 'ble-tile';
  }

  // Default: full rebuild
  return 'rebuild';
}

// ═══════════════════════════════════════════════════════════════════
// PUBLIC API — smart update methods
// ═══════════════════════════════════════════════════════════════════

export interface TextUpdate {
  containerID: number;
  containerName: string;
  content: string;
}

/**
 * Update text containers in-place (fastest path).
 * Falls back to rebuild if containers don't exist yet.
 */
export async function updateText(updates: TextUpdate[]): Promise<void> {
  if (!bridge) return;

  const mode = decideMode(null, updates);

  if (mode === 'text-upgrade') {
    // Rate limit
    const now = Date.now();
    if (now - snapshot.lastTextUpgradeMs < MIN_TEXT_INTERVAL_MS) {
      return; // skip this frame, next update will catch up
    }

    const t0 = performance.now();

    // Fire all text upgrades in parallel
    await Promise.all(updates.map(u =>
      bridge!.textContainerUpgrade(new TextContainerUpgrade({
        containerID: u.containerID,
        containerName: u.containerName,
        contentOffset: 0,
        contentLength: u.content.length,
        content: u.content.slice(0, 2000), // SDK max
      }))
    ));

    const latency = performance.now() - t0;
    snapshot.lastTextUpgradeMs = now;
    stats.textUpgrades++;
    stats.avgTextLatencyMs = (stats.avgTextLatencyMs * (stats.textUpgrades - 1) + latency) / stats.textUpgrades;

    // Update snapshot
    for (const u of updates) {
      snapshot.texts.set(u.containerID, {
        containerID: u.containerID,
        containerName: u.containerName,
        content: u.content,
      });
    }
  } else {
    // Containers don't exist yet — caller should do a full rebuild first
    log("[Render] Text upgrade skipped — containers not in snapshot, need rebuild first");
  }
}

/**
 * Full page rebuild (layout change).
 * Automatically snapshots the new container state.
 */
export async function rebuild(page: RebuildPageContainer): Promise<void> {
  if (!bridge) return;

  // Rate limit rebuilds
  const now = Date.now();
  if (now - snapshot.lastRebuildMs < MIN_REBUILD_INTERVAL_MS) {
    // Queue it — the latest rebuild wins
    pendingRebuild = page;
    if (!rebuildQueued) {
      rebuildQueued = true;
      const wait = MIN_REBUILD_INTERVAL_MS - (now - snapshot.lastRebuildMs);
      setTimeout(async () => {
        rebuildQueued = false;
        if (pendingRebuild) {
          await executeRebuild(pendingRebuild);
          pendingRebuild = null;
        }
      }, wait);
    }
    return;
  }

  await executeRebuild(page);
}

async function executeRebuild(page: RebuildPageContainer): Promise<void> {
  if (!bridge) return;
  const t0 = performance.now();

  await bridge.rebuildPageContainer(page);

  const latency = performance.now() - t0;
  snapshot.lastRebuildMs = Date.now();
  stats.rebuilds++;
  stats.avgRebuildLatencyMs = (stats.avgRebuildLatencyMs * (stats.rebuilds - 1) + latency) / stats.rebuilds;

  // Clear text snapshot — new layout means new container IDs
  snapshot.texts.clear();
}

/**
 * Smart update: provide the full page AND text-only diffs.
 * Engine decides whether to do a cheap text swap or full rebuild.
 *
 * Usage for Dialogue HUD:
 *   smartUpdate({
 *     page: buildDialogueHUDPage(opts),       // full layout (fallback)
 *     textUpdates: [                            // fast path
 *       { containerID: 43, containerName: "dlg-tts-text", content: newTranslation },
 *     ],
 *   })
 */
export async function smartUpdate(opts: {
  page: RebuildPageContainer;
  textUpdates?: TextUpdate[];
  forceRebuild?: boolean;
}): Promise<RenderMode> {
  if (!bridge) return 'rebuild';

  const { page, textUpdates, forceRebuild } = opts;

  // Force rebuild if requested (e.g., first render, layout change)
  if (forceRebuild || snapshot.texts.size === 0) {
    await rebuild(page);
    // Snapshot the text containers so future calls can use fast path
    if (textUpdates) {
      for (const u of textUpdates) {
        snapshot.texts.set(u.containerID, { ...u });
      }
    }
    return 'rebuild';
  }

  // Try text-only fast path
  if (textUpdates && textUpdates.length > 0) {
    // Check if any text actually changed
    const changed = textUpdates.filter(u => {
      const existing = snapshot.texts.get(u.containerID);
      return !existing || existing.content !== u.content;
    });

    if (changed.length > 0) {
      await updateText(changed);
      return 'text-upgrade';
    }

    // Nothing changed — skip entirely
    return 'text-upgrade';
  }

  // Fallback: full rebuild
  await rebuild(page);
  return 'rebuild';
}

/**
 * Push a raw 4-bit grayscale tile via BLE direct.
 * Only works when BLE is connected. Falls back to SDK image update.
 */
export async function pushTile(
  x: number, y: number,
  width: number, height: number,
  grayscaleData: Uint8Array,
): Promise<RenderMode> {
  if (snapshot.bleConnected && bleTxChar) {
    const packed = encode4BitGrayscale(width, height, grayscaleData);
    const envelope = wrapEnvelope(packed);

    // BLE write has MTU limits (~244 bytes) — may need chunking
    const MTU = 240;
    for (let offset = 0; offset < envelope.length; offset += MTU) {
      const chunk = envelope.slice(offset, offset + MTU);
      await bleTxChar.writeValueWithoutResponse(chunk);
    }

    stats.bleTiles++;
    return 'ble-tile';
  }

  // Fallback: use SDK image update (slower)
  log("[Render] BLE not connected — tile push skipped");
  return 'rebuild';
}

// ═══════════════════════════════════════════════════════════════════
// SNAPSHOT MANAGEMENT
// ═══════════════════════════════════════════════════════════════════

/** Register text containers after a rebuild so the engine knows about them */
export function snapshotTextContainers(containers: TextUpdate[]): void {
  for (const c of containers) {
    snapshot.texts.set(c.containerID, { ...c });
  }
}

/** Clear snapshot (call when navigating to a new page type) */
export function clearSnapshot(): void {
  snapshot.texts.clear();
  snapshot.containerCount = 0;
}

// ═══════════════════════════════════════════════════════════════════
// DEBUG / STATS
// ═══════════════════════════════════════════════════════════════════

export function getRenderStats(): RenderStats {
  return { ...stats };
}

export function getRenderMode(): string {
  if (snapshot.bleConnected) return 'hybrid (SDK + BLE)';
  if (snapshot.texts.size > 0) return 'fast (text-upgrade)';
  return 'standard (rebuild)';
}

export function logRenderStats(): void {
  log(
    `[Render] Mode: ${getRenderMode()} | ` +
    `Text: ${stats.textUpgrades} (${stats.avgTextLatencyMs.toFixed(1)}ms avg) | ` +
    `Rebuild: ${stats.rebuilds} (${stats.avgRebuildLatencyMs.toFixed(1)}ms avg) | ` +
    `BLE tiles: ${stats.bleTiles}`
  );
}
