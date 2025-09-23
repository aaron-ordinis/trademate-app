// Robust shared PDF helpers for quotes/invoices previews.

import * as FileSystem from "expo-file-system";
import { supabase } from "./supabase";

/* small util */
const withBust = (url) =>
  url ? (url.includes("?") ? `${url}&cb=${Date.now()}` : `${url}?cb=${Date.now()}`) : url;

/**
 * Waits until a remote PDF is downloadable and non-empty.
 * resolveUrl: async () => string  (returns a direct http(s) url or "" if unknown)
 */
export async function waitForRemotePdf(
  resolveUrl,
  { maxWaitMs = 15000, pollMs = 900, minBytes = 800 } = {}
) {
  const deadline = Date.now() + maxWaitMs;
  let lastErr = "PDF not ready";

  while (Date.now() < deadline) {
    let url = "";
    try {
      url = await resolveUrl();
    } catch (e) {
      lastErr = e?.message || String(e);
      url = "";
    }

    if (url) {
      try {
        const probePath = `${FileSystem.cacheDirectory}_probe_${Date.now()}.pdf`;
        const { status, uri } = await FileSystem.downloadAsync(withBust(url), probePath);
        if (status === 200) {
          const info = await FileSystem.getInfoAsync(uri, { size: true });
          if (info.exists && (info.size || 0) >= minBytes) return { url, uri }; // ✅ success
          lastErr = `File too small (${info.size || 0}B)`;
        } else {
          lastErr = `HTTP ${status}`;
        }
      } catch (e) {
        lastErr = e?.message || String(e);
      }
    }

    // brief pause then try again
    await new Promise((r) => setTimeout(r, pollMs));
  }

  throw new Error(lastErr || "Timed out");
}

/**
 * Reads & validates a PDF file at a given local URI, returns Base64 string.
 */
export async function readPdfBase64FromUri(uri) {
  const b64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
  if (!b64 || b64.length < 100) throw new Error("PDF looks empty");
  // Validate header
  const head = global.atob
    ? global.atob(b64.slice(0, 20))
    : Buffer.from(b64.slice(0, 20), "base64").toString("binary");
  if (!String(head).startsWith("%PDF-")) throw new Error("Invalid PDF");
  return b64;
}

/**
 * URL resolver for INVOICES.
 * Tries DB (pdf_path→signed URL, then pdf_url) and finally the Edge Function.
 */
export const makeInvoiceUrlResolver = (invoiceId) => {
  return async () => {
    if (!invoiceId) return "";

    // 1) DB row
    const got = await supabase
      .from("invoices")
      .select("pdf_path, pdf_url, status")
      .eq("id", invoiceId)
      .maybeSingle();

    if (got.error) throw got.error;
    const row = got.data;

    if (!row) throw new Error("Invoice not found");
    // If status implies not generated, fail early (avoids endless wait)
    if (row.status === "draft" || row.status === "pending") {
      throw new Error("Invoice PDF is not ready yet");
    }

    // Prefer storage path (more reliable) → signed URL
    if (row.pdf_path) {
      const signed = await supabase.storage.from("secured").createSignedUrl(row.pdf_path, 3600);
      if (!signed.error && signed.data?.signedUrl) return signed.data.signedUrl;
    }

    // Fallback: direct URL persisted on the row
    if (row.pdf_url) return row.pdf_url;

    // 2) Edge function fallback
    try {
      const { data, error } = await supabase.functions.invoke("get_invoice_signed_url", {
        body: { invoice_id: invoiceId },
      });
      if (!error && data?.ok && data?.url) return data.url;
    } catch (_) {}

    // Nothing found this pass
    return "";
  };
};

/**
 * URL resolver for QUOTES (mirror of invoice resolver).
 */
export const makeQuoteUrlResolver = (quoteId) => {
  return async () => {
    if (!quoteId) return "";

    const got = await supabase
      .from("quotes")
      .select("pdf_path, pdf_url, status")
      .eq("id", quoteId)
      .maybeSingle();

    if (got.error) throw got.error;
    const row = got.data;
    if (!row) throw new Error("Quote not found");
    if (row.status === "draft" || row.status === "pending") {
      throw new Error("Quote PDF is not ready yet");
    }

    if (row.pdf_path) {
      const signed = await supabase.storage.from("secured").createSignedUrl(row.pdf_path, 3600);
      if (!signed.error && signed.data?.signedUrl) return signed.data.signedUrl;
    }
    if (row.pdf_url) return row.pdf_url;

    // Optional: edge function for quotes too, if you have one
    try {
      const { data, error } = await supabase.functions.invoke("get_quote_signed_url", {
        body: { quote_id: quoteId },
      });
      if (!error && data?.ok && data?.url) return data.url;
    } catch (_) {}

    return "";
  };
};