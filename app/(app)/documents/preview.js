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
import { Share2, Download, ExternalLink, ChevronLeft } from "lucide-react-native";

/* ---------------- helpers ---------------- */
const stylesVars = {
  BG: "#f5f7fb",
  CARD: "#ffffff",
  BORDER: "#e6e9ee",
  TEXT: "#0b1220",
  BRAND: "#2a86ff",
};

const safeName = (name) => (name || "document").replace(/[^\w.-]/g, "_");
const withBust = (url) =>
  url ? (url.includes("?") ? url + "&cb=" + Date.now() : url + "?cb=" + Date.now()) : url;
const isPdfLike = (mime = "", name = "", url = "") => {
  const s = `${mime} ${name} ${url}`.toLowerCase();
  return s.includes("pdf") || /\.pdf($|\?)/i.test(s);
};

// Build href for the documents list of a job
const docsIndexHref = (jobId) => `/app/jobs/${jobId}/documents`.replace(/\s/g, "");

/** Compact html like invoice preview */
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

/* haptics */
const vibrateTap = () => Haptics.selectionAsync().catch(()=>{});
const vibrateSuccess = () =>
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(()=>{});
const vibrateError = () =>
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(()=>{});

/* animated action button (same as invoices) */
function ActionButton({ label, Icon, onPress, disabled, busy }) {
  const scale = useRef(new Animated.Value(1)).current;
  const pressIn = () =>
    Animated.spring(scale, { toValue: 0.98, useNativeDriver: true, friction: 6 }).start();
  const pressOut = () =>
    Animated.spring(scale, { toValue: 1, useNativeDriver: true, friction: 6 }).start();

  return (
    <Animated.View style={[st.actionBtn, busy && st.busy, { transform: [{ scale }] }]}>
      <Pressable
        android_ripple={{ color: "rgba(0,0,0,0.06)", borderless: false }}
        onPress={() => { if (disabled) return; vibrateTap(); onPress(); }}
        onPressIn={pressIn}
        onPressOut={pressOut}
        disabled={disabled}
        style={st.actionPressable}
      >
        <Icon size={18} strokeWidth={2.5} color={stylesVars.TEXT} />
        <Text style={st.actionTxt} numberOfLines={1}>
          {busy ? `${label}…` : label}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

/* ---------------- component ---------------- */
export default function DocumentPreview() {
  const router = useRouter();
  const wvRef = useRef(null);

  const params = useLocalSearchParams();
  const rawUrl = Array.isArray(params.url) ? params.url[0] : params.url;
  const rawName = Array.isArray(params.name) ? params.name[0] : params.name;
  const mime = Array.isArray(params.mime) ? params.mime[0] : params.mime;
  const jobId = Array.isArray(params.jobId) ? params.jobId[0] : params.jobId;

  const docUrl = String(rawUrl || "");
  const docName = safeName(String(rawName || "document"));
  const pdfLike = isPdfLike(mime, docName, docUrl);

  const [busy, setBusy] = useState(null);
  const [loading, setLoading] = useState(true);
  const [fatal, setFatal] = useState("");
  const [base64Pdf, setBase64Pdf] = useState("");
  const [viewerWidth, setViewerWidth] = useState(Dimensions.get("window").width - 20);

  // react to rotation
  useEffect(() => {
    const sub = Dimensions.addEventListener("change", ({ window }) => {
      setViewerWidth(window.width - 20);
    });
    return () => sub?.remove?.();
  }, []);

  const loadPdfAsBase64 = useCallback(async () => {
    try {
      setLoading(true);
      setFatal("");
      const target = FileSystem.cacheDirectory + (docName.endsWith(".pdf") ? docName : docName + ".pdf");
      const { status, uri } = await FileSystem.downloadAsync(withBust(docUrl), target);
      if (status !== 200) throw new Error(`Download failed (${status})`);
      const b64 = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      setBase64Pdf(b64);
    } catch (e) {
      setFatal(e?.message || "Could not load document.");
    } finally {
      setLoading(false);
    }
  }, [docUrl, docName]);

  useEffect(() => {
    if (pdfLike) loadPdfAsBase64();
    else setLoading(false);
  }, [loadPdfAsBase64, pdfLike]);

  const viewerHtml = useMemo(
    () => (pdfLike && base64Pdf ? makePdfHtml(base64Pdf, viewerWidth) : ""),
    [base64Pdf, viewerWidth, pdfLike]
  );

  async function downloadToCache() {
    const fname =
      pdfLike && !/\.pdf$/i.test(docName) ? `${docName}.pdf` : docName;
    const target = FileSystem.cacheDirectory + fname;
    const { uri, status } = await FileSystem.downloadAsync(withBust(docUrl), target);
    if (status !== 200) throw new Error(`Download failed (${status})`);
    return { uri, fname };
  }

  const onShare = async () => {
    try {
      setBusy("share");
      const { uri, fname } = await downloadToCache();
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: pdfLike ? "application/pdf" : "/", dialogTitle: fname });
        vibrateSuccess();
      } else {
        Alert.alert("Sharing unavailable", "The file is saved to cache instead.");
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
      const { uri, fname } = await downloadToCache();
    if (Platform.OS === "android") {
        const perm = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
        if (!perm.granted) { Alert.alert("Choose a folder to save the file."); return; }
        const fileUri = await FileSystem.StorageAccessFramework.createFileAsync(
          perm.directoryUri, fname, pdfLike ? "application/pdf" : "/"
        );
        const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
        await FileSystem.writeAsStringAsync(fileUri, base64, { encoding: FileSystem.EncodingType.Base64 });
        Alert.alert("Saved", "File saved to selected folder.");
        vibrateSuccess();
      } else {
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(uri, { mimeType: pdfLike ? "application/pdf" : "/", dialogTitle: fname });
        } else {
          Alert.alert("Saved to cache", "Use the Share sheet to move it.");
        }
        vibrateSuccess();
      }
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
      const { uri } = await downloadToCache();
      if (Platform.OS === "android") {
        const contentUri = await FileSystem.getContentUriAsync(uri);
        await IntentLauncher.startActivityAsync("android.intent.action.VIEW", {
          data: contentUri,
          flags: 1,
          type: pdfLike ? "application/pdf" : "/",
        });
      } else if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: pdfLike ? "application/pdf" : "/", dialogTitle: docName });
      } else {
        Alert.alert("Downloaded", "The file was saved to cache.");
      }
      vibrateSuccess();
    } catch (e) {
      vibrateError();
      Alert.alert("Open failed", e?.message ?? "Please try again.");
    } finally {
      setBusy(null);
    }
  };

