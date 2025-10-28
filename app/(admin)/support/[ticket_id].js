// app/(admin)/support/[ticket_id].js
import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Platform,
  FlatList,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  StatusBar,
  Alert,
  Modal,
  Pressable,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { supabase } from "../../../lib/supabase";
import * as NavigationBar from "expo-navigation-bar";
import * as SystemUI from "expo-system-ui";
import * as Notifications from "expo-notifications";
import { Feather } from "@expo/vector-icons";

const CARD = "#ffffff";
const BG = "#f5f7fb";
const TEXT = "#0b1220";
const MUTED = "#6b7280";
const BORDER = "#e6e9ee";
const BRAND = "#2a86ff";
const DANGER = "#ff4d4f";
const SUCCESS = "#52c41a";

function timeShort(d) {
  try {
    const dt = new Date(d);
    return dt.toLocaleString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      day: "2-digit",
      month: "short",
    });
  } catch {
    return "";
  }
}

// Add helper to notify admin via Edge Function
async function notifyAdminPush(params) {
  try {
    const payload = {
      type: params?.type || "support_message",
      title: params?.title || "",
      body: params?.body || "",
      ticket_id: params?.ticket_id || null,
    };
    const resp = await supabase.functions.invoke("notify_admin", { body: payload });
    if (resp?.error) {
      console.warn("[ADMIN] notify_admin → ERROR", resp.error?.message || resp.error);
      return { ok: false, error: resp.error };
    }
    return { ok: true, data: resp?.data || null };
  } catch (e) {
    console.warn("[ADMIN] notify_admin → FATAL", e?.message || e);
    return { ok: false, error: e };
  }
}

