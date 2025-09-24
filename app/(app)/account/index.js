// app/(app)/account/index.js
import React, { useCallback, useEffect, useRef, useState } from 'react';
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

/* -------------------- Play product IDs -------------------- */
const WEEKLY_PRODUCT_ID  = 'premium_weekly';
const MONTHLY_PRODUCT_ID = 'premium_monthly';

const GOOGLE_SUBS_URL = 'https://play.google.com/store/account/subscriptions';

const VERIFY_URL =
  Constants.expoConfig?.extra?.VERIFY_URL || process.env.EXPO_PUBLIC_VERIFY_URL;

/* -------------------- Legal -------------------- */
const PRIVACY_URL = 'https://www.tradematequotes.com/privacy';
const TERMS_URL   = 'https://www.tradematequotes.com/terms';

/* -------------------- Benefits list -------------------- */
const BENEFITS = [
  'Save time with AI-powered quotes',
  'Professional templates & branding', 
  'Streamlined job management',
  'Increase your revenue potential'
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
  const [subs, setSubs] = useState([]);           // ProductDetails[]
  const [iapReady, setIapReady] = useState(false);
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

  /* -------------------- IAP: init + listeners -------------------- */
  useEffect(() => {
    if (!IS_ANDROID) return;

    let mounted = true;
    (async () => {
      try {
        await RNIap.initConnection();
        if (RNIap.flushFailedPurchasesCachedAsPendingAndroid) {
          try { await RNIap.flushFailedPurchasesCachedAsPendingAndroid(); } catch {}
        }
        // Fetch ProductDetails for subscriptions (includes base plans & offers)
        const products = await RNIap.getSubscriptions({
          skus: [WEEKLY_PRODUCT_ID, MONTHLY_PRODUCT_ID],
        });
        if (mounted) {
          setSubs(Array.isArray(products) ? products : []);
          setIapReady(true);
        }
      } catch (e) {
        console.warn('IAP init error', e);
        if (mounted) setIapReady(false);
      }
    })();

    updateListenerRef.current = RNIap.purchaseUpdatedListener(async (purchase) => {
      try {
        if (purchase?.purchaseToken) {
          try { await RNIap.acknowledgePurchaseAndroid(purchase.purchaseToken); } catch {}
        }
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
  }, [loadProfile]);

  // Helper: choose an offer token for a product
  const pickOfferToken = (product) => {
    const offers = product?.subscriptionOfferDetails || [];
    if (!offers.length) return null;

    // Prefer an offer with an introductory phase if available (trial/intro pricing)
    const withIntro = offers.find(o =>
      o.pricingPhases?.pricingPhaseList?.some(ph => ['FREE_TRIAL','INTRODUCTORY'].includes(ph?.offerPaymentMode))
    );
    return (withIntro || offers[0])?.offerToken || null;
  };

  const buy = async (productId) => {
    if (!IS_ANDROID) {
      Alert.alert('Android only', 'Purchases are handled via Google Play on Android.');
      return;
    }
    try {
      if (!iapReady) {
        Alert.alert('Please wait', 'Store not ready yet. Try again in a moment.');
        return;
      }
      setBusy(true);

      // Ensure we have the latest details (avoid stale tokens)
      let details = subs.find(p => p.productId === productId);
      if (!details) {
        const fresh = await RNIap.getSubscriptions({ skus: [productId] });
        details = Array.isArray(fresh) ? fresh.find(p => p.productId === productId) : null;
      }
      if (!details) {
        setBusy(false);
        Alert.alert('Unavailable', 'This plan is not available right now for your account.');
        return;
      }

      const offerToken = pickOfferToken(details);
      if (!offerToken) {
        setBusy(false);
        Alert.alert(
          'Offer not ready',
          'No active base plan/offer is available for this product. Check Play Console base plans & offers for your tester account/region.'
        );
        return;
      }

      await RNIap.requestSubscription({
        sku: details.productId,
        subscriptionOffers: [{ sku: details.productId, offerToken }],
        // You can also pass obfuscatedAccountIdAndroid if you want:
        // obfuscatedAccountIdAndroid: (await supabase.auth.getUser()).data.user.id
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

  /* -------------------- Trial days remaining -------------------- */
  const getTrialDaysRemaining = () => {
    if (!profile?.trial_ends_at) return 0;
    const trialEnd = new Date(profile.trial_ends_at);
    const now = new Date();
    const diffTime = trialEnd - now;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return Math.max(0, diffDays);
  };
  const trialDaysLeft = getTrialDaysRemaining();

  /* -------------------- Render -------------------- */
  if (loading) {
    return (
      <SafeAreaView edges={['top','left','right','bottom']} style={{ flex:1, backgroundColor: BG }}>
        <View style={styles.loading}><ActivityIndicator color={BRAND} /></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={['top','left','right','bottom']} style={{ flex:1, backgroundColor: BG }}>
      <ScrollView contentContainerStyle={[styles.wrap, { paddingBottom: Math.max(insets.bottom, 20) }]}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity 
            style={styles.backButton}
            onPress={() => router.back()}
            activeOpacity={0.7}
          >
            <ChevronLeft size={20} color={BRAND} />
            <Text style={styles.backText}>Back</Text>
          </TouchableOpacity>
          <Text style={styles.h1}>Choose Your Plan</Text>
          <View style={{ width: 52 }} />
        </View>

        {/* Plan Cards - Centered */}
        <View style={styles.planGrid}>
          <TouchableOpacity
            activeOpacity={0.9}
            style={styles.planCard}
            onPress={() => buy(WEEKLY_PRODUCT_ID)}
            disabled={busy || !IS_ANDROID}
          >
            <Text style={styles.planTitle}>1 Week</Text>
            <View style={styles.priceContainer}>
              <Text style={styles.priceMain}>£3.49</Text>
            </View>
            <Text style={styles.vatText}>inc. VAT</Text>
            <Text style={styles.priceSub}>Auto-renews weekly</Text>
            {!IS_ANDROID && <Text style={styles.androidHint}>Android only</Text>}
          </TouchableOpacity>

          <TouchableOpacity
            activeOpacity={0.9}
            style={[styles.planCard, styles.planCardBest]}
            onPress={() => buy(MONTHLY_PRODUCT_ID)}
            disabled={busy || !IS_ANDROID}
          >
            <View style={styles.bestBadge}><Text style={styles.bestBadgeText}>Most Popular</Text></View>
            <Text style={[styles.planTitle, styles.planTitleWithBadge]}>1 Month</Text>
            <View style={styles.priceContainer}>
              <Text style={styles.priceMain}>£5.99</Text>
            </View>
            <Text style={styles.vatText}>inc. VAT</Text>
            <Text style={styles.priceSub}>Auto-renews monthly</Text>
            {!IS_ANDROID && <Text style={styles.androidHint}>Android only</Text>}
          </TouchableOpacity>
        </View>

        {/* Why TradeMate Section */}
        <View style={styles.whySection}>
          <Text style={styles.whyTitle}>Why TradeMate?</Text>
          <View style={styles.benefitsList}>
            {BENEFITS.map((benefit, index) => (
              <View key={index} style={styles.benefitItem}>
                <Text style={styles.bulletPoint}>•</Text>
                <Text style={styles.benefitText}>{benefit}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Current status / Trial */}
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

        {/* Footer with Policy Links and Restore Button */}
        <View style={styles.footerSection}>
          <View style={styles.legalRow}>
            <Text style={styles.legalLink} onPress={() => Linking.openURL(PRIVACY_URL)}>Privacy Policy</Text>
            <Text style={styles.legalLink} onPress={() => Linking.openURL(TERMS_URL)}>User Agreement</Text>
          </View>

          <View style={styles.restoreContainer}>
            <TouchableOpacity style={[styles.btn, styles.btnGhost]} onPress={restore} disabled={busy || !IS_ANDROID}>
              <Text style={styles.btnGhostText}>Restore purchase</Text>
            </TouchableOpacity>
          </View>
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

/* -------------------- Updated Styles -------------------- */
const styles = StyleSheet.create({
  wrap: { padding: 16, gap: 14 },
  loading: { flex: 1, backgroundColor: BG, alignItems: 'center', justifyContent: 'center' },
  header: { 
    flexDirection: 'row',
    alignItems: 'center', 
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: 8
  },
  backButton: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    gap: 4, 
    paddingVertical: 8, 
    paddingHorizontal: 8 
  },
  backText: { color: BRAND, fontSize: 16, fontWeight: '800' },
  h1: { 
    color: TEXT, 
    fontSize: 24, 
    fontWeight: '800', 
    textAlign: 'center'
  },
  banner: { 
    backgroundColor: '#eaf2ff', 
    borderColor: '#cfe0ff', 
    borderWidth: 1, 
    borderRadius: 12, 
    padding: 12, 
    marginBottom: 12,
    alignItems: 'center',
  },
  bannerTitle: { color: TEXT, fontWeight: '900', marginBottom: 4, textAlign: 'center' },
  bannerText: { color: MUTED, marginBottom: 8, textAlign: 'center', lineHeight: 20 },
  bannerBtn: { backgroundColor: BRAND, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, alignSelf: 'center' },
  bannerBtnText: { color: '#fff', fontWeight: '800', textAlign: 'center' },
  card: { 
    backgroundColor: CARD, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: BORDER, 
    shadowColor: '#0b1220', shadowOpacity: 0.05, shadowRadius: 14, shadowOffset: { width: 0, height: 8 }, elevation: 2,
    alignItems: 'center',
  },
  lead: { color: TEXT, fontWeight: '700', marginBottom: 8, textAlign: 'center' },
  subtle: { color: MUTED, textAlign: 'center' },
  btn: { borderRadius: 12, padding: 12, alignItems: 'center' },
  btnManage: { backgroundColor: '#2563eb' },
  btnText: { color: '#fff', fontWeight: '800' },
  metaGrid: { borderWidth: 1, borderColor: BORDER, borderRadius: 12, padding: 12, backgroundColor: '#f9fafb', rowGap: 6, columnGap: 8 },
  metaLabel: { color: MUTED },
  metaValue: { color: TEXT, fontWeight: '700' },
  whySection: { paddingVertical: 20, paddingHorizontal: 16, alignItems: 'center' },
  whyTitle: { fontSize: 24, fontWeight: '900', color: TEXT, textAlign: 'center', marginBottom: 16 },
  benefitsList: { alignItems: 'center', alignSelf: 'stretch' },
  benefitItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 8, paddingHorizontal: 20 },
  bulletPoint: { fontSize: 16, color: TEXT, fontWeight: '900', marginRight: 8 },
  benefitText: { fontSize: 16, color: TEXT, textAlign: 'center', lineHeight: 22 },
  planGrid: { flexDirection: 'row', gap: 12, justifyContent: 'center', alignItems: 'stretch', paddingHorizontal: 16, marginBottom: 20, marginTop: 10 },
  planCard: { 
    flex: 1, backgroundColor: CARD, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: BORDER, 
    alignItems: 'center', justifyContent: 'center', shadowColor: '#0b1220', shadowOpacity: 0.08, shadowRadius: 12, 
    shadowOffset: { width: 0, height: 4 }, elevation: 4, position: 'relative', minHeight: 160,
  },
  planCardBest: { borderColor: BRAND, borderWidth: 2, paddingTop: 24 },
  bestBadge: { position: 'absolute', top: -8, left: 0, right: 0, alignItems: 'center', zIndex: 10 },
  bestBadgeText: { backgroundColor: BRAND, color: '#fff', fontWeight: '800', fontSize: 12, paddingHorizontal: 12, paddingVertical: 4, borderRadius: 12, overflow: 'hidden' },
  planTitle: { color: TEXT, fontWeight: '800', fontSize: 16, marginBottom: 8, textAlign: 'center' },
  planTitleWithBadge: { marginTop: 4 },
  priceContainer: { alignItems: 'center', marginBottom: 4 },
  priceMain: { color: TEXT, fontWeight: '900', fontSize: 20, textAlign: 'center' },
  vatText: { fontSize: 12, color: MUTED, marginBottom: 4, fontWeight: '500', textAlign: 'center' },
  priceSub: { color: MUTED, fontSize: 14, textAlign: 'center' },
  additionalInfo: { alignItems: 'center', paddingVertical: 16 },
  infoText: { fontSize: 14, color: MUTED, textAlign: 'center', marginBottom: 6, lineHeight: 18 },
  androidHint: { marginTop: 8, color: MUTED, fontSize: 12 },
  footerSection: { paddingHorizontal: 16, paddingVertical: 20, alignItems: 'center' },
  legalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', width: '100%', marginBottom: 16, gap: 20 },
  legalLink: { color: BRAND, fontWeight: '700', fontSize: 14, textAlign: 'center' },
  restoreContainer: { alignItems: 'center', width: '100%' },
  btnGhost: { borderRadius: 12, padding: 12, alignItems: 'center', backgroundColor: 'transparent', borderWidth: 1, borderColor: BORDER, minWidth: 160 },
  btnGhostText: { color: TEXT, fontWeight: '800', textAlign: 'center' },
  busyOverlay: { position: 'absolute', left: 0, right: 0, bottom: 0, top: 0, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center' },
});