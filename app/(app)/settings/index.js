// app/(app)/settings/index.js
import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../../../lib/supabase';

export default function SettingsHome() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState(null);
  const [userEmail, setUserEmail] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) { router.replace('/(auth)/login'); return; }
        setUserEmail(user.email || '');

        const { data, error } = await supabase
          .from('profiles')
          .select('id, branding, business_name, trade_type')
          .eq('id', user.id)
          .maybeSingle();
        if (error) throw error;
        setProfile(data || {});
      } catch (e) {
        console.warn('[Settings] load profile error', e?.message || e);
      } finally {
        setLoading(false);
      }
    })();
  }, [router]);

  const planLabel = (() => {
    const tier = String(profile?.branding ?? 'free').toLowerCase();
    return tier === 'premium' ? 'Premium' : 'Free';
  })();

  const onLogout = async () => {
    Alert.alert(
      'Log out',
      'Are you sure you want to log out?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Log out',
          style: 'destructive',
          onPress: async () => {
            try {
              await supabase.auth.signOut();
            } catch (e) {
              console.warn('[Settings] signOut error', e?.message || e);
            } finally {
              router.replace('/(auth)/login');
            }
          }
        }
      ]
    );
  };

  if (loading) {
    return (
      <SafeAreaView
        edges={['top', 'left', 'right', 'bottom']}
        style={styles.loading}
      >
        <ActivityIndicator color="#9aa0a6" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      edges={['top', 'left', 'right', 'bottom']}
      style={styles.wrap}
    >
      <ScrollView
        contentContainerStyle={{
          padding: 16,
          paddingBottom: Math.max(insets.bottom, 24),
        }}
      >
        {/* Header / user card */}
        <View style={styles.card}>
          <Text style={styles.h1}>Settings</Text>
          {!!profile?.business_name && (
            <Text style={styles.sub}>{profile.business_name}</Text>
          )}
          <Text style={styles.sub}>{userEmail}</Text>
          <View style={styles.badgesRow}>
            <View style={[styles.badge, planLabel === 'Premium' ? styles.badgePremium : styles.badgeFree]}>
              <Text style={styles.badgeText}>{planLabel}</Text>
            </View>
            {!!profile?.trade_type && (
              <View style={[styles.badge, styles.badgeDim]}>
                <Text style={styles.badgeText}>{String(profile.trade_type).trim()}</Text>
              </View>
            )}
          </View>
        </View>

        {/* Actions */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Account</Text>

          <TouchableOpacity
            style={styles.rowBtn}
            onPress={() => router.push('/(app)/account')}
          >
            <Text style={styles.rowText}>Plan & Billing</Text>
            <Text style={styles.rowHint}>Manage / Upgrade</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.rowBtn}
            onPress={() => router.push('/(app)/profile')}
          >
            <Text style={styles.rowText}>Business Profile</Text>
            <Text style={styles.rowHint}>Edit details & branding</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Support</Text>

          <TouchableOpacity
            style={styles.rowBtn}
            onPress={() => router.push('/(app)/support')}
          >
            <Text style={styles.rowText}>Help & Support</Text>
            <Text style={styles.rowHint}>FAQs, contact</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.rowBtn}
            onPress={() => router.push('/(app)/about')}
          >
            <Text style={styles.rowText}>About</Text>
            <Text style={styles.rowHint}>Version & info</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={[styles.rowBtn, styles.logoutBtn]} onPress={onLogout}>
          <Text style={[styles.rowText, { color: 'white' }]}>Log out</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#0b0b0c' },
  loading: { flex: 1, backgroundColor: '#0b0b0c', alignItems: 'center', justifyContent: 'center' },

  card: { backgroundColor: '#17171a', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: '#2b2c2f', marginBottom: 16 },
  h1: { color: 'white', fontSize: 22, fontWeight: '800', marginBottom: 6 },
  sub: { color: '#a9a9ac', fontSize: 12, marginTop: 2 },
  badgesRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  badgeText: { color: 'white', fontWeight: '700', fontSize: 12 },
  badgePremium: { backgroundColor: '#3ecf8e' },
  badgeFree: { backgroundColor: '#2a2b2f' },
  badgeDim: { backgroundColor: '#232327' },

  section: { backgroundColor: '#141416', borderRadius: 16, padding: 8, borderWidth: 1, borderColor: '#242429', marginBottom: 16 },
  sectionTitle: { color: '#e5e5e7', fontWeight: '800', fontSize: 13, paddingHorizontal: 8, paddingTop: 8, paddingBottom: 4 },

  rowBtn: { backgroundColor: '#1a1a1d', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#2b2c2f', marginHorizontal: 4, marginVertical: 6 },
  rowText: { color: 'white', fontWeight: '700', fontSize: 15 },
  rowHint: { color: '#9aa0a6', fontSize: 12, marginTop: 4 },

  logoutBtn: { backgroundColor: '#b3261e', borderColor: '#b3261e' },
});