// app/(app)/quotes/preview.js
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { WebView } from 'react-native-webview';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as IntentLauncher from 'expo-intent-launcher';
import { supabase } from '../../../lib/supabase';

const safeName = (name) => (name || 'quote.pdf').replace(/[^\w.-]/g, '_');

// ---------- reachability helpers ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function withBust(url) {
  const bust = `cb=${Date.now()}&r=${Math.random().toString(36).slice(2)}`;
  return url.includes('?') ? `${url}&${bust}` : `${url}?${bust}`;
}

async function probeOnce(url) {
  const u = withBust(url);

  try {
    // 1) HEAD
    let res = await fetch(u, { method: 'HEAD' });
    if (res.ok || res.status === 206 || res.status === 304) return true;

    // 2) Range GET
    res = await fetch(u, { method: 'GET', headers: { Range: 'bytes=0-1' } });
    if (res.status === 200 || res.status === 206 || res.status === 304) return true;

    // 3) Normal GET
    res = await fetch(u, { method: 'GET' });
    if (res.ok) return true;
  } catch {
    // ignore
  }
  return false;
}

async function waitForReachable(url, { tries = 12, baseDelay = 250, step = 200, maxDelay = 1200 } = {}) {
  for (let i = 0; i < tries; i++) {
    const ok = await probeOnce(url);
    if (ok) return true;
    const delay = Math.min(baseDelay + i * step, maxDelay);
    await sleep(delay);
  }
  return false;
}

// Try to refresh a possibly stale signed URL from DB (best-effort)
async function refreshSignedUrl(quoteId) {
  try {
    if (!quoteId) return null;
    const { data, error } = await supabase
      .from('quotes')
      .select('pdf_url')
      .eq('id', quoteId)
      .maybeSingle();
    if (error) throw error;
    return data?.pdf_url || null;
  } catch {
    return null;
  }
}

// Mark status helper (best-effort, non-fatal)
async function markStatus(quoteId, status) {
  try {
    if (!quoteId) return;
    await supabase.from('quotes').update({ status }).eq('id', quoteId);
  } catch {
    // swallow
  }
}

