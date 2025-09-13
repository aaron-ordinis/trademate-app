import { supabase } from "./supabase";

export async function copyQuotePdfToJob({
  quoteId,
  jobId,
  bucket = "docs",
  quotePath = (qid) => `quotes/${qid}.pdf`,
  jobDocPath = (jid, qid) => `jobs/${jid}/documents/Quote-${qid}.pdf`,
}) {
  if (!quoteId || !jobId) return { ok: false, error: "Missing quoteId or jobId" };
  const from = typeof quotePath === "function" ? quotePath(quoteId) : quotePath;
  const to   = typeof jobDocPath === "function" ? jobDocPath(jobId, quoteId) : jobDocPath;
  const { error } = await supabase.storage.from(bucket).copy(from, to); // use .move to move
  if (error) return { ok: false, error };
  return { ok: true, path: to };
}

export async function registerJobDocument({
  jobId,
  path,
  name = "Quote.pdf",
  bucket = "docs",
}) {
  if (!jobId || !path) return { ok: false, error: "Missing jobId or path" };
  const { error } = await supabase.from("job_documents").insert({
    job_id: jobId, title: name, bucket, path, kind: "pdf",
  });
  if (error) return { ok: false, error };
  return { ok: true };
}