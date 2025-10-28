// app/_layout.js  (robust push setup, Android channel, safe routing, diagnostics)
// No template literals anywhere.

import "../polyfills/auth-session-shim";
import "react-native-gesture-handler";
import "react-native-reanimated";

import React, { useEffect, useState } from "react";
import { View, StatusBar, Platform, LogBox, AppState, Alert } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { Stack, useRouter } from "expo-router";
import * as NavigationBar from "expo-navigation-bar";
import * as SystemUI from "expo-system-ui";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import Constants from "expo-constants";
import { supabase } from "../lib/supabase";

/* ========================
   DEBUG
======================== */
const TAG = "[PUSHDBG]";
function dbg() {
  try { console.warn.apply(console, [TAG].concat([].slice.call(arguments))); } catch (_) {}
}
LogBox.ignoreLogs(["Setting a timer", "AsyncStorage"]);
dbg("FILE LOADED: app/_layout.js");

/* ========================
   ANDROID CHANNEL
======================== */
const ANDROID_CHANNEL_ID = "alerts"; // must match server channelId

async function ensureAndroidChannel() {
  if (Platform.OS !== "android") return;
  try {
    // Create or update high-importance channel. Do NOT delete existing channel in production.
    dbg("ensureAndroidChannel: set channel 'alerts' (MAX)");
    await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
      name: "Alerts",
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [150, 120, 150, 120, 220],
      sound: "default",
      enableVibrate: true,
      lightColor: "#2a86ff",
      showBadge: true,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    });
    const ch = await Notifications.getNotificationChannelAsync(ANDROID_CHANNEL_ID);
    dbg("ensureAndroidChannel OK:", ch ? ch.id : "(null)");
  } catch (e) {
    dbg("ensureAndroidChannel ERROR:", e && e.message ? e.message : String(e));
  }
}

/* ========================
   Notification handler
======================== */
Notifications.setNotificationHandler({
  handleNotification: async function () {
    dbg("handler() → {alert:true,sound:true,badge:false}");
    return {
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    };
  },
});

/* ========================
   Helpers
======================== */
function safeLower(s) {
  return typeof s === "string" ? s.toLowerCase() : "";
}

function routeForNotificationData(data) {
  dbg("routeForNotificationData IN:", data);
  if (!data || !data.type) return { pathname: "/quotes/index", params: {} };

  const t = safeLower(String(data.type));
  if (t === "support_message" && data.ticket_id) {
    return { pathname: "/settings/help/[ticketid]", params: { ticketid: String(data.ticket_id) } };
  }
  if (t === "quote_created") {
    if (data.quote_id) return { pathname: "/quotes/[id]", params: { id: String(data.quote_id) } };
    return { pathname: "/quotes/index", params: {} };
  }
  return { pathname: "/quotes/index", params: {} };
}

async function dumpNotificationState(where) {
  try {
    const perm = await Notifications.getPermissionsAsync();
    const channels = Platform.OS === "android" ? await Notifications.getNotificationChannelsAsync() : [];
    const activeCh = Platform.OS === "android" ? await Notifications.getNotificationChannelAsync(ANDROID_CHANNEL_ID) : null;
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    const presented = await Notifications.getPresentedNotificationsAsync();

    dbg("=== NOTIF STATE DUMP @", where, "===");
    dbg("Permissions:", perm);
    if (Platform.OS === "android") {
      dbg("All channels:", channels);
      dbg("Active channel:", activeCh);
    }
    dbg("Scheduled local count:", scheduled && scheduled.length ? scheduled.length : 0);
    dbg("Presented count:", presented && presented.length ? presented.length : 0);
    if (presented && presented.length) {
      const last = presented[presented.length - 1];
      dbg("Last presented summary:", {
        id: last && last.request ? last.request.identifier : null,
        title: last && last.request && last.request.content ? last.request.content.title : null,
        body: last && last.request && last.request.content ? last.request.content.body : null,
        data: last && last.request && last.request.content ? last.request.content.data : null,
      });
    }
    dbg("=== /NOTIF STATE DUMP ===");
  } catch (e) {
    dbg("dumpNotificationState ERROR:", e && e.message ? e.message : String(e));
  }
}

