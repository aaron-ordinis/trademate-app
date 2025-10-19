// app/(app)/_layout.tsx
import React, { useCallback, useEffect, useState } from "react";
import { Platform, StatusBar, PlatformColor, View, BackHandler } from "react-native";
import { Stack, usePathname, useRouter } from "expo-router";
import * as NavigationBar from "expo-navigation-bar";
import { supabase } from "../../lib/supabase";
import { getPremiumStatus } from "../../lib/premium";
import PaywallModal from "../../components/PaywallModal";
import { SafeAreaProvider } from "react-native-safe-area-context";
import * as SystemUI from "expo-system-ui";

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
  const [blocked, setBlocked] = useState(false);
  const [forceHide, setForceHide] = useState(false);
  const [layoutReady, setLayoutReady] = useState(false);
  const [fullyMounted, setFullyMounted] = useState(false);

  useEffect(() => {
    const setAppColors = async () => {
      try {
        await SystemUI.setBackgroundColorAsync('#ffffff');
        StatusBar.setBarStyle('dark-content', true);
        
        if (Platform.OS === 'android') {
          StatusBar.setBackgroundColor('#ffffff', true);
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
      } catch (error) {
        console.log('App layout color setting error:', error);
      }
    };

    setAppColors();
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
    return () => sub?.data?.subscription?.unsubscribe?.();
  }, [checkGate]);

  // Mark layout as ready when checking is complete
  useEffect(() => {
    if (!checking) {
      const timer = setTimeout(() => {
        setLayoutReady(true);
        // Add additional delay to ensure all child components are ready
        setTimeout(() => {
          setFullyMounted(true);
        }, 150);
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [checking]);

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

  // Don't render anything until fully mounted
  if (!layoutReady || !fullyMounted) {
    return (
      <View style={{ flex: 1, backgroundColor: '#ffffff' }}>
      </View>
    );
  }

  return (
    <>
      <StatusBar translucent={false} backgroundColor="#ffffff" barStyle="dark-content" />

      <SafeAreaProvider style={{ backgroundColor: '#ffffff' }}>
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: '#ffffff' },
            presentation: 'card',
            animation: 'none',
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