// services/jobs.js
import { addWorkingDays, toLocalMidnight, toYMD } from "./date-utils.js";

/* =========================================================================
   Small logger helpers
   ========================================================================= */
const DBG  = (...a) => console.log("[jobs]", ...a);
const WARN = (...a) => console.warn("[jobs]", ...a);
const ERR  = (...a) => console.error("[jobs]", ...a);

/* =========================================================================
   Duration derivation from quote JSON meta
   ========================================================================= */
function deriveDurationDaysFromQuote(quote, fallback = 1, profileHoursPerDay = 10) {
  try {
    const raw = quote?.job_details;
    const blob = typeof raw === "string" ? JSON.parse(raw) : (raw || {});
    const meta = blob?.ai_meta || blob?.meta || {};

    // 1) explicit days
    const d1 = Number(meta?.days);
    if (Number.isFinite(d1) && d1 >= 1) return Math.ceil(d1);

    // 2) hours / hours_per_day
    const hours = Number(meta?.estimated_hours);
    const hpd = Number(meta?.hours_per_day || profileHoursPerDay);
    if (Number.isFinite(hours) && hours > 0 && Number.isFinite(hpd) && hpd > 0) {
      return Math.max(1, Math.ceil(hours / hpd));
    }

    // 3) day_rate_calc structure
    const drc = meta?.day_rate_calc;
    if (drc && Number.isFinite(drc?.days)) {
      const remainder = Number(drc?.remainder_hours || 0);
      return Math.max(1, Math.ceil(drc.days + (remainder > 0 ? 1 : 0)));
    }
  } catch (e) {
    WARN("deriveDurationDaysFromQuote parse issue:", e?.message || e);
  }
  return Math.max(1, Math.ceil(fallback || 1));
}

/* =========================================================================
   Quote PDF helpers (fallback insert)
   ========================================================================= */

/** Safely build a friendly filename for a quote PDF */
function makePdfName(quote) {
  const base =
    quote?.pdf_name ||
    quote?.job_summary ||
    (quote?.quote_number ? `Quote ${quote.quote_number}` : (quote?.id ? `Quote ${quote.id}` : "Quote"));
  return String(base).replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim() + ".pdf";
}

/**
 * Best-effort fallback: if the Edge Function fails to copy/upload,
 * insert a documents row pointing directly at the quote's pdf_url
 * so it still appears in Job → Documents.
 */
async function attachQuoteUrlDirectly({ supabase, job, quote }) {
  try {
    if (!quote?.pdf_url) return { ok: false, error: "No quote.pdf_url" };

    const { data: auth } = await supabase.auth.getUser();
    const userId = auth?.user?.id || quote?.user_id || null;

    const { error } = await supabase
      .from("documents")
      .insert({
        user_id: userId,
        job_id: job.id,
        quote_id: quote.id,
        kind: "quote",
        name: makePdfName(quote),
        url: quote.pdf_url,
        mime: quote.pdf_mime || "application/pdf",
        size: null,
      })
      .select("id")
      .single();

    if (error) throw error;
    return { ok: true };
  } catch (e) {
    WARN("attachQuoteUrlDirectly failed:", e?.message || e);
    return { ok: false, error: e?.message || "insert failed" };
  }
}

/* =========================================================================
   EXPENSE EXTRACTION from quote JSON + bulk insert
   ========================================================================= */

