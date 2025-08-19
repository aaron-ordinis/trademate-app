// app/(app)/account/index.js
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert, Linking } from 'react-native';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../../../lib/supabase';

// Display pricing (GBP)
const PRICING = {
  monthly: '£4.99/mo',
  yearly:  '£47.99/yr',
};

const PREMIUM_FEATURES = [
  'Duplicate existing quotes',
  'Edit generated quotes',
  'Remove “Made with TradeMate” branding',
  'Priority support',
  'Future Pro features included',
];

export default function AccountScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState('free');
  const [billingEmail, setBillingEmail] = useState('');
  const [profile, setProfile] = useState(null);

  const loadProfile = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.replace('/(auth)/login'); return; }
      setBillingEmail(user.email || '');

      const { data, error } = await supabase
        .from('profiles')
        .select('branding, billing_email, stripe_customer_id, premium_since')
        .eq('id', user.id)
        .maybeSingle();
      if (error) throw error;

      setProfile(data || {});
      const tier = String(data?.branding ?? 'free').toLowerCase();
      setPlan(tier === 'premium' ? 'premium' : 'free');
      if (data?.billing_email) setBillingEmail(data.billing_email);
    } catch (e) {
      Alert.alert('Error', e?.message ?? 'Could not load billing info.');
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => { loadProfile(); }, [loadProfile]);

  // Refresh when returning from Stripe
  useFocusEffect(
    useCallback(() => {
      loadProfile();
    }, [loadProfile])
  );

  const isPremium = plan === 'premium';

  // Start Stripe Checkout using your edge function that accepts { plan, email, user_id }
  const startCheckout = async (planKey /* 'monthly' | 'yearly' */) => {
    try {
      setBusy(true);

      const { data: { user } } = await supabase.auth.getUser();
      const email = user?.email || billingEmail || undefined;
      const user_id = user?.id || '';

      const { data, error } = await supabase.functions.invoke('stripe-checkout', {
        body: { plan: planKey, email, user_id },
      });
      if (error) throw error;
      if (!data?.url) throw new Error('No checkout URL returned');
      Linking.openURL(data.url);
    } catch (e) {
      Alert.alert('Upgrade failed', e?.message ?? 'Could not start checkout.');
    } finally {
      setBusy(false);
    }
  };

  // Customer billing portal (requires your stripe-portal function)
  const openPortal = async () => {
    try {
      setBusy(true);
      const { data, error } = await supabase.functions.invoke('stripe-portal', {
        body: { returnUrl: 'tradematequotes://billing/return' },
      });
      if (error) throw error;
      if (!data?.url) throw new Error('No portal URL returned');
      Linking.openURL(data.url);
    } catch (e) {
      Alert.alert('Could not open billing portal', e?.message ?? 'Please try again.');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView edges={['top','left','right','bottom']} style={{ flex:1, backgroundColor:'#0b0b0c' }}>
        <View style={styles.loading}><ActivityIndicator color="#9aa0a6" /></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={['top','left','right','bottom']} style={{ flex:1, backgroundColor:'#0b0b0c' }}>
      <View style={[styles.wrap, { paddingBottom: Math.max(insets.bottom, 16) }]}>
        <Text style={styles.h1}>Plan & Billing</Text>

        {/* Current plan */}
        <View style={styles.card}>
          <Text style={styles.lead}>{isPremium ? 'You’re on Premium 🎉' : 'You’re on the Free plan'}</Text>

          {isPremium ? (
            <TouchableOpacity style={[styles.btn, styles.btnManage]} onPress={openPortal} disabled={busy}>
              <Text style={styles.btnText}>{busy ? 'Opening…' : 'Manage billing'}</Text>
            </TouchableOpacity>
          ) : (
            <View style={{ gap: 8 }}>
              <TouchableOpacity
                style={[styles.btn, styles.btnUpgrade]}
                onPress={() => startCheckout('monthly')}
                disabled={busy}
              >
                <Text style={styles.btnText}>{busy ? 'Please wait…' : `Upgrade • ${PRICING.monthly}`}</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.btn, styles.btnDark]}
                onPress={() => startCheckout('yearly')}
                disabled={busy}
              >
                <Text style={styles.btnText}>{busy ? 'Please wait…' : `Upgrade • ${PRICING.yearly}`}</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Features */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{isPremium ? 'Your Premium features' : 'Upgrade unlocks'}</Text>
          <View style={{ marginTop: 6 }}>
            {PREMIUM_FEATURES.map((f, i) => (
              <View style={styles.row} key={i}>
                <Text style={styles.bullet}>•</Text>
                <Text style={styles.rowText}>{f}</Text>
              </View>
            ))}
          </View>
          {!isPremium && <Text style={styles.hint}>Cancel anytime. Prices include VAT where applicable.</Text>}
        </View>

        {/* Billing info */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Billing information</Text>
          <View style={{ marginTop: 6 }}>
            <View style={styles.rowTight}><Text style={styles.metaLabel}>Billing email</Text><Text style={styles.metaValue}>{billingEmail || '—'}</Text></View>
            <View style={styles.rowTight}><Text style={styles.metaLabel}>Plan</Text><Text style={styles.metaValue}>{isPremium ? 'Premium' : 'Free'}</Text></View>
            {isPremium && profile?.premium_since && (
              <View style={styles.rowTight}><Text style={styles.metaLabel}>Premium since</Text><Text style={styles.metaValue}>{new Date(profile.premium_since).toLocaleDateString()}</Text></View>
            )}
          </View>

          <TouchableOpacity
            style={[styles.smallBtn, styles.btnDark]}
            onPress={isPremium ? openPortal : () => startCheckout('monthly')}
            disabled={busy}
          >
            <Text style={styles.smallBtnText}>{isPremium ? 'Open billing portal' : 'Upgrade now'}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#0b0b0c', padding: 16 },
  loading: { flex: 1, backgroundColor: '#0b0b0c', alignItems: 'center', justifyContent: 'center' },

  h1: { color: 'white', fontSize: 22, fontWeight: '800', marginBottom: 12 },

  card: { backgroundColor: '#17171a', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: '#2b2c2f', marginBottom: 14 },

  lead: { color: '#cfcfd2', marginBottom: 10 },

  btn: { borderRadius: 12, padding: 12, alignItems: 'center' },
  btnUpgrade: { backgroundColor: '#2a86ff' },
  btnManage: { backgroundColor: '#3ecf8e' },
  btnDark: { backgroundColor: '#1f1f21', borderWidth: 1, borderColor: '#34353a' },
  btnText: { color: 'white', fontWeight: '800' },

  cardTitle: { color: 'white', fontWeight: '800', marginBottom: 6 },

  row: { flexDirection: 'row', alignItems: 'flex-start', marginVertical: 4 },
  bullet: { color: '#cfcfd2', width: 16, textAlign: 'center' },
  rowText: { color: '#cfcfd2', flex: 1 },

  hint: { color: '#9aa0a6', fontSize: 12, marginTop: 10 },

  rowTight: { flexDirection: 'row', justifyContent: 'space-between', marginVertical: 3 },
  metaLabel: { color: '#a9a9ac' },
  metaValue: { color: 'white', fontWeight: '600' },

  smallBtn: { marginTop: 12, borderRadius: 12, paddingVertical: 10, alignItems: 'center' },
  smallBtnText: { color: 'white', fontWeight: '800' },
});