// ---------- component ----------
export default function Preview() {
  const router = useRouter();

  // Read and decode params safely (handles array shape too)
  const params = useLocalSearchParams();
  const rawUrl  = Array.isArray(params.url)  ? params.url[0]  : params.url;
  const rawName = Array.isArray(params.name) ? params.name[0] : params.name;
  const rawId   = Array.isArray(params.id)   ? params.id[0]   : params.id;

  const initialPdfUrl  = rawUrl ? decodeURIComponent(String(rawUrl)) : '';
  const pdfName = rawName ? String(rawName) : 'quote.pdf';
  const quoteId = rawId ? String(rawId) : null;

  const [busy, setBusy] = useState(null);
  const [urlReady, setUrlReady] = useState(false);
  const [wvLoaded, setWvLoaded] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [fatalFail, setFatalFail] = useState(false);

  const [isPremium, setIsPremium] = useState(false);
  const [tierLoading, setTierLoading] = useState(true);

  // The effective URL we actually use (might be refreshed)
  const [effectiveUrl, setEffectiveUrl] = useState(initialPdfUrl);

  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  // Reset effective URL if incoming param changes
  useEffect(() => {
    setEffectiveUrl(initialPdfUrl);
  }, [initialPdfUrl]);

  // Load user tier (Premium vs Free)
  useEffect(() => {
    (async () => {
      setTierLoading(true);
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) { setIsPremium(false); return; }
        const { data, error } = await supabase
          .from('profiles')
          .select('branding, tier')
          .eq('id', user.id)
          .maybeSingle();
        if (error) throw error;
        const branding = String(data?.branding || '').toLowerCase();
        const tier = String(data?.tier || '').toLowerCase();
        setIsPremium(branding === 'premium' || tier === 'premium');
      } catch {
        setIsPremium(false);
      } finally {
        setTierLoading(false);
      }
    })();
  }, []);

  // Probe the remote PDF until it’s definitely reachable
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setFatalFail(false);
      setWvLoaded(false);
      setUrlReady(false);
      setAttempt(0);

      if (!effectiveUrl) return;

      let targetUrl = effectiveUrl;
      let ok = await waitForReachable(targetUrl, {
        tries: 14,
        baseDelay: 250,
        step: 250,
        maxDelay: 1500,
      });

      // If the signed URL is stale/unreachable, try to refresh from DB once
      if (!ok && quoteId) {
        const fresh = await refreshSignedUrl(quoteId);
        if (fresh) {
          targetUrl = fresh;
          setEffectiveUrl(fresh);
          ok = await waitForReachable(targetUrl, {
            tries: 6,
            baseDelay: 300,
            step: 250,
            maxDelay: 1500,
          });
        }
      }

      if (!cancelled && mountedRef.current) setUrlReady(ok);
      if (!ok && !cancelled && mountedRef.current) {
        Alert.alert('Still preparing PDF', 'The file is uploading. One moment, then tap Retry.');
      }
    })();
    return () => { cancelled = true; };
  }, [effectiveUrl, quoteId]);

  // Build viewer URL only once the URL is reachable; add cache-buster + attempt
  const viewerUri = useMemo(() => {
    if (!effectiveUrl || !urlReady) return '';
    const v = `${Date.now()}-${attempt}`;
    return `https://drive.google.com/viewerng/viewer?embedded=true&url=${encodeURIComponent(effectiveUrl)}&v=${v}`;
  }, [effectiveUrl, urlReady, attempt]);

  const handleRetry = async () => {
    setFatalFail(false);
    setWvLoaded(false);
    const src = effectiveUrl || initialPdfUrl;
    const ok = await waitForReachable(src, { tries: 8, baseDelay: 300, step: 250, maxDelay: 1500 });
    if (mountedRef.current) {
      setUrlReady(ok);
      setAttempt((a) => a + 1);
    }
    if (!ok) {
      // Try to refresh once more on explicit retry
      if (quoteId) {
        const fresh = await refreshSignedUrl(quoteId);
        if (fresh) {
          setEffectiveUrl(fresh);
        } else {
          Alert.alert('Still preparing', 'The PDF is almost ready. Try again in a few seconds.');
        }
      } else {
        Alert.alert('Still preparing', 'The PDF is almost ready. Try again in a few seconds.');
      }
    }
  };

  const downloadToCache = async () => {
    const src = effectiveUrl || initialPdfUrl;
    if (!src) throw new Error('No PDF URL');
    const fname = safeName(pdfName);
    const target = FileSystem.cacheDirectory + fname;
    const { uri, status } = await FileSystem.downloadAsync(withBust(src), target);
    if (status !== 200) throw new Error(`Download failed with status ${status}`);
    return { uri, fname };
  };

  const onShare = async () => {
    try {
      setBusy('share');
      const { uri, fname } = await downloadToCache();
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: fname });
        if (quoteId) markStatus(quoteId, 'sent');
      } else {
        Alert.alert('Sharing unavailable', 'The file was downloaded to cache instead.');
      }
    } catch (e) {
      Alert.alert('Error', e?.message ?? 'Could not share PDF.');
    } finally {
      setBusy(null);
    }
  };

  const onSave = async () => {
    try {
      setBusy('save');
      const { uri, fname } = await downloadToCache();
      if (Platform.OS === 'android') {
        const perm = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
        if (!perm.granted) {
          Alert.alert('Permission needed', 'Please choose a folder to save the PDF.');
          return;
        }
        const fileUri = await FileSystem.StorageAccessFramework.createFileAsync(
          perm.directoryUri,
          fname,
          'application/pdf'
        );
        const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
        await FileSystem.writeAsStringAsync(fileUri, base64, { encoding: FileSystem.EncodingType.Base64 });
        Alert.alert('Saved', 'PDF saved to selected folder.');
        if (quoteId) markStatus(quoteId, 'sent');
        return;
      }
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: fname });
        if (quoteId) markStatus(quoteId, 'sent');
      } else {
        Alert.alert('Saved to cache', 'Use the share sheet to move it to Files.');
      }
    } catch (e) {
      Alert.alert('Error', e?.message ?? 'Could not save PDF.');
    } finally {
      setBusy(null);
    }
  };

  const onOpenExternally = async () => {
    try {
      setBusy('open');
      const { uri } = await downloadToCache();
      if (Platform.OS === 'android') {
        const contentUri = await FileSystem.getContentUriAsync(uri);
        await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
          data: contentUri,
          flags: 1,
          type: 'application/pdf',
        });
        if (quoteId) markStatus(quoteId, 'sent');
      } else if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: pdfName });
        if (quoteId) markStatus(quoteId, 'sent');
      } else {
        Alert.alert('Downloaded', 'The PDF was saved to cache.');
      }
    } catch (e) {
      Alert.alert('Error', e?.message ?? 'Could not open the PDF.');
    } finally {
      setBusy(null);
    }
  };

  const onEdit = () => {
    if (!quoteId) {
      Alert.alert('No quote id', 'Return to the list and open this quote to edit.');
      return;
    }
    if (!isPremium) {
      router.push('/(app)/settings/upgrade');
      return;
    }
    router.push({ pathname: '/(app)/quotes/[id]', params: { id: quoteId } });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.wrap}>
        <View style={styles.topBar}>
          <TouchableOpacity onPress={() => router.back()} style={styles.topBtn}>
            <Text style={styles.topBtnText}>‹ Back</Text>
          </TouchableOpacity>
          <Text style={styles.title} numberOfLines={1}>{pdfName || 'Quote'}</Text>
          <View style={{ width: 60 }} />
        </View>

        <View style={styles.viewerWrap}>
          {!urlReady && !fatalFail && (
            <View style={styles.loading}>
              <ActivityIndicator />
              <Text style={styles.loadingText}>Preparing your PDF…</Text>
              <TouchableOpacity onPress={handleRetry} style={styles.retryBtn}>
                <Text style={styles.retryText}>Retry</Text>
              </TouchableOpacity>
            </View>
          )}

          {urlReady && (
            <>
              {!wvLoaded && (
                <View style={styles.loading}>
                  <ActivityIndicator />
                </View>
              )}
              <WebView
                key={attempt /* force reload on retry */}
                source={{ uri: viewerUri }}
                originWhitelist={['*']}
                startInLoadingState={false}
                cacheEnabled={false}
                javaScriptEnabled
                onLoadEnd={async () => {
                  setWvLoaded(true);

                  // ✅ ALSO mark quote as 'sent' via your RPC, once it's viewable
                  try {
                    if (quoteId) {
                      const { data: { user } } = await supabase.auth.getUser();
                      const userId = user?.id;
                      if (userId) {
                        await supabase.rpc('set_quote_status', {
                          p_user: userId,
                          p_quote_number: pdfName.replace(/\.pdf$/, ''),
                          p_status: 'sent',
                        });
                      }
                    }
                  } catch (e) {
                    console.log('[Preview] set_quote_status RPC failed:', e?.message || e);
                  }
                }}
                onError={() => {
                  if (attempt < 3) {
                    setAttempt((a) => a + 1);
                    setWvLoaded(false);
                  } else {
                    setFatalFail(true);
                    Alert.alert('Preview error', 'Failed to load PDF. Tap Retry or Open with app.');
                  }
                }}
                style={{ flex: 1, opacity: wvLoaded ? 1 : 0.01 }}
              />
              {fatalFail && (
                <View style={[styles.loading, { backgroundColor: 'transparent' }]}>
                  <TouchableOpacity onPress={handleRetry} style={styles.retryBtn}>
                    <Text style={styles.retryText}>Retry</Text>
                  </TouchableOpacity>
                </View>
              )}
            </>
          )}
        </View>

        <View style={styles.actions}>
          <TouchableOpacity
            onPress={onShare}
            style={[styles.btn, styles.primary, busy === 'share' && styles.busy]}
            disabled={!!busy}
          >
            <Text style={styles.btnText}>{busy === 'share' ? 'Sharing…' : 'Share'}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={onSave}
            style={[styles.btn, styles.secondary, busy === 'save' && styles.busy]}
            disabled={!!busy}
          >
            <Text style={styles.btnTextAlt}>{busy === 'save' ? 'Saving…' : 'Save to device'}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={onOpenExternally}
            style={[styles.btn, styles.secondary, busy === 'open' && styles.busy]}
            disabled={!!busy}
          >
            <Text style={styles.btnTextAlt}>{busy === 'open' ? 'Opening…' : 'Open with app'}</Text>
          </TouchableOpacity>

          {/* Edit button: premium-only and only if we know the quote id */}
          {!tierLoading && quoteId && (
            <TouchableOpacity
              onPress={onEdit}
              style={[
                styles.btn,
                isPremium ? styles.editBtn : styles.lockedBtn,
              ]}
            >
              <Text style={isPremium ? styles.editText : styles.lockedText}>
                {isPremium ? 'Edit prices' : 'Unlock editing (Premium)'}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0b0b0c' },
  wrap: { flex: 1, backgroundColor: '#0b0b0c' },

  topBar: {
    height: 50,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
  },
  topBtn: { paddingVertical: 6, paddingHorizontal: 8 },
  topBtnText: { color: '#3ecf8e', fontWeight: '700', fontSize: 16 },
  title: {
    color: 'white',
    fontWeight: '700',
    fontSize: 16,
    maxWidth: '70%',
    textAlign: 'center',
  },

  viewerWrap: {
    flex: 1,
    marginHorizontal: 8,
    marginTop: 4,
    marginBottom: 8,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#111',
  },
  loading: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  loadingText: { color: '#cfcfd2', marginTop: 10 },
  retryBtn: {
    marginTop: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#2a86ff',
  },
  retryText: { color: 'white', fontWeight: '700' },

  actions: { padding: 12, gap: 8 },
  btn: { borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  primary: { backgroundColor: '#3ecf8e' },
  secondary: { backgroundColor: '#272729', borderWidth: 1, borderColor: '#3c3c3f' },
  btnText: { color: '#0b0b0c', fontWeight: '800' },
  btnTextAlt: { color: 'white', fontWeight: '800' },
  busy: { opacity: 0.6 },

  editBtn: { backgroundColor: '#2a86ff' },
  lockedBtn: { backgroundColor: '#2a2b2f', borderWidth: 1, borderColor: '#3a3b40' },
  editText: { color: 'white', fontWeight: '800' },
  lockedText: { color: 'white', fontWeight: '800' },
});