/**
 * Mirror a received push to a local banner when app is foregrounded.
 * Also adds Android DND/priority-mode fallback via Alert.
 */
async function mirrorForegroundBanner(content, data) {
  const title = content && content.title ? content.title : null;
  const body = content && content.body ? content.body : null;
  const mirrored = data && data.__mirrored_local ? true : false;
  if (mirrored) {
    dbg("mirror: skip (already mirrored)");
    return;
  }
  const typeText = String(data && data.type ? data.type : "update").replace(/_/g, " ");

  // Detect Android DND / Priority Only
  var inDnd = false;
  try {
    const perm = await Notifications.getPermissionsAsync();
    // interruptionFilter: 2 === ALL (not in DND). Others mean DND/priority.
    inDnd = Platform.OS === "android" && perm && perm.android && perm.android.interruptionFilter !== 2;
  } catch (_) {}

  if (Platform.OS === "android") {
    dbg("mirror: Android → schedule local banner on channel: alerts");
    await Notifications.scheduleNotificationAsync({
      content: {
        title: title || "TradeMate",
        body: body || ("New " + typeText),
        data: Object.assign({}, data || {}, { __mirrored_local: 1 }),
        channelId: ANDROID_CHANNEL_ID,
        priority: Notifications.AndroidNotificationPriority.MAX,
        sound: "default",
        sticky: false,
      },
      trigger: null,
    });

    if (inDnd) {
      dbg("mirror: DND active → show in-app Alert fallback");
      Alert.alert(title || "TradeMate", body || ("New " + typeText));
    }
    return;
  }

  // iOS: mirror only for silent (data-only) pushes
  if (!title && !body) {
    dbg("mirror: iOS data-only → schedule local banner");
    await Notifications.scheduleNotificationAsync({
      content: {
        title: "TradeMate",
        body: "New " + typeText,
        data: Object.assign({}, data || {}, { __mirrored_local: 1 }),
      },
      trigger: null,
    });
  } else {
    dbg("mirror: iOS system banner handled by setNotificationHandler()");
  }
}

/* ========================
   Register Push + Save
======================== */
async function registerForPushAndSave() {
  try {
    const projectId =
      (Constants && Constants.expoConfig && Constants.expoConfig.extra && Constants.expoConfig.extra.eas && Constants.expoConfig.extra.eas.projectId) ||
      (Constants && Constants.easConfig && Constants.easConfig.projectId) ||
      "57f55544-8d0b-4f50-b45e-57948ba02dfc";

    dbg("registerForPushAndSave start", { platform: Platform.OS, projectId: projectId, isDevice: Device.isDevice });
    if (!Device.isDevice) {
      dbg("registerForPushAndSave: not a physical device");
      return null;
    }

    // Permissions (include Android 13+)
    const perm = await Notifications.getPermissionsAsync();
    var status = (perm && perm.status) ? perm.status : "undetermined";
    if (status !== "granted") {
      const ask = await Notifications.requestPermissionsAsync({
        ios: { allowAlert: true, allowBadge: true, allowSound: true },
        android: { allowAlert: true, allowBadge: true, allowSound: true },
      });
      status = ask && ask.status ? ask.status : "denied";
    }
    if (status !== "granted") {
      dbg("registerForPushAndSave: permission denied", status);
      return null;
    }

    // Token
    const tokenResp = await Notifications.getExpoPushTokenAsync({ projectId: projectId });
    const token = tokenResp && tokenResp.data ? tokenResp.data : null;
    dbg("registerForPushAndSave: token", token || "(none)");
    if (!token) return null;

    // Save to Supabase profile
    const auth = await supabase.auth.getUser();
    const userId = auth && auth.data && auth.data.user ? auth.data.user.id : null;
    if (!userId) {
      dbg("registerForPushAndSave: no user (saved only locally)");
      return token;
    }

    const prof = await supabase.from("profiles").select("push_token").eq("id", userId).maybeSingle();
    const current = prof && prof.data ? prof.data.push_token : null;
    if (current !== token) {
      await supabase.from("profiles").update({ push_token: token }).eq("id", userId);
      dbg("registerForPushAndSave: token saved to profiles");
    } else {
      dbg("registerForPushAndSave: token unchanged");
    }
    return token;
  } catch (e) {
    dbg("registerForPushAndSave ERROR:", e && e.message ? e.message : String(e));
    return null;
  }
}

