// app/(app)/settings/subscriptions.js
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Linking,
  ScrollView,
  Platform,
  Modal,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { supabase } from '../../../lib/supabase';
import * as RNIap from 'react-native-iap';
import Constants from 'expo-constants';

/* ---------- THEME ---------- */
const CARD = "#ffffff";
const TEXT = "#0b1220";
const MUTED = "#6b7280";
const BORDER = "#e6e9ee";
const BRAND = "#2a86ff";
const BG = "#ffffff";
const SUCCESS = "#10b981";
const WARNING = "#f59e0b";

const IS_ANDROID = Platform.OS === 'android';

/* Play product IDs */
const WEEKLY_PRODUCT_ID  = 'premium_weekly';
const MONTHLY_PRODUCT_ID = 'premium_monthly';

const GOOGLE_SUBS_URL = 'https://play.google.com/store/account/subscriptions';

const VERIFY_URL =
  (Constants?.expoConfig?.extra && Constants.expoConfig.extra.VERIFY_URL) ||
  process.env.EXPO_PUBLIC_VERIFY_URL ||
  '';

/* Legal */
const PRIVACY_URL = 'https://www.tradematequotes.com/privacy';
const TERMS_URL   = 'https://www.tradematequotes.com/terms';

/* ---------- INFO BUTTON COMPONENT ---------- */
function InfoButton({ title, tips = [] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <TouchableOpacity onPress={() => setOpen(true)} style={styles.infoBtn}>
        <Text style={{ color: MUTED, fontWeight: "900" }}>i</Text>
      </TouchableOpacity>
      <Modal visible={open} animationType="fade" transparent onRequestClose={() => setOpen(false)}>
        <View style={styles.modalBackdrop} />
        <View style={styles.modalWrap}>
          <View style={styles.modalCard}>
            <View style={styles.modalHead}>
              <Text style={{ color: TEXT, fontWeight: "900", fontSize: 16 }}>{title}</Text>
              <TouchableOpacity onPress={() => setOpen(false)} style={styles.smallBtn}>
                <Text style={styles.smallBtnText}>Close</Text>
              </TouchableOpacity>
            </View>
            {tips.slice(0, 6).map((t, i) => (
              <View key={i} style={{ flexDirection: "row", gap: 8, marginBottom: 8 }}>
                <Text style={{ color: BRAND, fontWeight: "900" }}>•</Text>
                <Text style={{ color: TEXT, flex: 1 }}>{t}</Text>
              </View>
            ))}
          </View>
        </View>
      </Modal>
    </>
  );
}

