// ═══════════════════════════════════════════════════════════════════
// Lingua Franca — Real-world fluency, one scene at a time
// EvenHub SDK web app for Even Realities G2 smart glasses
// ═══════════════════════════════════════════════════════════════════

import { waitForEvenAppBridge, DeviceConnectType } from '@evenrealities/even_hub_sdk';
import { buildHomePage } from './pages';
import { pushHomeSprite } from './image-utils';
import { registerEventHandlers } from './events';
import { initSync } from './sync';
import { setStatus, setBattery, log } from './ui';
import { TOTAL_LANGUAGES, TOTAL_SCENARIOS } from './constants';
import { initDashboard, refreshAll, setDeviceInfo, setVersionInfo, setGlassesStatus } from './dashboard';
import { setCustomPushFn } from './custom-phrase';

const VERSION = "1.0.0";

async function main(): Promise<void> {
  // Initialize dashboard tab switching immediately (phone UI)
  initDashboard();

  log("Initializing...");

  // Wait for EvenHub bridge — works for both real glasses and evenhub-simulator
  setStatus("connecting", "Waiting for bridge...");

  const bridge = await waitForEvenAppBridge();
  log("Bridge ready", "success");

  const user = await bridge.getUserInfo();
  log("User: " + user.name);

  const device = await bridge.getDeviceInfo();
  if (device) {
    log("Device: " + device.model + " (" + device.sn + ")");
    setDeviceInfo(device.model, device.sn);
    if (device.status?.isConnected()) {
      setStatus("connected");
      setBattery(device.status.batteryLevel);
      setGlassesStatus(true, device.status.batteryLevel);
    }
  } else {
    setStatus("disconnected", "No glasses");
    setGlassesStatus(false);
  }

  bridge.onDeviceStatusChanged((status) => {
    if (status.connectType === DeviceConnectType.Connected) {
      setStatus("connected");
      setBattery(status.batteryLevel);
      setGlassesStatus(true, status.batteryLevel);
      log("Connected — battery " + status.batteryLevel + "%", "success");
    } else if (status.connectType === DeviceConnectType.Disconnected) {
      setStatus("disconnected");
      setGlassesStatus(false);
      log("Disconnected", "error");
    } else if (status.connectType === DeviceConnectType.Connecting) {
      setStatus("connecting");
    }
  });

  // Create startup page — language list on glasses
  const homePage = buildHomePage();
  const result = await bridge.createStartUpPageContainer(homePage);
  if (result !== 0) {
    log("Startup failed: " + result, "error");
    return;
  }
  log("Home page created", "success");

  // Push home sprite
  const baseUrl = import.meta.env.BASE_URL;
  try {
    await new Promise(r => setTimeout(r, 500));
    await pushHomeSprite(bridge, baseUrl);
    log("Home sprite pushed", "success");
  } catch (err) {
    log("Home sprite not loaded: " + err, "error");
  }

  // Initialize sync bridge
  initSync(bridge);
  log("Sync bridge ready", "success");

  // Register glasses event handlers
  registerEventHandlers(bridge, baseUrl);
  log("Events active", "success");

  // Wire custom phrase builder → glasses push
  setCustomPushFn(async (page) => {
    await bridge.rebuildPageContainer(page);
  });

  await bridge.setLocalStorage("lf_version", VERSION);
  setVersionInfo(VERSION);
  log(`Lingua Franca v${VERSION} — ${TOTAL_LANGUAGES} languages · ${TOTAL_SCENARIOS} scenarios`, "success");

  // Refresh all dashboard tabs with persisted data
  await refreshAll();
  log("Dashboard loaded", "success");
}

main().catch((err) => {
  log("Fatal: " + err, "error");
  console.error(err);
});
