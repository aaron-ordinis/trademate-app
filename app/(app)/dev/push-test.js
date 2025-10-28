// app/(app)/dev/push-test.js
import React, { useState } from "react";
import { View, Text, TouchableOpacity, Platform } from "react-native";
import * as Notifications from "expo-notifications";
import { supabase } from "../../../lib/supabase";

export default function PushTest() {
  const [out, setOut] = useState("");

  async function sendSelfPush() {
    try {
      setOut("Resolving user…");
      const { data: { user }, error } = await supabase.auth.getUser();
      if (error) throw error;
      if (!user) throw new Error("No signed-in user");
      setOut((s) => s + "\nUser: " + user.id);

      // notify_user → push to yourself
      setOut((s) => s + "\nInvoking notify_user…");
      const { data, error: fErr } = await supabase.functions.invoke("notify_user", {
        body: {
          user_id: user.id,
          type: "support_message",
          title: "Self-push test",
          body: "This should show a banner on this device.",
          ticket_id: "00000000-0000-0000-0000-000000000000"
        }
      });
      if (fErr) throw fErr;
      setOut((s) => s + "\nEdge result: " + JSON.stringify(data));

      // Local mirror (verifies UI can display banners)
      setOut((s) => s + "\nScheduling local mirror…");
      await Notifications.scheduleNotificationAsync({
        content: {
          title: "Local mirror",
          body: "If this shows, device can display banners.",
          data: { __mirror_demo: 1 },
          ...(Platform.OS === "android" ? { channelId: "default" } : null)
        },
        trigger: null
      });
      setOut((s) => s + "\nDone.");
    } catch (e) {
      setOut((s) => s + "\nERROR: " + (e && e.message ? e.message : String(e)));
    }
  }

  async function sendAdminPushToMe() {
    try {
      setOut("Resolving user…");
      const { data: { user }, error } = await supabase.auth.getUser();
      if (error) throw error;
      if (!user) throw new Error("No signed-in user");
      setOut((s) => s + "\nUser: " + user.id);

      // notify_admin → target this admin only
      setOut((s) => s + "\nInvoking notify_admin (admin_id=me) …");
      const { data, error: fErr } = await supabase.functions.invoke("notify_admin", {
        body: {
          type: "support_message",
          title: "Admin self-push test",
          message: "This is an admin-targeted push to my device.",
          admin_id: user.id,        // 🔥 target the signed-in admin only
          ticket_id: null,
          quote_id: null,
          meta: { dev: true }
        }
      });
      if (fErr) throw fErr;
      setOut((s) => s + "\nEdge result: " + JSON.stringify(data));

      // Local mirror (verifies UI banners)
      setOut((s) => s + "\nScheduling local mirror…");
      await Notifications.scheduleNotificationAsync({
        content: {
          title: "Local mirror (admin)",
          body: "If this shows, banners work while app is open.",
          data: { __mirror_demo_admin: 1 },
          ...(Platform.OS === "android" ? { channelId: "default" } : null)
        },
        trigger: null
      });
      setOut((s) => s + "\nDone.");
    } catch (e) {
      setOut((s) => s + "\nERROR: " + (e && e.message ? e.message : String(e)));
    }
  }

  return (
    <View style={{ flex: 1, padding: 20, gap: 16, backgroundColor: "#fff" }}>
      <Text style={{ fontSize: 18, fontWeight: "800" }}>Push Test</Text>

      <TouchableOpacity
        onPress={sendSelfPush}
        style={{ backgroundColor: "#2a86ff", padding: 14, borderRadius: 12 }}
      >
        <Text style={{ color: "#fff", fontWeight: "800", textAlign: "center" }}>
          Send push to MY device (notify_user)
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        onPress={sendAdminPushToMe}
        style={{ backgroundColor: "#111827", padding: 14, borderRadius: 12 }}
      >
        <Text style={{ color: "#fff", fontWeight: "800", textAlign: "center" }}>
          Send ADMIN push to ME (notify_admin)
        </Text>
      </TouchableOpacity>

      <Text
        selectable
        style={{
          color: "#111",
          fontFamily: Platform.select({ ios: "Menlo", android: "monospace" })
        }}
      >
        {out}
      </Text>
    </View>
  );
}