export default function SubscriptionsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState('free');
  const [billingEmail, setBillingEmail] = useState('');
  const [profile, setProfile] = useState(null);
  const isPremium = plan === 'premium';

  // IAP state
  const [subs, setSubs] = useState([]);
  const [iapReady, setIapReady] = useState(false);
  const updateListenerRef = useRef(null);
  const errorListenerRef = useRef(null);

  /* Helpers */
  const getUserSessionToken = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token || '';
  };

  const fetchSubscriptionsCompat = async (skus) => {
    // Some RNIap versions accept { skus }, others accept skus array.
    try {
      const res = await RNIap.getSubscriptions({ skus });
      if (Array.isArray(res)) return res;
    } catch {}
    const res2 = await RNIap.getSubscriptions(skus);
    return Array.isArray(res2) ? res2 : [];
  };

  /* Load profile */
  const loadProfile = useCallback(async () => {
    try {
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
    }
  }, [router]);

  useEffect(() => { loadProfile(); }, [loadProfile]);
  useFocusEffect(useCallback(() => { loadProfile(); }, [loadProfile]));

  /* IAP: init + listeners */
  useEffect(() => {
    if (!IS_ANDROID) return;

    let mounted = true;
    (async () => {
      try {
        await RNIap.initConnection();
        if (RNIap.flushFailedPurchasesCachedAsPendingAndroid) {
          try { await RNIap.flushFailedPurchasesCachedAsPendingAndroid(); } catch {}
        }
        const products = await fetchSubscriptionsCompat([WEEKLY_PRODUCT_ID, MONTHLY_PRODUCT_ID]);
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
          try {
            const token = await getUserSessionToken();
            await fetch(VERIFY_URL, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({
                platform: 'google',
                productId: purchase.productId,
                purchaseToken: purchase.purchaseToken,
                transactionId: purchase.transactionId,
              }),
            });
          } catch (err) {
            console.warn('Verify failed:', err);
          }
        }

        try { await RNIap.finishTransaction(purchase, true); } catch {}
        Alert.alert('Success', 'Your subscription is active.');
        setBusy(false);
        loadProfile();
      } catch (err) {
        console.warn('verify/finish error', err);
        setBusy(false);
        Alert.alert('Verification error', 'Purchase made, but we could not verify it. Try Restore.');
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

  const pickOfferToken = (product) => {
    const offers = product?.subscriptionOfferDetails || [];
    return offers.length ? (offers[0]?.offerToken || null) : null;
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

      // Ensure we have the latest details
      let details = subs.find(p => p.productId === productId);
      if (!details) {
        const fresh = await fetchSubscriptionsCompat([productId]);
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
          'No active base plan/offer is available. Check Play Console base plans & offers for your tester account/region.'
        );
        return;
      }

      await RNIap.requestSubscription({
        sku: details.productId,
        subscriptionOffers: [{ sku: details.productId, offerToken }],
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
      if (!VERIFY_URL) {
        Alert.alert('Restored (local)', 'Verification endpoint not configured. Your Google Play purchase exists.');
        setBusy(false);
        return;
      }
      const token = await getUserSessionToken();
      await fetch(VERIFY_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
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

  /* Trial days remaining */
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
    <View style={styles.screen}>
      <View style={{ height: insets.top, backgroundColor: CARD }} />
      
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Feather name="arrow-left" size={20} color={TEXT} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Subscription</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView style={styles.content} contentContainerStyle={styles.contentContainer}>
        {/* Current Plan Status */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>Current Plan</Text>
            <InfoButton
              title="Subscription Plans"
              tips={[
                "Free: Basic invoicing and quote features",
                "Premium: Advanced features, unlimited documents, priority support",
                "Trial: Full premium access for evaluation period",
                "Manage your billing and payment methods through Google Play",
              ]}
            />
          </View>

          <View style={styles.planStatusCard}>
            <View style={styles.planStatusHeader}>
              <Feather 
                name={isPremium ? "crown" : "user"} 
                size={24} 
                color={isPremium ? SUCCESS : MUTED} 
              />
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={styles.planStatusTitle}>
                  {isPremium ? "Premium Plan" : "Free Plan"}
                </Text>
                <Text style={styles.planStatusSubtitle}>
                  {billingEmail}
                </Text>
              </View>
              <View style={[
                styles.statusBadge, 
                { backgroundColor: isPremium ? SUCCESS : MUTED }
              ]}>
                <Text style={styles.statusBadgeText}>
                  {isPremium ? 'Active' : 'Free'}
                </Text>
              </View>
            </View>

            {!isPremium && trialDaysLeft > 0 && (
              <View style={styles.trialWarning}>
                <Feather name="clock" size={16} color={WARNING} />
                <Text style={styles.trialWarningText}>
                  {trialDaysLeft} day{trialDaysLeft === 1 ? '' : 's'} left on your trial
                </Text>
              </View>
            )}

            {!isPremium && trialDaysLeft === 0 && (
              <View style={styles.trialExpired}>
                <Feather name="alert-circle" size={16} color="#dc2626" />
                <Text style={styles.trialExpiredText}>
                  Trial has expired
                </Text>
              </View>
            )}
          </View>
        </View>

        {/* Available Plans */}
        {!isPremium && (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>Available Plans</Text>
              <InfoButton
                title="Premium Features"
                tips={[
                  "Unlimited invoices and quotes",
                  "Advanced document templates and branding",
                  "Client portal access",
                  "Priority customer support",
                  "Advanced reporting and analytics",
                  "Payment integrations",
                ]}
              />
            </View>

            <View style={styles.planGrid}>
              <TouchableOpacity
                style={styles.planCard}
                onPress={() => buy(WEEKLY_PRODUCT_ID)}
                disabled={busy || !IS_ANDROID}
                activeOpacity={0.7}
              >
                <Text style={styles.planTitle}>Weekly</Text>
                <Text style={styles.planPrice}>£3.49</Text>
                <Text style={styles.planSubtitle}>per week</Text>
                <Text style={styles.planNote}>inc. VAT</Text>
                {!IS_ANDROID && (
                  <Text style={styles.androidOnly}>Android only</Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.planCard, styles.planCardPopular]}
                onPress={() => buy(MONTHLY_PRODUCT_ID)}
                disabled={busy || !IS_ANDROID}
                activeOpacity={0.7}
              >
                <View style={styles.popularBadge}>
                  <Text style={styles.popularBadgeText}>Most Popular</Text>
                </View>
                <Text style={styles.planTitle}>Monthly</Text>
                <Text style={styles.planPrice}>£5.99</Text>
                <Text style={styles.planSubtitle}>per month</Text>
                <Text style={styles.planNote}>inc. VAT</Text>
                {!IS_ANDROID && (
                  <Text style={styles.androidOnly}>Android only</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Billing Management */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>Billing Management</Text>
            <InfoButton
              title="Billing Information"
              tips={[
                "All subscriptions are handled through Google Play Store",
                "You can cancel or modify your subscription anytime",
                "Billing is handled securely by Google",
                "View payment history and manage payment methods in Google Play",
              ]}
            />
          </View>

          <TouchableOpacity 
            style={styles.actionItem} 
            onPress={openPlaySubscriptions}
            activeOpacity={0.7}
          >
            <View style={styles.actionIcon}>
              <Feather name="credit-card" size={18} color={BRAND} />
            </View>
            <View style={styles.actionTextWrap}>
              <Text style={styles.actionTitle}>Manage Subscription</Text>
              <Text style={styles.actionSubtitle}>
                Cancel, modify, or view billing history
              </Text>
            </View>
            <Feather name="chevron-right" size={16} color={MUTED} />
          </TouchableOpacity>

          <TouchableOpacity 
            style={styles.actionItem} 
            onPress={restore}
            disabled={busy || !IS_ANDROID}
            activeOpacity={0.7}
          >
            <View style={styles.actionIcon}>
              <Feather name="refresh-cw" size={18} color={MUTED} />
            </View>
            <View style={styles.actionTextWrap}>
              <Text style={styles.actionTitle}>Restore Purchase</Text>
              <Text style={styles.actionSubtitle}>
                Restore an existing subscription
              </Text>
            </View>
            <Feather name="chevron-right" size={16} color={MUTED} />
          </TouchableOpacity>

          <Text style={styles.helpText}>
            All billing is managed securely through Google Play. You can cancel your subscription at any time.
          </Text>
        </View>

        <View style={styles.footerNote}>
          <Text style={styles.footerText}>
            Questions about billing? Contact our support team for assistance with your subscription.
          </Text>
        </View>

        <View style={{ height: 20 }} />
      </ScrollView>

      {/* Busy overlay */}
      {busy && (
        <View style={styles.busyOverlay}>
          <Text style={styles.busyText}>Processing...</Text>
        </View>
      )}
    </View>
  );
}

/* ---------- STYLES ---------- */
const styles = StyleSheet.create({
  screen: { 
    flex: 1, 
    backgroundColor: BG 
  },
  
  header: {
    backgroundColor: CARD,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  
  headerTitle: {
    fontSize: 18,
    fontWeight: "900",
    color: TEXT,
    flex: 1,
    textAlign: "center",
    marginHorizontal: 16,
  },
  
  content: {
    flex: 1,
  },
  
  contentContainer: {
    padding: 16,
  },

  card: {
    backgroundColor: CARD,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 16,
    marginBottom: 16,
    ...Platform.select({
      ios: { 
        shadowColor: "#0b1220", 
        shadowOpacity: 0.06, 
        shadowRadius: 8, 
        shadowOffset: { width: 0, height: 4 } 
      },
      android: { elevation: 3 },
    }),
  },
  
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  
  cardTitle: { 
    color: TEXT, 
    fontWeight: "900", 
    fontSize: 16 
  },

  planStatusCard: {
    backgroundColor: "#f8fafc",
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: BORDER,
  },

  planStatusHeader: {
    flexDirection: "row",
    alignItems: "center",
  },

  planStatusTitle: {
    color: TEXT,
    fontWeight: "800",
    fontSize: 16,
  },

  planStatusSubtitle: {
    color: MUTED,
    fontSize: 14,
    marginTop: 2,
  },

  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },

  statusBadgeText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 12,
  },

  trialWarning: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 12,
    padding: 12,
    backgroundColor: "#fef3c7",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#fde68a",
  },

  trialWarningText: {
    color: "#92400e",
    fontWeight: "600",
    fontSize: 13,
  },

  trialExpired: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 12,
    padding: 12,
    backgroundColor: "#fee2e2",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#fca5a5",
  },

  trialExpiredText: {
    color: "#b91c1c",
    fontWeight: "600",
    fontSize: 13,
  },

  planGrid: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 16,
  },

  planCard: {
    flex: 1,
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: "center",
    position: "relative",
    minHeight: 140,
  },

  planCardPopular: {
    borderColor: BRAND,
    borderWidth: 2,
    paddingTop: 24,
  },

  popularBadge: {
    position: "absolute",
    top: -8,
    left: 0,
    right: 0,
    alignItems: "center",
    zIndex: 10,
  },

  popularBadgeText: {
    backgroundColor: BRAND,
    color: "#fff",
    fontWeight: "800",
    fontSize: 12,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },

  planTitle: {
    color: TEXT,
    fontWeight: "800",
    fontSize: 16,
    marginBottom: 8,
  },

  planPrice: {
    color: TEXT,
    fontWeight: "900",
    fontSize: 20,
    marginBottom: 4,
  },

  planSubtitle: {
    color: MUTED,
    fontSize: 14,
    marginBottom: 4,
  },

  planNote: {
    color: MUTED,
    fontSize: 12,
    fontWeight: "500",
  },

  androidOnly: {
    color: "#dc2626",
    fontSize: 11,
    fontWeight: "600",
    marginTop: 4,
    textAlign: "center",
  },

  androidNotice: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 12,
    backgroundColor: "#eff6ff",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#dbeafe",
    marginTop: 8,
  },

  androidNoticeText: {
    color: "#1e40af",
    fontSize: 13,
    fontWeight: "600",
    flex: 1,
  },

  actionItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 16,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: "#f1f5f9",
    gap: 12,
  },

  actionIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: BRAND + "15",
    alignItems: "center",
    justifyContent: "center",
  },

  actionTextWrap: {
    flex: 1,
  },

  actionTitle: {
    color: TEXT,
    fontWeight: "700",
    fontSize: 15,
    marginBottom: 2,
  },

  actionSubtitle: {
    color: MUTED,
    fontSize: 13,
    lineHeight: 18,
  },

  helpText: { 
    color: MUTED, 
    fontSize: 12, 
    marginTop: 12,
    lineHeight: 16,
  },

  footerNote: {
    backgroundColor: "#f8fafc",
    borderRadius: 12,
    padding: 12,
    marginTop: 8,
  },

  footerText: { 
    color: MUTED, 
    fontSize: 12, 
    textAlign: "center",
    lineHeight: 16,
  },

  busyOverlay: {
    position: "absolute",
    inset: 0,
    backgroundColor: "rgba(0,0,0,0.4)",
    alignItems: "center",
    justifyContent: "center",
  },

  busyText: {
    color: "#fff",
    fontWeight: "800",
    fontSize: 16,
  },

  infoBtn: {
    width: 26,
    height: 26,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f8fafc",
  },

  /* Modal */
  modalBackdrop: {
    position: "absolute",
    inset: 0,
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  modalWrap: { 
    flex: 1, 
    justifyContent: "center", 
    alignItems: "center", 
    padding: 16,
  },
  modalCard: {
    backgroundColor: CARD,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: BORDER,
    width: "92%",
    maxWidth: 480,
    ...Platform.select({
      ios: { 
        shadowColor: "#000", 
        shadowOpacity: 0.15, 
        shadowRadius: 16, 
        shadowOffset: { width: 0, height: 6 } 
      },
      android: { elevation: 10 },
    }),
  },
  modalHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  smallBtn: { 
    paddingVertical: 6, 
    paddingHorizontal: 12, 
    borderRadius: 8, 
    backgroundColor: "#f3f4f6" 
  },
  smallBtnText: { 
    color: TEXT, 
    fontWeight: "700", 
    fontSize: 12 
  },
});