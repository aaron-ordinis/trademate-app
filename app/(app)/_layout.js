// app/(app)/_layout.tsx
import React, { useCallback, useEffect, useState } from "react";
import { Platform, StatusBar, PlatformColor, View, ActivityIndicator, BackHandler } from "react-native";
import { Stack, usePathname, useRouter } from "expo-router";
import * as NavigationBar from "expo-navigation-bar";
import { supabase } from "../../lib/supabase";
import { getPremiumStatus } from "../../lib/premium";
import PaywallModal from "../../components/PaywallModal";

const sysBG =
  Platform.OS === "ios"
    ? PlatformColor?.("systemGray6") ?? "#EEF2F6"
    : PlatformColor?.("@android:color/system_neutral2_100") ?? "#EEF2F6";

const BG = sysBG;
const BG_HEX = "#EEF2F6";
const TAB_BAR_COLOR = "#FFFFFF";
const BRAND = "#2a86ff";

// Robust path check (no regex footguns)
const isSafePath = (p) =>
  p.startsWith("/(app)/account") ||       // Plan & Billing
  p.startsWith("/(app)/billing") ||       // Any billing routes
  p.startsWith("/(app)/trial-expired") || // Dedicated trial-expired screen
  p.startsWith("/(auth)/");               // Login / Register / Reset

export default function AppGroupLayout() {
  const router = useRouter();
  const pathname = usePathname() || "";

  const [checking, setChecking] = useState(true);
  const [blocked, setBlocked]   = useState(false);
  const [forceHide, setForceHide] = useState(false);

  useEffect(() => {
    StatusBar.setBarStyle("dark-content");
    if (Platform.OS === "android") {
      StatusBar.setBackgroundColor(BG_HEX, true);
      (async () => {
        try {
          await NavigationBar.setBackgroundColorAsync("#FFFFFF"); // ✅ Ensure white
          await NavigationBar.setButtonStyleAsync("dark");
          await NavigationBar.setDividerColorAsync("transparent");
          await NavigationBar.setBehaviorAsync("inset-swipe");
          await NavigationBar.setVisibilityAsync("visible");
        } catch {}
      })();
    }
  }, []);

  const checkGate = useCallback(async () => {
    try {
      setChecking(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setBlocked(false); return; }

      const { data: profile } = await supabase
        .from("profiles")
        .select("trial_ends_at, plan_tier, plan_status")
        .eq("id", user.id)
        .maybeSingle();

      const status = getPremiumStatus(profile || {});
      setBlocked(!!status.isBlocked);
    } catch {
      setBlocked(false);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    checkGate();
    const sub = supabase.auth.onAuthStateChange(() => checkGate());
    // @ts-ignore
    return () => sub?.data?.subscription?.unsubscribe?.();
  }, [checkGate]);

  // Reset forceHide when on a safe path
  useEffect(() => {
    if (isSafePath(pathname) && forceHide) setForceHide(false);
  }, [pathname, forceHide]);

  const suppressPaywall = isSafePath(pathname);
  const paywallVisible = !forceHide && blocked && !suppressPaywall;

  // Block Android back only when paywall visible
  useEffect(() => {
    if (!paywallVisible) return;
    const onBack = () => true;
    const sub = BackHandler.addEventListener("hardwareBackPress", onBack);
    return () => sub.remove();
  }, [paywallVisible]);

  if (checking) {
    return (
      <View style={{ flex: 1, backgroundColor: BG, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={BRAND} />
      </View>
    );
  }

  return (
    <>
      <StatusBar translucent={false} backgroundColor={BG_HEX} barStyle="dark-content" />

      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: BG },
          detachPreviousScreen: false,
        }}
      >
        <Stack.Screen
          name="quotes/create"
          options={{
            presentation: "transparentModal",
            animation: "fade",
            headerShown: false,
            contentStyle: { backgroundColor: "transparent" },
            gestureEnabled: true,
          }}
        />
        <Stack.Screen
          name="invoices/wizard"
          options={{
            presentation: "transparentModal",
            animation: "fade",
            headerShown: false,
            contentStyle: { backgroundColor: "transparent" },
            gestureEnabled: true,
          }}
        />
      </Stack>

      {/* SINGLE global paywall */}
      <PaywallModal
        visible={paywallVisible}
        blocking
        title="Trial Ended"
        message={
          "Your free trial has ended.\nTo continue using TradeMate, you need an active subscription.\nChoose a monthly or yearly plan to unlock the app."
        }
        onSubscribe={() => {
          setForceHide(true);
          router.push("/(app)/account");
        }}
      />
    </>
  );
}