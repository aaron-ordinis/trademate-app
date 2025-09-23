// app/(app)/account/index.js
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import * as RNIap from 'react-native-iap';
import Constants from 'expo-constants';
import { ChevronLeft } from 'lucide-react-native';

/* -------------------- Brand tokens -------------------- */
const BRAND = '#2a86ff';
const TEXT = '#0b1220';
const MUTED = '#6b7280';
const CARD = '#ffffff';
const BG = '#f5f7fb';
const BORDER = '#e6e9ee';

const IS_ANDROID = Platform.OS === 'android';

/* -------------------- Play product IDs (your Console IDs) -------------------- */
const WEEKLY_PRODUCT_ID  = 'premium_weekly';
const MONTHLY_PRODUCT_ID = 'premium_monthly';

const GOOGLE_SUBS_URL =
  'https://play.google.com/store/account/subscriptions';

const VERIFY_URL =
  Constants.expoConfig?.extra?.VERIFY_URL || process.env.EXPO_PUBLIC_VERIFY_URL;

/* -------------------- Legal -------------------- */
const PRIVACY_URL = 'https://www.tradematequotes.com/privacy';
const TERMS_URL   = 'https://www.tradematequotes.com/terms';

/* -------------------- Benefits list (no comparison table) -------------------- */
const BENEFITS = [
  'Unlimited AI-generated quotes',
  'Edit quotes & invoices',
  'Use multiple templates',
  'Attach docs & certificates — sent as one combined PDF',
  'Remove TradeMate watermark',
  'Custom logo on PDFs',
  'Priority support',
];

