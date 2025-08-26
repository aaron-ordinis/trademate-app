// app/(app)/onboarding.js
import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, TextInput, Switch, TouchableOpacity,
  StyleSheet, Alert, ScrollView, Image, KeyboardAvoidingView, Platform,
  ActivityIndicator, Modal, Pressable, Linking
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { supabase } from '../../lib/supabase';

// Theme (aligned with Settings/Profile light UI)
const BRAND  = '#2a86ff';
const TEXT   = '#0b1220';
const MUTED  = '#6b7280';
const CARD   = '#ffffff';
const BG     = '#f5f7fb';
const BORDER = '#e6e9ee';

const BUCKET = 'logos';

/* ---------- helpers (MATCH PROFILE) ---------- */
// Pure-JS base64 → Uint8Array (no atob/Buffer)
function base64ToBytes(b64) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const lookup = new Uint8Array(256);
  for (let i = 0; i < alphabet.length; i++) lookup[alphabet.charCodeAt(i)] = i;
  const clean = b64.replace(/[^A-Za-z0-9+/=]/g, '');
  const len = clean.length;
  const pads = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  const bytesLen = ((len * 3) >> 2) - pads;
  const out = new Uint8Array(bytesLen);
  let p = 0, i = 0;
  while (i < len) {
    const a = lookup[clean.charCodeAt(i++)];
    const b = lookup[clean.charCodeAt(i++)];
    const c = lookup[clean.charCodeAt(i++)];
    const d = lookup[clean.charCodeAt(i++)];
    const trip = (a << 18) | (b << 12) | (c << 6) | d;
    if (p < bytesLen) out[p++] = (trip >> 16) & 0xff;
    if (p < bytesLen) out[p++] = (trip >> 8) & 0xff;
    if (p < bytesLen) out[p++] = trip & 0xff;
  }
  return out;
}

// Resolve a usable file URL (public bucket or signed URL fallback)
async function resolveStorageUrl(pathInBucket) {
  const { data: pub, error: pubErr } = supabase.storage.from(BUCKET).getPublicUrl(pathInBucket);
  if (!pubErr && pub?.publicUrl) return pub.publicUrl;

  // long-lived signed fallback
  const expiresIn = 60 * 60 * 24 * 365 * 5;
  const { data: signed, error: sErr } = await supabase
    .storage
    .from(BUCKET)
    .createSignedUrl(pathInBucket, expiresIn);
  if (!sErr && signed?.signedUrl) return signed.signedUrl;

  throw new Error(pubErr?.message || sErr?.message || 'Could not get logo URL');
}

