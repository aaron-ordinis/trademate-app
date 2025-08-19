// app/(app)/quotes/list.js
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, RefreshControl, StyleSheet,
  ActivityIndicator, Alert, Platform, ToastAndroid, Animated,
  LayoutAnimation, UIManager, TextInput,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../../../lib/supabase';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as IntentLauncher from 'expo-intent-launcher';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

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

// ---------- helpers ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function probeUrl(url) {
  const bust = `cb=${Date.now()}&r=${Math.random().toString(36).slice(2)}`;
  const u = url?.includes('?') ? url + '&' + bust : url + '?' + bust;
  try {
    let res = await fetch(u, { method: 'HEAD' });
    if (res.ok || res.status === 206 || res.status === 304) return true;
    res = await fetch(u, { method: 'GET', headers: { Range: 'bytes=0-1' } });
    if (res.status === 200 || res.status === 206 || res.status === 304) return true;
    res = await fetch(u, { method: 'GET' });
    return res.ok;
  } catch { return false; }
}
async function pollSignedUrlReady(
  path,
  { tries = 40, baseDelay = 250, step = 250, maxDelay = 1200, signedUrlTtl = 60 * 60 * 24 * 7 } = {}
) {
  const storage = supabase.storage.from('quotes');
  for (let i = 0; i < tries; i++) {
    const { data, error } = await storage.createSignedUrl(path, signedUrlTtl);
    const url = data?.signedUrl;
    if (!error && url) {
      const ok = await probeUrl(url);
      if (ok) return url;
    }
    const delay = Math.min(baseDelay + i * step, maxDelay);
    await sleep(delay);
  }
  return null;
}

const gbp = (v) => typeof v === 'number' ? `£${v.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}` : '£0.00';
const statusStyle = (status) => {
  const s = String(status || '').toLowerCase();
  if (s === 'draft') return { bg: '#6b7280' };
  if (s === 'generated' || s === 'sent' || s === 'accepted') return { bg: '#3ecf8e' };
  return { bg: '#3ecf8e' };
};

