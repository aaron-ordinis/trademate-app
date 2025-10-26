import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  StatusBar,
  Platform,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Alert,
  Modal,
  Linking,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as NavigationBar from "expo-navigation-bar";
import * as SystemUI from "expo-system-ui";
import { Feather } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system";
import { decode as decodeBase64 } from "base64-arraybuffer";
import { supabase } from "../../../../lib/supabase";

/* ---------- THEME ---------- */
const CARD = "#ffffff";
const TEXT = "#0b1220";
const MUTED = "#6b7280";
const BORDER = "#e6e9ee";
const BRAND = "#2a86ff";
const BG = "#ffffff";
const SUCCESS = "#10b981";
const WARNING = "#f59e0b";
const DANGER = "#dc2626";

/* ---------- HELPERS ---------- */
const isUuid = (v) =>
  typeof v === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    v
  );

/* ---------- INFO BUTTON COMPONENT ---------- */
function InfoButton({ title, tips = [] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <TouchableOpacity onPress={() => setOpen(true)} style={styles.infoBtn}>
        <Text style={{ color: MUTED, fontWeight: "900" }}>i</Text>
      </TouchableOpacity>
      <Modal
        visible={open}
        animationType="fade"
        transparent
        onRequestClose={() => setOpen(false)}
      >
        <View style={styles.modalBackdrop} />
        <View style={styles.modalWrap}>
          <View style={styles.modalCard}>
            <View style={styles.modalHead}>
              <Text style={{ color: TEXT, fontWeight: "900", fontSize: 16 }}>
                {title}
              </Text>
              <TouchableOpacity
                onPress={() => setOpen(false)}
                style={styles.smallBtn}
              >
                <Text style={styles.smallBtnText}>Close</Text>
              </TouchableOpacity>
            </View>
            {tips.slice(0, 6).map((t, i) => (
              <View
                key={i}
                style={{ flexDirection: "row", gap: 8, marginBottom: 8 }}
              >
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

export default function TicketThread() {
  const { ticketid } = useLocalSearchParams(); // dynamic segment is [ticketid]
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
  const scrollRef = useRef(null);

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

  // Load ticket + messages
  const load = useCallback(async () => {
    try {
      if (!isUuid(ticketId)) {
        Alert.alert("Invalid ticket", "This ticket link is invalid.");
        return;
      }

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      setUserId(user.id);

      const t = await supabase
        .from("support_tickets")
        .select("id, subject, status, created_at")
        .eq("id", ticketId)
        .single();
      if (t.error || !t.data) throw t.error || new Error("Ticket not found");
      setTicket(t.data);

      const m = await supabase
        .from("support_messages")
        .select(
          "id, sender_id, sender_role, body, attachments, created_at"
        )
        .eq("ticket_id", ticketId)
        .order("created_at", { ascending: true });
      if (m.error) throw m.error;
      setMessages(m.data || []);

      // mark read (ignore errors)
      await supabase.rpc("support_mark_read", { p_ticket_id: ticketId });
    } catch (e) {
      Alert.alert("Error", e?.message || "Failed to load ticket");
    } finally {
      setInitialLoading(false);
    }
  }, [ticketId]);

  useEffect(() => {
    load();
  }, [load]);

  // Realtime updates
  useEffect(() => {
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
        (payload) => {
          setMessages((prev) => prev.concat(payload.new));
          setTimeout(() => {
            try {
              scrollRef.current?.scrollToEnd({ animated: true });
            } catch {}
          }, 100);
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [ticketId]);

  const isMine = useCallback(
    (m) => m.sender_id === userId || m.sender_role === "user",
    [userId]
  );

  const sendMessage = useCallback(async () => {
    try {
      const text = body.trim();
      if (!text || !isUuid(ticketId) || !userId) return;
      setSending(true);
      const { error } = await supabase.from("support_messages").insert({
        ticket_id: ticketId,
        sender_id: userId,
        sender_role: "user",
        body: text,
      });
      if (error) throw error;
      setBody("");
    } catch (e) {
      Alert.alert("Send failed", e?.message || "Could not send message");
    } finally {
      setSending(false);
    }
  }, [body, ticketId, userId]);

  // Robust upload for RN (content:// safe)
  const pickAndUpload = async () => {
    try {
      if (!isUuid(ticketId)) return;

      const res = await DocumentPicker.getDocumentAsync({
        multiple: false,
        copyToCacheDirectory: true,
        type: ["image/*", "application/pdf", "text/plain"],
      });
      if (res.canceled || !res.assets?.length) return;

      const file = res.assets[0]; // { uri, name, size, mimeType }
      const {
        data: { user: authUser },
      } = await supabase.auth.getUser();
      if (!authUser) throw new Error("Not signed in");

      // Read file as base64 and convert to ArrayBuffer
      const base64 = await FileSystem.readAsStringAsync(file.uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const arrayBuffer = decodeBase64(base64);

      const bucket = "support-attachments";
      const path = `${authUser.id}/${ticketId}/${file.name}`;

      const { error: uploadErr } = await supabase.storage
        .from(bucket)
        .upload(path, arrayBuffer, {
          contentType: file.mimeType || "application/octet-stream",
          upsert: true,
        });
      if (uploadErr) throw uploadErr;

      // Post a message that references the uploaded file
      const { error: msgErr } = await supabase.from("support_messages").insert({
        ticket_id: ticketId,
        sender_id: authUser.id,
        sender_role: "user",
        body: "(attachment)",
        attachments: [
          {
            bucket,
            path,
            name: file.name,
            type: file.mimeType || null,
          },
        ],
      });
      if (msgErr) throw msgErr;
    } catch (e) {
      Alert.alert("Upload failed", e?.message || "Could not upload file");
    }
  };

  const closeTicket = useCallback(async () => {
    try {
      if (!isUuid(ticketId)) return;
      setClosing(true);
      const { error } = await supabase
        .from("support_tickets")
        .update({ status: "closed" })
        .eq("id", ticketId);
      if (error) throw error;
      await load(); // <-- reload ticket and messages from server
      Alert.alert("Success", "This ticket has been closed.");
    } catch (e) {
      Alert.alert("Error", e?.message || "Could not close ticket");
    } finally {
      setClosing(false);
    }
  }, [ticketId, load]);

  const deleteTicket = useCallback(() => {
    if (!ticket) return;
    Alert.alert(
      "Delete Ticket",
      "Are you sure you want to permanently delete this ticket and all its messages? This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              // Only delete the ticket; messages will be deleted via ON DELETE CASCADE
              const { error } = await supabase.from("support_tickets").delete().eq("id", ticket.id);
              if (error) throw error;
              Alert.alert("Deleted", "Ticket deleted successfully.");
              router.push("/(app)/settings/help");
            } catch (e) {
              Alert.alert("Error", e?.message || "Could not delete ticket");
            }
          },
        },
      ]
    );
  }, [ticket, router]);

  const openAttachment = async (att) => {
    try {
      const { data, error } = await supabase
        .storage
        .from(att.bucket)
        .createSignedUrl(att.path, 300);
      if (error) throw error;
      const url = data?.signedUrl;
      if (!url) return;
      const can = await Linking.canOpenURL(url);
      if (can) Linking.openURL(url);
    } catch (e) {
      Alert.alert("Open failed", e?.message || "Could not open attachment");
    }
  };

  if (initialLoading) {
    return (
      <View style={styles.screen}>
        <View style={{ height: insets.top, backgroundColor: CARD }} />
        <View style={styles.header}>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.push("/(app)/settings/help")}>
            <Feather name="arrow-left" size={20} color={TEXT} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Support Ticket</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>Loading ticket...</Text>
        </View>
      </View>
    );
  }

  if (!ticket) {
    return (
      <View style={styles.screen}>
        <View style={{ height: insets.top, backgroundColor: CARD }} />
        <View style={styles.header}>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.push("/(app)/settings/help")}>
            <Feather name="arrow-left" size={20} color={TEXT} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Support Ticket</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>Ticket not found</Text>
        </View>
      </View>
    );
  }

  const statusColor = getStatusColor(ticket.status);

  return (
    <View style={styles.screen}>
      <View style={{ height: insets.top, backgroundColor: CARD }} />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.push("/(app)/settings/help")}>
          <Feather name="arrow-left" size={20} color={TEXT} />
        </TouchableOpacity>
        <View style={styles.headerContent}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {ticket.subject || "Support Ticket"}
          </Text>
          <View style={[styles.statusBadge, { backgroundColor: statusColor }]}>
            <Text style={styles.statusBadgeText}>
              {(ticket.status || "open").toUpperCase()
              }
            </Text>
          </View>
        </View>
        {ticket.status !== "closed" ? (
          <TouchableOpacity
            onPress={closeTicket}
            disabled={closing}
            style={[styles.actionBtn, closing && { opacity: 0.5 }]}
          >
            <Text style={styles.actionBtnText}>
              {closing ? "Closing..." : "Close"}
            </Text>
          </TouchableOpacity>
        ) : (
          <View style={{ width: 40 }} />
        )}
        {/* Delete button always visible */}
        <TouchableOpacity
          onPress={deleteTicket}
          style={styles.deleteBtn}
          activeOpacity={0.7}
        >
          <Feather name="trash-2" size={18} color="#dc2626" />
        </TouchableOpacity>
      </View>

      <View style={{ flex: 1 }}>
        {/* Messages */}
        <ScrollView
          ref={scrollRef}
          style={styles.messagesContainer}
          contentContainerStyle={styles.messagesContent}
          showsVerticalScrollIndicator={false}
          onContentSizeChange={() =>
            setTimeout(() => {
              try {
                scrollRef.current?.scrollToEnd({ animated: true });
              } catch {}
            }, 50)
          }
        >
          {messages.length === 0 ? (
            <View style={styles.emptyMessages}>
              <Text style={styles.emptyText}>
                No messages yet in this conversation.
              </Text>
            </View>
          ) : (
            messages.map((m) => {
              const mine = isMine(m);
              const isSystem = m.sender_role === "system";
              // Sent (user): right, blue. Received (admin): left, grey.
              const alignStyle = isSystem
                ? { justifyContent: "center" }
                : mine
                ? { justifyContent: "flex-end" }
                : { justifyContent: "flex-start" };
              const bubbleStyle = isSystem
                ? styles.messageBubbleSystem
                : mine
                ? styles.messageBubbleMine
                : styles.messageBubbleOther;
              const selfAlign = isSystem
                ? { alignSelf: "center" }
                : mine
                ? { alignSelf: "flex-end" }
                : { alignSelf: "flex-start" };
              return (
                <View
                  key={m.id}
                  style={[
                    styles.messageRow,
                    alignStyle,
                  ]}
                >
                  <View
                    style={[
                      styles.messageBubble,
                      bubbleStyle,
                      selfAlign,
                    ]}
                  >
                    {!!m.body && m.body !== "(attachment)" && (
                      <Text
                        style={[
                          styles.messageText,
                          mine && { color: "#fff" },
                          isSystem && { color: "#b45309" },
                        ]}
                      >
                        {m.body}
                      </Text>
                    )}

                    {Array.isArray(m.attachments) &&
                      m.attachments.length > 0 && (
                        <View style={styles.attachmentsContainer}>
                          {m.attachments.map((a, idx) => (
                            <TouchableOpacity
                              key={idx}
                              onPress={() => openAttachment(a)}
                              style={[
                                styles.attachmentBtn,
                                mine
                                  ? styles.attachmentBtnMine
                                  : styles.attachmentBtnOther,
                              ]}
                              activeOpacity={0.7}
                            >
                              <Feather
                                name="paperclip"
                                size={14}
                                color={mine ? "#fff" : BRAND}
                              />
                              <Text
                                style={[
                                  styles.attachmentText,
                                  mine
                                    ? styles.attachmentTextMine
                                    : styles.attachmentTextOther,
                                ]}
                                numberOfLines={1}
                              >
                                {a.name || "Attachment"}
                              </Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                      )}

                    <Text
                      style={[
                        styles.messageTime,
                        mine ? styles.messageTimeMine : styles.messageTimeOther,
                        isSystem && { color: "#b45309" },
                      ]}
                    >
                      {new Date(m.created_at).toLocaleString()}
                    </Text>
                  </View>
                </View>
              );
            })
          )}
          <View style={{ height: 12 }} />
        </ScrollView>

        {/* Composer */}
        {ticket.status !== "closed" ? (
          <View style={styles.composer}>
            <View style={styles.composerHeader}>
              <Text style={styles.composerTitle}>Reply to support</Text>
              <InfoButton
                title="Message Features"
                tips={[
                  "Type your reply in the text box below and tap Send.",
                  "Use the attachment button to include screenshots or documents.",
                  "You'll receive email notifications when support replies.",
                  "Close the ticket when your issue is resolved.",
                ]}
              />
            </View>

            <View style={styles.composerRow}>
              <TouchableOpacity onPress={pickAndUpload} style={styles.attachBtn}>
                <Feather name="paperclip" size={18} color={BRAND} />
              </TouchableOpacity>

              <TextInput
                style={styles.messageInput}
                value={body}
                onChangeText={setBody}
                placeholder="Type your reply..."
                placeholderTextColor={MUTED}
                multiline
                maxLength={2000}
              />

              <TouchableOpacity
                onPress={sendMessage}
                disabled={sending || body.trim().length === 0}
                style={[
                  styles.sendBtn,
                  (sending || body.trim().length === 0) && { opacity: 0.5 },
                ]}
                activeOpacity={0.8}
              >
                <Feather name="send" size={16} color="#fff" />
                <Text style={styles.sendText}>
                  {sending ? "Sending..." : "Send"}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <View style={styles.closedNotice}>
            <Feather name="lock" size={16} color={MUTED} />
            <Text style={styles.closedText}>This ticket has been closed</Text>
          </View>
        )}
      </View>
    </View>
  );
}

/* ---------- STYLES ---------- */
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },

  header: {
    backgroundColor: CARD,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
  },

  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },

  headerContent: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 16,
    gap: 12,
  },

  headerTitle: {
    fontSize: 16,
    fontWeight: "900",
    color: TEXT,
    flex: 1,
  },

  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },

  statusBadgeText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 10,
  },

  actionBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: DANGER + "10",
    borderWidth: 1,
    borderColor: DANGER + "30",
  },

  actionBtnText: {
    color: DANGER,
    fontWeight: "700",
    fontSize: 12,
  },

  deleteBtn: {
    marginLeft: 8,
    padding: 2,
    borderRadius: 6,
    backgroundColor: "#fee2e2",
    alignItems: "center",
    justifyContent: "center",
    width: 36,
    height: 36,
  },

  messagesContainer: { flex: 1 },
  messagesContent: { padding: 16 },

  emptyMessages: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 40,
  },
  emptyText: { color: MUTED, fontSize: 14, textAlign: "center" },

  messageRow: { marginBottom: 12, flexDirection: "row" },
  // Sent (user): right, blue
  messageBubbleMine: { backgroundColor: BRAND, borderColor: BRAND },
  // Received (admin): left, grey
  messageBubbleOther: { backgroundColor: "#f3f4f6", borderColor: BORDER },
  // System: center, orange
  messageBubbleSystem: { backgroundColor: "#fff7ed", borderColor: "#fed7aa" },
  messageBubble: {
    maxWidth: "85%",
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderWidth: 1,
  },
  messageText: { fontSize: 14, lineHeight: 20, color: TEXT },
  messageTime: { marginTop: 8, fontSize: 10 },
  messageTimeMine: { color: "#e6f0ff" },
  messageTimeOther: { color: MUTED },
  attachmentsContainer: { marginTop: 8, gap: 6 },
  attachmentBtn: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 8,
    alignSelf: "flex-start",
    gap: 6,
  },
  attachmentBtnMine: { backgroundColor: "rgba(255,255,255,0.15)" },
  attachmentBtnOther: { backgroundColor: BRAND + "10" },
  attachmentText: { fontSize: 12, fontWeight: "700", maxWidth: 180 },
  attachmentTextMine: { color: "#fff" },
  attachmentTextOther: { color: BRAND },
  composer: {
    backgroundColor: CARD,
    borderTopWidth: 1,
    borderTopColor: BORDER,
    padding: 16,
  },

  composerHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },

  composerTitle: { color: TEXT, fontWeight: "800", fontSize: 14 },

  composerRow: { flexDirection: "row", alignItems: "flex-end", gap: 12 },

  attachBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: "#f8fafc",
  },

  messageInput: {
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: TEXT,
    backgroundColor: "#fff",
    fontSize: 14,
  },

  sendBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: BRAND,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },

  sendText: { color: "#fff", fontWeight: "800", fontSize: 14 },

  closedNotice: {
    backgroundColor: "#f8fafc",
    borderTopWidth: 1,
    borderTopColor: BORDER,
    paddingVertical: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  closedText: { color: MUTED, fontWeight: "600", fontSize: 14 },

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
  modalWrap: { flex: 1, justifyContent: "center", alignItems: "center", padding: 16 },
  modalCard: {
    backgroundColor: CARD,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: BORDER,
    width: "92%",
    maxWidth: 480,
    ...Platform.select({
      ios: { shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 16, shadowOffset: { width: 0, height: 6 } },
      android: { elevation: 10 },
    }),
  },
  modalHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  smallBtn: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8, backgroundColor: "#f3f4f6" },
  smallBtnText: { color: TEXT, fontWeight: "700", fontSize: 12 },

  loadingContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 60,
  },

  loadingText: {
    color: MUTED,
    fontSize: 16,
    fontWeight: "600",
  },
});