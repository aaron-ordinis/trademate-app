// app/(app)/settings/help.js
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  StatusBar,
  Platform,
  ScrollView,
  TouchableOpacity,
  Alert,
  TextInput,
  Modal,
  RefreshControl,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import * as NavigationBar from "expo-navigation-bar";
import * as SystemUI from "expo-system-ui";
import { Feather } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { supabase } from "../../../lib/supabase";

/* ---------- THEME ---------- */
const CARD = "#ffffff";
const TEXT = "#0b1220";
const MUTED = "#6b7280";
const BORDER = "#e6e9ee";
const BRAND = "#2a86ff";
const BG = "#ffffff";
const SUCCESS = "#10b981";
const WARNING = "#f59e0b";
const CLOSED = "#94a3b8";

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
  const s = String(status || "").toLowerCase();
  if (s === "open") return SUCCESS;
  if (s === "pending") return WARNING;
  if (s === "closed" || s === "resolved") return CLOSED;
  return CLOSED;
}

export default function HelpScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [tickets, setTickets] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);

  // compose card
  const [composeOpen, setComposeOpen] = useState(false);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const subjectTrim = useMemo(() => subject.trim(), [subject]);
  const messageTrim = useMemo(() => message.trim(), [message]);
  const canSubmit = subjectTrim.length > 2 && messageTrim.length > 2;

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

  // Add unread count to each ticket
  const load = useCallback(async () => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from("support_tickets")
        .select(
          "id, subject, status, priority, last_message_at, created_at, unread_user_count"
        )
        .eq("user_id", user.id)
        .order("last_message_at", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      setTickets(Array.isArray(data) ? data : []);
    } catch (e) {
      if (!refreshing) {
        Alert.alert("Error", e?.message || "Failed to load support tickets");
      }
    } finally {
      setInitialLoading(false);
      setRefreshing(false);
    }
  }, [refreshing]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
  }, [load]);

  // Create ticket then navigate with UUID param
  const createTicket = useCallback(async () => {
    try {
      if (!canSubmit || submitting) return;
      setSubmitting(true);

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        Alert.alert("Authentication required", "Please sign in.");
        return;
      }

      // Insert ticket
      const { data: t, error: e1 } = await supabase
        .from("support_tickets")
        .insert({
          user_id: user.id,
          subject: subjectTrim.slice(0, 140),
          status: "open",
          priority: "normal",
        })
        .select("id")
        .single();
      if (e1) throw e1;

      // Insert initial message
      const { error: e2 } = await supabase.from("support_messages").insert({
        ticket_id: t.id,
        sender_id: user.id,
        sender_role: "user",
        body: messageTrim.slice(0, 5000),
      });
      if (e2) throw e2;

      // Reset compose
      setComposeOpen(false);
      setSubject("");
      setMessage("");

      // Refresh list and jump in
      await load();
      router.push({
        pathname: "/(app)/settings/help/[ticketId]",
        params: { ticketId: t.id },
      });
    } catch (e) {
      Alert.alert("Error", e?.message || "Could not create support ticket");
    } finally {
      setSubmitting(false);
    }
  }, [canSubmit, submitting, subjectTrim, messageTrim, load, router]);

  // Close ticket handler
  const closeTicket = useCallback(async (ticketId) => {
    try {
      const { error } = await supabase
        .from("support_tickets")
        .update({ status: "closed" })
        .eq("id", ticketId);
      if (error) throw error;
      await load();
      Alert.alert("Ticket closed", "This ticket has been closed.");
    } catch (e) {
      Alert.alert("Error", e?.message || "Could not close ticket");
    }
  }, [load]);

  // Delete ticket handler
  const deleteTicket = useCallback(async (ticketId) => {
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
              const { error } = await supabase.from("support_tickets").delete().eq("id", ticketId);
              if (error) throw error;
              await load();
              Alert.alert("Deleted", "Ticket deleted successfully.");
            } catch (e) {
              Alert.alert("Error", e?.message || "Could not delete ticket");
            }
          },
        },
      ]
    );
  }, [load]);

  // Separate open, pending, and closed tickets
  const openTickets = useMemo(
    () => tickets.filter((t) => (t.status || "").toLowerCase() === "open"),
    [tickets]
  );
  const pendingTickets = useMemo(
    () => tickets.filter((t) => (t.status || "").toLowerCase() === "pending"),
    [tickets]
  );
  const closedTickets = useMemo(
    () => tickets.filter((t) => (t.status || "").toLowerCase() === "closed"),
    [tickets]
  );

  if (initialLoading) {
    return (
      <View style={styles.screen}>
        <View style={{ height: insets.top, backgroundColor: CARD }} />

        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.push("/(app)/settings/")}>
            <Feather name="arrow-left" size={20} color={TEXT} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Help & Support</Text>
          <View style={{ width: 40 }} />
        </View>

        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>Loading support tickets...</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <View style={{ height: insets.top, backgroundColor: CARD }} />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.push("/(app)/settings/")}>
          <Feather name="arrow-left" size={20} color={TEXT} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Help & Support</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        style={styles.content}
        contentContainerStyle={styles.contentContainer}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={BRAND}
            colors={[BRAND]}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        {/* New Ticket */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>Create Support Ticket</Text>
            <InfoButton
              title="Support System"
              tips={[
                "Create tickets for technical issues, billing questions, or feature requests.",
                "Replies arrive here in the app (and we may also email you).",
                "Attach screenshots/documents inside a ticket thread.",
                "We usually reply within one working day.",
              ]}
            />
          </View>

          {!composeOpen ? (
            <>
              <Text style={styles.helpText}>
                Need help? Create a support ticket and our team will get back to
                you quickly.
              </Text>
              <TouchableOpacity
                onPress={() => setComposeOpen(true)}
                style={styles.primaryBtn}
                activeOpacity={0.8}
              >
                <Feather name="plus" size={16} color="#fff" />
                <Text style={styles.primaryBtnText}>New Support Ticket</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Subject</Text>
                <TextInput
                  value={subject}
                  onChangeText={setSubject}
                  placeholder="Brief description of your issue"
                  placeholderTextColor={MUTED}
                  style={styles.input}
                  maxLength={140}
                  autoCapitalize="sentences"
                  returnKeyType="next"
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Description</Text>
                <TextInput
                  value={message}
                  onChangeText={setMessage}
                  placeholder="Please describe your issue in detail..."
                  placeholderTextColor={MUTED}
                  style={[styles.input, styles.textArea]}
                  multiline
                  textAlignVertical="top"
                  maxLength={5000}
                />
              </View>

              <View style={styles.buttonRow}>
                <TouchableOpacity
                  onPress={createTicket}
                  disabled={!canSubmit || submitting}
                  style={[
                    styles.primaryBtn,
                    (!canSubmit || submitting) && { opacity: 0.5 },
                  ]}
                  activeOpacity={0.8}
                >
                  <Text style={styles.primaryBtnText}>
                    {submitting ? "Creating..." : "Create Ticket"}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => {
                    setComposeOpen(false);
                    setSubject("");
                    setMessage("");
                  }}
                  style={styles.secondaryBtn}
                  activeOpacity={0.8}
                >
                  <Text style={styles.secondaryBtnText}>Cancel</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>

        {/* Open Tickets */}
        {openTickets.length > 0 && (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>
                Open Tickets ({openTickets.length})
              </Text>
              <InfoButton
                title="Open Tickets"
                tips={[
                  "Open: Waiting for a response or in progress.",
                  "Tap to view or reply.",
                  "You can close a ticket when resolved.",
                ]}
              />
            </View>
            {openTickets.map((ticket) => (
              <TicketItem
                key={ticket.id}
                ticket={ticket}
                onPress={() =>
                  router.push({
                    pathname: "/(app)/settings/help/[ticketId]",
                    params: { ticketId: ticket.id },
                  })
                }
                onClose={closeTicket}
                onDelete={deleteTicket}
              />
            ))}
          </View>
        )}

        {/* Pending Tickets */}
        {pendingTickets.length > 0 && (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>
                Pending Tickets ({pendingTickets.length})
              </Text>
              <InfoButton
                title="Pending Tickets"
                tips={[
                  "Pending: Waiting for your reply.",
                  "Tap to view or reply.",
                  "You can close a ticket when resolved.",
                ]}
              />
            </View>
            {pendingTickets.map((ticket) => (
              <TicketItem
                key={ticket.id}
                ticket={ticket}
                onPress={() =>
                  router.push({
                    pathname: "/(app)/settings/help/[ticketId]",
                    params: { ticketId: ticket.id },
                  })
                }
                onClose={closeTicket}
                onDelete={deleteTicket}
              />
            ))}
          </View>
        )}

        {/* Closed Tickets */}
        {closedTickets.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>
              Previous Tickets ({closedTickets.length})
            </Text>
            {closedTickets.slice(0, 10).map((ticket) => (
              <TicketItem
                key={ticket.id}
                ticket={ticket}
                onPress={() =>
                  router.push({
                    pathname: "/(app)/settings/help/[ticketId]",
                    params: { ticketId: ticket.id },
                  })
                }
                dimmed
                onDelete={deleteTicket}
              />
            ))}
            {closedTickets.length > 10 && (
              <Text style={styles.moreText}>
                And {closedTickets.length - 10} more closed tickets...
              </Text>
            )}
          </View>
        )}

        {/* Empty state */}
        {tickets.length === 0 && (
          <View style={styles.emptyState}>
            <Feather name="help-circle" size={48} color={MUTED} />
            <Text style={styles.emptyTitle}>No support tickets</Text>
            <Text style={styles.emptySubtitle}>
              Create your first support ticket to get help with any issues.
            </Text>
          </View>
        )}

        <View style={styles.footerNote}>
          <Text style={styles.footerText}>
            You can attach files (images, PDFs) within each ticket conversation.
            Please avoid sharing sensitive passwords or personal information.
          </Text>
        </View>

        <View style={{ height: 20 }} />
      </ScrollView>
    </View>
  );
}

