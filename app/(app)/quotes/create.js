// app/(app)/quotes/create.js
// GB-only address search with manual edit step + refreshed UI.
// Job details: larger field, 250-char limit with live counter and emphasis.

import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView,
  KeyboardAvoidingView, Platform, ActivityIndicator, Modal, FlatList
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '../../../lib/supabase';
import {
  User as IconUser,
  FileText as IconFileText,
  Car as IconCar,
  Search as IconSearch,
  Edit3 as IconEdit,
} from 'lucide-react-native';

/* ---------------- theme ---------------- */
const BRAND = {
  primary: '#1e40af',
  accent:  '#22c55e',
  bg:      '#f6f9ff',
  text:    '#0f172a',
  subtle:  '#64748b',
  border:  '#e5e7eb',
  warn:    '#b91c1c',
  amber:   '#b45309',
};

/* ---------------- limits ---------------- */
const MAX_JOB_DETAILS = 250;
const COUNTER_AMBER_AT = 200;

/* ---------------- utils ---------------- */
const num = (v, d = 0) => {
  const n = Number(String(v).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : d;
};
const haversineMiles = (lat1, lon1, lat2, lon2) => {
  const toRad = (x) => (x * Math.PI) / 180;
  const R_km = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return (R_km * c) * 0.621371; // miles
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const uuid4 = () =>
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });

async function probeUrl(url) {
  const bust = 'cb=' + Date.now() + '&r=' + Math.random().toString(36).slice(2);
  const u = url && url.indexOf('?') >= 0 ? url + '&' + bust : url + '?' + bust;
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
async function pollSignedUrlReady(
  path,
  { tries = 60, baseDelay = 300, step = 300, maxDelay = 1200, signedUrlTtl = 60 * 60 * 24 * 7 } = {}
) {
  if (!path) return null;
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

/* -------------- phases fallback -------------- */
function buildFallbackPhases(summary, details) {
  const s = (summary || '').trim();
  const d = (details || '').trim();
  const tasks = [];
  if (d) d.split(/\r?\n|[.;] /).map(t => t.trim()).filter(Boolean).slice(0, 8).forEach(t => tasks.push(t));
  else if (s) tasks.push(s);
  if (!tasks.length) tasks.push('Attend site and complete works as described.');
  return [{ name: 'Scope of Work', tasks }];
}

/* -------------- insert helper -------------- */
const tryInsertWithUniqueQuoteNumber = async (row, userId) => {
  for (let i = 0; i < 2; i++) {
    const { data, error } = await supabase.from('quotes').insert(row).select('id').single();
    if (!error) return data;
    const msg = error?.message || '';
    if (error?.code === '23505' || msg.includes('quotes_user_quoteno_uidx')) {
      const { data: fresh } = await supabase.rpc('next_quote_number', { p_user_id: userId });
      row.quote_number = fresh;
      continue;
    }
    throw error;
  }
  throw new Error('Could not allocate a unique quote number');
};

/* -------------- quota helper -------------- */
const checkDailyQuota = async (userId) => {
  try {
    const { data, error } = await supabase.rpc('can_create_quote', { p_user_id: userId });
    if (error) {
      console.warn('[TMQ][CREATE] can_create_quote RPC error, allowing by default:', error.message);
      return true;
    }
    return !!data;
  } catch (e) {
    console.warn('[TMQ][CREATE] can_create_quote threw, allowing by default:', e?.message || e);
    return true;
  }
};

/* ---------------- Nice Alert ---------------- */
function useNiceAlert() {
  const [alertState, setAlertState] = useState({ visible: false, title: '', message: '' });
  const show = useCallback((title, message) => setAlertState({ visible: true, title, message }), []);
  const hide = useCallback(() => setAlertState(a => ({ ...a, visible: false })), []);
  const AlertView = useCallback(() => {
    if (!alertState.visible) return null;
    return (
      <View style={styles.alertBackdrop} pointerEvents="box-none">
        <View style={styles.alertCard}>
          <Text style={styles.alertTitle}>{alertState.title}</Text>
          <Text style={styles.alertMsg}>{alertState.message}</Text>
          <TouchableOpacity onPress={hide} style={styles.alertBtn} accessibilityRole="button" accessibilityLabel="Close alert">
            <Text style={styles.alertBtnText}>OK</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }, [alertState, hide]);
  return { show, AlertView };
}

/* ---------------- Address Search + Manual Edit Modal (GB only) ---------------- */
function AddressModal({ visible, onClose, onUse, initialText, GOOGLE }) {
  // modes: 'search' -> show autocomplete; 'edit' -> manual field
  const [mode, setMode] = useState('search');
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sessionToken, setSessionToken] = useState(uuid4());
  const [editValue, setEditValue] = useState('');

  useEffect(() => {
    if (!visible) return;
    setSessionToken(uuid4());
    const hasExisting = (initialText || '').trim().length > 0;
    setMode(hasExisting ? 'edit' : 'search');
    setQuery(hasExisting ? initialText : '');
    setEditValue(hasExisting ? initialText : '');
    setSuggestions([]);
    setBusy(false);
    setError('');
  }, [visible, initialText]);

  // search
  const debounceRef = useRef();
  useEffect(() => {
    if (!visible || mode !== 'search') return;
    const q = (query || '').trim();
    if (q.length < 3) { setSuggestions([]); return; }
    if (!GOOGLE) { setError('Google key missing. Set EXPO_PUBLIC_GOOGLE_MAPS_KEY.'); return; }
    setError('');
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        setBusy(true);
        const url =
          'https://maps.googleapis.com/maps/api/place/autocomplete/json'
          + '?input=' + encodeURIComponent(q)
          + '&types=address&components=country:gb'
          + '&sessiontoken=' + sessionToken
          + '&key=' + GOOGLE;
        const res = await fetch(url);
        const j = await res.json();
        const preds = Array.isArray(j?.predictions) ? j.predictions : [];
        setSuggestions(preds);
      } catch (e) {
        console.warn('[TMQ][PLACES] autocomplete', e?.message || e);
        setSuggestions([]);
      } finally {
               setBusy(false);
      }
    }, 160);
    return () => clearTimeout(debounceRef.current);
  }, [query, GOOGLE, sessionToken, visible, mode]);

  // details + go to edit
  const fetchDetails = useCallback(async (placeId) => {
    if (!GOOGLE || !placeId) return null;
    const fields = 'formatted_address';
    const url =
      'https://maps.googleapis.com/maps/api/place/details/json'
      + '?place_id=' + encodeURIComponent(placeId)
      + '&fields=' + fields
      + '&sessiontoken=' + sessionToken
      + '&key=' + GOOGLE;
    try {
      const res = await fetch(url);
      const j = await res.json();
      return j?.result || null;
    } catch (e) {
      console.warn('[TMQ][PLACES] details', e?.message || e);
      return null;
    }
  }, [GOOGLE, sessionToken]);

  const normaliseFormatted = (s) =>
    String(s || '').replace(/,\s*UK$/i, '').replace(/,\s*United Kingdom$/i, '');

  const pickSuggestion = useCallback(async (item) => {
    setBusy(true);
    try {
      const details = await fetchDetails(item.place_id);
      const formatted = normaliseFormatted(details?.formatted_address || item?.description || '');
      setEditValue(formatted);
      setMode('edit');
    } finally {
      setBusy(false);
    }
  }, [fetchDetails]);

  const canUse = (editValue || '').trim().length >= 6;
  const clearAll = () => {
    setQuery('');
    setSuggestions([]);
    setEditValue('');
    setError('');
    setMode('search');
  };

  return (
    <Modal transparent visible={visible} animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.modalBackdrop}
      >
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>
            {mode === 'search' ? 'Search Address (GB)' : 'Edit Address'}
          </Text>

          {mode === 'search' ? (
            <>
              <View style={{ position: 'relative', marginBottom: 8 }}>
                <TextInput
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Start typing address…"
                  placeholderTextColor={BRAND.subtle}
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={styles.input}
                  accessibilityLabel="Address search input"
                />
                {busy && <View style={{ position: 'absolute', right: 12, top: 12 }}><ActivityIndicator size="small" /></View>}
              </View>

              {Array.isArray(suggestions) && suggestions.length > 0 && (
                <View style={styles.suggestBox}>
                  <FlatList
                    data={suggestions}
                    keyExtractor={(it) => String(it.place_id)}
                    keyboardShouldPersistTaps="handled"
                    renderItem={({ item }) => (
                      <TouchableOpacity style={styles.suggestRow} onPress={() => pickSuggestion(item)} accessibilityLabel={"Select " + item.description}>
                        <IconSearch size={18} color={BRAND.text} style={{ marginRight: 8 }} />
                        <Text style={styles.suggestText}>{item.description}</Text>
                      </TouchableOpacity>
                    )}
                  />
                </View>
              )}

              <TouchableOpacity onPress={() => { setMode('edit'); setEditValue(query); }} style={{ alignSelf: 'flex-start', marginTop: 6 }} accessibilityRole="button" accessibilityLabel="Enter address manually">
                <Text style={{ color: BRAND.primary, fontWeight: '700' }}>Enter manually</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <TextInput
                value={editValue}
                onChangeText={setEditValue}
                placeholder="Full address (you can add flat number, corrections, etc.)"
                placeholderTextColor={BRAND.subtle}
                style={[styles.input, { minHeight: 110, textAlignVertical: 'top', fontSize: 16 }]}
                multiline
                accessibilityLabel="Edit full address"
              />
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
                <TouchableOpacity onPress={() => setMode('search')} style={[styles.modalAltBtn, { backgroundColor: '#e5e7eb', flex: 1 }]} accessibilityRole="button" accessibilityLabel="Back to search">
                  <Text style={[styles.modalAltBtnText, { color: BRAND.text }]}>Back to search</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => { if (canUse) { onUse(editValue.trim()); onClose(); } }}
                  disabled={!canUse}
                  style={[styles.modalAltBtn, { backgroundColor: BRAND.accent, flex: 1, opacity: canUse ? 1 : 0.6 }]}
                  accessibilityRole="button"
                  accessibilityLabel="Use edited address"
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <IconEdit size={16} color={BRAND.text} />
                    <Text style={[styles.modalAltBtnText, { color: BRAND.text }]}>Use Address</Text>
                  </View>
                </TouchableOpacity>
              </View>
            </>
          )}

          {!!error && <Text style={{ color: BRAND.warn, marginTop: 6, fontWeight: '600' }}>{error}</Text>}

          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 }}>
            <TouchableOpacity onPress={clearAll} style={[styles.modalAltBtn, { backgroundColor: '#e5e7eb' }]} accessibilityRole="button" accessibilityLabel="Clear address">
              <Text style={[styles.modalAltBtnText, { color: BRAND.text }]}>Clear</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.modalAltBtn, { backgroundColor: BRAND.text }]} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close address modal">
              <Text style={styles.modalAltBtnText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/* =================== Screen =================== */
export default function CreateQuote() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const quoteId = params?.quoteId ? String(params.quoteId) : null;

  const { show: showAlert, AlertView } = useNiceAlert();

  // Client & job
  const [clientName, setClientName] = useState('');
  const [clientEmail, setClientEmail] = useState('');
  const [clientPhone, setClientPhone] = useState('');
  const [clientAddress, setClientAddress] = useState('');
  const [siteAddress, setSiteAddress] = useState('');

  const [jobSummary, setJobSummary] = useState('');
  const [jobDetails, _setJobDetails] = useState('');
  const jobLen = jobDetails.length;
  const remaining = Math.max(0, MAX_JOB_DETAILS - jobLen);
  const setJobDetails = (t) => _setJobDetails((t || '').slice(0, MAX_JOB_DETAILS));

  // Address modals
  const [billingOpen, setBillingOpen] = useState(false);
  const [siteOpen, setSiteOpen] = useState(false);

  // “Same as billing”
  const [sameAsBilling, setSameAsBilling] = useState(false);
  useEffect(() => { if (sameAsBilling) setSiteAddress(clientAddress); }, [sameAsBilling, clientAddress]);

  // Profile + travel
  const [profile, setProfile] = useState(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileError, setProfileError] = useState(null);
  const [isPremium, setIsPremium] = useState(false);

  const [distanceMiles, setDistanceMiles] = useState('');
  const [travelCharge, setTravelCharge] = useState(0);
  const [autoDistLoading, setAutoDistLoading] = useState(false);

  // Existing quote
  const [existing, setExisting] = useState(null);

  // Quota (free plan)
  const [blockedToday, setBlockedToday] = useState(false);

  // UI
  const [saving, setSaving] = useState(false);
  const [genLoading, setGenLoading] = useState(false);

  const isFinalized = useMemo(
    () => !!existing && String(existing.status || '').toLowerCase() !== 'draft',
    [existing]
  );

  /* ---------------- load profile ---------------- */
  const loadProfile = useCallback(async () => {
    setProfileLoading(true);
    setProfileError(null);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const user = userData?.user;
      if (!user) { router.replace('/(auth)/login'); return null; }

      const { data, error } = await supabase
        .from('profiles')
        .select('id, branding, business_name, trade_type, hourly_rate, materials_markup_pct, vat_registered, payment_terms, warranty_text, travel_rate_per_mile, custom_logo_url, address_line1, city, postcode, hours_per_day')
        .eq('id', user.id)
        .maybeSingle();

      if (error) throw error;
      setProfile(data);
      const _isPremium = String(data?.branding ?? 'free').toLowerCase() === 'premium';
      setIsPremium(_isPremium);

      if (!_isPremium) {
        const ok = await checkDailyQuota(user.id);
        setBlockedToday(!ok);
      } else {
        setBlockedToday(false);
      }

      return data;
    } catch (e) {
      console.error('[TMQ][CREATE] loadProfile error', e);
      setProfileError(e?.message || 'Could not load your profile.');
      setIsPremium(false);
      setBlockedToday(false);
      return null;
    } finally {
      setProfileLoading(false);
    }
  }, [router]);

  useEffect(() => { loadProfile(); }, [loadProfile]);

  const getProfileOrThrow = useCallback(async () => {
    if (profile) return profile;
    if (profileLoading) {
      let tries = 12;
      while (tries-- > 0 && profileLoading && !profile) await sleep(150);
      if (profile) return profile;
    }
    const fresh = await loadProfile();
    if (fresh) return fresh;
    throw new Error('Profile not loaded. Try again.');
  }, [profile, profileLoading, loadProfile]);

  /* --------------- existing quote prefill --------------- */
  useEffect(() => {
    (async () => {
      if (!quoteId) return;
      const { data, error } = await supabase.from('quotes').select('*').eq('id', quoteId).maybeSingle();
      if (error) { console.error('[TMQ][CREATE] existing quote error', error); return; }
      if (data) {
        setExisting(data);
        setClientName(data.client_name || '');
        setClientEmail(data.client_email || '');
        setClientPhone(data.client_phone || '');
        setClientAddress(data.client_address || '');
        setSiteAddress(data.site_address || '');
        setJobSummary(data.job_summary || '');
        try {
          const blob = typeof data.job_details === 'string' ? JSON.parse(data.job_details) : (data.job_details || {});
          if (blob?.travel?.distance_miles != null) setDistanceMiles(String(blob.travel.distance_miles));
          if (blob?.details != null) _setJobDetails(String(blob.details).slice(0, MAX_JOB_DETAILS));
        } catch {}
      }
    })();
  }, [quoteId]);

  /* --------------- travel charge recompute --------------- */
  useEffect(() => {
    const oneWay = num(distanceMiles, 0);
    const rate = num(profile?.travel_rate_per_mile, 0);
    const roundTripCharge = oneWay * 2 * rate;
    setTravelCharge(Math.round(roundTripCharge * 100) / 100);
  }, [distanceMiles, profile]);

  /* --------------- Google helpers --------------- */
  const GOOGLE = process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY || (globalThis?.expo?.env?.EXPO_PUBLIC_GOOGLE_MAPS_KEY);

  const geocodeAddress = async (address) => {
    if (!GOOGLE) return null;
    const clean = String(address || '').replace(/\s*\n+\s*/g, ', ');
    const url = 'https://maps.googleapis.com/maps/api/geocode/json?address=' + encodeURIComponent(clean) + '&key=' + GOOGLE;
    const res = await fetch(url);
    const j = await res.json();
    const loc = j?.results?.[0]?.geometry?.location;
    return loc ? { lat: loc.lat, lng: loc.lng } : null;
  };

  const getDrivingDistanceMiles = async (origLat, origLng, destLat, destLng) => {
    if (!GOOGLE) return null;
    const url = 'https://maps.googleapis.com/maps/api/distancematrix/json?origins='
      + origLat + ',' + origLng + '&destinations=' + destLat + ',' + destLng + '&units=imperial&key=' + GOOGLE;
    const res = await fetch(url);
    const j = await res.json();
    const meters = j?.rows?.[0]?.elements?.[0]?.distance?.value;
    if (!meters && meters !== 0) return null;
    return meters * 0.000621371; // one-way miles
  };

  const buildBusinessAddress = (p) =>
    [p?.address_line1, p?.city, p?.postcode].filter(Boolean).join(', ').trim();

  const autoCalcDistance = useCallback(async () => {
    try {
      const prof = await getProfileOrThrow();
      const addr = (sameAsBilling ? clientAddress : siteAddress) || '';
      if (!addr.trim()) return;

      const originText = buildBusinessAddress(prof);
      if (!originText) { console.warn('[TMQ][DIST] Missing business address in profile'); return; }

      setAutoDistLoading(true);

      const origin = await geocodeAddress(originText);
      const dest = await geocodeAddress(addr.trim());
      if (!origin || !dest) { console.warn('[TMQ][DIST] Geocoding failed'); return; }

      let miles = await getDrivingDistanceMiles(origin.lat, origin.lng, dest.lat, dest.lng);
      if (!miles) miles = haversineMiles(origin.lat, origin.lng, dest.lat, dest.lng);

      const rounded = Math.round(Number(miles) * 100) / 100;
      if (Number.isFinite(rounded)) setDistanceMiles(String(rounded));
    } catch (e) {
      console.warn('[TMQ][DIST] auto distance error', e?.message || e);
    } finally {
      setAutoDistLoading(false);
    }
  }, [clientAddress, siteAddress, sameAsBilling, getProfileOrThrow]);

  useEffect(() => {
    if (!(siteAddress || (sameAsBilling && clientAddress))) return;
    const t = setTimeout(() => { autoCalcDistance(); }, 400);
    return () => clearTimeout(t);
  }, [siteAddress, clientAddress, sameAsBilling, autoCalcDistance]);

  /* ---------------- save draft ---------------- */
  const saveDraftOnly = async () => {
    try {
      if (isFinalized) { showAlert('Locked', 'This quote has already been generated. You can no longer save it as a draft.'); return; }
      setSaving(true);
      const prof = await getProfileOrThrow();
      const { data: userData } = await supabase.auth.getUser();
      const user = userData?.user;
      if (!user) throw new Error('Not signed in');

      if (!existing && !isPremium) {
        const allowed = await checkDailyQuota(user.id);
        if (!allowed) { setBlockedToday(true); showAlert('Daily limit reached', 'Free users can create 1 quote per day. Upgrade to Premium for unlimited quotes.'); return; }
      }

      const blob = {
        summary: jobSummary || '',
        details: jobDetails || '',
        travel: {
          distance_miles: num(distanceMiles, 0),
          round_trip_miles: num(distanceMiles, 0) * 2,
          rate_per_mile: num(prof?.travel_rate_per_mile, 0),
          travel_charge: travelCharge
        }
      };

      if (existing) {
        const { error: upErr } = await supabase
          .from('quotes')
          .update({
            status: 'draft',
            client_name: clientName || 'Client',
            client_email: clientEmail || null,
            client_phone: clientPhone || null,
            client_address: clientAddress || null,
            site_address: sameAsBilling ? clientAddress : (siteAddress || null),
            job_summary: jobSummary || 'New job',
            job_details: JSON.stringify(blob, null, 2),
            line_items: null,
            totals: null,
            subtotal: travelCharge || null,
            vat_amount: null,
            total: travelCharge || null,
          })
          .eq('id', existing.id);
        if (upErr) throw upErr;

        showAlert('Saved', 'Draft ' + existing.quote_number + ' updated.');
        router.replace('/(app)/quotes/list');
        return;
      }

      const { data: nextNo, error: nErr } = await supabase.rpc('next_quote_number', { p_user_id: user.id });
      if (nErr) throw nErr;

      const draftRow = {
        user_id: user.id,
        quote_number: nextNo,
        status: 'draft',
        client_name: clientName || 'Client',
        client_email: clientEmail || null,
        client_phone: clientPhone || null,
        client_address: clientAddress || null,
        site_address: sameAsBilling ? clientAddress : (siteAddress || null),
        job_summary: jobSummary || 'New job',
        job_details: JSON.stringify(blob, null, 2),
        line_items: null,
        totals: null,
        subtotal: travelCharge || null,
        vat_amount: null,
        total: travelCharge || null
      };

      await tryInsertWithUniqueQuoteNumber(draftRow, user.id);

      showAlert('Saved', 'Draft ' + draftRow.quote_number + ' created.');
      router.replace('/(app)/quotes/list');
    } catch (e) {
      console.error('[TMQ][CREATE] saveDraft error', e);
      showAlert('Error', e.message || 'Could not create draft.');
    } finally {
      setSaving(false);
    }
  };

  /* --------------- AI -> PDF flow --------------- */
  const generateAIAndPDF = async () => {
    try {
      if (isFinalized) { showAlert('Locked', 'This quote has already been generated. You cannot re-generate it.'); return; }

      setGenLoading(true);
      const prof = await getProfileOrThrow();

      const { data: userData } = await supabase.auth.getUser();
      const user = userData?.user;
      if (!user) throw new Error('Not signed in');

      if (!existing && !isPremium) {
        const allowed = await checkDailyQuota(user.id);
        if (!allowed) { setBlockedToday(true); showAlert('Daily limit reached', 'Free users can create 1 quote per day. Upgrade to Premium for unlimited quotes.'); return; }
      }

      if (!distanceMiles) await autoCalcDistance();

      let quoteNumber = existing?.quote_number;
      if (!quoteNumber) {
        const { data: nextNo, error: nErr } = await supabase.rpc('next_quote_number', { p_user_id: user.id });
        if (nErr) throw nErr;
        quoteNumber = nextNo;
      }

      const aiPayload = {
        profile: {
          business_name: profile?.business_name || '',
          trade_type: profile?.trade_type || '',
          hourly_rate: num(profile?.hourly_rate, 0),
          materials_markup_pct: num(profile?.materials_markup_pct, 0),
          vat_registered: !!profile?.vat_registered,
          payment_terms: profile?.payment_terms || '',
          warranty_text: profile?.warranty_text || '',
          travel_rate_per_mile: num(profile?.travel_rate_per_mile, 0),
          hours_per_day: num(profile?.hours_per_day, 10) || 10,
        },
        client: {
          name: clientName || 'Client',
          email: clientEmail || '',
          phone: clientPhone || '',
          billing_address: clientAddress || '',
          site_address: sameAsBilling ? clientAddress : (siteAddress || ''),
        },
        job: { summary: jobSummary || 'New job', details: jobDetails || '' },
        travel: {
          distance_miles: num(distanceMiles, 0),
          round_trip_miles: num(distanceMiles, 0) * 2,
          travel_charge: travelCharge
        }
      };

      // AI call with fallback
      let aiData;
      try {
        const { data: _aiData, error: aiErr } = await supabase.functions.invoke('ai-generate-quote', { body: aiPayload });
        if (aiErr) throw new Error(aiErr.message || 'ai-generate-quote failed');
        aiData = _aiData;
      } catch (err) {
        console.warn('[TMQ][AI] fallback because', err?.message || err);
        const hours = profile?.hourly_rate ? 1.5 : 1;
        const labour = Math.max(0, num(profile?.hourly_rate, 0)) * hours;
        const travel = travelCharge || 0;
        const materialsRaw = 12;
        const markup = num(profile?.materials_markup_pct, 0) / 100;
        const materialsVal = materialsRaw * (1 + markup);
        const line_items = [
          { description: `Labour (${hours.toFixed(1)} hrs @ £${num(profile?.hourly_rate, 0).toFixed(2)}/hr)`, qty: 1, unit_price: Number(labour.toFixed(2)), total: Number(labour.toFixed(2)), type: 'labour' },
          { description: 'Standard fixings & sundries (incl. markup)', qty: 1, unit_price: Number(materialsVal.toFixed(2)), total: Number(materialsVal.toFixed(2)), type: 'materials' },
        ];
        if (travel > 0) line_items.push({ description: 'Travel / mileage (round trip)', qty: 1, unit_price: Number(travel.toFixed(2)), total: Number(travel.toFixed(2)), type: 'other' });
        const subtotal = Number(line_items.reduce((s, li) => s + (li.total || 0), 0).toFixed(2));
        const vatRate = profile?.vat_registered ? 0.2 : 0;
        const vat_amount = Number((subtotal * vatRate).toFixed(2));
        const total = Number((subtotal + vat_amount).toFixed(2));
        aiData = { line_items, totals: { subtotal, vat_amount, total, vat_rate: vatRate }, meta: {} };
      }

      // meta for PDF
      const aiMeta = aiData?.meta || {};
      const estHours = num(aiMeta?.estimated_hours, 0);
      const hoursPerDay = num(profile?.hours_per_day, 10) || 10;
      const hourlyRate = num(profile?.hourly_rate, 0);

      let day_rate_calc = null;
      if (estHours > 0 && hoursPerDay > 0 && hourlyRate > 0) {
        const days = Math.floor(estHours / hoursPerDay);
        const remainder = +(estHours - days * hoursPerDay).toFixed(1);
        const day_rate = +(hourlyRate * hoursPerDay).toFixed(2);
        const labour_days_cost = +(day_rate * days).toFixed(2);
        const labour_hours_cost = +(hourlyRate * remainder).toFixed(2);
        const total_labour_cost = +(labour_days_cost + labour_hours_cost).toFixed(2);
        day_rate_calc = { hours_per_day: hoursPerDay, hourly_rate: hourlyRate, days, remainder_hours: remainder, day_rate, labour_days_cost, labour_hours_cost, total_labour_cost };
      }

      let phases = Array.isArray(aiMeta?.phases) ? aiMeta.phases : null;
      if (!phases || !phases.length) phases = buildFallbackPhases(jobSummary, jobDetails);

      const jobDetailsForRow = JSON.stringify(
        { ...aiPayload, ai_meta: { ...aiMeta, day_rate_calc, phases } },
        null,
        2
      );

      // Defensive: hide zero-value items client-side too
      const safeItems = (aiData?.line_items || []).filter(li => {
        const qty = Number(li.qty ?? 1);
        const unit = Number(li.unit_price ?? 0);
        const total = Number(li.total ?? qty * unit);
        return Number.isFinite(total) && total > 0;
      });

      // PDF builder
      const poweredBy = (profile?.branding ?? 'free') === 'free';
      const { data: pdfData, error: pdfErr } = await supabase.functions.invoke('pdf-builder', {
        body: {
          user_id: user.id,
          branding: {
            tier: profile?.branding ?? 'free',
            business_name: profile?.business_name || 'Trade Business',
            custom_logo_url: profile?.custom_logo_url || null,
            contact: {
              address_line1: profile?.address_line1 || '',
              city: profile?.city || '',
              postcode: profile?.postcode || '',
              email: '', phone: '', website: ''
            },
            tax: {
              vat_number: profile?.vat_registered ? 'GB …' : undefined,
              company_number: undefined
            },
            payment: { instructions: profile?.payment_terms || 'Payment due within 7 days by bank transfer.' }
          },
          quote: {
            is_estimate: true, // show ESTIMATE banner + legal copy
            quote_number: quoteNumber,
            client_name: clientName || 'Client',
            client_address: clientAddress || null,
            site_address: sameAsBilling ? clientAddress : (siteAddress || null),
            job_summary: jobSummary || 'New job',
            // filter zero rows
            line_items: safeItems,
            totals: aiData?.totals || { subtotal: 0, vat_amount: 0, total: 0, vat_rate: 0 },
            terms: profile?.payment_terms || '',
            warranty: profile?.warranty_text || '',
            powered_by_footer: poweredBy,
            meta: { day_rate_calc, phases },
          }
        }
      });
      if (pdfErr) throw new Error(pdfErr.message || 'pdf-builder failed');

      // URL readiness
      let pdfUrl = pdfData?.signedUrl || pdfData?.signed_url || null;
      const pathFromFn = pdfData?.path || pdfData?.key || pdfData?.objectPath || null;

      if (pdfUrl) { (async () => { try { const ok = await probeUrl(pdfUrl); if (!ok) console.warn('[TMQ][PDF] signedUrl probe failed'); } catch {} })(); }
      else if (pathFromFn) {
        const ready = await pollSignedUrlReady(pathFromFn, { tries: 120, baseDelay: 500, step: 500, maxDelay: 2000 });
        if (ready) pdfUrl = ready;
      }

      const persistedTotals = pdfData?.totals || aiData?.totals || { subtotal: null, vat_amount: null, total: null, vat_rate: null };
      const persistedItems  = safeItems;

      let finalQuoteId = existing?.id || null;

      const backgroundResolveAndSavePdfUrl = async (path, quoteIdToUpdate) => {
        if (!path || !quoteIdToUpdate) return;
        try {
          const found = await pollSignedUrlReady(path, { tries: 120, baseDelay: 500, step: 500, maxDelay: 2000 });
          if (found) await supabase.from('quotes').update({ pdf_url: found }).eq('id', quoteIdToUpdate);
        } catch (e) { console.warn('[TMQ][PDF] backgroundResolve error', e?.message || e); }
      };

      if (existing) {
        const updateObj = {
          status: 'generated',
          client_name: clientName || 'Client',
          client_email: clientEmail || null,
          client_phone: clientPhone || null,
          client_address: clientAddress || null,
          site_address: sameAsBilling ? clientAddress : (siteAddress || null),
          job_summary: jobSummary || 'New job',
          job_details: jobDetailsForRow,
          line_items: persistedItems,
          totals: persistedTotals,
          subtotal: persistedTotals.subtotal,
          vat_amount: persistedTotals.vat_amount,
          total: persistedTotals.total,
          pdf_url: pdfUrl || null
        };
        const { error: upErr } = await supabase.from('quotes').update(updateObj).eq('id', existing.id);
        if (upErr) throw upErr;
        finalQuoteId = existing.id;

        if (!pdfUrl && pathFromFn) backgroundResolveAndSavePdfUrl(pathFromFn, finalQuoteId).catch(() => {});
      } else {
        const generatedRow = {
          user_id: user.id,
          quote_number: quoteNumber,
          status: 'generated',
          client_name: clientName || 'Client',
          client_email: clientEmail || null,
          client_phone: clientPhone || null,
          client_address: clientAddress || null,
          site_address: sameAsBilling ? clientAddress : (siteAddress || null),
          job_summary: jobSummary || 'New job',
          job_details: jobDetailsForRow,
          line_items: persistedItems,
          totals: persistedTotals,
          subtotal: persistedTotals.subtotal,
          vat_amount: persistedTotals.vat_amount,
          total: persistedTotals.total,
          pdf_url: pdfUrl || null
        };

        const inserted = await tryInsertWithUniqueQuoteNumber(generatedRow, user.id);
        finalQuoteId = inserted?.id || null;
        quoteNumber = generatedRow.quote_number;

        if (!pdfUrl && pathFromFn && finalQuoteId) backgroundResolveAndSavePdfUrl(pathFromFn, finalQuoteId).catch(() => {});
      }

      if (pdfUrl) {
        const estHoursStr = String(aiData?.meta?.estimated_hours ?? '');
        const estDaysStr  = String(aiData?.meta?.days ?? '');
        const estMethod   = aiData?.meta?.method || '';
        router.replace({
          pathname: '/(app)/quotes/preview',
          params: {
            id: finalQuoteId || '',
            url: encodeURIComponent(pdfUrl),
            name: quoteNumber + '.pdf',
            estHours: estHoursStr,
            estDays: estDaysStr,
            estMethod
          },
        });
      } else {
        showAlert('Quote saved', 'PDF is being prepared. Open the quote and tap “Preview” in a moment.');
        router.replace('/(app)/quotes/list');
      }
    } catch (e) {
      console.error('[TMQ][CREATE] generateAIAndPDF error', e);
      showAlert('Error', e.message || 'AI/PDF failed. Please check function logs.');
    } finally {
      setGenLoading(false);
    }
  };

  /* ---------------- UI ---------------- */
  const baseActionsDisabled = saving || genLoading || profileLoading || (blockedToday && !existing && !isPremium);

  // Counter color
  const counterColor =
    jobLen >= MAX_JOB_DETAILS ? BRAND.warn :
    jobLen >= COUNTER_AMBER_AT ? BRAND.amber :
    '#3730a3';

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: BRAND.bg }}
      behavior={Platform.select({ ios: 'padding', android: 'height' })}
    >
      <View style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={[styles.container, { paddingBottom: 170 }]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          <AlertView />

          <Text style={styles.title}>
            {existing ? (isFinalized ? existing.quote_number : ('Edit ' + existing.quote_number)) : 'Create Quote'}
          </Text>

          {blockedToday && !isPremium && !existing && (
            <View style={[styles.banner, { backgroundColor: '#fffbeb', borderColor: '#fcd34d' }]}>
              <Text style={[styles.bannerText, { color: '#92400e' }]}>
                Free plan: you’ve already created 1 quote today. Upgrade for unlimited quotes.
              </Text>
            </View>
          )}

          {isFinalized && (
            <View style={[styles.banner, { backgroundColor: '#eef2ff', borderColor: '#c7d2fe' }]}>
              <Text style={[styles.bannerText, { color: '#3730a3' }]}>
                This quote has been generated. You can’t generate it again.
              </Text>
            </View>
          )}

          {profileLoading && (
            <View style={styles.banner}>
              <ActivityIndicator size="small" />
              <Text style={styles.bannerText}>Loading your profile…</Text>
            </View>
          )}
          {!!profileError && !profileLoading && (
            <TouchableOpacity
              style={[styles.banner, { backgroundColor: '#fff1f2', borderColor: '#fecaca' }]}
              onPress={loadProfile}
            >
              <Text style={[styles.bannerText, { color: '#991b1b' }]}>{profileError} (Tap to retry)</Text>
            </TouchableOpacity>
          )}

          {/* Client */}
          <Card>
            <View style={styles.cardHeader}>
              <IconUser size={18} color={BRAND.text} />
              <CardTitle>Client</CardTitle>
            </View>
            <TextInput placeholder="Client name" placeholderTextColor={BRAND.subtle} value={clientName} onChangeText={setClientName} style={[styles.input, styles.inputLg]} accessibilityLabel="Client name" />
            <View style={styles.row2}>
              <TextInput style={[styles.input, styles.flex1]} placeholder="Email (optional)" placeholderTextColor={BRAND.subtle} autoCapitalize="none" keyboardType="email-address" value={clientEmail} onChangeText={setClientEmail} accessibilityLabel="Client email" />
              <TextInput style={[styles.input, styles.flex1, { marginLeft: 8 }]} placeholder="Phone (optional)" placeholderTextColor={BRAND.subtle} keyboardType="phone-pad" value={clientPhone} onChangeText={setClientPhone} accessibilityLabel="Client phone" />
            </View>

            {/* Billing address — opens modal */}
            <TouchableOpacity activeOpacity={0.8} onPress={() => setBillingOpen(true)} accessibilityRole="button" accessibilityLabel="Edit billing address">
              <View pointerEvents="none">
                <TextInput
                  placeholder="Billing address (tap to search or edit)"
                  placeholderTextColor={BRAND.subtle}
                  value={clientAddress}
                  style={[styles.input, { color: clientAddress ? '#111827' : BRAND.subtle }]}
                  editable={false}
                />
              </View>
            </TouchableOpacity>
          </Card>

          {/* Job (bigger, emphasized, counter) */}
          <Card style={{ paddingBottom: 18 }}>
            <View style={styles.cardHeader}>
              <IconFileText size={20} color={BRAND.text} />
              <CardTitle>Job</CardTitle>
            </View>

            <Text style={styles.jobHint}>
              Add as much detail as possible — access, materials, constraints, timing — the AI uses this to price more accurately.
              <Text style={{ color: BRAND.subtle }}> (max {MAX_JOB_DETAILS} characters)</Text>
            </Text>

            <TextInput
              placeholder="Job summary (short title)"
              placeholderTextColor={BRAND.subtle}
              value={jobSummary}
              onChangeText={setJobSummary}
              style={[styles.input, styles.inputLg]}
              accessibilityLabel="Job summary"
            />

            {/* Details with counter */}
            <View style={{ position: 'relative' }}>
              <TextInput
                placeholder="Describe the work to be done…"
                placeholderTextColor={BRAND.subtle}
                value={jobDetails}
                onChangeText={setJobDetails}
                style={[styles.input, styles.jobDetails]}
                multiline
                accessibilityLabel="Job details"
              />
              <View style={[styles.counterPill, { borderColor: counterColor, backgroundColor: '#eef2ff' }]}>
                <Text style={[styles.counterText, { color: counterColor }]}>{remaining} left</Text>
              </View>
            </View>
          </Card>

          {/* Travel */}
          <Card>
            <View style={styles.cardHeader}>
              <IconCar size={18} color={BRAND.text} />
              <CardTitle>Travel</CardTitle>
            </View>

            <TouchableOpacity
              style={styles.checkboxRow}
              onPress={() => setSameAsBilling(v => !v)}
              activeOpacity={0.7}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: sameAsBilling }}
            >
              <View style={[styles.checkboxBox, sameAsBilling && styles.checkboxBoxChecked]}>
                {sameAsBilling && <Text style={styles.checkboxTick}>✓</Text>}
              </View>
              <Text style={styles.checkboxLabel}>Site address is the same as billing address</Text>
            </TouchableOpacity>

            <TouchableOpacity
              activeOpacity={sameAsBilling ? 1 : 0.8}
              onPress={() => !sameAsBilling && setSiteOpen(true)}
              disabled={sameAsBilling}
              accessibilityRole="button"
              accessibilityLabel="Edit site address"
            >
              <View pointerEvents="none">
                <TextInput
                  placeholder="Site address (tap to search or edit)"
                  placeholderTextColor={BRAND.subtle}
                  value={sameAsBilling ? clientAddress : siteAddress}
                  style={[
                    styles.input,
                    sameAsBilling && { backgroundColor: '#f3f4f6', color: BRAND.subtle }
                  ]}
                  editable={false}
                />
              </View>
            </TouchableOpacity>

            <View style={styles.row2}>
              <TextInput placeholder="Distance (miles)" placeholderTextColor={BRAND.subtle} keyboardType="decimal-pad" value={distanceMiles} onChangeText={setDistanceMiles} style={[styles.input, styles.flex1]} accessibilityLabel="Distance in miles" />
              <View style={[styles.input, styles.flex1, { marginLeft: 8, justifyContent: 'center', alignItems: 'center' }]}>
                {autoDistLoading ? <ActivityIndicator /> : <Text style={{ color: '#111827', fontWeight: '600' }}>Travel (round trip): £{travelCharge.toFixed(2)}</Text>}
              </View>
            </View>
          </Card>

          <View style={{ height: 12 }} />
        </ScrollView>

        {/* ===== Fixed Footer Actions ===== */}
        {!isFinalized && (
          <View style={styles.footerBar}>
            <TouchableOpacity style={[styles.footerBtn, styles.footerBtnSecondary, baseActionsDisabled && { opacity: 0.7 }]} onPress={saveDraftOnly} disabled={baseActionsDisabled} accessibilityRole="button" accessibilityLabel="Save draft">
              <Text style={styles.footerBtnText}>Save Draft</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.footerBtn, styles.footerBtnPrimary, baseActionsDisabled && { opacity: 0.7 }]}
              onPress={generateAIAndPDF}
              disabled={baseActionsDisabled}
              accessibilityRole="button"
              accessibilityLabel="Generate quote"
            >
              {genLoading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <View style={{ alignItems: 'center' }}>
                  <Text style={styles.footerBtnText}>Generate Quote</Text>
                  <Text style={styles.footerBtnSub}>Powered by AI</Text>
                </View>
              )}
            </TouchableOpacity>
          </View>
        )}

        {/* Address Modals */}
        <AddressModal
          visible={billingOpen}
          onClose={() => setBillingOpen(false)}
          initialText={clientAddress}
          GOOGLE={GOOGLE}
          onUse={(addr) => {
            setClientAddress(addr);
            if (sameAsBilling) setSiteAddress(addr);
          }}
        />
        <AddressModal
          visible={siteOpen}
          onClose={() => setSiteOpen(false)}
          initialText={siteAddress || clientAddress}
          GOOGLE={GOOGLE}
          onUse={(addr) => setSiteAddress(addr)}
        />
      </View>
    </KeyboardAvoidingView>
  );
}

