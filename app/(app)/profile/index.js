// app/(app)/profile/index.js
import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  ScrollView,
  Platform,
  KeyboardAvoidingView,
  Image,
  Switch,
  Linking,
  Modal,
  Pressable,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { supabase } from '../../../lib/supabase';
import { getPremiumStatus, getTrialStatusText } from "../../../lib/premium";
import { ChevronLeft } from 'lucide-react-native';

const BUCKET = 'logos';
const NAME_LOCK_DAYS = 28;

// ---- theme (matches Settings/Account light UI) ----
const BRAND  = '#2a86ff';
const TEXT   = '#0b1220';
const MUTED  = '#6b7280';
const CARD   = '#ffffff';
const BG     = '#f5f7fb';
const BORDER = '#e6e9ee';

/* ---------- helpers (identical to Settings) ---------- */
/** Pure-JS base64 → Uint8Array (no atob/Buffer) */
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

/** Resolve a usable file URL (public bucket or signed URL fallback). */
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

export default function Profile() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [working, setWorking] = useState(false); // mirrors Settings "working"
  const [logoModalOpen, setLogoModalOpen] = useState(false);

  const [form, setForm] = useState({
    business_name: '',
    trade_type: '',
    hourly_rate: '',
    materials_markup_pct: '',
    vat_registered: false,
    payment_terms: '',
    warranty_text: '',
    travel_rate_per_mile: '',
    address_line1: '',
    city: '',
    postcode: '',
    custom_logo_url: '',
  });

  // name lock state
  const [originalBusinessName, setOriginalBusinessName] = useState('');
  const [nameLastChangedAt, setNameLastChangedAt] = useState(null);

  const nameDaysRemaining = useMemo(() => {
    if (!nameLastChangedAt) return 0;
    const msSince = Date.now() - new Date(nameLastChangedAt).getTime();
    const daysSince = Math.floor(msSince / (24 * 60 * 60 * 1000));
    const left = NAME_LOCK_DAYS - daysSince;
    return left > 0 ? left : 0;
  }, [nameLastChangedAt]);

  const isNameLocked = nameDaysRemaining > 0;

  const initials = useMemo(() => {
    const src = String(form.business_name || '')
      .replace(/[^a-zA-Z ]/g, ' ')
      .trim();
    if (!src) return 'U';
    const parts = src.split(/\s+/).slice(0, 2);
    return parts.map(p => p.charAt(0).toUpperCase()).join('') || 'U';
  }, [form.business_name]);

  const hasLogo = !!String(form.custom_logo_url || '').trim();
  const isPdfLogo = hasLogo && /\.pdf($|\?)/i.test(form.custom_logo_url || '');

  const [premiumStatus, setPremiumStatus] = useState({ isPremium: false, status: 'no_profile' });
  const [profileData, setProfileData] = useState(null);

  /* -------------------- Helper to calculate trial days remaining -------------------- */
  const getTrialDaysRemaining = () => {
    if (!profileData?.trial_ends_at) return 0;
    const trialEnd = new Date(profileData.trial_ends_at);
    const now = new Date();
    const diffTime = trialEnd - now;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return Math.max(0, diffDays);
  };

  const trialDaysLeft = getTrialDaysRemaining();

  /* ---------- load profile ---------- */
  useEffect(() => {
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const { data, error } = await supabase
          .from('profiles')
          .select(
            'business_name, business_name_last_changed_at, trade_type, hourly_rate, materials_markup_pct, vat_registered, payment_terms, warranty_text, travel_rate_per_mile, address_line1, city, postcode, custom_logo_url, plan_tier, plan_status, trial_ends_at'
          )
          .eq('id', user.id)
          .maybeSingle();

        if (error) throw error;

        if (data) {
          setProfileData(data);
          setForm((prev) => ({
            ...prev,
            ...data,
            hourly_rate: String(data.hourly_rate ?? ''),
            materials_markup_pct: String(data.materials_markup_pct ?? ''),
            travel_rate_per_mile: String(data.travel_rate_per_mile ?? ''),
            custom_logo_url: data.custom_logo_url ?? '',
            vat_registered: !!data.vat_registered,
          }));
          setOriginalBusinessName(data.business_name || '');
          setNameLastChangedAt(data.business_name_last_changed_at || null);

          // Update premium status
          const status = getPremiumStatus(data);
          setPremiumStatus(status);
        }
      } catch (e) {
        Alert.alert('Error', e?.message ?? 'Could not load profile.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  /* ---------- logo modal actions (MIRROR SETTINGS) ---------- */
  const pickAndUploadLogo = async () => {
    try {
      setWorking(true);

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

      // Use the already declared currentUser variable above

      // Read file as base64 (safe for content:// and ph://)
      const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
      if (!base64) throw new Error('Could not read file data');

      // Convert to bytes and upload
      const bytes = base64ToBytes(base64);
      const pathInBucket = `${currentUser.id}/${Date.now()}.${ext || 'bin'}`;

      const { error: upErr } = await supabase
        .storage
        .from(BUCKET)
        .upload(pathInBucket, bytes, {
          contentType,
          upsert: true,
        });
      if (upErr) throw upErr;

      // URL (public or signed)
      const publicishUrl = await resolveStorageUrl(pathInBucket);

      const { error: updErr } = await supabase
        .from('profiles')
        .update({ custom_logo_url: publicishUrl })
        .eq('id', currentUser.id);
      if (updErr) throw updErr;

      setForm((f) => ({ ...f, custom_logo_url: publicishUrl }));
    } catch (e) {
      Alert.alert('Upload failed', e?.message || 'Could not upload logo.');
    } finally {
      setWorking(false);
      setLogoModalOpen(false);
    }
  };

  const removeLogo = async () => {
    try {
      if (!hasLogo) { setLogoModalOpen(false); return; }
      setWorking(true);

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not signed in');

      const url = String(form.custom_logo_url || '');
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

      const { error: updErr } = await supabase
        .from('profiles')
        .update({ custom_logo_url: null })
        .eq('id', user.id);
      if (updErr) throw updErr;

      setForm((f) => ({ ...f, custom_logo_url: '' }));
    } catch (e) {
      Alert.alert('Error', e?.message || 'Could not remove logo.');
    } finally {
      setWorking(false);
      setLogoModalOpen(false);
    }
  };

  /* ---------- save profile ---------- */
  const save = async () => {
    try {
      setSaving(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not signed in');

      const tryingToChangeName = form.business_name.trim() !== originalBusinessName.trim();
      if (tryingToChangeName && isNameLocked) {
        Alert.alert(
          'Business name is locked',
          `You can change your business name again in ${nameDaysRemaining} day${nameDaysRemaining === 1 ? '' : 's'}.`,
        );
        setSaving(false);
        return;
      }

      const patch = {
        ...form,
        hourly_rate: Number(form.hourly_rate || 0),
        materials_markup_pct: Number(form.materials_markup_pct || 0),
        travel_rate_per_mile: Number(form.travel_rate_per_mile || 0),
        vat_registered: !!form.vat_registered,
      };

      if (tryingToChangeName) {
        patch.business_name_last_changed_at = new Date().toISOString();
      }

      const { error } = await supabase.from('profiles').update(patch).eq('id', user.id);
      if (error) throw error;

      if (tryingToChangeName) {
        setOriginalBusinessName(form.business_name);
        setNameLastChangedAt(new Date().toISOString());
      }

      Alert.alert('Saved', 'Profile updated.');
    } catch (e) {
      Alert.alert('Error', e?.message ?? 'Could not save profile.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView edges={['top','left','right','bottom']} style={styles.loadingWrap}>
        <ActivityIndicator color={BRAND} />
      </SafeAreaView>
    );
  }

  const numericProps =
    Platform.select({
      ios: { keyboardType: 'decimal-pad', inputMode: 'decimal' },
      android: { keyboardType: 'numeric', inputMode: 'numeric' },
      default: {},
    }) || {};

  const placeholders = {
    business_name: 'e.g. TradeMate Plumbing Ltd',
    trade_type: 'e.g. Plumber / Electrician',
    hourly_rate: 'e.g. 50',
    materials_markup_pct: 'e.g. 15',
    travel_rate_per_mile: 'e.g. 0.45',
    payment_terms: 'e.g. 50% upfront, balance on completion',
    warranty_text: 'e.g. 12 months parts & labour',
    address_line1: 'e.g. Unit 4, Spennymoor Industrial',
    city: 'e.g. Tamworth',
    postcode: 'e.g. B77 2AR',
  };

  const hasLogoNonPdf = hasLogo && !isPdfLogo;

  return (
    <SafeAreaView edges={['top','left','right','bottom']} style={{ flex: 1, backgroundColor: BG }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          style={styles.wrap}
          contentContainerStyle={{ padding: 16, paddingBottom: Math.max(insets.bottom, 24) }}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.header}>
            <TouchableOpacity 
              style={styles.backButton}
              onPress={() => router.back()}
              activeOpacity={0.7}
            >
              <ChevronLeft size={20} color={BRAND} />
              <Text style={styles.backText}>Back</Text>
            </TouchableOpacity>
            
            <View style={styles.headerContent}>
              <Text style={styles.h1}>Business Profile</Text>
              <Text style={styles.hintHeader}>Keep your information up to date. This appears on your quotes.</Text>
            </View>
          </View>

          {/* Trial Status Banner */}
          <View style={[
            styles.trialBanner,
            {
              flexDirection: premiumStatus?.isPremium ? 'row' : 'column',
              justifyContent: premiumStatus?.isPremium ? 'center' : 'space-between',
            }
          ]}>
            <Text style={[
              styles.trialStatusText,
              {
                color: premiumStatus.isPremium ? '#16a34a' :
                       premiumStatus.status === 'expired' ? '#dc2626' : 
                       '#f59e0b',
                textAlign: 'center',
                flex: premiumStatus?.isPremium ? 1 : 0,
              }
            ]}>
              {premiumStatus.isPremium 
                ? "You're on Premium"
                : trialDaysLeft > 0 
                  ? `${trialDaysLeft} day${trialDaysLeft === 1 ? '' : 's'} left on your trial`
                  : 'Trial expired'
              }
            </Text>
            {!premiumStatus.isPremium && (
              <TouchableOpacity 
                style={styles.subscribeButton}
                onPress={() => router.push("/(app)/account")}
                activeOpacity={0.9}
              >
                <Text style={styles.subscribeButtonText}>
                  {trialDaysLeft > 0 ? 'Subscribe' : 'Reactivate'}
                </Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Logo card */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Company Logo</Text>

            <View style={{ alignItems: 'center', marginTop: 10 }}>
              <TouchableOpacity style={styles.avatarWrap} onPress={() => setLogoModalOpen(true)} activeOpacity={0.9}>
                {hasLogoNonPdf ? (
                  <Image source={{ uri: form.custom_logo_url }} style={styles.avatarImg} resizeMode="cover" />
                ) : hasLogo && isPdfLogo ? (
                  <View style={[styles.avatar, { backgroundColor: '#fef3c7', borderColor: '#fde68a' }]}>
                    <Text style={{ color: '#92400e', fontWeight: '900' }}>PDF</Text>
                  </View>
                ) : (
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>{initials}</Text>
                  </View>
                )}
                <View style={styles.editBadge}>
                  <Text style={styles.editBadgeText}>✎</Text>
                </View>
              </TouchableOpacity>

              {hasLogo && (
                <TouchableOpacity onPress={() => Linking.openURL(form.custom_logo_url)} style={{ marginTop: 8 }}>
                  <Text style={styles.linkText}>View current logo</Text>
                </TouchableOpacity>
              )}

              {!hasLogo && (
                <View style={{ alignItems: 'center', marginTop: 8 }}>
                  <Text style={styles.hint}>PNG/JPEG (or PDF). Square works best.</Text>
                  <Text style={[styles.hint, { fontWeight: '600', color: '#2563eb' }]}>
                    For best results, use PNG with transparent background
                  </Text>
                </View>
              )}
            </View>
          </View>

          {/* Identity card */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Business Identity</Text>

            <View style={styles.field}>
              <Text style={styles.label}>Business name</Text>
              <TextInput
                style={[styles.input, isNameLocked && styles.inputDisabled]}
                value={String(form.business_name ?? '')}
                onChangeText={(t) => setForm((f) => ({ ...f, business_name: t }))}
                placeholder={placeholders.business_name}
                placeholderTextColor={MUTED}
                autoCapitalize="words"
                editable={!isNameLocked}
              />
              {isNameLocked ? (
                <Text style={styles.hint}>
                  🔒 Locked — you can change this again in {nameDaysRemaining} day{(nameDaysRemaining === 1 ? '' : 's')}.
                </Text>
              ) : (
                <Text style={styles.hint}>Changing your name will lock it for {NAME_LOCK_DAYS} days.</Text>
              )}
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>Trade type</Text>
              <TextInput
                style={styles.input}
                value={String(form.trade_type ?? '')}
                onChangeText={(t) => setForm((f) => ({ ...f, trade_type: t }))}
                placeholder={placeholders.trade_type}
                placeholderTextColor={MUTED}
                autoCapitalize="words"
              />
            </View>
          </View>

          {/* Finance & rates */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Rates & Terms</Text>

            <View style={styles.field}>
              <Text style={styles.label}>Hourly rate (£/hr)</Text>
              <TextInput
                style={styles.input}
                value={String(form.hourly_rate ?? '')}
                onChangeText={(t) => setForm((f) => ({ ...f, hourly_rate: t }))}
                placeholder={placeholders.hourly_rate}
                placeholderTextColor={MUTED}
                {...numericProps}
              />
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>Materials markup %</Text>
              <TextInput
                style={styles.input}
                value={String(form.materials_markup_pct ?? '')}
                onChangeText={(t) => setForm((f) => ({ ...f, materials_markup_pct: t }))}
                placeholder={placeholders.materials_markup_pct}
                placeholderTextColor={MUTED}
                {...numericProps}
              />
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>Travel rate (£/mile)</Text>
              <TextInput
                style={styles.input}
                value={String(form.travel_rate_per_mile ?? '')}
                onChangeText={(t) => setForm((f) => ({ ...f, travel_rate_per_mile: t }))}
                placeholder={placeholders.travel_rate_per_mile}
                placeholderTextColor={MUTED}
                {...numericProps}
              />
            </View>

            <View style={[styles.field, styles.switchRow]}>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>VAT registered</Text>
                <Text style={styles.hint}>Toggle on if you’re VAT registered.</Text>
              </View>
              <Switch
                value={!!form.vat_registered}
                onValueChange={(v) => setForm((f) => ({ ...f, vat_registered: v }))}
              />
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>Payment terms</Text>
              <TextInput
                style={styles.input}
                value={String(form.payment_terms ?? '')}
                onChangeText={(t) => setForm((f) => ({ ...f, payment_terms: t }))}
                placeholder={placeholders.payment_terms}
                placeholderTextColor={MUTED}
              />
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>Warranty text</Text>
              <TextInput
                style={styles.input}
                value={String(form.warranty_text ?? '')}
                onChangeText={(t) => setForm((f) => ({ ...f, warranty_text: t }))}
                placeholder={placeholders.warranty_text}
                placeholderTextColor={MUTED}
              />
            </View>
          </View>

          {/* Address */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Business Address</Text>

            <View style={styles.field}>
              <Text style={styles.label}>Address line 1</Text>
              <TextInput
                style={styles.input}
                value={String(form.address_line1 ?? '')}
                onChangeText={(t) => setForm((f) => ({ ...f, address_line1: t }))}
                placeholder={placeholders.address_line1}
                placeholderTextColor={MUTED}
                autoCapitalize="words"
              />
            </View>

            <View style={styles.row2}>
              <View style={[styles.field, styles.col]}>
                <Text style={styles.label}>City</Text>
                <TextInput
                  style={styles.input}
                  value={String(form.city ?? '')}
                  onChangeText={(t) => setForm((f) => ({ ...f, city: t }))}
                  placeholder={placeholders.city}
                  placeholderTextColor={MUTED}
                  autoCapitalize="words"
                />
              </View>
              <View style={[styles.field, styles.col]}>
                <Text style={styles.label}>Postcode</Text>
                <TextInput
                  style={styles.input}
                  value={String(form.postcode ?? '')}
                  onChangeText={(t) => setForm((f) => ({ ...f, postcode: t }))}
                  placeholder={placeholders.postcode}
                  placeholderTextColor={MUTED}
                  autoCapitalize="characters"
                />
              </View>
            </View>
          </View>

          {/* Advanced (URL shown for transparency) */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Advanced</Text>
            <View style={styles.field}>
              <Text style={styles.label}>Custom logo URL (optional)</Text>
              <TextInput
                style={styles.input}
                value={String(form.custom_logo_url ?? '')}
                onChangeText={(t) => setForm((f) => ({ ...f, custom_logo_url: t }))}
                placeholder="Set automatically when you upload a logo"
                placeholderTextColor={MUTED}
                autoCapitalize="none"
              />
              <Text style={styles.hint}>You can paste a hosted image URL here if needed.</Text>
            </View>
          </View>

          <TouchableOpacity style={styles.btnSave} onPress={save} disabled={saving} activeOpacity={0.9}>
            {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnSaveText}>Save changes</Text>}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Upload / Replace / Remove logo (identical to Settings) */}
      <Modal visible={logoModalOpen} animationType="fade" transparent>
        <Pressable style={styles.modalBackdrop} onPress={() => !working && setLogoModalOpen(false)} />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>{hasLogo ? 'Update your logo' : 'Upload a logo'}</Text>
          <Text style={styles.sheetSub}>Supported: JPG, PNG, or PDF.</Text>

          <TouchableOpacity
            style={[styles.primaryBtn, working && { opacity: 0.6 }]}
            disabled={working}
            onPress={pickAndUploadLogo}
            activeOpacity={0.9}
          >
            {working ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.primaryBtnText}>{hasLogo ? 'Choose new logo' : 'Choose logo'}</Text>
            )}
          </TouchableOpacity>

          {hasLogo && (
            <TouchableOpacity style={styles.dangerBtn} onPress={removeLogo} disabled={working} activeOpacity={0.9}>
              <Text style={styles.dangerBtnText}>Remove logo</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={styles.secondaryBtn}
            onPress={() => setLogoModalOpen(false)}
            disabled={working}
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
  loadingWrap: { flex: 1, backgroundColor: BG, alignItems: 'center', justifyContent: 'center' },
  wrap: { flex: 1, backgroundColor: BG },

  header: { 
    marginBottom: 6,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 8,
    paddingHorizontal: 8,
    marginLeft: -8,
    marginBottom: 12,
  },
  backText: {
    color: BRAND,
    fontSize: 16,
    fontWeight: '800',
  },
  headerContent: {
    alignItems: 'center',
  },
  h1: { color: TEXT, fontSize: 24, fontWeight: '800' },
  hintHeader: { color: MUTED, marginTop: 4, textAlign: 'center' },

  card: {
    backgroundColor: CARD,
    borderRadius: 16,
    padding: 20, // Increased padding for more professional look
    borderWidth: 1,
    borderColor: BORDER,
    marginBottom: 16, // Consistent spacing
    shadowColor: '#0b1220',
    shadowOpacity: 0.06, // Slightly stronger shadow
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  cardTitle: {
    color: TEXT,
    fontWeight: '800',
    fontSize: 18, // Larger title
    marginBottom: 8,
  },

  /* Circular avatar (same as Settings) */
  avatarWrap: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  avatar: {
    width: 80, // Larger avatar
    height: 80,
    borderRadius: 40,
    backgroundColor: BRAND + '10',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2, // Thicker border
    borderColor: '#e2e8f0',
    marginBottom: 12,
  },
  avatarImg: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 2,
    borderColor: '#e2e8f0',
    marginBottom: 12,
  },
  avatarText: {
    color: BRAND,
    fontWeight: '900',
    fontSize: 24, // Larger text
  },
  editBadge: {
    position: 'absolute',
    right: -2,
    bottom: 8,
    height: 28, // Larger badge
    width: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: BRAND,
    borderWidth: 2,
    borderColor: '#ffffff',
    shadowColor: '#0b1220',
    shadowOpacity: 0.15,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  editBadgeText: {
    color: '#fff',
    fontWeight: '900',
    fontSize: 14,
  },

  // Fields
  field: {
    marginBottom: 16, // More consistent spacing
  },
  label: {
    color: TEXT,
    marginBottom: 8,
    fontWeight: '700',
    fontSize: 16,
  },
  input: {
    backgroundColor: '#f8fafc',
    color: TEXT,
    borderRadius: 12,
    padding: 14, // Increased padding
    borderWidth: 1,
    borderColor: BORDER,
    fontSize: 16,
  },
  inputDisabled: { opacity: 0.6 },
  hint: {
    color: MUTED,
    fontSize: 13,
    marginTop: 6,
    lineHeight: 18,
  },

  // Grid
  row2: { flexDirection: 'row', gap: 10 },
  col: { flex: 1 },

  // Switch row
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },

  // Buttons
  btnSave: {
    backgroundColor: BRAND,
    borderRadius: 14,
    padding: 16, // Increased padding
    alignItems: 'center',
    marginTop: 8,
    shadowColor: BRAND,
    shadowOpacity: 0.3,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  btnSaveText: {
    color: '#fff',
    fontWeight: '900',
    fontSize: 16,
  },

  // Modal / bottom sheet (copied from Settings)
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

  // Trial status banner - updated for professional look
  trialBanner: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    flexDirection: 'column', // Remove premiumStatus reference
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    shadowColor: '#0b1220',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  trialStatusText: {
    fontSize: 16,
    fontWeight: '800',
    flex: 0, // Remove premiumStatus reference
  },
  subscribeButton: {
    backgroundColor: '#2a86ff',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
    shadowColor: '#2a86ff',
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  subscribeButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '800',
  },

  // Updated link text style for logo
  linkText: {
    color: '#2a86ff',
    fontSize: 14,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
});