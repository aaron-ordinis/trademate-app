/* app/(app)/settings/index.js */
import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  Image,
  Modal,
  Pressable,
  Platform,
  Linking,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import { useRouter, useFocusEffect } from 'expo-router';
import { supabase } from '../../../lib/supabase';

// Icons
import {
  ChevronRight,
  Crown,
  Building2,
  CreditCard,
  HelpCircle,
  Info,
  LogOut,
  Image as ImageIcon,
  FileText,
  Pencil,
  Trash2,
  ExternalLink,
} from 'lucide-react-native';

const BRAND = '#2a86ff';
const TEXT = '#0b1220';
const MUTED = '#6b7280';
const CARD = '#ffffff';
const BG = '#f5f7fb';
const BORDER = '#e6e9ee';

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

/** Try to produce a usable URL for a storage object (public bucket OR signed). */
async function resolveStorageUrl(pathInBucket) {
  const { data: pub, error: pubErr } = supabase.storage.from('logos').getPublicUrl(pathInBucket);
  if (!pubErr && pub?.publicUrl) return pub.publicUrl;

  // Signed URL fallback (long-lived)
  const expiresIn = 60 * 60 * 24 * 365 * 5; // 5 years
  const { data: signed, error: sErr } = await supabase.storage
    .from('logos')
    .createSignedUrl(pathInBucket, expiresIn);
  if (!sErr && signed?.signedUrl) return signed.signedUrl;

  throw new Error(pubErr?.message || sErr?.message || 'Could not get file URL');
}