/* ---------------- small presentational helpers ---------------- */
const Card = ({ children, style }) => <View style={[styles.card, style]}>{children}</View>;
const CardTitle = ({ children }) => <Text style={styles.cardTitle}>{children}</Text>;

const styles = StyleSheet.create({
  container: { padding: 20, flexGrow: 1 },
  title: { color: BRAND.text, fontSize: 26, fontWeight: '900', marginBottom: 12, textAlign: 'center' },

  /* Cards */
  card: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e6e9ef',
    borderRadius: 18,
    padding: 16,
    marginBottom: 14,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  cardHeader: { alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, marginBottom: 10 },
  cardTitle: { color: BRAND.text, fontSize: 17, fontWeight: '900', textAlign: 'center' },

  /* Inputs */
  input: {
    backgroundColor: '#ffffff',
    color: '#111827',
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: BRAND.border
  },
  inputLg: {
    paddingVertical: 16,
    fontSize: 16,
  },

  /* Job details area */
  jobHint: {
    color: BRAND.text,
    fontSize: 13,
    fontWeight: '800',
    marginBottom: 8,
  },
  jobDetails: {
    minHeight: 140,
    textAlignVertical: 'top',
    fontSize: 16,
    paddingRight: 54, // room for counter pill
  },
  counterPill: {
    position: 'absolute',
    right: 10,
    bottom: 10,
    backgroundColor: '#eef2ff',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1
  },
  counterText: { fontSize: 12, fontWeight: '800' },

  row2: { flexDirection: 'row', marginBottom: 12 },
  flex1: { flex: 1 },

  banner: {
    backgroundColor: '#f8fafc',
    borderColor: '#e6eef8',
    borderWidth: 1,
    borderRadius: 12,
    padding: 10,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  bannerText: { color: BRAND.text, fontWeight: '600' },

  /* Checkbox */
  checkboxRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  checkboxBox: {
    width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: '#cbd5e1',
    alignItems: 'center', justifyContent: 'center', marginRight: 8, backgroundColor: '#ffffff'
  },
  checkboxBoxChecked: { backgroundColor: BRAND.primary, borderColor: BRAND.primary },
  checkboxTick: { color: '#ffffff', fontWeight: '800' },
  checkboxLabel: { color: '#111827' },

  /* Nice Alert */
  alertBackdrop: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center', zIndex: 999
  },
  alertCard: {
    width: '86%', backgroundColor: '#ffffff', borderRadius: 16, padding: 18,
    borderWidth: 1, borderColor: '#eef2f7'
  },
  alertTitle: { fontSize: 16, fontWeight: '700', color: BRAND.text, marginBottom: 8 },
  alertMsg: { fontSize: 14, color: '#334155', marginBottom: 16 },
  alertBtn: { alignSelf: 'flex-end', paddingHorizontal: 16, paddingVertical: 10, backgroundColor: BRAND.primary, borderRadius: 10 },
  alertBtnText: { color: '#ffffff', fontWeight: '700' },

  /* Fixed footer */
  footerBar: {
    position: 'absolute',
    left: 0, right: 0, bottom: 0,
    backgroundColor: '#ffffff',
    borderTopWidth: 1,
    borderTopColor: '#e6e9ef',
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: Platform.select({ ios: 28, android: 18 }),
    flexDirection: 'row',
    gap: 10,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: -2 },
    elevation: 10
  },
  footerBtn: { flex: 1, borderRadius: 12, paddingVertical: 16, alignItems: 'center', justifyContent: 'center' },
  footerBtnSecondary: { backgroundColor: BRAND.text },
  footerBtnPrimary: { backgroundColor: BRAND.accent },
  footerBtnText: { color: '#ffffff', fontWeight: '800', fontSize: 15 },
  footerBtnSub: { color: BRAND.text, fontWeight: '700', fontSize: 10, opacity: 0.9, marginTop: 2 },

  /* Modal */
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center', padding: 16 },
  modalCard: {
    width: '100%', maxHeight: '85%', backgroundColor: '#fff', borderRadius: 16, padding: 14,
    borderWidth: 1, borderColor: BRAND.border
  },
  modalTitle: { fontSize: 16, fontWeight: '800', color: BRAND.text, textAlign: 'center', marginBottom: 10 },

  /* Suggestion list */
  suggestBox: {
    borderWidth: 1, borderColor: BRAND.border, borderRadius: 12,
    maxHeight: 230, marginBottom: 10, backgroundColor: '#fff', overflow: 'hidden'
  },
  suggestRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: BRAND.border },
  suggestText: { color: BRAND.text, flex: 1 },

  /* Modal buttons */
  modalAltBtn: { paddingVertical: 12, borderRadius: 10, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  modalAltBtnText: { color: '#fff', fontWeight: '700' },
});