export default function Onboarding() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  // Prefill email only
  const [email, setEmail] = useState('');

  // Basics
  const [businessName, setBusinessName]   = useState('');
  const [phone, setPhone]                 = useState('');
  const [address1, setAddress1]           = useState('');
  const [city, setCity]                   = useState('');
  const [postcode, setPostcode]           = useState('');
  const [tradeType, setTradeType]         = useState('');

  const [vatRegistered, setVatRegistered] = useState(false);
  const [companyReg, setCompanyReg]       = useState('');
  const [vatNumber, setVatNumber]         = useState('');

  const [hourlyRate, setHourlyRate]       = useState('');
  const [markup, setMarkup]               = useState('');
  const [travelRate, setTravelRate]       = useState(''); // £/mile
  const [hoursPerDay, setHoursPerDay]     = useState(''); // hours/day

  const [terms, setTerms]                 = useState('');
  const [warranty, setWarranty]           = useState('');

  // Logo (mirror Profile)
  const [logoUrl, setLogoUrl]             = useState(null);
  const [logoWorking, setLogoWorking]     = useState(false);
  const [logoModalOpen, setLogoModalOpen] = useState(false);

  const [saving, setSaving]               = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      const u = data?.user;
      if (!u) { router.replace('/(auth)/login'); return; }
      setEmail(u.email ?? '');
    })();
  }, [router]);

  const toNumber = (v, fallback = 0) => {
    if (v === '' || v === null || v === undefined) return fallback;
    const n = Number(String(v).replace(/[^0-9.]/g, ''));
    return Number.isFinite(n) ? n : fallback;
  };

  // Live calculated Day Rate (read-only)
  const dayRate = useMemo(() => {
    const hr  = toNumber(hourlyRate, 0);
    const hpd = toNumber(hoursPerDay, 10); // sensible default
    return +(hr * hpd).toFixed(2);
  }, [hourlyRate, hoursPerDay]);

  const initials = useMemo(() => {
    const src = String(businessName || '').replace(/[^a-zA-Z ]/g, ' ').trim();
    if (!src) return 'U';
    const parts = src.split(/\s+/).slice(0, 2);
    return parts.map(p => p.charAt(0).toUpperCase()).join('') || 'U';
  }, [businessName]);

  /* ---------- LOGO ACTIONS (MATCH PROFILE) ---------- */
  const pickAndUploadLogo = async () => {
    try {
      setLogoWorking(true);

      const result = await DocumentPicker.getDocumentAsync({
        multiple: false,
        copyToCacheDirectory: true,
        type: ['image/*', 'application/pdf'],
      });
      if (result.canceled) return;

      const file = result.assets[0];
      const uri = file.uri;
      const name = file.name || (Platform.OS === 'ios' ? uri.split('/').pop() : `upload_${Date.now()}`);
      const ext = (name?.split('.').pop() || '').toLowerCase();

      // Choose content-type
      let contentType = 'application/octet-stream';
      if (ext === 'pdf') contentType = 'application/pdf';
      else if (ext === 'jpg' || ext === 'jpeg') contentType = 'image/jpeg';
      else if (ext === 'png') contentType = 'image/png';
      else if (ext === 'webp') contentType = 'image/webp';
      else if (file.mimeType) contentType = file.mimeType;

      const { data: userData } = await supabase.auth.getUser();
      const currentUser = userData?.user;
      if (!currentUser) throw new Error('Not signed in');

      // Read file as base64 (safe for content:// and ph://)
      const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
      if (!base64) throw new Error('Could not read file data');

      // Convert to bytes and upload
      const bytes = base64ToBytes(base64);
      const pathInBucket = `${currentUser.id}/${Date.now()}.${ext || 'bin'}`;

      const { error: upErr } = await supabase
        .storage
        .from(BUCKET)
        .upload(pathInBucket, bytes, { contentType, upsert: true });
      if (upErr) throw upErr;

      // URL (public or signed)
      const publicishUrl = await resolveStorageUrl(pathInBucket);

      // Upsert a minimal row so the logo appears even before finishing onboarding
      await supabase.from('profiles').upsert({ id: currentUser.id, custom_logo_url: publicishUrl }).catch(() => {});

      setLogoUrl(publicishUrl);
    } catch (e) {
      Alert.alert('Upload failed', e?.message || 'Could not upload logo.');
    } finally {
      setLogoWorking(false);
      setLogoModalOpen(false);
    }
  };

  const removeLogo = async () => {
    try {
      if (!logoUrl) { setLogoModalOpen(false); return; }
      setLogoWorking(true);

      const { data: userData } = await supabase.auth.getUser();
      const user = userData?.user;
      if (!user) throw new Error('Not signed in');

      // Best-effort delete from storage (path inference)
      const url = String(logoUrl || '');
      let storagePath = null;
      const markers = [
        '/storage/v1/object/public/logos/',
        '/object/public/logos/',
        '/logos/',
      ];
      for (const m of markers) {
        const i = url.indexOf(m);
        if (i !== -1) { storagePath = url.substring(i + m.length).split('?')[0]; break; }
      }
      if (storagePath) {
        await supabase.storage.from(BUCKET).remove([storagePath]).catch(() => {});
      }

      await supabase.from('profiles').upsert({ id: user.id, custom_logo_url: null }).catch(() => {});
      setLogoUrl(null);
    } catch (e) {
      Alert.alert('Error', e?.message || 'Could not remove logo.');
    } finally {
      setLogoWorking(false);
      setLogoModalOpen(false);
    }
  };

  /* ---------- SAVE PROFILE ---------- */
  const saveProfile = async () => {
    try {
      setSaving(true);
      const { data: userData } = await supabase.auth.getUser();
      const user = userData?.user;
      if (!user) throw new Error('Not signed in.');

      const payload = {
        id: user.id,
        email,
        business_name: businessName.trim(),
        phone: phone.trim(),
        address_line1: address1.trim(),
        city: city.trim(),
        postcode: postcode.trim(),
        trade_type: tradeType.trim(),
        vat_registered: vatRegistered,
        company_reg_no: companyReg.trim(),
        vat_number: vatNumber.trim(),
        hourly_rate: toNumber(hourlyRate),
        materials_markup_pct: toNumber(markup),
        travel_rate_per_mile: toNumber(travelRate),
        hours_per_day: toNumber(hoursPerDay, 10),
        payment_terms: terms.trim(),
        warranty_text: warranty.trim(),
        custom_logo_url: logoUrl || null,
        branding: 'free',
      };

      if (!payload.business_name) {
        Alert.alert('Missing info', 'Please enter your Business Name.');
        setSaving(false); return;
      }
      if (!hourlyRate) {
        Alert.alert('Missing info', 'Please enter your Hourly Rate.');
        setSaving(false); return;
      }

      const { error } = await supabase.from('profiles').upsert(payload);
      if (error) throw error;

      Alert.alert('Saved', 'Your business profile is set up.');
      router.replace('/(app)/quotes/list');
    } catch (e) {
      console.error('[ONBOARD] save error', e);
      Alert.alert('Error', e?.message ?? 'Could not save profile.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView edges={['top','left','right','bottom']} style={{ flex: 1, backgroundColor: BG }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: Math.max(insets.bottom, 24) }} keyboardShouldPersistTaps="handled">
          {/* Header */}
          <View style={{ alignItems: 'center', marginBottom: 8 }}>
            <Text style={styles.h1}>Business Profile</Text>
            <Text style={styles.hintHeader}>Set this once. Used on every quote.</Text>
          </View>

          {/* Logo card (MIRRORS PROFILE UI) */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Company Logo</Text>
            <View style={{ alignItems: 'center', marginTop: 10 }}>
              <TouchableOpacity style={styles.avatarWrap} onPress={() => setLogoModalOpen(true)} activeOpacity={0.9}>
                {logoUrl ? (
                  <Image source={{ uri: logoUrl }} style={styles.avatarImg} resizeMode="cover" />
                ) : (
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>{initials}</Text>
                  </View>
                )}
                <View style={styles.editBadge}>
                  <Text style={styles.editBadgeText}>✎</Text>
                </View>
              </TouchableOpacity>

              {logoUrl ? (
                <TouchableOpacity onPress={() => Linking.openURL(logoUrl)} style={{ marginTop: 8 }}>
                  <Text style={{ color: MUTED }}>Open current logo</Text>
                </TouchableOpacity>
              ) : (
                <Text style={styles.hint}>PNG/JPEG (or PDF). Square works best.</Text>
              )}
            </View>
          </View>

          {/* Contact / basics */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Contact & Basics</Text>
            <TextInput style={[styles.input, styles.inputDisabled]} editable={false} value={email} placeholder="Email" placeholderTextColor={MUTED} />
            <Text style={styles.labelSmall}>Business Name</Text>
            <TextInput style={styles.input} placeholder="e.g. Aaron Electrical" placeholderTextColor={MUTED} value={businessName} onChangeText={setBusinessName} />
            <Text style={styles.labelSmall}>Phone</Text>
            <TextInput style={styles.input} placeholder="e.g. 07123 456789" placeholderTextColor={MUTED} value={phone} onChangeText={setPhone} />
          </View>

          {/* Address */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Business Address</Text>
            <Text style={styles.labelSmall}>Address line 1</Text>
            <TextInput style={styles.input} placeholder="Flat 21" placeholderTextColor={MUTED} value={address1} onChangeText={setAddress1} />
            <View style={styles.row2}>
              <View style={styles.flex1}>
                <Text style={styles.labelSmall}>City</Text>
                <TextInput style={styles.input} placeholder="Tamworth" placeholderTextColor={MUTED} value={city} onChangeText={setCity} />
              </View>
              <View style={styles.flex1}>
                <Text style={styles.labelSmall}>Postcode</Text>
                <TextInput style={styles.input} placeholder="B77 2AR" placeholderTextColor={MUTED} value={postcode} onChangeText={setPostcode} />
              </View>
            </View>
            <Text style={styles.labelSmall}>Trade</Text>
            <TextInput style={styles.input} placeholder="e.g. plumber, electrician" placeholderTextColor={MUTED} value={tradeType} onChangeText={setTradeType} />
          </View>

          {/* VAT & company */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Company Details</Text>
            <View style={[styles.switchRow, { marginBottom: 10 }]}>
              <View>
                <Text style={styles.label}>VAT Registered</Text>
                <Text style={styles.hint}>Toggle on if you’re VAT registered.</Text>
              </View>
              <Switch value={vatRegistered} onValueChange={setVatRegistered} />
            </View>
            <Text style={styles.labelSmall}>Company Reg No. (optional)</Text>
            <TextInput style={styles.input} placeholder="12344757" placeholderTextColor={MUTED} value={companyReg} onChangeText={setCompanyReg} />
            <Text style={styles.labelSmall}>VAT No. (optional)</Text>
            <TextInput style={styles.input} placeholder="12746473" placeholderTextColor={MUTED} value={vatNumber} onChangeText={setVatNumber} />
          </View>

          {/* Pricing */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Rates & Markup</Text>

            <View style={styles.row2}>
              <View style={styles.flex1}>
                <Text style={styles.labelSmall}>Hourly Rate (£)</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. 25"
                  keyboardType="decimal-pad"
                  placeholderTextColor={MUTED}
                  value={hourlyRate}
                  onChangeText={setHourlyRate}
                />
              </View>
              <View style={styles.flex1}>
                <Text style={styles.labelSmall}>Materials Markup (%)</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. 15"
                  keyboardType="decimal-pad"
                  placeholderTextColor={MUTED}
                  value={markup}
                  onChangeText={setMarkup}
                />
              </View>
            </View>

            <View style={styles.row2}>
              <View className="flex-1" style={styles.flex1}>
                <Text style={styles.labelSmall}>Travel Fee (£/mile)</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. 0.45"
                  keyboardType="decimal-pad"
                  placeholderTextColor={MUTED}
                  value={travelRate}
                  onChangeText={setTravelRate}
                />
              </View>
              <View style={styles.flex1}>
                <Text style={styles.labelSmall}>Hours per day</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. 10"
                  keyboardType="decimal-pad"
                  placeholderTextColor={MUTED}
                  value={hoursPerDay}
                  onChangeText={setHoursPerDay}
                />
              </View>
            </View>

            {/* Day Rate (auto) */}
            <View style={styles.calcRow}>
              <Text style={styles.calcLabel}>Day Rate (auto)</Text>
              <Text style={styles.calcValue}>£{dayRate.toFixed(2)}</Text>
            </View>
            <Text style={styles.hint}>Day rate = Hourly × Hours/Day. Used when a job spans multiple days.</Text>
          </View>

          {/* Terms */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Terms</Text>
            <Text style={styles.labelSmall}>Payment Terms</Text>
            <TextInput style={styles.input} placeholder="e.g. Payment due within 7 days" placeholderTextColor={MUTED} value={terms} onChangeText={setTerms} />
            <Text style={styles.labelSmall}>Warranty</Text>
            <TextInput style={styles.input} placeholder="e.g. 12 months workmanship warranty" placeholderTextColor={MUTED} value={warranty} onChangeText={setWarranty} />
          </View>

          <TouchableOpacity style={[styles.btnSave, saving && { opacity: 0.7 }]} onPress={saveProfile} disabled={saving} activeOpacity={0.9}>
            {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnSaveText}>Save & Continue</Text>}
          </TouchableOpacity>

          <View style={{ height: Math.max(insets.bottom, 16) }} />
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Upload / Replace / Remove logo (IDENTICAL UX TO PROFILE) */}
      <Modal visible={logoModalOpen} animationType="fade" transparent>
        <Pressable style={styles.modalBackdrop} onPress={() => !logoWorking && setLogoModalOpen(false)} />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>{logoUrl ? 'Update your logo' : 'Upload a logo'}</Text>
          <Text style={styles.sheetSub}>Supported: JPG, PNG, or PDF.</Text>

          <TouchableOpacity
            style={[styles.primaryBtn, logoWorking && { opacity: 0.6 }]}
            disabled={logoWorking}
            onPress={pickAndUploadLogo}
            activeOpacity={0.9}
          >
            {logoWorking ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.primaryBtnText}>{logoUrl ? 'Choose new logo' : 'Choose logo'}</Text>
            )}
          </TouchableOpacity>

          {logoUrl && (
            <TouchableOpacity style={styles.dangerBtn} onPress={removeLogo} disabled={logoWorking} activeOpacity={0.9}>
              <Text style={styles.dangerBtnText}>Remove logo</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={styles.secondaryBtn}
            onPress={() => setLogoModalOpen(false)}
            disabled={logoWorking}
            activeOpacity={0.9}
          >
            <Text style={styles.secondaryBtnText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  h1: { color: TEXT, fontSize: 24, fontWeight: '800' },
  hintHeader: { color: MUTED, marginTop: 4, textAlign: 'center' },

  card: {
    backgroundColor: CARD, borderRadius: 16, padding: 16,
    borderWidth: 1, borderColor: BORDER, marginBottom: 14,
    shadowColor: '#0b1220', shadowOpacity: 0.05, shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 }, elevation: 2,
  },
  cardTitle: { color: TEXT, fontWeight: '800', marginBottom: 6 },

  input: {
    backgroundColor: '#f9fafb',
    color: TEXT,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: BORDER,
    marginBottom: 10,
  },
  inputDisabled: { opacity: 0.7 },

  label: { color: TEXT, fontWeight: '700' },
  labelSmall: { color: MUTED, fontSize: 12, marginBottom: 6, fontWeight: '700' },
  hint: { color: MUTED, fontSize: 12, marginTop: 4 },

  row2: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  flex1: { flex: 1 },

  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },

  // Avatar-style logo (mirror Profile)
  avatarWrap: { position: 'relative', alignItems: 'center', justifyContent: 'center' },
  avatar: {
    width: 64, height: 64, borderRadius: 32, backgroundColor: BRAND + '15',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: BORDER, marginBottom: 10,
  },
  avatarImg: {
    width: 64, height: 64, borderRadius: 32, borderWidth: 1, borderColor: BORDER, marginBottom: 10,
  },
  avatarText: { color: BRAND, fontWeight: '900', fontSize: 20 },
  editBadge: {
    position: 'absolute', right: -2, bottom: 6, height: 22, width: 22, borderRadius: 11,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: BRAND, borderWidth: 1, borderColor: '#ffffff',
  },
  editBadgeText: { color: '#fff', fontWeight: '900', fontSize: 12 },

  // Day-rate calc
  calcRow: {
    backgroundColor: '#eef2f7',
    borderWidth: 1, borderColor: BORDER,
    paddingVertical: 12, paddingHorizontal: 14,
    borderRadius: 12, marginBottom: 8,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'
  },
  calcLabel: { color: MUTED, fontWeight: '700' },
  calcValue: { color: TEXT, fontWeight: '900' },

  // Save CTA
  btnSave: {
    backgroundColor: BRAND, borderRadius: 14, padding: 14, alignItems: 'center',
    shadowColor: BRAND, shadowOpacity: 0.2, shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 }, elevation: 3,
  },
  btnSaveText: { color: '#fff', fontWeight: '900' },

  // Modal / bottom sheet (same as Profile)
  modalBackdrop: { flex: 1, backgroundColor: '#0008' },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    backgroundColor: CARD, borderTopLeftRadius: 18, borderTopRightRadius: 18,
    padding: 16, borderTopWidth: 1, borderColor: BORDER,
  },
  sheetHandle: { alignSelf: 'center', width: 44, height: 5, borderRadius: 999, backgroundColor: BORDER, marginBottom: 10 },
  sheetTitle: { color: TEXT, fontWeight: '900', fontSize: 18 },
  sheetSub: { color: MUTED, marginTop: 6, marginBottom: 12 },

  primaryBtn: {
    backgroundColor: BRAND, borderRadius: 12, paddingVertical: 12,
    alignItems: 'center', flexDirection: 'row', justifyContent: 'center',
  },
  primaryBtnText: { color: '#fff', fontWeight: '800' },

  dangerBtn: {
    marginTop: 10, backgroundColor: '#ef4444', borderRadius: 12,
    paddingVertical: 12, alignItems: 'center', flexDirection: 'row', justifyContent: 'center',
  },
  dangerBtnText: { color: '#fff', fontWeight: '800' },

  secondaryBtn: {
    marginTop: 10, backgroundColor: '#eef2f7', borderRadius: 12, paddingVertical: 12, alignItems: 'center',
  },
  secondaryBtnText: { color: TEXT, fontWeight: '800' },
});