export default function AccountScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [loading, setLoading]   = useState(true);
  const [busy, setBusy]         = useState(false);
  const [plan, setPlan]         = useState('free');
  const [billingEmail, setBillingEmail] = useState('');
  const [profile, setProfile]   = useState(null);
  const isPremium = plan === 'premium';

  // IAP state
  const [subs, setSubs] = useState([]); // results from getSubscriptions
  const updateListenerRef = useRef(null);
  const errorListenerRef  = useRef(null);

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
        .select('plan_tier,plan_status,trial_ends_at,billing_email,premium_since')
        .eq('id', user.id)
        .maybeSingle();
      if (error) throw error;

      setProfile(data || {});
      const tier = String(data?.plan_tier ?? 'free').toLowerCase();
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

  /* -------------------- IAP: init + listeners (Android) -------------------- */
  useEffect(() => {
    if (!IS_ANDROID) return;

    let mounted = true;
    (async () => {
      try {
        await RNIap.initConnection();
        if (RNIap.flushFailedPurchasesCachedAsPendingAndroid) {
          try { await RNIap.flushFailedPurchasesCachedAsPendingAndroid(); } catch {}
        }
        // Fetch the subscription products (new billing returns offer details)
        const products = await RNIap.getSubscriptions([WEEKLY_PRODUCT_ID, MONTHLY_PRODUCT_ID]);
        if (mounted) setSubs(Array.isArray(products) ? products : []);
      } catch (e) {
        console.warn('IAP init error', e);
      }
    })();

    updateListenerRef.current = RNIap.purchaseUpdatedListener(async (purchase) => {
      try {
        // Acknowledge (Android)
        if (purchase?.purchaseToken) {
          try { await RNIap.acknowledgePurchaseAndroid(purchase.purchaseToken); } catch {}
        }

        // Verify with backend
        if (VERIFY_URL && purchase?.purchaseToken && purchase?.productId) {
          const { data: { session } } = await supabase.auth.getSession();
          await fetch(VERIFY_URL, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${session?.access_token ?? ''}`,
            },
            body: JSON.stringify({
              platform: 'google',
              productId: purchase.productId,
              purchaseToken: purchase.purchaseToken,
              transactionId: purchase.transactionId,
            }),
          });
        }

        try { await RNIap.finishTransaction(purchase, true); } catch {}

        Alert.alert('Success', 'Your subscription is active.');
        setBusy(false);
        loadProfile();
      } catch (err) {
        console.warn('verify/finish error', err);
        setBusy(false);
        Alert.alert('Verification error', 'Purchase made, but we could not verify it. Try Restore or contact support.');
      }
    });

    errorListenerRef.current = RNIap.purchaseErrorListener((err) => {
      setBusy(false);
      if (err && !/user.*cancell?ed/i.test(err?.message || '')) {
        Alert.alert('Purchase failed', err.message || 'Please try again.');
      }
      console.warn('IAP error', err);
    });

    return () => {
      mounted = false;
      try { updateListenerRef.current?.remove?.(); } catch {}
      try { errorListenerRef.current?.remove?.(); } catch {}
      try { RNIap.endConnection(); } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadProfile]);

  /* -------------------- Offer helpers (fixes "subscriptionOffers required") -------------------- */
  // Get the first available offerToken for a given product
  const getOfferToken = (productId) => {
    const prod = subs.find(p => p.productId === productId);
    const offers = prod?.subscriptionOfferDetails || [];
    // Prefer a non-trial, paid base offer if present; otherwise just take the first
    const pick =
      offers.find(o => (o?.pricingPhases?.pricingPhaseList?.[0]?.priceAmountMicros ?? 0) > 0) ||
      offers[0];
    return pick?.offerToken;
  };

  const priceLabels = useMemo(() => {
    const fmt = (productId, fallback) => {
      const prod = subs.find(p => p.productId === productId);
      const phase = prod?.subscriptionOfferDetails?.[0]?.pricingPhases?.pricingPhaseList?.[0];
      return phase?.formattedPrice || prod?.price || fallback;
    };
    return {
      weekly:  fmt(WEEKLY_PRODUCT_ID,  'Weekly plan'),
      monthly: fmt(MONTHLY_PRODUCT_ID, 'Monthly plan'),
    };
  }, [subs]);

  const buy = async (productId) => {
    if (!IS_ANDROID) {
      Alert.alert('Android only', 'Purchases are handled via Google Play on Android.');
      return;
    }
    try {
      setBusy(true);
      const offerToken = getOfferToken(productId);
      if (!offerToken) throw new Error('Offer not ready yet. Please try again in a moment.');

      await RNIap.requestSubscription({
        sku: productId,
        // ★ Required for Google Play Billing subscriptions (new model)
        subscriptionOffers: [{ sku: productId, offerToken }],
      });
    } catch (e) {
      setBusy(false);
      console.warn('requestSubscription error', e);
      Alert.alert('Purchase error', e?.message || 'Unable to start purchase.');
    }
  };

  const restore = async () => {
    try {
      setBusy(true);
      const purchases = await RNIap.getAvailablePurchases();
      const latest = purchases?.find(
        p => p.productId === WEEKLY_PRODUCT_ID || p.productId === MONTHLY_PRODUCT_ID
      );
      if (!latest?.purchaseToken) {
        Alert.alert('Nothing to restore', 'No active subscription found for this account.');
        setBusy(false);
        return;
      }
      const { data: { session } } = await supabase.auth.getSession();
      await fetch(VERIFY_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token ?? ''}`,
        },
        body: JSON.stringify({
          platform: 'google',
          productId: latest.productId,
          purchaseToken: latest.purchaseToken,
          transactionId: latest.transactionId,
        }),
      });
      Alert.alert('Restored', 'Your subscription has been restored.');
      loadProfile();
    } catch (e) {
      console.warn('restore error', e);
      Alert.alert('Restore failed', 'Could not restore your purchase.');
    } finally {
      setBusy(false);
    }
  };

  const openPlaySubscriptions = () => Linking.openURL(GOOGLE_SUBS_URL);

  /* -------------------- Render -------------------- */
  if (loading) {
    return (
      <SafeAreaView edges={['top','left','right','bottom']} style={{ flex:1, backgroundColor: BG }}>
        <View style={styles.loading}><ActivityIndicator color={BRAND} /></View>
      </SafeAreaView>
    );
  }

  /* -------------------- Helper to calculate trial days remaining -------------------- */
  const getTrialDaysRemaining = () => {
    if (!profile?.trial_ends_at) return 0;
    const trialEnd = new Date(profile.trial_ends_at);
    const now = new Date();
    const diffTime = trialEnd - now;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return Math.max(0, diffDays);
  };

  const trialDaysLeft = getTrialDaysRemaining();

  return (
    <SafeAreaView edges={['top','left','right','bottom']} style={{ flex:1, backgroundColor: BG }}>
      <ScrollView contentContainerStyle={[styles.wrap, { paddingBottom: Math.max(insets.bottom, 20) }]}>
        
        {/* Header with back button */}
        <View style={styles.header}>
          <TouchableOpacity 
            style={styles.backButton}
            onPress={() => router.back()}
            activeOpacity={0.7}
          >
            <ChevronLeft size={20} color={BRAND} />
            <Text style={styles.backText}>Back</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.h1}>Plan &amp; Billing</Text>

        {/* Plan Cards - moved to top */}
        <View style={styles.planGrid}>
          <TouchableOpacity
            activeOpacity={0.9}
            style={styles.planCard}
            onPress={() => buy(WEEKLY_PRODUCT_ID)}
            disabled={busy || !IS_ANDROID}
          >
            <Text style={styles.planTitle}>1 Week</Text>
            <Text style={styles.priceMain}>{priceLabels.weekly}</Text>
            <Text style={styles.priceSub}>Auto-renews weekly</Text>
            {!IS_ANDROID && <Text style={styles.androidHint}>Android only</Text>}
          </TouchableOpacity>

          <TouchableOpacity
            activeOpacity={0.9}
            style={[styles.planCard, styles.planCardBest, styles.planCardBestPadded]}
            onPress={() => buy(MONTHLY_PRODUCT_ID)}
            disabled={busy || !IS_ANDROID}
          >
            <View style={styles.bestBadge}><Text style={styles.bestBadgeText}>Best Value</Text></View>
            <Text style={[styles.planTitle, styles.planTitleWithBadge]}>1 Month</Text>
            <Text style={styles.priceMain}>{priceLabels.monthly}</Text>
            <Text style={styles.priceSub}>Auto-renews monthly</Text>
            {!IS_ANDROID && <Text style={styles.androidHint}>Android only</Text>}
          </TouchableOpacity>
        </View>

        {/* What you get with TradeMate */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>What you get with TradeMate</Text>
          <View style={{ gap: 8 }}>
            {BENEFITS.map((b) => (
              <Text key={b} style={styles.benefit}>• {b}</Text>
            ))}
          </View>
          <Text style={styles.legalHint}>Prices include VAT where applicable.</Text>
        </View>

        {/* Current status - show trial info instead of "free plan" */}
        <View style={styles.card}>
          {isPremium ? (
            <>
              <Text style={[styles.lead, { textAlign: 'center', marginBottom: 16 }]}>You're on Premium</Text>
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

              <TouchableOpacity style={[styles.btn, styles.btnManage]} onPress={openPlaySubscriptions} disabled={busy}>
                <Text style={styles.btnText}>Manage in Google Play</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Text style={styles.lead}>
                {trialDaysLeft > 0 
                  ? `${trialDaysLeft} day${trialDaysLeft === 1 ? '' : 's'} left on your trial`
                  : 'Trial expired'
                }
              </Text>
              <Text style={styles.subtle}>
                {trialDaysLeft > 0 
                  ? 'Subscribe before your trial ends to keep all features.'
                  : 'Subscribe to regain access to all premium features.'
                }
              </Text>
            </>
          )}
        </View>

        {/* Android policy banner */}
        {IS_ANDROID && (
          <View style={styles.banner}>
            <Text style={styles.bannerTitle}>Purchases on Android</Text>
            <Text style={styles.bannerText}>
              Google Play handles subscriptions on Android devices. You can manage or cancel your
              subscription any time in Google Play.
            </Text>
            <TouchableOpacity style={styles.bannerBtn} onPress={openPlaySubscriptions}>
              <Text style={styles.bannerBtnText}>Open Google Play Subscriptions</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Restore / Manage */}
        <TouchableOpacity style={[styles.btn, styles.btnGhost]} onPress={restore} disabled={busy || !IS_ANDROID}>
          <Text style={styles.btnGhostText}>Restore purchase</Text>
        </TouchableOpacity>

        {/* Legal */}
        <View style={styles.legalRow}>
          <Text style={styles.legalLink} onPress={() => Linking.openURL(PRIVACY_URL)}>Privacy Policy</Text>
          <Text style={styles.dot}>•</Text>
          <Text style={styles.legalLink} onPress={() => Linking.openURL(TERMS_URL)}>User Agreement</Text>
        </View>
      </ScrollView>

      {/* Busy overlay */}
      {busy && (
        <View style={styles.busyOverlay} accessible accessibilityRole="progressbar" accessibilityLabel="Processing purchase">
          <ActivityIndicator size="large" color="#2a86ff" />
          <Text style={{ color: '#fff', marginTop: 8, fontWeight: '700' }}>Processing…</Text>
        </View>
      )}
    </SafeAreaView>
  );
}

/* -------------------- Styles -------------------- */
const styles = StyleSheet.create({
  wrap: { padding: 16, gap: 14 },
  loading: { flex: 1, backgroundColor: BG, alignItems: 'center', justifyContent: 'center' },

  header: {
    paddingBottom: 8,
    marginTop: -8,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 8,
    paddingHorizontal: 8,
    marginLeft: -8,
  },
  backText: {
    color: BRAND,
    fontSize: 16,
    fontWeight: '800',
  },

  h1: { color: TEXT, fontSize: 24, fontWeight: '800', textAlign: 'center', marginVertical: 6, marginTop: 0 },

  banner: {
    backgroundColor: '#eaf2ff',
    borderColor: '#cfe0ff',
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  bannerTitle: { color: TEXT, fontWeight: '900', marginBottom: 4 },
  bannerText: { color: MUTED, marginBottom: 8 },
  bannerBtn: {
    alignSelf: 'flex-start',
    backgroundColor: BRAND,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  bannerBtnText: { color: '#fff', fontWeight: '800' },

  card: {
    backgroundColor: CARD, borderRadius: 16, padding: 16,
    borderWidth: 1, borderColor: BORDER,
    shadowColor: '#0b1220', shadowOpacity: 0.05, shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 }, elevation: 2,
  },

  lead: { color: TEXT, fontWeight: '700', marginBottom: 8 },
  subtle: { color: MUTED },

  btn: { borderRadius: 12, padding: 12, alignItems: 'center' },
  btnManage: { backgroundColor: '#2563eb' },
  btnText: { color: '#fff', fontWeight: '800' },

  metaGrid: {
    borderWidth: 1, borderColor: BORDER, borderRadius: 12, padding: 12,
    backgroundColor: '#f9fafb', rowGap: 6, columnGap: 8,
  },
  metaLabel: { color: MUTED },
  metaValue: { color: TEXT, fontWeight: '700' },

  planGrid: { flexDirection: 'row', gap: 12 },
  planCard: {
    flex: 1, backgroundColor: CARD, borderRadius: 16, padding: 14,
    borderWidth: 1, borderColor: BORDER, alignItems: 'center',
    shadowColor: '#0b1220', shadowOpacity: 0.05, shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 }, elevation: 2,
  },
  planCardBest: { borderColor: BRAND, borderWidth: 2 },
  planCardBestPadded: { paddingTop: 36 },

  bestBadge: {
    position: 'absolute', top: 8, right: 8, backgroundColor: BRAND,
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999,
    shadowColor: BRAND, shadowOpacity: 0.2, shadowRadius: 6, shadowOffset: { width: 0, height: 2 },
  },
  bestBadgeText: { color: '#fff', fontWeight: '800', fontSize: 12 },

  planTitle: { color: TEXT, fontWeight: '900', marginTop: 4, marginBottom: 6, fontSize: 16 },
  planTitleWithBadge: { marginTop: 0 },
  priceMain: { color: TEXT, fontWeight: '900', fontSize: 20 },
  priceSub: { color: MUTED, marginTop: 2, fontSize: 14 },
  androidHint: { marginTop: 8, color: MUTED, fontSize: 12 },

  benefit: { color: TEXT, fontSize: 14, lineHeight: 20 },

  legalHint: { color: MUTED, marginTop: 12, fontSize: 12 },

  legalRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8, marginTop: 8 },
  legalLink: { color: MUTED, textDecorationLine: 'underline' },
  dot: { color: MUTED },

  busyOverlay: {
    position: 'absolute', left: 0, right: 0, top: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center',
  },
});