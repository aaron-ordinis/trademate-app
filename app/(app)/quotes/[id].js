// app/(app)/quotes/[id].js
import React, { useEffect, useState, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView,
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '../../../lib/supabase';

/* ---------- constants ---------- */
// Call the HTML-template renderer (NOT pdf-builder)
const EDGE_FUNCTION_URL =
  'https://bvbjvxjtxfzipwvfkrrb.supabase.co/functions/v1/render_document';

/* ---------- small utils ---------- */
const money = (v = 0) =>
  '£' +
  Number(v || 0)
    .toFixed(2)
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');

const clone = (x) => JSON.parse(JSON.stringify(x ?? null));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Ensure template codes always include ".html" so the edge function
 *  can resolve the exact object in the "templates" bucket. */
const normalizeTemplateCode = (code) => {
  if (!code) return undefined;
  let c = String(code).trim();
  if (!/\.html$/i.test(c)) c += '.html';
  return c.toLowerCase();
};

/* ---------- helpers ---------- */
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
  // what the HTML templates expect
  return {
    description: ui.description ?? '',
    type,
    qty,
    unit: ui.unit ?? (type === 'labour' ? 'hours' : ''),
    unit_price: unit,
    price: unit, // compatibility
    line_total: total,
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

function currencySymbol(code) {
  const c = String(code || 'GBP').toUpperCase();
  if (c === 'GBP' || c === 'UKP') return '£';
  if (c === 'USD') return '$';
  if (c === 'EUR') return '€';
  if (['AUD', 'CAD', 'NZD'].includes(c)) return '$';
  return '£';
}

/* ---------- component ---------- */
export default function QuoteDetails() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const id = Array.isArray(params?.id) ? params.id[0] : params?.id;
  const qParam = Array.isArray(params?.q) ? params.q[0] : params?.q; // encoded JSON from preview
  const passedQuote = qParam ? (() => { try { return JSON.parse(decodeURIComponent(String(qParam))); } catch { return null; } })() : null;

  const [loading, setLoading] = useState(true);
  const [building, setBuilding] = useState(false);
  const [dots, setDots] = useState('.');
  const dotsTimer = useRef(null);

  const [profile, setProfile] = useState(null);
  const [isPremium, setIsPremium] = useState(false);

  const [quoteData, setQuoteData] = useState(null);
  const [jobSummary, setJobSummary] = useState('');
  const [items, setItems] = useState([]);
  const [vatRate, setVatRate] = useState(0);
  const [dirty, setDirty] = useState(false);

  const subtotal = +(items.reduce((s, li) => s + rowTotal(li), 0)).toFixed(2);
  const vat_amount = +(subtotal * vatRate).toFixed(2);
  const total = +(subtotal + vat_amount).toFixed(2);

  // animated dots while building
  useEffect(() => {
    if (building) {
      dotsTimer.current && clearInterval(dotsTimer.current);
      dotsTimer.current = setInterval(() => {
        setDots((d) => (d === '.' ? '..' : d === '..' ? '...' : '.'));
      }, 420);
    } else {
      dotsTimer.current && clearInterval(dotsTimer.current);
      setDots('.');
    }
    return () => { dotsTimer.current && clearInterval(dotsTimer.current); };
  }, [building]);

  // Load profile + quote
  useEffect(() => {
    let cancelled = false;
    if (!id && !passedQuote?.id) { setLoading(false); return; }

    (async () => {
      try {
        setLoading(true);
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) { if (!cancelled) router.replace('/(auth)/login'); return; }

        // Profile (expand fields so seller block is populated)
        const { data: prof } = await supabase
          .from('profiles')
          .select([
            'id',
            'branding',
            'business_name',
            'custom_logo_url',
            'vat_registered',
            'payment_terms',
            'warranty_text',
            'invoice_currency',
            'invoice_tax_rate',
            'address_line1',
            'city',
            'postcode',
            'email',
            'phone',
            'vat_number',
            'company_reg_no'
          ].join(','))
          .eq('id', user.id)
          .single();

        if (cancelled) return;

        setProfile(prof || null);
        setIsPremium(String(prof?.branding || '').toLowerCase() === 'premium');

        // Quote (prefer passed)
        let q = passedQuote || null;
        if (!q) {
          const { data: qData, error: qErr } = await supabase
            .from('quotes')
            .select([
              'id',
              'user_id',
              'quote_number',
              'quote_date',
              'client_name',
              'client_email',
              'client_phone',
              'client_address',
              'site_address',
              'job_summary',
              'status',
              'pdf_url',
              'line_items',
              'totals',
              'created_at',
              'subtotal',
              'vat_amount',
              'total',
              'template_code',
              'template_version',
              'reference'
            ].join(','))
            .eq('id', id)
            .single();
          if (qErr || !qData) throw new Error(qErr?.message || 'Quote not found.');
          q = qData;
        }

        if (cancelled) return;

        setQuoteData(q);
        setJobSummary(q.job_summary || '');
        setItems(clone(extractItems(q.line_items).map(toUiItem)));

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
  }, [id, router, qParam]);

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
        status: (quoteData?.status || '').toLowerCase() === 'draft' ? 'draft' : 'sent',
        updated_at: new Date().toISOString(),
      })
      .eq('id', quoteData?.id);
    if (error) throw error;
  };

  /* ---------- Build Mustache view for HTML templates ---------- */
  const buildTemplateView = () => {
    const currency = profile?.invoice_currency || 'GBP';
    const sym = currencySymbol(currency);

    const doc = {
      title: 'Quote',
      number: String(quoteData?.quote_number || ''),
      issue_date: (quoteData?.quote_date || '').split('T')[0] || new Date().toISOString().slice(0, 10),
      reference: quoteData?.reference || '',
    };

    const seller = {
      company_name: profile?.business_name || '',
      address:
        [profile?.address_line1, [profile?.city, profile?.postcode].filter(Boolean).join(' ')].filter(Boolean).join('\n'),
      email: profile?.email || '',
      phone: profile?.phone || '',
      vat_number: profile?.vat_number || '',
      company_reg_no: profile?.company_reg_no || '',
      // logo is injected by the edge function automatically (logo_url + logo_data_url)
    };

    const client = {
      name: quoteData?.client_name || '',
      address: quoteData?.client_address || '',
    };

    const itemsForTpl = items.map(toDbItem).map((it) => ({
      ...it,
      price: Number(it.unit_price || it.price || 0).toFixed(2),
      line_total: Number(it.line_total ?? (Number(it.qty || 0) * Number(it.unit_price || 0))).toFixed(2),
    }));

    const totals = {
      currency_symbol: sym,
      subtotal: subtotal.toFixed(2),
      tax: vat_amount.toFixed(2),
      total: total.toFixed(2),
      vat_rate_pct: Math.round(vatRate * 100),
    };

    return {
      doc,
      seller,
      client,
      items: itemsForTpl,           // the edge function will also auto-split labour/materials
      totals,
      notes: profile?.payment_terms || '',  // many templates show "Notes"
      extras: {
        job_summary: jobSummary || '',
        assumptions: [],             // keep for templates that render list
      },
    };
  };

  /* ---------- PDF via template-aware edge function ---------- */
  const rebuildPdf = async () => {
    const traceId = Math.random().toString(36).slice(2, 10);

    try {
      setBuilding(true);

      const { data: { session } } = await supabase.auth.getSession();
      const accessToken = session?.access_token;
      const pdfUserId = session?.user?.id;
      if (!accessToken || !pdfUserId) throw new Error('Not signed in');

      // Persist edits first
      await persistEdits();

      const view = buildTemplateView();

      // Normalize code so the edge function doesn't fall back
      const tplVersion = quoteData?.template_version || undefined;
      const tplNorm = normalizeTemplateCode(quoteData?.template_code);

      const body = {
        kind: 'quote',
        user_id: pdfUserId,
        quote_id: quoteData?.id,      // optional (edge can fetch by id if you extend it)
        templateCode: tplNorm,        // explicit normalized code (e.g., "elegant-outline.html")
        data: view,
        output: 'pdf',
        store: {
          bucket: 'quotes',
          path_prefix: `${pdfUserId}/`,
          filename: `${quoteData?.quote_number || 'quote'}.pdf`,
          sign_secs: 60 * 60 * 24 * 7,
        },
        template: tplNorm ? { key: String(tplNorm), version: String(tplVersion || '') } : undefined,
        pdf: {
          page_size: 'A4',
          margin_top: 0,
          margin_right: 0,
          margin_bottom: 0,
          margin_left: 0,
          use_print_css: true,
          print_background: true,
          viewport_width: 1280,
          css_media_type: 'print',
          scale: 100,
        },
      };

      const maybeAnon =
        (typeof process !== 'undefined' && process?.env?.EXPO_PUBLIC_SUPABASE_ANON_KEY) ||
        (supabase && supabase._getSettings && supabase._getSettings()?.headers?.apikey) ||
        undefined;

      console.log('[TMQ] Calling render_document', EDGE_FUNCTION_URL, 'trace', traceId);

      const res = await fetch(EDGE_FUNCTION_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          ...(maybeAnon ? { apikey: String(maybeAnon) } : {}),
          'content-type': 'application/json',
          'x-debug': '1',
          'x-trace-id': traceId,
          'cache-control': 'no-cache',
        },
        body: JSON.stringify(body),
      });

      const raw = await res.text();
      let resp = null;
      try { resp = raw ? JSON.parse(raw) : null; } catch { resp = null; }

      if (!res.ok) {
        console.error('[TMQ] Edge HTTP error', res.status, raw, 'trace', traceId);
        throw new Error(`Edge HTTP ${res.status}: ${resp?.error || raw || 'Unknown error'}`);
      }
      if (!resp?.ok) {
        console.error('[TMQ] Edge logical error', resp, 'trace', traceId);
        throw new Error(resp?.error || 'PDF build failed');
      }

      const nextUrl =
        resp.signed_url || resp.signedUrl || resp.public_url || resp.publicUrl || null;

      if (!nextUrl) {
        throw new Error('PDF created but URL missing. Please try again.');
      }

      // Update quote with new URL + ensure template_code/version saved (normalized)
      try {
        await supabase
          .from('quotes')
          .update({
            pdf_url: nextUrl,
            status: 'sent',
            template_code:
              tplNorm
              ?? normalizeTemplateCode(resp?.templateCode)
              ?? normalizeTemplateCode(quoteData?.template_code)
              ?? null,
            template_version: tplVersion ?? resp?.template_version ?? quoteData?.template_version ?? null,
            subtotal,
            vat_amount,
            total,
            totals: { subtotal, vat_rate: vatRate, vat_amount, total },
          })
          .eq('id', quoteData?.id);
      } catch (e) {
        console.log('[TMQ] Post-build DB update skipped/failed', e);
      }

      // Navigate to Preview
      const name = `${quoteData?.quote_number || 'quote'}.pdf`;
      router.replace({
        pathname: '/(app)/quotes/preview',
        params: { id: quoteData?.id || '', url: encodeURIComponent(nextUrl), name },
      });
      setDirty(false);
    } catch (e) {
      console.error('[TMQ][DETAILS] rebuildPdf error', e);
      Alert.alert('Error', e?.message ?? 'Could not generate PDF.');
    } finally {
      setBuilding(false);
    }
  };

  if (loading || !quoteData) {
    return <View style={styles.loading}><ActivityIndicator color="#9aa0a6" /></View>;
  }

  return (
    <View style={{ flex: 1, backgroundColor: BG }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 12, paddingBottom: 132 }}
          keyboardShouldPersistTaps="handled"
        >
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.client}>{quoteData.client_name}</Text>
            {!!quoteData.client_address && <Text style={styles.sub} numberOfLines={1}>{quoteData.client_address}</Text>}
            {!!quoteData.site_address && <Text style={styles.sub} numberOfLines={1}>Site: {quoteData.site_address}</Text>}
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
                        style={[styles.input, styles.flex1, { marginLeft: 6 }]}
                        value={String(li.unit_text ?? '')}
                        onChangeText={(t) => onUnitChange(idx, t)}
                        editable
                        keyboardType="decimal-pad"
                        inputMode="decimal"
                        placeholder="Unit £"
                        placeholderTextColor={MUTED}
                      />
                      <View style={[styles.input, styles.flex1, styles.readCell, { marginLeft: 6 }]}>
                        <Text style={styles.readCellText}>{money(rowTotal(li))}</Text>
                      </View>
                    </View>
                  )}

                  <View style={styles.controlsRow}>
                    <TouchableOpacity style={styles.binBtn} onPress={() => removeRow(idx)} accessibilityLabel="Delete line">
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
                style={[styles.input, { width: 76, textAlign: 'right', paddingVertical: 8 }]}
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
            <View style={[styles.kvRow, { marginTop: 2 }]}>
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
            <Text style={[styles.stickyK, { marginLeft: 10 }]}>VAT</Text>
            <Text style={styles.stickyV}>{money(vat_amount)}</Text>
            <Text style={[styles.stickyK, { marginLeft: 10, fontWeight: '800' }]}>Total</Text>
            <Text style={[styles.stickyV, { fontWeight: '800' }]}>{money(total)}</Text>
          </View>

          <TouchableOpacity
            style={[styles.buttonBlue, { marginTop: 6, opacity: building ? 0.7 : 1 }]}
            onPress={rebuildPdf}
            disabled={building}
            activeOpacity={0.92}
          >
            {building && <ActivityIndicator style={{ marginRight: 8 }} color="#fff" />}
            <Text style={styles.buttonBlueText}>
              {building ? `Building PDF${dots}` : (dirty ? 'Generate updated PDF' : 'Rebuild PDF')}
            </Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