export default function QuotesList() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { show, ToastView } = useToast();

  const [quotes, setQuotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [isPremium, setIsPremium] = useState(false);
  const [expandedId, setExpandedId] = useState(null);

  // Search / Filter / Sort
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all'); // 'all' | 'draft' | 'generated' | 'sent' | 'accepted'
  const [sortBy, setSortBy] = useState('newest');          // 'newest' | 'oldest' | 'totalAsc' | 'totalDesc'

  const userRef = useRef(null);
  const channelRef = useRef(null);

  const fetchBranding = useCallback(async (userId) => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('branding')
        .eq('id', userId)
        .single();
      if (!error && data?.branding) setIsPremium(String(data.branding).toLowerCase() === 'premium');
      else setIsPremium(false);
    } catch {
      setIsPremium(false);
    }
  }, []);

  const fetchQuotes = useCallback(async () => {
    try {
      if (!userRef.current) {
        const { data: { user } } = await supabase.auth.getUser();
        userRef.current = user;
        if (!user) {
          router.replace('/(auth)/login'); // fixed path
          return;
        }
        fetchBranding(user.id);
      }
      const { data, error } = await supabase
        .from('quotes')
        .select('id, user_id, quote_number, client_name, created_at, status, pdf_url, total, client_email, client_phone, client_address, site_address, job_summary, job_details, line_items, subtotal, vat_amount')
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
  }, [router, fetchBranding]);

  useEffect(() => { fetchQuotes(); }, [fetchQuotes]);
  useFocusEffect(useCallback(() => { fetchQuotes(); }, [fetchQuotes]));

  // 🔁 Refetch branding when we come back to this screen (e.g., after Stripe)
  useFocusEffect(
    useCallback(() => {
      (async () => {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) await fetchBranding(user.id);
      })();
    }, [fetchBranding])
  );

  // 🔔 Realtime: watch profile branding for this user and update immediately
  useEffect(() => {
    let profileChannel;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      profileChannel = supabase
        .channel('profiles-premium-watch')
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'profiles', filter: `id=eq.${user.id}` },
          (payload) => {
            const branding = (payload.new?.branding ?? payload.old?.branding) || 'free';
            setIsPremium(String(branding).toLowerCase() === 'premium');
          }
        )
        .subscribe();
    })();

    return () => { if (profileChannel) supabase.removeChannel(profileChannel); };
  }, []);

  // Existing quotes realtime subscription
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      userRef.current = user;

      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }

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

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchQuotes();
  }, [fetchQuotes]);

  // ---------- file helpers ----------
  const downloadToCache = async (url, filename) => {
    const safe = (filename || 'quote.pdf').replace(/[^\w.-]/g, '_');
    const target = FileSystem.cacheDirectory + safe;
    const { uri, status } = await FileSystem.downloadAsync(url, target);
    if (status !== 200) throw new Error(`Download failed with status ${status}`);
    return { uri, safeName: safe };
  };

  const ensureReadyUrl = async (maybeUrl, quote) => {
    if (maybeUrl) {
      const ok = await probeUrl(maybeUrl);
      if (ok) return maybeUrl;
    }
    if (userRef.current && quote?.quote_number) {
      const path = `${userRef.current.id}/${quote.quote_number}.pdf`;
      const ready = await pollSignedUrlReady(path);
      if (ready) return ready;
    }
    return null;
  };

  // ---------- actions ----------
  const previewPDF = async (url, filename = 'quote.pdf', idForSpinner = null, quote = null) => {
    try {
      setBusyId(idForSpinner);
      const readyUrl = await ensureReadyUrl(url, quote);
      if (!readyUrl) {
        Alert.alert('No PDF yet', 'This quote has no ready PDF. Do you want to finish it now?',
          [{ text: 'Not now', style: 'cancel' }, { text: 'Finish quote', onPress: () => router.push({ pathname: '/quotes/create', params: { quoteId: quote?.id } }) }]);
        return;
      }
      router.push({ pathname: '/quotes/preview', params: { url: encodeURIComponent(readyUrl), name: filename, id: quote.id } });
    } catch (e) {
      console.error('[TMQ][LIST] previewPDF error', e);
      Alert.alert('Error', e?.message ?? 'Could not preview PDF.');
    } finally {
      setBusyId(null);
    }
  };

  const openPDF = async (url, filename = 'quote.pdf', idForSpinner = null, quote = null) => {
    try {
      setBusyId(idForSpinner);
      const readyUrl = await ensureReadyUrl(url, quote);
      if (!readyUrl) return Alert.alert('No PDF yet', 'Please generate the PDF first.');
      const { uri, safeName } = await downloadToCache(readyUrl, filename);

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: safeName });
        show('PDF ready to share');
        return;
      }
      if (Platform.OS === 'android') {
        const contentUri = await FileSystem.getContentUriAsync(uri);
        await IntentLauncher.startActivityAsync('android.intent.action.VIEW', { data: contentUri, flags: 1, type: 'application/pdf' });
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

  const saveToDevice = async (url, filename = 'quote.pdf', idForSpinner = null, quote = null) => {
    try {
      setBusyId(idForSpinner);
      const readyUrl = await ensureReadyUrl(url, quote);
      if (!readyUrl) return Alert.alert('No PDF yet', 'Please generate the PDF first.');
      const { uri, safeName } = await downloadToCache(readyUrl, filename);

      if (Platform.OS === 'android') {
        const perm = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
        if (!perm.granted) {
          Alert.alert('Permission needed', 'Please choose a folder to save the PDF.');
          return;
        }
        const fileUri = await FileSystem.StorageAccessFramework.createFileAsync(perm.directoryUri, safeName, 'application/pdf');
        const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
        await FileSystem.writeAsStringAsync(fileUri, base64, { encoding: FileSystem.EncodingType.Base64 });
        show('Saved to device');
        return;
      }
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

  const duplicateQuote = async (q, idForSpinner = null) => {
    if (!isPremium) {
      Alert.alert('Premium feature', 'Duplicating quotes is available on Premium.',
        [{ text: 'Cancel', style: 'cancel' }, { text: 'Upgrade', onPress: () => router.push('/account') }]);
      return;
    }

    try {
      setBusyId(idForSpinner);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not signed in');

      try {
        const { data: rpcData, error: rpcErr } = await supabase.rpc('duplicate_quote', {
          p_user: user.id, p_source_id: q.id,
        });
        if (rpcErr) throw rpcErr;
        const row = Array.isArray(rpcData) ? rpcData[0] : rpcData;
        if (!row?.id || !row?.quote_number) throw new Error('Duplicate RPC returned no id');
        show(`Duplicated as ${row.quote_number}`);
        router.push({ pathname: '/quotes/create', params: { quoteId: row.id } });
        return;
      } catch {
        const { data: nextNo, error: nErr } = await supabase.rpc('next_quote_number', { p_user_id: user.id });
        if (nErr) throw nErr;

        const { data: inserted, error: insErr } = await supabase
          .from('quotes')
          .insert({
            user_id: user.id, quote_number: nextNo, status: 'draft',
            client_name: q.client_name || 'Client', client_email: q.client_email || null,
            client_phone: q.client_phone || null, client_address: q.client_address || null,
            site_address: q.site_address || null, job_summary: q.job_summary || 'New job',
            job_details: q.job_details || null, line_items: q.line_items || null,
            subtotal: q.subtotal ?? null, vat_amount: q.vat_amount ?? null,
            total: q.total ?? null, pdf_url: null,
          })
          .select('id, quote_number')
          .single();
        if (insErr) throw insErr;

        show(`Duplicated as ${inserted.quote_number}`);
        router.push({ pathname: '/quotes/create', params: { quoteId: inserted.id } });
      }
    } catch (e) {
      console.error('[TMQ][LIST] duplicateQuote error', e);
      Alert.alert('Error', e?.message ?? 'Could not duplicate quote.');
    } finally {
      setBusyId(null);
    }
  };

  const deleteQuote = async (quote, idForSpinner = null) => {
    Alert.alert('Delete quote', `Are you sure you want to delete ${quote.quote_number}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          try {
            setBusyId(idForSpinner);
            const { error: delErr } = await supabase.from('quotes').delete().eq('id', quote.id);
            if (delErr) throw delErr;

            if (userRef.current) {
              const path = `${userRef.current.id}/${quote.quote_number}.pdf`;
              await supabase.storage.from('quotes').remove([path]).catch(() => {});
            }

            setQuotes((prev) => prev.filter((q) => q.id !== quote.id));
            show('Quote deleted');
          } catch (e) {
            console.error('[TMQ][LIST] deleteQuote error', e);
            Alert.alert('Error', e?.message ?? 'Could not delete quote.');
          } finally {
            setBusyId(null);
          }
        }
      },
    ]);
  };

  const toggleExpand = (id) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpandedId((prev) => (prev === id ? null : id));
  };

  // ---------- search / filter / sort ----------
  const visibleQuotes = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = quotes;

    if (q) {
      list = list.filter((it) => {
        const hay =
          (
            (it.quote_number || '') + ' ' +
            (it.client_name || '') + ' ' +
            (it.client_email || '') + ' ' +
            (it.client_phone || '')
          ).toLowerCase();
        return hay.includes(q);
      });
    }

    if (statusFilter !== 'all') {
      list = list.filter((it) => String(it.status || '').toLowerCase() === statusFilter);
    }

    list = [...list];
    switch (sortBy) {
      case 'oldest':
        list.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
        break;
      case 'totalAsc':
        list.sort((a, b) => (a.total ?? 0) - (b.total ?? 0));
        break;
      case 'totalDesc':
        list.sort((a, b) => (b.total ?? 0) - (a.total ?? 0));
        break;
      default: // newest
        list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        break;
    }

    return list;
  }, [quotes, query, statusFilter, sortBy]);

  // ---------- render ----------
  const renderItem = ({ item }) => {
    const createdAtDate = new Date(item.created_at);
    const dateStr = `${createdAtDate.toLocaleDateString()} ${createdAtDate.toLocaleTimeString()}`;
    const badge = statusStyle(item.status);
    const expanded = expandedId === item.id;

    return (
      <View style={styles.card}>
        <TouchableOpacity activeOpacity={0.7} onPress={() => toggleExpand(item.id)}>
          <View style={styles.row}>
            <Text style={styles.quoteNo}>{item.quote_number}</Text>
            <View style={[styles.badge, { backgroundColor: badge.bg }]}>
              <Text style={styles.badgeText}>
                {(item.status || '').charAt(0).toUpperCase() + (item.status || '').slice(1)}
              </Text>
            </View>
          </View>
          <Text style={styles.client}>{item.client_name}</Text>
          <Text style={styles.sub}>{dateStr}</Text>
          <View style={styles.rowBetween}>
            <Text style={styles.sub}>Total: {gbp(item.total ?? 0)}</Text>
            <Text style={[styles.sub, { opacity: 0.8 }]}>{expanded ? 'Hide options ▲' : 'Show options ▼'}</Text>
          </View>
        </TouchableOpacity>

        {expanded && (
          <View style={styles.btnRow}>
            <TouchableOpacity
              style={[styles.btn, styles.btnPrimary]}
              onPress={() => previewPDF(item.pdf_url, item.quote_number + '.pdf', item.id, item)}
              disabled={busyId === item.id}
            >
              <Text style={styles.btnText}>Preview</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.btn, styles.btnSecondary]}
              onPress={() => openPDF(item.pdf_url, item.quote_number + '.pdf', item.id, item)}
              disabled={busyId === item.id}
            >
              <Text style={styles.btnTextAlt}>Open/Share</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.btn, styles.btnAccent]}
              onPress={() => saveToDevice(item.pdf_url, item.quote_number + '.pdf', item.id, item)}
              disabled={busyId === item.id}
            >
              <Text style={styles.btnTextAlt}>Save</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.btn, isPremium ? styles.btnDark : styles.btnLocked]}
              onPress={() => {
                if (!isPremium) {
                  Alert.alert(
                    'Premium feature',
                    'Editing generated quotes is available on Premium.',
                    [{ text: 'Cancel', style: 'cancel' }, { text: 'Upgrade', onPress: () => router.push('/account') }]
                  );
                  return;
                }
                router.push({ pathname: '/quotes/[id]', params: { id: item.id } });
              }}
              disabled={busyId === item.id}
            >
              <Text style={styles.btnTextAlt}>{isPremium ? 'Edit' : 'Edit (Premium)'}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.btn, isPremium ? styles.btnDark : styles.btnLocked]}
              onPress={() => duplicateQuote(item, item.id)}
              disabled={busyId === item.id}
            >
              <Text style={styles.btnTextAlt}>{isPremium ? 'Duplicate' : 'Duplicate (Premium)'}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.btn, styles.btnDanger]}
              onPress={() => deleteQuote(item, item.id)}
              disabled={busyId === item.id}
            >
              <Text style={styles.btnTextAlt}>Delete</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  };

  if (loading) {
    return (
      <View style={styles.loadingWrap}>
        <ActivityIndicator color="#9aa0a6" />
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      {/* Safe top/left/right */}
      <SafeAreaView edges={['top', 'left', 'right']} style={{ backgroundColor: '#0b0b0c' }}>
        <View style={styles.headerRow}>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Open settings"
            onPress={() => router.push('/settings')}
            style={styles.iconBtn}
          >
            <Ionicons name="settings-outline" size={24} color="#fff" />
          </TouchableOpacity>

          <Text style={styles.title}>Quotes</Text>

          <TouchableOpacity style={styles.newBtn} onPress={() => router.push('/quotes/create')}>
            <Text style={styles.newBtnText}>+ New</Text>
          </TouchableOpacity>
        </View>

        {/* Search / Filter / Sort row */}
        <View style={styles.controlsWrap}>
          <View style={styles.searchBox}>
            <Ionicons name="search" size={16} color="#9aa0a6" />
            <TextInput
              placeholder="Search quotes or clients…"
              placeholderTextColor="#8a8b90"
              value={query}
              onChangeText={setQuery}
              style={styles.searchInput}
              returnKeyType="search"
            />
            {!!query && (
              <TouchableOpacity onPress={() => setQuery('')}>
                <Ionicons name="close-circle" size={16} color="#9aa0a6" />
              </TouchableOpacity>
            )}
          </View>

          {/* Status filter chips */}
          <View style={styles.chipsRow}>
            {['all','draft','generated','sent','accepted'].map((k) => (
              <TouchableOpacity
                key={k}
                style={[styles.chip, statusFilter === k && styles.chipActive]}
                onPress={() => setStatusFilter(k)}
              >
                <Text style={[styles.chipText, statusFilter === k && styles.chipTextActive]}>
                  {k === 'all' ? 'All' : k.charAt(0).toUpperCase() + k.slice(1)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Sort buttons */}
          <View style={styles.sortRow}>
            {[
              ['newest','Newest'],
              ['oldest','Oldest'],
              ['totalDesc','Total ↓'],
              ['totalAsc','Total ↑'],
            ].map(([key,label]) => (
              <TouchableOpacity
                key={key}
                style={[styles.sortBtn, sortBy === key && styles.sortBtnActive]}
                onPress={() => setSortBy(key)}
              >
                <Text style={[styles.sortText, sortBy === key && styles.sortTextActive]}>{label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </SafeAreaView>

      {/* Safe bottom */}
      <SafeAreaView edges={['bottom']} style={{ flex: 1 }}>
        <FlatList
          data={visibleQuotes}
          keyExtractor={(q) => String(q.id)}
          renderItem={renderItem}
          contentContainerStyle={{ padding: 16, paddingBottom: Math.max(insets.bottom, 80) }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#999" />}
          ListEmptyComponent={
            <Text style={[styles.sub, { textAlign: 'center', marginTop: 40 }]}>
              No quotes match your filters.
            </Text>
          }
          extraData={{ expandedId, sortBy, statusFilter, query, isPremium }}
        />
      </SafeAreaView>

      <ToastView />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#0b0b0c' },
  loadingWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0b0b0c' },

  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingBottom: 10,
  },
  iconBtn: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: '#1a1a1b',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#2b2c2f',
  },
  title: { color: 'white', fontSize: 24, fontWeight: '700' },
  newBtn: { backgroundColor: '#2a86ff', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10 },
  newBtnText: { color: 'white', fontWeight: '700' },

  controlsWrap: { paddingHorizontal: 12, paddingBottom: 8, gap: 8 },
  searchBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#1a1a1b', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10,
    borderWidth: 1, borderColor: '#2b2c2f',
  },
  searchInput: { flex: 1, color: 'white' },

  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999,
    backgroundColor: '#1a1a1b', borderWidth: 1, borderColor: '#2b2c2f',
  },
  chipActive: { backgroundColor: '#2a86ff', borderColor: '#2a86ff' },
  chipText: { color: '#c9c9cc', fontWeight: '600', fontSize: 12 },
  chipTextActive: { color: '#fff' },

  sortRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  sortBtn: {
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8,
    backgroundColor: '#1a1a1b', borderWidth: 1, borderColor: '#2b2c2f',
  },
  sortBtnActive: { backgroundColor: '#34353a', borderColor: '#3c3c3f' },
  sortText: { color: '#c9c9cc', fontWeight: '600', fontSize: 12 },
  sortTextActive: { color: '#fff' },

  card: { backgroundColor: '#1a1a1b', borderRadius: 16, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: '#2b2c2f' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 },
  quoteNo: { color: 'white', fontWeight: '700', fontSize: 16 },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  badgeText: { color: 'white', fontSize: 12, fontWeight: '700' },
  client: { color: 'white', marginTop: 6, fontSize: 15 },
  sub: { color: '#a9a9ac', marginTop: 2, fontSize: 12 },

  btnRow: { marginTop: 10, gap: 8, flexWrap: 'wrap', flexDirection: 'row' },
  btn: { flexGrow: 1, flexBasis: '48%', borderRadius: 12, paddingVertical: 10, alignItems: 'center' },
  btnPrimary: { backgroundColor: '#3ecf8e' },
  btnSecondary: { backgroundColor: '#272729', borderWidth: 1, borderColor: '#3c3c3f' },
  btnDark: { backgroundColor: '#1f1f21', borderWidth: 1, borderColor: '#34353a' },
  btnLocked: { backgroundColor: '#2a2b2f', borderWidth: 1, borderColor: '#3a3b40' },
  btnDanger: { backgroundColor: '#b3261e' },
  btnAccent: { backgroundColor: '#2a86ff' },

  btnText: { color: '#0b0b0c', fontWeight: '800' },
  btnTextAlt: { color: 'white', fontWeight: '800' },

  toast: {
    position: 'absolute',
    left: 16, right: 16, bottom: 24,
    backgroundColor: '#222326', borderRadius: 12,
    paddingVertical: 10, paddingHorizontal: 14,
    borderWidth: 1, borderColor: '#3a3b3f',
  },
  toastText: { color: 'white', textAlign: 'center', fontWeight: '600' },
});