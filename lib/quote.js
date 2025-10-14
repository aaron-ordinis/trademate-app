// lib/quote.ts
/**
 * @typedef {Object} QuoteLine
 * @property {number} qty
 * @property {number} unit_price
 */

/**
 * @typedef {Object} QuoteLineItems
 * @property {QuoteLine[]=} materials
 * @property {QuoteLine[]=} labour
 */

/** Safe sum of qty * unit_price for an array */
const sumLines = (arr) =>
  (arr ?? []).reduce((acc, it) => acc + Number(it.qty || 0) * Number(it.unit_price || 0), 0);

/** Returns { materialsTotal, labourTotal } from quote.line_items JSON */
export function getQuoteBreakdown(line_items) {
  const materialsTotal = sumLines(line_items?.materials);
  const labourTotal = sumLines(line_items?.labour);
  return { materialsTotal, labourTotal };
}