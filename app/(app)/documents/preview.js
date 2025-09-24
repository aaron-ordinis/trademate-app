// app/(app)/documents/preview.js
import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  View,
  Text,
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
import { ChevronLeft, Share2, Download, ExternalLink } from "lucide-react-native";

/* ---------- UI tokens ---------- */
const BG = "#f5f7fb";
const CARD = "#ffffff";
const BORDER = "#e6e9ee";
const TEXT = "#0b1220";
const BRAND = "#2a86ff";

/* ---------- config ---------- */
const documentsIndexHref = "/(app)/documents";
const BUCKET_CANDIDATES = ["documents", "secured", "private"];

/* ---------- helpers ---------- */
const safeName = (name) => (name || "document.pdf").replace(/[^\w.-]/g, "_");
const withBust = (url) =>
  url ? (url.includes("?") ? `${url}&cb=${Date.now()}` : `${url}?cb=${Date.now()}`) : url;

/* ---------- WebView HTML (URL fast path) ---------- */
const makePdfHtmlFromUrl = (signedUrl, viewerWidthCSSPx) => `<!DOCTYPE html>
<html><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1"/>
<style>
:root{ --viewerW:${Math.max(320, Math.floor(viewerWidthCSSPx))}px; --pageW:var(--viewerW); }
html,body{margin:0;padding:0;height:100%;background:#f5f7fb;overflow:hidden;}
#strip{display:flex;height:100%;width:100%;overflow-x:auto;overflow-y:hidden;scroll-snap-type:x mandatory;-webkit-overflow-scrolling:touch;justify-content:center;align-items:center;}
.pageWrap{flex:0 0 var(--pageW);height:100%;display:flex;align-items:center;justify-content:center;scroll-snap-align:center;}
canvas{display:block;width:calc(var(--pageW) - 8px);height:auto;margin:4px;border-radius:12px;background:#fff;box-shadow:0 6px 18px rgba(11,18,32,.07);}
#strip::-webkit-scrollbar{display:none}.spacer{flex:0 0 8px;height:100%}
</style>
<script src="https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js"></script>
</head><body><div id="strip"></div>
<script>(function(){
const url=${JSON.stringify(signedUrl)};
const pdfjsLib=window.pdfjsLib;
pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
const DPR=window.devicePixelRatio||1, strip=document.getElementById('strip');
async function renderPage(pdf,n,c){const p=await pdf.getPage(n),raw=p.getViewport({scale:1}),cssW=c.clientWidth,scale=cssW/raw.width,vp=p.getViewport({scale});const ctx=c.getContext('2d');c.width=Math.round(vp.width*DPR);c.height=Math.round(vp.height*DPR);ctx.setTransform(DPR,0,0,DPR,0,0);await p.render({canvasContext:ctx,viewport:vp}).promise;}
function rerenderAll(pdf){const cs=[...document.getElementsByTagName('canvas')];(async()=>{for(let i=0;i<cs.length;i++){try{await renderPage(pdf,i+1,cs[i]);}catch(e){}}})();
let pdfRef=null;window.addEventListener('resize',()=>{if(pdfRef)rerenderAll(pdfRef);});
pdfjsLib.getDocument({url}).promise.then(async(pdf)=>{
  pdfRef=pdf;for(let p=1;p<=pdf.numPages;p++){const w=document.createElement('div');w.className='pageWrap';const c=document.createElement('canvas');w.appendChild(c);strip.appendChild(w);}
  if(pdf.numPages>1) strip.style.justifyContent='initial';
  const cs=[...document.getElementsByTagName('canvas')];
  for(let i=0;i<cs.length;i++){try{await renderPage(pdf,i+1,cs[i]);}catch(e){}}
  const sp=document.createElement('div');sp.className='spacer';strip.appendChild(sp);
  window.ReactNativeWebView&&window.ReactNativeWebView.postMessage('rendered');
}).catch(err=>{
  window.ReactNativeWebView&&window.ReactNativeWebView.postMessage('url_error:' + ((err&&err.message)||String(err)));
});})();</script></body></html>`;

