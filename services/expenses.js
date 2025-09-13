// services/expenses.js
import { toYMD, toLocalMidnight } from './date-utils.js';

/**
 * Sum expenses for a job. Returns a number (0 if none).
 * RLS will scope to the current user automatically.
 */
export async function sumForJob({ supabase, jobId }) {
  const { data, error } = await supabase
    .from('job_expenses')
    .select('amount')
    .eq('job_id', jobId);
  if (error) throw error;
  return (data || []).reduce((s, r) => s + Number(r.amount || 0), 0);
}

/**
 * Add a single expense row.
 * @returns {Promise<{expense: any|null, error?: string}>}
 */
export async function addExpense({
  supabase,
  jobId,
  amount,
  date,
  category = 'misc',
  vendor = '',
  note = '',
  receiptPath = null,
  ocrText = null,
  ocrConfidence = null,
}) {
  try {
    const value = Number(amount);
    if (!Number.isFinite(value) || value < 0) {
      return { expense: null, error: 'Invalid amount' };
    }
    const row = {
      job_id: jobId,
      amount: Math.round(value * 100) / 100,
      date: toYMD(toLocalMidnight(date || new Date())),
      category,
      vendor: vendor || null,
      note: note || null,
      receipt_path: receiptPath || null,
      ocr_text: ocrText || null,
      ocr_confidence: ocrConfidence == null ? null : Number(ocrConfidence),
    };
    const { data, error } = await supabase
      .from('job_expenses')
      .insert(row)
      .select('*')
      .single();
    if (error) throw error;
    return { expense: data };
  } catch (e) {
    return { expense: null, error: e?.message || 'Failed to add expense' };
  }
}

/** List expenses for a job (for detail UI). */
export async function listForJob({ supabase, jobId }) {
  const { data, error } = await supabase
    .from('job_expenses')
    .select('*')
    .eq('job_id', jobId)
    .order('date', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}