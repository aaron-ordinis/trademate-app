// app/(app)/quotes/preview.js
import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator,
  Alert, Platform, Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { WebView } from 'react-native-webview';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as IntentLauncher from 'expo-intent-launcher';
import { supabase } from '../../../lib/supabase';

const safeName = (name) => (name || 'quote.pdf').replace(/[^\w.-]/g, '_');
const withBust = (url) =>
  url ? (url.includes('?') ? `${url}&cb=${Date.now()}` : `${url}?cb=${Date.now()}`) : url;

async function markStatus(quoteId, status) {
  try { if (quoteId) await supabase.from('quotes').update({ status }).eq('id', quoteId); } catch {}
}

/** Minimal HTML viewer: fit-to-width, no zoom, horizontal swipe */
const makePdfHtml = (base64, viewerWidthCSSPx) => `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1"/>
<style>
  :root{
    --viewerW:${Math.max(320, Math.floor(viewerWidthCSSPx))}px;
    --pageW:var(--viewerW);
  }
  html,body{margin:0;padding:0;height:100%;background:#f5f7fb;overflow:hidden;}
  #strip{
    display:flex;height:100%;width:100%;
    overflow-x:auto;overflow-y:hidden;
    scroll-snap-type:x mandatory;-webkit-overflow-scrolling:touch;
    justify-content:center;
  }
  .pageWrap{
    flex:0 0 var(--pageW);height:100%;
    display:flex;align-items:center;justify-content:center;
    scroll-snap-align:center;
  }
  canvas{
    display:block;
    width:calc(var(--pageW) - 16px);
    height:auto;margin:8px;
    border-radius:14px;background:#fff;
    box-shadow:0 2px 12px rgba(11,18,32,.08);
  }
  #strip::-webkit-scrollbar{display:none}
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
    (async()=>{
      for(let i=0;i<canvases.length;i++){
        try{ await renderPage(pdf, i+1, canvases[i]); }catch(e){}
      }
    })();
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
    for(let i=0;i<canvases.length;i++){
      try{ await renderPage(pdf, i+1, canvases[i]); }catch(e){}
    }

    window.ReactNativeWebView && window.ReactNativeWebView.postMessage('rendered');
  }).catch(err=>{
    window.ReactNativeWebView && window.ReactNativeWebView.postMessage('error:'+(err && err.message || err));
  });
})();
</script>
</body>
</html>`;

