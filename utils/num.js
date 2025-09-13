// utils/num.js

/** True if finite number (not NaN, not +/-Infinity) */
export function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Round to 2dp safely. */
export function toMoney(n) {
  const x = Number(n || 0);
  return Math.round(x * 100) / 100;
}

/** Parse money text like "£1,234.56" or "1,234.56" -> 1234.56 */
export function parseMoney(text) {
  if (typeof text === 'number') return toMoney(text);
  if (!text) return 0;
  const clean = String(text).replace(/[£,\s]/g, '');
  const n = Number(clean);
  return Number.isFinite(n) ? toMoney(n) : 0;
}