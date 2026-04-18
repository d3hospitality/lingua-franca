// ═══════════════════════════════════════════════════════════════════
// Lingua Franca — UI Helpers
// Status dot, battery display, debug log
// ═══════════════════════════════════════════════════════════════════

const statusDot = () => document.getElementById("status-dot");
const statusText = () => document.getElementById("status-text");
const batteryText = () => document.getElementById("battery-text");
const logEl = () => document.getElementById("log");

export function setStatus(state: "connected" | "connecting" | "disconnected", label?: string) {
  const dot = statusDot(); const text = statusText();
  if (dot) dot.className = `dot ${state}`;
  if (text) text.textContent = label ?? state.charAt(0).toUpperCase() + state.slice(1);
}

export function setBattery(level?: number) {
  const el = batteryText();
  if (el && level !== undefined) el.textContent = `${level}%`;
}

export function log(message: string, type?: "success" | "error") {
  console.log(`[LF] ${message}`);
  const el = logEl();
  if (el) {
    const entry = document.createElement("div");
    entry.className = `entry${type ? ` ${type}` : ""}`;
    entry.textContent = `${new Date().toLocaleTimeString()} ${message}`;
    el.prepend(entry);
    while (el.children.length > 50) el.removeChild(el.lastChild!);
  }
}
