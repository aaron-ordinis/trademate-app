// lib/assistant/useAssistant.js
import { useCallback, useMemo, useRef, useState } from "react";
import { supabase } from "../supabase";

/**
 * useAssistant
 * - Streams text from the assistant_chat Edge Function (SSE over fetch)
 * - Uniform message model: { role: "user" | "assistant", text: string }
 * - Extra helpers: createTicket(), clear(), abort()
 * - Very verbose logging tagged with [assistant.hook]
 * - Adds: robust SSE parser, timeout, small retry, lastError, onChunk callback
 */

const TAG = "[assistant.hook]";

function nowIso() {
  try { return new Date().toISOString(); } catch { return ""; }
}

async function getAuthHeader() {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data?.session?.access_token || "";
    if (!token) {
      console.log(TAG, "no access token");
      return null;
    }
    return "Bearer " + token;
  } catch (e) {
    console.log(TAG, "getSession error:", e?.message || e);
    return null;
  }
}

function getFunctionsBaseUrl() {
  const envUrl =
    process.env.EXPO_PUBLIC_SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    "";
  if (!envUrl) {
    console.log(TAG, "Missing EXPO_PUBLIC_SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL). Streaming will fail.");
  }
  return envUrl ? envUrl.replace(/\/+$/, "") + "/functions/v1" : "";
}

/** Extract a text delta from various OpenAI SSE shapes. */
function extractDelta(evt) {
  try {
    // Chat Completions delta
    const d1 = evt && evt.choices && evt.choices[0] && evt.choices[0].delta && evt.choices[0].delta.content;
    if (typeof d1 === "string" && d1.length) return d1;

    // Responses API style: message.content[].text
    const arr2 = evt && evt.message && Array.isArray(evt.message.content) ? evt.message.content : null;
    if (arr2) {
      const t2 = arr2.map((c) => (c && typeof c.text === "string" ? c.text : "")).join("");
      if (t2) return t2;
    }

    // Generic content[].text
    const arr3 = Array.isArray(evt && evt.content) ? evt.content : null;
    if (arr3) {
      const t3 = arr3.map((c) => (c && typeof c.text === "string" ? c.text : "")).join("");
      if (t3) return t3;
    }

    // Plain text
    if (evt && typeof evt.text === "string" && evt.text) return evt.text;

    return "";
  } catch {
    return "";
  }
}

/** Parse a full SSE transcript string (fallback path). */
function parseSSETextToString(s) {
  if (!s) return "";
  let out = "";
  const lines = s.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] || "";
    const line = raw.trim();
    if (!line || line.indexOf("data:") !== 0) continue;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") continue;
    try {
      const evt = JSON.parse(data);
      const delta = extractDelta(evt);
      if (delta) out += delta;
    } catch {
      // ignore malformed lines
    }
  }
  return out;
}

