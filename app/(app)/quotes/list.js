// app/(app)/quotes/index.js (QuoteList)
// UPDATED: invokes Edge Function to copy quote PDF when creating a job
// and invokes extract-quote-expenses (server-side) to import only expense lines.

import {
  loginHref,
  settingsHref,
  quoteCreateHref,
  accountHref,
  quotePreviewHref,
  quotesListHref,
  quoteHref,
  jobsTabHref,
} from "../../../lib/nav";
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import TopBar, { IconBtn } from "../../../components/TopBar";
import {
  View, Text, StyleSheet, TouchableOpacity, FlatList, TextInput,
  Modal, Pressable, ActivityIndicator, Platform
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../../../lib/supabase';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import {
  Filter, Search, Plus, ChevronRight, CalendarDays, PoundSterling, Settings,
  X as XIcon, Download, Share2, Trash2, Eye, Pencil, Copy, MapPin,
  ChevronRight as Arrow, CalendarPlus
} from 'lucide-react-native';

/* ---------- theme ---------- */
const BRAND = '#2a86ff';
const TEXT = '#0b1220';
const MUTED = '#6b7280';
const CARD = '#ffffff';
const BG = '#f5f7fb';
const BORDER = '#e6e9ee';

/* ---------- utils ---------- */
const money = (v = 0) =>
  '£' + Number(v || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

const pad = (n) => (n < 10 ? '0' + n : String(n));
const toYMD = (d) =>
  d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const parseYMD = (s) => {
  if (!s) return null;
  const [y, m, d] = s.split('-').map((x) => parseInt(x, 10));
  if (!y || !m || !d) return null;
  const dt = new Date(y, m - 1, d);
  dt.setHours(0, 0, 0, 0);
  return dt;
};
const toLocalMidnight = (d) => { const x = new Date(d); x.setHours(0,0,0,0); return x; };
const isWeekend = (d) => d.getDay() === 0 || d.getDay() === 6;
const addWorkingDays = (startDate, days, includeWeekends) => {
  const s = toLocalMidnight(startDate);
  if (days <= 1) return s;
  let remaining = days - 1;
  const cur = new Date(s);
  while (remaining > 0) {
    cur.setDate(cur.getDate() + 1);
    if (includeWeekends || !isWeekend(cur)) remaining--;
  }
  return cur;
};

/* ---------- component ---------- */
export default function QuoteList() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [quotes, setQuotes] = useState([]);

  // tabs: all | draft | sent | accepted
  const [tab, setTab] = useState('all');
  const [query, setQuery] = useState('');

  // filter drawer
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sortBy, setSortBy] = useState('created_at_desc');
  const [minTotal, setMinTotal] = useState('');
  const [maxTotal, setMaxTotal] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  // date pickers
  const [showFromPicker, setShowFromPicker] = useState(false);
  const [showToPicker, setShowToPicker] = useState(false);

  // action sheet
  const [actionOpen, setActionOpen] = useState(false);
  const [selectedQuote, setSelectedQuote] = useState(null);

  // confirm
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmConfig, setConfirmConfig] = useState({ title: '', message: '', onConfirm: null });

  // toast
  const [toast, setToast] = useState('');

  // premium (branding only)
  const [isPremium, setIsPremium] = useState(false);

  // create-job modal
  const [createOpen, setCreateOpen] = useState(false);
  const [cjBusy, setCjBusy] = useState(false);
  const [cjError, setCjError] = useState('');
  const [cjStart, setCjStart] = useState(toLocalMidnight(new Date()));
  const [cjShowPicker, setCjShowPicker] = useState(false);
  const [cjIncludeWeekends, setCjIncludeWeekends] = useState(false);
  const [cjDays, setCjDays] = useState(1);
  const cjEnd = useMemo(
    () => addWorkingDays(cjStart, Math.max(1, Math.floor(cjDays || 1)), cjIncludeWeekends),
    [cjStart, cjDays, cjIncludeWeekends]
  );

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 2200); };

  const load = useCallback(async () => {
    try {
      setLoading(true);

      const authRes = await supabase.auth.getUser();
      const user = authRes?.data?.user;
      if (!user) { router.replace(loginHref); return; }

      // BRANDING ONLY: lock Edit/Duplicate on Free
      const profileRes = await supabase
        .from('profiles')
        .select('branding')
        .eq('id', user.id)
        .maybeSingle();
      const branding = profileRes?.data ? String(profileRes.data.branding || '') : '';
      setIsPremium(branding.toLowerCase() === 'premium');

      // quotes query
      let q = supabase
        .from('quotes')
        .select('id, quote_number, client_name, total, created_at, pdf_url, client_address, status, job_summary, job_details, site_address')
        .eq('user_id', user.id);

      if (tab !== 'all') q = q.eq('status', tab);

      if (query.trim()) {
        const t = query.trim();
        q = q.or('client_name.ilike.%' + t + '%,quote_number.ilike.%' + t + '%');
      }

      if (minTotal) q = q.gte('total', Number(minTotal || 0));
      if (maxTotal) q = q.lte('total', Number(maxTotal || 0));
      if (fromDate) q = q.gte('created_at', new Date(fromDate).toISOString());
      if (toDate) q = q.lte('created_at', new Date(toDate).toISOString());

      if (sortBy === 'created_at_desc') q = q.order('created_at', { ascending: false });
      if (sortBy === 'created_at_asc') q = q.order('created_at', { ascending: true });
      if (sortBy === 'total_desc') q = q.order('total', { ascending: false });
      if (sortBy === 'total_asc') q = q.order('total', { ascending: true });

      const res = await q.limit(400);
      if (res.error) throw res.error;
      setQuotes(res.data || []);
    } catch (e) {
      console.error('[TMQ][LIST] load error', e);
    } finally {
      setLoading(false);
    }
  }, [router, tab, query, minTotal, maxTotal, fromDate, toDate, sortBy]);

  // initial + on focus refresh
  useEffect(() => { load(); }, [load]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const clearFilters = () => {
    setMinTotal(''); setMaxTotal(''); setFromDate(''); setToDate(''); setSortBy('created_at_desc');
  };

  /* ---------- file actions ---------- */
  const saveToDevice = async (q) => {
    try {
      if (!q?.pdf_url) { showToast('Generate the PDF first'); return; }
      const filename = (q.quote_number || 'quote') + '.pdf';

      if (Platform.OS === 'android') {
        const perm = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
        if (!perm.granted) { showToast('Storage permission declined'); return; }

        const tmp = FileSystem.cacheDirectory + filename;
        const dl = FileSystem.createDownloadResumable(q.pdf_url, tmp);
        const dlRes = await dl.downloadAsync();

        const base64 = await FileSystem.readAsStringAsync(dlRes.uri, { encoding: FileSystem.EncodingType.Base64 });
        const targetUri = await FileSystem.StorageAccessFramework.createFileAsync(
          perm.directoryUri, filename, 'application/pdf'
        );
        await FileSystem.writeAsStringAsync(targetUri, base64, { encoding: FileSystem.EncodingType.Base64 });
        showToast('Saved to selected folder');
      } else {
        const tmp2 = FileSystem.cacheDirectory + filename;
        const dl2 = FileSystem.createDownloadResumable(q.pdf_url, tmp2);
        const dlRes2 = await dl2.downloadAsync();
        await Sharing.shareAsync(dlRes2.uri, { UTI: 'com.adobe.pdf', mimeType: 'application/pdf', dialogTitle: 'Save to Files' });
      }
    } catch (e) {
      console.error('[TMQ][LIST] saveToDevice error', e);
      showToast('Save failed');
    }
  };

  const shareQuote = async (q) => {
    try {
      if (!q?.pdf_url) { showToast('Generate the PDF first'); return; }
      const tmp = FileSystem.cacheDirectory + (q.quote_number || 'quote') + '.pdf';
      const dl = FileSystem.createDownloadResumable(q.pdf_url, tmp);
      const dlRes = await dl.downloadAsync();
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(dlRes.uri, { mimeType: 'application/pdf', dialogTitle: q.quote_number || 'Quote', UTI: 'com.adobe.pdf' });
      } else {
        showToast('Sharing not available');
      }
    } catch (e) {
      console.error('[TMQ][LIST] share error', e);
      showToast('Share failed');
    }
  };

  /* ---------- duplicate ---------- */
  const duplicateQuote = async (q) => {
    try {
      const authRes = await supabase.auth.getUser();
      const user = authRes?.data?.user;
      if (!user) { router.replace(loginHref); return; }

      const nextRes = await supabase.rpc('next_quote_number', { p_user_id: user.id });
      if (nextRes.error || !nextRes.data) throw new Error(nextRes.error?.message || 'Could not allocate a quote number');

      const fullRes = await supabase.from('quotes').select('*').eq('id', q.id).single();
      if (fullRes.error) throw fullRes.error;

      const copy = { ...fullRes.data };
      delete copy.id;
      copy.quote_number = nextRes.data;
      copy.status = 'draft';
      copy.created_at = new Date().toISOString();
      copy.updated_at = new Date().toISOString();
      copy.pdf_url = null;

      const insRes = await supabase.from('quotes').insert(copy);
      if (insRes.error) throw insRes.error;

      await load();
      showToast('Duplicated as ' + nextRes.data);
    } catch (e) {
      console.error('[TMQ][LIST] duplicate error', e);
      showToast('Duplicate failed');
    }
  };

  /* ---------- create job ---------- */
  const canCreateJob = (q) => String(q?.status || '').toLowerCase() !== 'draft';

  const openCreateJob = async (q) => {
    try {
      if (!q) return;
      if (!canCreateJob(q)) { showToast('Generate the quote first'); return; }
      setCjError('');
      setCjBusy(true);

      const fullRes = await supabase.from('quotes').select('*').eq('id', q.id).maybeSingle();
      if (fullRes.error) throw fullRes.error;
      const full = fullRes.data || q;

      // derive days from AI/meta if available
      let days = 1;
      try {
        const blob = typeof full.job_details === 'string' ? JSON.parse(full.job_details) : (full.job_details || {});
        const meta = blob?.ai_meta || blob?.meta || {};
        if (meta?.day_rate_calc) {
          const d = Number(meta.day_rate_calc.days || 0);
          const rem = Number(meta.day_rate_calc.remainder_hours || 0);
          days = Math.max(1, d + (rem > 0 ? 1 : 0));
        } else if (Number(meta?.estimated_hours)) {
          const hpd = Number(meta?.hours_per_day || blob?.profile?.hours_per_day || 8) || 8;
          days = Math.max(1, Math.ceil(Number(meta.estimated_hours) / hpd));
        }
      } catch { /* ignore parse errors */ }

      setCjDays(days);
      setCjIncludeWeekends(false);
      setCjStart(toLocalMidnight(new Date()));
      setSelectedQuote(full);
      setCreateOpen(true);
    } catch (e) {
      console.error('[TMQ][LIST] openCreateJob error', e);
      showToast('Could not open Create Job');
    } finally {
      setCjBusy(false);
    }
  };

  // Invokes Edge Function after job insert to copy PDF + create document
  // then invokes extract-quote-expenses to import only expense lines.
  const createJob = async () => {
    try {
      if (!selectedQuote?.id) return;
      setCjBusy(true);
      setCjError('');

      const authRes = await supabase.auth.getUser();
      const user = authRes?.data?.user;
      if (!user) { router.replace(loginHref); return; }

      // ensure we have the full quote
      let full = selectedQuote;
      if (!('job_details' in full) || !('site_address' in full)) {
        const fr = await supabase.from('quotes').select('*').eq('id', selectedQuote.id).maybeSingle();
        if (fr.error) throw fr.error;
        full = fr.data || selectedQuote;
      }

      const start = toYMD(cjStart);
      const end = toYMD(addWorkingDays(cjStart, Math.max(1, Math.floor(cjDays || 1)), cjIncludeWeekends));

      const insert = {
        user_id: user.id,
        title: full.job_summary || full.quote_number || 'Job',
        client_name: full.client_name || 'Client',
        client_address: full.client_address || null,
        site_address: full.site_address || full.client_address || null,
        status: 'scheduled',
        start_date: start,
        end_date: end,
        duration_days: Math.max(1, Math.floor(cjDays || 1)),
        include_weekends: cjIncludeWeekends,
        total: Number(full.total || 0),
        cost: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        // source_quote_id: full.id, // optional hard link
      };

      const ins = await supabase.from('jobs').insert(insert).select('id').single();
      if (ins.error) throw ins.error;
      const jobId = ins.data.id;

      // mark quote accepted + link (non-blocking if it fails)
      await supabase
        .from('quotes')
        .update({ status: 'accepted', updated_at: new Date().toISOString(), job_id: jobId })
        .eq('id', full.id);

      // 🔔 1) copy the PDF and insert documents row
      try {
        const { data: fnData, error: fnErr } = await supabase.functions.invoke('copy-quote-pdf', {
          body: { jobId, quoteId: full.id },
        });
        if (fnErr) {
          console.warn('[QUOTES→JOB] copy-quote-pdf failed:', fnErr.message || fnErr);
          showToast('Job created, but attaching the quote PDF failed.');
        } else {
          console.log('[QUOTES→JOB] copy-quote-pdf success:', fnData);
        }
      } catch (invokeErr) {
        console.warn('[QUOTES→JOB] copy-quote-pdf invoke threw:', invokeErr?.message || invokeErr);
        showToast('Job created, but attaching the quote PDF failed.');
      }

      // 📥 2) server-side expense extraction (robust, expense-only)
      try {
        const { data: exData, error: exErr } = await supabase.functions.invoke('extract-quote-expenses', {
          body: { jobId, quoteId: full.id }
        });
        if (exErr) {
          console.warn('[QUOTES→JOB] extract-quote-expenses failed:', exErr.message || exErr);
          showToast('Job created, but expense import failed.');
        } else {
          console.log('[QUOTES→JOB] expense import OK:', exData);
        }
      } catch (invokeErr) {
        console.warn('[QUOTES→JOB] extract-quote-expenses threw:', invokeErr?.message || invokeErr);
        showToast('Job created, but expense import failed.');
      }

      setCreateOpen(false);
      showToast('Job created');
      router.push(jobsTabHref);
    } catch (e) {
      console.error('[TMQ][LIST] createJob error', e);
      setCjError(e?.message || 'Create job failed');
    } finally {
      setCjBusy(false);
    }
  };

  /* ---------- UI ---------- */
  if (loading) {
    return (
      <View style={[styles.screen, { alignItems: 'center', justifyContent: 'center' }]}>
        <ActivityIndicator color={BRAND} />
      </View>
    );
  }

  const renderCard = ({ item }) => {
    const address = item.client_address || '';
    return (
      <Pressable
        onPress={() => { setSelectedQuote(item); setActionOpen(true); }}
        style={({ pressed }) => [styles.card, pressed && { transform: [{ scale: 0.995 }] }]}
      >
        {!!item.quote_number && (
          <Text style={styles.quoteTiny} numberOfLines={1}>{item.quote_number}</Text>
        )}

        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <View style={{ flexShrink: 1, paddingRight: 110 }}>
            <Text style={styles.clientName} numberOfLines={1}>{item.client_name || '—'}</Text>

            <View style={styles.rowMini}>
              <CalendarDays size={16} color={MUTED} />
              <Text style={styles.rowMiniText}>{'  '}{new Date(item.created_at).toLocaleDateString()}</Text>
            </View>

            {!!address && (
              <View style={styles.rowMini}>
                <MapPin size={16} color={MUTED} />
                <Text style={[styles.rowMiniText, { flexShrink: 1 }]} numberOfLines={1}>{'  '}{address}</Text>
              </View>
            )}
          </View>
        </View>

        <Text style={styles.totalBottom}>{money(item.total || 0)}</Text>
        <ChevronRight size={18} color={MUTED} style={{ position: 'absolute', right: 12, top: 12, opacity: 0.6 }} />
      </Pressable>
    );
  };

  const TabChip = ({ label, value }) => {
    const active = tab === value;
    return (
      <TouchableOpacity onPress={() => setTab(value)} style={[styles.chip, active && styles.chipActive]}>
        <Text style={[styles.chipText, active && styles.chipTextActive]} numberOfLines={1}>{label}</Text>
      </TouchableOpacity>
    );
  };

  const FilterRow = ({ label, right }) => (
    <View style={styles.filterRow}>
      <Text style={styles.filterLabel}>{label}</Text>
      <View style={{ flex: 1 }} />
      {right}
    </View>
  );

  return (
    <View style={styles.screen}>
      {/* Top bar */}
      <View style={styles.topbar}>
        <Text style={styles.h1}>Quotes</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TouchableOpacity style={styles.iconBtn} onPress={() => setFiltersOpen(true)}>
            <Filter size={20} color={MUTED} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.iconBtn} onPress={() => router.push(settingsHref)}>
            <Settings size={20} color={MUTED} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Search */}
      <View style={styles.searchRow}>
        <Search size={18} color={MUTED} style={{ marginRight: 8 }} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search client or quote number"
          placeholderTextColor={MUTED}
          style={styles.searchInput}
          returnKeyType="search"
          onSubmitEditing={load}
        />
      </View>

      {/* Tabs */}
      <View style={styles.tabsRow}>
        <TabChip label="All" value="all" />
        <TabChip label="Draft" value="draft" />
        <TabChip label="Sent" value="sent" />
        <TabChip label="Accepted" value="accepted" />
      </View>

      {/* List */}
      <FlatList
        data={quotes}
        keyExtractor={(it) => String(it.id)}
        renderItem={renderCard}
        contentContainerStyle={{ paddingBottom: 180 }}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        ListEmptyComponent={
          <View style={{ paddingTop: 40, alignItems: 'center' }}>
            <PoundSterling size={28} color={MUTED} />
            <Text style={{ color: MUTED, marginTop: 8 }}>No quotes match your filters.</Text>
          </View>
        }
        refreshing={loading}
        onRefresh={load}
      />

      {/* FAB */}
      <TouchableOpacity
        onPress={() => router.push(quoteCreateHref())}
        style={styles.fab}
        activeOpacity={0.9}
      >
        <Plus size={24} color="#fff" />
      </TouchableOpacity>

      {/* Filter / Sort Modal */}
      <Modal visible={filtersOpen} animationType="slide" transparent>
        <Pressable style={styles.modalBackdrop} onPress={() => setFiltersOpen(false)} />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>Filter & sort</Text>

          <FilterRow
            label="Sort by"
            right={
              <View style={styles.segment}>
                {[
                  ['Newest', 'created_at_desc'],
                  ['Oldest', 'created_at_asc'],
                  ['Total↑', 'total_asc'],
                  ['Total↓', 'total_desc'],
                ].map(([label, val]) => (
                  <Pressable key={val} onPress={() => setSortBy(val)} style={[styles.segmentBtn, sortBy === val && styles.segmentBtnActive]}>
                    <Text style={[styles.segmentText, sortBy === val && styles.segmentTextActive]}>{label}</Text>
                  </Pressable>
                ))}
              </View>
            }
          />

          <FilterRow
            label="Totals"
            right={
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <TextInput
                  style={[styles.smallInput, { width: 100 }]}
                  placeholder="Min £"
                  keyboardType="decimal-pad"
                  value={minTotal}
                  onChangeText={setMinTotal}
                  placeholderTextColor={MUTED}
                />
                <TextInput
                  style={[styles.smallInput, { width: 100 }]}
                  placeholder="Max £"
                  keyboardType="decimal-pad"
                  value={maxTotal}
                  onChangeText={setMaxTotal}
                  placeholderTextColor={MUTED}
                />
              </View>
            }
          />

          <FilterRow
            label="Dates"
            right={
              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                {/* From */}
                <View style={{ position: 'relative' }}>
                  <TextInput
                    style={[styles.smallInput, { width: 150, paddingRight: 38 }]}
                    placeholder="From (YYYY-MM-DD)"
                    value={fromDate}
                    onChangeText={setFromDate}
                    placeholderTextColor={MUTED}
                  />
                  <TouchableOpacity onPress={() => setShowFromPicker(true)} style={styles.inputIconBtn}>
                    <CalendarDays size={18} color={MUTED} />
                  </TouchableOpacity>
                  {!!fromDate && (
                    <TouchableOpacity onPress={() => setFromDate('')} style={[styles.clearBadge, { right: 34 }]}>
                      <XIcon size={14} color="#667085" />
                    </TouchableOpacity>
                  )}
                </View>

                {/* To */}
                <View style={{ position: 'relative' }}>
                  <TextInput
                    style={[styles.smallInput, { width: 150, paddingRight: 38 }]}
                    placeholder="To (YYYY-MM-DD)"
                    value={toDate}
                    onChangeText={setToDate}
                    placeholderTextColor={MUTED}
                  />
                  <TouchableOpacity onPress={() => setShowToPicker(true)} style={styles.inputIconBtn}>
                    <CalendarDays size={18} color={MUTED} />
                  </TouchableOpacity>
                  {!!toDate && (
                    <TouchableOpacity onPress={() => setToDate('')} style={[styles.clearBadge, { right: 34 }]}>
                      <XIcon size={14} color="#667085" />
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            }
          />

          {showFromPicker && (
            <DateTimePicker
              value={parseYMD(fromDate) || new Date()}
              mode="date"
              display={Platform.OS === 'ios' ? 'inline' : 'default'}
              onChange={(e, d) => { if (Platform.OS === 'android') setShowFromPicker(false); if (d) setFromDate(toYMD(d)); }}
              maximumDate={parseYMD(toDate) || undefined}
            />
          )}
          {showToPicker && (
            <DateTimePicker
              value={parseYMD(toDate) || new Date()}
              mode="date"
              display={Platform.OS === 'ios' ? 'inline' : 'default'}
              onChange={(e, d) => { if (Platform.OS === 'android') setShowToPicker(false); if (d) setToDate(toYMD(d)); }}
              minimumDate={parseYMD(fromDate) || undefined}
            />
          )}

          <View style={{ height: 12 }} />

          <View style={{ flexDirection: 'row', gap: 10 }}>
            <TouchableOpacity style={[styles.sheetBtn, { backgroundColor: '#eef2f7' }]} onPress={clearFilters}>
              <Text style={[styles.sheetBtnText, { color: TEXT }]}>Clear</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.sheetBtn, { backgroundColor: BRAND, flex: 1 }]} onPress={() => { setFiltersOpen(false); load(); }}>
              <Text style={[styles.sheetBtnText, { color: '#fff' }]}>Apply</Text>
            </TouchableOpacity>
          </View>

          <View style={{ height: Platform.OS === 'ios' ? 24 : 10 }} />
        </View>
      </Modal>

      {/* Action Sheet */}
      <Modal visible={actionOpen} animationType="fade" transparent>
        <Pressable style={styles.modalBackdrop} onPress={() => setActionOpen(false)} />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>{selectedQuote?.quote_number || 'Quote Actions'}</Text>

          {/* View */}
          <Pressable
            style={styles.rowAction}
            onPress={() => {
              setActionOpen(false);
              router.push({
                pathname: quotePreviewHref(selectedQuote.id),
                params: {
                  id: selectedQuote.id,
                  url: encodeURIComponent(selectedQuote?.pdf_url || ''),
                  name: (selectedQuote?.quote_number || 'quote') + '.pdf',
                },
              });
            }}
          >
            <View style={styles.rowLeft}>
              <Eye size={18} color={MUTED} />
              <Text style={styles.rowText}>View</Text>
            </View>
            <Arrow size={18} color={MUTED} />
          </Pressable>

          {/* Create Job */}
          <Pressable
            style={[styles.rowAction, !canCreateJob(selectedQuote) && { opacity: 0.5 }]}
            disabled={!canCreateJob(selectedQuote)}
            onPress={async () => {
              setActionOpen(false);
              if (!canCreateJob(selectedQuote)) { showToast('Generate the quote first'); return; }
              await openCreateJob(selectedQuote);
            }}
          >
            <View style={styles.rowLeft}>
              <CalendarPlus size={18} color={MUTED} />
              <Text style={styles.rowText}>Create job</Text>
            </View>
            <Arrow size={18} color={MUTED} />
          </Pressable>

          {/* Edit (locked on Free branding) */}
          <Pressable
            style={styles.rowAction}
            onPress={() => {
              setActionOpen(false);
              if (!isPremium) {
                router.push(accountHref);
              } else {
                router.push(quoteHref(selectedQuote.id));
              }
            }}
          >
            <View style={styles.rowLeft}>
              <Pencil size={18} color={MUTED} />
              <Text style={styles.rowText}>Edit</Text>
            </View>
            <Arrow size={18} color={MUTED} />
          </Pressable>
        </View>
      </Modal>

      {/* Create Job Modal */}
      <Modal visible={createOpen} animationType="slide" transparent>
        <Pressable style={styles.modalBackdrop} onPress={() => setCreateOpen(false)} />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>Create job from {selectedQuote?.quote_number || 'quote'}</Text>

          <Text style={styles.filterLabel}>Start date</Text>
          <View style={{ position: 'relative', marginBottom: 10 }}>
            <TextInput value={cjStart.toLocaleDateString()} editable={false} style={[styles.smallInput, { paddingRight: 38 }]} />
            <TouchableOpacity onPress={() => setCjShowPicker(true)} style={styles.inputIconBtn}>
              <CalendarDays size={18} color={MUTED} />
            </TouchableOpacity>
          </View>
          {cjShowPicker && (
            <DateTimePicker
              value={cjStart}
              mode="date"
              display={Platform.OS === 'ios' ? 'inline' : 'default'}
              onChange={(e, d) => { if (Platform.OS === 'android') setCjShowPicker(false); if (d) setCjStart(toLocalMidnight(d)); }}
            />
          )}

          <Text style={styles.filterLabel}>Duration (days)</Text>
          <TextInput
            style={[styles.smallInput, { width: 120 }]}
            keyboardType="number-pad"
            value={String(cjDays)}
            onChangeText={(t) => setCjDays(Math.max(1, Math.floor(Number(String(t).replace(/[^0-9]/g, '')) || 1)))}
            placeholderTextColor={MUTED}
          />

          <TouchableOpacity
            style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10 }}
            onPress={() => setCjIncludeWeekends((v) => !v)}
          >
            <View style={[styles.checkboxBox, cjIncludeWeekends && styles.checkboxBoxChecked]}>
              {cjIncludeWeekends ? <Text style={styles.checkboxTick}>✓</Text> : null}
            </View>
            <Text style={{ color: TEXT, fontWeight: '800' }}>Include weekends</Text>
          </TouchableOpacity>

          <View style={{ marginTop: 12, padding: 12, borderRadius: 12, backgroundColor: '#f8fafc', borderWidth: 1, borderColor: BORDER }}>
            <Text style={{ color: TEXT, fontWeight: '700' }}>
              End date: {cjEnd.toLocaleDateString()} ({cjIncludeWeekends ? 'calendar days' : 'working days'})
            </Text>
          </View>

          {!!cjError && <Text style={{ color: '#e11d48', fontWeight: '700', marginTop: 8 }}>{cjError}</Text>}

          <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
            <TouchableOpacity style={[styles.sheetBtn, { backgroundColor: '#eef2f7' }]} onPress={() => setCreateOpen(false)}>
              <Text style={[styles.sheetBtnText, { color: TEXT }]}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.sheetBtn, { backgroundColor: BRAND, flex: 1, opacity: cjBusy ? 0.7 : 1 }]}
              onPress={createJob}
              disabled={cjBusy}
            >
              <Text style={[styles.sheetBtnText, { color: '#fff' }]}>{cjBusy ? 'Creating…' : 'Create job'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Confirm Dialog */}
      <Modal visible={confirmOpen} animationType="fade" transparent>
        <Pressable style={styles.modalBackdrop} onPress={() => setConfirmOpen(false)} />
        <View style={styles.confirmBox}>
          <Text style={styles.confirmTitle}>{confirmConfig.title}</Text>
          <Text style={styles.confirmMessage}>{confirmConfig.message}</Text>
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 20 }}>
            <TouchableOpacity style={[styles.sheetBtn, { backgroundColor: '#eef2f7', flex: 1 }]} onPress={() => setConfirmOpen(false)}>
              <Text style={[styles.sheetBtnText, { color: TEXT }]}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.sheetBtn, { backgroundColor: '#e11d48', flex: 1 }]}
              onPress={() => {
                if (typeof confirmConfig.onConfirm === 'function') confirmConfig.onConfirm();
                else setConfirmOpen(false);
              }}
            >
              <Text style={[styles.sheetBtnText, { color: '#fff' }]}>Delete</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Toast */}
      {!!toast && (
        <View style={styles.toast}>
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      )}
    </View>
  );
}