function toNum(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function normalizeExpenseItem(raw = {}) {
  const name =
    raw.name || raw.title || raw.description || raw.item || raw.product || "Expense";

  const qty = toNum(raw.quantity ?? raw.qty ?? raw.hours ?? 1, 1);
  const unit = toNum(raw.unit_cost ?? raw.unitCost ?? raw.cost ?? raw.rate ?? raw.price ?? 0, 0);
  const totalRaw = raw.total ?? raw.line_total ?? raw.subtotal ?? (qty * unit);
  const total = toNum(totalRaw, qty * unit);

  const category =
    raw.category || raw.type || raw.kind || (raw.is_material ? "materials" : null) || null;

  const tax_rate = (() => {
    const t = raw.tax_rate ?? raw.vat ?? raw.tax;
    if (t == null || t === "") return null;
    const s = String(t).trim();
    if (s.endsWith("%")) return toNum(s.slice(0, -1), null);
    const num = toNum(s, null);
    if (num == null) return null;
    return num <= 1 ? +(num * 100).toFixed(2) : +num.toFixed(2);
  })();

  return { name: String(name), quantity: +qty, unit_cost: +unit, total: +total, category, tax_rate };
}

function extractExpensesFromQuote(quote) {
  const out = [];
  try {
    const raw = typeof quote?.job_details === "string"
      ? JSON.parse(quote.job_details)
      : (quote?.job_details || {});
    const ai = raw.ai_meta || raw.meta || {};

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
        const hasCost =
          toNum(itm.total ?? itm.line_total ?? itm.subtotal ?? itm.cost ?? itm.unit_cost ?? itm.rate ?? 0, 0) > 0;
        const typed =
          /expense|material|purchase|subcontract/i.test(String(itm.type || itm.kind || itm.category || ""));
        if (hasCost || typed) out.push(normalizeExpenseItem(itm));
      }
    }

    if (!out.length && ai.day_rate_calc && ai.day_rate_calc.materials) {
      const m = ai.day_rate_calc.materials;
      if (Array.isArray(m)) for (const itm of m) out.push(normalizeExpenseItem(itm));
    }
  } catch {
    // ignore parse errors
  }
  return out;
}

