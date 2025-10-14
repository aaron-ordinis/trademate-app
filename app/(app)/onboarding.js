import { loginHref, quotesListHref } from "../../lib/nav";
// app/(app)/onboarding.js
import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, TextInput, Switch, TouchableOpacity,
  StyleSheet, Alert, ScrollView, Image, Platform,
  ActivityIndicator, Modal, Pressable, Linking, Dimensions, StatusBar
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Theme
const BRAND  = '#2a86ff';
const TEXT   = '#0b1220';
const MUTED  = '#6b7280';
const CARD   = '#ffffff';
const BG     = '#f5f7fb';
const BG_HEX = '#f5f7fb';
const BORDER = '#e6e9ee';
const OK     = '#16a34a';
const DISABLED = '#9ca3af';

const BUCKET = 'logos';
const TOTAL_STEPS = 4;
const STEP_TITLES = ["Logo & Basics", "Address & Trade", "Company Details", "Rates & Terms"];
const ONBOARDING_COMPLETE_KEY = 'onboarding_profile_complete';

/* ---------- helpers ---------- */
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

async function resolveStorageUrl(pathInBucket) {
  const { data: pub, error: pubErr } = supabase.storage.from(BUCKET).getPublicUrl(pathInBucket);
  if (!pubErr && pub?.publicUrl) return pub.publicUrl;

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

  // Check if onboarding is needed based on profile
  const [visible, setVisible] = useState(false);
  const [profileChecked, setProfileChecked] = useState(false);

  // Steps
  const [step, setStep] = useState(1);
  const [email, setEmail] = useState('');

  // Basics
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
  const [travelRate, setTravelRate] = useState('');
  const [hoursPerDay, setHoursPerDay] = useState('');

  const [terms, setTerms] = useState('');
  const [warranty, setWarranty] = useState('');

  // Logo
  const [logoUrl, setLogoUrl] = useState(null);
  const [logoWorking, setLogoWorking] = useState(false);
  const [logoModalOpen, setLogoModalOpen] = useState(false);

  const [saving, setSaving] = useState(false);

  // validation state
  const [fieldErrors, setFieldErrors] = useState({});

  // number helper
  const toNumber = useMemo(() => {
    return (v, fallback = 0) => {
      if (v === '' || v === null || v === undefined) return fallback;
      const n = Number(String(v).replace(/[^0-9.]/g, ''));
      return Number.isFinite(n) ? n : fallback;
    };
  }, []);

  const dayRate = useMemo(() => {
    const hr = toNumber(hourlyRate, 0);
    const hpd = toNumber(hoursPerDay, 10);
    return +(hr * hpd).toFixed(2);
  }, [hourlyRate, hoursPerDay, toNumber]);

  const initials = useMemo(() => {
    const src = String(businessName || '').replace(/[^a-zA-Z ]/g, ' ').trim();
    if (!src) return 'U';
    const parts = src.split(/\s+/).slice(0, 2);
    return parts.map(p => p.charAt(0).toUpperCase()).join('') || 'U';
  }, [businessName]);

  // Simplified profile check effect
  useEffect(() => {
    const checkProfileComplete = async () => {
      try {
        console.log('[ONBOARDING] Starting profile check...');
        
        const { data } = await supabase.auth.getUser();
        const user = data?.user;
        if (!user) { 
          console.log('[ONBOARDING] No user found, redirecting to login');
          router.replace(loginHref);
          return; 
        }

        console.log('[ONBOARDING] User found:', user.email);
        setEmail(user.email ?? '');

        console.log('[ONBOARDING] Checking profile completeness...');
        const { data: profile, error } = await supabase
          .from('profiles')
          .select('business_name, hourly_rate, materials_markup_pct, phone, address_line1')
          .eq('id', user.id)
          .maybeSingle();

        if (error) {
          console.error('[ONBOARDING] Profile check error:', error);
          setVisible(true);
          setProfileChecked(true);
          return;
        }

        console.log('[ONBOARDING] Profile data:', profile);

        const needsOnboarding = !profile || 
          !profile.business_name || 
          profile.business_name.trim() === '' ||
          profile.hourly_rate == null ||
          profile.hourly_rate === '' ||
          profile.hourly_rate <= 0 ||
          !profile.phone ||
          profile.phone.trim() === '' ||
          !profile.address_line1 ||
          profile.address_line1.trim() === '';

        console.log('[ONBOARDING] Needs onboarding:', needsOnboarding);

        if (needsOnboarding) {
          console.log('[ONBOARDING] Profile incomplete, showing onboarding');
          setVisible(true);
        } else {
          console.log('[ONBOARDING] Profile complete, navigating to quotes');
          setVisible(false);
          router.replace('/(app)/quotes/list');
        }
      } catch (error) {
        console.error('[ONBOARDING] Profile check error:', error);
        // Show onboarding on error to avoid infinite loading
        setVisible(true);
      } finally {
        console.log('[ONBOARDING] Profile check complete');
        setProfileChecked(true);
      }
    };

    // Run immediately without delay
    checkProfileComplete();
  }, [router]);

  // loading state while checking profile - simplified with 3 second timeout
  if (!profileChecked) {
    // Fallback timeout to prevent infinite loading
    setTimeout(() => {
      if (!profileChecked) {
        console.log('[ONBOARDING] Timeout fallback - showing onboarding');
        setVisible(true);
        setProfileChecked(true);
      }
    }, 3000); // 3 second timeout

    return (
      <View style={{ flex: 1, backgroundColor: BG, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={BRAND} size="large" />
        <Text style={{ color: MUTED, marginTop: 16 }}>Checking your profile...</Text>
        <Text style={{ color: MUTED, marginTop: 8, fontSize: 12 }}>If this takes too long, check your connection</Text>
      </View>
    );
  }

  // Don't render modal if not needed
  if (!visible) {
    // If profile is complete but modal not visible, we should be navigating
    console.log('[ONBOARDING] Profile complete, modal not visible - this should redirect');
    return null;
  }

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
      const name = file.name || (Platform.OS === 'ios' ? uri.split('/').pop() : 'upload');
      const ext = (name?.split('.').pop() || '').toLowerCase();

      let contentType = 'application/octet-stream';
      if (ext === 'pdf') contentType = 'application/pdf';
      else if (ext === 'jpg' || ext === 'jpeg') contentType = 'image/jpeg';
      else if (ext === 'png') contentType = 'image/png';
      else if (ext === 'webp') contentType = 'image/webp';
      else if (file.mimeType) contentType = file.mimeType;

      const { data: userData } = await supabase.auth.getUser();
      const logoUserData = userData?.user;
      if (!logoUserData) throw new Error('Not signed in');

      const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
      if (!base64) throw new Error('Could not read file data');

      const bytes = base64ToBytes(base64);

      // Path matches RLS: logos/users/<uid>/logo-<timestamp>.<ext>
      const pathInBucket = 'users/' + logoUserData.id + '/logo-' + Date.now() + '.' + (ext || 'bin');

      const { error: upErr } = await supabase
        .storage
        .from(BUCKET)
        .upload(pathInBucket, bytes, { contentType, upsert: false });
      if (upErr) throw upErr;

      const publicishUrl = await resolveStorageUrl(pathInBucket);

      const { error: updErr } = await supabase
        .from('profiles')
        .update({ custom_logo_url: publicishUrl })
        .eq('id', logoUserData.id);
      if (updErr) throw updErr;

      setLogoUrl(publicishUrl + (publicishUrl.includes('?') ? '&' : '?') + 't=' + Date.now());
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

      // Do NOT delete from storage here; DB trigger + worker will clean the old file
      const { error: updErr } = await supabase
        .from('profiles')
        .update({ custom_logo_url: null })
        .eq('id', user.id);
      if (updErr) throw updErr;

      setLogoUrl(null);
    } catch (e) {
      Alert.alert('Error', e?.message || 'Could not remove logo.');
    } finally {
      setLogoWorking(false);
      setLogoModalOpen(false);
    }
  };

  // --- step validations
  const validateStep1 = () => {
    const errors = {};
    if (!businessName.trim()) errors.businessName = 'Business name is required';
    if (!phone.trim()) errors.phone = 'Phone number is required';
    return errors;
  };
  const validateStep2 = () => {
    const errors = {};
    if (!address1.trim()) errors.address1 = 'Address is required';
    if (!city.trim()) errors.city = 'City is required';
    if (!postcode.trim()) errors.postcode = 'Postcode is required';
    return errors;
  };
  const validateStep3 = () => ({});
  const validateStep4 = () => {
    const errors = {};
    if (!hourlyRate || toNumber(hourlyRate) <= 0) errors.hourlyRate = 'Hourly rate is required';
    if (!markup || toNumber(markup) < 0) errors.markup = 'Materials markup is required';
    if (!travelRate || toNumber(travelRate) < 0) errors.travelRate = 'Travel rate is required';
    if (!hoursPerDay || toNumber(hoursPerDay, 8) <= 0) errors.hoursPerDay = 'Hours per day is required';
    return errors;
  };

  const getCurrentStepErrors = () => {
    switch (step) {
      case 1: return validateStep1();
      case 2: return validateStep2();
      case 3: return validateStep3();
      case 4: return validateStep4();
      default: return {};
    }
  };

  const showPolishedAlert = (title, message) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    Alert.alert(title, message, [{ text: 'OK', style: 'default' }], {
      userInterfaceStyle: 'light',
      cancelable: true
    });
  };

  // NOTE: define the handlers actually used in JSX
  const goNext = () => {
    const errors = getCurrentStepErrors();
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      const firstError = Object.values(errors)[0];
      showPolishedAlert('Complete Required Fields', 'Please fill in all required fields before continuing. ' + firstError);
      return;
    }
    setFieldErrors({});
    setStep((s) => {
      const n = Math.min(s + 1, TOTAL_STEPS);
      if (n !== s) Haptics.selectionAsync();
      return n;
    });
  };

  const goBack = () => {
    setFieldErrors({});
    setStep((s) => {
      const n = Math.max(s - 1, 1);
      if (n !== s) Haptics.selectionAsync();
      return n;
    });
  };

  // save profile
  const saveProfile = async () => {
    const allErrors = { ...validateStep1(), ...validateStep2(), ...validateStep4() };
    if (Object.keys(allErrors).length > 0) {
      setFieldErrors(allErrors);
      const firstError = Object.values(allErrors)[0];
      showPolishedAlert('Profile Incomplete', 'Please complete all required fields: ' + firstError);
      return;
    }

    try {
      setSaving(true);
      const { data: userData } = await supabase.auth.getUser();
      const user = userData?.user;
      if (!user) throw new Error('Not signed in.');

      const payload = {
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
        custom_logo_url: logoUrl || null
      };

      const { error } = await supabase
        .from('profiles')
        .update(payload)
        .eq('id', user.id);
      if (error) throw error;

      console.log('[ONBOARDING] Profile saved successfully, navigating to quotes list');
      
      // Simple alert and immediate navigation
      Alert.alert(
        'Profile Complete!', 
        'Welcome to TradeMate!',
        [
          {
            text: 'Continue',
            onPress: () => {
              router.replace('/(app)/quotes/list');
            }
          }
        ]
      );
      
    } catch (e) {
      showPolishedAlert('Save Failed', e?.message ?? 'Could not save profile. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  // UI sizing
  const { width, height } = Dimensions.get("window");
  const maxCardW = Math.min(width - 24, 640);
  const chromePad = 12 * 2 + 48 + 68 + 24;
  const scrollMax = Math.max(240, Math.min(height - chromePad, 560));

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      presentationStyle="overFullScreen"
      statusBarTranslucent={Platform.OS === 'android'}
    >
      {/* Fullscreen blur */}
      <BlurView 
        intensity={10} 
        tint="systemThinMaterialLight" 
        style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} 
      />

      <StatusBar backgroundColor="rgba(245,247,251,0.9)" barStyle="dark-content" translucent />

      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: 12 }}>
        <View style={[modalCard, { width: maxCardW, maxWidth: maxCardW, backgroundColor: CARD, overflow: "hidden" }]}>
          {/* Header */}
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", paddingHorizontal: 12, paddingTop: 10, marginBottom: 6 }}>
            <Text style={{ color: TEXT, fontSize: 18, fontWeight: "900" }}>Business Profile</Text>
          </View>

          {/* Step header */}
          <View style={{ paddingHorizontal: 12 }}>
            <StepHeader step={step} total={TOTAL_STEPS} title={STEP_TITLES[step - 1]} />
          </View>

          {/* CONTENT */}
          <View style={{ maxHeight: scrollMax, paddingHorizontal: 12 }}>
            <ScrollView contentContainerStyle={{ paddingBottom: 12, paddingTop: 2 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" showsVerticalScrollIndicator={false}>
              <View style={{ alignItems: 'center', marginBottom: 8 }}>
                <Text style={styles.hintHeader}>Set this once. Used on every quote.</Text>
              </View>

              {/* STEP 1 — Logo & Basics */}
              {step === 1 && (
                <View style={{ gap: 6 }}>
                  <Card>
                    <Text style={styles.cardTitle}>Company Logo</Text>
                    <Text style={styles.optionalText}>Optional</Text>
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
                  </Card>

                  <Card>
                    <Text style={styles.cardTitle}>Contact & Basics</Text>
                    <Input editable={false} value={email} placeholder="Email" />
                    <Label required>Business Name</Label>
                    <Input 
                      placeholder="Business name" 
                      value={businessName} 
                      onChangeText={(text) => {
                        setBusinessName(text);
                        if (fieldErrors.businessName) {
                          setFieldErrors(prev => ({ ...prev, businessName: null }));
                        }
                      }}
                      style={fieldErrors.businessName ? styles.inputError : {}}
                    />
                    {fieldErrors.businessName && <ErrorText>{fieldErrors.businessName}</ErrorText>}
                    
                    <Label required>Phone</Label>
                    <Input 
                      placeholder="Phone number" 
                      value={phone} 
                      onChangeText={(text) => {
                        setPhone(text);
                        if (fieldErrors.phone) {
                          setFieldErrors(prev => ({ ...prev, phone: null }));
                        }
                      }}
                      style={fieldErrors.phone ? styles.inputError : {}}
                    />
                    {fieldErrors.phone && <ErrorText>{fieldErrors.phone}</ErrorText>}
                  </Card>
                </View>
              )}

              {/* STEP 2 — Address & Trade */}
              {step === 2 && (
                <View style={{ gap: 6 }}>
                  <Card>
                    <Text style={styles.cardTitle}>Business Address</Text>
                    <Label required>Address line 1</Label>
                    <Input 
                      placeholder="Address line 1" 
                      value={address1} 
                      onChangeText={(text) => {
                        setAddress1(text);
                        if (fieldErrors.address1) {
                          setFieldErrors(prev => ({ ...prev, address1: null }));
                        }
                      }}
                      style={fieldErrors.address1 ? styles.inputError : {}}
                    />
                    {fieldErrors.address1 && <ErrorText>{fieldErrors.address1}</ErrorText>}
                    
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      <View style={{ flex: 1 }}>
                        <Label required>City</Label>
                        <Input 
                          placeholder="City" 
                          value={city} 
                          onChangeText={(text) => {
                            setCity(text);
                            if (fieldErrors.city) {
                              setFieldErrors(prev => ({ ...prev, city: null }));
                            }
                          }}
                          style={fieldErrors.city ? styles.inputError : {}}
                        />
                        {fieldErrors.city && <ErrorText>{fieldErrors.city}</ErrorText>}
                      </View>
                      <View style={{ flex: 1 }}>
                        <Label required>Postcode</Label>
                        <Input 
                          placeholder="Postcode" 
                          value={postcode} 
                          onChangeText={(text) => {
                            setPostcode(text);
                            if (fieldErrors.postcode) {
                              setFieldErrors(prev => ({ ...prev, postcode: null }));
                            }
                          }}
                          style={fieldErrors.postcode ? styles.inputError : {}}
                        />
                        {fieldErrors.postcode && <ErrorText>{fieldErrors.postcode}</ErrorText>}
                      </View>
                    </View>
                    <Label>Trade</Label>
                    <Text style={styles.optionalText}>Optional</Text>
                    <Input placeholder="e.g. Electrician, Plumber, Carpenter" value={tradeType} onChangeText={setTradeType} />
                  </Card>
                </View>
              )}

              {/* STEP 3 — Company Details */}
              {step === 3 && (
                <View style={{ gap: 6 }}>
                  <Card>
                    <Text style={styles.cardTitle}>Company Details</Text>
                    <Text style={styles.optionalText}>All optional</Text>
                    <View style={[styles.switchRow, { marginBottom: 10 }]}>
                      <View>
                        <Text style={styles.label}>VAT Registered</Text>
                        <Text style={styles.hint}>Toggle on if you're VAT registered.</Text>
                      </View>
                      <Switch value={vatRegistered} onValueChange={setVatRegistered} />
                    </View>
                    <Label>Company Reg No. (optional)</Label>
                    <Input placeholder="Company registration number" value={companyReg} onChangeText={setCompanyReg} />
                    <Label>VAT No. (optional)</Label>
                    <Input placeholder="VAT number" value={vatNumber} onChangeText={setVatNumber} />
                  </Card>
                </View>
              )}

              {/* STEP 4 — Rates & Terms */}
              {step === 4 && (
                <View style={{ gap: 6 }}>
                  <Card>
                    <Text style={styles.cardTitle}>Rates & Markup</Text>

                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      <View style={{ flex: 1 }}>
                        <Label required>Hourly Rate (£)</Label>
                        <Input
                          placeholder="e.g. 45"
                          keyboardType="decimal-pad"
                          value={hourlyRate}
                          onChangeText={(text) => {
                            setHourlyRate(text);
                            if (fieldErrors.hourlyRate) {
                              setFieldErrors(prev => ({ ...prev, hourlyRate: null }));
                            }
                          }}
                          style={fieldErrors.hourlyRate ? styles.inputError : {}}
                        />
                        {fieldErrors.hourlyRate && <ErrorText>{fieldErrors.hourlyRate}</ErrorText>}
                      </View>
                      <View style={{ flex: 1 }}>
                        <Label required>Materials Markup (%)</Label>
                        <Input
                          placeholder="e.g. 20"
                          keyboardType="decimal-pad"
                          value={markup}
                          onChangeText={(text) => {
                            setMarkup(text);
                            if (fieldErrors.markup) {
                              setFieldErrors(prev => ({ ...prev, markup: null }));
                            }
                          }}
                          style={fieldErrors.markup ? styles.inputError : {}}
                        />
                        {fieldErrors.markup && <ErrorText>{fieldErrors.markup}</ErrorText>}
                      </View>
                    </View>

                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      <View style={{ flex: 1 }}>
                        <Label required>Travel Fee (£/mile)</Label>
                        <Input
                          placeholder="e.g. 0.45"
                          keyboardType="decimal-pad"
                          value={travelRate}
                          onChangeText={(text) => {
                            setTravelRate(text);
                            if (fieldErrors.travelRate) {
                              setFieldErrors(prev => ({ ...prev, travelRate: null }));
                            }
                          }}
                          style={fieldErrors.travelRate ? styles.inputError : {}}
                        />
                        {fieldErrors.travelRate && <ErrorText>{fieldErrors.travelRate}</ErrorText>}
                      </View>
                      <View style={{ flex: 1 }}>
                        <Label required>Hours per day</Label>
                        <Input
                          placeholder="e.g. 8"
                          keyboardType="decimal-pad"
                          value={hoursPerDay}
                          onChangeText={(text) => {
                            setHoursPerDay(text);
                            if (fieldErrors.hoursPerDay) {
                              setFieldErrors(prev => ({ ...prev, hoursPerDay: null }));
                            }
                          }}
                          style={fieldErrors.hoursPerDay ? styles.inputError : {}}
                        />
                        {fieldErrors.hoursPerDay && <ErrorText>{fieldErrors.hoursPerDay}</ErrorText>}
                      </View>
                    </View>

                    {/* Day Rate (auto) */}
                    <View style={styles.calcRow}>
                      <Text style={styles.calcLabel}>Day Rate (auto)</Text>
                      <Text style={styles.calcValue}>£{dayRate.toFixed(2)}</Text>
                    </View>
                    <Text style={styles.hint}>Day rate = Hourly × Hours/Day. Used when a job spans multiple days.</Text>
                  </Card>

                  <Card>
                    <Text style={styles.cardTitle}>Terms</Text>
                    <Text style={styles.optionalText}>Optional</Text>
                    <Label>Payment Terms</Label>
                    <Input 
                      placeholder="e.g. Payment due within 7 days" 
                      value={terms} 
                      onChangeText={setTerms} 
                      multiline
                      numberOfLines={2}
                      style={{ minHeight: 60, textAlignVertical: 'top' }}
                    />
                    <Label>Warranty</Label>
                    <Input 
                      placeholder="e.g. 12 months warranty on all work" 
                      value={warranty} 
                      onChangeText={setWarranty}
                      multiline
                      numberOfLines={2}
                      style={{ minHeight: 60, textAlignVertical: 'top' }}
                    />
                  </Card>
                </View>
              )}
            </ScrollView>
          </View>

          {/* FOOTER */}
          <View style={footerWrap}>
            <View style={{ flexDirection: "row", gap: 8, paddingHorizontal: 12, paddingVertical: 10 }}>
              {step > 1 && (
                <Btn variant="secondary" onPress={goBack} disabled={saving}>Back</Btn>
              )}
              {step < TOTAL_STEPS && <Btn onPress={goNext} disabled={saving}>Next</Btn>}
              {step === TOTAL_STEPS && (
                <Btn onPress={saveProfile} disabled={saving}>{saving ? "Saving…" : "Save & Continue"}</Btn>
              )}
            </View>
          </View>
        </View>
      </View>

      {/* Logo sheet */}
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
        </View>
      </Modal>
    </Modal>
  );
}

