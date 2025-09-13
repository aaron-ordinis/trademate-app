// lib/files.js
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system";
import { supabase } from "./supabase";

/* ===============================================
   Minimal, reliable file helpers for job docs
   =============================================== */

const BUCKET = "jobdocs";
const TAG = "[FILES]";

/* Common MIME map (fallback safe) */
const EXT_MIME = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
  gif: "image/gif",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv",
  txt: "text/plain",
};
const guessMime = (name, fallback = "application/octet-stream") => {
  try {
    const ext = String(name || "").split(".").pop().toLowerCase();
    return EXT_MIME[ext] || fallback;
  } catch {
    return fallback;
  }
};

/* Convert Base64 -> Uint8Array (fast, no atob needed) */
function base64ToBytes(b64) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const lookup = new Uint8Array(256);
  for (let i = 0; i < alphabet.length; i++) lookup[alphabet.charCodeAt(i)] = i;

  const clean = String(b64 || "").replace(/[^A-Za-z0-9+/=]/g, "");
  const len = clean.length;
  const pads = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0;
  const outLen = ((len * 3) >> 2) - pads;

  const out = new Uint8Array(outLen);
  let p = 0,
    i = 0;
  while (i < len) {
    const a = lookup[clean.charCodeAt(i++)] | 0;
    const b = lookup[clean.charCodeAt(i++)] | 0;
    const c = lookup[clean.charCodeAt(i++)] | 0;
    const d = lookup[clean.charCodeAt(i++)] | 0;
    const trip = (a << 18) | (b << 12) | (c << 6) | d;
    if (p < outLen) out[p++] = (trip >> 16) & 0xff;
    if (p < outLen) out[p++] = (trip >> 8) & 0xff;
    if (p < outLen) out[p++] = trip & 0xff;
  }
  return out;
}

/* Build a nice timestamped path */
function stamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/* Extract storage key from a public URL (best effort) */
function keyFromPublicUrl(url, bucket = BUCKET) {
  try {
    const u = new URL(url);
    const marker = `/storage/v1/object/public/${bucket}/`;
    const i = u.pathname.indexOf(marker);
    if (i === -1) return null;
    return decodeURIComponent(u.pathname.substring(i + marker.length));
  } catch {
    return null;
  }
}

/* -------------------------------------------------
   Public API
   ------------------------------------------------- */

/** Open a system file picker and return a { uri, name, size, mimeType } or null */
export async function pickAnyFile() {
  console.log(TAG, "picker open");
  const res = await DocumentPicker.getDocumentAsync({
    multiple: false,
    copyToCacheDirectory: true,
    // Android needs / as the final catch-all to avoid "No Activity found" on some devices
    type: [
      "image/*",
      "application/pdf",
      "application/msword",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "/",
    ],
  });
  if (res.canceled || !res.assets?.[0]) {
    console.log(TAG, "picker canceled");
    return null;
  }
  const a = res.assets[0];
  const file = {
    uri: a.uri,
    name: a.name || a.file?.name || "upload",
    size: a.size ?? null,
    mimeType: a.mimeType || a.mime || null,
  };
  console.log(TAG, "picked", file);
  return file;
}

/**
 * Upload a file to Storage and create a row in documents.
 * @param {Object} params
 * @param {string} params.userId  - current auth user id
 * @param {string} params.jobId   - job id
 * @param {string} [params.kind]  - "other" | "photo" | "receipt" | "quote" ...
 * @param {Object} params.file    - { uri, name, size, mimeType }
 * @returns inserted documents row
 */
export async function uploadJobFile({ userId, jobId, kind = "other", file }) {
  if (!userId) throw new Error("Missing userId");
  if (!jobId) throw new Error("Missing jobId");
  if (!file?.uri) throw new Error("Missing file");

  console.log(TAG, "upload start", { userId, jobId, kind });

  // 1) Read file into Uint8Array (Expo FileSystem -> base64 -> bytes)
  const base64 = await FileSystem.readAsStringAsync(file.uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  if (!base64) throw new Error("Could not read file data");
  const bytes = base64ToBytes(base64);

  // 2) Build path + contentType
  const safeName = String(file.name || "file").replace(/[^\w.\- ]+/g, "_").slice(0, 120);
  const contentType = file.mimeType || guessMime(safeName);
  const path = `u_${userId}/job_${jobId}/${stamp()}__${safeName}`;

  // 3) Upload to Storage as Uint8Array (works reliably in Expo)
  const up = await supabase.storage.from(BUCKET).upload(path, bytes, {
    contentType,
    upsert: false,
  });
  if (up.error) {
    console.log(TAG, "upload error", up.error);
    throw up.error;
  }
  console.log(TAG, "upload ok", up.data?.path);

  // 4) Public URL for display
  const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
  const publicUrl = pub?.publicUrl || null;

  // 5) Insert DB row (RLS requires user_id = auth.uid())
  const ins = await supabase
    .from("documents")
    .insert({
      user_id: userId,
      job_id: jobId,
      kind,
      name: safeName,
      url: publicUrl,
      mime: contentType,
      size: file.size ?? null,
    })
    .select("*")
    .single();

  if (ins.error) {
    // tidy up storage on failure
    try {
      await supabase.storage.from(BUCKET).remove([path]);
    } catch {}
    throw ins.error;
  }

  console.log(TAG, "inserted doc id", ins.data?.id);
  return ins.data;
}

/** List documents for a job (sorted newest first). */
export async function listJobDocs(jobId) {
  const { data, error } = await supabase
    .from("documents")
    .select("id, user_id, job_id, kind, name, url, mime, size, created_at")
    .eq("job_id", String(jobId))
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

/** Delete a document row and best-effort remove the storage object. */
export async function deleteJobDoc(row) {
  // remove storage object if URL looks like our bucket
  const key = keyFromPublicUrl(row?.url, BUCKET);
  if (key) {
    try {
      await supabase.storage.from(BUCKET).remove([key]);
    } catch (e) {
      console.log(TAG, "storage remove warning", e?.message || e);
    }
  }
  const { error } = await supabase.from("documents").delete().eq("id", row.id);
  if (error) throw error;
  return { ok: true };
}