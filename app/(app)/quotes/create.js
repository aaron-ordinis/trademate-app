// app/(app)/quotes/create.js
import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ScrollView,
  KeyboardAvoidingView, Platform, ActivityIndicator
} from 'react-native';
import { useRouter } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { supabase } from '../../../lib/supabase';

// ---------- utils ----------
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

export default function CreateQuote() {
  const router = useRouter();

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
  const [distanceMiles, setDistanceMiles] = useState('');
  const [travelCharge, setTravelCharge] = useState(0);
  const [autoDistLoading, setAutoDistLoading] = useState(false);

  // UI
  const [saving, setSaving] = useState(false);
  const [genLoading, setGenLoading] = useState(false);

  // ---- Load profile (includes business address) ----
  const loadProfile = useCallback(async () => {
    const { data: userData } = await supabase.auth.getUser();
    const user = userData?.user;
    if (!user) { router.replace('/(auth)/login'); return; }

    const { data, error } = await supabase
      .from('profiles')
      .select('id,business_name,trade_type,hourly_rate,materials_markup_pct,vat_registered,payment_terms,warranty_text,travel_rate_per_mile,branding,custom_logo_url,address_line1,city,postcode')
      .eq('id', user.id)
      .maybeSingle();
    if (error) {
      console.error('[TMQ][CREATE] loadProfile error', error);
      Alert.alert('Error', 'Could not load your profile.');
      return;
    }
    setProfile(data);
  }, [router]);

  useEffect(() => { loadProfile(); }, [loadProfile]);

  // Recompute travel charge
  useEffect(() => {
    const miles = num(distanceMiles, 0);
    const rate = num(profile?.travel_rate_per_mile, 0);
    setTravelCharge(Math.round(miles * rate * 100) / 100);
  }, [distanceMiles, profile]);

  // ---------- Google helpers (use business address as origin) ----------
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
    return meters * 0.000621371;
  };

  const buildBusinessAddress = (p) =>
    [p?.address_line1, p?.city, p?.postcode].filter(Boolean).join(', ').trim();

  // Calculate distance when siteAddress changes (origin = business address)
  const autoCalcDistance = useCallback(async () => {
    try {
      if (!profile) return;
      if (!siteAddress?.trim()) return;

      const originText = buildBusinessAddress(profile);
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
      if (Number.isFinite(rounded)) setDistanceMiles(String(rounded));
    } catch (e) {
      console.warn('[TMQ][DIST] auto distance error', e?.message || e);
    } finally {
      setAutoDistLoading(false);
    }
  }, [profile, siteAddress, GOOGLE]);

  useEffect(() => {
    if (!siteAddress?.trim()) return;
    const t = setTimeout(() => { autoCalcDistance(); }, 800);
    return () => clearTimeout(t);
  }, [siteAddress, autoCalcDistance]);

  // ---------- Save draft ----------
  const saveDraftOnly = async () => {
    try {
      setSaving(true);
      const { data: userData } = await supabase.auth.getUser();
      const user = userData?.user;
      if (!user) throw new Error('Not signed in');

      const { data: nextNo, error: nErr } = await supabase.rpc('next_quote_number', { p_user_id: user.id });
      if (nErr) throw nErr;

      const blob = {
        summary: jobSummary || '',
        details: jobDetails || '',
        travel: {
          distance_miles: num(distanceMiles, 0),
          rate_per_mile: num(profile?.travel_rate_per_mile, 0),
          travel_charge: travelCharge
        }
      };

      const { error } = await supabase.from('quotes').insert({
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
        subtotal: travelCharge || null,
        vat_amount: null,
        total: travelCharge || null
      });
      if (error) throw error;

      Alert.alert('Saved', `Draft ${nextNo} created.`);
      router.replace('/(app)/quotes/list');
    } catch (e) {
      console.error('[TMQ][CREATE] saveDraft error', e);
      Alert.alert('Error', e.message ?? 'Could not create draft.');
    } finally {
      setSaving(false);
    }
  };

  // ---------- Full flow: AI -> PDF (AI has fallback) ----------
  const generateAIAndPDF = async () => {
    try {
      setGenLoading(true);
      const { data: userData } = await supabase.auth.getUser();
      const user = userData?.user;
      if (!user) throw new Error('Not signed in');
      if (!profile) throw new Error('Profile not loaded. Try again.');

      if (!distanceMiles) await autoCalcDistance();

      // 1) Quote number
      const { data: nextNo, error: nErr } = await supabase.rpc('next_quote_number', { p_user_id: user.id });
      if (nErr) throw nErr;

      // 2) AI payload
      const aiPayload = {
        profile: {
          business_name: profile.business_name || '',
          trade_type: profile.trade_type || '',
          hourly_rate: num(profile.hourly_rate, 0),
          materials_markup_pct: num(profile.materials_markup_pct, 0),
          vat_registered: !!profile.vat_registered,
          payment_terms: profile.payment_terms || '',
          warranty_text: profile.warranty_text || '',
          travel_rate_per_mile: num(profile.travel_rate_per_mile, 0),
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
          travel_charge: travelCharge
        }
      };

      // 2b) AI call with local fallback
      let aiData;
      try {
        const { data: _aiData, error: aiErr } = await supabase.functions.invoke('ai-generate-quote', { body: aiPayload });
        if (aiErr) {
          console.error('[TMQ][AI] error object', aiErr);
          throw new Error(aiErr.message || `ai-generate-quote failed: ${JSON.stringify(aiErr)}`);
        }
        aiData = _aiData;
      } catch (err) {
        console.warn('[TMQ][AI] Falling back to local items:', err?.message || err);
        const hours = profile.hourly_rate ? 1.5 : 1;
        const labour = Math.max(0, num(profile.hourly_rate, 0)) * hours;
        const travel = travelCharge || 0;
        const materialsRaw = 12;
        const markup = num(profile.materials_markup_pct, 0) / 100;
        const materialsVal = materialsRaw * (1 + markup);

        const line_items = [
          { description: `Labour (${hours.toFixed(1)} hrs @ £${num(profile.hourly_rate,0).toFixed(2)}/hr)`, qty: 1, unit_price: Number(labour.toFixed(2)), total: Number(labour.toFixed(2)), type: 'labour' },
          { description: 'Standard fixings & sundries (incl. markup)', qty: 1, unit_price: Number(materialsVal.toFixed(2)), total: Number(materialsVal.toFixed(2)), type: 'materials' },
        ];
        if (travel > 0) line_items.push({ description: 'Travel / mileage', qty: 1, unit_price: Number(travel.toFixed(2)), total: Number(travel.toFixed(2)), type: 'other' });

        const subtotal = Number(line_items.reduce((s, li) => s + (li.total || 0), 0).toFixed(2));
        const vatRate = profile.vat_registered ? 0.2 : 0;
        const vat_amount = Number((subtotal * vatRate).toFixed(2));
        const total = Number((subtotal + vat_amount).toFixed(2));
        aiData = { line_items, totals: { subtotal, vat_amount, total, vat_rate: vatRate } };
      }

      // 3) PDF build & upload
      const poweredBy = (profile.branding ?? 'free') === 'free';
      const { data: pdfData, error: pdfErr } = await supabase.functions.invoke('pdf-builder', {
        body: {
          user_id: user.id,
          branding: {
            tier: (profile.branding ?? 'free'),
            business_name: profile.business_name || 'Trade Business',
            custom_logo_url: profile.custom_logo_url || null
          },
          quote: {
            quote_number: nextNo,
            client_name: clientName || 'Client',
            client_address: clientAddress || null,
            site_address: siteAddress || null,
            job_summary: jobSummary || 'New job',
            line_items: aiData?.line_items || [],
            totals: aiData?.totals || { subtotal: 0, vat_amount: 0, total: 0, vat_rate: 0 },
            terms: profile.payment_terms || '',
            warranty: profile.warranty_text || '',
            powered_by_footer: poweredBy
          }
        }
      });
      if (pdfErr) {
        console.error('[TMQ][PDF] error object', pdfErr);
        throw new Error(pdfErr.message || `pdf-builder failed: ${JSON.stringify(pdfErr)}`);
      }

      // 4) Save quote with pdf_url
      const { error: insertErr } = await supabase.from('quotes').insert({
        user_id: user.id,
        quote_number: nextNo,
        status: 'sent',
        client_name: clientName || 'Client',
        client_email: clientEmail || null,
        client_phone: clientPhone || null,
        client_address: clientAddress || null,
        site_address: siteAddress || null,
        job_summary: jobSummary || 'New job',
        job_details: JSON.stringify(aiPayload, null, 2),
        subtotal: pdfData?.totals?.subtotal ?? aiData?.totals?.subtotal ?? null,
        vat_amount: pdfData?.totals?.vat_amount ?? aiData?.totals?.vat_amount ?? null,
        total: pdfData?.totals?.total ?? aiData?.totals?.total ?? null,
        pdf_url: pdfData?.signedUrl || null
      });
      if (insertErr) throw insertErr;

      if (pdfData?.signedUrl && (await Sharing.isAvailableAsync())) {
        await Sharing.shareAsync(pdfData.signedUrl);
      } else {
        Alert.alert('Quote ready', 'PDF generated and saved.');
      }

      router.replace('/(app)/quotes/list');
    } catch (e) {
      console.error('[TMQ][CREATE] generateAIAndPDF error', e);
      Alert.alert('Error', e.message ?? 'AI/PDF failed. Please check function logs.');
    } finally {
      setGenLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: '#0b0b0c' }} behavior={Platform.select({ ios: 'padding', android: undefined })}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        <Text style={styles.title}>Create Quote</Text>

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
            {autoDistLoading ? <ActivityIndicator /> : <Text style={{ color: 'white' }}>Travel: £{travelCharge.toFixed(2)}</Text>}
          </View>
        </View>

        {/* Actions */}
        <TouchableOpacity style={[styles.button, { opacity: saving ? 0.7 : 1 }]} onPress={saveDraftOnly} disabled={saving}>
          <Text style={styles.buttonText}>{saving ? 'Saving…' : 'Save Draft'}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={[styles.button, { backgroundColor: '#3ecf8e', opacity: genLoading ? 0.7 : 1 }]} onPress={generateAIAndPDF} disabled={genLoading}>
          <Text style={styles.buttonText}>{genLoading ? 'Generating…' : 'Generate Quote (AI)'}</Text>
        </TouchableOpacity>

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
});