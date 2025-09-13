// services/date-utils.js

/** Normalize to local midnight to avoid DST/time drift. */
export function toLocalMidnight(input) {
  const d = input instanceof Date ? input : new Date(input);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** 'YYYY-MM-DD' in local time. */
export function toYMD(input) {
  const d = toLocalMidnight(input);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Parse 'YYYY-MM-DD' (local). Returns Date or null. */
export function fromYMD(s) {
  if (!s || typeof s !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return new Date(y, mo - 1, d);
}

/** Calendar days inclusive (A..B). Returns >= 0. */
export function daysInclusive(a, b) {
  const A = toLocalMidnight(a);
  const B = toLocalMidnight(b);
  const diff = Math.floor((B - A) / 86400000);
  return diff >= 0 ? diff + 1 : 0;
}

/** Count Mon–Fri working days inclusive. */
export function countWeekdaysInclusive(a, b) {
  const A = toLocalMidnight(a);
  const B = toLocalMidnight(b);
  if (B < A) return 0;

  // Fast math without looping every day:
  // Count full weeks + remainder.
  const totalDays = daysInclusive(A, B);
  const fullWeeks = Math.floor(totalDays / 7);
  let workdays = fullWeeks * 5;

  // Handle remainder days
  const rem = totalDays % 7;
  const startDow = A.getDay(); // 0=Sun..6=Sat
  for (let i = 0; i < rem; i++) {
    const dow = (startDow + i) % 7;
    if (dow !== 0 && dow !== 6) workdays++;
  }
  return workdays;
}

/**
 * Add N working days to a start date and return the resulting end date.
 * Semantics: durationDays=1 => same-day job (start==end).
 * If includeWeekends=true, it becomes simple calendar math.
 */
export function addWorkingDays(start, durationDays, includeWeekends = false) {
  const startDay = toLocalMidnight(start);
  let days = Math.max(1, Math.floor(+durationDays || 0));
  if (includeWeekends) {
    // Calendar days inclusive
    const end = new Date(startDay);
    end.setDate(end.getDate() + (days - 1));
    return end;
  }
  // Mon–Fri only
  // We need to move forward until we've counted 'days' workdays including start.
  let count = 0;
  let cur = new Date(startDay);
  while (count < days) {
    const dow = cur.getDay();
    if (dow !== 0 && dow !== 6) count++;
    if (count === days) break;
    cur.setDate(cur.getDate() + 1);
  }
  return cur;
}

/** Inclusive range overlap check. */
export function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  const A1 = toLocalMidnight(aStart), A2 = toLocalMidnight(aEnd);
  const B1 = toLocalMidnight(bStart), B2 = toLocalMidnight(bEnd);
  return A1 <= B2 && B1 <= A2;
}

/** Clamp overlap window or return null if none. */
export function clampOverlap(aStart, aEnd, bStart, bEnd) {
  if (!rangesOverlap(aStart, aEnd, bStart, bEnd)) return null;
  const A1 = toLocalMidnight(aStart), A2 = toLocalMidnight(aEnd);
  const B1 = toLocalMidnight(bStart), B2 = toLocalMidnight(bEnd);
  const start = A1 > B1 ? A1 : B1;
  const end = A2 < B2 ? A2 : B2;
  return { start, end };
}

/** Count overlap days for a job within a period, respecting weekends toggle. */
export function overlapWorkingDays(jobStart, jobEnd, periodStart, periodEnd, includeWeekends = false) {
  const win = clampOverlap(jobStart, jobEnd, periodStart, periodEnd);
  if (!win) return 0;
  return includeWeekends
    ? daysInclusive(win.start, win.end)
    : countWeekdaysInclusive(win.start, win.end);
}