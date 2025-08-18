// app/(app)/quotes/[id].js
import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView,
  ActivityIndicator, Alert
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '../../../lib/supabase';

const money = (v = 0) =>
  `£${Number(v || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;

const clone = (x) => JSON.parse(JSON.stringify(x || null));

/* ---------- Supabase Storage PDF helpers ---------- */
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
    if (res.ok) return true;
    return false;
  } catch { return false; }
}
async function pollSignedUrlReady(path, {
  tries = 50,
  baseDelay = 250,
  step = 250,
  maxDelay = 1200,
  signedUrlTtl = 60 * 60 * 24 * 7,
} = {}) {
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

/* ---------- helpers ---------- */
const statusStyle = (status) => {
  const s = String(status || '').toLowerCase();
  if (s === 'draft')    return { bg: '#6b7280', label: 'Draft' };
  if (s === 'sent')     return { bg: '#2a86ff', label: 'Sent' };
  if (s === 'accepted') return { bg: '#3ecf8e', label: 'Accepted' };
  if (s === 'rejected') return { bg: '#b3261e', label: 'Rejected' };
  return { bg: '#2a86ff', label: 'Sent' };
};

// Normalize a line item so it always has qty, unit_price and total (unless it's a note)
const normalizeItem = (li = {}) => {
  const isNote = String(li.type || '').toLowerCase() === 'note';
  if (isNote) return { ...li };
  const qty  = Number(li.qty ?? li.quantity ?? 1) || 0;
  const unit = Number(li.unit_price ?? 0) || 0;
  const total = Number.isFinite(Number(li.total))
    ? Number(li.total)
    : +(qty * unit).toFixed(2);
  return { ...li, qty, unit_price: unit, total };
};

// Safely extract an array of items from various JSON shapes
const extractItems = (raw) => {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object') {
    if (Array.isArray(raw.items)) return raw.items;
    if (Array.isArray(raw.data)) return raw.data;
    if (Array.isArray(raw.lines)) return raw.lines;
  }
  return [];
};

// Safely extract totals from various JSON shapes
const extractTotals = (raw) => {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw;
  // common nested shape like { data: { subtotal, ... } }
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
  const [items, setItems] = useState([]);
  const [totals, setTotals] = useState({ subtotal: 0, vat_rate: 0, vat_amount: 0, total: 0 });

  const [readonly, setReadonly] = useState(true); // toggled by branding

  // Prevent the first post-load items change from overwriting stored totals
  const skipFirstItemsRecalcRef = useRef(true);

  const fetchAll = useCallback(async () => {
    try {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.replace('/(auth)/login'); return; }

      // Profile
      const { data: prof, error: pErr } = await supabase
        .from('profiles')
        .select('id, branding, business_name, custom_logo_url, vat_registered, payment_terms, warranty_text')
        .eq('id', user.id)
        .single();
      if (pErr) throw pErr;

      setProfile(prof);
      const _isPremium = String(prof?.branding || '').toLowerCase() === 'premium';
      setIsPremium(_isPremium);
      setReadonly(!_isPremium);

      // Quote (include JSON fields)
      const { data: q, error: qErr } = await supabase
        .from('quotes')
        .select('id, user_id, quote_number, client_name, client_email, client_phone, client_address, site_address, job_summary, status, pdf_url, line_items, totals, created_at, subtotal, vat_amount, total')
        .eq('id', id)
        .single();
      if (qErr) throw qErr;

      setQuote(q);

      // ---- Extract & normalize items (handles array OR {items:[]}/{data:[]}/{lines:[]})
      const rawItems = extractItems(q.line_items);
      const normalised = rawItems.map(normalizeItem);
      setItems(clone(normalised));

      // ---- Totals: try nested shapes, then compute from items, then numeric columns
      const vatRegisteredRate = (typeof prof?.vat_registered === 'boolean' && prof.vat_registered) ? 0.2 : 0;
      const incoming = extractTotals(q?.totals);

      let nextTotals;
      const hasIncoming =
        incoming &&
        (incoming.subtotal != null || incoming.vat_amount != null || incoming.total != null);

      if (hasIncoming) {
        nextTotals = {
          subtotal: Number(incoming.subtotal ?? 0),
          vat_rate: Number(incoming.vat_rate ?? vatRegisteredRate),
          vat_amount: Number(incoming.vat_amount ?? 0),
          total: Number(incoming.total ?? 0),
        };
      } else if (normalised.length > 0) {
        const subtotal = +normalised.reduce((s, li) => s + Number(li?.total || 0), 0).toFixed(2);
        const vat_rate = vatRegisteredRate;
        const vat_amount = +(subtotal * vat_rate).toFixed(2);
        const total = +(subtotal + vat_amount).toFixed(2);
        nextTotals = { subtotal, vat_rate, vat_amount, total };
      } else {
        nextTotals = {
          subtotal: Number(q.subtotal ?? 0),
          vat_rate: vatRegisteredRate,
          vat_amount: Number(q.vat_amount ?? 0),
          total: Number(q.total ?? 0),
        };
      }

      setTotals(nextTotals);

      // Arm the "skip-once" for the next items effect pass
      skipFirstItemsRecalcRef.current = true;
    } catch (e) {
      console.error('[TMQ][DETAILS] fetchAll error', e);
      Alert.alert('Error', e?.message ?? 'Could not load quote.');
      router.back();
    } finally {
      setLoading(false);
    }
  }, [id, router]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Recalculate totals when items change (but skip once right after load)
  useEffect(() => {
    if (skipFirstItemsRecalcRef.current) {
      skipFirstItemsRecalcRef.current = false;
      return; // don't clobber DB totals on initial load
    }
    const subtotal = +(items || []).reduce((s, li) => s + Number(li?.total || 0), 0).toFixed(2);
    const vat_rate = Number(totals?.vat_rate || 0);
    const vat_amount = +(subtotal * vat_rate).toFixed(2);
    const total = +(subtotal + vat_amount).toFixed(2);
    setTotals(prev => ({ ...prev, subtotal, vat_amount, total }));
  }, [items]); // eslint-disable-line

  const setVatRate = (v) => {
    const r = Math.max(0, Math.min(1, Number(v) || 0));
    const subtotal = +(items || []).reduce((s, li) => s + Number(li?.total || 0), 0).toFixed(2);
    const vat_amount = +(subtotal * r).toFixed(2);
    const total = +(subtotal + vat_amount).toFixed(2);
    setTotals({ subtotal, vat_rate: r, vat_amount, total });
  };

  const updateRow = (idx, patch) => {
    setItems(prev => {
      const next = clone(prev);
      const row = normalizeItem({ ...(next[idx] || {}), ...patch });
      next[idx] = row;
      return next;
    });
  };

  const addRow = (type = 'materials') => {
    setItems(prev => [
      ...prev,
      { description: 'New item', qty: 1, unit_price: 0, total: 0, type },
    ]);
  };

  const removeRow = (idx) => setItems(prev => prev.filter((_, i) => i !== idx));

  // Change status helper (fixed)
  const setStatus = async (newStatus) => {
    try {
      const normalised = String(newStatus || '').toLowerCase();
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      if (!currentUser) throw new Error('Not signed in');

      const { error } = await supabase
        .from('quotes')
        .update({ status: normalised })
        .eq('id', quote.id)
        .eq('user_id', currentUser.id);
      if (error) throw error;

      setQuote((q) => ({ ...q, status: normalised }));
      Alert.alert('Updated', `Status set to ${normalised}.`);
    } catch (e) {
      console.error('[TMQ][DETAILS] setStatus error', e);
      Alert.alert('Error', e?.message ?? 'Could not update status.');
    }
  };

  const saveEdits = async () => {
    try {
      if (readonly) { Alert.alert('Premium required', 'Editing quotes is a Premium feature.'); return; }
      setSaving(true);
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      if (!currentUser) throw new Error('Not signed in');

      const { error } = await supabase
        .from('quotes')
        .update({
          line_items: items, // saved as a flat array
          totals: {
            subtotal: totals.subtotal,
            vat_rate: totals.vat_rate,
            vat_amount: totals.vat_amount,
            total: totals.total,
          },
          subtotal: totals.subtotal,
          vat_amount: totals.vat_amount,
          total: totals.total,
          status: (quote.status || '').toLowerCase() === 'draft' ? 'draft' : 'sent',
          updated_at: new Date().toISOString(),
        })
        .eq('id', quote.id)
        .eq('user_id', currentUser.id);
      if (error) throw error;

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
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      if (!currentUser) throw new Error('Not signed in');

      let readyUrl = quote?.pdf_url || null;
      if (readyUrl) {
        const ok = await probeUrl(readyUrl);
        if (!ok) readyUrl = null;
      }
      if (!readyUrl && quote?.quote_number) {
        const path = `${currentUser.id}/${quote.quote_number}.pdf`;
        readyUrl = await pollSignedUrlReady(path);
      }
      if (!readyUrl) { Alert.alert('No PDF yet', 'Generate a PDF first, then try preview again.'); return; }

      router.push({
        pathname: '/(app)/quotes/preview',
        params: { url: encodeURIComponent(readyUrl), name: `${quote.quote_number}.pdf`, id: quote.id },
      });
    } catch (e) {
      console.error('[TMQ][DETAILS] preview PDF error', e);
      Alert.alert('Error', e?.message ?? 'Could not open PDF.');
    } finally {
      setPreviewing(false);
    }
  };

  const rebuildPdf = async () => {
    try {
      setBuilding(true);
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      if (!currentUser) throw new Error('Not signed in');

      const branding = {
        tier: isPremium ? 'premium' : 'free',
        business_name: profile?.business_name || 'Your Business',
        custom_logo_url: profile?.custom_logo_url || null,
      };

      const payload = {
        user_id: currentUser.id,
        branding,
        quote: {
          quote_number: quote.quote_number,
          client_name: quote.client_name,
          client_address: quote.client_address,
          site_address: quote.site_address,
          job_summary: quote.job_summary,
          line_items: items,
          totals: {
            subtotal: totals.subtotal,
            vat_rate: totals.vat_rate,
            vat_amount: totals.vat_amount,
            total: totals.total,
          },
          terms: profile?.payment_terms || '',
          warranty: profile?.warranty_text || '',
          powered_by_footer: !isPremium,
        },
      };

      const { data: resp, error: fnErr } = await supabase.functions.invoke('pdf-builder', { body: payload });
      if (fnErr) throw new Error(fnErr.message || 'PDF build failed');
      if (!resp?.ok) throw new Error(resp?.error || 'PDF build failed');

      let pdfUrl = resp?.signedUrl || resp?.signed_url || null;
      if (pdfUrl) { const ok = await probeUrl(pdfUrl); if (!ok) pdfUrl = null; }
      if (!pdfUrl) {
        const path = resp?.path || resp?.key || `${currentUser.id}/${quote.quote_number}.pdf`;
        const ready = await pollSignedUrlReady(path);
        if (ready) pdfUrl = ready;
      }

      await supabase
        .from('quotes')
        .update({ pdf_url: pdfUrl ?? null, status: 'sent' })
        .eq('id', quote.id)
        .eq('user_id', currentUser.id);

      Alert.alert('PDF Ready', 'Your updated PDF has been generated.');
      await fetchAll();

      if (pdfUrl) {
        router.push({
          pathname: '/(app)/quotes/preview',
          params: { url: encodeURIComponent(pdfUrl), name: `${quote.quote_number}.pdf`, id: quote.id },
        });
      }
    } catch (e) {
      console.error('[TMQ][DETAILS] rebuildPdf error', e);
      Alert.alert('Error', e?.message ?? 'Could not generate PDF.');
    } finally {
      setBuilding(false);
    }
  };

  // Premium-gated duplicate
  const duplicateQuote = async () => {
    if (!isPremium) {
      Alert.alert(
        'Premium feature',
        'Duplicating quotes is available on Premium.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Upgrade', onPress: () => router.push('/(app)/settings/upgrade') },
        ]
      );
      return;
    }

    try {
      setDuping(true);
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      if (!currentUser) throw new Error('Not signed in');

      const { data: nextNo, error: nErr } = await supabase.rpc('next_quote_number', { p_user_id: currentUser.id });
      if (nErr) throw nErr;

      const { error: insErr, data: inserted } = await supabase
        .from('quotes')
        .insert({
          user_id: currentUser.id,
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
          subtotal: totals.subtotal ?? null,
          vat_amount: totals.vat_amount ?? null,
          total: totals.total ?? null,
          pdf_url: null,
        })
        .select('id, quote_number')
        .single();

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

  // Delete (fix: use currentUser everywhere)
  const deleteQuote = async () => {
    Alert.alert(
      'Delete quote',
      `Are you sure you want to delete ${quote.quote_number}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              setDeleting(true);
              const { data: { user: deleteUser } } = await supabase.auth.getUser();
              if (!deleteUser) throw new Error('Not signed in');

              const { error: delErr } = await supabase.from('quotes').delete().eq('id', quote.id);
              if (delErr) throw delErr;

              // best-effort storage cleanup
              const path = `${deleteUser.id}/${quote.quote_number}.pdf`;
              try { await supabase.storage.from('quotes').remove([path]); } catch {}

              Alert.alert('Deleted', 'Quote removed.');
              router.replace('/(app)/quotes/list');
            } catch (e) {
              console.error('[TMQ][DETAILS] deleteQuote error', e);
              Alert.alert('Error', e?.message ?? 'Could not delete quote.');
            } finally {
              setDeleting(false);
            }
          },
        },
      ]
    );
  };

  const badge = statusStyle(quote?.status);

  const header = (
    <View style={styles.header}>
      <Text style={styles.h1}>{quote?.quote_number}</Text>
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
      <Text style={styles.client}>{quote?.client_name}</Text>
      {!!quote?.client_address && <Text style={styles.sub}>{quote.client_address}</Text>}
      {!!quote?.site_address && <Text style={styles.sub}>Site: {quote.site_address}</Text>}
    </View>
  );

  const summary = (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Job Summary</Text>
      <Text style={styles.bodyText}>{quote?.job_summary || '—'}</Text>
    </View>
  );

  const lines = (
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
              onChangeText={(t) => updateRow(idx, { description: t })}
              editable={!readonly}
              placeholder="Description"
              placeholderTextColor="#888"
            />
            {!isNote && (
              <>
                <TextInput
                  style={[styles.input, styles.flex1]}
                  value={String(li.qty ?? 1)}
                  onChangeText={(t) => updateRow(idx, { qty: Number(t.replace(/[^0-9.]/g, '')) || 0 })}
                  editable={!readonly}
                  keyboardType="decimal-pad"
                  placeholder="Qty"
                  placeholderTextColor="#888"
                />
                <TextInput
                  style={[styles.input, styles.flex1]}
                  value={String(li.unit_price ?? 0)}
                  onChangeText={(t) => updateRow(idx, { unit_price: Number(t.replace(/[^0-9.]/g, '')) || 0 })}
                  editable={!readonly}
                  keyboardType="decimal-pad"
                  placeholder="Unit £"
                  placeholderTextColor="#888"
                />
                <View style={[styles.input, styles.flex1, styles.readCell]}>
                  <Text style={styles.readCellText}>{money(li.total || 0)}</Text>
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
  );

  const totalsCard = (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Totals</Text>
      <View style={styles.kvRow}>
        <Text style={styles.k}>Subtotal</Text>
        <Text style={styles.v}>{money(totals.subtotal)}</Text>
      </View>
      <View style={styles.kvRow}>
        <Text style={styles.k}>VAT Rate</Text>
        {readonly ? (
          <Text style={styles.v}>{(totals.vat_rate * 100).toFixed(0)}%</Text>
        ) : (
          <TextInput
            style={[styles.input, { width: 90, textAlign: 'right' }]}
            value={String((totals.vat_rate * 100).toFixed(0))}
            onChangeText={(t) => setVatRate((Number(t.replace(/[^0-9.]/g, '')) || 0) / 100)}
            keyboardType="decimal-pad"
            placeholder="%"
            placeholderTextColor="#888"
          />
        )}
      </View>
      <View style={styles.kvRow}>
        <Text style={styles.k}>VAT</Text>
        <Text style={styles.v}>{money(totals.vat_amount)}</Text>
      </View>
      <View style={[styles.kvRow, { marginTop: 4 }]}>
        <Text style={[styles.k, { fontWeight: '800' }]}>Total</Text>
        <Text style={[styles.v, { fontWeight: '800' }]}>{money(totals.total)}</Text>
      </View>
    </View>
  );

  const actions = (
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

      {/* Duplicate (Premium) */}
      <TouchableOpacity
        style={[styles.button, { backgroundColor: isPremium ? '#1f1f21' : '#2a2b2f', borderWidth: 1, borderColor: '#34353a', opacity: duping ? 0.7 : 1 }]}
        onPress={duplicateQuote}
        disabled={duping}
      >
        <Text style={styles.buttonText}>{isPremium ? (duping ? 'Duplicating…' : 'Duplicate') : 'Duplicate (Premium)'}</Text>
      </TouchableOpacity>

      {/* Delete */}
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
  );

  if (loading || !quote) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color="#9aa0a6" />
      </View>
    );
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: '#0b0b0c' }} contentContainerStyle={{ padding: 16, paddingBottom: 60 }}>
      {header}
      {summary}
      {lines}
      {totalsCard}
      {actions}
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