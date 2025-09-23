// app/(app)/quotes/preview.js
import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Platform,
  Dimensions,
  Pressable,
  Animated,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { WebView } from "react-native-webview";
import * as FileSystem from "expo-file-system";
import * as Sharing from "expo-sharing";
import * as IntentLauncher from "expo-intent-launcher";
import * as Haptics from "expo-haptics";
import { supabase } from "../../../lib/supabase";
import { ChevronLeft, Share2, Pencil, Download, ExternalLink } from "lucide-react-native";

// Review prompt (same as invoices)
import ReviewAppModal from "../../../components/ReviewAppModal";
import { shouldShowReviewPrompt, launchReviewFlow } from "../../../lib/reviewPrompt";

const BG = "#f5f7fb";
const CARD = "#ffffff";
const BORDER = "#e6e9ee";
const TEXT = "#0b1220";
const BRAND = "#2a86ff";

/* ------------------------------- helpers -------------------------------- */
const safeName = (name) => (name || "quote.pdf").replace(/[^\w.-]/g, "_");
const withBust = (url) =>
  url ? (url.includes("?") ? `${url}&cb=${Date.now()}` : `${url}?cb=${Date.now()}`) : url;

// strict UUID guard (prevents invalid input syntax for type uuid)
const isUuid = (v) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(v || ""));

async function markStatus(quoteId, status) {
  try {
    if (quoteId && isUuid(quoteId)) {
      await supabase.from("quotes").update({ status }).eq("id", quoteId);
    }
  } catch {}
}

/** PDF.js HTML viewer (same look/feel as invoices). */
const makePdfHtml = (base64, viewerWidthCSSPx) => `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1"/>
<style>
  :root{ --viewerW:${Math.max(320, Math.floor(viewerWidthCSSPx))}px; --pageW:var(--viewerW); }
  html,body{margin:0;padding:0;height:100%;background:#f5f7fb;overflow:hidden;}
  #strip{
    display:flex;height:100%;width:100%;
    overflow-x:auto;overflow-y:hidden;
    scroll-snap-type:x mandatory;-webkit-overflow-scrolling:touch;
    justify-content:center; align-items:center;
  }
  .pageWrap{ flex:0 0 var(--pageW); height:100%; display:flex; align-items:center; justify-content:center; scroll-snap-align:center; }
  canvas{
    display:block; width:calc(var(--pageW) - 8px); height:auto; margin:4px;
    border-radius:12px; background:#fff;
    box-shadow:0 6px 18px rgba(11,18,32,.07);
  }
  #strip::-webkit-scrollbar{display:none}
  .spacer{flex:0 0 8px;height:100%}
</style>
<script src="https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js"></script>
</head>
<body>
  <div id="strip"></div>
<script>
(function(){
  const b64="${base64}";
  const pdfjsLib = window.pdfjsLib;
  pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';

  const DPR = window.devicePixelRatio || 1;
  const strip = document.getElementById('strip');

  async function renderPage(pdf, pageNum, canvas){
    const page = await pdf.getPage(pageNum);
    const raw  = page.getViewport({ scale:1 });
    const cssW = canvas.clientWidth;
    const scale = cssW / raw.width;
    const vp = page.getViewport({ scale });
    const ctx = canvas.getContext('2d');
    canvas.width  = Math.round(vp.width  * DPR);
    canvas.height = Math.round(vp.height * DPR);
    ctx.setTransform(DPR,0,0,DPR,0,0);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
  }

  function rerenderAll(pdf){
    const canvases = Array.from(document.getElementsByTagName('canvas'));
    (async()=>{ for(let i=0;i<canvases.length;i++){ try{ await renderPage(pdf, i+1, canvases[i]); }catch(e){} } })();
  }

  let pdfRef=null;
  window.addEventListener('resize', ()=>{ if(pdfRef) rerenderAll(pdfRef); });

  pdfjsLib.getDocument({ data: Uint8Array.from(atob(b64), c=>c.charCodeAt(0)) }).promise.then(async (pdf)=>{
    pdfRef = pdf;
    for(let p=1;p<=pdf.numPages;p++){
      const wrap=document.createElement('div');wrap.className='pageWrap';
      const c=document.createElement('canvas');wrap.appendChild(c);strip.appendChild(wrap);
    }
    if (pdf.numPages>1) strip.style.justifyContent='initial';

    const canvases = Array.from(document.getElementsByTagName('canvas'));
    for(let i=0;i<canvases.length;i++){ try{ await renderPage(pdf, i+1, canvases[i]); }catch(e){} }

    const sp=document.createElement('div'); sp.className='spacer'; strip.appendChild(sp);

    window.ReactNativeWebView && window.ReactNativeWebView.postMessage('rendered');
  }).catch(err=>{
    window.ReactNativeWebView && window.ReactNativeWebView.postMessage('error:'+(err && err.message || err));
  });
})();
</script>
</body>
</html>`;

