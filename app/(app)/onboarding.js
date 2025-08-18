// app/(app)/onboarding.js
import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, TextInput, Switch, TouchableOpacity,
  StyleSheet, Alert, ScrollView, Image, KeyboardAvoidingView, Platform
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { supabase } from '../../lib/supabase';

export default function Onboarding() {
  const router = useRouter();

  // Only email starts prefilled
  const [email, setEmail] = useState('');

  // Everything else empty
  const [businessName, setBusinessName] = useState('');
  const [phone, setPhone] = useState('');
  const [address1, setAddress1] = useState('');
  const [city, setCity] = useState('');
  const [postcode, setPostcode] = useState('');
  const [tradeType, setTradeType] = useState('');

  const [vatRegistered, setVatRegistered] = useState(false);
  const [companyReg, setCompanyReg] = useState('');
  const [vatNumber, setVatNumber] = useState('');

  const [hourlyRate, setHourlyRate] = useState('');
  const [markup, setMarkup] = useState('');
  const [travelRate, setTravelRate] = useState(''); // £/mile
  const [hoursPerDay, setHoursPerDay] = useState(''); // hours/day

  const [terms, setTerms] = useState('');
  const [warranty, setWarranty] = useState('');

  const [logoUri, setLogoUri] = useState(null);
  const [logoUploading, setLogoUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      const u = data?.user;
      if (!u) {
        router.replace('/(auth)/login');
        return;
      }
      setEmail(u.email ?? '');
    })();
  }, [router]);

  const toNumber = (v, fallback = 0) => {
    if (v === '' || v === null || v === undefined) return fallback;
    const n = Number(String(v).replace(/[^0-9.]/g, ''));
    return Number.isFinite(n) ? n : fallback;
  };

  // 🔹 Live calculated Day Rate (read-only)
  const dayRate = useMemo(() => {
    const hr = toNumber(hourlyRate, 0);
    const hpd = toNumber(hoursPerDay, 10); // default 10
    return +(hr * hpd).toFixed(2);
  }, [hourlyRate, hoursPerDay]);

  const pickLogo = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Please allow photo library access to upload a logo.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        quality: 0.9
      });
      if (result.canceled) return;
      const asset = result.assets?.[0];
      if (!asset?.uri) return;

      setLogoUploading(true);
      const { data: userData } = await supabase.auth.getUser();
      const logoUserData = userData?.user;
      if (!logoUserData) throw new Error('Not signed in');

      const ext =
        (asset.mimeType?.split('/')[1] ??
         asset.fileName?.split('.').pop() ??
         'png').toLowerCase();
      const contentType = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/png';
      const safeExt = contentType === 'image/jpeg' ? 'jpg' : 'png';
      const path = `${logoUserData.id}/logo.${safeExt}`;

      const bytes = await (await fetch(asset.uri)).blob();

      const { error: upErr } = await supabase
        .storage
        .from('logos')
        .upload(path, bytes, { upsert: true, contentType });
      if (upErr) throw upErr;

      const { data: pub } = supabase.storage.from('logos').getPublicUrl(path);
      setLogoUri(pub.publicUrl);
      Alert.alert('Logo uploaded', `Logo saved as ${safeExt.toUpperCase()}.`);
    } catch (e) {
      console.error('[TMQ][ONBOARD] logo upload error', e);
      Alert.alert('Logo upload failed', e.message ?? 'Please try again.');
    } finally {
      setLogoUploading(false);
    }
  };

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
        hours_per_day: toNumber(hoursPerDay, 10), // ✅ saved
        payment_terms: terms.trim(),
        warranty_text: warranty.trim(),
        custom_logo_url: logoUri || null,
        plan: 'free', // 👈 default everyone to free tier
        // ❗ day_rate is derived; no need to save.
      };

      if (!payload.business_name) {
        Alert.alert('Missing info', 'Please enter your Business Name.');
        setSaving(false);
        return;
      }
      if (!hourlyRate) {
        Alert.alert('Missing info', 'Please enter your Hourly Rate.');
        setSaving(false);
        return;
      }

      const { error } = await supabase.from('profiles').upsert(payload);
      if (error) throw error;

      Alert.alert('Saved', 'Your business profile is set up.');
      router.replace('/(app)/quotes/list');
    } catch (e) {
      console.error('[TMQ][ONBOARD] save error', e);
      Alert.alert('Error', e.message ?? 'Could not save profile.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: '#0b0b0c' }}
      behavior={Platform.select({ ios: 'padding', android: undefined })}
      keyboardVerticalOffset={Platform.select({ ios: 0, android: 0 })}
    >
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        <Text style={styles.title}>Business Profile</Text>
        <Text style={styles.subtitle}>Set this once. Used on every quote.</Text>

        {/* Logo picker */}
        <View style={styles.logoRow}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            {logoUri ? <Image source={{ uri: logoUri }} style={styles.logo} /> : <View style={[styles.logo, styles.logoPlaceholder]} />}
            <View>
              <Text style={styles.label}>Logo (PNG or JPG)</Text>
              <Text style={styles.hint}>Shown on your PDFs. Free tier keeps TradeMate footer.</Text>
            </View>
          </View>
          <TouchableOpacity style={[styles.smallBtn, { opacity: logoUploading ? 0.6 : 1 }]} onPress={pickLogo} disabled={logoUploading}>
            <Text style={styles.smallBtnText}>{logoUploading ? 'Uploading…' : (logoUri ? 'Replace' : 'Upload')}</Text>
          </TouchableOpacity>
        </View>

        {/* Contact / basics */}
        <TextInput style={styles.input} editable={false} value={email} placeholder="Email" placeholderTextColor="#999" />
        <TextInput style={styles.input} placeholder="Business Name" placeholderTextColor="#999" value={businessName} onChangeText={setBusinessName} />
        <TextInput style={styles.input} placeholder="Phone" placeholderTextColor="#999" value={phone} onChangeText={setPhone} />

        {/* Address */}
        <TextInput style={styles.input} placeholder="Address line 1" placeholderTextColor="#999" value={address1} onChangeText={setAddress1} />
        <View style={styles.row2}>
          <TextInput style={[styles.input, styles.flex1]} placeholder="City" placeholderTextColor="#999" value={city} onChangeText={setCity} />
          <TextInput style={[styles.input, styles.flex1, { marginLeft: 8 }]} placeholder="Postcode" placeholderTextColor="#999" value={postcode} onChangeText={setPostcode} />
        </View>

        {/* Trade */}
        <TextInput style={styles.input} placeholder="Trade (e.g. plumber, electrician)" placeholderTextColor="#999" value={tradeType} onChangeText={setTradeType} />

        {/* VAT & company */}
        <View style={styles.switchRow}>
          <Text style={styles.label}>VAT Registered</Text>
          <Switch value={vatRegistered} onValueChange={setVatRegistered} />
        </View>
        <TextInput style={styles.input} placeholder="Company Reg No. (optional)" placeholderTextColor="#999" value={companyReg} onChangeText={setCompanyReg} />
        <TextInput style={styles.input} placeholder="VAT No. (optional)" placeholderTextColor="#999" value={vatNumber} onChangeText={setVatNumber} />

        {/* Pricing */}
        <View style={styles.row2}>
          <TextInput
            style={[styles.input, styles.flex1]}
            placeholder="Hourly Rate (£)"
            keyboardType="decimal-pad"
            placeholderTextColor="#999"
            value={hourlyRate}
            onChangeText={setHourlyRate}
          />
          <TextInput
            style={[styles.input, styles.flex1, { marginLeft: 8 }]}
            placeholder="Materials Markup (%)"
            keyboardType="decimal-pad"
            placeholderTextColor="#999"
            value={markup}
            onChangeText={setMarkup}
          />
        </View>

        <View style={styles.row2}>
          <TextInput
            style={[styles.input, styles.flex1]}
            placeholder="Travel Fee (£/mile)"
            keyboardType="decimal-pad"
            placeholderTextColor="#999"
            value={travelRate}
            onChangeText={setTravelRate}
          />
          <TextInput
            style={[styles.input, styles.flex1, { marginLeft: 8 }]}
            placeholder="Hours worked per day (e.g. 10)"
            keyboardType="decimal-pad"
            placeholderTextColor="#999"
            value={hoursPerDay}
            onChangeText={setHoursPerDay}
          />
        </View>

        {/* 🔹 Day Rate (auto-calculated) */}
        <View style={styles.calcRow}>
          <Text style={styles.calcLabel}>Day Rate (auto)</Text>
          <Text style={styles.calcValue}>
            £{dayRate.toFixed(2)}
          </Text>
        </View>
        <Text style={styles.hint}>
          Day rate = Hourly × Hours/Day. Used by the AI when a job spans multiple days.
        </Text>

        {/* Terms */}
        <TextInput style={styles.input} placeholder="Payment Terms" placeholderTextColor="#999" value={terms} onChangeText={setTerms} />
        <TextInput style={styles.input} placeholder="Warranty" placeholderTextColor="#999" value={warranty} onChangeText={setWarranty} />

        <TouchableOpacity style={[styles.button, { opacity: saving ? 0.7 : 1 }]} onPress={saveProfile} disabled={saving}>
          <Text style={styles.buttonText}>{saving ? 'Saving…' : 'Save & Continue'}</Text>
        </TouchableOpacity>
        <View style={{ height: 40 }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, backgroundColor: '#0b0b0c', flexGrow: 1 },
  title: { color: 'white', fontSize: 24, fontWeight: '700', marginBottom: 4 },
  subtitle: { color: '#c7c7c7', marginBottom: 16 },
  input: { backgroundColor: '#1a1a1b', color: 'white', borderRadius: 12, padding: 14, marginBottom: 12 },
  row2: { flexDirection: 'row', marginBottom: 12 },
  flex1: { flex: 1 },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  label: { color: 'white', fontSize: 16, fontWeight: '600' },
  hint: { color: '#9a9a9a', fontSize: 12, marginTop: 2, maxWidth: 260 },

  // Calc row (Day Rate)
  calcRow: {
    backgroundColor: '#151517',
    borderWidth: 1, borderColor: '#2b2c2f',
    paddingVertical: 12, paddingHorizontal: 14,
    borderRadius: 12, marginBottom: 10,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'
  },
  calcLabel: { color: '#cfcfd2', fontWeight: '600' },
  calcValue: { color: 'white', fontWeight: '800', fontSize: 16 },

  button: { backgroundColor: '#2a86ff', borderRadius: 12, padding: 14, alignItems: 'center', marginTop: 8 },
  buttonText: { color: 'white', fontWeight: '700' },

  logo: { width: 48, height: 48, borderRadius: 8, backgroundColor: '#222' },
  logoPlaceholder: { borderWidth: 1, borderColor: '#333' },
  logoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  smallBtn: { backgroundColor: '#2a86ff', paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10 },
  smallBtnText: { color: 'white', fontWeight: '700' },
});