// UI primitives
const modalShadow = Platform.select({
  ios: { shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 18, shadowOffset: { width: 0, height: 6 } },
  android: { elevation: 18 },
});

const modalCard = {
  backgroundColor: BG,
  borderRadius: 18,
  paddingTop: 12,
  borderWidth: 1,
  borderColor: BORDER,
  ...modalShadow,
};

const footerWrap = {
  borderTopWidth: 1,
  borderTopColor: BORDER,
  backgroundColor: CARD,
  borderBottomLeftRadius: 18,
  borderBottomRightRadius: 18,
};

function Card({ children }) {
  return (
    <View
      style={{
        backgroundColor: CARD,
        borderRadius: 12,
        padding: 10,
        borderWidth: 1,
        borderColor: BORDER,
        marginBottom: 8,
        ...Platform.select({
          ios: { shadowColor: "#000", shadowOpacity: 0.07, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
          android: { elevation: 4 },
        }),
      }}
    >
      {children}
    </View>
  );
}

function Label({ children, required = false }) { 
  return (
    <Text style={{ color: TEXT, fontWeight: "800", marginBottom: 6 }}>
      {children}
      {required && <Text style={{ color: '#dc2626' }}> *</Text>}
    </Text>
  ); 
}

function Input(props) {
  return (
    <TextInput
      {...props}
      style={[
        { backgroundColor: CARD, borderColor: BORDER, borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 10, color: TEXT, marginBottom: 8 },
        props.style || {},
      ]}
      placeholderTextColor={MUTED}
    />
  );
}

function Btn(props) {
  const disabled = !!props.disabled;
  const variant = props.variant || "primary";
  const bg = disabled ? DISABLED : variant === "secondary" ? BORDER : variant === "primary" ? OK : BRAND;
  const color = variant === "secondary" ? TEXT : "#ffffff";
  return (
    <TouchableOpacity
      onPress={disabled ? () => {} : () => { Haptics.selectionAsync(); props.onPress && props.onPress(); }}
      style={{ flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: "center", backgroundColor: bg }}
    >
      <Text style={{ color, fontWeight: "800" }}>{typeof props.children === "string" ? props.children : "Button"}</Text>
    </TouchableOpacity>
  );
}

function SmallBtn({ children, onPress, variant = "default" }) {
  const bg = variant === "danger" ? "#ef4444" : variant === "light" ? "#f3f4f6" : BORDER;
  const color = variant === "danger" ? "#fff" : TEXT;
  return (
    <TouchableOpacity onPress={() => { Haptics.selectionAsync(); onPress && onPress(); }} style={{ paddingVertical: 6, paddingHorizontal: 10, borderRadius: 10, backgroundColor: bg }}>
      <Text style={{ color, fontWeight: "700" }}>{typeof children === "string" ? children : "Action"}</Text>
    </TouchableOpacity>
  );
}

function StepHeader({ step, total, title }) {
  const pct = Math.max(0, Math.min(1, step / total));
  return (
    <View style={{ marginBottom: 8 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
        <Text style={{ color: TEXT, fontWeight: "800" }}>{title}</Text>
        <Text style={{ color: MUTED, fontWeight: "600", fontSize: 12 }}>Step {step} of {total}</Text>
      </View>
      <View style={{ height: 6, backgroundColor: "#dde3ea", borderRadius: 999 }}>
        <View style={{ width: pct * 100 + '%', height: 6, backgroundColor: BRAND, borderRadius: 999 }} />
      </View>
    </View>
  );
}

function ErrorText({ children }) {
  return <Text style={styles.errorText}>{children}</Text>;
}

const styles = StyleSheet.create({
  h1: { color: TEXT, fontSize: 24, fontWeight: '800' },
  hintHeader: { color: MUTED, marginTop: 4, textAlign: 'center' },
  cardTitle: { color: TEXT, fontWeight: '800', marginBottom: 6 },
  label: { color: TEXT, fontWeight: '700' },
  hint: { color: MUTED, fontSize: 12, marginTop: 4 },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },

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

  calcRow: {
    backgroundColor: '#eef2f7',
    borderWidth: 1, borderColor: BORDER,
    paddingVertical: 12, paddingHorizontal: 14,
    borderRadius: 12, marginBottom: 8,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'
  },
  calcLabel: { color: MUTED, fontWeight: '700' },
  calcValue: { color: TEXT, fontWeight: '900' },

  btnSave: {
    backgroundColor: BRAND, borderRadius: 14, padding: 14, alignItems: 'center',
    shadowColor: BRAND, shadowOpacity: 0.2, shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 }, elevation: 3,
  },
  btnSaveText: { color: '#fff', fontWeight: '900' },

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

  optionalText: { color: MUTED, fontSize: 12, fontStyle: 'italic', marginBottom: 8 },
  inputError: { borderColor: '#dc2626', borderWidth: 2, backgroundColor: '#fef2f2' },
  errorText: { color: '#dc2626', fontSize: 12, fontWeight: '600', marginTop: -4, marginBottom: 8, marginLeft: 4 },
});