/* ---------- WebView HTML (Base64 fallback) ---------- */
const makePdfHtmlFromBase64 = (base64, viewerWidthCSSPx) => `<!DOCTYPE html>
<html><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1"/>
<style>
:root{ --viewerW:${Math.max(320, Math.floor(viewerWidthCSSPx))}px; --pageW:var(--viewerW); }
html,body{margin:0;padding:0;height:100%;background:#f5f7fb;overflow:hidden;}
#strip{display:flex;height:100%;width:100%;overflow-x:auto;overflow-y:hidden;scroll-snap-type:x mandatory;-webkit-overflow-scrolling:touch;justify-content:center;align-items:center;}
.pageWrap{flex:0 0 var(--pageW);height:100%;display:flex;align-items:center;justify-content:center;scroll-snap-align:center;}
canvas{display:block;width:calc(var(--pageW) - 8px);height:auto;margin:4px;border-radius:12px;background:#fff;box-shadow:0 6px 18px rgba(11,18,32,.07);}
#strip::-webkit-scrollbar{display:none}.spacer{flex:0 0 8px;height:100%}
</style>
<script src="https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js"></script>
</head><body><div id="strip"></div>
<script>(function(){
const b64="${typeof base64==="string"?base64:""}";
const pdfjsLib=window.pdfjsLib;
pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
const DPR=window.devicePixelRatio||1, strip=document.getElementById('strip');
async function renderPage(pdf,n,c){const p=await pdf.getPage(n),raw=p.getViewport({scale:1}),cssW=c.clientWidth,scale=cssW/raw.width,vp=p.getViewport({scale});const ctx=c.getContext('2d');c.width=Math.round(vp.width*DPR);c.height=Math.round(vp.height*DPR);ctx.setTransform(DPR,0,0,DPR,0,0);await p.render({canvasContext:ctx,viewport:vp}).promise;}
function rerenderAll(pdf){const cs=[...document.getElementsByTagName('canvas')];(async()=>{for(let i=0;i<cs.length;i++){try{await renderPage(pdf,i+1,cs[i]);}catch(e){}}})();
let pdfRef=null;window.addEventListener('resize',()=>{if(pdfRef)rerenderAll(pdfRef);});
pdfjsLib.getDocument({data:Uint8Array.from(atob(b64),c=>c.charCodeAt(0))}).promise.then(async(pdf)=>{
  pdfRef=pdf;for(let p=1;p<=pdf.numPages;p++){const w=document.createElement('div');w.className='pageWrap';const c=document.createElement('canvas');w.appendChild(c);strip.appendChild(w);}
  if(pdf.numPages>1) strip.style.justifyContent='initial';
  const cs=[...document.getElementsByTagName('canvas')];
  for(let i=0;i<cs.length;i++){try{await renderPage(pdf,i+1,cs[i]);}catch(e){}}
  const sp=document.createElement('div');sp.className='spacer';strip.appendChild(sp);
  window.ReactNativeWebView&&window.ReactNativeWebView.postMessage('rendered');
}).catch(err=>{
  window.ReactNativeWebView&&window.ReactNativeWebView.postMessage('error:' + ((err&&err.message)||String(err)));
});})();</script></body></html>`;

/* ---------- haptics + buttons ---------- */
const vibrateTap = () => Haptics.selectionAsync().catch(()=>{});
const vibrateSuccess = () =>
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(()=>{});
const vibrateError = () =>
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(()=>{});

function ActionButton({ label, Icon, onPress, disabled, busy }) {
  const scale = useRef(new Animated.Value(1)).current;
  const pressIn = () => Animated.spring(scale, { toValue: 0.98, useNativeDriver: true, friction: 6 }).start();
  const pressOut = () => Animated.spring(scale, { toValue: 1, useNativeDriver: true, friction: 6 }).start();

  return (
    <Animated.View style={[styles.actionBtn, busy && styles.busy, { transform: [{ scale }] }]}>
      <Pressable
        android_ripple={{ color: "rgba(0,0,0,0.06)" }}
        onPress={() => { if (disabled) return; vibrateTap(); onPress(); }}
        onPressIn={pressIn} onPressOut={pressOut} disabled={disabled} style={styles.actionPressable}
      >
        <Icon size={18} strokeWidth={2.5} color="#0b1220" />
        <Text style={styles.actionTxt} numberOfLines={1}>{busy ? label + "…" : label}</Text>
      </Pressable>
    </Animated.View>
  );
}

