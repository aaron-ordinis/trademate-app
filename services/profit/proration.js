// services/profit/proration.js
import {
  daysInclusive,
  countWeekdaysInclusive,
  overlapWorkingDays,
  toLocalMidnight,
} from '../date-utils.js';

/**
 * Calculate a single job's prorated contribution for a period.
 * @param {object} job
 * @param {Date} periodStart
 * @param {Date} periodEnd
 * @returns {number}
 */
export function jobContributionForPeriod(job, periodStart, periodEnd) {
  const includeWeekends = !!job.include_weekends;

  // Cost precedence: expenses sum (if present) > manual cost > 0
  let cost = 0;
  const hasExpenseArray = Array.isArray(job.expenses);
  if (hasExpenseArray && job.expenses.length > 0) {
    cost = job.expenses.reduce((s, e) => s + Number(e.amount || 0), 0);
  } else if (Number.isFinite(Number(job.cost))) {
    cost = Number(job.cost) || 0;
  }

  const total = Number(job.total || 0);
  const profit = total - cost;

  // Denominator: effective job days
  const start = toLocalMidnight(job.start_date);
  const end = toLocalMidnight(job.end_date);
  const effDays = Math.max(
    1,
    includeWeekends ? daysInclusive(start, end) : countWeekdaysInclusive(start, end)
  );

  const daily = profit / effDays;

  // Numerator: overlap working days within period
  const overlapDays = overlapWorkingDays(start, end, periodStart, periodEnd, includeWeekends);

  return daily * overlapDays;
}

/**
 * Sum prorated profit across jobs for the given period.
 * Returns { amount, estimated } where estimated=true if any job contributed without expenses.
 */
export function profitForPeriod({ jobs, periodStart, periodEnd }) {
  const start = toLocalMidnight(periodStart);
  const end = toLocalMidnight(periodEnd);

  let total = 0;
  let estimated = false;

  for (const job of jobs || []) {
    // Skip non-overlapping quickly
    const js = toLocalMidnight(job.start_date);
    const je = toLocalMidnight(job.end_date);
    if (je < start || js > end) continue;

    // Detect estimate (no expenses AND (manual cost == null || 0))
    const hasExpenses = Array.isArray(job.expenses) && job.expenses.length > 0;
    if (!hasExpenses && !(Number.isFinite(Number(job.cost)) && Number(job.cost) > 0)) {
      estimated = true;
    }

    total += jobContributionForPeriod(job, start, end);
  }

  // Round once for display
  const amount = Math.round(total * 100) / 100;
  return { amount, estimated };
}