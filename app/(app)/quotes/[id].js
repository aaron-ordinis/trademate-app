// app/(app)/quotes/[id].js
import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView,
  ActivityIndicator, Alert
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '../../../lib/supabase';

const money = (v = 0) => `\u00A3${Number(v || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
const clone = (x) => JSON.parse(JSON.stringify(x ?? null));

/* ---------- storage helpers ---------- */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function probeUrl(url) {
  const bust = `cb=${Date.now()}&r=${Math.random().toString(36).slice(2)}`;
  const u = url?.includes('?') ? url + '&' + bust : url + '?' + bust;
  try {
    let res = await fetch(u, { method: 'HEAD' });
    if (res.ok || [206, 304].includes(res.status)) return true;
    res = await fetch(u, { method: 'GET', headers: { Range: 'bytes=0-1' } });
    if ([200, 206, 304].includes(res.status)) return true;
    res = await fetch(u, { method: 'GET' });
    return res.ok;
  } catch { return false; }
}
async function pollSignedUrlReady(path, { tries = 50, baseDelay = 250, step = 250, maxDelay = 1200, ttl = 60*60*24*7 } = {}) {
  const storage = supabase.storage.from('quotes');
  for (let i = 0; i < tries; i++) {
    const { data } = await storage.createSignedUrl(path, ttl);
    const url = data?.signedUrl;
    if (url && await probeUrl(url)) return url;
    await sleep(Math.min(baseDelay + i * step, maxDelay));
  }
  return null;
}

/* ---------- data helpers ---------- */
const statusStyle = (status) => {
  const s = String(status || '').toLowerCase();
  if (s === 'draft')    return { bg: '#6b7280', label: 'Draft' };
  if (s === 'sent')     return { bg: '#2a86ff', label: 'Sent' };
  if (s === 'accepted') return { bg: '#3ecf8e', label: 'Accepted' };
  if (s === 'rejected') return { bg: '#b3261e', label: 'Rejected' };
  return { bg: '#2a86ff', label: 'Sent' };
};

// tolerant parser (handles commas & stray chars)
const toNum = (t) => {
  if (t == null) return 0;
  const cleaned = String(t).replace(',', '.').replace(/[^0-9.]/g, '');
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
};

/** Convert a DB item -> UI item with text fields for live editing */
const toUiItem = (li = {}) => {
  const type = String(li.type || '').toLowerCase();
  const qty  = toNum(li.qty ?? li.quantity ?? li.units ?? li.amount ?? 1);
  const unit = toNum(li.unit_price ?? li.price ?? li.rate ?? li.unitCost ?? li.unit ?? li.cost ?? 0);
  return {
    ...li,
    type,
    qty, unit_price: unit, total: +(qty * unit).toFixed(2),
    qty_text: String(qty),
    unit_text: String(unit),
  };
};

/** Convert a UI item with text fields -> normalized DB/PDF item (canonical keys + mirrors) */
const toDbItem = (ui = {}) => {
  const type = String(ui.type || '').toLowerCase();
  if (type === 'note') return { description: ui.description ?? '', type: 'note' };

  const qty  = toNum(ui.qty_text ?? ui.qty);
  const unit = toNum(ui.unit_text ?? ui.unit_price ?? ui.price ?? ui.rate);
  const total = +(qty * unit).toFixed(2);

  return {
    description: ui.description ?? '',
    type,
    qty,
    quantity: qty,       // legacy mirror
    unit,                // *PDF-friendly* key
    unit_price: unit,    // canonical
    price: unit,         // mirror
    rate: unit,          // mirror
    total,               // recomputed fresh
  };
};

/** Live per-row total from current text values */
const rowTotal = (ui = {}) => {
  if (String(ui.type || '').toLowerCase() === 'note') return 0;
  const qty  = toNum(ui.qty_text ?? ui.qty);
  const unit = toNum(ui.unit_text ?? ui.unit_price ?? ui.price ?? ui.rate);
  return +(qty * unit).toFixed(2);
};

const extractItems = (raw) => {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object') {
    if (Array.isArray(raw.items)) return raw.items;
    if (Array.isArray(raw.data)) return raw.data;
    if (Array.isArray(raw.lines)) return raw.lines;
  }
  return [];
};
const extractTotals = (raw) => {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw;
  if (raw && typeof raw?.data === 'object' && !Array.isArray(raw.data)) return raw.data;
  return {};
};

export default function QuoteDetails() {
  const router = useRouter();
  const { id } = useLocalSearchParams(); // quote id

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [building, setBuilding] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [duping, setDuping] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [profile, setProfile] = useState(null);
  const [isPremium, setIsPremium] = useState(false);

  const [quote, setQuote] = useState(null);
  const [items, setItems] = useState([]);   // UI items with qty_text/unit_text
  const [vatRate, setVatRate] = useState(0); // 0..1

  // derived totals (LIVE from text fields)
  const subtotal   = +(items.reduce((s, li) => s + rowTotal(li), 0)).toFixed(2);
  const vat_amount = +(subtotal * vatRate).toFixed(2);
  const total      = +(subtotal + vat_amount).toFixed(2);

  const readonly = !isPremium;

  const fetchAll = useCallback(async () => {
    try {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.replace('/(auth)/login'); return; }

      // Profile
      const { data: prof, error: pErr } = await supabase
        .from('profiles')
        .select('id, branding, business_name, custom_logo_url, vat_registered, payment_terms, warranty_text')
        .eq('id', user.id).single();
      if (pErr) throw pErr;

      setProfile(prof);
      const pro = String(prof?.branding || '').toLowerCase() === 'premium';
      setIsPremium(pro);

      // Quote
      const { data: q, error: qErr } = await supabase
        .from('quotes')
        .select('id, user_id, quote_number, client_name, client_email, client_phone, client_address, site_address, job_summary, status, pdf_url, line_items, totals, created_at, subtotal, vat_amount, total')
        .eq('id', id).single();
      if (qErr) throw qErr;

      setQuote(q);

      // Items -> UI shape with text fields
      const normalized = extractItems(q.line_items).map(toUiItem);
      setItems(clone(normalized));

      // VAT
      const incomingTotals = extractTotals(q.totals);
      if (incomingTotals?.vat_rate != null) setVatRate(toNum(incomingTotals.vat_rate));
      else setVatRate(prof?.vat_registered ? 0.2 : 0);
    } catch (e) {
      console.error('[TMQ][DETAILS] fetchAll error', e);
      Alert.alert('Error', e?.message ?? 'Could not load quote.');
      router.back();
    } finally {
      setLoading(false);
    }
  }, [id, router]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Text handlers (live)
  const onQtyChange = (idx, t) => {
    setItems(prev => {
      const next = clone(prev);
      const base = { ...(next[idx] || {}) };
      base.qty_text = t;
      base.qty = toNum(t);
      base.quantity = base.qty;
      base.total = rowTotal({ ...base });
      next[idx] = base;
      return next;
    });
  };

  const onUnitChange = (idx, t) => {
    setItems(prev => {
      const next = clone(prev);
      const base = { ...(next[idx] || {}) };
      base.unit_text = t;
      const n = toNum(t);
      base.unit = n;            // *added* for PDF template
      base.unit_price = n;
      base.price = n;
      base.rate = n;
      base.total = rowTotal({ ...base });
      next[idx] = base;
      return next;
    });
  };

  const updateDescOrType = (idx, patch) => {
    setItems(prev => {
      const next = clone(prev);
      next[idx] = { ...(next[idx] || {}), ...patch };
      return next;
    });
  };

  const addRow = (type = 'materials') => {
    setItems(prev => [...prev, toUiItem({ description: 'New item', qty: 1, unit_price: 0, type })]);
  };
  const removeRow = (idx) => setItems(prev => prev.filter((_, i) => i !== idx));

  const setStatus = async (newStatus) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not signed in');
      const normalised = String(newStatus || '').toLowerCase();
      const { error } = await supabase
        .from('quotes')
        .update({ status: normalised })
        .eq('id', quote.id).eq('user_id', user.id);
      if (error) throw error;
      setQuote(q => ({ ...q, status: normalised }));
      Alert.alert('Updated', `Status set to ${normalised}.`);
    } catch (e) {
      console.error('[TMQ][DETAILS] setStatus error', e);
      Alert.alert('Error', e?.message ?? 'Could not update status.');
    }
  };

  // SAVE current edits (used by Save button and before PDF build)
  const persistEdits = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not signed in');

    const itemsForDb = items.map(toDbItem); // normalized + fresh totals
    const payloadTotals = { subtotal, vat_rate: vatRate, vat_amount, total };

    const { error } = await supabase
      .from('quotes')
      .update({
        line_items: itemsForDb,
        totals: payloadTotals,
        subtotal,
        vat_amount,
        total,
        status: (quote.status || '').toLowerCase() === 'draft' ? 'draft' : 'sent',
        updated_at: new Date().toISOString(),
      })
      .eq('id', quote.id).eq('user_id', user.id);
    if (error) throw error;
  };

  const saveEdits = async () => {
    try {
      if (readonly) { Alert.alert('Premium required', 'Editing quotes is a Premium feature.'); return; }
      setSaving(true);
      await persistEdits();
      Alert.alert('Saved', 'Changes saved.');
      await fetchAll();
    } catch (e) {
      console.error('[TMQ][DETAILS] saveEdits error', e);
      Alert.alert('Error', e?.message ?? 'Could not save edits.');
    } finally {
      setSaving(false);
    }
  };

  const previewCurrentPdf = async () => {
    try {
      setPreviewing(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not signed in');

      let readyUrl = quote?.pdf_url || null;
      if (readyUrl && !(await probeUrl(readyUrl))) readyUrl = null;
      if (!readyUrl && quote?.quote_number) {
        const path = `${user.id}/${quote.quote_number}.pdf`;
        readyUrl = await pollSignedUrlReady(path);
      }
      if (!readyUrl) { Alert.alert('No PDF yet', 'Generate a PDF first, then try preview again.'); return; }

      router.push({ pathname: '/(app)/quotes/preview', params: { url: encodeURIComponent(readyUrl), name: `${quote.quote_number}.pdf`, id: quote.id } });
    } catch (e) {
      console.error('[TMQ][DETAILS] preview PDF error', e);
      Alert.alert('Error', e?.message ?? 'Could not open PDF.');
    } finally {
      setPreviewing(false);
    }
  };

  // GENERATE updated PDF
  const rebuildPdf = async () => {
    try {
      if (readonly) { Alert.alert('Premium required', 'Editing quotes is a Premium feature.'); return; }
      setBuilding(true);

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not signed in');

      // 1) persist current edits so builder uses freshest data
      await persistEdits();

      // 2) build new pdf at same path (override)
      const branding = {
        tier: isPremium ? 'premium' : 'free',
        business_name: profile?.business_name || 'Your Business',
        custom_logo_url: profile?.custom_logo_url || null,
      };
      const buildPayload = {
        user_id: user.id,
        branding,
        quote: {
          quote_number: quote.quote_number,
          client_name: quote.client_name,
          client_address: quote.client_address,
          site_address: quote.site_address,
          job_summary: quote.job_summary,
          line_items: items.map(toDbItem), // normalized with fresh totals
          totals: { subtotal, vat_rate: vatRate, vat_amount, total },
          terms: profile?.payment_terms || '',
          warranty: profile?.warranty_text || '',
          powered_by_footer: !isPremium,
        },
      };

      const { data: resp, error: fnErr } = await supabase.functions.invoke('pdf-builder', { body: buildPayload });
      if (fnErr) throw new Error(fnErr.message || 'PDF build failed');
      if (!resp?.ok) throw new Error(resp?.error || 'PDF build failed');

      // 3) get fresh signed URL (same key => overrides original)
      let pdfUrl = resp?.signedUrl || resp?.signed_url || null;
      if (pdfUrl && !(await probeUrl(pdfUrl))) pdfUrl = null;
      if (!pdfUrl) {
        const key = resp?.path || resp?.key || `${user.id}/${quote.quote_number}.pdf`;
        const ready = await pollSignedUrlReady(key);
        if (ready) pdfUrl = ready;
      }

      // 4) store the new url & mark sent
      await supabase.from('quotes')
        .update({ pdf_url: pdfUrl ?? null, status: 'sent' })
        .eq('id', quote.id).eq('user_id', user.id);

      Alert.alert('PDF Ready', 'Your updated PDF has replaced the original.');
      await fetchAll();

      if (pdfUrl) {
        router.push({ pathname: '/(app)/quotes/preview', params: { url: encodeURIComponent(pdfUrl), name: `${quote.quote_number}.pdf`, id: quote.id } });
      }
    } catch (e) {
      console.error('[TMQ][DETAILS] rebuildPdf error', e);
      Alert.alert('Error', e?.message ?? 'Could not generate PDF.');
    } finally {
      setBuilding(false);
    }
  };

  const duplicateQuote = async () => {
    if (!isPremium) {
      Alert.alert('Premium feature', 'Duplicating quotes is available on Premium.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Upgrade', onPress: () => router.push('/(app)/settings/upgrade') },
      ]);
      return;
    }
    try {
      setDuping(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not signed in');
      const { data: nextNo, error: nErr } = await supabase.rpc('next_quote_number', { p_user_id: user.id });
      if (nErr) throw nErr;

      const { data: inserted, error: insErr } = await supabase
        .from('quotes')
        .insert({
          user_id: user.id,
          quote_number: nextNo,
          status: 'draft',
          client_name: quote.client_name || 'Client',
          client_email: quote.client_email || null,
          client_phone: quote.client_phone || null,
          client_address: quote.client_address || null,
          site_address: quote.site_address || null,
          job_summary: quote.job_summary || 'New job',
          job_details: quote.job_details || null,
          line_items: quote.line_items || null,
          subtotal, vat_amount, total,
          pdf_url: null,
        })
        .select('id, quote_number').single();
      if (insErr) throw insErr;

      Alert.alert('Duplicated', `New draft ${inserted.quote_number} created.`);
      router.push({ pathname: '/(app)/quotes/create', params: { quoteId: inserted.id } });
    } catch (e) {
      console.error('[TMQ][DETAILS] duplicateQuote error', e);
      Alert.alert('Error', e?.message ?? 'Could not duplicate quote.');
    } finally {
      setDuping(false);
    }
  };

  const deleteQuote = async () => {
    Alert.alert('Delete quote', `Are you sure you want to delete ${quote.quote_number}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          try {
            setDeleting(true);
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) throw new Error('Not signed in');
            const { error: delErr } = await supabase.from('quotes').delete().eq('id', quote.id);
            if (delErr) throw delErr;
            try { await supabase.storage.from('quotes').remove([`${user.id}/${quote.quote_number}.pdf`]); } catch {}
            Alert.alert('Deleted', 'Quote removed.');
            router.replace('/(app)/quotes/list');
          } catch (e) {
            console.error('[TMQ][DETAILS] deleteQuote error', e);
            Alert.alert('Error', e?.message ?? 'Could not delete quote.');
          } finally { setDeleting(false); }
        }
      },
    ]);
  };

  if (loading || !quote) {
    return <View style={styles.loading}><ActivityIndicator color="#9aa0a6" /></View>;
  }

  const badge = statusStyle(quote.status);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: '#0b0b0c' }} contentContainerStyle={{ padding: 16, paddingBottom: 60 }}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.h1}>{quote.quote_number}</Text>
        <View style={styles.badgeRow}>
          <View style={[styles.badge, { backgroundColor: badge.bg }]}>
            <Text style={styles.badgeText}>{badge.label}</Text>
          </View>
          {!isPremium && (
            <View style={[styles.badge, { backgroundColor: '#2a2b2f', marginLeft: 8 }]}>
              <Text style={styles.badgeText}>Read-only (Free)</Text>
            </View>
          )}
        </View>
        <Text style={styles.client}>{quote.client_name}</Text>
        {!!quote.client_address && <Text style={styles.sub}>{quote.client_address}</Text>}
        {!!quote.site_address && <Text style={styles.sub}>Site: {quote.site_address}</Text>}
      </View>

      {/* Summary */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Job Summary</Text>
        <Text style={styles.bodyText}>{quote.job_summary || '—'}</Text>
      </View>

      {/* Line items */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Line Items</Text>
        {items.length === 0 && <Text style={styles.sub}>No items.</Text>}
        {items.map((li, idx) => {
          const isNote = String(li.type || '').toLowerCase() === 'note';
          return (
            <View key={idx} style={styles.rowItem}>
              <TextInput
                style={[styles.input, styles.flex2]}
                value={String(li.description ?? '')}
                onChangeText={(t) => updateDescOrType(idx, { description: t })}
                editable={!readonly}
                placeholder="Description"
                placeholderTextColor="#888"
              />
              {!isNote && (
                <>
                  <TextInput
                    style={[styles.input, styles.flex1]}
                    value={String(li.qty_text ?? '')}
                    onChangeText={(t) => onQtyChange(idx, t)}
                    editable={!readonly}
                    keyboardType="decimal-pad"
                    inputMode="decimal"
                    placeholder="Qty"
                    placeholderTextColor="#888"
                  />
                  <TextInput
                    style={[styles.input, styles.flex1]}
                    value={String(li.unit_text ?? '')}
                    onChangeText={(t) => onUnitChange(idx, t)}
                    editable={!readonly}
                    keyboardType="decimal-pad"
                    inputMode="decimal"
                    placeholder="Unit £"
                    placeholderTextColor="#888"
                  />
                  <View style={[styles.input, styles.flex1, styles.readCell]}>
                    {/* live line total */}
                    <Text style={styles.readCellText}>{money(rowTotal(li))}</Text>
                  </View>
                </>
              )}
              {!readonly && (
                <TouchableOpacity style={styles.delBtn} onPress={() => removeRow(idx)}>
                  <Text style={styles.delBtnText}>✕</Text>
                </TouchableOpacity>
              )}
              {!!li.type && <Text style={styles.typePill}>{String(li.type).toUpperCase()}</Text>}
            </View>
          );
        })}

        {!readonly && (
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            <TouchableOpacity style={styles.smallBtn} onPress={() => addRow('materials')}>
              <Text style={styles.smallBtnText}>+ Add Material</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.smallBtn} onPress={() => addRow('labour')}>
              <Text style={styles.smallBtnText}>+ Add Labour</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.smallBtn} onPress={() => addRow('other')}>
              <Text style={styles.smallBtnText}>+ Add Other</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.smallBtn} onPress={() => addRow('note')}>
              <Text style={styles.smallBtnText}>+ Add Note</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* Totals (LIVE) */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Totals</Text>
        <View style={styles.kvRow}>
          <Text style={styles.k}>Subtotal</Text>
          <Text style={styles.v}>{money(subtotal)}</Text>
        </View>
        <View style={styles.kvRow}>
          <Text style={styles.k}>VAT Rate</Text>
          {readonly ? (
            <Text style={styles.v}>{(vatRate * 100).toFixed(0)}%</Text>
          ) : (
            <TextInput
              style={[styles.input, { width: 90, textAlign: 'right' }]}
              value={String((vatRate * 100).toFixed(0))}
              onChangeText={(t) => setVatRate(Math.max(0, Math.min(1, toNum(t) / 100)))}
              keyboardType="decimal-pad"
              inputMode="decimal"
              placeholder="%"
              placeholderTextColor="#888"
            />
          )}
        </View>
        <View style={styles.kvRow}>
          <Text style={styles.k}>VAT</Text>
          <Text style={styles.v}>{money(vat_amount)}</Text>
        </View>
        <View style={[styles.kvRow, { marginTop: 4 }]}>
          <Text style={[styles.k, { fontWeight: '800' }]}>Total</Text>
          <Text style={[styles.v, { fontWeight: '800' }]}>{money(total)}</Text>
        </View>
      </View>

      {/* Actions */}
      <View style={{ gap: 10, marginTop: 8, marginBottom: 28 }}>
        <TouchableOpacity
          style={[styles.button, { backgroundColor: '#1f1f21', borderWidth: 1, borderColor: '#34353a', opacity: previewing ? 0.7 : 1 }]}
          onPress={previewCurrentPdf}
          disabled={previewing}
        >
          <Text style={styles.buttonText}>{previewing ? 'Opening…' : 'Preview current PDF'}</Text>
        </TouchableOpacity>

        {!readonly ? (
          <>
            <TouchableOpacity
              style={[styles.button, { backgroundColor: '#3ecf8e', opacity: saving ? 0.7 : 1 }]}
              onPress={saveEdits}
              disabled={saving}
            >
              <Text style={[styles.buttonText, { color: '#0b0b0c' }]}>{saving ? 'Saving…' : 'Save changes'}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.button, { backgroundColor: '#2a86ff', opacity: building ? 0.7 : 1 }]}
              onPress={rebuildPdf}
              disabled={building}
            >
              <Text style={styles.buttonText}>{building ? 'Building PDF…' : 'Generate updated PDF'}</Text>
            </TouchableOpacity>
          </>
        ) : (
          <View>
            <TouchableOpacity
              style={[styles.button, { backgroundColor: '#2a2b2f' }]}
              onPress={() => router.push('/(app)/settings/upgrade')}
            >
              <Text style={styles.buttonText}>Unlock editing (Premium)</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Status quick actions */}
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TouchableOpacity style={[styles.button, { flex: 1, backgroundColor: '#3ecf8e' }]} onPress={() => setStatus('accepted')}>
            <Text style={[styles.buttonText, { color: '#0b0b0c' }]}>Mark Accepted</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.button, { flex: 1, backgroundColor: '#b3261e' }]} onPress={() => setStatus('rejected')}>
            <Text style={styles.buttonText}>Mark Rejected</Text>
          </TouchableOpacity>
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TouchableOpacity style={[styles.button, { flex: 1, backgroundColor: '#2a86ff' }]} onPress={() => setStatus('sent')}>
            <Text style={styles.buttonText}>Mark Sent</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.button, { flex: 1, backgroundColor: '#6b7280' }]} onPress={() => setStatus('draft')}>
            <Text style={styles.buttonText}>Revert to Draft</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={[styles.button, { backgroundColor: isPremium ? '#1f1f21' : '#2a2b2f', borderWidth: 1, borderColor: '#34353a', opacity: duping ? 0.7 : 1 }]}
          onPress={duplicateQuote}
          disabled={duping}
        >
          <Text style={styles.buttonText}>{isPremium ? (duping ? 'Duplicating…' : 'Duplicate') : 'Duplicate (Premium)'}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.button, { backgroundColor: '#b3261e', opacity: deleting ? 0.7 : 1 }]}
          onPress={deleteQuote}
          disabled={deleting}
        >
          <Text style={styles.buttonText}>Delete</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.button, { backgroundColor: '#1f1f21', borderWidth: 1, borderColor: '#34353a' }]}
          onPress={() => router.back()}
        >
          <Text style={styles.buttonText}>Back</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0b0b0c' },

  header: { marginBottom: 12 },
  h1: { color: 'white', fontWeight: '800', fontSize: 22 },
  badgeRow: { flexDirection: 'row', alignItems: 'center', marginTop: 6 },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  badgeText: { color: 'white', fontSize: 12, fontWeight: '700' },
  client: { color: 'white', marginTop: 8, fontSize: 16 },
  sub: { color: '#a9a9ac', marginTop: 4, fontSize: 12 },

  card: { backgroundColor: '#1a1a1b', borderRadius: 16, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: '#2b2c2f' },
  cardTitle: { color: 'white', fontWeight: '800', marginBottom: 10, fontSize: 16 },
  bodyText: { color: '#d1d1d4', lineHeight: 18 },

  rowItem: { marginBottom: 8, backgroundColor: '#151517', borderRadius: 12, padding: 10, borderWidth: 1, borderColor: '#2b2c2f' },
  typePill: { position: 'absolute', right: 10, top: 10, color: '#9aa0a6', fontSize: 11, fontWeight: '700' },

  input: { backgroundColor: '#1d1e21', color: 'white', borderRadius: 10, padding: 10, marginBottom: 8, borderWidth: 1, borderColor: '#2b2c2f' },
  readCell: { justifyContent: 'center' },
  readCellText: { color: 'white', textAlign: 'right' },
  flex1: { flex: 1 },
  flex2: { flex: 2 },

  kvRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 },
  k: { color: '#cfcfd2' },
  v: { color: 'white', fontWeight: '700' },

  smallBtn: { backgroundColor: '#2a86ff', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10 },
  smallBtnText: { color: 'white', fontWeight: '700' },

  button: { borderRadius: 12, padding: 14, alignItems: 'center' },
  buttonText: { color: 'white', fontWeight: '800' },

  delBtn: { position: 'absolute', right: 10, bottom: 10, backgroundColor: '#2a2b2f', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  delBtnText: { color: 'white', fontWeight: '800' },
});