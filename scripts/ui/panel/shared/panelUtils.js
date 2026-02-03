/**
 * FX Bus - Panel Utilities
 *
 * Shared helpers for panel tabs.
 */

export function normaliseHex(value, fallback) {
  if (typeof value !== "string") return fallback;
  const s = value.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(s)) return s;
  if (/^[0-9a-f]{6}$/.test(s)) return `#${s}`;
  return fallback;
}

export function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function setDisabled(el, disabled) {
  if (!el) return;
  el.disabled = disabled;
  el.style.opacity = disabled ? "0.6" : "1";
}

export function selectedTokenIds() {
  const tokens = canvas?.tokens?.controlled ?? [];
  return tokens.map((t) => t.id).filter((id) => typeof id === "string" && id.length > 0);
}

export function syncColourPair(root, pickerName, textName, fallback) {
  const picker = root.querySelector(`input[name="${pickerName}"]`);
  const text = root.querySelector(`input[name="${textName}"]`);
  if (!picker || !text) return;

  const initial = normaliseHex(text.value, fallback);
  text.value = initial;
  picker.value = initial;

  picker.addEventListener("input", () => {
    text.value = picker.value;
  });

  text.addEventListener("input", () => {
    picker.value = normaliseHex(text.value, fallback);
  });
}