export default function SupportTicketScreen() {
  const router = useRouter();
  const { ticket_id } = useLocalSearchParams();
  const tid = String(ticket_id || "");
  const insets = useSafeAreaInsets();

  const [ticket, setTicket] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [closing, setClosing] = useState(false);
  const [showCloseModal, setShowCloseModal] = useState(false);

  useEffect(() => {
    StatusBar.setBarStyle("dark-content", false);
    if (Platform.OS === "android") {
      StatusBar.setBackgroundColor("#ffffff", false);
      NavigationBar.setBackgroundColorAsync?.("#ffffff");
      NavigationBar.setButtonStyleAsync?.("dark");
      NavigationBar.setBorderColorAsync?.("#ffffff");
    }
    SystemUI.setBackgroundColorAsync?.("#ffffff");
  }, []);

  const load = useCallback(async () => {
    if (!tid) return;
    setLoading(true);
    try {
      const { data: auth } = await supabase.auth.getUser();
      const user = auth?.user;
      if (!user) {
        router.replace("/(auth)/login");
        return;
      }

      // Admin gate
      const { data: profile } = await supabase
        .from("profiles")
        .select("admin_owner")
        .eq("id", user.id)
        .maybeSingle();

      if (!profile?.admin_owner) {
        Alert.alert("Access Denied", "Admin access required");
        router.back();
        return;
      }

      const [tRes, mRes] = await Promise.all([
        supabase
          .from("support_tickets")
          .select("id, subject, status, priority, created_at, updated_at, user_id")
          .eq("id", tid)
          .maybeSingle(),
        supabase
          .from("support_messages")
          .select("id, sender_id, sender_role, body, created_at, read_by_user, read_by_admin")
          .eq("ticket_id", tid)
          .order("created_at", { ascending: true }),
      ]);

      if (!tRes.error) setTicket(tRes.data || null);
      if (!mRes.error) setMessages(mRes.data || []);

      // Mark user msgs as read-by-admin
      await supabase
        .from("support_messages")
        .update({ read_by_admin: true })
        .eq("ticket_id", tid)
        .eq("sender_role", "user")
        .eq("read_by_admin", false);

      // Auto: open -> pending
      if (tRes.data?.status === "open") {
        const { error: updateError } = await supabase
          .from("support_tickets")
          .update({ status: "pending", updated_at: new Date().toISOString() })
          .eq("id", tid);
        if (!updateError) setTicket((p) => (p ? { ...p, status: "pending" } : null));
      }
    } catch (e) {
      console.warn("[support] load", e);
    } finally {
      setLoading(false);
    }
  }, [tid, router]);

  useEffect(() => {
    load();
  }, [load]);

  // ⬇ Realtime: append only new, user-authored rows; de-dupe by id
  useEffect(() => {
    if (!tid) return;

    function addIfNew(msg) {
      if (!msg || !msg.id) return;
      setMessages((prev) => {
        for (let i = 0; i < prev.length; i++) {
          if (String(prev[i].id) === String(msg.id)) return prev; // already present
        }
        return prev.concat([msg]);
      });
    }

    const ch = supabase
      .channel("support_messages_admin_" + tid)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "support_messages", filter: "ticket_id=eq." + tid },
        async (payload) => {
          try {
            const msg = payload?.new || null;

            // Admin screen: ignore our own admin inserts (we optimistically add those)
            if (!msg || String(msg.sender_role || "") !== "user") return;

            addIfNew(msg);

            // Foreground banner so you don't miss user replies
            const text = msg.body && msg.body !== "(attachment)" ? msg.body : "New support attachment";
            await Notifications.scheduleNotificationAsync({
              content: {
                title: "Support replied",
                body: text.length > 220 ? text.slice(0, 217) + "…" : text,
                data: { type: "support_message", ticket_id: tid, _src: "admin-local" },
                ...(Platform.OS === "android" ? { channelId: "alerts" } : null),
              },
              trigger: null,
            });

            // Send push notification to admin device (Edge Function)
            await notifyAdminPush({
              type: "support_message",
              title: "New message from user",
              body: text.length > 140 ? text.slice(0, 140) + "…" : text,
              ticket_id: tid,
            });
          } catch (e) {
            console.warn("[admin realtime] handler error:", e?.message || e);
          }
        }
      )
      .subscribe();

    return () => {
      try {
        supabase.removeChannel(ch);
      } catch {}
    };
  }, [tid]);

  const sendMessage = useCallback(async () => {
    const body = String(input || "").trim();
    if (!body || sending) return;
    setSending(true);
    try {
      const { data: auth } = await supabase.auth.getUser();
      const user = auth?.user;
      if (!user) {
        Alert.alert("Error", "No authenticated user found.");
        setSending(false);
        return;
      }

      // optimistic append (temp id ensures unique key)
      const tempId = "temp-" + Date.now();
      const optimistic = {
        id: tempId,
        ticket_id: tid,
        sender_id: user.id,
        sender_role: "admin",
        body: body,
        created_at: new Date().toISOString(),
        read_by_user: false,
        read_by_admin: true,
      };
      setMessages((m) => m.concat([optimistic]));
      setInput("");

      // write message
      const ins = await supabase
        .from("support_messages")
        .insert({
          ticket_id: tid,
          sender_id: user.id,
          sender_role: "admin",
          body: body,
        })
        .select("id, sender_id, sender_role, body, created_at, read_by_user, read_by_admin")
        .single();

      if (ins.error) {
        setMessages((m) => m.filter((x) => x.id !== tempId));
        Alert.alert("Send failed", ins.error.message || "Could not send message");
        console.warn("[support] sendMessage error", ins.error);
        return;
      }

      setMessages((m) => m.filter((x) => x.id !== tempId).concat([ins.data]));

      // touch timestamps; keep status pending
      await supabase
        .from("support_tickets")
        .update({
          last_message_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", tid);

      // inbox row for user (optional)
      if (ticket?.user_id) {
        await supabase.from("notifications").insert({
          user_id: ticket.user_id,
          title: "New support message",
          body: body.length > 120 ? body.slice(0, 117) + "..." : body,
          type: "support_message",
          ticket_id: tid,
          read: false,
        });
      }

      // Push to ticket owner via Edge Function
      if (ticket?.user_id) {
        await supabase.functions.invoke("notify_user", {
          body: {
            user_id: ticket.user_id,
            type: "support_message",
            title: "New message from support",
            body: body.length > 140 ? body.slice(0, 140) + "…" : body,
            ticket_id: tid,
          },
        });
      }
    } catch (e) {
      console.warn("[support] sendMessage", e);
      setMessages((m) =>
        m.concat([
          {
            id: "fail-" + Date.now(),
            sender_role: "system",
            body: "Failed to send. Please try again.",
            created_at: new Date().toISOString(),
          },
        ])
      );
      Alert.alert("Send failed", e?.message || "Could not send message");
    } finally {
      setSending(false);
    }
  }, [input, sending, tid, ticket?.user_id]);

  const closeTicket = useCallback(async () => {
    if (!ticket || closing) return;
    try {
      setClosing(true);
      const upd = await supabase
        .from("support_tickets")
        .update({ status: "closed", updated_at: new Date().toISOString() })
        .eq("id", tid);
      if (upd.error) throw upd.error;

      setTicket((p) => (p ? { ...p, status: "closed" } : null));
      setMessages((m) =>
        m.concat([
          {
            id: "system-" + Date.now(),
            ticket_id: tid,
            sender_role: "system",
            body: "Ticket has been closed by admin.",
            created_at: new Date().toISOString(),
          },
        ])
      );
      setShowCloseModal(false);

      if (ticket?.user_id) {
        await supabase.from("notifications").insert({
          user_id: ticket.user_id,
          title: "Ticket closed",
          body: "Support has closed your ticket.",
          type: "support_message",
          ticket_id: tid,
          read: false,
        });

        await supabase.functions.invoke("notify_user", {
          body: {
            user_id: ticket.user_id,
            type: "support_message",
            title: "Ticket closed",
            body: "Support has closed your ticket.",
            ticket_id: tid,
          },
        });
      }
    } catch (e) {
      console.warn("[support] closeTicket", e);
      Alert.alert("Error", "Failed to close ticket. Please try again.");
    } finally {
      setClosing(false);
    }
  }, [ticket, closing, tid]);

  // Fix: Remove duplicate renderItem definition and ensure only one renderItem function exists
  const renderItem = ({ item }) => {
    // Inverted: "admin" messages are left-aligned and grey, "user" messages are right-aligned and blue.
    const mine = item.sender_role === "admin";
    const isSystem = item.sender_role === "system";
    const alignStyle = isSystem
      ? { justifyContent: "center" }
      : mine
      ? { justifyContent: "flex-start" }
      : { justifyContent: "flex-end" };
    const bubbleStyle = isSystem ? st.bubbleSystem : mine ? st.bubbleThem : st.bubbleMine;
    const selfAlign = isSystem
      ? { alignSelf: "center" }
      : mine
      ? { alignSelf: "flex-start" }
      : { alignSelf: "flex-end" };
    return (
      <View style={[st.msgRow, alignStyle]}>
        <View style={[st.bubble, bubbleStyle, selfAlign]}>
          <Text style={[st.msgText, !mine && !isSystem && { color: "#fff" }, isSystem && { color: "#b45309" }]}>
            {item.body}
          </Text>
          <Text style={[st.meta, !mine && !isSystem && { color: "#fff" }, isSystem && { color: "#b45309" }]}>
            {timeShort(item.created_at)}
          </Text>
        </View>
      </View>
    );
  };

  const isTicketClosed = ticket?.status === "closed";

  // Header right actions (close and refresh, styled like index.js)
  const headerActions = (
    <View style={{ flexDirection: "row", gap: 8 }}>
      {!isTicketClosed && (
        <TouchableOpacity
          style={st.iconBtn}
          onPress={() => setShowCloseModal(true)}
          disabled={closing}
          activeOpacity={0.9}
        >
          <Feather name="x" size={18} color={DANGER} />
        </TouchableOpacity>
      )}
      <TouchableOpacity style={st.iconBtn} onPress={load} activeOpacity={0.9}>
        <Feather name="refresh-cw" size={18} color={BRAND} />
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={st.screen}>
      <View style={{ height: insets.top, backgroundColor: CARD }} />

      {/* Header */}
      <View style={st.header}>
        <TouchableOpacity style={st.backBtn} onPress={() => router.back()}>
          <Feather name="arrow-left" size={20} color={TEXT} />
        </TouchableOpacity>
        <View style={st.headerContent}>
          <Text style={st.headerTitle} numberOfLines={1}>
            {ticket?.subject || "Support Ticket"}
          </Text>
          {!!ticket && (
            <Text style={st.headerSubtitle}>
              {String(ticket.status || "").toUpperCase()} • Priority: {ticket.priority || "normal"}
            </Text>
          )}
        </View>
        <View style={st.headerActions}>{headerActions}</View>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <FlatList
          data={messages}
          keyExtractor={(it, idx) => String(it?.id || it?.created_at || idx)}
          renderItem={renderItem}
          contentContainerStyle={{ padding: 16, paddingBottom: 110 }}
          ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
          ListEmptyComponent={
            <View style={st.emptyState}>
              <Feather name="message-circle" size={48} color={MUTED} />
              <Text style={st.emptyTitle}>No messages yet</Text>
              <Text style={st.emptySubtitle}>Start the conversation by sending a message</Text>
            </View>
          }
          onRefresh={load}
          refreshing={loading}
        />

        {!isTicketClosed ? (
          <View style={st.composerWrap}>
            <TextInput
              value={input}
              onChangeText={setInput}
              placeholder="Type your reply..."
              placeholderTextColor={MUTED}
              style={st.composerInput}
              multiline
              editable={!sending}
            />
            <TouchableOpacity
              style={[st.sendBtn, (!input.trim() || sending) && { opacity: 0.5 }]}
              disabled={!input.trim() || sending}
              onPress={sendMessage}
              activeOpacity={0.9}
            >
              <Feather name="send" size={18} color="#fff" />
            </TouchableOpacity>
          </View>
        ) : (
          <View style={st.closedNotice}>
            <Feather name="check-circle" size={20} color={SUCCESS} />
            <Text style={st.closedNoticeText}>This ticket has been closed</Text>
          </View>
        )}
      </KeyboardAvoidingView>

      <View style={{ height: insets.bottom, backgroundColor: CARD }} />

      <Modal visible={showCloseModal} animationType="fade" transparent>
        <Pressable
          style={st.modalBackdrop}
          onPress={() => {
            if (!closing) setShowCloseModal(false);
          }}
        />
        <View style={st.modalContainer}>
          <View style={st.modalCard}>
            <View style={st.modalHeader}>
              <Feather name="x-circle" size={24} color={DANGER} />
              <Text style={st.modalTitle}>Close Ticket</Text>
            </View>

            <Text style={st.modalMessage}>
              Are you sure you want to close this ticket? This will mark it as resolved and stop further replies.
            </Text>

            <View style={st.modalActions}>
              <TouchableOpacity
                style={[st.modalBtn, st.modalBtnSecondary]}
                onPress={() => setShowCloseModal(false)}
                disabled={closing}
                activeOpacity={0.9}
              >
                <Text style={st.modalBtnTextSecondary}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[st.modalBtn, st.modalBtnDanger, closing && { opacity: 0.6 }]}
                onPress={closeTicket}
                disabled={closing}
                activeOpacity={0.9}
              >
                <Feather name="x" size={16} color="#fff" />
                <Text style={st.modalBtnTextDanger}>{closing ? "Closing..." : "Close Ticket"}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const st = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },

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
  headerContent: { flex: 1, marginHorizontal: 16 },
  headerTitle: { fontSize: 18, fontWeight: "900", color: TEXT, marginBottom: 2 },
  headerSubtitle: { fontSize: 12, color: MUTED, fontWeight: "500" },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 8 },

  iconBtn: {
    height: 38,
    width: 38,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: CARD,
  },

  closeBtn: {
    backgroundColor: DANGER,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    ...Platform.select({
      ios: { shadowColor: DANGER, shadowOpacity: 0.25, shadowRadius: 4, shadowOffset: { width: 0, height: 2 } },
      android: { elevation: 3 },
    }),
  },
  closeBtnText: { color: "#fff", fontWeight: "700", fontSize: 12 },
  refreshBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: BRAND + "10",
    alignItems: "center",
    justifyContent: "center",
  },

  emptyState: { alignItems: "center", justifyContent: "center", paddingVertical: 60 },
  emptyTitle: { color: TEXT, fontWeight: "800", fontSize: 18, marginTop: 16, marginBottom: 8 },
  emptySubtitle: { color: MUTED, fontSize: 14, textAlign: "center", lineHeight: 20 },

  msgRow: { flexDirection: "row", marginHorizontal: 10 },
  bubbleMine: { backgroundColor: BRAND, borderColor: BRAND },
  bubbleThem: { backgroundColor: "#f3f4f6", borderColor: BORDER },
  bubbleSystem: { backgroundColor: "#fff7ed", borderColor: "#fed7aa" },
  bubble: {
    maxWidth: "86%",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    ...Platform.select({
      ios: { shadowColor: "#0b1220", shadowOpacity: 0.06, shadowRadius: 4, shadowOffset: { width: 0, height: 2 } },
      android: { elevation: 2 },
    }),
  },
  msgText: { color: TEXT, fontSize: 14, lineHeight: 20 },
  meta: { marginTop: 4, fontSize: 11, color: MUTED },

  composerWrap: {
    backgroundColor: CARD,
    borderTopWidth: 1,
    borderTopColor: BORDER,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 12,
    ...Platform.select({
      ios: { shadowColor: "#0b1220", shadowOpacity: 0.08, shadowRadius: 12, shadowOffset: { width: 0, height: -4 } },
      android: { elevation: 8 },
    }),
  },
  composerInput: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    color: TEXT,
    backgroundColor: CARD,
    fontSize: 15,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: BRAND,
    alignItems: "center",
    justifyContent: "center",
    ...Platform.select({
      ios: { shadowColor: BRAND, shadowOpacity: 0.25, shadowRadius: 4, shadowOffset: { width: 0, height: 2 } },
      android: { elevation: 3 },
    }),
  },

  closedNotice: {
    backgroundColor: CARD,
    borderTopWidth: 1,
    borderTopColor: BORDER,
    paddingHorizontal: 16,
    paddingVertical: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  closedNoticeText: { color: SUCCESS, fontWeight: "700", fontSize: 14 },

  modalBackdrop: { position: "absolute", inset: 0, backgroundColor: "rgba(0, 0, 0, 0.5)" },
  modalContainer: { flex: 1, justifyContent: "center", alignItems: "center", padding: 24 },
  modalCard: {
    backgroundColor: CARD,
    borderRadius: 16,
    padding: 24,
    borderWidth: 1,
    borderColor: BORDER,
    width: "100%",
    maxWidth: 400,
    ...Platform.select({
      ios: { shadowColor: "#0b1220", shadowOpacity: 0.15, shadowRadius: 20, shadowOffset: { width: 0, height: 10 } },
      android: { elevation: 12 },
    }),
  },
  modalHeader: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 16 },
  modalTitle: { fontSize: 18, fontWeight: "900", color: TEXT },
  modalMessage: { fontSize: 15, lineHeight: 22, color: MUTED, marginBottom: 24 },
  modalActions: { flexDirection: "row", gap: 12 },
  modalBtn: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 6,
  },
  modalBtnSecondary: { backgroundColor: "#f8fafc", borderColor: BORDER },
  modalBtnDanger: { backgroundColor: DANGER, borderColor: DANGER },
  modalBtnTextSecondary: { fontSize: 15, fontWeight: "700", color: TEXT },
  modalBtnTextDanger: { fontSize: 15, fontWeight: "700", color: "#fff" },
});