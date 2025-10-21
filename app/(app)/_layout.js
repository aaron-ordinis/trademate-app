// app/(app)/_layout.tsx
import React, { useCallback, useEffect, useState } from "react";
import {
  Platform,
  StatusBar,
  PlatformColor,
  View,
  BackHandler,
} from "react-native";
import { Stack, usePathname, useRouter } from "expo-router";
import * as NavigationBar from "expo-navigation-bar";
import * as SystemUI from "expo-system-ui";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { supabase } from "../../lib/supabase";
import { getPremiumStatus } from "../../lib/premium";
import PaywallModal from "../../components/PaywallModal";

const sysBG =
  Platform.OS === "ios"
    ? PlatformColor?.("systemGray6") ?? "#EEF2F6"
    : PlatformColor?.("@android:color/system_neutral2_100") ?? "#EEF2F6";

const BG = sysBG;

// Only allow these paths to bypass the paywall
const isSafePath = (p) =>
  p.startsWith("/(app)/account") ||
  p.startsWith("/(app)/billing") ||
  p.startsWith("/(app)/trial-expired") ||
  p.startsWith("/(auth)/");

export default function AppGroupLayout() {
  const router = useRouter();
  const pathname = usePathname() || "";

  const [checking, setChecking] = useState(true);
  const [blocked, setBlocked] = useState(false);
  const [forceHide, setForceHide] = useState(false);
  const [layoutReady, setLayoutReady] = useState(false);
  const [fullyMounted, setFullyMounted] = useState(false);

  // System UI colors
  useEffect(() => {
    const setAppColors = async () => {
      try {
        await SystemUI.setBackgroundColorAsync("#ffffff");
        StatusBar.setBarStyle("dark-content", true);
        if (Platform.OS === "android") {
          StatusBar.setBackgroundColor("#ffffff", true);
          await NavigationBar.setBackgroundColorAsync("#FFFFFF");
          await NavigationBar.setButtonStyleAsync("dark");
          await NavigationBar.setBehaviorAsync("inset-swipe");
          await NavigationBar.setVisibilityAsync("visible");
        }
      } catch (err) {
        console.log("App layout color setting error:", err);
      }
    };
    setAppColors();
  }, []);

  // Check paywall gate
  const checkGate = useCallback(async () => {
    try {
      setChecking(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setBlocked(false);
        return;
      }
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
    return () => sub?.data?.subscription?.unsubscribe?.();
  }, [checkGate]);

  // Mark layout as ready → then fully mounted
  useEffect(() => {
    if (!checking) {
      const t1 = setTimeout(() => {
        setLayoutReady(true);
        const t2 = setTimeout(() => setFullyMounted(true), 150);
        return () => clearTimeout(t2);
      }, 50);
      return () => clearTimeout(t1);
    }
  }, [checking]);

  // Reset forceHide when navigating to safe routes
  useEffect(() => {
    if (isSafePath(pathname) && forceHide) setForceHide(false);
  }, [pathname, forceHide]);

  const suppressPaywall = isSafePath(pathname);
  const paywallVisible = !forceHide && blocked && !suppressPaywall;

  // Disable Android back while paywall visible
  useEffect(() => {
    if (!paywallVisible) return;
    const onBack = () => true;
    const sub = BackHandler.addEventListener("hardwareBackPress", onBack);
    return () => sub.remove();
  }, [paywallVisible]);

  // Skeleton while mounting
  if (!layoutReady || !fullyMounted) {
    return <View style={{ flex: 1, backgroundColor: "#ffffff" }} />;
  }

  return (
    <>
      <StatusBar translucent={false} backgroundColor="#ffffff" barStyle="dark-content" />

      <SafeAreaProvider style={{ backgroundColor: "#ffffff" }}>
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: "#ffffff" },
            presentation: "card",
            animation: "none",
          }}
        >
          <Stack.Screen name="onboarding" options={{ headerShown: false }} />
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="quotes" options={{ headerShown: false }} />
          <Stack.Screen name="jobs" options={{ headerShown: false }} />
          <Stack.Screen name="invoices" options={{ headerShown: false }} />
          <Stack.Screen name="settings" options={{ headerShown: false }} />
        </Stack>
      </SafeAreaProvider>

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