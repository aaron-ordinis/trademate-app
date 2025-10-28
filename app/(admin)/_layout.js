// app/(admin)/_layout.js
import "react-native-gesture-handler";
import "react-native-reanimated";

import React, { useEffect, useState } from "react";
import { View, StatusBar, ActivityIndicator, Text, Alert } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { Stack, useRouter } from "expo-router";
import * as NavigationBar from "expo-navigation-bar";
import * as SystemUI from "expo-system-ui";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { supabase } from "../../lib/supabase";

/* =====================================================
   PUSH NOTIFICATION SETUP (ADMIN)
===================================================== */

// Show notifications in foreground (optional)
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/**
 * Map push payload → Admin route.
 * Adjust if your paths differ:
 * - Admin notifications list:  "/(admin)/notifications"
 * - Admin support ticket:      "/(admin)/support/[ticket_id]"
 * - Admin quote detail:        "/(admin)/quotes/[id]"
 */
function routeForNotificationData(data) {
  const fallback = { pathname: "/(admin)/notifications", params: {} };
  const t = String(data?.type || "").toLowerCase();

  if (t === "support_message") {
    if (data?.ticket_id) {
      return {
        pathname: "/(admin)/support/[ticket_id]",
        params: { ticket_id: String(data.ticket_id) },
      };
    }
    return fallback;
  }

  if (t === "quote_created") {
    if (data?.quote_id) {
      return { pathname: "/(admin)/quotes/[id]", params: { id: String(data.quote_id) } };
    }
    return fallback;
  }

  return fallback;
}

async function ensureAndroidChannel() {
  try {
    // Set up the "alerts" channel to match what your Edge Function uses
    await Notifications.setNotificationChannelAsync("alerts", {
      name: "Alerts",
      importance: Notifications.AndroidImportance.HIGH,
      sound: "default",
    });
  } catch (e) {
    console.log("[admin channel] error:", e?.message || e);
  }
}

async function registerForPushAndSave() {
  try {
    if (!Device.isDevice) return null;

    let perm = await Notifications.getPermissionsAsync();
    let status = String(perm?.status || "undetermined");
    if (status !== "granted") {
      const ask = await Notifications.requestPermissionsAsync();
      status = String(ask?.status || "denied");
    }
    if (status !== "granted") return null;

    const tokenData = await Notifications.getExpoPushTokenAsync();
    const token = tokenData?.data ? String(tokenData.data) : null;
    if (!token) return null;

    const { data: userRes } = await supabase.auth.getUser();
    const userId = userRes?.user?.id || null;
    if (userId) {
      // save to profiles.push_token (make sure the column exists; SQL below)
      await supabase.from("profiles").update({ push_token: token }).eq("id", userId);
    }
    return token;
  } catch (e) {
    console.log("[admin push register] error:", e?.message || e);
    return null;
  }
}

/* =====================================================
   ADMIN ROOT LAYOUT + GUARD
===================================================== */

export default function AdminRootLayout() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [allowed, setAllowed] = useState(false);

  // Force white chrome
  useEffect(() => {
    StatusBar.setBarStyle("dark-content", false);
    if (Platform.OS === "android") {
      NavigationBar.setBackgroundColorAsync?.("#ffffff");
      NavigationBar.setButtonStyleAsync?.("dark");
      NavigationBar.setBorderColorAsync?.("#ffffff");
    }
    SystemUI.setBackgroundColorAsync?.("#ffffff");
  }, []);

  // 🔒 Admin guard using your schema: is_admin OR admin_owner
  useEffect(() => {
    (async () => {
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const user = sessionData?.session?.user;
        if (!user) {
          router.replace("/(app)/(tabs)/quotes");
          return;
        }

        const { data: prof, error } = await supabase
          .from("profiles")
          .select("is_admin, admin_owner")
          .eq("id", user.id)
          .single();

        if (error || !prof) {
          Alert.alert("Access denied", "Unable to verify your admin status.");
          router.replace("/(app)/(tabs)/quotes");
          return;
        }

        const isAdmin = prof.is_admin === true || prof.admin_owner === true;
        if (!isAdmin) {
          Alert.alert("Access denied", "You are not authorized to access Admin.");
          router.replace("/(app)/(tabs)/quotes");
          return;
        }

        setAllowed(true);
      } catch (e) {
        console.log("[admin guard error]", e);
        router.replace("/(app)/(tabs)/quotes");
      } finally {
        setChecking(false);
      }
    })();
  }, [router]);

  // Register for push + channel
  useEffect(() => {
    if (!allowed) return;
    ensureAndroidChannel();
    registerForPushAndSave();
  }, [allowed]);

  // Handle taps (foreground/background) + cold start
  useEffect(() => {
    if (!allowed) return;

    const lastHandledIdRef = { current: null };

    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      try {
        const req = response?.notification?.request;
        const id = req?.identifier ? String(req.identifier) : "";
        if (id && lastHandledIdRef.current === id) return;
        lastHandledIdRef.current = id;

        const content = req?.content || {};
        const data = content?.data || {};
        const target = routeForNotificationData(data);
        if (target?.pathname) router.replace(target);
      } catch (e) {
        console.log("[admin push tap] error:", e?.message || e);
      }
    });

    (async () => {
      try {
        const last = await Notifications.getLastNotificationResponseAsync();
        const req = last?.notification?.request;
        if (!req) return;

        const id = req?.identifier ? String(req.identifier) : "";
        if (id && lastHandledIdRef.current === id) return;
        lastHandledIdRef.current = id;

        const data = req?.content?.data || {};
        const target = routeForNotificationData(data);
        if (target?.pathname) router.replace(target);
      } catch (e) {
        console.log("[admin cold tap] error:", e?.message || e);
      }
    })();

    return () => {
      try { sub?.remove(); } catch {}
    };
  }, [allowed, router]);

  useEffect(() => {
    async function registerPushToken() {
      const { status } = await Notifications.requestPermissionsAsync();
      if (status !== "granted") return;
      const tokenData = await Notifications.getExpoPushTokenAsync();
      const token = tokenData.data;
      // Save to profile if logged in
      const { data: auth } = await supabase.auth.getUser();
      const user = auth?.user;
      if (user && token) {
        await supabase.from("profiles").update({ push_token: token }).eq("id", user.id);
      }
    }
    registerPushToken();
  }, []);

  if (checking) {
    return (
      <SafeAreaProvider>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#fff" }}>
          <ActivityIndicator size="large" color="#2a86ff" />
          <Text style={{ marginTop: 10, color: "#6b7280" }}>Checking admin access…</Text>
        </View>
      </SafeAreaProvider>
    );
  }

  if (!allowed) return null;

  return (
    <SafeAreaProvider>
      <View style={{ flex: 1, backgroundColor: "#ffffff" }}>
        <Stack
          screenOptions={{
            headerShown: false,
            animation: "none",
            gestureEnabled: false,
            contentStyle: { backgroundColor: "#ffffff" },
          }}
        />
      </View>
    </SafeAreaProvider>
  );
}