/* ---------- main component ---------- */
export default function DocumentPreview() {
  const router = useRouter();
  const wvRef = useRef(null);

  const params = useLocalSearchParams();
  const rawId = Array.isArray(params.id) ? params.id[0] : params.id;
  const rawName = Array.isArray(params.name) ? params.name[0] : params.name;

  const documentId = rawId ? String(rawId) : null;
  const pdfName = safeName(rawName ? String(rawName) : "document.pdf");

  const [busy, setBusy] = useState(null);
  const [fatal, setFatal] = useState("");
  const [viewerWidth, setViewerWidth] = useState(Dimensions.get("window").width - 20);
  const [signedUrl, setSignedUrl] = useState("");
  const [useBase64, setUseBase64] = useState(false);
  const [b64, setB64] = useState("");
  const [loading, setLoading] = useState(true);

  // react to rotation
  useEffect(() => {
    const sub = Dimensions.addEventListener("change", ({ window }) => {
      setViewerWidth(window.width - 20);
    });
    return () => sub?.remove?.();
  }, []);

  /** Get the best available URL (edge → storage signed → direct column) */
  const tryResolvePdfUrl = useCallback(async () => {
    if (!documentId) return "";

    let lastError = null;

    // 1) Edge Function that returns a signed URL
    try {
      const { data, error } = await supabase.functions.invoke("get_document_signed_url", {
        body: { document_id: documentId },
      });
      if (!error && data?.ok && data?.url) {
        try { const head = await fetch(data.url, { method: "HEAD" }); if (head.ok) return data.url; } catch {}
      }
      lastError = error;
    } catch (e) { lastError = e; }

    // 2) DB lookup (file_path → signed URL) or (file_url)
    try {
      const got = await supabase
        .from("documents")
        .select("file_path, file_url")
        .eq("id", documentId)
        .maybeSingle();
      if (got?.error) throw got.error;

      const path = got?.data?.file_path;
      if (path) {
        // try common buckets
        for (const bucket of BUCKET_CANDIDATES) {
          const signed = await supabase.storage.from(bucket).createSignedUrl(path, 3600);
          if (!signed.error && signed.data?.signedUrl) return signed.data.signedUrl;
        }
      }
      if (got?.data?.file_url) return got.data.file_url;
    } catch (e) { lastError = e; }

    console.warn("[DOCUMENT_PREVIEW] URL resolution failed:", lastError?.message || lastError);
    return "";
  }, [documentId]);

  /** Ensure a PDF exists: resolve; if missing → return empty */
  const ensurePdfUrl = useCallback(async () => {
    const url = await tryResolvePdfUrl();
    return url;
  }, [tryResolvePdfUrl]);

  // initial load
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setFatal(""); setLoading(true); setSignedUrl(""); setUseBase64(false); setB64("");
      const url = await ensurePdfUrl();
      if (cancelled) return;
      if (url) {
        setSignedUrl(withBust(url));
      } else {
        setFatal("Could not locate document PDF.");
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [ensurePdfUrl]);

  /** Fallback to base64 only if URL mode errors */
  const fallbackToBase64 = useCallback(async () => {
    try {
      setLoading(true); setFatal("");
      const url = signedUrl || (await ensurePdfUrl());
      if (!url) throw new Error("PDF URL unavailable.");
      const target = FileSystem.cacheDirectory + `_document_${documentId || "file"}.pdf`;
      const { uri, status } = await FileSystem.downloadAsync(withBust(url), target);
      if (status !== 200) throw new Error(`Download failed (${status})`);
      const info = await FileSystem.getInfoAsync(uri, { size: true });
      if (!info.exists || (info.size || 0) < 100) throw new Error("Downloaded file is empty.");
      const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
      if (!base64 || base64.length < 100) throw new Error("PDF appears corrupted.");
      setB64(base64); setUseBase64(true);
    } catch (e) {
      setFatal(e?.message || "Could not load PDF.");
    } finally {
      setLoading(false);
    }
  }, [documentId, signedUrl, ensurePdfUrl]);

  /* actions */
  async function downloadToCache(srcUrl, name = pdfName) {
    if (!srcUrl) throw new Error("No PDF URL");
    const fname = safeName(name);
    const target = FileSystem.cacheDirectory + fname;
    const { uri, status } = await FileSystem.downloadAsync(withBust(srcUrl), target);
    if (status !== 200) throw new Error(`Download failed (${status})`);
    const info = await FileSystem.getInfoAsync(uri, { size: true });
    if (!info.exists || (info.size || 0) < 100) throw new Error("Downloaded file is empty or corrupted");
    return { uri, fname };
  }

  const onShare = async () => {
    try {
      setBusy("share");
      const url = signedUrl || (await ensurePdfUrl());
      if (!url) throw new Error("No PDF available.");
      const { uri, fname } = await downloadToCache(url, pdfName);
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: "application/pdf", dialogTitle: fname });
        vibrateSuccess();
      } else {
        Alert.alert("Sharing unavailable", "The PDF is saved to cache instead.");
      }
    } catch (e) { vibrateError(); Alert.alert("Share failed", e?.message ?? "Please try again."); }
    finally { setBusy(null); }
  };

  const onSave = async () => {
    try {
      setBusy("save");
      const url = signedUrl || (await ensurePdfUrl());
      if (!url) throw new Error("No PDF available.");
      const { uri, fname } = await downloadToCache(url, pdfName);
      if (Platform.OS === "android") {
        const perm = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
        if (!perm.granted) { Alert.alert("Choose a folder to save the PDF."); return; }
        const fileUri = await FileSystem.StorageAccessFramework.createFileAsync(perm.directoryUri, fname, "application/pdf");
        const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
        await FileSystem.writeAsStringAsync(fileUri, base64, { encoding: FileSystem.EncodingType.Base64 });
        vibrateSuccess(); Alert.alert("Saved", "PDF saved to selected folder.");
      } else {
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(uri, { mimeType: "application/pdf", dialogTitle: fname });
        } else {
          Alert.alert("Saved to cache", "Use the Share sheet to move it to Files.");
        }
        vibrateSuccess();
      }
    } catch (e) { vibrateError(); Alert.alert("Save failed", e?.message ?? "Please try again."); }
    finally { setBusy(null); }
  };

  const onOpenExternally = async () => {
    try {
      setBusy("open");
      const url = signedUrl || (await ensurePdfUrl());
      if (!url) throw new Error("No PDF available.");
      const { uri } = await downloadToCache(url, pdfName);
      if (Platform.OS === "android") {
        const contentUri = await FileSystem.getContentUriAsync(uri);
        await IntentLauncher.startActivityAsync("android.intent.action.VIEW", { data: contentUri, flags: 1, type: "application/pdf" });
      } else if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: "application/pdf", dialogTitle: pdfName });
      } else {
        Alert.alert("Downloaded", "The PDF was saved to cache.");
      }
      vibrateSuccess();
    } catch (e) { vibrateError(); Alert.alert("Open failed", e?.message ?? "Please try again."); }
    finally { setBusy(null); }
  };

  /* render */
  const htmlUrl    = useMemo(() => (signedUrl && !useBase64 ? makePdfHtmlFromUrl(signedUrl, viewerWidth) : ""), [signedUrl, viewerWidth, useBase64]);
  const htmlBase64 = useMemo(() => (useBase64 && b64 ? makePdfHtmlFromBase64(b64, viewerWidth) : ""), [useBase64, b64, viewerWidth]);
  const goBack = () => { vibrateTap(); router.replace(documentsIndexHref); };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={goBack} style={styles.backBtn} android_ripple={{ color: "rgba(0,0,0,0.06)" }}>
          <ChevronLeft size={18} color={BRAND} />
          <Text style={styles.backTxt}>Back</Text>
        </Pressable>
        <View style={{ width: 52 }} />
      </View>

      {/* Viewer */}
      <View style={styles.viewerCard} onLayout={(e) => setViewerWidth(e.nativeEvent.layout.width)}>
        {(loading || (!htmlUrl && !htmlBase64)) && (
          <View style={styles.loading}>
            <ActivityIndicator />
            <Text style={styles.loadingText}>{fatal ? fatal : useBase64 ? "Preparing your PDF…" : "Fetching PDF…"}</Text>
            {!!fatal && (
              <Pressable
                onPress={() => { vibrateTap(); setFatal(""); setUseBase64(false); setSignedUrl(""); setB64(""); setLoading(true); (async()=>{ const url = await ensurePdfUrl(); setSignedUrl(url||""); setLoading(false); if(!url) setFatal("Could not locate document PDF."); })(); }}
                style={styles.retryBtn}
                android_ripple={{ color: "rgba(255,255,255,0.15)" }}
              >
                <Text style={styles.retryText}>Retry</Text>
              </Pressable>
            )}
          </View>
        )}

        {!!htmlUrl && !fatal && (
          <WebView
            ref={wvRef}
            source={{ html: htmlUrl }}
            originWhitelist={["*"]}
            javaScriptEnabled domStorageEnabled mixedContentMode="always"
            startInLoadingState
            onMessage={async (e) => {
              const msg = String(e?.nativeEvent?.data || "");
              if (msg.startsWith("url_error:")) { setUseBase64(true); setTimeout(() => fallbackToBase64(), 0); }
            }}
            onError={() => { setUseBase64(true); setTimeout(() => fallbackToBase64(), 0); }}
            onHttpError={() => { setUseBase64(true); setTimeout(() => fallbackToBase64(), 0); }}
            style={{ flex: 1 }}
          />
        )}

        {!!htmlBase64 && !fatal && (
          <WebView
            ref={wvRef}
            source={{ html: htmlBase64 }}
            originWhitelist={["*"]}
            javaScriptEnabled domStorageEnabled mixedContentMode="always"
            startInLoadingState
            onMessage={async (e) => {
              const msg = String(e?.nativeEvent?.data || "");
              if (msg.startsWith("error:")) setFatal("PDF rendering failed: " + msg.slice(6));
            }}
            style={{ flex: 1 }}
          />
        )}
      </View>

      {/* Actions */}
      <View style={styles.actionBar}>
        <ActionButton label={busy === "share" ? "Sharing" : "Share"} Icon={Share2} onPress={onShare} disabled={!!busy || !!fatal} busy={busy === "share"} />
        <ActionButton label={busy === "save" ? "Saving" : "Save"} Icon={Download} onPress={onSave} disabled={!!busy || !!fatal} busy={busy === "save"} />
        <ActionButton label={busy === "open" ? "Opening" : "Open"} Icon={ExternalLink} onPress={onOpenExternally} disabled={!!busy || !!fatal} busy={busy === "open"} />
      </View>
      <View style={{ height: 62 }} />
    </SafeAreaView>
  );
}

