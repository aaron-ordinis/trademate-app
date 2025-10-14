// lib/deposits.ts
import { supabase } from '@/lib/supabase';

export async function createDepositInvoiceFromJob(opts) {
  const { jobId, percent = 0.10, dueInDays = 7 } = opts;

  const { data, error } = await supabase.rpc('create_deposit_invoice_from_job', {
    p_job_id: jobId,
    p_percent: percent,
    p_due_in_days: dueInDays,
  });

  if (error) throw error;

  // data is a rows array from the RPC RETURN QUERY
  const row = Array.isArray(data) ? data[0] : data;
  return {
    invoiceId: row?.invoice_id,
    jobId: row?.job_id,
    quoteId: row?.quote_id,
    subtotal: row?.subtotal,
    total: row?.total,
  };
}