export default function useAssistant(opts = {}) {
  const screen = String(opts && opts.screen ? opts.screen : "unknown");
  const maxHistory = Number.isFinite(opts.maxHistory) ? Math.max(0, opts.maxHistory) : 8;
  const requestTimeoutMs = Number.isFinite(opts.requestTimeoutMs) ? Math.max(1000, opts.requestTimeoutMs) : 45_000;
  const maxRetries = Number.isFinite(opts.maxRetries) ? Math.max(0, opts.maxRetries) : 1;
  const onChunk = typeof opts.onChunk === "function" ? opts.onChunk : null;

  const [messages, setMessages] = useState([]);
  const [busy, setBusy] = useState(false);
  const [lastError, setLastError] = useState(null);
  const abortRef = useRef(null);

  /** ask(question): robust SSE with timeout, retry, and chunk callback */
  const ask = useCallback(
    async (question) => {
      const qStr = String(question || "");
      console.log(TAG, "ask.start", { screen: screen, questionPreview: qStr.slice(0, 80) });
      if (!qStr.trim()) {
        console.log(TAG, "ask.no_question");
        return false;
      }

      // optimistic UI
      setMessages((m) => m.concat([{ role: "user", text: qStr }]));
      setLastError(null);

      const baseUrl = getFunctionsBaseUrl();
      if (!baseUrl) {
        console.log(TAG, "ask.abort.missing_base_url");
        setMessages((m) => m.concat([{ role: "assistant", text: "Sorry, I couldn’t respond." }]));
        setLastError("Missing Supabase URL");
        return false;
      }

      const authHeader = await getAuthHeader();
      if (!authHeader) {
        console.log(TAG, "ask.abort.no_auth");
        setMessages((m) => m.concat([{ role: "assistant", text: "Please sign in first." }]));
        setLastError("No auth token");
        return false;
      }

      // Snapshot history at call time
      const history = messages.slice(-maxHistory).map((m) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: m.text,
      }));
      const payload = {
        screen: screen,
        messages: history.concat([{ role: "user", content: qStr }]),
      };

      const url = baseUrl + "/assistant_chat";
      const body = JSON.stringify(payload);

      console.log(TAG, "ask.fetch.init", { url: url, screen: screen, bodyBytes: body.length });

      setBusy(true);

      // Retry loop
      let attempt = 0;
      let overallOk = false;

      while (attempt <= maxRetries) {
        const ac = new AbortController();
        abortRef.current = ac;

        // timeout
        let toId = null;
        try {
          toId = setTimeout(() => {
            try {
              ac.abort();
              console.log(TAG, "ask.timeout.abort", { ms: requestTimeoutMs });
            } catch {}
          }, requestTimeoutMs);

          const resp = await fetch(url, {
            method: "POST",
            headers: {
              Authorization: authHeader,
              "Content-Type": "application/json",
              Accept: "text/event-stream",
            },
            body: body,
            signal: ac.signal,
          });

          console.log(TAG, "ask.fetch.head", {
            ok: resp.ok,
            status: resp.status,
            contentType: resp.headers && resp.headers.get ? resp.headers.get("Content-Type") : null,
            transferEncoding: resp.headers && resp.headers.get ? resp.headers.get("Transfer-Encoding") : null,
          });

          if (!resp.ok) {
            const errTxt = await resp.text().catch(function () { return ""; });
            console.log(TAG, "ask.fetch.http_error", { status: resp.status, preview: (errTxt || "").slice(0, 240) });
            setLastError("HTTP " + resp.status);
            if (resp.status >= 500 && attempt < maxRetries) {
              attempt += 1;
              const backoff = 300 * attempt;
              console.log(TAG, "ask.retry.backoff", { attempt: attempt, ms: backoff });
              await new Promise((r) => setTimeout(r, backoff));
              continue;
            }
            setMessages((m) => m.concat([{ role: "assistant", text: "Sorry, I couldn’t respond." }]));
            overallOk = false;
            break;
          }

          // ---------- Fallback (no stream) ----------
          if (!resp.body || !resp.body.getReader) {
            const full = await resp.text().catch(function () { return ""; });
            console.log(TAG, "ask.fallback.no_stream.body_text_len", { len: full ? full.length : 0 });

            if (!full) {
              console.log(TAG, "ask.fallback.empty_body");
              setLastError("Empty response");
              setMessages((m) => m.concat([{ role: "assistant", text: "Sorry, I couldn’t respond." }]));
              overallOk = false;
              break;
            }

            const finalText = parseSSETextToString(full);
            console.log(TAG, "ask.fallback.parsed", { chars: finalText.length, preview: finalText.slice(0, 120) });
            if (finalText) {
              setMessages((m) => m.concat([{ role: "assistant", text: finalText }]));
              if (onChunk) {
                try { onChunk(finalText, true); } catch {}
              }
              overallOk = true;
            } else {
              setLastError("Parse error");
              setMessages((m) => m.concat([{ role: "assistant", text: "Sorry, I couldn’t respond." }]));
              overallOk = false;
            }
            break;
          }

          // ---------- Streaming path ----------
          const reader = resp.body.getReader();
          const decoder = new TextDecoder();
          let totalBytes = 0;
          let chunkCount = 0;
          let botText = "";
          let lineBuffer = ""; // carry partial lines between chunks

          console.log(TAG, "ask.stream.start", { t: nowIso() });

          while (true) {
            const r = await reader.read();
            if (r && r.done) break;
            const value = r && r.value;
            const bytes = value ? value.length : 0;
            chunkCount += 1;
            totalBytes += bytes;

            const chunk = decoder.decode(value || new Uint8Array(0), { stream: true });
            lineBuffer += chunk;

            // log chunk
            console.log(TAG, "stream.chunk", {
              i: chunkCount,
              bytes: bytes,
              preview: (chunk || "").slice(0, 80).replace(/\n/g, "\\n"),
            });

            // Only split on complete lines; keep remainder in buffer
            const lastNewlineIdx = lineBuffer.lastIndexOf("\n");
            const complete = lastNewlineIdx >= 0 ? lineBuffer.slice(0, lastNewlineIdx) : "";
            lineBuffer = lastNewlineIdx >= 0 ? lineBuffer.slice(lastNewlineIdx + 1) : lineBuffer;

            if (complete) {
              const lines = complete.split("\n");
              for (let i = 0; i < lines.length; i++) {
                const raw = lines[i] || "";
                const line = raw.trim();
                if (!line || line.indexOf("data:") !== 0) continue;

                const data = line.slice(5).trim();
                if (!data || data === "[DONE]") {
                  console.log(TAG, "stream.data.DONE");
                  continue;
                }

                try {
                  const evt = JSON.parse(data);
                  const delta = extractDelta(evt);
                  if (delta) {
                    botText += delta;
                    if (onChunk) {
                      try { onChunk(delta, false); } catch {}
                    }
                    setMessages(function (prev) {
                      const clone = prev.slice();
                      const last = clone[clone.length - 1];
                      if (!last || last.role !== "assistant") {
                        clone.push({ role: "assistant", text: delta });
                      } else {
                        last.text = (last.text || "") + delta;
                      }
                      return clone;
                    });
                  }
                } catch (e) {
                  console.log(TAG, "stream.json.parse_error", { msg: String(e && e.message ? e.message : e) });
                }
              }
            }
          }

          // flush any trailing partial line
          if (lineBuffer && lineBuffer.indexOf("data:") === 0) {
            const data = lineBuffer.slice(5).trim();
            if (data && data !== "[DONE]") {
              try {
                const evt = JSON.parse(data);
                const delta = extractDelta(evt);
                if (delta) {
                  setMessages(function (prev) {
                    const clone = prev.slice();
                    const last = clone[clone.length - 1];
                    if (!last || last.role !== "assistant") {
                      clone.push({ role: "assistant", text: delta });
                    } else {
                      last.text = (last.text || "") + delta;
                    }
                    return clone;
                  });
                }
              } catch {}
            }
          }

          console.log(TAG, "ask.stream.done", { chunks: chunkCount, totalBytes: totalBytes, botChars: (botText || "").length });

          overallOk = !!(botText && botText.trim().length > 0);
          if (!overallOk) {
            setLastError("Empty stream");
            setMessages((m) => m.concat([{ role: "assistant", text: "Sorry, I couldn’t respond." }]));
          }
          // success or handled failure; stop retry loop
          break;
        } catch (err) {
          const msg = String(err && err.message ? err.message : err);
          console.log(TAG, "ask.exception", { err: msg });
          setLastError(msg);

          if (attempt < maxRetries) {
            attempt += 1;
            const backoff = 300 * attempt;
            console.log(TAG, "ask.retry.scheduled", { attempt: attempt, ms: backoff });
            await new Promise((r) => setTimeout(r, backoff));
            continue;
          }

          setMessages((m) => m.concat([{ role: "assistant", text: "Sorry, I couldn’t respond." }]));
          overallOk = false;
          break;
        } finally {
          if (toId) clearTimeout(toId);
          abortRef.current = null;
        }
      }

      setBusy(false);
      console.log(TAG, "ask.end", { ok: overallOk, t: nowIso() });
      return overallOk;
    },
    [messages, screen, maxHistory, requestTimeoutMs, maxRetries, onChunk]
  );

  /** createTicket(subject, body): simple invoke with logs */
  const createTicket = useCallback(async (subject, body) => {
    console.log(TAG, "ticket.create.start", { subjectPreview: String(subject || "").slice(0, 60) });
    try {
      const { data, error } = await supabase.functions.invoke("create_ticket", {
        body: { subject: subject, body: body, screen: screen },
      });
      if (error) {
        console.log(TAG, "ticket.create.error", { msg: error.message || error });
        setMessages((m) => m.concat([{ role: "assistant", text: "I tried to create a ticket but it failed." }]));
        return false;
      }
      console.log(TAG, "ticket.create.ok", { data: data });
      setMessages((m) => m.concat([{ role: "assistant", text: "✅ Ticket created. We’ll get back to you shortly." }]));
      return true;
    } catch (e) {
      console.log(TAG, "ticket.create.exception", { msg: String(e && e.message ? e.message : e) });
      setMessages((m) => m.concat([{ role: "assistant", text: "I couldn’t create a ticket right now." }]));
      return false;
    }
  }, [screen]);

  const clear = useCallback(() => {
    console.log(TAG, "clear.messages");
    setMessages([]);
    setLastError(null);
  }, []);

  const abort = useCallback(() => {
    try {
      if (abortRef.current && typeof abortRef.current.abort === "function") {
        abortRef.current.abort();
        console.log(TAG, "abort.signal.sent");
      }
    } catch (e) {
      console.log(TAG, "abort.error", { msg: String(e && e.message ? e.message : e) });
    }
  }, []);

  const api = useMemo(() => ({
    messages,
    busy,
    lastError,
    ask,
    clear,
    abort,
    createTicket,
  }), [messages, busy, lastError, ask, clear, abort, createTicket]);

  return api;
}