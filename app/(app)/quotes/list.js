// app/(app)/quotes/list.js
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Platform,
  ToastAndroid,
  Animated,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { supabase } from '../../../lib/supabase';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as IntentLauncher from 'expo-intent-launcher';

// ---- tiny toast ----
function useToast() {
  const [msg, setMsg] = useState('');
  const [visible, setVisible] = useState(false);
  const opacity = useRef(new Animated.Value(0)).current;

  const show = (text) => {
    if (!text) return;
    if (Platform.OS === 'android') {
      ToastAndroid.show(text, ToastAndroid.SHORT);
      return;
    }
    setMsg(text);
    setVisible(true);
    Animated.timing(opacity, { toValue: 1, duration: 150, useNativeDriver: true }).start(() => {
      setTimeout(() => {
        Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: true }).start(() => {
          setVisible(false);
          setMsg('');
        });
      }, 1400);
    });
  };

  const ToastView = () =>
    visible ? (
      <Animated.View style={[styles.toast, { opacity }]}>
        <Text style={styles.toastText}>{msg}</Text>
      </Animated.View>
    ) : null;

  return { show, ToastView };
}

export default function QuotesList() {
  const router = useRouter();
  const { show, ToastView } = useToast();

  const [quotes, setQuotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const userRef = useRef(null);
  const channelRef = useRef(null);

  const fetchQuotes = useCallback(async () => {
    try {
      if (!userRef.current) {
        const { data: { user } } = await supabase.auth.getUser();
        userRef.current = user;
        if (!user) {
          router.replace('/(auth)/login');
          return;
        }
      }
      const { data, error } = await supabase
        .from('quotes')
        .select('id, quote_number, client_name, created_at, status, pdf_url, total')
        .eq('user_id', userRef.current.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setQuotes(data || []);
    } catch (e) {
      console.error('[TMQ][LIST] fetchQuotes error', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [router]);

  useEffect(() => { fetchQuotes(); }, [fetchQuotes]);
  useFocusEffect(useCallback(() => { fetchQuotes(); }, [fetchQuotes]));

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      userRef.current = user;

      if (channelRef.current) { supabase.removeChannel(channelRef.current); channelRef.current = null; }

      channelRef.current = supabase
        .channel('quotes-list-realtime')
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'quotes', filter: `user_id=eq.${user.id}` },
          () => fetchQuotes()
        )
        .subscribe();
    })();

    return () => { if (channelRef.current) supabase.removeChannel(channelRef.current); };
  }, [fetchQuotes]);

  const onRefresh = useCallback(() => { setRefreshing(true); fetchQuotes(); }, [fetchQuotes]);

  // Download to cache (returns local path)
  const downloadToCache = async (url, filename) => {
    const safe = (filename || 'quote.pdf').replace(/[^\w.-]/g, '_');
    const target = FileSystem.cacheDirectory + safe;
    const { uri, status } = await FileSystem.downloadAsync(url, target);
    if (status !== 200) throw new Error(`Download failed with status ${status}`);
    return { uri, safeName: safe };
  };

  // Open PDF (share sheet or intent)
  const openPDF = async (url, filename = 'quote.pdf', idForSpinner = null) => {
    if (!url) return;
    try {
      setBusyId(idForSpinner);
      const { uri, safeName } = await downloadToCache(url, filename);

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: safeName });
        show('PDF ready to share');
        return;
      }

      if (Platform.OS === 'android') {
        const contentUri = await FileSystem.getContentUriAsync(uri);
        await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
          data: contentUri,
          flags: 1,
          type: 'application/pdf',
        });
        show('Opened with PDF app');
        return;
      }

      show('PDF downloaded to cache');
    } catch (e) {
      console.error('[TMQ][LIST] openPDF error', e);
      Alert.alert('Error', e?.message ?? 'Could not open PDF.');
    } finally {
      setBusyId(null);
    }
  };

  // Save to device (Android SAF; iOS uses share sheet)
  const saveToDevice = async (url, filename = 'quote.pdf', idForSpinner = null) => {
    if (!url) return;
    try {
      setBusyId(idForSpinner);
      const { uri, safeName } = await downloadToCache(url, filename);

      if (Platform.OS === 'android') {
        const perm = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
        if (!perm.granted) {
          Alert.alert('Permission needed', 'Please choose a folder to save the PDF.');
          return;
        }
        const fileUri = await FileSystem.StorageAccessFramework.createFileAsync(
          perm.directoryUri,
          safeName,
          'application/pdf'
        );
        const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
        await FileSystem.writeAsStringAsync(fileUri, base64, { encoding: FileSystem.EncodingType.Base64 });
        show('Saved to device');
        return;
      }

      // iOS: share -> Save to Files
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: safeName });
        show('Use “Save to Files”');
      } else {
        show('PDF downloaded to cache');
      }
    } catch (e) {
      console.error('[TMQ][LIST] saveToDevice error', e);
      Alert.alert('Error', e?.message ?? 'Could not save PDF.');
    } finally {
      setBusyId(null);
    }
  };

  const renderItem = ({ item }) => {
    const createdAtDate = new Date(item.created_at);
    const dateStr = `${createdAtDate.toLocaleDateString()} ${createdAtDate.toLocaleTimeString()}`;
    const hasPdf = !!item.pdf_url;
    const isDraft = item.status?.toLowerCase() === 'draft';

    return (
      <View style={styles.card}>
        <View style={styles.row}>
          <Text style={styles.quoteNo}>{item.quote_number || 'QUOTE'}</Text>
          <View style={[styles.badge, { backgroundColor: isDraft ? '#666' : '#2a86ff' }]}>
            <Text style={styles.badgeText}>{isDraft ? 'Draft' : 'Sent'}</Text>
          </View>
        </View>

        <Text style={styles.client}>{item.client_name || 'Client'}</Text>
        <Text style={styles.sub}>{dateStr}</Text>

        {hasPdf ? (
          <View style={styles.btnRow}>
            <TouchableOpacity
              style={[
                styles.btn,
                styles.btnPrimary,
                busyId === `open-${item.id}` && { opacity: 0.6 }
              ]}
              onPress={() => openPDF(item.pdf_url, `${item.quote_number}.pdf`, `open-${item.id}`)}
              disabled={busyId === `open-${item.id}`}
            >
              <Text style={styles.btnText}>
                {busyId === `open-${item.id}` ? 'Opening…' : 'Open PDF'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.btn,
                styles.btnSecondary,
                busyId === `save-${item.id}` && { opacity: 0.6 }
              ]}
              onPress={() => saveToDevice(item.pdf_url, `${item.quote_number}.pdf`, `save-${item.id}`)}
              disabled={busyId === `save-${item.id}`}
            >
              <Text style={styles.btnTextAlt}>{busyId === `save-${item.id}` ? 'Saving…' : 'Save to device'}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <Text style={styles.sub}>No PDF yet {isDraft ? '(draft)' : ''}</Text>
        )}
      </View>
    );
  };

  if (loading) {
    return (
      <View style={styles.loadingWrap}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Quotes</Text>
        <TouchableOpacity style={styles.newBtn} onPress={() => router.push('/(app)/quotes/create')}>
          <Text style={styles.newBtnText}>+ New</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={quotes}
        keyExtractor={(q) => String(q.id)}
        renderItem={renderItem}
        contentContainerStyle={{ padding: 16, paddingBottom: 80 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#999" />}
        ListEmptyComponent={
          <Text style={[styles.sub, { textAlign: 'center', marginTop: 40 }]}>
            No quotes yet. Tap “+ New” to create your first quote.
          </Text>
        }
      />

      {/* Toast lives above bottom content */}
      <ToastView />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#0b0b0c' },
  loadingWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0b0b0c' },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16 },
  title: { color: 'white', fontSize: 24, fontWeight: '700' },
  newBtn: { backgroundColor: '#2a86ff', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10 },
  newBtnText: { color: 'white', fontWeight: '700' },

  card: { backgroundColor: '#1a1a1b', borderRadius: 16, padding: 14, marginBottom: 12 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  quoteNo: { color: 'white', fontWeight: '700', fontSize: 16 },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  badgeText: { color: 'white', fontSize: 12, fontWeight: '700' },
  client: { color: 'white', marginTop: 6, fontSize: 15 },
  sub: { color: '#a9a9ac', marginTop: 2, fontSize: 12 },

  btnRow: { flexDirection: 'row', marginTop: 10 },
  btn: { flex: 1, borderRadius: 12, paddingVertical: 10, alignItems: 'center', marginRight: 8 },
  btnPrimary: { backgroundColor: '#3ecf8e' },
  btnSecondary: { backgroundColor: '#272729', marginRight: 0, borderWidth: 1, borderColor: '#3c3c3f' },
  btnText: { color: '#0b0b0c', fontWeight: '800' },
  btnTextAlt: { color: 'white', fontWeight: '800' },

  toast: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 24,
    backgroundColor: '#222326',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: '#3a3b3f',
  },
  toastText: { color: 'white', textAlign: 'center', fontWeight: '600' },
});