function TicketItem({ ticket, onPress, dimmed = false, onClose, onDelete }) {
  const statusColor = getStatusColor(ticket.status);
  const dateStr = new Date(
    ticket.last_message_at || ticket.created_at
  ).toLocaleDateString();
  const unread = ticket.unread_user_count > 0 ? ticket.unread_user_count : 0;

  return (
    <TouchableOpacity
      style={[styles.ticketItem, dimmed && styles.dimmedItem]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={styles.ticketContent}>
        <Text
          style={[styles.ticketTitle, dimmed && styles.dimmedText]}
          numberOfLines={1}
        >
          {ticket.subject || "No subject"}
        </Text>
        <Text style={[styles.ticketDate, dimmed && styles.dimmedText]}>
          Last update: {dateStr}
        </Text>
      </View>

      <View style={styles.ticketActions}>
        {/* Blue notification dot with unread count */}
        {unread > 0 && (
          <View style={styles.unreadDotWrap}>
            <View style={styles.unreadDot}>
              <Text style={styles.unreadDotText}>
                {unread > 9 ? "9+" : unread}
              </Text>
            </View>
          </View>
        )}
        <View style={[styles.statusBadge, { backgroundColor: statusColor }]}>
          <Text style={styles.statusBadgeText}>
            {(ticket.status || "open").toUpperCase()}
          </Text>
        </View>
        {/* Close button for open tickets */}
        {onClose && (ticket.status || "").toLowerCase() === "open" && (
          <TouchableOpacity
            onPress={() => onClose(ticket.id)}
            style={styles.closeBtn}
            activeOpacity={0.7}
          >
            <Feather name="x-circle" size={18} color={WARNING} />
          </TouchableOpacity>
        )}
        {/* Delete button for all tickets */}
        {onDelete && (
          <TouchableOpacity
            onPress={() => onDelete(ticket.id)}
            style={styles.deleteBtn}
            activeOpacity={0.7}
          >
            <Feather name="trash-2" size={18} color="#dc2626" />
          </TouchableOpacity>
        )}
      </View>

      <Feather name="chevron-right" size={16} color={MUTED} />
    </TouchableOpacity>
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
    justifyContent: "space-between",
  },

  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },

  headerTitle: {
    fontSize: 18,
    fontWeight: "900",
    color: TEXT,
    flex: 1,
    textAlign: "center",
    marginHorizontal: 16,
  },

  content: { flex: 1 },
  contentContainer: { padding: 16 },

  card: {
    backgroundColor: CARD,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 16,
    marginBottom: 16,
    ...Platform.select({
      ios: {
        shadowColor: "#0b1220",
        shadowOpacity: 0.06,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 4 },
      },
      android: { elevation: 3 },
    }),
  },

  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },

  cardTitle: {
    color: TEXT,
    fontWeight: "900",
    fontSize: 16,
    marginBottom: 12,
  },

  helpText: {
    color: MUTED,
    fontSize: 14,
    marginBottom: 16,
    lineHeight: 20,
  },

  primaryBtn: {
    backgroundColor: BRAND,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  primaryBtnText: { color: "#fff", fontWeight: "800", fontSize: 14 },

  buttonRow: { flexDirection: "row", gap: 12 },

  secondaryBtn: {
    flex: 1,
    backgroundColor: "#f8fafc",
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
    borderWidth: 1,
    borderColor: BORDER,
  },
  secondaryBtnText: { color: TEXT, fontWeight: "800", fontSize: 14 },

  inputGroup: { marginBottom: 16 },
  inputLabel: { color: TEXT, fontWeight: "700", marginBottom: 6, fontSize: 14 },
  input: {
    backgroundColor: CARD,
    color: TEXT,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: BORDER,
    fontSize: 14,
  },
  textArea: { minHeight: 100, paddingTop: 12 },

  ticketItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#f8fafc",
    gap: 12,
  },
  dimmedItem: { opacity: 0.6 },
  ticketContent: { flex: 1 },
  ticketTitle: { color: TEXT, fontWeight: "700", fontSize: 14, marginBottom: 4 },
  ticketDate: { color: MUTED, fontSize: 12 },
  dimmedText: { color: MUTED },
  ticketActions: { alignItems: "center", flexDirection: "row", gap: 4 },
  unreadDotWrap: {
    marginRight: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  unreadDot: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: BRAND,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  unreadDotText: {
    color: "#fff",
    fontWeight: "bold",
    fontSize: 11,
    textAlign: "center",
  },
  closeBtn: {
    marginRight: 2,
    padding: 2,
    borderRadius: 6,
    backgroundColor: "#fef9c3",
  },
  deleteBtn: {
    marginRight: 2,
    padding: 2,
    borderRadius: 6,
    backgroundColor: "#fee2e2",
  },

  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    marginRight: 8,
  },
  statusBadgeText: { color: "#fff", fontWeight: "700", fontSize: 10 },

  moreText: {
    color: MUTED,
    fontSize: 12,
    fontStyle: "italic",
    textAlign: "center",
    marginTop: 8,
  },

  emptyState: { alignItems: "center", justifyContent: "center", paddingVertical: 60 },
  emptyTitle: { color: TEXT, fontWeight: "800", fontSize: 18, marginTop: 16, marginBottom: 8 },
  emptySubtitle: { color: MUTED, fontSize: 14, textAlign: "center", lineHeight: 20 },

  footerNote: {
    backgroundColor: "#f8fafc",
    borderRadius: 12,
    padding: 12,
    marginTop: 8,
  },
  footerText: { color: MUTED, fontSize: 12, textAlign: "center", lineHeight: 16 },

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

  /* Info modal styles */
  modalBackdrop: {
    position: "absolute",
    inset: 0,
    backgroundColor: "rgba(0,0,0,0.35)",
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
      ios: {
        shadowColor: "#000",
        shadowOpacity: 0.15,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: 6 },
      },
      android: { elevation: 10 },
    }),
  },
  modalHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  smallBtn: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: "#f3f4f6",
  },
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