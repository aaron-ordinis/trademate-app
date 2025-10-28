// app/(app)/settings/help/[ticketid].js
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  StatusBar,
  Platform,
  TouchableOpacity,
  TextInput,
  FlatList,
  Alert,
  Modal,
  Pressable,
  KeyboardAvoidingView,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as NavigationBar from "expo-navigation-bar";
import * as SystemUI from "expo-system-ui";
import * as Notifications from "expo-notifications";
import { Feather } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system";
import { decode as decodeBase64 } from "base64-arraybuffer";
import { supabase } from "../../../../lib/supabase";

/* ---------- THEME ---------- */
const CARD = "#ffffff";
const BG = "#f5f7fb";
const TEXT = "#0b1220";
const MUTED = "#6b7280";
const BORDER = "#e6e9ee";
const BRAND = "#2a86ff";
const DANGER = "#ff4d4f";
const SUCCESS = "#52c41a";
const WARNING = "#f59e0b";

/* ---------- HELPERS ---------- */
const isUuid = function (v) {
  return (
    typeof v === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)
  );
};

function getStatusColor(status) {
  switch ((status || "").toLowerCase()) {
    case "open":
      return SUCCESS;
    case "pending":
      return WARNING;
    case "closed":
      return MUTED;
    default:
      return MUTED;
  }
}

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

/* ---------- NOTIFY ADMINS VIA EDGE FUNCTION ---------- */
async function notifyAdmins(params) {
  try {
    const payload = {
      type: params && params.type ? params.type : "support_message",
      title: params && params.title ? params.title : "",
      body: params && params.body ? params.body : "",
      ticket_id: params ? params.ticket_id : null,
    };
    // immediate invoke → push to admin
    const resp = await supabase.functions.invoke("notify_admin", { body: payload });
    if (resp && resp.error) {
      console.warn("[TICKET] notify_admin → ERROR", resp.error && resp.error.message ? resp.error.message : resp.error);
      return { ok: false, error: resp.error };
    }
    return { ok: true, data: resp ? resp.data : null };
  } catch (e) {
    console.warn("[TICKET] notify_admin → FATAL", e && e.message ? e.message : e);
    return { ok: false, error: e };
  }
}

// Add helper to notify user (mirroring admin logic)
async function notifyUser(params) {
  try {
    const payload = {
      user_id: params && params.user_id ? params.user_id : null,
      type: params && params.type ? params.type : "support_message",
      title: params && params.title ? params.title : "",
      body: params && params.body ? params.body : "",
      ticket_id: params ? params.ticket_id : null,
    };
    const resp = await supabase.functions.invoke("notify_user", { body: payload });
    if (resp && resp.error) {
      console.warn("[TICKET] notify_user → ERROR", resp.error && resp.error.message ? resp.error.message : resp.error);
      return { ok: false, error: resp.error };
    }
    return { ok: true, data: resp ? resp.data : null };
  } catch (e) {
    console.warn("[TICKET] notify_user → FATAL", e && e.message ? e.message : e);
    return { ok: false, error: e };
  }
}