async function insertExpensesForJob({ supabase, userId, jobId, quoteId = null, rows }) {
  if (!rows?.length) return { ok: true, inserted: 0 };
  const payload = rows.map((r) => ({
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

/* =========================================================================
   Public API
   ========================================================================= */

/**
 * Create a job from a non-draft quote and link them.
 * - Computes dates
 * - Inserts job (with source_quote_id)
 * - Links quote -> job (status: accepted)
 * - Triggers the Edge Function copy-quote-pdf (server-side copy + documents insert)
 *   • Falls back to inserting the quote.pdf_url directly if the function fails
 * - Extracts expenses/materials from quote JSON and inserts into expenses
 */
export async function createFromQuote({
  supabase,
  quoteId,
  startDate,
  includeWeekends = false,
  overrideDays = null,
  profileHoursPerDay = 10,
}) {
  try {
    // 1) Load quote
    const { data: quoteRow, error: qErr } = await supabase
      .from("quotes")
      .select("*")
      .eq("id", quoteId)
      .maybeSingle();
    if (qErr) throw new Error(`FETCH_QUOTE: ${qErr.message}`);
    if (!quoteRow) throw new Error("Quote not found");

    if (String(quoteRow.status || "").toLowerCase() === "draft") {
      throw new Error("Draft quotes cannot create jobs. Generate the quote first.");
    }

    // Already linked? Return the existing job.
    if (quoteRow.job_id) {
      const { data: already, error: jErr } = await supabase
        .from("jobs")
        .select("*")
        .eq("id", quoteRow.job_id)
        .maybeSingle();
      if (jErr) throw new Error(`FETCH_LINKED_JOB: ${jErr.message}`);
      return { job: already, quote: quoteRow };
    }

    // 2) Schedule
    const days = Math.max(
      1,
      Math.ceil(
        overrideDays ?? deriveDurationDaysFromQuote(quoteRow, 1, profileHoursPerDay)
      )
    );
    const endDate = addWorkingDays(startDate, days, includeWeekends);

    // 3) Insert job (sets source_quote_id)
    const title =
      quoteRow.job_summary
        ? String(quoteRow.job_summary)
        : (quoteRow.client_name ? `${quoteRow.client_name} – Job` : "Job");

    const jobRowData = {
      title,
      user_id: quoteRow.user_id,
      client_name: quoteRow.client_name || null,
      client_address: quoteRow.client_address || null,
      site_address: quoteRow.site_address || null,
      status: "scheduled",
      start_date: toYMD(toLocalMidnight(startDate)),
      duration_days: days,
      end_date: toYMD(endDate),
      include_weekends: !!includeWeekends,
      source_quote_id: quoteRow.id, // important
    };

    const { data: inserted, error: insErr } = await supabase
      .from("jobs")
      .insert(jobRowData)
      .select("*")
      .single();
    if (insErr) throw new Error(`INSERT_JOB: ${insErr.message}`);

    // 4) Link quote -> job & mark accepted
    const { error: upErr } = await supabase
      .from("quotes")
      .update({ status: "accepted", job_id: inserted.id })
      .eq("id", quoteRow.id);
    if (upErr) {
      try { await supabase.from("jobs").delete().eq("id", inserted.id); } catch {}
      throw new Error(`LINK_QUOTE: ${upErr.message}`);
    }

    // 5) Call Edge Function: copy-quote-pdf
    let attachError = null;
    try {
      DBG("Invoking copy-quote-pdf", { jobId: inserted.id, quoteId: quoteRow.id });

      // ensure we actually have a session token going out (for RLS checks inside function)
      const { data: sess } = await supabase.auth.getSession();
      DBG("has session token?", !!sess?.session?.access_token);

      const { data: fnData, error: fnErr } = await supabase.functions.invoke(
        "copy-quote-pdf",
        { body: { jobId: inserted.id, quoteId: quoteRow.id } }
      );

      if (fnErr) {
        WARN("copy-quote-pdf error:", fnErr);
        attachError = "Job created, but attaching (copying) the quote PDF failed.";
        await attachQuoteUrlDirectly({ supabase, job: inserted, quote: quoteRow });
      } else {
        DBG("copy-quote-pdf ok:", fnData);
      }
    } catch (e) {
      WARN("functions.invoke failed:", e?.message || e);
      attachError = "Job created, but attaching the quote PDF failed.";
      await attachQuoteUrlDirectly({ supabase, job: inserted, quote: quoteRow });
    }

    // 6) Auto-extract expenses from quote JSON and insert into expenses
    try {
      const { data: auth } = await supabase.auth.getUser();
      const userId = auth?.user?.id || quoteRow.user_id;

      const rows = extractExpensesFromQuote(quoteRow);
      if (rows.length) {
        const ins = await insertExpensesForJob({
          supabase,
          userId,
          jobId: inserted.id,
          quoteId: quoteRow.id,
          rows,
        });
        if (!ins.ok) {
          WARN("[jobs] expenses insert failed:", ins.error);
        } else {
          DBG("[jobs] expenses inserted:", ins.inserted);
        }
      } else {
        DBG("[jobs] no expenses detected on quote");
      }
    } catch (e) {
      WARN("[jobs] expense extraction error:", e?.message || e);
    }

    // All good (with possible attachError note)
    const result = {
      job: inserted,
      quote: { ...quoteRow, status: "accepted", job_id: inserted.id },
    };
    if (attachError) result.error = attachError;
    return result;

  } catch (e) {
    ERR("createFromQuote fatal:", e?.message || e);
    return { job: null, quote: null, error: e?.message || "Failed to create job" };
  }
}

/** Reschedule a job (recomputes end_date with weekend rules). */
export async function reschedule({ supabase, jobId, startDate, durationDays, includeWeekends }) {
  DBG("reschedule", { jobId, startDate, durationDays, includeWeekends });
  try {
    const days = Math.max(1, Math.floor(durationDays || 1));
    const endDate = addWorkingDays(startDate, days, !!includeWeekends);

    const patch = {
      start_date: toYMD(toLocalMidnight(startDate)),
      duration_days: days,
      end_date: toYMD(endDate),
      include_weekends: !!includeWeekends,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from("jobs")
      .update(patch)
      .eq("id", jobId)
      .select("*")
      .single();
    if (error) {
      ERR("reschedule update failed:", error.message || error);
      return { job: null, error: error.message || "Failed to reschedule job" };
    }
    return { job: data };
  } catch (e) {
    ERR("reschedule fatal:", e?.message || e);
    return { job: null, error: e?.message || "Failed to reschedule job" };
  }
}

/**
 * Delete a job and unlink any quotes. With your FK and RLS it will cascade
 * documents/expenses from the DB side; we also clear quotes.job_id.
 */
export async function deleteJob({ supabase, jobId }) {
  DBG("deleteJob", { jobId });
  try {
    await supabase.from("quotes").update({ job_id: null }).eq("job_id", jobId);
    const { error } = await supabase.from("jobs").delete().eq("id", jobId);
    if (error) {
      ERR("delete job failed:", error.message || error);
      return { ok: false, error: error.message || "Failed to delete job" };
    }
    return { ok: true };
  } catch (e) {
    ERR("deleteJob fatal:", e?.message || e);
    return { ok: false, error: e?.message || "Failed to delete job" };
  }
}