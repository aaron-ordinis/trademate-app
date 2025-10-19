// app/(app)/documents/preview.js
import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator,
  Pressable, Alert, Platform, Dimensions
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { WebView } from "react-native-webview";
import * as FileSystem from "expo-file-system";
import * as Sharing from "expo-sharing";
import * as IntentLauncher from "expo-intent-launcher";
import * as Haptics from "expo-haptics";
import * as NavigationBar from "expo-navigation-bar";
import * as SystemUI from "expo-system-ui";
import { Feather } from "@expo/vector-icons";
import { supabase } from "../../../lib/supabase";
import ReviewAppModal from "../../../components/ReviewAppModal";
import { shouldShowReviewPrompt, launchReviewFlow } from "../../../lib/reviewPrompt";

/* ---- theme ---- */
const BRAND = "#2a86ff";
const TEXT = "#0b1220";
const BORDER = "#e6e9ee";
const CARD = "#ffffff";
const BG = "#f5f7fb";
const BG_HEX = "#f5f7fb";

/* ---- utils ---- */
const safeName = (v) => (v || "document.pdf").replace(/[^\w.-]/g, "_");
const withBust = (u) => (u ? (u.includes("?") ? u + "&cb=" + Date.now() : u + "?cb=" + Date.now()) : u);
const vibrateTap = () => { try { Haptics.selectionAsync(); } catch {} };

/* Clean document name extraction */
const getCleanTitle = (name) => {
  if (!name) return "Document";
  const withoutExt = name.replace(/\.[^/.]+$/, "");
  if (/^\d+$/.test(withoutExt)) {
    return `Document ${withoutExt}`;
  }
  return withoutExt;
};