/* ---------- SCREEN ---------- */
export default function TicketThread() {
  const { ticketid } = useLocalSearchParams();
  const ticketId = Array.isArray(ticketid) ? ticketid[0] : ticketid;
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [userId, setUserId] = useState(null);
  const [ticket, setTicket] = useState(null);
  const [messages, setMessages] = useState([]);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [closing, setClosing] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [showCloseModal, setShowCloseModal] = useState(false);
  const scrollRef = useRef(null);

  useEffect(function () {
    StatusBar.setBarStyle("dark-content", false);
    if (Platform.OS === "android") {
      StatusBar.setBackgroundColor("#ffffff", false);
      NavigationBar.setBackgroundColorAsync && NavigationBar.setBackgroundColorAsync("#ffffff");
      NavigationBar.setButtonStyleAsync && NavigationBar.setButtonStyleAsync("dark");
      NavigationBar.setBorderColorAsync && NavigationBar.setBorderColorAsync("#ffffff");
    }
    SystemUI.setBackgroundColorAsync && SystemUI.setBackgroundColorAsync("#ffffff");
  }, []);

  // Load ticket + messages
  const load = useCallback(async function () {
    try {
      if (!isUuid(ticketId)) {
        Alert.alert("Invalid ticket", "This ticket link is invalid.");
        return;
      }

      const me = await supabase.auth.getUser();
      const authed = me && me.data && me.data.user ? me.data.user : null;
      if (!authed) return;
      setUserId(authed.id);

      const t = await supabase
        .from("support_tickets")
        .select("id, subject, status, created_at")
        .eq("id", ticketId)
        .single();
      if (t.error || !t.data) throw (t.error || new Error("Ticket not found"));
      setTicket(t.data);

      const m = await supabase
        .from("support_messages")
        .select("id, sender_id, sender_role, body, attachments, created_at")
        .eq("ticket_id", ticketId)
        .order("created_at", { ascending: true });
      if (m.error) throw m.error;

      // de-dupe by id in case historical duplicates exist
      const seen = {};
      const deduped = (m.data || []).filter(function (row) {
        const k = String(row.id);
        if (seen[k]) return false;
        seen[k] = 1;
        return true;
      });
      setMessages(deduped);

      // mark read (ignore errors)
      await supabase.rpc("support_mark_read", { p_ticket_id: ticketId });
    } catch (e) {
      Alert.alert("Error", e && e.message ? e.message : "Failed to load ticket");
    } finally {
      setInitialLoading(false);
    }
  }, [ticketId]);

  useEffect(function () {
    load();
  }, [load]);

  // helper: append only if new
  const addIfNew = useCallback(function (msg) {
    if (!msg || !msg.id) return;
    const idStr = String(msg.id);
    setMessages(function (prev) {
      for (let i = 0; i < prev.length; i++) {
        if (String(prev[i].id) === idStr) return prev;
      }
      return prev.concat([msg]);
    });
  }, []);

  // Realtime updates + foreground local banner for admin replies
  useEffect(function () {
    if (!isUuid(ticketId)) return;

    const channel = supabase
      .channel("support_messages_" + ticketId)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "support_messages",
          filter: "ticket_id=eq." + ticketId,
        },
        async function (payload) {
          try {
            const msg = payload && payload.new ? payload.new : null;
            if (!msg) return;

            // append only if not already present
            addIfNew(msg);

            // auto-scroll
            setTimeout(function () {
              try {
                if (scrollRef.current && scrollRef.current.scrollToEnd) {
                  scrollRef.current.scrollToEnd({ animated: true });
                }
              } catch (_) {}
            }, 100);

            // If an admin just replied AND app is foreground → show a local banner.
            const isAdminReply = (msg && msg.sender_role ? msg.sender_role : "") !== "user";
            const appState = AppState.currentState;

            if (isAdminReply && appState === "active") {
              const text =
                msg && msg.body && msg.body !== "(attachment)"
                  ? msg.body
                  : Array.isArray(msg && msg.attachments ? msg.attachments : []) &&
                    (msg.attachments || []).length > 0
                  ? "New support attachment"
                  : "Support replied";

              await Notifications.scheduleNotificationAsync({
                content: {
                  title: "Support replied",
                  body: text.length > 220 ? text.slice(0, 217) + "…" : text,
                  data: { type: "support_message", ticket_id: ticketId, _src: "local-live" },
                  ...(Platform.OS === "android" ? { channelId: "alerts" } : null),
                },
                trigger: null,
              });

              // Also send push notification to user (mirroring admin logic)
              // Only send if the message is from admin and not already sent by this user
              if (userId && msg.sender_role === "admin") {
                await notifyUser({
                  user_id: userId,
                  type: "support_message",
                  title: "New message from support",
                  body: text.length > 140 ? text.slice(0, 140) + "…" : text,
                  ticket_id: ticketId,
                });
              }
            }
          } catch (e) {
            console.warn("[TICKET] realtime handler error:", e && e.message ? e.message : e);
          }
        }
      )
      .subscribe();

    return function () {
      try {
        supabase.removeChannel(channel);
      } catch (_) {}
    };
  }, [ticketId, addIfNew, userId]);

  // Replace isMine logic: user's messages are right/blue, admin left/grey, system center/orange
  const isMine = useCallback(
    function (m) {
      return m && m.sender_id === userId && m.sender_role === "user";
    },
    [userId]
  );

  const sendMessage = useCallback(async function () {
    try {
      const text = String(body || "").trim();
      if (!text || !isUuid(ticketId) || !userId) return;
      setSending(true);

      // write message
      const ins = await supabase.from("support_messages").insert({
        ticket_id: ticketId,
        sender_id: userId,
        sender_role: "user",
        body: text,
      });

      if (ins && ins.error) throw ins.error;

      setBody("");

      // immediate push to admin (Edge Function)
      const title = "New support message";
      const preview = text.length > 140 ? text.slice(0, 140) + "…" : text;

      const res = await notifyAdmins({
        type: "support_message",
        title: title,
        body: preview,
        ticket_id: ticketId,
      });
      if (!res.ok) {
        console.warn("[TICKET] notifyAdmins failed (non-blocking)");
      }

      // Optionally: send notification to user as well (if needed)
      // Not needed here, as user is the sender

    } catch (e) {
      Alert.alert("Send failed", e && e.message ? e.message : "Could not send message");
    } finally {
      setSending(false);
    }
  }, [body, ticketId, userId]);

  // Robust upload for RN (content:// safe)
  const pickAndUpload = async function () {
    try {
      if (!isUuid(ticketId)) return;

      const res = await DocumentPicker.getDocumentAsync({
        multiple: false,
        copyToCacheDirectory: true,
        type: ["image/*", "application/pdf", "text/plain"],
      });
      if (!res || res.canceled || !(res.assets && res.assets.length)) return;

      const file = res.assets[0];
      const me = await supabase.auth.getUser();
      const authUser = me && me.data ? me.data.user : null;
      if (!authUser) throw new Error("Not signed in");

      const base64 = await FileSystem.readAsStringAsync(file.uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const arrayBuffer = decodeBase64(base64);

      const bucket = "support-attachments";
      const path = authUser.id + "/" + ticketId + "/" + (file.name || "file");

      const upload = await supabase.storage.from(bucket).upload(path, arrayBuffer, {
        contentType: file.mimeType || "application/octet-stream",
        upsert: true,
      });
      if (upload && upload.error) throw upload.error;

      const msgIns = await supabase.from("support_messages").insert({
        ticket_id: ticketId,
        sender_id: authUser.id,
        sender_role: "user",
        body: "(attachment)",
        attachments: [
          {
            bucket: bucket,
            path: path,
            name: file.name || "Attachment",
            type: file.mimeType || null,
          },
        ],
      });
      if (msgIns && msgIns.error) throw msgIns.error;

      const resNotify = await notifyAdmins({
        type: "support_message",
        title: "New support attachment",
        body: file.name || "Attachment",
        ticket_id: ticketId,
      });
      if (!resNotify.ok) {
        console.warn("[TICKET] notifyAdmins(attachment) failed (non-blocking)");
      }

      // Optionally: send notification to user as well (not needed here)

    } catch (e) {
      Alert.alert("Upload failed", e && e.message ? e.message : "Could not upload file");
    }
  };

  const closeTicket = useCallback(async function () {
    try {
      if (!isUuid(ticketId)) return;
      setClosing(true);
      const upd = await supabase.from("support_tickets").update({ status: "closed" }).eq("id", ticketId);
      if (upd && upd.error) throw upd.error;

      await load();

      const resNotify = await notifyAdmins({
        type: "support_message",
        title: "Ticket closed",
        body: "A user closed their support ticket.",
        ticket_id: ticketId,
      });
      if (!resNotify.ok) {
        console.warn("[TICKET] notifyAdmins(close) failed (non-blocking)");
      }

      Alert.alert("Success", "This ticket has been closed.");
    } catch (e) {
      Alert.alert("Error", e && e.message ? e.message : "Could not close ticket");
    } finally {
      setClosing(false);
    }
  }, [ticketId, load]);

  const deleteTicket = useCallback(function () {
    if (!ticket) return;
    Alert.alert(
      "Delete Ticket",
      "Are you sure you want to permanently delete this ticket and all its messages? This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async function () {
            try {
              const del = await supabase.from("support_tickets").delete().eq("id", ticket.id);
              if (del && del.error) throw del.error;
              Alert.alert("Deleted", "Ticket deleted successfully.");
              router.push("/(app)/settings/help");
            } catch (e) {
              Alert.alert("Error", e && e.message ? e.message : "Could not delete ticket");
            }
          },
        },
      ]
    );
  }, [ticket, router]);

  const openAttachment = async function (att) {
    try {
      const signed = await supabase.storage.from(att.bucket).createSignedUrl(att.path, 300);
      if (signed && signed.error) throw signed.error;
      const url = signed && signed.data ? signed.data.signedUrl : null;
      if (!url) return;
      const can = await Linking.canOpenURL(url);
      if (can) Linking.openURL(url);
    } catch (e) {
      Alert.alert("Open failed", e && e.message ? e.message : "Could not open attachment");
    }
  };

  if (initialLoading) {
    return (
      <View style={st.screen}>
        <View style={{ height: insets.top, backgroundColor: CARD }} />
        <View style={st.header}>
          <TouchableOpacity style={st.backBtn} onPress={() => router.push("/(app)/settings/help")}>
            <Feather name="arrow-left" size={20} color={TEXT} />
          </TouchableOpacity>
          <View style={st.headerContent}>
            <Text style={st.headerTitle}>Support Ticket</Text>
          </View>
          <View style={st.headerActions} />
        </View>
        <View style={st.loadingContainer}>
          <Text style={st.loadingText}>Loading ticket...</Text>
        </View>
      </View>
    );
  }

  if (!ticket) {
    return (
      <View style={st.screen}>
        <View style={{ height: insets.top, backgroundColor: CARD }} />
        <View style={st.header}>
          <TouchableOpacity style={st.backBtn} onPress={() => router.push("/(app)/settings/help")}>
            <Feather name="arrow-left" size={20} color={TEXT} />
          </TouchableOpacity>
          <View style={st.headerContent}>
            <Text style={st.headerTitle}>Support Ticket</Text>
          </View>
          <View style={st.headerActions} />
        </View>
        <View style={st.loadingContainer}>
          <Text style={st.loadingText}>Ticket not found</Text>
        </View>
      </View>
    );
  }

  const isTicketClosed = ticket.status === "closed";

  // Add renderItem for FlatList to display messages
  const renderItem = ({ item }) => {
    const mine = isMine(item);
    const isSystem = item.sender_role === "system";
    const alignStyle = isSystem
      ? { justifyContent: "center" }
      : mine
      ? { justifyContent: "flex-end" }
      : { justifyContent: "flex-start" };
    const bubbleStyle = isSystem
      ? st.bubbleSystem
      : mine
      ? st.bubbleMine
      : st.bubbleThem;
    const selfAlign = isSystem
      ? { alignSelf: "center" }
      : mine
      ? { alignSelf: "flex-end" }
      : { alignSelf: "flex-start" };

    return (
      <View style={[st.msgRow, alignStyle]}>
        <View style={[st.bubble, bubbleStyle, selfAlign]}>
          {!!item.body && item.body !== "(attachment)" && (
            <Text
              style={[
                st.msgText,
                mine && { color: "#fff" },
                isSystem && { color: "#b45309" },
              ]}
            >
              {item.body}
            </Text>
          )}
          {Array.isArray(item.attachments) && item.attachments.length > 0 && (
            <View style={st.attachmentsContainer}>
              {item.attachments.map((a, i2) => (
                <TouchableOpacity
                  key={String(item.id) + "-att-" + String(i2)}
                  onPress={() => openAttachment(a)}
                  style={[
                    st.attachmentBtn,
                    mine ? st.attachmentBtnMine : st.attachmentBtnOther,
                  ]}
                  activeOpacity={0.7}
                >
                  <Feather name="paperclip" size={14} color={mine ? "#fff" : BRAND} />
                  <Text
                    style={[
                      st.attachmentText,
                      mine ? st.attachmentTextMine : st.attachmentTextOther,
                    ]}
                    numberOfLines={1}
                  >
                    {a && a.name ? a.name : "Attachment"}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
          <Text
            style={[
              st.meta,
              mine && { color: "#fff" },
              isSystem && { color: "#b45309" },
            ]}
          >
            {timeShort(item.created_at)}
          </Text>
        </View>
      </View>
    );
  };

  return (
    <View style={st.screen}>
      <View style={{ height: insets.top, backgroundColor: CARD }} />

      {/* Header */}
      <View style={st.header}>
        <TouchableOpacity style={st.backBtn} onPress={() => router.push("/(app)/settings/help")}>
          <Feather name="arrow-left" size={20} color={TEXT} />
        </TouchableOpacity>
        <View style={st.headerContent}>
          <Text style={st.headerTitle} numberOfLines={1}>
            {ticket.subject || "Support Ticket"}
          </Text>
          <Text style={st.headerSubtitle}>
            {String(ticket.status || "").toUpperCase()}
          </Text>
        </View>
        <View style={st.headerActions}>
          {!isTicketClosed && (
            <TouchableOpacity
              style={[st.closeBtn, closing && { opacity: 0.6 }]}
              onPress={() => setShowCloseModal(true)}
              disabled={closing}
              activeOpacity={0.9}
            >
              <Feather name="x" size={16} color="#fff" />
              <Text style={st.closeBtnText}>{closing ? "Closing..." : "Close"}</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={st.refreshBtn} onPress={load}>
            <Feather name="refresh-cw" size={18} color={BRAND} />
          </TouchableOpacity>
        </View>
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
          refreshing={initialLoading}
        />

        {!isTicketClosed ? (
          <View style={st.composerWrap}>
            <TouchableOpacity onPress={pickAndUpload} style={st.attachBtn}>
              <Feather name="paperclip" size={18} color={BRAND} />
            </TouchableOpacity>
            <TextInput
              value={body}
              onChangeText={setBody}
              placeholder="Type your reply..."
              placeholderTextColor={MUTED}
              style={st.composerInput}
              multiline
              editable={!sending}
              maxLength={2000}
            />
            <TouchableOpacity
              style={[st.sendBtn, (!body.trim() || sending) && { opacity: 0.5 }]}
              disabled={!body.trim() || sending}
              onPress={sendMessage}
              activeOpacity={0.9}
            >
              <Feather name="send" size={18} color="#fff" />
            </TouchableOpacity>
          </View>
        ) : (
          <View style={st.closedNotice}>
            <Feather name="lock" size={20} color={SUCCESS} />
            <Text style={st.closedNoticeText}>This ticket has been closed</Text>
          </View>
        )}
      </KeyboardAvoidingView>

      <View style={{ height: insets.bottom, backgroundColor: CARD }} />

      {/* Close Modal */}
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
                onPress={async () => {
                  await closeTicket();
                  setShowCloseModal(false);
                }}
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

// Add this near the top-level (outside the component)
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/* ---------- STYLES ---------- */
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

  loadingContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  loadingText: {
    color: MUTED,
    fontSize: 16,
    fontWeight: "500",
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

  attachmentsContainer: {
    marginTop: 8,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  attachmentBtn: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: "#fff",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    flex: 1,
  },
  attachmentBtnMine: {
    backgroundColor: BRAND,
    borderColor: BRAND,
  },
  attachmentBtnOther: {
    borderColor: "#d1d5db",
  },
  attachmentText: {
    color: TEXT,
    fontSize: 14,
    lineHeight: 20,
    marginLeft: 8,
    flex: 1,
  },
  attachmentTextMine: { color: "#fff" },
  attachmentTextOther: { color: BRAND },

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
  attachBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: "#f3f4f6",
    alignItems: "center",
    justifyContent: "center",
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