// app/(app)/quotes/preview.js
import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Pressable,
  Alert, Platform, Dimensions, ScrollView,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { WebView } from 'react-native-webview';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as IntentLauncher from 'expo-intent-launcher';
import * as Haptics from 'expo-haptics';
import { Feather } from '@expo/vector-icons';
import { supabase } from '../../../lib/supabase';
import ReviewAppModal from '../../../components/ReviewAppModal';
import { shouldShowReviewPrompt, launchReviewFlow } from '../../../lib/reviewPrompt';

const safeName = (name) => (name || 'quote.pdf').replace(/[^\w.-]/g, '_');
const withBust = (url) =>
  url ? (url.includes('?') ? url + '&cb=' + Date.now() : url + '?cb=' + Date.now()) : url;

async function markStatus(quoteId, status) {
  try { if (quoteId) await supabase.from('quotes').update({ status }).eq('id', quoteId); } catch {}
}
const vibrateTap = () => { try { Haptics.selectionAsync(); } catch {} };

/** Match Supabase storage URLs and extract bucket/path */
function parseStorageUrl(url) {
  if (!url) return null;
  const m = url.match(/\/storage\/v1\/object\/(sign|public)\/([^/]+)\/(.+?)(?:\?|$)/);
  return m ? { bucket: m[2], path: decodeURIComponent(m[3]) } : null;
}