/* ---------- styles ---------- */
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG, paddingTop: Platform.OS === 'android' ? 8 : 0 },

  topbar: {
    paddingHorizontal: 16, paddingTop: 10, paddingBottom: 8,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  h1: { color: TEXT, fontSize: 24, fontWeight: '800' },

  iconBtn: {
    height: 38, width: 38, borderRadius: 10, borderWidth: 1, borderColor: BORDER,
    alignItems: 'center', justifyContent: 'center', backgroundColor: CARD,
  },

  searchRow: {
    marginTop: 14, marginHorizontal: 16, backgroundColor: CARD, borderRadius: 12,
    borderWidth: 1, borderColor: BORDER, paddingHorizontal: 12, paddingVertical: 10,
    flexDirection: 'row', alignItems: 'center',
  },
  searchInput: { flex: 1, color: TEXT },

  tabsRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    gap: 8, paddingHorizontal: 16, marginTop: 12, marginBottom: 10,
  },
  chip: {
    flexGrow: 1, alignItems: 'center', paddingHorizontal: 10, paddingVertical: 10,
    borderRadius: 999, backgroundColor: '#eef2f7', borderWidth: 1, borderColor: BORDER,
  },
  chipActive: { backgroundColor: BRAND + '22', borderColor: BRAND + '55' },
  chipText: { color: MUTED, fontWeight: '700' },
  chipTextActive: { color: BRAND },

  card: {
    backgroundColor: CARD, marginHorizontal: 16, padding: 14, borderRadius: 16,
    borderWidth: 1, borderColor: BORDER, shadowColor: '#0b1220', shadowOpacity: 0.04,
    shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 2, marginBottom: 2,
  },
  quoteTiny: {
    position: 'absolute', right: 34, top: 14, color: MUTED, fontSize: 12, maxWidth: 180, textAlign: 'right',
  },
  clientName: { color: TEXT, fontWeight: '900', fontSize: 16 },
  rowMini: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  rowMiniText: { color: MUTED },

  totalBottom: { position: 'absolute', right: 16, bottom: 12, fontSize: 16, fontWeight: '900', color: TEXT },

  fab: {
    position: 'absolute', right: 18, bottom: 18, width: 56, height: 56, borderRadius: 28,
    backgroundColor: BRAND, alignItems: 'center', justifyContent: 'center',
    shadowColor: BRAND, shadowOpacity: 0.35, shadowRadius: 10, shadowOffset: { width: 0, height: 6 }, elevation: 6,
  },

  modalBackdrop: { flex: 1, backgroundColor: '#0008' },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: CARD,
    borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 16, borderTopWidth: 1, borderColor: BORDER,
  },
  sheetHandle: { alignSelf: 'center', width: 44, height: 5, borderRadius: 999, backgroundColor: BORDER, marginBottom: 10 },
  sheetTitle: { color: TEXT, fontWeight: '900', fontSize: 18, marginBottom: 8 },

  filterRow: { flexDirection: 'row', alignItems: 'center', marginTop: 12, gap: 10 },
  filterLabel: { color: MUTED, fontWeight: '800' },

  smallInput: {
    backgroundColor: '#f6f7f9', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 10,
    borderWidth: 1, borderColor: BORDER, color: TEXT,
  },
  inputIconBtn: {
    position: 'absolute', right: 8, top: 8, height: 28, width: 28, borderRadius: 8,
    alignItems: 'center', justifyContent: 'center', backgroundColor: '#f3f4f6',
    borderWidth: 1, borderColor: BORDER,
  },
  clearBadge: {
    position: 'absolute', top: 8, height: 28, width: 28, borderRadius: 8,
    alignItems: 'center', justifyContent: 'center', backgroundColor: '#f8fafc',
    borderWidth: 1, borderColor: BORDER,
  },

  segment: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  segmentBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: BORDER, backgroundColor: '#f7f8fb' },
  segmentBtnActive: { backgroundColor: BRAND + '15', borderColor: BRAND + '66' },
  segmentText: { color: MUTED, fontWeight: '700' },
  segmentTextActive: { color: BRAND },

  sheetBtn: { paddingVertical: 12, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center' },
  sheetBtnText: { fontWeight: '800' },

  rowAction: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, borderBottomWidth: 1, borderColor: BORDER },
  rowLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  rowText: { color: TEXT, fontWeight: '800' },

  confirmBox: {
    position: 'absolute', left: 16, right: 16, bottom: '25%', backgroundColor: CARD, borderRadius: 16,
    padding: 18, borderWidth: 1, borderColor: BORDER, shadowColor: '#0b1220', shadowOpacity: 0.1,
    shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 4,
  },
  confirmTitle: { color: TEXT, fontWeight: '900', fontSize: 18, marginBottom: 6 },
  confirmMessage: { color: MUTED },

  checkboxBox: {
    width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: '#cbd5e1',
    alignItems: 'center', justifyContent: 'center', backgroundColor: '#ffffff'
  },
  checkboxBoxChecked: { backgroundColor: BRAND, borderColor: BRAND },
  checkboxTick: { color: '#ffffff', fontWeight: '800' },

  toast: {
    position: 'absolute', bottom: 22, left: 16, right: 16, backgroundColor: '#111827',
    paddingVertical: 10, paddingHorizontal: 14, borderRadius: 12, alignItems: 'center',
    shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 4,
  },
  toastText: { color: '#fff', fontWeight: '700' },
});