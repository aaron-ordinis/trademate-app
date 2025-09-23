// lib/files.js
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system";
import { supabase } from "./supabase";

const BUCKET = "jobdocs";
const TAG = "[FILES]";

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

function base64ToBytes(b64) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const lookup = new Uint8Array(256);
  for (let i = 0; i < alphabet.length; i++) lookup[alphabet.charCodeAt(i)] = i;

  const clean = String(b64 || "").replace(/[^A-Za-z0-9+/=]/g, "");
  const len = clean.length;
  const pads = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0;
  const outLen = ((len * 3) >> 2) - pads;

  const out = new Uint8Array(outLen);
  let p = 0, i = 0;
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

function stamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return (
    d.getFullYear() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    "_" +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds())
  );
}

/** Open system picker and return { uri, name, size, mimeType } or null */
export async function pickAnyFile() {
  console.log(TAG, "picker open");
  const res = await DocumentPicker.getDocumentAsync({
    multiple: false,
    copyToCacheDirectory: true,
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
 * Upload to Storage and create a row in documents.
 * Uses RLS namespace: jobdocs/users/<uid>/jobs/<jobId>/...
 */
export async function uploadJobFile({ userId, jobId, kind = "other", file }) {
  if (!userId) throw new Error("Missing userId");
  if (!jobId) throw new Error("Missing jobId");
  if (!file?.uri) throw new Error("Missing file");

  console.log(TAG, "upload start", { userId, jobId, kind });

  // 1) Read file → bytes
  const base64 = await FileSystem.readAsStringAsync(file.uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  if (!base64) throw new Error("Could not read file data");
  const bytes = base64ToBytes(base64);

  // 2) Build path + contentType (match RLS: users/<uid>/jobs/<jobId>/...)
  const safeName = String(file.name || "file").replace(/[^\w.\- ]+/g, "_").slice(0, 120);
  const contentType = file.mimeType || guessMime(safeName);
  const path =
    "users/" + userId + "/jobs/" + jobId + "/" + stamp() + "" + safeName;

  // 3) Upload
  const up = await supabase.storage.from(BUCKET).upload(path, bytes, {
    contentType,
    upsert: false,
  });
  if (up.error) {
    console.log(TAG, "upload error", up.error);
    throw up.error;
  }
  console.log(TAG, "upload ok", up.data?.path);

  // 4) Store the STORAGE PATH in DB (not a public URL)
  const ins = await supabase
    .from("documents")
    .insert({
      user_id: userId,            // your BEFORE INSERT trigger can also set this
      job_id: jobId,
      kind,
      name: safeName,
      url: path,                  // << store path, not public URL
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

/** List documents for a job (newest first). */
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

/**
 * Delete a document row.
 * DO NOT remove storage here—DB trigger enqueues old path and the Edge Function deletes it.
 */
export async function deleteJobDoc(row) {
  const { error } = await supabase.from("documents").delete().eq("id", row.id);
  if (error) throw error;
  return { ok: true };
}