/* ========================
   Root Layout
======================== */
export default function RootLayout() {
  const router = useRouter();
  const [appFullyReady] = useState(true);

  useEffect(function () {
    dbg("MOUNT RootLayout");
    const sub = AppState.addEventListener("change", function (s) {
      dbg("AppState:", s);
      dumpNotificationState("AppState:" + String(s));
    });
    return function () { try { sub.remove(); } catch (_) {} };
  }, []);

  // Base UI styling
  useEffect(function () {
    StatusBar.setBarStyle("dark-content", false);
    if (Platform.OS === "android") {
      NavigationBar.setBackgroundColorAsync("#ffffff");
      NavigationBar.setButtonStyleAsync("dark");
    }
    SystemUI.setBackgroundColorAsync("#ffffff");
  }, []);

  // Channel + diagnostics
  useEffect(function () {
    (async function () {
      await ensureAndroidChannel();
      await dumpNotificationState("after ensureAndroidChannel");
    })();
  }, []);

  // Register push on boot
  useEffect(function () {
    if (!appFullyReady) return;
    (async function () {
      await registerForPushAndSave();
      await dumpNotificationState("after registerForPushAndSave");
    })();
  }, [appFullyReady]);

  // Re-register when auth changes
  useEffect(function () {
    const sub = supabase.auth.onAuthStateChange(async function (event, session) {
      dbg("auth change:", { event: event, user: session && session.user ? true : false });
      if (session && session.user) {
        await registerForPushAndSave();
        await dumpNotificationState("after auth change re-register");
      }
    });
    return function () {
      try { sub.data && sub.data.subscription && sub.data.subscription.unsubscribe(); } catch (_) {}
    };
  }, []);

  // Foreground receipt
  useEffect(function () {
    const recv = Notifications.addNotificationReceivedListener(async function (notification) {
      const req = notification && notification.request ? notification.request : null;
      const content = req && req.content ? req.content : {};
      const data = content && content.data ? content.data : {};
      dbg("onReceive:", {
        id: req && req.identifier ? req.identifier : null,
        title: content.title,
        body: content.body,
        data: data,
      });
      await dumpNotificationState("onReceive BEFORE mirror");
      await mirrorForegroundBanner(content, data);
      await dumpNotificationState("onReceive AFTER mirror");
    });
    return function () { try { recv.remove(); } catch (_) {} };
  }, []);

  // Tap handler + cold start routing
  useEffect(function () {
    if (!appFullyReady) return;

    const lastHandled = { current: null };

    const tapSub = Notifications.addNotificationResponseReceivedListener(async function (response) {
      const req = response && response.notification ? response.notification.request : null;
      const id = req && req.identifier ? String(req.identifier) : "";
      if (id && lastHandled.current === id) return;
      lastHandled.current = id;

      const content = req && req.content ? req.content : {};
      const data = content && content.data ? content.data : {};
      dbg("onTap content:", { title: content.title, body: content.body, data: data });

      const target = routeForNotificationData(data);
      dbg("onTap route:", target);
      await dumpNotificationState("onTap BEFORE route");

      if (target && target.pathname) {
        router.replace({ pathname: target.pathname, params: target.params || {} });
      }
    });

    (async function () {
      await dumpNotificationState("cold start BEFORE last");
      const last = await Notifications.getLastNotificationResponseAsync();
      if (last && last.notification && last.notification.request) {
        const req = last.notification.request;
        const id = String(req.identifier || "");
        if (id && lastHandled.current !== id) {
          lastHandled.current = id;
          const content = req.content || {};
          const data = content.data || {};
          const target = routeForNotificationData(data);
          dbg("cold start → navigating", target);
          if (target && target.pathname) {
            router.replace({ pathname: target.pathname, params: target.params || {} });
          }
        }
      }
      await dumpNotificationState("cold start AFTER last");
    })();

    return function () { try { tapSub.remove(); } catch (_) {} };
  }, [appFullyReady, router]);

  return (
    <SafeAreaProvider>
      <View style={{ flex: 1, backgroundColor: "#ffffff" }}>
        <Stack screenOptions={{ headerShown: false }} />
      </View>
    </SafeAreaProvider>
  );
}