/** Minimal HTML viewer (no template literals) */
function makePdfHtml(base64, viewerWidthCSSPx) {
  const viewerW = Math.max(320, Math.floor(viewerWidthCSSPx));
  return [
    '<!DOCTYPE html>',
    '<html><head><meta charset="utf-8"/>',
    '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1"/>',
    '<style>',
    ':root{--viewerW:', String(viewerW), 'px;--pageW:var(--viewerW)}',
    'html,body{margin:0;height:100%;background:#f5f7fb;overflow:hidden}',
    '#strip{display:flex;height:100%;width:100%;overflow-x:auto;overflow-y:hidden;scroll-snap-type:x mandatory;-webkit-overflow-scrolling:touch;justify-content:center}',
    '.pageWrap{flex:0 0 var(--pageW);height:100%;display:flex;align-items:center;justify-content:center;scroll-snap-align:center}',
    // Remove border-radius and box-shadow from canvas
    'canvas{display:block;width:100%;height:auto;margin:0;background:#fff;box-shadow:none}',
    '#strip::-webkit-scrollbar{display:none}',
    '</style>',
    '<script src="https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js"></script></head>',
    '<body><div id="strip"></div>',
    '<script>',
    '(function(){',
    '  const b64="', base64.replace(/"/g, '\\"'), '";',
    '  const pdfjsLib=window.pdfjsLib;',
    '  pdfjsLib.GlobalWorkerOptions.workerSrc="https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";',
    '  const DPR=window.devicePixelRatio||1, strip=document.getElementById("strip");',
    '  async function renderPage(pdf, n, canvas){',
    '    const page=await pdf.getPage(n), raw=page.getViewport({scale:1});',
    '    const cssW=canvas.clientWidth, scale=cssW/raw.width, vp=page.getViewport({scale});',
    '    const ctx=canvas.getContext("2d"); canvas.width=Math.round(vp.width*DPR); canvas.height=Math.round(vp.height*DPR);',
    '    ctx.setTransform(DPR,0,0,DPR,0,0); await page.render({canvasContext:ctx, viewport:vp}).promise;',
    '  }',
    '  function rerenderAll(pdf){ const cs=[...document.getElementsByTagName("canvas")]; (async()=>{ for(let i=0;i<cs.length;i++){ try{ await renderPage(pdf,i+1,cs[i]); }catch(e){} } })(); }',
    '  let pdfRef=null; window.addEventListener("resize", ()=>{ if(pdfRef) rerenderAll(pdfRef); });',
    '  pdfjsLib.getDocument({data:Uint8Array.from(atob(b64),c=>c.charCodeAt(0))}).promise.then(async(pdf)=>{',
    '    pdfRef=pdf; for(let p=1;p<=pdf.numPages;p++){ const wrap=document.createElement("div"); wrap.className="pageWrap"; const c=document.createElement("canvas"); wrap.appendChild(c); strip.appendChild(wrap); }',
    '    if(pdf.numPages>1) strip.style.justifyContent="initial";',
    '    const cs=[...document.getElementsByTagName("canvas")]; for(let i=0;i<cs.length;i++){ try{ await renderPage(pdf,i+1,cs[i]); }catch(e){} }',
    '    window.ReactNativeWebView && window.ReactNativeWebView.postMessage("rendered");',
    '  }).catch(err=>{ window.ReactNativeWebView && window.ReactNativeWebView.postMessage("error:"+(err&&err.message||err)); });',
    '})();',
    '</script></body></html>'
  ].join('');
}

/* ---------------- React component ---------------- */
export default function Preview() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const wvRef = useRef(null);

  const params = useLocalSearchParams();
  const rawUrl  = Array.isArray(params.url)  ? params.url[0]  : params.url;
  const rawName = Array.isArray(params.name) ? params.name[0] : params.name;
  const rawId   = Array.isArray(params.id)   ? params.id[0]   : params.id;
  const isDemo = params.demo === 'true';

  const passedPdfUrl  = rawUrl ? decodeURIComponent(String(rawUrl)) : '';
  const pdfName       = safeName(rawName ? String(rawName) : 'quote.pdf');
  const quoteId       = rawId ? String(rawId) : null;

  const [busy, setBusy] = useState(null);
  const [loading, setLoading] = useState(true);
  const [fatal, setFatal] = useState('');
  const [base64Pdf, setBase64Pdf] = useState('');
  const [viewerWidth, setViewerWidth] = useState(Dimensions.get('window').width - 24);
  const [showReview, setShowReview] = useState(false);
  const hasAskedRef = useRef(false);

  useEffect(() => {
    const sub = Dimensions.addEventListener('change', ({ window }) => {
      setViewerWidth(window.width - 24);
    });
    return () => sub?.remove?.();
  }, []);

  const resolvePdfUrl = useCallback(async () => {
    if (passedPdfUrl) return passedPdfUrl;
    if (!quoteId) return '';
    const { data, error } = await supabase.from('quotes').select('pdf_url').eq('id', quoteId).maybeSingle();
    if (error) throw error;
    return data?.pdf_url || '';
  }, [passedPdfUrl, quoteId]);

  const loadBase64 = useCallback(async () => {
    try {
      setLoading(true); setFatal('');
      const url = await resolvePdfUrl();
      if (!url) throw new Error('PDF not available yet.');
      const target = FileSystem.cacheDirectory + pdfName;
      const { uri, status } = await FileSystem.downloadAsync(withBust(url), target);
      if (status !== 200) throw new Error('Download failed (' + status + ')');
      const b64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
      setBase64Pdf(b64);
      if (quoteId) markStatus(quoteId, 'sent');
    } catch (e) { setFatal(e?.message || 'Could not load PDF.'); }
    finally { setLoading(false); }
  }, [resolvePdfUrl, pdfName, quoteId]);

  useEffect(() => { loadBase64(); }, [loadBase64]);

  async function downloadToCache(srcUrl, name) {
    if (!srcUrl) throw new Error('No PDF URL');
    const fname = safeName(name || 'quote.pdf');
    const target = FileSystem.cacheDirectory + fname;
    const { uri, status } = await FileSystem.downloadAsync(withBust(srcUrl), target);
    if (status !== 200) throw new Error('Download failed (' + status + ')');
    return { uri, fname };
  }

  const onShare = async () => {
    if (isDemo) { Alert.alert('Demo Mode', 'Sharing is disabled in demo mode.', [{ text: 'OK' }]); return; }
    try {
      setBusy('share');
      const url = await resolvePdfUrl();
      const { uri, fname } = await downloadToCache(url, pdfName);
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: fname });
        if (quoteId) markStatus(quoteId, 'sent');
      } else { Alert.alert('Sharing unavailable', 'Saved to cache instead.'); }
    } catch (e) { Alert.alert('Share failed', e?.message ?? 'Please try again.'); }
    finally { setBusy(null); }
  };

  const onSave = async () => {
    if (isDemo) { Alert.alert('Demo Mode', 'Saving is disabled in demo mode.', [{ text: 'OK' }]); return; }
    try {
      setBusy('save');
      const url = await resolvePdfUrl();
      const { uri, fname } = await downloadToCache(url, pdfName);
      if (Platform.OS === 'android') {
        const perm = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
        if (!perm.granted) { Alert.alert('Choose a folder to save the PDF.'); return; }
        const fileUri = await FileSystem.StorageAccessFramework.createFileAsync(perm.directoryUri, fname, 'application/pdf');
        const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
        await FileSystem.writeAsStringAsync(fileUri, base64, { encoding: FileSystem.EncodingType.Base64 });
        Alert.alert('Saved', 'PDF saved to selected folder.');
      } else {
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: fname });
        } else { Alert.alert('Saved to cache', 'Use the Share sheet to move it to Files.'); }
      }
      if (quoteId) markStatus(quoteId, 'sent');
    } catch (e) { Alert.alert('Save failed', e?.message ?? 'Please try again.'); }
    finally { setBusy(null); }
  };

  const onOpenExternally = async () => {
    if (isDemo) { Alert.alert('Demo Mode', 'External sharing is disabled in demo mode.', [{ text: 'OK' }]); return; }
    try {
      setBusy('open');
      const url = await resolvePdfUrl();
      const { uri } = await downloadToCache(url, pdfName);
      if (Platform.OS === 'android') {
        const contentUri = await FileSystem.getContentUriAsync(uri);
        await IntentLauncher.startActivityAsync('android.intent.action.VIEW', { data: contentUri, flags: 1, type: 'application/pdf' });
      } else if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: pdfName });
      } else {
        Alert.alert('Downloaded', 'The PDF was saved to cache.');
      }
      if (quoteId) markStatus(quoteId, 'sent');
    } catch (e) { Alert.alert('Open failed', e?.message ?? 'Please try again.'); }
    finally { setBusy(null); }
  };

  // Robust Edit: try passed id; if missing, resolve it by matching pdf_url path
  const onEdit = useCallback(async () => {
    vibrateTap();

    try {
      setBusy('edit');

      let idToUse = quoteId;

      if (!idToUse) {
        const url = await resolvePdfUrl();
        const parsed = parseStorageUrl(url);
        if (parsed?.path) {
          const { data: row } = await supabase
            .from('quotes')
            .select('*')
            .ilike('pdf_url', `%${parsed.path}%`)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          if (row?.id) idToUse = row.id;
        }
      }

      if (!idToUse) {
        Alert.alert('Missing quote', 'Go back to the list and open the quote to edit.');
        return;
      }

      const { data, error } = await supabase
        .from('quotes')
        .select('*')
        .eq('id', idToUse)
        .single();

      if (error || !data) throw error || new Error('Quote not found');

      router.push({
        pathname: '/(app)/quotes/[id]',
        params: {
          id: idToUse,
          mode: 'edit',
          q: encodeURIComponent(JSON.stringify(data)),
        },
      });
    } catch (e) {
      Alert.alert('Missing quote', 'Go back to the list and open the quote to edit.');
    } finally {
      setBusy(null);
    }
  }, [quoteId, router, resolvePdfUrl]);

  const viewerHtml = useMemo(
    () => (base64Pdf ? makePdfHtml(base64Pdf, viewerWidth) : ''),
    [base64Pdf, viewerWidth]
  );

  // Remove goBack text, use only icon
  const goBack = () => {
    vibrateTap();
    if (isDemo) router.replace('/(auth)/register');
    else router.replace('/(app)/quotes');
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      {/* Top safe area spacer */}
      <View style={{ height: insets.top, backgroundColor: CARD }} />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={goBack}>
          <Feather name="arrow-left" size={20} color={TEXT} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Quote PDF</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView style={styles.content} contentContainerStyle={styles.contentContainer}>
        <View
          style={[styles.viewerCard]}
          onLayout={(e) => setViewerWidth(e.nativeEvent.layout.width)}
        >
          {(loading || !viewerHtml) && (
            <View style={styles.loading}>
              <ActivityIndicator />
              <Text style={styles.loadingText}>{fatal ? fatal : 'Preparing your PDF…'}</Text>
              {!!fatal && (
                <TouchableOpacity onPress={loadBase64} style={styles.retryBtn}>
                  <Text style={styles.retryText}>Retry</Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          {!!viewerHtml && !fatal && (
            <WebView
              ref={wvRef}
              source={{ html: viewerHtml }}
              originWhitelist={['*']}
              javaScriptEnabled
              domStorageEnabled
              onMessage={async (e) => {
                const msg = String(e?.nativeEvent?.data || '');
                if (msg === 'rendered' && !hasAskedRef.current) {
                  hasAskedRef.current = true;
                  try {
                    if (await shouldShowReviewPrompt()) setShowReview(true);
                  } catch {}
                }
                if (msg.startsWith('error:')) setFatal(msg.slice(6));
              }}
              style={{ flex: 1 }}
            />
          )}
        </View>

        <ReviewAppModal
          visible={showReview}
          onLater={() => setShowReview(false)}
          onRateNow={async () => {
            setShowReview(false);
            await launchReviewFlow();
          }}
        />
        <View style={{ height: 20 }} />
      </ScrollView>

      {/* Bottom action bar (absolute) */}
      <View style={[styles.actionBar, { paddingBottom: Math.max(insets.bottom, 10) }]}>
        <ActionButton
          label={busy === 'edit' ? 'Loading' : 'Edit'}
          icon="edit-3"
          onPress={onEdit}
          disabled={!!busy || !!fatal}
          busy={busy === 'edit'}
        />
        <ActionButton
          label={isDemo ? 'Locked' : (busy === 'share' ? 'Sharing' : 'Share')}
          icon="share-2"
          onPress={onShare}
          disabled={isDemo || !!busy || !!fatal}
          busy={!isDemo && busy === 'share'}
        />
        <ActionButton
          label={isDemo ? 'Locked' : (busy === 'save' ? 'Saving' : 'Save')}
          icon="download"
          onPress={onSave}
          disabled={isDemo || !!busy || !!fatal}
          busy={!isDemo && busy === 'save'}
        />
        <ActionButton
          label={isDemo ? 'Locked' : (busy === 'open' ? 'Opening' : 'Open')}
          icon="external-link"
          onPress={onOpenExternally}
          disabled={isDemo || !!busy || !!fatal}
          busy={!isDemo && busy === 'open'}
        />
      </View>
    </SafeAreaView>
  );
}

/* ---------------- Action button ---------------- */
function ActionButton({ label, icon, onPress, disabled, busy }) {
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

/* ---------------- styles ---------------- */
const BG = '#f5f7fb';
const CARD = '#ffffff';
const BORDER = '#e6e9ee';
const TEXT = '#0b1220';
const BRAND = '#2a86ff';

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: BG },
  header: {
    backgroundColor: CARD,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "900",
    color: TEXT,
    flex: 1,
    textAlign: "center",
    marginHorizontal: 16,
  },
  content: { flex: 1 },
  contentContainer: { padding: 16 },
  viewerCard: {
    // Remove borderRadius, border, and shadow for full-bleed effect
    // borderRadius: 14,
    // borderWidth: 1,
    // borderColor: BORDER,
    // ...Platform.select({ ... }),
    backgroundColor: CARD,
    overflow: 'hidden',
    marginBottom: 0,
    marginHorizontal: -16, // expand to screen edge (matches contentContainer padding)
    minHeight: 540,
  },
  loading: { ...StyleSheet.absoluteFillObject, alignItems:'center', justifyContent:'center', padding:16, gap:8, backgroundColor: CARD },
  loadingText: { color:'#6b7280', textAlign:'center' },
  retryBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: BRAND },m: 0,
  retryText: { color: '#fff', fontWeight: '800' },ion:'row', alignItems:'center', gap:8,
  actionBar: {r:CARD,
    position: 'absolute', left: 0, right: 0, bottom: 0,
    flexDirection:'row', alignItems:'center', gap:8,
    paddingHorizontal:12, paddingTop:10, backgroundColor:CARD,
    borderTopWidth:1, borderColor:BORDER,
    borderRadius: 12,flex:1, minHeight:44,
  },us:12, paddingVertical:10, paddingHorizontal:8,
  actionBtn: {gap:6, flexDirection:'row', justifyContent:'center',
    flex:1, minHeight:44,
    borderRadius:12, paddingVertical:10, paddingHorizontal:8,
    alignItems:'center', gap:6, flexDirection:'row', justifyContent:'center',
    backgroundColor:'#fff', borderWidth:1, borderColor:BORDER,sy: { opacity:0.55 },
  },  actionTxt: { color: TEXT, fontWeight:'900' },  busy: { opacity:0.55 },
});