/* ---------- styles ---------- */
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: BG },
  header: {
    height: 48, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", justifyContent: "space-between",
  },
  backBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 8, borderRadius: 10 },
  backTxt: { color: BRAND, fontWeight: "800", fontSize: 16 },

  viewerCard: {
    flex: 1, marginHorizontal: 10, marginTop: 2, marginBottom: 20, borderRadius: 12, borderWidth: 1.25,
    borderColor: BORDER, backgroundColor: CARD, overflow: "hidden",
    ...Platform.select({ ios: { shadowColor: "#0b1220", shadowOpacity: 0.08, shadowRadius: 14, shadowOffset: { width: 0, height: 6 } }, android: { elevation: 3 } }),
  },

  loading: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center", padding: 14, gap: 8, backgroundColor: CARD },
  loadingText: { color: "#6b7280", textAlign: "center" },
  retryBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: BRAND },
  retryText: { color: "#fff", fontWeight: "800" },

  actionBar: {
    position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: 10, paddingTop: 8, paddingBottom: 10,
    backgroundColor: CARD, borderTopWidth: 1, borderColor: BORDER, flexDirection: "row", alignItems: "center", gap: 8,
    ...Platform.select({ ios: { shadowColor: "#0b1220", shadowOpacity: 0.08, shadowRadius: 12, shadowOffset: { width: 0, height: -4 } }, android: { elevation: 10 } }),
  },
  actionBtn: {
    flex: 1, minHeight: 46, borderRadius: 12, backgroundColor: "#fff", borderWidth: 1, borderColor: BORDER,
    ...Platform.select({ ios: { shadowColor: "#0b1220", shadowOpacity: 0.05, shadowRadius: 9, shadowOffset: { width: 0, height: 3 } }, android: { elevation: 2 } }),
  },
  actionPressable: { flex: 1, paddingVertical: 9, paddingHorizontal: 10, borderRadius: 12, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8 },
  actionTxt: { color: TEXT, fontWeight: "900" },
  busy: { opacity: 0.6 },
});