/* minimal inline PDF.js viewer (matching deposit preview style) */
function makePdfHtml(base64, widthPx) {
  const w = Math.max(320, Math.floor(widthPx || 360));
  const b64 = String(base64 || "").replace(/"/g, '\\"');
  return [
    "<!DOCTYPE html><html><head><meta charset='utf-8'/>",
    "<meta name='viewport' content='width=device-width, initial-scale=1, maximum-scale=1'/>",
    "<style>",
    ":root{--viewerW:", String(w), "px;--pageW:var(--viewerW)}",
    "html,body{margin:0;height:100%;background:#f5f7fb;overflow:hidden}",
    "#strip{display:flex;height:100%;width:100%;overflow-x:auto;overflow-y:hidden;scroll-snap-type:x mandatory;-webkit-overflow-scrolling:touch;justify-content:center}",
    ".pageWrap{flex:0 0 var(--pageW);height:100%;display:flex;align-items:center;justify-content:center;scroll-snap-align:center}",
    "canvas{display:block;width:calc(var(--pageW) - 16px);height:auto;margin:8px;border-radius:14px;background:#fff;box-shadow:0 2px 12px rgba(11,18,32,.08)}",
    "#strip::-webkit-scrollbar{display:none}",
    "</style>",
    "<script src='https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js'></script>",
    "</head><body><div id='strip'></div>",
    "<script>(function(){",
    "var b64=\"", b64, "\";",
    "var pdfjsLib=window.pdfjsLib;",
    "pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';",
    "var DPR=window.devicePixelRatio||1; var strip=document.getElementById('strip');",
    "function renderPage(pdf,n,canvas){",
    "  return pdf.getPage(n).then(function(page){",
    "    var raw=page.getViewport({scale:1});",
    "    var cssW=canvas.clientWidth; var scale=cssW/raw.width; var vp=page.getViewport({scale:scale});",
    "    var ctx=canvas.getContext('2d');",
    "    canvas.width=Math.round(vp.width*DPR); canvas.height=Math.round(vp.height*DPR);",
    "    ctx.setTransform(DPR,0,0,DPR,0,0);",
    "    return page.render({canvasContext:ctx, viewport:vp}).promise;",
    "  });",
    "}",
    "function rerenderAll(pdf){",
    "  var cs=[].slice.call(document.getElementsByTagName('canvas'));",
    "  (function run(i){ if(i>=cs.length) return; renderPage(pdf,i+1,cs[i]).then(function(){ run(i+1); }).catch(function(){ run(i+1); }); })(0);",
    "}",
    "var pdfRef=null; window.addEventListener('resize', function(){ if(pdfRef) rerenderAll(pdfRef); });",
    "var bytes=Uint8Array.from(atob(b64), function(c){ return c.charCodeAt(0); });",
    "pdfjsLib.getDocument({data:bytes}).promise.then(function(pdf){",
    "  pdfRef=pdf; for(var p=1;p<=pdf.numPages;p++){ var wrap=document.createElement('div'); wrap.className='pageWrap'; var c=document.createElement('canvas'); wrap.appendChild(c); strip.appendChild(wrap); }",
    "  if(pdf.numPages>1) strip.style.justifyContent='initial';",
    "  var cs=document.getElementsByTagName('canvas');",
    "  (function run(i){ if(i>=cs.length){ if(window.ReactNativeWebView) window.ReactNativeWebView.postMessage('rendered'); return; }",
    "    renderPage(pdf,i+1,cs[i]).then(function(){ run(i+1); }).catch(function(){ run(i+1); });",
    "  })(0);",
    "}).catch(function(err){ if(window.ReactNativeWebView) window.ReactNativeWebView.postMessage('error:'+(err&&err.message||err)); });",
    "})();</script></body></html>"
  ].join("");
}

export default function DocumentPreview() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const webRef = useRef(null);

  const params = useLocalSearchParams();
  
  // Simple parameter extraction
  const extractParam = (param) => {
    if (!param) return null;
    if (Array.isArray(param)) return param[0];
    if (param === 'undefined' || param === 'null' || param === '') return null;
    return String(param);
  };

  // Check for direct URL first, then document ID
  const directUrl = extractParam(params.url);
  const documentId = extractParam(params.id);
  const documentName = extractParam(params.name) || "document.pdf";
  const jobId = extractParam(params.jobId);
  const fileName = safeName(documentName);

  const [viewerWidth, setViewerWidth] = useState(Dimensions.get("window").width - 24);
  useEffect(() => {
    const sub = Dimensions.addEventListener("change", ({ window }) => {
      setViewerWidth(window.width - 24);
    });
    return () => sub?.remove?.();
  }, []);

  const [loading, setLoading] = useState(true);
  const [fatal, setFatal] = useState("");
  const [busy, setBusy] = useState(null);
  const [cachedUri, setCachedUri] = useState("");
  const [base64Pdf, setBase64Pdf] = useState("");
  const [documentInfo, setDocumentInfo] = useState(null);
  const [showReview, setShowReview] = useState(false);
  const hasAskedRef = useRef(false);

  // Resolve URL from direct URL or database lookup
  const resolveUrl = useCallback(async () => {
    // If we have a direct URL, use it immediately
    if (directUrl) {
      return directUrl;
    }

    // Only try database lookup if no direct URL provided
    if (!documentId) {
      throw new Error("No document URL or ID provided.");
    }

    try {
      const { data: doc, error: docError } = await supabase
        .from("documents")
        .select("*")
        .eq("id", documentId)
        .maybeSingle();

      if (docError) {
        throw new Error(`Database error: ${docError.message}`);
      }

      if (!doc) {
        throw new Error("Document not found");
      }

      if (!doc.url) {
        throw new Error("Document URL is missing");
      }

      setDocumentInfo(doc);
      return doc.url;

    } catch (e) {
      throw e;
    }
  }, [directUrl, documentId]);

  const loadPdf = useCallback(async () => {
    try {
      setLoading(true); setFatal("");
      const url = await resolveUrl();
      if (!url) throw new Error("No PDF available.");
      const target = FileSystem.cacheDirectory + fileName;
      const dl = await FileSystem.downloadAsync(withBust(url), target);
      if (dl.status !== 200) throw new Error("Download failed (" + dl.status + ").");
      setCachedUri(dl.uri);
      const b64 = await FileSystem.readAsStringAsync(dl.uri, { encoding: FileSystem.EncodingType.Base64 });
      setBase64Pdf(b64);
    } catch (e) {
      setFatal(e?.message || "Could not load PDF.");
    } finally {
      setLoading(false);
    }
  }, [resolveUrl, fileName]);

  useEffect(() => { loadPdf(); }, [loadPdf]);

  const shareFile = async () => {
    try {
      setBusy("share");
      if (!cachedUri) throw new Error("No cached file.");
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(cachedUri, { mimeType: "application/pdf", dialogTitle: fileName });
      } else {
        Alert.alert("Sharing unavailable", "File saved to cache.");
      }
    } catch (e) { Alert.alert("Share failed", e?.message || "Please try again."); }
    finally { setBusy(null); }
  };

  const saveFile = async () => {
    try {
      setBusy("save");
      if (!cachedUri) throw new Error("No cached file.");
      if (Platform.OS === "android") {
        const perm = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
        if (!perm.granted) { Alert.alert("Choose a folder to save the PDF."); return; }
        const fileUri = await FileSystem.StorageAccessFramework.createFileAsync(
          perm.directoryUri, fileName, "application/pdf"
        );
        const base64 = await FileSystem.readAsStringAsync(cachedUri, { encoding: FileSystem.EncodingType.Base64 });
        await FileSystem.writeAsStringAsync(fileUri, base64, { encoding: FileSystem.EncodingType.Base64 });
        Alert.alert("Saved", "PDF saved to selected folder.");
      } else {
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(cachedUri, { mimeType: "application/pdf", dialogTitle: fileName });
        } else {
          Alert.alert("Saved to cache", "Use the Share sheet to move it.");
        }
      }
    } catch (e) { Alert.alert("Save failed", e?.message || "Please try again."); }
    finally { setBusy(null); }
  };

  const openExternal = async () => {
    try {
      setBusy("open");
      if (!cachedUri) throw new Error("No cached file.");
      if (Platform.OS === "android") {
        const contentUri = await FileSystem.getContentUriAsync(cachedUri);
        await IntentLauncher.startActivityAsync("android.intent.action.VIEW", {
          data: contentUri, flags: 1, type: "application/pdf",
        });
      } else if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(cachedUri, { mimeType: "application/pdf", dialogTitle: fileName });
      } else {
        Alert.alert("Downloaded", "PDF saved to cache.");
      }
    } catch (e) { Alert.alert("Open failed", e?.message || "Please try again."); }
    finally { setBusy(null); }
  };

  const viewerHtml = useMemo(() => base64Pdf ? makePdfHtml(base64Pdf, viewerWidth) : "", [base64Pdf, viewerWidth]);

  const goBack = () => { 
    vibrateTap(); 
    // Always go back to the main jobs tab to avoid navigation bugs
    router.push("/(tabs)/jobs");
  };

  const displayName = getCleanTitle(documentInfo?.name || documentName);
  const bottomBarH = 64 + Math.max(useSafeAreaInsets().bottom, 10);

  return (
    <SafeAreaView style={styles.safe} edges={["top","bottom"]}>
      <View style={styles.header}>
        <Pressable onPress={goBack} style={styles.backBtn} android_ripple={{ color: "rgba(0,0,0,0.06)" }}>
          <Feather name="chevron-left" size={20} color={BRAND} />
          <Text style={styles.backTxt}>Jobs</Text>
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>{displayName}</Text>
        <View style={{ width: 52 }} />
      </View>

      <View style={[styles.viewerCard, { marginBottom: bottomBarH + 8 }]}
            onLayout={(e) => setViewerWidth(e.nativeEvent.layout.width)}>
        {(loading || !viewerHtml) && (
          <View style={styles.loading}>
            <ActivityIndicator />
            <Text style={styles.loadingText}>{fatal ? fatal : "Loading document…"}</Text>
            {!!fatal && (
              <TouchableOpacity onPress={loadPdf} style={styles.retryBtn}>
                <Text style={styles.retryText}>Retry</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
        {!!viewerHtml && !fatal && (
          <WebView
            ref={webRef}
            source={{ html: viewerHtml }}
            originWhitelist={["*"]}
            javaScriptEnabled
            domStorageEnabled
            onMessage={async (e) => {
              const msg = String(e?.nativeEvent?.data || "");
              if (msg.indexOf("error:") === 0) Alert.alert("Viewer error", msg.slice(6));
              else if (msg === "rendered" && !hasAskedRef.current) {
                hasAskedRef.current = true;
                try {
                  if (await shouldShowReviewPrompt()) setShowReview(true);
                } catch {}
              }
            }}
            style={{ flex: 1 }}
          />
        )}
      </View>

      <View style={[styles.actionBar, { paddingBottom: Math.max(insets.bottom, 10) }]}>
        <ActionBtn label={busy === "share" ? "Sharing" : "Share"} icon="share-2"
                   onPress={shareFile} disabled={!!busy || !!fatal} busy={busy === "share"} />
        <ActionBtn label={busy === "save" ? "Saving" : "Save"} icon="download"
                   onPress={saveFile} disabled={!!busy || !!fatal} busy={busy === "save"} />
        <ActionBtn label={busy === "open" ? "Opening" : "Open"} icon="external-link"
                   onPress={openExternal} disabled={!!busy || !!fatal} busy={busy === "open"} />
      </View>

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

function ActionBtn({ label, icon, onPress, disabled, busy }) {
  return (
    <TouchableOpacity
      disabled={disabled || busy}
      onPress={() => { vibrateTap(); onPress && onPress(); }}
      style={[styles.actionBtn, (disabled || busy) && styles.busy]}
    >
      {busy ? <ActivityIndicator /> : <Feather name={icon} size={18} color={TEXT} />}
      <Text style={styles.actionTxt}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: BG },
  header: {
    height: 52, paddingHorizontal: 12, flexDirection: "row",
    alignItems: "center", justifyContent: "space-between"
  },
  backBtn: { paddingVertical: 6, paddingRight: 8, width: 86, flexDirection: "row", alignItems: "center", gap: 6 },
  backTxt: { color: BRAND, fontWeight: "800", fontSize: 16 },
  title: { color: TEXT, fontWeight: "900" },

  viewerCard: {
    flex: 1, marginHorizontal: 12, marginTop: 4,
    borderRadius: 14, borderWidth: 1, borderColor: BORDER,
    backgroundColor: CARD, overflow: "hidden",
    shadowColor: "#0b1220", shadowOpacity: 0.06, shadowRadius: 12, elevation: 2,
  },

  loading: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center", padding: 16, gap: 8, backgroundColor: CARD },
  loadingText: { color: "#6b7280", textAlign: "center" },
  retryBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: BRAND },
  retryText: { color: "#fff", fontWeight: "800" },

  actionBar: {
    position: "absolute", left: 0, right: 0, bottom: 0,
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: 12, paddingTop: 10, backgroundColor: CARD,
    borderTopWidth: 1, borderColor: BORDER,
  },
  actionBtn: {
    flex: 1, minHeight: 44, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 8,
    alignItems: "center", gap: 6, flexDirection: "row", justifyContent: "center",
    backgroundColor: "#fff", borderWidth: 1, borderColor: BORDER,
  },
    actionTxt: { color: TEXT, fontWeight: "900" },
    busy: { opacity: 0.55 },
  });