// app/(app)/quotes/create.js
import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ScrollView,
  KeyboardAvoidingView, Platform, ActivityIndicator
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '../../../lib/supabase';

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
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return (R_km * c) * 0.621371; // miles
};
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
async function pollSignedUrlReady(
  path,
  { tries = 60, baseDelay = 300, step = 300, maxDelay = 1200, signedUrlTtl = 60 * 60 * 24 * 7 } = {}
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

/* -------------- simple phases fallback from job text -------------- */
function buildFallbackPhases(summary, details) {
  const s = (summary || '').trim();
  const d = (details || '').trim();
  const tasks = [];
  if (d) d.split(/\r?\n|[.;] /).map(t => t.trim()).filter(Boolean).slice(0, 8).forEach(t => tasks.push(t));
  else if (s) tasks.push(s);
  if (!tasks.length) tasks.push('Attend site and complete works as described.');
  return [{ name: 'Scope of Work', tasks }];
}

/* -------------- insert helper: retry on quote number clash -------------- */
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

/* -------------- quota helper: free users max 1/day -------------- */
const checkDailyQuota = async (userId) => {
  try {
    const { data, error } = await supabase.rpc('can_create_quote', { p_user_id: userId });
    if (error) {
      console.warn('[TMQ][CREATE] can_create_quote RPC error, allowing by default:', error.message);
      return true; // fail-open to not block if RPC missing
    }
    return !!data;
  } catch (e) {
    console.warn('[TMQ][CREATE] can_create_quote threw, allowing by default:', e?.message || e);
    return true;
  }
};

export default function CreateQuote() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const quoteId = params?.quoteId ? String(params.quoteId) : null;

  // Client & job
  const [clientName, setClientName] = useState('');
  const [clientEmail, setClientEmail] = useState('');
  const [clientPhone, setClientPhone] = useState('');
  const [clientAddress, setClientAddress] = useState('');
  const [siteAddress, setSiteAddress] = useState('');
  const [jobSummary, setJobSummary] = useState('');
  const [jobDetails, setJobDetails] = useState('');

  // Profile + travel
  const [profile, setProfile] = useState(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileError, setProfileError] = useState(null);
  const [isPremium, setIsPremium] = useState(false);

  const [distanceMiles, setDistanceMiles] = useState('');
  const [travelCharge, setTravelCharge] = useState(0); // round-trip
  const [autoDistLoading, setAutoDistLoading] = useState(false);

  // Existing quote (if editing)
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

  /* ---------------- load profile (with retry) ---------------- */
  const loadProfile = useCallback(async () => {
    setProfileLoading(true);
    setProfileError(null);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const user = userData?.user;
      if (!user) { router.replace('/(auth)/login'); return null; }

      const { data, error } = await supabase
        .from('profiles')
        .select('id, tier, business_name, trade_type, hourly_rate, materials_markup_pct, vat_registered, payment_terms, warranty_text, travel_rate_per_mile, branding, custom_logo_url, address_line1, city, postcode, hours_per_day')
        .eq('id', user.id)
        .maybeSingle();

      if (error) throw error;
      setProfile(data);
      const _isPremium = String(data?.branding ?? 'free').toLowerCase() === 'premium';
      setIsPremium(_isPremium);

      // refresh quota status for free users
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

  // initial load
  useEffect(() => { loadProfile(); }, [loadProfile]);

  // helper: always return a profile or throw
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
      const { data, error } = await supabase
        .from('quotes')
        .select('*')
        .eq('id', quoteId)
        .maybeSingle();
      if (error) {
        console.error('[TMQ][CREATE] load existing quote error', error);
        return;
      }
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
          if (blob?.details != null) setJobDetails(String(blob.details));
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
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${GOOGLE}`;
    const res = await fetch(url);
    const j = await res.json();
    const loc = j?.results?.[0]?.geometry?.location;
    return loc ? { lat: loc.lat, lng: loc.lng } : null;
  };

  const getDrivingDistanceMiles = async (origLat, origLng, destLat, destLng) => {
    if (!GOOGLE) return null;
    const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${origLat},${origLng}&destinations=${destLat},${destLng}&units=imperial&key=${GOOGLE}`;
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
      if (!siteAddress?.trim()) return;

      const originText = buildBusinessAddress(prof);
      if (!originText) {
        console.warn('[TMQ][DIST] Missing business address in profile');
        return;
      }

      setAutoDistLoading(true);

      const origin = await geocodeAddress(originText);
      const dest = await geocodeAddress(siteAddress.trim());
      if (!origin || !dest) {
        console.warn('[TMQ][DIST] Geocoding failed, please check addresses');
        return;
      }

      let miles = await getDrivingDistanceMiles(origin.lat, origin.lng, dest.lat, dest.lng);
      if (!miles) miles = haversineMiles(origin.lat, origin.lng, dest.lat, dest.lng);

      const rounded = Math.round(Number(miles) * 100) / 100;
      if (Number.isFinite(rounded)) setDistanceMiles(String(rounded)); // one-way miles
    } catch (e) {
      console.warn('[TMQ][DIST] auto distance error', e?.message || e);
    } finally {
      setAutoDistLoading(false);
    }
  }, [siteAddress, getProfileOrThrow]);

  useEffect(() => {
    if (!siteAddress?.trim()) return;
    const t = setTimeout(() => { autoCalcDistance(); }, 800);
    return () => clearTimeout(t);
  }, [siteAddress, autoCalcDistance]);

  /* ---------------- save draft ---------------- */
  const saveDraftOnly = async () => {
    try {
      if (isFinalized) {
        Alert.alert('Locked', 'This quote has already been generated. You can no longer save it as a draft.');
        return;
      }

      setSaving(true);
      const prof = await getProfileOrThrow();
      const { data: userData } = await supabase.auth.getUser();
      const user = userData?.user;
      if (!user) throw new Error('Not signed in');

      // Quota check for *new* draft only
      if (!existing && !isPremium) {
        const allowed = await checkDailyQuota(user.id);
        if (!allowed) {
          setBlockedToday(true);
          Alert.alert('Daily limit reached', 'Free users can create 1 quote per day. Upgrade to Premium for unlimited quotes.');
          return;
        }
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
            site_address: siteAddress || null,
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

        Alert.alert('Saved', `Draft ${existing.quote_number} updated.`);
        router.replace('/(app)/quotes/list');
        return;
      }

      // new draft -> insert with unique-number retry
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
        site_address: siteAddress || null,
        job_summary: jobSummary || 'New job',
        job_details: JSON.stringify(blob, null, 2),
        line_items: null,
        totals: null,
        subtotal: travelCharge || null,
        vat_amount: null,
        total: travelCharge || null
      };

      await tryInsertWithUniqueQuoteNumber(draftRow, user.id);

      Alert.alert('Saved', `Draft ${draftRow.quote_number} created.`);
      router.replace('/(app)/quotes/list');
    } catch (e) {
      console.error('[TMQ][CREATE] saveDraft error', e);
      Alert.alert('Error', e.message ?? 'Could not create draft.');
    } finally {
      setSaving(false);
    }
  };

  /* --------------- AI -> PDF flow --------------- */
  const generateAIAndPDF = async () => {
    try {
      if (isFinalized) {
        Alert.alert('Locked', 'This quote has already been generated. You cannot re-generate it.');
        return;
      }

      setGenLoading(true);
      const prof = await getProfileOrThrow();

      const { data: userData } = await supabase.auth.getUser();
      const user = userData?.user;
      if (!user) throw new Error('Not signed in');

      // Quota check for *first-time generate* (no existing row)
      if (!existing && !isPremium) {
        const allowed = await checkDailyQuota(user.id);
        if (!allowed) {
          setBlockedToday(true);
          Alert.alert('Daily limit reached', 'Free users can create 1 quote per day. Upgrade to Premium for unlimited quotes.');
          return;
        }
      }

      if (!distanceMiles) await autoCalcDistance();

      // reuse existing number or allocate
      let quoteNumber = existing?.quote_number;
      if (!quoteNumber) {
        const { data: nextNo, error: nErr } = await supabase.rpc('next_quote_number', { p_user_id: user.id });
        if (nErr) throw nErr;
        quoteNumber = nextNo;
      }

      const aiPayload = {
        profile: {
          business_name: prof.business_name || '',
          trade_type: prof.trade_type || '',
          hourly_rate: num(prof.hourly_rate, 0),
          materials_markup_pct: num(prof.materials_markup_pct, 0),
          vat_registered: !!prof.vat_registered,
          payment_terms: prof.payment_terms || '',
          warranty_text: prof.warranty_text || '',
          travel_rate_per_mile: num(prof.travel_rate_per_mile, 0),
          hours_per_day: num(prof?.hours_per_day, 10) || 10,
        },
        client: {
          name: clientName || 'Client',
          email: clientEmail || '',
          phone: clientPhone || '',
          billing_address: clientAddress || '',
          site_address: siteAddress || '',
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
        const hours = prof.hourly_rate ? 1.5 : 1;
        const labour = Math.max(0, num(prof.hourly_rate, 0)) * hours;
        const travel = travelCharge || 0;
        const materialsRaw = 12;
        const markup = num(prof.materials_markup_pct, 0) / 100;
        const materialsVal = materialsRaw * (1 + markup);
        const line_items = [
          { description: `Labour (${hours.toFixed(1)} hrs @ £${num(prof.hourly_rate, 0).toFixed(2)}/hr)`, qty: 1, unit_price: Number(labour.toFixed(2)), total: Number(labour.toFixed(2)), type: 'labour' },
          { description: 'Standard fixings & sundries (incl. markup)', qty: 1, unit_price: Number(materialsVal.toFixed(2)), total: Number(materialsVal.toFixed(2)), type: 'materials' },
        ];
        if (travel > 0) line_items.push({ description: 'Travel / mileage (round trip)', qty: 1, unit_price: Number(travel.toFixed(2)), total: Number(travel.toFixed(2)), type: 'other' });
        const subtotal = Number(line_items.reduce((s, li) => s + (li.total || 0), 0).toFixed(2));
        const vatRate = prof.vat_registered ? 0.2 : 0;
        const vat_amount = Number((subtotal * vatRate).toFixed(2));
        const total = Number((subtotal + vat_amount).toFixed(2));
        aiData = { line_items, totals: { subtotal, vat_amount, total, vat_rate: vatRate }, meta: {} };
      }

      // meta for PDF (day-rate split + phases)
      const aiMeta = aiData?.meta || {};
      const estHours = num(aiMeta?.estimated_hours, 0);
      const hoursPerDay = num(prof?.hours_per_day, 10) || 10;
      const hourlyRate = num(prof?.hourly_rate, 0);

      let day_rate_calc = null;
      if (estHours > 0 && hoursPerDay > 0 && hourlyRate > 0) {
        const days = Math.floor(estHours / hoursPerDay);
        const remainder = +(estHours - days * hoursPerDay).toFixed(1);
        const day_rate = +(hourlyRate * hoursPerDay).toFixed(2);
        const labour_days_cost = +(day_rate * days).toFixed(2);
        const labour_hours_cost = +(hourlyRate * remainder).toFixed(2);
        const total_labour_cost = +(labour_days_cost + labour_hours_cost).toFixed(2);
        day_rate_calc = {
          hours_per_day: hoursPerDay,
          hourly_rate: hourlyRate,
          days,
          remainder_hours: remainder,
          day_rate,
          labour_days_cost,
          labour_hours_cost,
          total_labour_cost,
        };
      }

      let phases = Array.isArray(aiMeta?.phases) ? aiMeta.phases : null;
      if (!phases || !phases.length) phases = buildFallbackPhases(jobSummary, jobDetails);

      const jobDetailsForRow = JSON.stringify(
        { ...aiPayload, ai_meta: { ...aiMeta, day_rate_calc, phases } },
        null,
        2
      );

      // PDF builder
      const poweredBy = (profile?.branding ?? 'free') === 'free';
      const { data: pdfData, error: pdfErr } = await supabase.functions.invoke('pdf-builder', {
        body: {
          user_id: user.id,
          branding: {
            tier: (profile?.branding ?? 'free'),
            business_name: profile?.business_name || 'Trade Business',
            custom_logo_url: profile?.custom_logo_url || null
          },
          quote: {
            quote_number: quoteNumber,
            client_name: clientName || 'Client',
            client_address: clientAddress || null,
            site_address: siteAddress || null,
            job_summary: jobSummary || 'New job',
            line_items: aiData?.line_items || [],
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
      if (pdfUrl) {
        const okNow = await probeUrl(pdfUrl);
        if (!okNow) pdfUrl = null;
      }
      if (!pdfUrl && pathFromFn) {
        const ready = await pollSignedUrlReady(pathFromFn, { tries: 60, baseDelay: 300, step: 300, maxDelay: 1200 });
        if (ready) pdfUrl = ready;
      }
      if (!pdfUrl) {
        const guessed = `${user.id}/${quoteNumber}.pdf`;
        const ready = await pollSignedUrlReady(guessed, { tries: 60, baseDelay: 300, step: 300, maxDelay: 1200 });
        if (ready) pdfUrl = ready;
      }

      // ---- persist items/totals so details screen can render them ----
      const persistedTotals = pdfData?.totals || aiData?.totals || { subtotal: null, vat_amount: null, total: null, vat_rate: null };
      const persistedItems  = Array.isArray(aiData?.line_items) ? aiData.line_items : [];

      let finalQuoteId = existing?.id || null;

      if (existing) {
        const { error: upErr } = await supabase
          .from('quotes')
          .update({
            status: 'generated',
            client_name: clientName || 'Client',
            client_email: clientEmail || null,
            client_phone: clientPhone || null,
            client_address: clientAddress || null,
            site_address: siteAddress || null,
            job_summary: jobSummary || 'New job',
            job_details: jobDetailsForRow,
            line_items: persistedItems,
            totals: persistedTotals,
            subtotal: persistedTotals.subtotal,
            vat_amount: persistedTotals.vat_amount,
            total: persistedTotals.total,
            pdf_url: pdfUrl || null
          })
          .eq('id', existing.id);
        if (upErr) throw upErr;
        finalQuoteId = existing.id;
      } else {
        const generatedRow = {
          user_id: user.id,
          quote_number: quoteNumber,
          status: 'generated',
          client_name: clientName || 'Client',
          client_email: clientEmail || null,
          client_phone: clientPhone || null,
          client_address: clientAddress || null,
          site_address: siteAddress || null,
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
        quoteNumber = generatedRow.quote_number; // keep filename consistent if retried
      }

      if (pdfUrl) {
        const estHoursStr = String(aiMeta?.estimated_hours ?? '');
        const estDaysStr  = String(aiMeta?.days ?? '');
        const estMethod   = aiMeta?.method || '';
        router.replace({
          pathname: '/(app)/quotes/preview',
          params: {
            id: finalQuoteId ?? '',
            url: encodeURIComponent(pdfUrl),
            name: `${quoteNumber}.pdf`,
            estHours: estHoursStr,
            estDays: estDaysStr,
            estMethod
          },
        });
      } else {
        Alert.alert('Quote saved', 'PDF generated but URL was not ready. Open this quote from the list and tap “Preview”.');
        router.replace('/(app)/quotes/list');
      }
    } catch (e) {
      console.error('[TMQ][CREATE] generateAIAndPDF error', e);
      Alert.alert('Error', e.message ?? 'AI/PDF failed. Please check function logs.');
    } finally {
      setGenLoading(false);
    }
  };

  /* ---------------- UI ---------------- */
  const baseActionsDisabled = saving || genLoading || profileLoading || (blockedToday && !existing && !isPremium);

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: '#0b0b0c' }} behavior={Platform.select({ ios: 'padding', android: undefined })}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        <Text style={styles.title}>
          {existing
            ? (isFinalized
                ? existing.quote_number
                : ('Edit ' + existing.quote_number))
            : 'Create Quote'}
        </Text>

        {blockedToday && !isPremium && !existing && (
          <View style={[styles.banner, { backgroundColor: '#3a1919', borderColor: '#6b2a2a' }]}>
            <Text style={[styles.bannerText, { color: '#ffb3b3' }]}>
              Free plan: you’ve already created 1 quote today. Upgrade for unlimited quotes.
            </Text>
          </View>
        )}

        {isFinalized && (
          <View style={[styles.banner, { backgroundColor: '#2a2330', borderColor: '#4b3758' }]}>
            <Text style={[styles.bannerText, { color: '#f1d4ff' }]}>
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
          <TouchableOpacity style={[styles.banner, { backgroundColor: '#3a1919', borderColor: '#6b2a2a' }]} onPress={loadProfile}>
            <Text style={[styles.bannerText, { color: '#ffb3b3' }]}>{profileError} (Tap to retry)</Text>
          </TouchableOpacity>
        )}

        {/* Client */}
        <Text style={styles.section}>Client</Text>
        <TextInput placeholder="Client name" placeholderTextColor="#999" value={clientName} onChangeText={setClientName} style={styles.input} />
        <View style={styles.row2}>
          <TextInput style={[styles.input, styles.flex1]} placeholder="Email (optional)" placeholderTextColor="#999" autoCapitalize="none" keyboardType="email-address" value={clientEmail} onChangeText={setClientEmail} />
          <TextInput style={[styles.input, styles.flex1, { marginLeft: 8 }]} placeholder="Phone (optional)" placeholderTextColor="#999" keyboardType="phone-pad" value={clientPhone} onChangeText={setClientPhone} />
        </View>
        <TextInput placeholder="Billing address (optional)" placeholderTextColor="#999" value={clientAddress} onChangeText={setClientAddress} style={styles.input} />

        {/* Job */}
        <Text style={styles.section}>Job</Text>
        <TextInput placeholder="Job summary" placeholderTextColor="#999" value={jobSummary} onChangeText={setJobSummary} style={styles.input} />
        <TextInput placeholder="Job details / notes (optional)" placeholderTextColor="#999" value={jobDetails} onChangeText={setJobDetails} style={[styles.input, { minHeight: 90 }]} multiline />

        {/* Travel */}
        <Text style={styles.section}>Travel</Text>
        <TextInput placeholder="Site address (used to auto-calc miles)" placeholderTextColor="#999" value={siteAddress} onChangeText={setSiteAddress} style={styles.input} />
        <View style={styles.row2}>
          <TextInput style={[styles.input, styles.flex1]} placeholder="Distance (miles)" placeholderTextColor="#999" keyboardType="decimal-pad" value={distanceMiles} onChangeText={setDistanceMiles} />
          <View style={[styles.input, styles.flex1, { marginLeft: 8, justifyContent: 'center', alignItems: 'center' }]}>
            {autoDistLoading ? <ActivityIndicator /> : <Text style={{ color: 'white' }}>Travel (round trip): £{travelCharge.toFixed(2)}</Text>}
          </View>
        </View>

        {/* Actions (draft + generate) */}
        {!isFinalized && (
          <>
            <TouchableOpacity style={[styles.button, { opacity: baseActionsDisabled ? 0.7 : 1 }]} onPress={saveDraftOnly} disabled={baseActionsDisabled}>
              <Text style={styles.buttonText}>{saving ? 'Saving…' : 'Save Draft'}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.button, { backgroundColor: '#3ecf8e', opacity: baseActionsDisabled ? 0.7 : 1 }]}
              onPress={generateAIAndPDF}
              disabled={baseActionsDisabled}
            >
              <Text style={styles.buttonText}>{genLoading ? 'Generating…' : (existing ? 'Finish & Generate PDF' : 'Generate Quote (AI)')}</Text>
            </TouchableOpacity>
          </>
        )}

        {/* Finalized actions */}
        {isFinalized && (
          <>
            {isPremium ? (
              <TouchableOpacity
                style={[styles.button, { backgroundColor: '#2a86ff' }]}
                onPress={() => router.push({ pathname: '/(app)/quotes/[id]', params: { id: existing.id } })}
              >
                <Text style={styles.buttonText}>Edit Prices & Lines</Text>
              </TouchableOpacity>
            ) : (
              <>
                <TouchableOpacity
                  style={[styles.button, { backgroundColor: '#2a86ff' }]}
                  onPress={() => router.push('/(app)/settings/upgrade')}
                >
                  <Text style={styles.buttonText}>Upgrade to Premium</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.button, { backgroundColor: '#272729', borderWidth: 1, borderColor: '#3c3c3f' }]}
                  onPress={() => router.replace('/(app)/quotes/list')}
                >
                  <Text style={styles.buttonText}>Back to Quotes</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.button, { backgroundColor: '#3ecf8e' }]}
                  onPress={() => {
                    const url = existing?.pdf_url;
                    if (url) {
                      router.replace({
                        pathname: '/(app)/quotes/preview',
                        params: { id: existing.id, url: encodeURIComponent(url), name: `${existing.quote_number}.pdf` }
                      });
                    } else {
                      Alert.alert('No PDF', 'Open this quote from the list and tap Preview to fetch the PDF.');
                      router.replace('/(app)/quotes/list');
                    }
                  }}
                >
                  <Text style={styles.buttonText}>View Quote</Text>
                </TouchableOpacity>
              </>
            )}
          </>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, backgroundColor: '#0b0b0c', flexGrow: 1 },
  title: { color: 'white', fontSize: 24, fontWeight: '700', marginBottom: 12 },
  section: { color: '#c7c7c7', marginTop: 8, marginBottom: 6, fontWeight: '600' },
  input: { backgroundColor: '#1a1a1b', color: 'white', borderRadius: 12, padding: 14, marginBottom: 12 },
  row2: { flexDirection: 'row', marginBottom: 12 },
  flex1: { flex: 1 },
  button: { backgroundColor: '#2a86ff', borderRadius: 12, padding: 14, alignItems: 'center', marginTop: 8 },
  buttonText: { color: 'white', fontWeight: '700' },
  banner: {
    backgroundColor: '#1f2530',
    borderColor: '#2f3a4d',
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  bannerText: { color: '#cfe2ff', fontWeight: '600' },
});