/* ---------------- React component ---------------- */
export default function Preview() {
  const router = useRouter();
  const wvRef = useRef(null);

  const params = useLocalSearchParams();
  const rawUrl  = Array.isArray(params.url)  ? params.url[0]  : params.url;
  const rawName = Array.isArray(params.name) ? params.name[0] : params.name;
  const rawId   = Array.isArray(params.id)   ? params.id[0]   : params.id;

  const passedPdfUrl  = rawUrl ? decodeURIComponent(String(rawUrl)) : '';
  const pdfName       = safeName(rawName ? String(rawName) : 'quote.pdf');
  const quoteId       = rawId ? String(rawId) : null;

  const [busy, setBusy] = useState(null);
  const [loading, setLoading] = useState(true);
  const [fatal, setFatal] = useState('');
  const [base64Pdf, setBase64Pdf] = useState('');
  const [viewerReady, setViewerReady] = useState(false);
  const [viewerWidth, setViewerWidth] = useState(Dimensions.get('window').width - 24);

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
      setLoading(true); setFatal(''); setViewerReady(false);
      const url = await resolvePdfUrl();
      if (!url) throw new Error('PDF not available yet.');
      const target = FileSystem.cacheDirectory + pdfName;
      const { uri, status } = await FileSystem.downloadAsync(withBust(url), target);
      if (status !== 200) throw new Error(`Download failed (${status})`);
      const b64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
      setBase64Pdf(b64);
      if (quoteId) markStatus(quoteId, 'sent');
    } catch (e) { setFatal(e?.message || 'Could not load PDF.'); }
    finally { setLoading(false); }
  }, [resolvePdfUrl, pdfName, quoteId]);

  useEffect(() => { loadBase64(); }, [loadBase64]);

  async function downloadToCache(srcUrl, name='quote.pdf') {
    if (!srcUrl) throw new Error('No PDF URL');
    const fname = safeName(name);
    const target = FileSystem.cacheDirectory + fname;
    const { uri, status } = await FileSystem.downloadAsync(withBust(srcUrl), target);
    if (status !== 200) throw new Error(`Download failed (${status})`);
    return { uri, fname };
  }

  const onShare = async () => {
    try {
      setBusy('share');
      const url = await resolvePdfUrl();
      const { uri, fname } = await downloadToCache(url, pdfName);
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: fname });
        if (quoteId) markStatus(quoteId, 'sent');
      } else { Alert.alert('Sharing unavailable', 'The PDF is saved to cache instead.'); }
    } catch (e) { Alert.alert('Share failed', e?.message ?? 'Please try again.'); }
    finally { setBusy(null); }
  };

  const onSave = async () => {
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
    try {
      setBusy('open');
      const url = await resolvePdfUrl();
      const { uri } = await downloadToCache(url, pdfName);
      if (Platform.OS === 'android') {
        const contentUri = await FileSystem.getContentUriAsync(uri);
        await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
          data: contentUri, flags: 1, type: 'application/pdf',
        });
      } else if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: pdfName });
      } else { Alert.alert('Downloaded', 'The PDF was saved to cache.'); }
      if (quoteId) markStatus(quoteId, 'sent');
    } catch (e) { Alert.alert('Open failed', e?.message ?? 'Please try again.'); }
    finally { setBusy(null); }
  };

  // EDIT: single-file route — IMPORTANT: no "/index"
  const onEdit = () => {
    if (!quoteId) {
      Alert.alert('Missing quote', 'Go back to the list and open the quote to edit.');
      return;
    }
    router.push({ pathname: '/(app)/quotes/[id]', params: { id: quoteId, mode: 'edit' } });
  };

  const viewerHtml = useMemo(
    () => (base64Pdf ? makePdfHtml(base64Pdf, viewerWidth) : ''),
    [base64Pdf, viewerWidth]
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backTxt}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={styles.title} numberOfLines={1}>
          {pdfName.replace(/\.pdf$/, '')}
        </Text>
        <View style={{ width: 52 }} />
      </View>

      <View
        style={styles.viewerCard}
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
            onMessage={(e) => {
              const msg = String(e?.nativeEvent?.data || '');
              if (msg === 'rendered') setViewerReady(true);
              if (msg.startsWith('error:')) setFatal(msg.slice(6));
            }}
            style={{ flex: 1 }}
          />
        )}
      </View>

      <View style={styles.actionBar}>
        <TouchableOpacity onPress={onShare} disabled={!!busy || !!fatal} style={[styles.actionBtn, busy==='share' && styles.busy]}>
          <Text style={styles.actionTxt}>{busy==='share' ? 'Sharing…' : 'Share'}</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={onEdit} disabled={!!busy} style={[styles.actionBtn, busy && styles.busy]}>
          <Text style={styles.actionTxt}>Edit</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={onSave} disabled={!!busy || !!fatal} style={[styles.actionBtn, busy==='save' && styles.busy]}>
          <Text style={styles.actionTxt}>{busy==='save' ? 'Saving…' : 'Save'}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onOpenExternally} disabled={!!busy || !!fatal} style={[styles.actionBtn, busy==='open' && styles.busy]}>
          <Text style={styles.actionTxt}>{busy==='open' ? 'Opening…' : 'Open'}</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

/* ---------------- styles ---------------- */
const BG = '#f5f7fb';
const CARD = '#ffffff';
const BORDER = '#e6e9ee';
const TEXT = '#0b1220';

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: BG },

  header: {
    height: 52, paddingHorizontal: 12, flexDirection: 'row',
    alignItems: 'center', justifyContent: 'space-between'
  },
  backBtn: { paddingVertical: 6, paddingRight: 8, width: 52 },
  backTxt: { color: '#2a86ff', fontWeight: '800', fontSize: 16 },
  title: { flex: 1, textAlign: 'center', fontWeight: '800', color: TEXT },

  viewerCard: {
    flex: 1,
    marginHorizontal: 12, marginTop: 4, marginBottom: 0,
    borderRadius: 14, borderWidth: 1, borderColor: BORDER,
    backgroundColor: CARD, overflow: 'hidden',
    shadowColor: '#0b1220', shadowOpacity: 0.06, shadowRadius: 12, elevation: 2,
  },

  loading: { ...StyleSheet.absoluteFillObject, alignItems:'center', justifyContent:'center', padding:16, gap:8, backgroundColor: CARD },
  loadingText: { color:'#6b7280', textAlign:'center' },
  retryBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: '#2a86ff' },
  retryText: { color: '#fff', fontWeight: '800' },

  actionBar: {
    flexDirection:'row', alignItems:'center', gap:8,
    paddingHorizontal:12, paddingVertical:10, backgroundColor:CARD,
    borderTopWidth:1, borderColor:BORDER,
  },
  actionBtn: {
    flex:1, minHeight:44,
    borderRadius:12, paddingVertical:12, alignItems:'center',
    backgroundColor:'#fff', borderWidth:1, borderColor:BORDER,
  },
  actionTxt: { color: TEXT, fontWeight:'900' },
  busy: { opacity:0.6 },
});