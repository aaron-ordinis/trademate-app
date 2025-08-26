// app/(app)/account/index.js
import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Linking,
  ScrollView,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../../../lib/supabase';
import { ACCOUNT_PRICE } from '../../../lib/pricing';

/* -------------------- Pricing helpers -------------------- */
const PRICING = {
  monthly: `£${ACCOUNT_PRICE.monthlyGBP.toFixed(2)}/mo`,
  yearly: `£${ACCOUNT_PRICE.yearlyGBP.toFixed(2)}/yr`,
};
const WEEKS_PER_MONTH = 4;
const WEEKS_PER_YEAR = 52;

const weekly = {
  monthly: ACCOUNT_PRICE.monthlyGBP / WEEKS_PER_MONTH,
  yearly: ACCOUNT_PRICE.yearlyGBP / WEEKS_PER_YEAR,
};
const weeklyLabel = (v) => `£${(Math.round(v * 100) / 100).toFixed(2)}/week`;

/* -------------------- Legal -------------------- */
// TODO: replace with your live docs
const PRIVACY_URL = 'https://example.com/privacy';
const TERMS_URL = 'https://example.com/terms';

/* -------------------- Feature list -------------------- */
/**
 * Each row: [label, freeValue, premiumValue, key]
 * - 'x' instead of dashes where something isn't included
 * - Free value for AI is "1/day" and Premium is "Unlimited"
 */
const FEATURE_ROWS = [
  ['Custom logo', '✓', '✓', 'logo'],
  ['AI-generated quotes', '1/day', 'Unlimited', 'ai'],
  ['Edit feature', 'x', '✓', 'edit'],
  ['Duplicate feature', 'x', '✓', 'duplicate'],
  ['Multiple templates', 'x', '✓', 'templates'],
  ['Remove TradeMate watermark', 'x', '✓', 'watermark'],
  ['Priority support', 'x', '✓', 'support'],
];

