// lib/expenses.js
// Extracts expense-like rows from a quote blob and inserts them for a job.

function toNum(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function normItem(raw = {}) {
  // Accept many field names from different shapes
  const name =
    raw.name || raw.title || raw.description || raw.item || raw.product || "Expense";

  const qty =
    toNum(raw.quantity ?? raw.qty ?? raw.hours ?? 1, 1);

  const unit =
    toNum(raw.unit_cost ?? raw.unitCost ?? raw.cost ?? raw.rate ?? raw.price ?? 0, 0);

  const totalRaw =
    raw.total ?? raw.line_total ?? raw.subtotal ?? (qty * unit);

  const total = toNum(totalRaw, qty * unit);

  const category =
    raw.category || raw.type || raw.kind || (raw.is_material ? "materials" : null) || null;

  const tax_rate =
    // accept 0.2, 20, "20%"
    (() => {
      const t = raw.tax_rate ?? raw.vat ?? raw.tax;
      if (t == null || t === "") return null;
      const s = String(t).trim();
      if (s.endsWith("%")) return toNum(s.slice(0, -1), null);
      const num = toNum(s, null);
      if (num == null) return null;
      // if <= 1 assume ratio; if > 1 assume percent
      return num <= 1 ? +(num * 100).toFixed(2) : +num.toFixed(2);
    })();

  return { name: String(name), quantity: +qty, unit_cost: +unit, total: +total, category, tax_rate };
}

export function extractExpensesFromQuote(quote) {
  // We’ll scan several likely spots: job_details.ai_meta/materials/expenses/items, meta, lines, etc.
  const out = [];
  try {
    const raw = typeof quote?.job_details === "string"
      ? JSON.parse(quote.job_details)
      : (quote?.job_details || {});
    const ai = raw.ai_meta || raw.meta || {};
    const profile = raw.profile || {};

    // Common places
    const candidates = [
      raw.expenses,
      raw.materials,
      raw.purchases,
      raw.items,
      ai.expenses,
      ai.materials,
      ai.purchases,
      ai.items,
      raw.lines,
      ai.lines,
    ].filter(Boolean);

    for (const arr of candidates) {
      if (!Array.isArray(arr)) continue;
      for (const itm of arr) {
        // Heuristics: include only expense-like items (non-zero cost OR explicit expense/material)
        const hasCost =
          toNum(itm.total ?? itm.line_total ?? itm.subtotal ?? itm.cost ?? itm.unit_cost ?? itm.rate ?? 0, 0) > 0;

        const typed =
          /expense|material|purchase|subcontract/i.test(String(itm.type || itm.kind || itm.category || ""));

        if (hasCost || typed) out.push(normItem(itm));
      }
    }

    // Fallback: single material/expense object
    if (!out.length && ai.day_rate_calc && ai.day_rate_calc.materials) {
      const m = ai.day_rate_calc.materials;
      if (Array.isArray(m)) for (const itm of m) out.push(normItem(itm));
    }
  } catch {
    // ignore parse errors; return empty
  }
  return out;
}

/**
 * Inserts expense rows for a given job.
 * rows: [{ name, quantity, unit_cost, total, category, tax_rate }]
 */
export async function insertExpensesForJob({ supabase, userId, jobId, quoteId = null, rows }) {
  if (!rows?.length) return { ok: true, inserted: 0 };
  const payload = rows.map(r => ({
    user_id: userId,
    job_id: jobId,
    quote_id: quoteId ?? null,
    name: r.name,
    category: r.category ?? null,
    notes: null,
    quantity: toNum(r.quantity, 1),
    unit_cost: toNum(r.unit_cost, 0),
    total: toNum(r.total, toNum(r.quantity, 1) * toNum(r.unit_cost, 0)),
    tax_rate: r.tax_rate ?? null,
  }));

  const { error } = await supabase.from("expenses").insert(payload);
  if (error) return { ok: false, error: error.message };
  return { ok: true, inserted: payload.length };
}