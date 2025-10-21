import React, { useState, useEffect, useRef } from "react";
import {
  Modal, View, Text, TouchableOpacity, StyleSheet, Platform, Alert, StatusBar,
} from "react-native";
// Removed BlurView to make the background fully transparent
// import { BlurView } from "expo-blur";
import * as Haptics from "expo-haptics";
import { Crown } from "lucide-react-native";
import { useRouter } from "expo-router";
import { supabase } from "../lib/supabase";
import { loginHref } from "../lib/nav";
import { LogOut } from "lucide-react-native";
import * as RNIap from "react-native-iap";
import Constants from "expo-constants";
import * as NavigationBar from "expo-navigation-bar";

const BRAND = "#2a86ff";
const TEXT = "#0b1220";
const MUTED = "#6b7280";
const CARD = "#ffffff";
const BORDER = "#e6e9ee";

const IS_ANDROID = Platform.OS === "android";
const WEEKLY_PRODUCT_ID  = "premium_weekly";
const MONTHLY_PRODUCT_ID = "premium_monthly";
const VERIFY_URL =
  (Constants?.expoConfig?.extra && Constants.expoConfig.extra.VERIFY_URL) ||
  process.env.EXPO_PUBLIC_VERIFY_URL ||
  "";

export default function PaywallModal({
  visible,
  blocking = false,
  onClose,
  onSubscribe,
  onSignOut,
  title = "Trial Ended",
  message = "Your free trial has ended. To continue using TradeMate, choose a weekly or monthly plan below to unlock the app.",
}) {
  const [busy, setBusy] = useState(false);
  const [subs, setSubs] = useState([]);
  const [iapReady, setIapReady] = useState(false);
  const updateListenerRef = useRef(null);
  const errorListenerRef = useRef(null);

  const router = useRouter();

  const buzz = () => Haptics.selectionAsync().catch(()=>{});

  const handleClose = () => {
    if (blocking) return; // don't close if we’re hard-blocking
    buzz();
    onClose?.();
  };

  const handleSignOut = async () => {
    if (busy) return; // debounce rapid taps
    try {
      setBusy(true);
      buzz();
      if (onSignOut) {
        await onSignOut(); // parent handles auth + navigation
      } else {
        await supabase.auth.signOut(); // fallback to built-in logout
        router.replace?.(loginHref);
      }
      // Ensure modal closes after logout even if blocking
      onClose?.();
    } catch (e) {
      console.warn("Sign out failed:", e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  // ---- IAP helpers (mirrors subscriptions.js) ----
  const getUserSessionToken = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token || "";
  };

  const fetchSubscriptionsCompat = async (skus) => {
    try {
      const res = await RNIap.getSubscriptions({ skus });
      if (Array.isArray(res)) return res;
    } catch {}
    const res2 = await RNIap.getSubscriptions(skus);
    return Array.isArray(res2) ? res2 : [];
  };

  const pickOfferToken = (product) => {
    const offers = product?.subscriptionOfferDetails || [];
    return offers.length ? (offers[0]?.offerToken || null) : null;
  };

  useEffect(() => {
    if (!visible || !IS_ANDROID) return;

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
        console.warn("IAP init error", e);
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
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({
                platform: "google",
                productId: purchase.productId,
                purchaseToken: purchase.purchaseToken,
                transactionId: purchase.transactionId,
              }),
            });
          } catch (err) {
            console.warn("Verify failed:", err);
          }
        }

        try { await RNIap.finishTransaction(purchase, true); } catch {}
        Alert.alert("Success", "Your subscription is active.");
        setBusy(false);
        onClose?.(); // close paywall after success
      } catch (err) {
        console.warn("verify/finish error", err);
        setBusy(false);
        Alert.alert("Verification error", "Purchase made, but we could not verify it. Try again or restore from Settings.");
      }
    });

    errorListenerRef.current = RNIap.purchaseErrorListener((err) => {
      setBusy(false);
      if (err && !/user.*cancell?ed/i.test(err?.message || "")) {
        Alert.alert("Purchase failed", err.message || "Please try again.");
      }
      console.warn("IAP error", err);
    });

    return () => {
      mounted = false;
      try { updateListenerRef.current?.remove?.(); } catch {}
      try { errorListenerRef.current?.remove?.(); } catch {}
      try { RNIap.endConnection(); } catch {}
    };
  }, [visible]);

  const buy = async (productId) => {
    if (!IS_ANDROID) {
      Alert.alert("Android only", "Purchases are handled via Google Play on Android.");
      return;
    }
    try {
      if (!iapReady) {
        Alert.alert("Please wait", "Store not ready yet. Try again in a moment.");
        return;
      }
      setBusy(true);
      buzz();

      // Ensure latest details
      let details = subs.find(p => p.productId === productId);
      if (!details) {
        const fresh = await fetchSubscriptionsCompat([productId]);
        details = Array.isArray(fresh) ? fresh.find(p => p.productId === productId) : null;
      }
      if (!details) {
        setBusy(false);
        Alert.alert("Unavailable", "This plan is not available right now for your account.");
        return;
      }

      const offerToken = pickOfferToken(details);
      if (!offerToken) {
        setBusy(false);
        Alert.alert(
          "Offer not ready",
          "No active base plan/offer is available. Check Play Console base plans & offers for your tester account/region."
        );
        return;
      }

      await RNIap.requestSubscription({
        sku: details.productId,
        subscriptionOffers: [{ sku: details.productId, offerToken }],
      });
    } catch (e) {
      setBusy(false);
      console.warn("requestSubscription error", e);
      Alert.alert("Purchase error", e?.message || "Unable to start purchase.");
    }
  };

  // Use formatted price from Play Store if available, otherwise fallback
  const getFormattedPrice = (productId, fallback) => {
    const p = subs.find(s => s.productId === productId);
    const phase = p?.subscriptionOfferDetails?.[0]?.pricingPhases?.pricingPhaseList?.[0];
    return phase?.formattedPrice || fallback;
  };

  // Ensure the Android navigation bar is always white with dark buttons
  useEffect(() => {
    if (!IS_ANDROID) return;
    (async () => {
      try {
        await NavigationBar.setBackgroundColorAsync("#ffffff");
        await NavigationBar.setBorderColorAsync?.("#ffffff");
        await NavigationBar.setButtonStyleAsync("dark");
      } catch (e) {
        console.warn("NavigationBar style error", e);
      }
    })();
  }, [visible]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleClose}>
      {/* Make status bar fully transparent */}
      <StatusBar translucent backgroundColor="transparent" barStyle="light-content" />
      {/* Removed BlurView to keep full transparency */}
      {/* <BlurView intensity={10} tint="systemThinMaterialLight" style={{ flex: 1 }} pointerEvents="none" /> */}
      <View style={styles.overlay} pointerEvents="box-none">
        <View style={styles.modal}>
          <View style={styles.iconContainer}><Crown size={48} color="#f59e0b" /></View>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.message}>{message}</Text>

          {/* Plans inside modal (replaces "Choose a Plan") */}
          <View style={styles.planGrid}>
            <TouchableOpacity
              style={[
                styles.planCard,
                (busy || !IS_ANDROID || !iapReady) && { opacity: 0.7 }
              ]}
              onPress={() => buy(WEEKLY_PRODUCT_ID)}
              disabled={busy || !IS_ANDROID || !iapReady}
              activeOpacity={0.7}
            >
              <Text style={styles.planTitle}>Weekly</Text>
              <Text style={styles.planPrice}>{getFormattedPrice(WEEKLY_PRODUCT_ID, "£3.49")}</Text>
              <Text style={styles.planSubtitle}>per week</Text>
              <Text style={styles.planNote}>inc. VAT</Text>
              {!IS_ANDROID && <Text style={styles.androidOnly}>Android only</Text>}
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.planCard,
                styles.planCardPopular,
                (busy || !IS_ANDROID || !iapReady) && { opacity: 0.7 }
              ]}
              onPress={() => buy(MONTHLY_PRODUCT_ID)}
              disabled={busy || !IS_ANDROID || !iapReady}
              activeOpacity={0.7}
            >
              <View style={styles.popularBadge}>
                <Text style={styles.popularBadgeText}>Most Popular</Text>
              </View>
              <Text style={styles.planTitle}>Monthly</Text>
              <Text style={styles.planPrice}>{getFormattedPrice(MONTHLY_PRODUCT_ID, "£5.99")}</Text>
              <Text style={styles.planSubtitle}>per month</Text>
              <Text style={styles.planNote}>inc. VAT</Text>
              {!IS_ANDROID && <Text style={styles.androidOnly}>Android only</Text>}
            </TouchableOpacity>
          </View>

          <Text style={styles.legalText}>Subscriptions are billed via Google Play. Cancel anytime.</Text>

          {/* Log out always available, even when blocking */}
          <TouchableOpacity
            style={[styles.logoutBtn, busy && { opacity: 0.7 }]}
            onPress={handleSignOut}
            activeOpacity={0.9}
            disabled={busy}
          >
            <LogOut size={18} color="#fff" style={{ marginRight: 8 }} />
            <Text style={styles.logoutText}>Log out</Text>
          </TouchableOpacity>

          {!blocking && (
            <TouchableOpacity style={styles.closeButton} onPress={handleClose} activeOpacity={0.9} disabled={busy}>
              <Text style={styles.closeButtonText}>Maybe Later</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { position: "absolute", inset: 0, justifyContent: "center", alignItems: "center", padding: 20 },
  modal: {
    backgroundColor: CARD,
    borderRadius: 20,
    padding: 24,
    width: "100%",
    maxWidth: 520,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: "center",
    // Stronger elevation/shadow
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOpacity: 0.25,
        shadowRadius: 28,
        shadowOffset: { width: 0, height: 12 },
      },
      android: {
        elevation: 24,
      },
    }),
  },
  iconContainer: { width: 80, height: 80, borderRadius: 40, backgroundColor: "rgba(245,158,11,0.1)", alignItems: "center", justifyContent: "center", marginBottom: 16 },
  title: { fontSize: 22, fontWeight: "900", color: TEXT, textAlign: "center", marginBottom: 8 },
  message: { fontSize: 16, color: MUTED, textAlign: "center", lineHeight: 22, marginBottom: 20 },

  // NEW: plan cards
  planGrid: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 12,
    width: "100%",
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
  planTitle: { color: TEXT, fontWeight: "800", fontSize: 16, marginBottom: 8 },
  planPrice: { color: TEXT, fontWeight: "900", fontSize: 20, marginBottom: 4 },
  planSubtitle: { color: MUTED, fontSize: 14, marginBottom: 4 },
  planNote: { color: MUTED, fontSize: 12, fontWeight: "500" },
  androidOnly: { color: "#dc2626", fontSize: 11, fontWeight: "600", marginTop: 4, textAlign: "center" },

  // Replaces previous signOutBtn/signOutText
  logoutBtn: {
    width: "100%",
    backgroundColor: "#dc2626",
    borderRadius: 14,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#dc2626",
    shadowOpacity: 0.2,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
    marginTop: 4,
  },
  logoutText: { color: "#fff", fontWeight: "900" },

  // Secondary action to match app style
  closeButton: {
    marginTop: 10,
    backgroundColor: "#eef2f7",
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: "center",
    width: "100%",
  },
  closeButtonText: { color: TEXT, fontSize: 14, fontWeight: "800" },

  // Legal text
  legalText: { color: MUTED, fontSize: 12, textAlign: "center", marginTop: 6, marginBottom: 8 },
});