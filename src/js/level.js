// Pure level-input logic (no DOM). The slider, the typed box and the -/+ steppers all go through setLevel,
// so they share one rule: a level can never drop below what the spent points need (minLevel).
import { setLevel, minLevel } from './rules.js';

// Digits only. Returns an integer, or null for empty/invalid text.
export function parseLevelText(text) {
  const t = String(text ?? '').trim();
  return /^\d{1,4}$/.test(t) ? Number(t) : null;
}

export const clampLevel = (D, n) => Math.max(1, Math.min(D.rules.maxLevel, n));

// Apply typed text. Invalid or empty input reverts to the current (last valid) level.
export function commitLevel(D, state, text) {
  const n = parseLevelText(text);
  return n === null ? state : setLevel(D, state, clampLevel(D, n));
}

export const stepLevel = (D, state, delta) => setLevel(D, state, clampLevel(D, state.level + delta));

// Which steppers are usable. "min" is the lowest level this build can have.
export function canStep(D, state) {
  return { dec: state.level > minLevel(D, state), inc: state.level < D.rules.maxLevel };
}