/* ---------------------------- micro-haptics ---------------------------- */
const vibrateTap   = () => Haptics.selectionAsync().catch(()=>{});
const vibrateSuccess = () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(()=>{});
const vibrateError   = () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(()=>{});

/* ------------------------- nice action buttons ------------------------- */
function ActionButton({ label, Icon, onPress, disabled, busy }) {
  const scale = useRef(new Animated.Value(1)).current;
  const pressIn = () => Animated.spring(scale, { toValue: 0.98, useNativeDriver: true, friction: 6 }).start();
  const pressOut = () => Animated.spring(scale, { toValue: 1, useNativeDriver: true, friction: 6 }).start();

  return (
    <Animated.View style={[styles.actionBtn, busy && styles.busy, { transform: [{ scale }] }]}>
      <Pressable
        android_ripple={{ color: "rgba(0,0,0,0.06)", borderless: false }}
        onPress={() => { if (disabled) return; vibrateTap(); onPress(); }}
        onPressIn={pressIn}
        onPressOut={pressOut}
        disabled={disabled}
        style={styles.actionPressable}
      >
        <Icon size={18} strokeWidth={2.5} color="#0b1220" />
        <Text style={styles.actionTxt} numberOfLines={1}>
          {busy ? label + "…" : label}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

/* ----------------- Resilient waiter (same as invoices) ----------------- */
async function waitForPdfAvailable(resolvePdfUrl, opts) {
  const maxWaitMs = (opts?.maxWaitMs) || 90000;
  const intervalMs = (opts?.intervalMs) || 800;
  const minBytes = (opts?.minBytes) || 800;
  const maxRetries = (opts?.maxRetries) || 3;
  const deadline = Date.now() + maxWaitMs;
  let lastErr = "PDF not ready yet.";
  let consecutiveFailures = 0;

  while (Date.now() < deadline) {
    try {
      let url = null;
      for (let r = 0; r < maxRetries && !url; r++) {
        try {
          url = await resolvePdfUrl();
          if (url) break;
        } catch (e) {
          if (r === maxRetries - 1) throw e;
          await new Promise(res => setTimeout(res, 250));
        }
      }

      if (url) {
        const target = FileSystem.cacheDirectory + `_probe_quote_${Date.now()}.pdf`;
        const downloadPromise = FileSystem.downloadAsync(withBust(url), target);
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Download timeout")), 15000)
        );
        const { status, uri } = await Promise.race([downloadPromise, timeoutPromise]);
        if (status === 200) {
          const info = await FileSystem.getInfoAsync(uri, { size: true });
          if (info?.exists && (info.size || 0) >= minBytes) return { url, uri };
        }
      }
      consecutiveFailures++;
    } catch (e) {
      lastErr = e?.message || String(e);
      consecutiveFailures++;
    }
    const backoff = Math.min(intervalMs * Math.pow(1.5, Math.min(consecutiveFailures, 4)), 5000);
    await new Promise(res => setTimeout(res, backoff));
  }
  throw new Error(lastErr || "Timed out waiting for PDF.");
}

/* -------------------------------- component -------------------------------- */
export default function QuotePreview() {
  const router = useRouter();
  const wvRef = useRef(null);

  const params = useLocalSearchParams();
  const rawId = Array.isArray(params.id) ? params.id[0] : params.id;
  const rawName = Array.isArray(params.name) ? params.name[0] : params.name;

  // STRICT: only accept proper UUIDs; otherwise treat as missing id
  const quoteId = isUuid(rawId) ? String(rawId) : null;
  const pdfName = safeName(rawName ? String(rawName) : "quote.pdf");

  const [busy, setBusy] = useState(null);
  const [loading, setLoading] = useState(true);
  const [fatal, setFatal] = useState("");
  const [base64Pdf, setBase64Pdf] = useState("");
  const [viewerWidth, setViewerWidth] = useState(Dimensions.get("window").width - 20);

  // Review prompt
  const [showReview, setShowReview] = useState(false);
  const hasAskedRef = useRef(false);

  useEffect(() => {
    const sub = Dimensions.addEventListener("change", ({ window }) => {
      setViewerWidth(window.width - 20);
    });
    return () => sub?.remove?.();
  }, []);

  /* ---------- URL resolution (same strategy as invoices) ---------- */
  const resolvePdfUrl = useCallback(async () => {
    if (!quoteId) throw new Error("Missing quote id.");

    // 1) Try signed URL function if present (non-fatal if not deployed)
    try {
      const { data, error } = await supabase.functions.invoke("get_quote_signed_url", {
        body: { quote_id: quoteId },
      });
      if (!error && data?.ok && data?.url) {
        try {
          const head = await fetch(data.url, { method: "HEAD" });
          if (head.ok) return data.url;
        } catch {}
      }
    } catch {}

    // 2) Fallback to stored pdf_url
    const got = await supabase
      .from("quotes")
      .select("pdf_url")
      .eq("id", quoteId)
      .maybeSingle();

    if (got?.error) throw got.error;
    return got?.data?.pdf_url || "";
  }, [quoteId]);

  const loadBase64 = useCallback(async () => {
    try {
      setLoading(true);
      setFatal("");
      setBase64Pdf("");

      const ready = await waitForPdfAvailable(resolvePdfUrl, {
        maxWaitMs: 90000,
        intervalMs: 800,
        minBytes: 800,
        maxRetries: 3,
      });

      const b64 = await FileSystem.readAsStringAsync(ready.uri, {
        encoding: FileSystem.EncodingType.Base64,
      });

      // sanity check: PDF files start with "%PDF-" => base64 starts with "JVBERi0"
      if (!b64 || b64.length < 100 || !b64.startsWith("JVBERi0")) {
        throw new Error("PDF file appears to be empty or corrupted");
      }

      setBase64Pdf(b64);
    } catch (e) {
      setFatal(e?.message || "Could not load PDF.");
    } finally {
      setLoading(false);
    }
  }, [resolvePdfUrl]);

  useEffect(() => {
    loadBase64();
    const t = setTimeout(() => {
      if (fatal && !loading && !base64Pdf) loadBase64();
    }, 2500);
    return () => clearTimeout(t);
  }, [loadBase64, fatal, loading, base64Pdf]);

  async function downloadToCache(srcUrl, name = pdfName) {
    if (!srcUrl) throw new Error("No PDF URL");
    const fname = safeName(name);
    const target = FileSystem.cacheDirectory + fname;
    const downloadPromise = FileSystem.downloadAsync(withBust(srcUrl), target);
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Download timeout after 30 seconds")), 30000)
    );
    const { uri, status } = await Promise.race([downloadPromise, timeoutPromise]);
    if (status !== 200) throw new Error(`Download failed (${status})`);
    const info = await FileSystem.getInfoAsync(uri, { size: true });
    if (!info.exists || (info.size || 0) < 100) throw new Error("Downloaded file is empty or corrupted");
    return { uri, fname };
  }

  const onShare = async () => {
    try {
      setBusy("share");
      const url = await resolvePdfUrl();
      const { uri, fname } = await downloadToCache(url, pdfName);
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: "application/pdf", dialogTitle: fname });
        vibrateSuccess();
        if (quoteId) markStatus(quoteId, "sent");
      } else {
        Alert.alert("Sharing unavailable", "The PDF is saved to cache instead.");
      }
    } catch (e) {
      vibrateError();
      Alert.alert("Share failed", e?.message ?? "Please try again.");
    } finally {
      setBusy(null);
    }
  };

  const onSave = async () => {
    try {
      setBusy("save");
      const url = await resolvePdfUrl();
      const { uri, fname } = await downloadToCache(url, pdfName);
      if (Platform.OS === "android") {
        const perm = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
        if (!perm.granted) { Alert.alert("Choose a folder to save the PDF."); return; }
        const fileUri = await FileSystem.StorageAccessFramework.createFileAsync(
          perm.directoryUri, fname, "application/pdf"
        );
        const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
        await FileSystem.writeAsStringAsync(fileUri, base64, { encoding: FileSystem.EncodingType.Base64 });
        vibrateSuccess();
        Alert.alert("Saved", "PDF saved to selected folder.");
      } else {
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(uri, { mimeType: "application/pdf", dialogTitle: fname });
        } else {
          Alert.alert("Saved to cache", "Use the Share sheet to move it to Files.");
        }
        vibrateSuccess();
      }
      if (quoteId) markStatus(quoteId, "sent");
    } catch (e) {
      vibrateError();
      Alert.alert("Save failed", e?.message ?? "Please try again.");
    } finally {
      setBusy(null);
    }
  };

  const onOpenExternally = async () => {
    try {
      setBusy("open");
      const url = await resolvePdfUrl();
      const { uri } = await downloadToCache(url, pdfName);
      if (Platform.OS === "android") {
        const contentUri = await FileSystem.getContentUriAsync(uri);
        await IntentLauncher.startActivityAsync("android.intent.action.VIEW", {
          data: contentUri, flags: 1, type: "application/pdf",
        });
      } else if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: "application/pdf", dialogTitle: pdfName });
      } else {
        Alert.alert("Downloaded", "The PDF was saved to cache.");
      }
      vibrateSuccess();
      if (quoteId) markStatus(quoteId, "sent");
    } catch (e) {
      vibrateError();
      Alert.alert("Open failed", e?.message ?? "Please try again.");
    } finally {
      setBusy(null);
    }
  };

  const onEdit = () => {
    if (!quoteId) {
      vibrateError();
      Alert.alert("Missing quote", "Go back to the list and open the quote to edit.");
      return;
    }
    vibrateTap();
    router.push(`/(app)/quotes/create?quoteId=${quoteId}`);
  };

  const viewerHtml = useMemo(
    () => (base64Pdf ? makePdfHtml(base64Pdf, viewerWidth) : ""),
    [base64Pdf, viewerWidth]
  );

  const goBackToList = () => { vibrateTap(); router.replace("/(app)/quotes"); };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={goBackToList} style={styles.backBtn} activeOpacity={0.85}>
          <ChevronLeft size={18} color={BRAND} />
          <Text style={styles.backTxt}>Back</Text>
        </TouchableOpacity>
        <View style={{ width: 52 }} />
      </View>

      <View style={styles.viewerCard} onLayout={(e) => setViewerWidth(e.nativeEvent.layout.width)}>
        {(loading || !viewerHtml) && (
          <View style={styles.loading}>
            <ActivityIndicator />
            <Text style={styles.loadingText}>{fatal ? fatal : "Preparing your PDF…"}</Text>
            {!!fatal && (
              <TouchableOpacity
                onPress={() => { vibrateTap(); loadBase64(); }}
                style={styles.retryBtn}
                activeOpacity={0.9}
              >
                <Text style={styles.retryText}>Retry</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {!!viewerHtml && !fatal && (
          <WebView
            ref={wvRef}
            source={{ html: viewerHtml }}
            originWhitelist={["*"]}
            javaScriptEnabled
            domStorageEnabled
            mixedContentMode="always"
            startInLoadingState
            onMessage={async (e) => {
              const msg = String(e?.nativeEvent?.data || "");
              if (msg.startsWith("error:")) {
                setFatal("PDF rendering failed: " + msg.slice(6));
              } else if (msg === "rendered" && !hasAskedRef.current) {
                hasAskedRef.current = true;
                try {
                  const should = await shouldShowReviewPrompt();
                  if (should) setShowReview(true);
                } catch {}
              }
            }}
            style={{ flex: 1 }}
            renderLoading={() => (
              <View style={styles.loading}>
                <ActivityIndicator />
                <Text style={styles.loadingText}>Rendering PDF...</Text>
              </View>
            )}
          />
        )}
      </View>

      <View style={styles.actionBar}>
        <ActionButton label={busy === "share" ? "Sharing" : "Share"} Icon={Share2} onPress={onShare} disabled={!!busy || !!fatal} busy={busy === "share"} />
        <ActionButton label={busy === "edit" ? "Editing" : "Edit"} Icon={Pencil} onPress={onEdit} disabled={!!busy} busy={busy === "edit"} />
        <ActionButton label={busy === "save" ? "Saving" : "Save"} Icon={Download} onPress={onSave} disabled={!!busy || !!fatal} busy={busy === "save"} />
        <ActionButton label={busy === "open" ? "Opening" : "Open"} Icon={ExternalLink} onPress={onOpenExternally} disabled={!!busy || !!fatal} busy={busy === "open"} />
      </View>

      <View style={{ height: 62 }} />

      <ReviewAppModal
        visible={showReview}
        onLater={() => setShowReview(false)}
        onRateNow={async () => {
          setShowReview(false);
          await launchReviewFlow();
        }}
      />
    </SafeAreaView>
  );
}

/* --------------------------------- styles --------------------------------- */
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: BG },
  header: {
    height: 48,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  backBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderRadius: 10,
  },
  backTxt: { color: BRAND, fontWeight: "800", fontSize: 16 },

  viewerCard: {
    flex: 1,
    marginHorizontal: 10,
    marginTop: 2,
    marginBottom: 20,
    borderRadius: 12,
    borderWidth: 1.25,
    borderColor: BORDER,
    backgroundColor: CARD,
    overflow: "hidden",
    ...Platform.select({
      ios: { shadowColor: "#0b1220", shadowOpacity: 0.08, shadowRadius: 14, shadowOffset: { width: 0, height: 6 } },
      android: { elevation: 3 },
    }),
  },

  loading: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    padding: 14,
    gap: 8,
    backgroundColor: CARD,
  },
  loadingText: { color: "#6b7280", textAlign: "center" },
  retryBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: BRAND,
  },
  retryText: { color: "#fff", fontWeight: "800" },

  actionBar: {
    position: "absolute",
    left: 0, right: 0, bottom: 0,
    paddingHorizontal: 10, paddingTop: 8, paddingBottom: 10,
    backgroundColor: CARD, borderTopWidth: 1, borderColor: BORDER,
    flexDirection: "row", alignItems: "center", gap: 8,
    ...Platform.select({
      ios: { shadowColor: "#0b1220", shadowOpacity: 0.08, shadowRadius: 12, shadowOffset: { width: 0, height: -4 } },
      android: { elevation: 10 },
    }),
  },

  actionBtn: {
    flex: 1,
    minHeight: 46,
    borderRadius: 12,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: BORDER,
    ...Platform.select({
      ios: { shadowColor: "#0b1220", shadowOpacity: 0.05, shadowRadius: 9, shadowOffset: { width: 0, height: 3 } },
      android: { elevation: 2 },
    }),
  },
  actionPressable: {
    flex: 1,
    paddingVertical: 9, paddingHorizontal: 10,
    borderRadius: 12,
    alignItems: "center", justifyContent: "center",
    flexDirection: "row", gap: 8,
  },
  actionTxt: { color: TEXT, fontWeight: "900" },
  busy: { opacity: 0.6 },
});