export default function AccountScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState('free');
  const [billingEmail, setBillingEmail] = useState('');
  const [profile, setProfile] = useState(null);

  const isPremium = plan === 'premium';

  /* -------------------- Load profile -------------------- */
  const loadProfile = useCallback(async () => {
    try {
      setLoading(true);
      const { data: auth } = await supabase.auth.getUser();
      const user = auth?.user;
      if (!user) { router.replace('/(auth)/login'); return; }
      setBillingEmail(user.email || '');

      const { data, error } = await supabase
        .from('profiles')
        .select('branding,billing_email,stripe_customer_id,premium_since')
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
  useFocusEffect(useCallback(() => { loadProfile(); }, [loadProfile]));

  /* -------------------- Stripe: Checkout -------------------- */
  const startCheckout = async (planKey /* 'monthly' | 'yearly' */) => {
    try {
      setBusy(true);
      const { data: auth } = await supabase.auth.getUser();
      const user = auth?.user;
      const email = user?.email || billingEmail || undefined;
      const user_id = user?.id || undefined;

      const { data, error } = await supabase.functions.invoke('stripe-checkout', {
        body: { plan: planKey, email, user_id, platform: Platform.OS },
      });
      if (error) throw error;
      if (!data?.url) throw new Error('No checkout URL returned.');
      Linking.openURL(data.url);
    } catch (e) {
      Alert.alert('Upgrade failed', e?.message ?? 'Could not start checkout.');
    } finally {
      setBusy(false);
    }
  };

  /* -------------------- Stripe: Billing portal -------------------- */
  const openPortal = async () => {
    try {
      setBusy(true);
      const { data, error } = await supabase.functions.invoke('stripe-portal', {
        body: {
          returnUrl: Platform.select({
            ios: 'tradematequotes://billing/return',
            android: 'tradematequotes://billing/return',
            default: 'https://yourdomain.example/billing/return',
          }),
        },
      });
      if (error) throw error;
      if (!data?.url) throw new Error('No portal URL returned.');
      Linking.openURL(data.url);
    } catch (e) {
      Alert.alert('Could not open billing portal', e?.message ?? 'Please try again.');
    } finally {
      setBusy(false);
    }
  };

  /* -------------------- Render -------------------- */
  if (loading) {
    return (
      <SafeAreaView edges={['top','left','right','bottom']} style={{ flex:1, backgroundColor: BG }}>
        <View style={styles.loading}><ActivityIndicator color={BRAND} /></View>
      </SafeAreaView>
    );
  }

  const freeActive = !isPremium;
  const lastIndex = FEATURE_ROWS.length - 1;

  return (
    <SafeAreaView edges={['top','left','right','bottom']} style={{ flex:1, backgroundColor: BG }}>
      <ScrollView contentContainerStyle={[styles.wrap, { paddingBottom: Math.max(insets.bottom, 20) }]}>
        <Text style={styles.h1}>Plan &amp; Billing</Text>

        {/* Current plan */}
        <View style={styles.card}>
          <Text style={styles.lead}>{isPremium ? 'You’re on Premium 🎉' : 'You’re on the Free plan'}</Text>

          {isPremium ? (
            <View style={{ gap: 10 }}>
              <View style={styles.metaGrid}>
                <Text style={styles.metaLabel}>Billing email</Text>
                <Text style={styles.metaValue}>{billingEmail || '—'}</Text>

                <Text style={styles.metaLabel}>Plan</Text>
                <Text style={styles.metaValue}>Premium</Text>

                {!!profile?.premium_since && (
                  <>
                    <Text style={styles.metaLabel}>Premium since</Text>
                    <Text style={styles.metaValue}>
                      {new Date(profile.premium_since).toLocaleDateString()}
                    </Text>
                  </>
                )}
              </View>

              <TouchableOpacity style={[styles.btn, styles.btnManage]} onPress={openPortal} disabled={busy}>
                <Text style={styles.btnText}>{busy ? 'Opening…' : 'Manage billing'}</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <Text style={styles.subtle}>Upgrade to unlock everything — cancel anytime.</Text>
          )}
        </View>

        {/* Plan cards – always visible so users can switch/see prices */}
        <View style={styles.planGrid}>
          {/* Monthly */}
          <TouchableOpacity
            activeOpacity={0.9}
            style={styles.planCard}
            onPress={() => startCheckout('monthly')}
            disabled={busy}
          >
            <Text style={styles.planTitle}>1 Month</Text>
            <Text style={styles.priceMain}>{weeklyLabel(weekly.monthly)}</Text>
            <Text style={styles.priceSub}>{PRICING.monthly}</Text>
          </TouchableOpacity>

          {/* Yearly (Best Offer) */}
          <TouchableOpacity
            activeOpacity={0.9}
            style={[styles.planCard, styles.planCardBest, styles.planCardBestPadded]}
            onPress={() => startCheckout('yearly')}
            disabled={busy}
          >
            <View style={styles.bestBadge}><Text style={styles.bestBadgeText}>Best Offer</Text></View>
            <Text style={[styles.planTitle, styles.planTitleWithBadge]}>12 Months</Text>
            <Text style={styles.priceMain}>{weeklyLabel(weekly.yearly)}</Text>
            <Text style={styles.priceSub}>{PRICING.yearly}</Text>
          </TouchableOpacity>
        </View>

        {/* Feature comparison — always visible; highlight current plan column */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>What you get</Text>

          <View style={styles.table}>
            {/* Header row */}
            <View style={[styles.tr, styles.thRow]}>
              <Text style={[styles.th, styles.tFeature]}>Features</Text>

              {/* FREE header (wrapped when active) */}
              <View style={[styles.colBox, freeActive && styles.colWrapHeader]}>
                <Text style={[styles.th, styles.tFree]}>Free</Text>
              </View>

              {/* PREMIUM header (wrapped when active) */}
              <View style={[styles.colBox, !freeActive && styles.colWrapHeader]}>
                <Text style={[styles.th, styles.tPro]}>Premium</Text>
              </View>
            </View>

            {/* Data rows */}
            {FEATURE_ROWS.map(([label, freeVal, proVal, key], i) => {
              const isLast = i === lastIndex;

              return (
                <View key={key} style={[styles.tr, i % 2 ? styles.striped : null]}>
                  {/* Feature label */}
                  <Text style={[styles.td, styles.tFeature, styles.wrapText]}>{label}</Text>

                  {/* Free column cell */}
                  <View style={[
                    styles.colBox,
                    freeActive && (isLast ? styles.colWrapFooter : styles.colWrapCell)
                  ]}>
                    <Text style={[styles.td, styles.tFree, styles.wrapText, freeActive && styles.colTextStrong]}>
                      {freeVal}
                    </Text>
                  </View>

                  {/* Premium column cell */}
                  <View style={[
                    styles.colBox,
                    !freeActive && (isLast ? styles.colWrapFooter : styles.colWrapCell)
                  ]}>
                    <Text style={[styles.td, styles.tPro, styles.wrapText, !freeActive && styles.colTextStrong]}>
                      {proVal}
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>

          <Text style={styles.legalHint}>Prices include VAT where applicable.</Text>
        </View>

        {/* Legal */}
        <View style={styles.legalRow}>
          <Text style={styles.legalLink} onPress={() => Linking.openURL(PRIVACY_URL)}>Privacy Policy</Text>
          <Text style={styles.dot}>•</Text>
          <Text style={styles.legalLink} onPress={() => Linking.openURL(TERMS_URL)}>User Agreement</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

/* -------------------- Styles -------------------- */
const BRAND = '#2a86ff';
const TEXT = '#0b1220';
const MUTED = '#6b7280';
const CARD = '#ffffff';
const BG = '#f5f7fb';
const BORDER = '#e6e9ee';

const styles = StyleSheet.create({
  wrap: { padding: 16, gap: 14 },
  loading: { flex: 1, backgroundColor: BG, alignItems: 'center', justifyContent: 'center' },

  h1: { color: TEXT, fontSize: 24, fontWeight: '800', textAlign: 'center', marginVertical: 6 },

  card: {
    backgroundColor: CARD, borderRadius: 16, padding: 16,
    borderWidth: 1, borderColor: BORDER,
    shadowColor: '#0b1220', shadowOpacity: 0.05, shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 }, elevation: 2,
  },

  lead: { color: TEXT, fontWeight: '700', marginBottom: 8 },
  subtle: { color: MUTED },

  btn: { borderRadius: 12, padding: 12, alignItems: 'center' },
  btnManage: { backgroundColor: '#10b981' },
  btnText: { color: '#fff', fontWeight: '800' },

  metaGrid: {
    borderWidth: 1, borderColor: BORDER, borderRadius: 12, padding: 12,
    backgroundColor: '#f9fafb', rowGap: 6, columnGap: 8,
  },
  metaLabel: { color: MUTED },
  metaValue: { color: TEXT, fontWeight: '700' },

  /* Plans */
  planGrid: { flexDirection: 'row', gap: 12 },
  planCard: {
    flex: 1, backgroundColor: CARD, borderRadius: 16, padding: 14,
    borderWidth: 1, borderColor: BORDER, alignItems: 'center',
    shadowColor: '#0b1220', shadowOpacity: 0.05, shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 }, elevation: 2,
  },
  planCardBest: { borderColor: BRAND, borderWidth: 2 },
  // Prevent "Best Offer" from overlapping "12 Months"
  planCardBestPadded: { paddingTop: 32 },
  bestBadge: {
    position: 'absolute', top: 8, right: 8, backgroundColor: BRAND,
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999,
    shadowColor: BRAND, shadowOpacity: 0.2, shadowRadius: 6, shadowOffset: { width: 0, height: 2 },
  },
  bestBadgeText: { color: '#fff', fontWeight: '800', fontSize: 12 },
  planTitle: { color: TEXT, fontWeight: '900', marginTop: 4, marginBottom: 6 },
  planTitleWithBadge: { marginTop: 0 },
  priceMain: { color: TEXT, fontWeight: '900', fontSize: 20 },
  priceSub: { color: MUTED, marginTop: 2 },

  /* Table */
  table: { marginTop: 6, borderWidth: 1, borderColor: BORDER, borderRadius: 12, overflow: 'hidden' },
  tr: { flexDirection: 'row', alignItems: 'center' },
  thRow: { backgroundColor: '#f3f4f6' },
  striped: { backgroundColor: '#fafafa' },

  th: { fontWeight: '800', color: TEXT, paddingVertical: 10, paddingHorizontal: 12, flex: 1, textAlign: 'center' },
  td: { color: TEXT, paddingVertical: 12, paddingHorizontal: 12, flex: 1, textAlign: 'center' },
  tFeature: { flex: 2, textAlign: 'left' },
  tFree: { textAlign: 'center' },
  tPro: { textAlign: 'center', fontWeight: '800' },

  // Make sure long labels/values wrap cleanly
  wrapText: { flexWrap: 'wrap' },

  // Column wrappers to create a single, continuous highlighted "card" look
  colBox: { flex: 1 }, // keeps layout matching the cells
  colWrapHeader: {
    backgroundColor: '#f0f6ff',
    borderColor: '#2a86ff',
    borderTopLeftRadius: 10,
    borderTopRightRadius: 10,
    borderWidth: 1.5,
    marginHorizontal: 4,
    overflow: 'hidden',
    shadowColor: '#2a86ff',
    shadowOpacity: 0.08,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  colWrapCell: {
    backgroundColor: '#f0f6ff',
    borderColor: '#2a86ff',
    borderLeftWidth: 1.5,
    borderRightWidth: 1.5,
    marginHorizontal: 4,
    // overlap row borders to remove visual gaps
    marginTop: -1,
    marginBottom: -1,
  },
  colWrapFooter: {
    backgroundColor: '#f0f6ff',
    borderColor: '#2a86ff',
    borderWidth: 1.5,
    borderBottomLeftRadius: 10,
    borderBottomRightRadius: 10,
    marginHorizontal: 4,
    marginTop: -1,
    overflow: 'hidden',
  },
  colTextStrong: { fontWeight: '800' },

  cardTitle: { color: TEXT, fontWeight: '800', marginBottom: 6 },
  legalHint: { color: MUTED, marginTop: 10, fontSize: 12 },

  legalRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8, marginTop: 8 },
  legalLink: { color: MUTED, textDecorationLine: 'underline' },
  dot: { color: MUTED },
});