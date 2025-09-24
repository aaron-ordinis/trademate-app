// app/(app)/quotes/[id].js
import React, { useEffect, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView,
  ActivityIndicator, Alert
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '../../../lib/supabase';

/* ---------- small utils ---------- */
const money = (v = 0) => {
  return `£${Number(v || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
};
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
async function pollSignedUrlReady(
  path,
  { tries = 50, baseDelay = 250, step = 250, maxDelay = 1200, ttl = 60 * 60 * 24 * 7 } = {}
) {
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
const toNum = (t) => {
  if (t == null) return 0;
  const cleaned = String(t).replace(',', '.').replace(/[^0-9.]/g, '');
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
};

const toUiItem = (li = {}) => {
  const type = String(li.type || '').toLowerCase();
  const qty = toNum(li.qty ?? li.quantity ?? li.units ?? li.amount ?? 1);
  const unit = toNum(li.unit_price ?? li.price ?? li.rate ?? li.unit ?? li.cost ?? 0);
  return {
    ...li,
    type,
    qty,
    unit_price: unit,
    total: +(qty * unit).toFixed(2),
    qty_text: String(qty),
    unit_text: String(unit),
  };
};

const toDbItem = (ui = {}) => {
  const type = String(ui.type || '').toLowerCase();
  if (type === 'note') return { description: ui.description ?? '', type: 'note' };
  const qty = toNum(ui.qty_text ?? ui.qty);
  const unit = toNum(ui.unit_text ?? ui.unit_price ?? ui.price ?? ui.rate);
  const total = +(qty * unit).toFixed(2);
  return {
    description: ui.description ?? '',
    type,
    qty,
    quantity: qty,
    unit,
    unit_price: unit,
    price: unit,
    rate: unit,
    total,
  };
};

const rowTotal = (ui = {}) => {
  if (String(ui.type || '').toLowerCase() === 'note') return 0;
  const qty = toNum(ui.qty_text ?? ui.qty);
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

/* ---------- component ---------- */
export default function QuoteDetails() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const id = Array.isArray(params?.id) ? params.id[0] : params?.id;

  const [loading, setLoading] = useState(true);
  const [building, setBuilding] = useState(false);

  const [profile, setProfile] = useState(null);
  const [isPremium, setIsPremium] = useState(false); // kept only for branding/footer logic

  const [quote, setQuote] = useState(null);
  const [jobSummary, setJobSummary] = useState('');
  const [items, setItems] = useState([]);
  const [vatRate, setVatRate] = useState(0);

  const [dirty, setDirty] = useState(false);

  const subtotal = +(items.reduce((s, li) => s + rowTotal(li), 0)).toFixed(2);
  const vat_amount = +(subtotal * vatRate).toFixed(2);
  const total = +(subtotal + vat_amount).toFixed(2);

  useEffect(() => {
    let cancelled = false;

    if (!id) { setLoading(false); return; }

    (async () => {
      try {
        setLoading(true);
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) { if (!cancelled) router.replace('/(auth)/login'); return; }

        // Profile
        const { data: prof, error: pErr } = await supabase
          .from('profiles')
          .select('id, branding, business_name, custom_logo_url, vat_registered, payment_terms, warranty_text')
          .eq('id', user.id)
          .single();
        if (pErr) throw pErr;
        if (cancelled) return;

        setProfile(prof);
        setIsPremium(String(prof?.branding || '').toLowerCase() === 'premium');

        // Quote
        const { data: q, error: qErr } = await supabase
          .from('quotes')
          .select('id, user_id, quote_number, client_name, client_email, client_phone, client_address, site_address, job_summary, status, pdf_url, line_items, totals, created_at, subtotal, vat_amount, total, template_key, template_version')
          .eq('id', id)
          .single();

        if (qErr || !q) throw new Error(qErr?.message || 'Quote not found.');
        if (cancelled) return;

        setQuote(q);
        setJobSummary(q.job_summary || '');

        const normalized = extractItems(q.line_items).map(toUiItem);
        setItems(clone(normalized));

        const incomingTotals = extractTotals(q.totals);
        if (incomingTotals?.vat_rate != null) setVatRate(toNum(incomingTotals.vat_rate));
        else setVatRate(prof?.vat_registered ? 0.2 : 0);

        setDirty(false);
      } catch (e) {
        if (!cancelled) {
          console.error('[TMQ][DETAILS] fetchAll error', e);
          Alert.alert('Error', e?.message ?? 'Could not load quote.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [id, router]);

  /* ---------- edit handlers ---------- */
  const onQtyChange = (idx, t) => {
    setDirty(true);
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
    setDirty(true);
    setItems(prev => {
      const next = clone(prev);
      const base = { ...(next[idx] || {}) };
      base.unit_text = t;
      const n = toNum(t);
      base.unit = n;
      base.unit_price = n;
      base.price = n;
      base.rate = n;
      base.total = rowTotal({ ...base });
      next[idx] = base;
      return next;
    });
  };

  const updateDescOrType = (idx, patch) => {
    setDirty(true);
    setItems(prev => {
      const next = clone(prev);
      next[idx] = { ...(next[idx] || {}), ...patch };
      return next;
    });
  };

  const addRow = (type = 'materials') => {
    setDirty(true);
    setItems(prev => [...prev, toUiItem({ description: 'New item', qty: 1, unit_price: 0, type })]);
  };
  const removeRow = (idx) => {
    setDirty(true);
    setItems(prev => (Array.isArray(prev) ? prev : []).filter((_, i) => i !== idx));
  };

  /* ---------- persistence ---------- */
  const persistEdits = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not signed in');

    const itemsForDb = items.map(toDbItem);
    const payloadTotals = { subtotal, vat_rate: vatRate, vat_amount, total };

    const { error } = await supabase
      .from('quotes')
      .update({
        job_summary: jobSummary,
        line_items: itemsForDb,
        totals: payloadTotals,
        subtotal,
        vat_amount,
        total,
        status: (quote?.status || '').toLowerCase() === 'draft' ? 'draft' : 'sent',
        updated_at: new Date().toISOString(),
      })
      .eq('id', quote?.id).eq('user_id', user.id);
    if (error) throw error;
  };

  /* ---------- PDF rebuild (now navigates to Preview) ---------- */
  const rebuildPdf = async () => {
    try {
      if (!dirty) { Alert.alert('No changes', 'Make a change before generating an updated PDF.'); return; }
      setBuilding(true);

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not signed in');

      await persistEdits();

      const branding = {
        tier: isPremium ? 'premium' : 'free',
        business_name: profile?.business_name || 'Your Business',
        custom_logo_url: profile?.custom_logo_url || null,
      };
      const buildPayload = {
        user_id: user.id,
        branding,
        quote: {
          quote_number: quote?.quote_number,
          client_name: quote?.client_name,
          client_address: quote?.client_address,
          site_address: quote?.site_address,
          job_summary: jobSummary,
          line_items: items.map(toDbItem),
          totals: { subtotal, vat_rate: vatRate, vat_amount, total },
          terms: profile?.payment_terms || '',
          warranty: profile?.warranty_text || '',
          powered_by_footer: !isPremium,
        },
      };

      // Template selection passthrough
      let templateSelection = null;
      try {
        if (quote?.template_key && quote?.template_version) {
          templateSelection = { key: String(quote.template_key), version: String(quote.template_version), cb: Date.now().toString() };
          buildPayload.template = templateSelection;
        }
      } catch {}

      const { data: resp, error: fnErr } = await supabase.functions.invoke('pdf-builder', { body: buildPayload });
      if (fnErr) throw new Error(fnErr.message || 'PDF build failed');
      if (!resp?.ok) throw new Error(resp?.error || 'PDF build failed');

      let pdfUrl = resp?.signedUrl || resp?.signed_url || null;
      if (pdfUrl && !(await probeUrl(pdfUrl))) pdfUrl = null;

      if (!pdfUrl) {
        const keyGuess = resp?.path || resp?.key || `${user.id}/${quote?.quote_number}.pdf`;
        const ready = await pollSignedUrlReady(keyGuess);
        if (ready) pdfUrl = ready;
      }

      await supabase.from('quotes')
        .update({
          pdf_url: pdfUrl ?? null,
          status: 'sent',
          template_key: templateSelection?.key || resp?.template_key || null,
          template_version: templateSelection?.version || resp?.template_version || null
        })
        .eq('id', quote?.id).eq('user_id', user.id);

      if (pdfUrl) {
        const name = `${quote?.quote_number || 'quote'}.pdf`;
        router.replace({
          pathname: '/(app)/quotes/preview',
          params: { id: quote?.id || '', url: encodeURIComponent(pdfUrl), name },
        });
        setDirty(false);
        return;
      }

      Alert.alert('PDF generated', 'The file is still becoming available. Open this quote and tap “Preview” in a moment.');
      setDirty(false);
    } catch (e) {
      console.error('[TMQ][DETAILS] rebuildPdf error', e);
      Alert.alert('Error', e?.message ?? 'Could not generate PDF.');
    } finally {
      setBuilding(false);
    }
  };

  if (loading || !quote) {
    return <View style={styles.loading}><ActivityIndicator color="#9aa0a6" /></View>;
  }

  return (
    <View style={{ flex: 1, backgroundColor: BG }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 16, paddingBottom: 140 }}
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.client}>{quote.client_name}</Text>
          {!!quote.client_address && <Text style={styles.sub}>{quote.client_address}</Text>}
          {!!quote.site_address && <Text style={styles.sub}>Site: {quote.site_address}</Text>}
        </View>

        {/* Job summary */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Job summary</Text>
          <TextInput
            style={styles.input}
            value={jobSummary}
            onChangeText={(t) => { setJobSummary(t); setDirty(true); }}
            placeholder="Describe the job"
            placeholderTextColor={MUTED}
            multiline
            editable
          />
        </View>

        {/* Line items */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Line items</Text>

          <Text style={styles.helper}>
            Keep descriptions specific. Use qty + unit for costs. Add notes for context.
          </Text>

          {items.length === 0 && <Text style={styles.sub}>No items.</Text>}

          {items.map((li, idx) => {
            const isNote = String(li.type || '').toLowerCase() === 'note';
            return (
              <View key={idx} style={styles.rowItem}>
                <View style={styles.rowHeader}>
                  {!!li.type && (
                    <View style={styles.typeChip}>
                      <Text style={styles.typeChipText}>{String(li.type).toUpperCase()}</Text>
                    </View>
                  )}
                </View>

                <TextInput
                  style={[styles.input, styles.flex2]}
                  value={String(li.description ?? '')}
                  onChangeText={(t) => updateDescOrType(idx, { description: t })}
                  editable
                  placeholder="Description"
                  placeholderTextColor={MUTED}
                />

                {!isNote && (
                  <View style={styles.rowInline}>
                    <TextInput
                      style={[styles.input, styles.flex1]}
                      value={String(li.qty_text ?? '')}
                      onChangeText={(t) => onQtyChange(idx, t)}
                      editable
                      keyboardType="decimal-pad"
                      inputMode="decimal"
                      placeholder="Qty"
                      placeholderTextColor={MUTED}
                    />
                    <TextInput
                      style={[styles.input, styles.flex1, { marginLeft: 8 }]}
                      value={String(li.unit_text ?? '')}
                      onChangeText={(t) => onUnitChange(idx, t)}
                      editable
                      keyboardType="decimal-pad"
                      inputMode="decimal"
                      placeholder="Unit £"
                      placeholderTextColor={MUTED}
                    />
                    <View style={[styles.input, styles.flex1, styles.readCell, { marginLeft: 8 }]}>
                      <Text style={styles.readCellText}>{money(rowTotal(li))}</Text>
                    </View>
                  </View>
                )}

                <View style={styles.controlsRow}>
                  <TouchableOpacity
                    style={styles.binBtn}
                    onPress={() => removeRow(idx)}
                    accessibilityLabel="Delete line"
                  >
                    <Text style={styles.binIcon}>🗑</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })}

          <View style={styles.addRowWrap}>
            <TouchableOpacity style={styles.smallBtnGhost} onPress={() => addRow('materials')}>
              <Text style={styles.smallBtnGhostText}>+ Material</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.smallBtnGhost} onPress={() => addRow('labour')}>
              <Text style={styles.smallBtnGhostText}>+ Labour</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.smallBtnGhost} onPress={() => addRow('other')}>
              <Text style={styles.smallBtnGhostText}>+ Other</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.smallBtnGhost} onPress={() => addRow('note')}>
              <Text style={styles.smallBtnGhostText}>+ Note</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Totals */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Totals</Text>
          <View style={styles.kvRow}>
            <Text style={styles.k}>Subtotal</Text>
            <Text style={styles.v}>{money(subtotal)}</Text>
          </View>
          <View style={styles.kvRow}>
            <Text style={styles.k}>VAT rate</Text>
            <TextInput
              style={[styles.input, { width: 90, textAlign: 'right' }]}
              value={String((vatRate * 100).toFixed(0))}
              onChangeText={(t) => { setDirty(true); setVatRate(Math.max(0, Math.min(1, toNum(t) / 100))); }}
              keyboardType="decimal-pad"
              inputMode="decimal"
              placeholder="%"
              placeholderTextColor={MUTED}
            />
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
      </ScrollView>

      {/* Sticky mini-summary + action */}
      <View style={styles.stickyBar}>
        <View style={styles.stickyTotals}>
          <Text style={styles.stickyK}>Subtotal</Text>
          <Text style={styles.stickyV}>{money(subtotal)}</Text>
          <Text style={[styles.stickyK, { marginLeft: 16 }]}>VAT</Text>
          <Text style={styles.stickyV}>{money(vat_amount)}</Text>
          <Text style={[styles.stickyK, { marginLeft: 16, fontWeight: '800' }]}>Total</Text>
          <Text style={[styles.stickyV, { fontWeight: '800' }]}>{money(total)}</Text>
        </View>

        <TouchableOpacity
          style={[styles.buttonBlue, { marginTop: 8, opacity: (!dirty || building) ? 0.6 : 1 }]}
          onPress={rebuildPdf}
          disabled={!dirty || building}
          activeOpacity={0.9}
        >
          <Text style={styles.buttonBlueText}>
            {building ? 'Building PDF…' : 'Generate updated PDF'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

/* ---------- Light theme styles ---------- */
const BG = '#f5f7fb';
const CARD = '#ffffff';
const BORDER = '#e6e9ee';
const TEXT = '#111827';
const MUTED = '#6b7280';
const BLUE = '#2a86ff';

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: BG },

  header: { marginBottom: 12 },
  client: { color: TEXT, marginTop: 2, fontSize: 18, fontWeight: '800' },
  sub: { color: MUTED, marginTop: 4, fontSize: 12 },

  card: {
    backgroundColor: CARD,
    borderRadius: 16,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: BORDER,
    shadowColor: '#0b1220',
    shadowOpacity: 0.05,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 },
    elevation: 1,
  },
  cardTitle: { color: TEXT, fontWeight: '800', marginBottom: 8, fontSize: 16 },
  bodyText: { color: '#374151', lineHeight: 20 },
  helper: { color: MUTED, marginBottom: 8, fontSize: 12 },

  rowItem: {
    marginBottom: 10,
    backgroundColor: '#f9fafb',
    borderRadius: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: BORDER,
  },
  rowHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  typeChip: {
    backgroundColor: BLUE,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  typeChipText: { color: '#fff', fontWeight: '800', fontSize: 11, letterSpacing: 0.3 },

  rowInline: { flexDirection: 'row', alignItems: 'center' },

  input: {
    backgroundColor: '#ffffff',
    color: TEXT,
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: BORDER,
  },
  readCell: { justifyContent: 'center' },
  readCellText: { color: TEXT, textAlign: 'right', fontWeight: '700' },
  flex1: { flex: 1 },
  flex2: { flex: 2 },

  controlsRow: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 6 },
  binBtn: {
    backgroundColor: '#ffe8e8',
    borderWidth: 1,
    borderColor: '#ffd0d0',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
  },
  binIcon: { color: '#b3261e', fontWeight: '900' },

  addRowWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
  smallBtnGhost: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: BORDER,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  smallBtnGhostText: { color: TEXT, fontWeight: '700' },

  kvRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 },
  k: { color: '#374151' },
  v: { color: TEXT, fontWeight: '700' },

  stickyBar: {
    position: 'absolute',
    left: 0, right: 0, bottom: 0,
    backgroundColor: CARD,
    borderTopWidth: 1,
    borderColor: BORDER,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 16,
    shadowColor: '#0b1220',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: -6 },
    elevation: 3,
  },
  stickyTotals: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-start' },
  stickyK: { color: MUTED, fontSize: 12 },
  stickyV: { color: TEXT, fontWeight: '800', marginLeft: 6 },

  buttonBlue: { borderRadius: 14, padding: 14, alignItems: 'center', backgroundColor: BLUE },
  buttonBlueText: { color: '#fff', fontWeight: '900' },
});