export default function SettingsHome() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState(null);
  const [userEmail, setUserEmail] = useState('');
  const [userId, setUserId] = useState('');
  const [working, setWorking] = useState(false);

  const [logoModalOpen, setLogoModalOpen] = useState(false);
  const [errBanner, setErrBanner] = useState('');

  const showError = (msg) => {
    setErrBanner(msg || 'Something went wrong');
    setTimeout(() => setErrBanner(''), 5000);
    console.warn('[Settings] ERROR:', msg);
  };

  const normalizeLogo = (val) => {
    if (val == null) return null;
    const v = String(val).trim();
    if (!v || v.toUpperCase() === 'EMPTY' || v.toUpperCase() === 'NULL') return null;
    return v;
  };

  // — Load profile with tiny retry
  const loadProfile = useCallback(async () => {
    const attempt = async () => {
      const { data: { user }, error: uErr } = await supabase.auth.getUser();
      if (uErr) throw uErr;
      if (!user) { router.replace('/(auth)/login'); return null; }
      setUserEmail(user.email || '');
      setUserId(user.id);

      const { data, error } = await supabase
        .from('profiles')
        .select('id, branding, business_name, trade_type, custom_logo_url')
        .eq('id', user.id)
        .maybeSingle();
      if (error) throw error;

      const cleaned = { ...(data || {}) };
      cleaned.custom_logo_url = normalizeLogo(cleaned.custom_logo_url);
      return cleaned;
    };

    try {
      setLoading(true);
      let p = await attempt();
      if (!p) return;
      setProfile(p);
    } catch (e1) {
      try {
        let p = await attempt();
        if (!p) return;
        setProfile(p);
      } catch (e2) {
        showError(e2?.message || String(e2));
      }
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => { loadProfile(); }, [loadProfile]);
  useFocusEffect(useCallback(() => { loadProfile(); }, [loadProfile]));

  const isPremium = useMemo(() => {
    const tier = String(profile?.branding ?? 'free').toLowerCase();
    return tier === 'premium';
  }, [profile?.branding]);

  const initials = useMemo(() => {
    const src = String(profile?.business_name || userEmail || '')
      .replace(/[^a-zA-Z ]/g, ' ')
      .trim();
    if (!src) return 'U';
    const parts = src.split(/\s+/).slice(0, 2);
    return parts.map(p => p.charAt(0).toUpperCase()).join('') || 'U';
  }, [profile?.business_name, userEmail]);

  const hasLogo = !!normalizeLogo(profile?.custom_logo_url);
  const isPdfLogo = hasLogo && /\.pdf($|\?)/i.test(profile?.custom_logo_url || '');
  const planLabel = isPremium ? 'Premium' : 'Free';

  const onLogout = async () => {
    try { await supabase.auth.signOut(); }
    catch (e) { showError(e?.message || String(e)); }
    finally { router.replace('/(auth)/login'); }
  };

  /**
   * FIXED UPLOADER:
   * - Always save under logos/users/<uid>/logo.<ext>
   * - Works with your RLS that checks the users/<uid>/ prefix
   */
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
      const name = file.name || (Platform.OS === 'ios' ? uri.split('/').pop() : 'upload');
      const ext = (name?.split('.').pop() || '').toLowerCase();

      // Choose content-type
      let contentType = 'application/octet-stream';
      if (ext === 'pdf') contentType = 'application/pdf';
      else if (ext === 'jpg' || ext === 'jpeg') contentType = 'image/jpeg';
      else if (ext === 'png') contentType = 'image/png';
      else if (ext === 'webp') contentType = 'image/webp';
      else if (file.mimeType) contentType = file.mimeType; // fallback

      // Read file as base64 (safe for content:// and ph://)
      const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
      if (!base64) throw new Error('Could not read file data');

      // Convert to bytes and upload
      const bytes = base64ToBytes(base64);

      // IMPORTANT: path that matches RLS: users/<uid>/logo.<ext>
      const suffix = ext ? ext : 'bin';
      const pathInBucket = 'users/' + userId + '/logo.' + suffix;

      const { error: upErr } = await supabase
        .storage
        .from('logos')
        .upload(pathInBucket, bytes, {
          contentType,
          upsert: true, // replace existing
        });
      if (upErr) throw upErr;

      // URL (public or signed)
      const publicishUrl = await resolveStorageUrl(pathInBucket);

      const { error: updErr } = await supabase
        .from('profiles')
        .update({ custom_logo_url: publicishUrl })
        .eq('id', userId);
      if (updErr) throw updErr;

      setProfile((p) => ({ ...(p || {}), custom_logo_url: publicishUrl }));
    } catch (e) {
      showError(e?.message || String(e));
    } finally {
      setWorking(false);
      setLogoModalOpen(false);
    }
  };

  const removeLogo = async () => {
    try {
      if (!hasLogo) { setLogoModalOpen(false); return; }
      setWorking(true);

      const url = String(profile?.custom_logo_url || '');
      let storagePath = null;

      // Robustly detect the path after the /logos/ segment (covers public & signed URLs)
      const anchors = [
        '/storage/v1/object/public/logos/',
        '/object/public/logos/',
        '/logos/',
      ];
      for (const anchor of anchors) {
        const idx = url.indexOf(anchor);
        if (idx !== -1) {
          storagePath = url.substring(idx + anchor.length);
          break;
        }
      }

      // If parsing failed, fall back to canonical path where we save logos
      if (!storagePath) storagePath = 'users/' + userId + '/logo.png';

      await supabase.storage.from('logos').remove([storagePath]).catch(() => {});

      const { error: updErr } = await supabase
        .from('profiles')
        .update({ custom_logo_url: null })
        .eq('id', userId);
      if (updErr) throw updErr;

      setProfile((p) => ({ ...(p || {}), custom_logo_url: null }));
    } catch (e) {
      showError(e?.message || String(e));
    } finally {
      setWorking(false);
      setLogoModalOpen(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView edges={['top', 'left', 'right', 'bottom']} style={styles.loading}>
        <ActivityIndicator color={BRAND} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={['top', 'left', 'right', 'bottom']} style={styles.wrap}>
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: 12,
          paddingBottom: Math.max(insets.bottom, 28),
        }}
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.h1}>Settings</Text>
          <Text style={styles.hint}>Manage your account and preferences</Text>
        </View>

        {/* Profile / hero card */}
        <View style={styles.centerRow}>
          <View style={styles.profileCard}>
            <TouchableOpacity
              activeOpacity={0.9}
              onPress={() => setLogoModalOpen(true)}
              style={styles.avatarWrap}
            >
              {hasLogo && !isPdfLogo ? (
                <Image source={{ uri: profile.custom_logo_url }} style={styles.avatarImg} resizeMode="cover" />
              ) : hasLogo && isPdfLogo ? (
                <View style={[styles.avatar, { backgroundColor: '#fef3c7', borderColor: '#fde68a' }]}>
                  <FileText size={22} color="#92400e" />
                </View>
              ) : (
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>{initials}</Text>
                </View>
              )}
              <View style={styles.editBadge}>
                <Pencil size={14} color="#fff" />
              </View>
            </TouchableOpacity>

            <Text style={styles.bizName} numberOfLines={1}>
              {profile?.business_name || 'Your Business'}
            </Text>
            <Text style={styles.email} numberOfLines={1}>{userEmail}</Text>

            <View style={styles.badgesRow}>
              <View style={[styles.badge, isPremium ? styles.badgePremium : styles.badgeFree]}>
                <Text style={styles.badgeText}>{planLabel}</Text>
              </View>
              {!!profile?.trade_type && (
                <View style={[styles.badge, styles.badgeMuted]}>
                  <Text style={styles.badgeText}>{String(profile.trade_type).trim()}</Text>
                </View>
              )}
            </View>

            {hasLogo && (
              <TouchableOpacity
                onPress={() => Linking.openURL(profile.custom_logo_url)}
                style={{ flexDirection: 'row', alignItems: 'center', marginTop: 10 }}
              >
                <ExternalLink size={16} color={MUTED} />
                <Text style={{ color: MUTED, marginLeft: 6 }}>Open current logo</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Upsell banner (only for Free) */}
        {!isPremium && (
          <View style={styles.upgradeCard}>
            <View style={styles.upgradeLeft}>
              <View style={styles.crownWrap}>
                <Crown size={18} color={BRAND} />
              </View>
              <View style={{ flexShrink: 1 }}>
                <Text style={styles.upTitle}>Upgrade to Premium</Text>
                <Text style={styles.upSub} numberOfLines={2}>
                  Unlock duplication, advanced editing, and pro features.
                </Text>
              </View>
            </View>
            <TouchableOpacity onPress={() => router.push('/(app)/account')} style={styles.upBtn} activeOpacity={0.92}>
              <Text style={styles.upBtnText}>Upgrade</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Sections */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Account</Text>
          <Row
            icon={<CreditCard size={18} color={MUTED} />}
            title="Plan & Billing"
            subtitle="Manage / Upgrade"
            onPress={() => router.push('/(app)/account')}
          />
          <Row
            icon={<Building2 size={18} color={MUTED} />}
            title="Business Profile"
            subtitle="Edit details & branding"
            onPress={() => router.push('/(app)/profile')}
          />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Support</Text>
          <Row
            icon={<HelpCircle size={18} color={MUTED} />}
            title="Help & Support"
            subtitle="FAQs, contact"
            onPress={() => router.push('/(app)/support')}
          />
          <Row
            icon={<Info size={18} color={MUTED} />}
            title="About"
            subtitle="Version & info"
            onPress={() => router.push('/(app)/about')}
          />
        </View>

        <TouchableOpacity style={[styles.logoutBtn]} activeOpacity={0.9} onPress={onLogout}>
          <LogOut size={18} color="#fff" style={{ marginRight: 8 }} />
          <Text style={styles.logoutText}>Log out</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* Error banner */}
      {!!errBanner && (
        <View style={styles.errBanner}>
          <Text style={styles.errText}>{errBanner}</Text>
        </View>
      )}

      {/* Upload / Replace / Remove logo */}
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
              <>
                <ImageIcon size={18} color="#fff" style={{ marginRight: 8 }} />
                <Text style={styles.primaryBtnText}>{hasLogo ? 'Choose new logo' : 'Choose logo'}</Text>
              </>
            )}
          </TouchableOpacity>

          {hasLogo && (
            <TouchableOpacity style={styles.dangerBtn} onPress={removeLogo} disabled={working} activeOpacity={0.9}>
              <Trash2 size={18} color="#fff" style={{ marginRight: 8 }} />
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

/* ----- Row component (kept outside SettingsHome) ----- */
function Row({ icon, title, subtitle, onPress }) {
  return (
    <TouchableOpacity style={rowStyles.row} activeOpacity={0.9} onPress={onPress}>
      <View style={rowStyles.left}>
        <View style={rowStyles.iconWrap}>{icon}</View>
        <View style={{ flexShrink: 1 }}>
          <Text style={rowStyles.title} numberOfLines={1}>{title}</Text>
          {!!subtitle && <Text style={rowStyles.sub} numberOfLines={1}>{subtitle}</Text>}
        </View>
      </View>
      <ChevronRight size={18} color={MUTED} />
    </TouchableOpacity>
  );
}

/* ------------------ main styles ------------------ */
const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: BG },
  loading: { flex: 1, backgroundColor: BG, alignItems: 'center', justifyContent: 'center' },

  header: { alignItems: 'center', marginBottom: 12 },
  h1: { color: TEXT, fontSize: 24, fontWeight: '800' },
  hint: { color: MUTED, marginTop: 4 },

  centerRow: { alignItems: 'center', marginTop: 6 },

  profileCard: {
    width: '100%', maxWidth: 520, backgroundColor: CARD, borderRadius: 16,
    paddingVertical: 18, paddingHorizontal: 16, borderWidth: 1, borderColor: BORDER,
    alignItems: 'center',
    shadowColor: '#0b1220', shadowOpacity: 0.05, shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 }, elevation: 2,
  },

  avatarWrap: { position: 'relative' },
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

  bizName: { color: TEXT, fontWeight: '900', fontSize: 18 },
  email: { color: MUTED, marginTop: 4 },

  badgesRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  badge: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999 },
  badgeText: { color: '#fff', fontWeight: '800', fontSize: 12 },
  badgePremium: { backgroundColor: '#10b981' },
  badgeFree: { backgroundColor: '#9ca3af' },
  badgeMuted: { backgroundColor: '#6b7280' },

  upgradeCard: {
    width: '100%', maxWidth: 520, alignSelf: 'center', marginTop: 14, backgroundColor: CARD,
    borderRadius: 16, borderWidth: 1, borderColor: BORDER, padding: 14, flexDirection: 'row',
    alignItems: 'center', justifyContent: 'space-between',
    shadowColor: '#0b1220', shadowOpacity: 0.05, shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 }, elevation: 2,
  },
  upgradeLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flexShrink: 1 },
  crownWrap: {
    height: 34, width: 34, borderRadius: 17, backgroundColor: BRAND + '15',
    borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center',
  },
  upTitle: { color: TEXT, fontWeight: '900' },
  upSub: { color: MUTED, marginTop: 2 },

  upBtn: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, backgroundColor: BRAND },
  upBtnText: { color: '#fff', fontWeight: '800' },

  section: {
    width: '100%', maxWidth: 520, alignSelf: 'center', backgroundColor: CARD,
    borderRadius: 16, borderWidth: 1, borderColor: BORDER, paddingVertical: 8, marginTop: 16,
    shadowColor: '#0b1220', shadowOpacity: 0.05, shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 }, elevation: 2,
  },
  sectionTitle: { color: MUTED, fontWeight: '900', fontSize: 12, paddingHorizontal: 14, paddingTop: 6, paddingBottom: 4 },

  logoutBtn: {
    width: '100%', maxWidth: 520, alignSelf: 'center', marginTop: 16,
    backgroundColor: '#dc2626', borderRadius: 14, padding: 14,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    shadowColor: '#dc2626', shadowOpacity: 0.25, shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 }, elevation: 3,
  },
  logoutText: { color: '#fff', fontWeight: '900' },

  // Error banner
  errBanner: {
    position: 'absolute', left: 16, right: 16, bottom: 18,
    backgroundColor: '#111827', paddingVertical: 10, paddingHorizontal: 14,
    borderRadius: 12, alignItems: 'center',
    shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 }, elevation: 4,
  },
  errText: { color: '#fff', fontWeight: '700' },

  // Modal / bottom sheet
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

/* ----- Row styles (outside component) ----- */
const rowStyles = StyleSheet.create({
  row: {
    paddingHorizontal: 12, paddingVertical: 12, marginHorizontal: 8, marginVertical: 4,
    borderRadius: 12, borderWidth: 1, borderColor: BORDER, backgroundColor: '#f9fafb',
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  left: { flexDirection: 'row', alignItems: 'center', gap: 12, flexShrink: 1 },
  iconWrap: {
    height: 34, width: 34, borderRadius: 10, backgroundColor: '#f3f4f6',
    borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center',
  },
  title: { color: TEXT, fontWeight: '900' },
  sub: { color: MUTED, marginTop: 2, fontSize: 12 },
});