const goBack = () => {
  vibrateTap();
  if (jobId) {
    router.replace({ pathname: "/jobs/[id]/documents", params: { id: String(jobId) } });
  } else {
    router.back();
  }
};

  return (
    <SafeAreaView style={st.safe} edges={["top", "bottom"]}>
      {/* Header (same style as invoices) */}
      <View style={st.header}>
        <Pressable onPress={goBack} style={st.backBtn} android_ripple={{ color: "rgba(0,0,0,0.06)" }}>
          <ChevronLeft size={18} color={stylesVars.BRAND} />
          <Text style={st.backTxt}>Back</Text>
        </Pressable>
        <View style={{ width: 52 }} />
      </View>

      {/* Viewer card (compact) */}
      <View style={st.viewerCard} onLayout={(e) => setViewerWidth(e.nativeEvent.layout.width)}>
        {(loading || (pdfLike && !viewerHtml)) && (
          <View style={st.loading}>
            <ActivityIndicator />
            <Text style={st.loadingText}>{fatal ? fatal : "Preparing your file…"}</Text>
            {!!fatal && (
              <Pressable
                onPress={() => { vibrateTap(); loadPdfAsBase64(); }}
                style={st.retryBtn}
                android_ripple={{ color: "rgba(255,255,255,0.15)" }}
              >
                <Text style={st.retryText}>Retry</Text>
              </Pressable>
            )}
          </View>
        )}

        {/* If PDF -> html (pdf.js); else -> display URL directly */}
        {pdfLike && !!viewerHtml && !fatal ? (
          <WebView
            ref={wvRef}
            source={{ html: viewerHtml }}
            originWhitelist={["*"]}
            javaScriptEnabled
            domStorageEnabled
            mixedContentMode="always"
            onMessage={(e) => {
              const msg = String(e?.nativeEvent?.data || "");
              if (msg.startsWith("error:")) setFatal(msg.slice(6));
            }}
            style={{ flex: 1 }}
          />
        ) : !pdfLike ? (
          <WebView
            source={{ uri: withBust(docUrl) }}
            originWhitelist={["*"]}
            startInLoadingState
            style={{ flex: 1 }}
          />
        ) : null}
      </View>

      {/* Fixed action bar — identical layout to invoices */}
      <View style={st.actionBar}>
        <ActionButton
          label={busy === "share" ? "Sharing" : "Share"}
          Icon={Share2}
          onPress={onShare}
          disabled={!!busy || !!fatal}
          busy={busy === "share"}
        />
        <ActionButton
          label={busy === "save" ? "Saving" : "Save"}
          Icon={Download}
          onPress={onSave}
          disabled={!!busy || !!fatal}
          busy={busy === "save"}
        />
        <ActionButton
          label={busy === "open" ? "Opening" : "Open"}
          Icon={ExternalLink}
          onPress={onOpenExternally}
          disabled={!!busy || !!fatal}
          busy={busy === "open"}
        />
      </View>

      {/* Spacer so content never hides behind the bottom bar on small screens */}
      <View style={{ height: 62 }} />
    </SafeAreaView>
  );
}