/* ---------- Compact light theme styles ---------- */
const BG = '#f5f7fb';
const CARD = '#ffffff';
const BORDER = '#e6e9ee';
const TEXT = '#111827';
const MUTED = '#6b7280';
const BLUE = '#2a86ff';

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: BG },

  header: { marginBottom: 8 },
  client: { color: TEXT, fontSize: 16, fontWeight: '800' },
  sub: { color: MUTED, marginTop: 2, fontSize: 11 },

  card: {
    backgroundColor: CARD,
    borderRadius: 12,
    padding: 10,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: BORDER,
    shadowColor: '#0b1220',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 6 },
    elevation: 1,
  },
  cardTitle: { color: TEXT, fontWeight: '800', marginBottom: 6, fontSize: 14.5 },
  bodyText: { color: '#374151', lineHeight: 18 },
  helper: { color: MUTED, marginBottom: 6, fontSize: 11 },

  rowItem: {
    marginBottom: 8,
    backgroundColor: '#f9fafb',
    borderRadius: 10,
    padding: 8,
    borderWidth: 1,
    borderColor: BORDER,
  },
  rowHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  typeChip: { backgroundColor: BLUE, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  typeChipText: { color: '#fff', fontWeight: '800', fontSize: 10.5, letterSpacing: 0.2 },

  rowInline: { flexDirection: 'row', alignItems: 'center' },

  input: {
    backgroundColor: '#ffffff',
    color: TEXT,
    borderRadius: 8,
    paddingVertical: 9,
    paddingHorizontal: 10,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: BORDER,
    fontSize: 14,
  },
  readCell: { justifyContent: 'center' },
  readCellText: { color: TEXT, textAlign: 'right', fontWeight: '700', fontSize: 14 },
  flex1: { flex: 1 },
  flex2: { flex: 2 },

  controlsRow: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 4 },
  binBtn: {
    backgroundColor: '#ffe8e8',
    borderWidth: 1,
    borderColor: '#ffd0d0',
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 8,
  },
  binIcon: { color: '#b3261e', fontWeight: '900' },

  addRowWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  smallBtnGhost: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: BORDER,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 8,
  },
  smallBtnGhostText: { color: TEXT, fontWeight: '700', fontSize: 13 },

  kvRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 },
  k: { color: '#374151', fontSize: 13 },
  v: { color: TEXT, fontWeight: '700', fontSize: 13 },

  stickyBar: {
    position: 'absolute',
    left: 0, right: 0, bottom: 0,
    backgroundColor: CARD,
    borderTopWidth: 1,
    borderColor: BORDER,
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 14,
    shadowColor: '#0b1220',
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: -5 },
    elevation: 3,
  },
  stickyTotals: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-start' },
  stickyK: { color: MUTED, fontSize: 11 },
  stickyV: { color: TEXT, fontWeight: '800', marginLeft: 4, fontSize: 12.5 },

  buttonBlue: {
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: BLUE,
    flexDirection: 'row',
    justifyContent: 'center',
  },
  buttonBlueText: { color: '#fff', fontWeight: '900', fontSize: 15 },
});