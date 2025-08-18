// app/(app)/profile/index.js
import React, { useEffect, useMemo, useState } from 'react';
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
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../../../lib/supabase';

const BUCKET = 'logos';
const NAME_LOCK_DAYS = 28;

// ---- helpers ----
function base64ToBlob(base64, mime = 'application/octet-stream') {
  const binary = global.atob ? atob(base64) : Buffer.from(base64, 'base64').toString('binary');
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

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

  // ---------- pick & upload logo ----------
  const pickLogo = async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Permission needed', 'Please allow photo library access to pick a logo.');
        return;
      }

      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        quality: 0.92,
        aspect: [1, 1],
      });

      if (res.canceled) return;
      const asset = res.assets?.[0];
      if (!asset?.uri) return;

      const isPng = asset.mimeType?.includes('png') || asset.uri.toLowerCase().endsWith('.png');
      const isJpg =
        asset.mimeType?.includes('jpeg') ||
        asset.mimeType?.includes('jpg') ||
        asset.uri.toLowerCase().endsWith('.jpg') ||
        asset.uri.toLowerCase().endsWith('.jpeg');

      if (!isPng && !isJpg) {
        Alert.alert('Unsupported file', 'Please choose a PNG or JPEG image.');
        return;
      }

      await uploadLogo(asset.uri, isPng ? 'image/png' : 'image/jpeg');
    } catch (e) {
      console.error('[Profile] pickLogo', e);
      Alert.alert('Error', e?.message ?? 'Could not pick a logo.');
    }
  };

  const uploadLogo = async (uri, contentType) => {
    try {
      setUploading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not signed in');

      let blob;
      try {
        const resp = await fetch(uri);
        blob = await resp.blob();
      } catch {
        const b64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
        blob = base64ToBlob(b64, contentType);
      }

      const ext = contentType === 'image/png' ? 'png' : 'jpg';
      const path = `${user.id}/logo.${ext}`;

      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, blob, {
        contentType,
        upsert: true,
      });
      if (upErr) throw upErr;

      const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
      const publicUrl = pub?.publicUrl;
      if (!publicUrl) throw new Error('Could not get public URL for logo');

      const { error: upProfileErr } = await supabase
        .from('profiles')
        .update({ custom_logo_url: publicUrl })
        .eq('id', user.id);
      if (upProfileErr) throw upProfileErr;

      setForm((f) => ({ ...f, custom_logo_url: `${publicUrl}?t=${Date.now()}` }));
      Alert.alert('Logo updated', 'Your logo has been uploaded.');
    } catch (e) {
      console.error('[Profile] uploadLogo', e);
      Alert.alert('Upload failed', e?.message ?? 'Could not upload logo.');
    } finally {
      setUploading(false);
    }
  };

  const removeLogo = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not signed in');

      try { await supabase.storage.from(BUCKET).remove([`${user.id}/logo.png`]); } catch {}
      try { await supabase.storage.from(BUCKET).remove([`${user.id}/logo.jpg`]); } catch {}

      const { error } = await supabase
        .from('profiles')
        .update({ custom_logo_url: null })
        .eq('id', user.id);
      if (error) throw error;

      setForm((f) => ({ ...f, custom_logo_url: '' }));
      Alert.alert('Removed', 'Logo removed from your profile.');
    } catch (e) {
      Alert.alert('Error', e?.message ?? 'Could not remove logo.');
    }
  };

  // ---------- load profile ----------
  useEffect(() => {
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const { data, error } = await supabase
          .from('profiles')
          .select(
            'business_name, business_name_last_changed_at, trade_type, hourly_rate, materials_markup_pct, vat_registered, payment_terms, warranty_text, travel_rate_per_mile, address_line1, city, postcode, custom_logo_url'
          )
          .eq('id', user.id)
          .maybeSingle();

        if (error) throw error;

        if (data) {
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
        }
      } catch (e) {
        Alert.alert('Error', e?.message ?? 'Could not load profile.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // ---------- save profile ----------
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
      <View style={styles.loading}>
        <ActivityIndicator color="#9aa0a6" />
      </View>
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
    address_line1: 'e.g. 10 Downing Street',
    city: 'e.g. London',
    postcode: 'e.g. SW1A 2AA',
    custom_logo_url: 'Optional — set automatically when you upload a logo',
  };

  return (
    <SafeAreaView edges={['top', 'left', 'right', 'bottom']} style={{ flex: 1, backgroundColor: '#0b0b0c' }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          style={styles.wrap}
          contentContainerStyle={{ padding: 16, paddingBottom: Math.max(insets.bottom, 24) }}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.h1}>Business Profile</Text>

          {/* Logo block */}
          <View style={styles.card}>
            <Text style={styles.blockTitle}>Company Logo</Text>
            {form.custom_logo_url ? (
              <View style={{ alignItems: 'center', marginTop: 10 }}>
                <Image source={{ uri: form.custom_logo_url }} style={styles.logo} resizeMode="contain" />
                <View style={styles.logoBtns}>
                  <TouchableOpacity style={[styles.btnAlt, uploading && styles.btnDisabled]} onPress={pickLogo} disabled={uploading}>
                    <Text style={styles.btnAltText}>{uploading ? 'Uploading…' : 'Change logo'}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.btnDanger} onPress={removeLogo}>
                    <Text style={styles.btnDangerText}>Remove</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <TouchableOpacity style={[styles.btn, uploading && styles.btnDisabled]} onPress={pickLogo} disabled={uploading}>
                <Text style={styles.btnText}>{uploading ? 'Uploading…' : 'Upload Logo (PNG/JPEG)'}</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Business name (LOCKED UI when within 28 days) */}
          <View style={styles.field}>
            <Text style={styles.label}>Business name</Text>
            <TextInput
              style={[styles.input, isNameLocked && styles.inputDisabled]}
              value={String(form.business_name ?? '')}
              onChangeText={(t) => setForm((f) => ({ ...f, business_name: t }))}
              placeholder={placeholders.business_name}
              placeholderTextColor="#777"
              autoCapitalize="words"
              editable={!isNameLocked}
            />
            {isNameLocked ? (
              <Text style={styles.hint}>
                🔒 Locked — you can change this again in {nameDaysRemaining} day{(nameDaysRemaining === 1 ? '' : 's')}.
              </Text>
            ) : (
              <Text style={styles.hint}>Changing your business name will lock it for {NAME_LOCK_DAYS} days.</Text>
            )}
          </View>

          {/* VAT switch */}
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

          {/* Remaining fields */}
          {[
            ['trade_type', 'Trade type'],
            ['hourly_rate', 'Hourly rate (£/hr)', 'number'],
            ['materials_markup_pct', 'Materials markup %', 'number'],
            ['travel_rate_per_mile', 'Travel rate (£/mile)', 'number'],
            ['payment_terms', 'Payment terms'],
            ['warranty_text', 'Warranty text'],
            ['address_line1', 'Address line 1'],
            ['city', 'City'],
            ['postcode', 'Postcode'],
            ['custom_logo_url', 'Custom logo URL (optional)'],
          ].map(([key, label, kind]) => (
            <View key={key} style={styles.field}>
              <Text style={styles.label}>{label}</Text>
              <TextInput
                style={styles.input}
                value={String(form[key] ?? '')}
                onChangeText={(t) => setForm((f) => ({ ...f, [key]: t }))}
                placeholder={placeholders[key]}
                placeholderTextColor="#777"
                {...(kind === 'number' ? numericProps : {})}
                autoCapitalize="none"
              />
            </View>
          ))}

          <TouchableOpacity style={styles.btnSave} onPress={save} disabled={saving}>
            <Text style={styles.btnSaveText}>{saving ? 'Saving…' : 'Save'}</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, backgroundColor: '#0b0b0c', alignItems: 'center', justifyContent: 'center' },
  wrap: { flex: 1, backgroundColor: '#0b0b0c' },
  h1: { color: 'white', fontSize: 22, fontWeight: '800', marginBottom: 12 },

  card: {
    backgroundColor: '#17171a',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#2b2c2f',
    marginBottom: 14,
  },
  blockTitle: { color: 'white', fontWeight: '800', marginBottom: 4 },

  logo: { width: 160, height: 80, backgroundColor: '#0b0b0c', borderRadius: 12 },
  logoBtns: { marginTop: 10, flexDirection: 'row', gap: 10 },

  field: { marginBottom: 10 },
  label: { color: '#cfcfd2', marginBottom: 6, fontWeight: '600' },
  hint: { color: '#9aa0a6', fontSize: 12, marginTop: 4 },

  input: {
    backgroundColor: '#1a1a1d',
    color: 'white',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#2b2c2f',
  },
  inputDisabled: {
    opacity: 0.6,
  },

  // Buttons
  btn: { backgroundColor: '#2a86ff', borderRadius: 12, padding: 12, alignItems: 'center', marginTop: 8 },
  btnText: { color: 'white', fontWeight: '800' },
  btnAlt: { backgroundColor: '#272729', borderRadius: 12, paddingVertical: 10, paddingHorizontal: 14, borderWidth: 1, borderColor: '#3c3c3f' },
  btnAltText: { color: 'white', fontWeight: '800' },
  btnDanger: { backgroundColor: '#b3261e', borderRadius: 12, paddingVertical: 10, paddingHorizontal: 14 },
  btnDangerText: { color: 'white', fontWeight: '800' },
  btnDisabled: { opacity: 0.6 },

  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },

  btnSave: { marginTop: 12, backgroundColor: '#3ecf8e', borderRadius: 12, padding: 14, alignItems: 'center' },
  btnSaveText: { color: '#0b0b0c', fontWeight: '800' },
});