/* ---------------- styles (copied from invoice preview for a perfect match) ---------------- */
const st = StyleSheet.create({
  safe: { flex: 1, backgroundColor: stylesVars.BG },

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
  backTxt: { color: stylesVars.BRAND, fontWeight: "800", fontSize: 16 },

  viewerCard: {
    flex: 1,
    marginHorizontal: 10,
    marginTop: 4,
    marginBottom: 20,
    borderRadius: 12,
    borderWidth: 1.25,
    borderColor: stylesVars.BORDER,
    backgroundColor: stylesVars.CARD,
    overflow: "hidden",
    ...Platform.select({
      ios: {
        shadowColor: "#0b1220",
        shadowOpacity: 0.08,
        shadowRadius: 14,
        shadowOffset: { width: 0, height: 6 },
      },
      android: { elevation: 3 },
    }),
  },

  loading: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    padding: 14,
    gap: 8,
    backgroundColor: stylesVars.CARD,
  },
  loadingText: { color: "#6b7280", textAlign: "center" },
  retryBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: stylesVars.BRAND,
  },
  retryText: { color: "#fff", fontWeight: "800" },

  actionBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 10,
    backgroundColor: stylesVars.CARD,
    borderTopWidth: 1,
    borderColor: stylesVars.BORDER,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    ...Platform.select({
      ios: {
        shadowColor: "#0b1220",
        shadowOpacity: 0.08,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: -4 },
      },
      android: { elevation: 10 },
    }),
  },

  actionBtn: {
    flex: 1,
    minHeight: 46,
    borderRadius: 12,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: stylesVars.BORDER,
    ...Platform.select({
      ios: {
        shadowColor: "#0b1220",
        shadowOpacity: 0.05,
        shadowRadius: 9,
        shadowOffset: { width: 0, height: 3 },
      },
      android: { elevation: 2 },
    }),
  },
  actionPressable: {
    flex: 1,
    paddingVertical: 9,
    paddingHorizontal: 10,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  actionTxt: { color: stylesVars.TEXT, fontWeight: "900" },
  busy: { opacity: 0.6 },
});