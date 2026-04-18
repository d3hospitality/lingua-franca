// ═══════════════════════════════════════════════════════════════════
// Lingua Franca — G2 BLE Direct Bridge
// Integration notes for g2-kit-unofficial
// https://github.com/Commute773/g2-kit-unofficial
//
// This module provides a pathway for direct BLE communication with
// Even Realities G2 glasses, bypassing the EvenHub SDK relay.
// Useful for low-fps text/sprite updates where native SDK containers
// are insufficient (e.g., animated phrase cards, reactive vocab).
//
// STATUS: Experimental — reference implementation for future use
// ═══════════════════════════════════════════════════════════════════

/*
┌─────────────────────────────────────────────────────────────────┐
│  G2 BLE DIRECT PROTOCOL SUMMARY                                 │
│  From: g2-kit-unofficial by Commute773                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  SERVICE UUID:   6E400001-B5A3-F393-E0A9-E50E24DCCA9E           │
│  TX CHAR:        ...0002... (phone → glasses)                   │
│  RX CHAR:        ...0003... (glasses → phone)                   │
│  CMD CHAR:       0000E0XX... (command envelope)                 │
│                                                                  │
│  ENVELOPE FORMAT:                                                │
│    aa 21 [protobuf payload] [CRC-16/CCITT-FALSE]                │
│                                                                  │
│  IMAGE TILING:                                                   │
│    - Max tile: 288 × 144 pixels                                 │
│    - 4-bit grayscale palette (16 shades)                        │
│    - Sliding window pipeline for multi-tile images              │
│    - Full lens (576×288): ~5 fps                                │
│    - Small HUD tile (144×72): ~20 fps                           │
│                                                                  │
│  TEXT RENDERING:                                                 │
│    - Render text to canvas → encode as 4-bit tile               │
│    - Push tile via BLE write to TX characteristic                │
│    - Protobuf message type for display update                   │
│                                                                  │
│  DISPLAY SPECS:                                                  │
│    - 576 × 288 pixels per lens                                  │
│    - 4-bit greyscale (16 levels)                                │
│    - Green micro-LED                                            │
│    - No backlight — relies on ambient transparency              │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
*/

// ── Type definitions for future BLE integration ──

export interface BleConfig {
  /** Whether to use BLE direct mode instead of EvenHub SDK */
  enabled: boolean;
  /** Target device name filter for scanning */
  deviceNameFilter: string;
  /** Max tile width for image updates */
  tileWidth: number;
  /** Max tile height for image updates */
  tileHeight: number;
  /** Target FPS for updates */
  targetFps: number;
}

export const DEFAULT_BLE_CONFIG: BleConfig = {
  enabled: false,
  deviceNameFilter: "Even G2",
  tileWidth: 288,
  tileHeight: 144,
  targetFps: 10,
};

/**
 * 4-bit grayscale palette encoder
 * Converts 8-bit grayscale to 4-bit (16 levels)
 * Two pixels packed per byte (high nibble = left, low nibble = right)
 */
export function encode4BitGrayscale(width: number, height: number, data8bit: Uint8Array): Uint8Array {
  const packedLen = Math.ceil((width * height) / 2);
  const packed = new Uint8Array(packedLen);

  for (let i = 0; i < width * height; i += 2) {
    const hi = (data8bit[i] >> 4) & 0x0f;
    const lo = i + 1 < data8bit.length ? (data8bit[i + 1] >> 4) & 0x0f : 0;
    packed[i >> 1] = (hi << 4) | lo;
  }

  return packed;
}

/**
 * CRC-16/CCITT-FALSE used in g2-kit-unofficial protocol
 */
export function crc16ccitt(data: Uint8Array): number {
  let crc = 0xffff;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i] << 8;
    for (let j = 0; j < 8; j++) {
      if (crc & 0x8000) {
        crc = (crc << 1) ^ 0x1021;
      } else {
        crc = crc << 1;
      }
      crc &= 0xffff;
    }
  }
  return crc;
}

/**
 * Wrap payload in the aa 21 envelope with CRC
 */
export function wrapEnvelope(payload: Uint8Array): Uint8Array {
  const crc = crc16ccitt(payload);
  const envelope = new Uint8Array(2 + payload.length + 2);
  envelope[0] = 0xaa;
  envelope[1] = 0x21;
  envelope.set(payload, 2);
  envelope[2 + payload.length] = (crc >> 8) & 0xff;
  envelope[2 + payload.length + 1] = crc & 0xff;
  return envelope;
}

/*
═══════════════════════════════════════════════════════════════════
INTEGRATION ROADMAP

Phase 1 (Current):
  - EvenHub SDK handles all glasses communication
  - This file provides reference implementations for BLE primitives
  - 4-bit encoding + CRC + envelope wrapping ready for testing

Phase 2 (Future):
  - Web Bluetooth API scanning + connection
  - Direct tile push for animated phrase cards
  - Fallback to SDK when BLE not available
  - Canvas → 4-bit tile → BLE write pipeline

Phase 3 (Advanced):
  - Real-time vocab overlay (render text to tile, push at ~15fps)
  - Reactive sprites that animate on glasses
  - Bidirectional event handling via RX characteristic
  - Battery + IMU sensor data via BLE notifications

USAGE (when ready):
  1. navigator.bluetooth.requestDevice({ filters: [{ namePrefix: "Even" }] })
  2. Connect to GATT service 6E400001-...
  3. Get TX characteristic 6E400002-...
  4. Render text/image to canvas
  5. Convert to 4-bit grayscale tiles
  6. Wrap in protobuf + aa21 envelope
  7. Write to TX characteristic
  8. Listen on RX (6E400003-...) for events
═══════════════════════════════════════════════════════════════════
*/
