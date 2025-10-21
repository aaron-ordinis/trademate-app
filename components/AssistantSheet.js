// components/AssistantSheet.js
import React, { useEffect, useRef, useState, useMemo } from "react";
import {
  View,
  Text,
  Modal,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Platform,
  KeyboardAvoidingView,
  Image,
  Pressable,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import useAssistant from "../lib/assistant/useAssistant";

const fabPng = require("../assets/images/fab.png");

const CARD = "#ffffff";
const TEXT = "#0b1220";
const MUTED = "#6b7280";
const BORDER = "#e6e9ee";
const BRAND = "#2a86ff";
const DANGER = "#dc2626";

const SUGGESTIONS = [
  "Show unpaid invoices this month",
  "What quotes are waiting on customers?",
  "How much did I receive last month?",
  "Create a support ticket about billing",
];

const QUICK_OPTIONS = [
  "Show unpaid invoices this month",
  "List all overdue invoices", 
  "What quotes are waiting on customers?",
  "Show quotes created this week",
  "How much did I receive last month?",
  "Show monthly revenue comparison",
  "What's my profit margin?",
  "Revenue by client analysis",
  "Create support ticket"
];

export default function AssistantSheet({ visible, onClose, context = "unknown" }) {
  const insets = useSafeAreaInsets();
  const [input, setInput] = useState("");
  const [creating, setCreating] = useState(false);
  const [ticketSubject, setTicketSubject] = useState("");
  const [ticketBody, setTicketBody] = useState("");
  const [quickActionsExpanded, setQuickActionsExpanded] = useState(false);
  const [clipboardIdx, setClipboardIdx] = useState(null); // Track which bot message is tapped for clipboard icon

  // Pass the screen context to the hook so the edge function gets body.screen
  const { messages, ask, busy, createTicket, clear } = useAssistant({
    screen: String(context || "unknown"),
  });

  const scrollRef = useRef(null);

  // Helper: last user question (used by Retry)
  const lastUserQuestion = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]?.role === "user" && String(messages[i]?.text || "").trim()) {
        return messages[i].text;
      }
    }
    return "";
  }, [messages]);

  // Auto-scroll when opened and whenever messages change
  useEffect(() => {
    if (!visible) return;
    const id = setTimeout(() => {
      try {
        scrollRef.current?.scrollToEnd({ animated: false });
      } catch {}
    }, 60);
    return () => clearTimeout(id);
  }, [visible, messages]);

  // Also scroll when content grows
  const onContentSizeChange = () => {
    try {
      scrollRef.current?.scrollToEnd({ animated: true });
    } catch {}
  };

  const send = async () => {
    const q = String(input || "");
    if (!q.trim()) return;
    setInput("");
    await ask(q);
  };

  const quick = async (q) => {
    setInput("");
    await ask(q);
  };

  const onRetry = async () => {
    const q = String(lastUserQuestion || "");
    if (!q.trim()) return;
    await ask(q);
  };

  const openCreateTicket = () => {
    setCreating(true);
    setTicketSubject("");
    setTicketBody("");
  };

  const submitTicket = async () => {
    if (!ticketSubject.trim() || !ticketBody.trim()) return;
    const ok = await createTicket(ticketSubject.trim(), ticketBody.trim());
    if (ok) setCreating(false);
  };

  // Detect if last message is an error or disconnect
  const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null;
  const showRefresh =
    !busy &&
    lastMessage &&
    lastMessage.role === "assistant" &&
    (
      lastMessage.error ||
      /fail|error|disconnect|unavailable|timeout/i.test(lastMessage.text || "")
    );

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={styles.backdropPress} onPress={onClose} />
        <View style={styles.popup}>
          {/* Header */}
          <View style={styles.header}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              {/* Add FAB image in header */}
              <Image
                source={fabPng}
                style={styles.headerIcon}
                resizeMode="cover"
              />
              <View>
                <Text style={styles.title}>AI Assistant</Text>
                {!!context && (
                  <Text style={styles.subtitle}>Help with {String(context)}</Text>
                )}
              </View>
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              {/* Clear chat - match app button style */}
              {messages.length > 0 && !creating && (
                <TouchableOpacity
                  onPress={clear}
                  style={styles.headerBtn}
                  disabled={busy}
                  activeOpacity={0.9}
                >
                  <Feather name="trash-2" size={14} color={busy ? MUTED : DANGER} />
                </TouchableOpacity>
              )}
              <TouchableOpacity onPress={onClose} style={styles.headerBtn}>
                <Feather name="x" size={16} color={TEXT} />
              </TouchableOpacity>
            </View>
          </View>

          {/* Body */}
          <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
            {creating ? (
              // ...existing code for ticket creation...
              <View style={styles.card}>
                <Text style={styles.sectionTitle}>Create Support Ticket</Text>

                <Text style={styles.label}>Subject</Text>
                <TextInput
                  value={ticketSubject}
                  onChangeText={setTicketSubject}
                  style={styles.input}
                  placeholder="Brief title"
                  placeholderTextColor={MUTED}
                />

                <Text style={styles.label}>Description</Text>
                <TextInput
                  value={ticketBody}
                  onChangeText={setTicketBody}
                  style={[styles.input, styles.textArea]}
                  placeholder="Describe the problem..."
                  placeholderTextColor={MUTED}
                  multiline
                />

                <View style={styles.row}>
                  <TouchableOpacity onPress={submitTicket} style={styles.primaryBtn}>
                    <Text style={styles.primaryBtnText}>Create Ticket</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => setCreating(false)}
                    style={styles.secondaryBtn}
                  >
                    <Text style={styles.secondaryBtnText}>Cancel</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <>
                {/* Quick Actions Single Dropdown */}
                <View style={styles.quickActions}>
                  <TouchableOpacity
                    onPress={() => setQuickActionsExpanded(!quickActionsExpanded)}
                    style={[
                      styles.quickMainBtn,
                      quickActionsExpanded && styles.quickMainBtnExpanded
                    ]}
                    disabled={busy}
                  >
                    <Feather name="zap" size={16} color={BRAND} />
                    <Text style={styles.quickMainBtnText}>Quick Actions</Text>
                    <Feather 
                      name={quickActionsExpanded ? "chevron-up" : "chevron-down"} 
                      size={16} 
                      color={MUTED} 
                    />
                  </TouchableOpacity>
                  
                  {quickActionsExpanded && (
                    <View style={styles.quickDropdown}>
                      {QUICK_OPTIONS.map((option, idx) => (
                        <TouchableOpacity
                          key={idx}
                          onPress={() => {
                            setQuickActionsExpanded(false);
                            if (option === "Create support ticket") {
                              openCreateTicket();
                            } else {
                              quick(option);
                            }
                          }}
                          style={[
                            styles.quickOption,
                            idx === QUICK_OPTIONS.length - 1 && styles.quickOptionLast
                          ]}
                          disabled={busy}
                        >
                          <Text style={styles.quickOptionText}>{option}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}
                </View>

                {/* Messages */}
                <ScrollView
                  ref={scrollRef}
                  style={styles.timeline}
                  onContentSizeChange={onContentSizeChange}
                  contentContainerStyle={{ paddingBottom: 8 }}
                  showsVerticalScrollIndicator={false}
                >
                  {messages.length === 0 ? (
                    <View style={styles.emptyState}>
                      <Image
                        source={fabPng}
                        style={styles.emptyIcon}
                        resizeMode="cover"
                      />
                      <Text style={styles.emptyTitle}>Ask me anything</Text>
                      <Text style={styles.emptyText}>
                        I can help with your quotes, jobs, invoices, and more.
                      </Text>
                    </View>
                  ) : null}

                  {messages.map((m, idx) => {
                    const mine = m.role === "user";
                    const showClipboard = !mine && clipboardIdx === idx;
                    const showRefreshBtn = showRefresh && idx === messages.length - 1 && !mine;
                    return (
                      <View
                        key={idx}
                        style={[
                          styles.msgRow,
                          mine ? styles.msgRowMine : styles.msgRowBot, // ensures alignment
                        ]}
                      >
                        <TouchableOpacity
                          activeOpacity={mine ? 1 : 0.7}
                          onPress={() => {
                            if (!mine) setClipboardIdx(idx === clipboardIdx ? null : idx);
                          }}
                          style={[
                            { flexDirection: "row", alignItems: "center" },
                            mine && { justifyContent: "flex-end", flex: 1 }, // user messages right
                            !mine && { justifyContent: "flex-start", flex: 1 }, // bot messages left
                          ]}
                        >
                          <View
                            style={[
                              styles.msgBubble,
                              mine ? styles.msgBubbleMine : styles.msgBubbleBot,
                              showClipboard || showRefreshBtn ? styles.msgBubbleWithActions : null,
                            ]}
                          >
                            <Text
                              style={[
                                styles.msgText,
                                mine ? styles.msgTextMine : styles.msgTextBot,
                              ]}
                            >
                              {m.text}
                            </Text>
                          </View>
                        </TouchableOpacity>
                        {(showClipboard || showRefreshBtn) && (
                          <View style={styles.bubbleActionsRow}>
                            {showClipboard && (
                              <TouchableOpacity
                                onPress={async () => {
                                  await Clipboard.setStringAsync(m.text || "");
                                  setClipboardIdx(null);
                                }}
                                activeOpacity={0.8}
                                style={styles.bubbleActionIcon}
                              >
                                <Feather name="clipboard" size={18} color={TEXT} />
                              </TouchableOpacity>
                            )}
                            {showRefreshBtn && (
                              <TouchableOpacity
                                onPress={onRetry}
                                style={styles.bubbleActionIcon}
                                activeOpacity={0.9}
                              >
                                <Feather name="refresh-ccw" size={18} color={TEXT} />
                              </TouchableOpacity>
                            )}
                          </View>
                        )}
                      </View>
                    );
                  })}

                  {/* Typing indicator */}
                  {busy && (
                    <View style={[styles.msgRow, styles.msgRowBot]}>
                      <View style={[styles.msgBubble, styles.msgBubbleBot]}>
                        <Text style={[styles.msgText, styles.msgTextBot]}>…</Text>
                      </View>
                    </View>
                  )}
                </ScrollView>
                {/* Remove previous actionBar for retry */}
              </>
            )}
          </ScrollView>

          {/* Composer - match app input style */}
          {!creating && (
            <View style={styles.composer}>
              <View style={styles.inputContainer}>
                <TextInput
                  value={input}
                  onChangeText={setInput}
                  placeholder={busy ? "Thinking..." : "Ask about your business..."}
                  placeholderTextColor={MUTED}
                  style={styles.composerInput}
                  editable={!busy}
                  multiline
                />
                <TouchableOpacity
                  onPress={send}
                  disabled={busy || !String(input).trim()}
                  style={[
                    styles.sendBtn,
                    (busy || !String(input).trim()) && { opacity: 0.5 },
                  ]}
                >
                  <Feather name="send" size={14} color="#fff" />
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 16,
    backgroundColor: "transparent", // Completely transparent
  },
  backdropPress: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "transparent", // Remove any backdrop color
  },
  popup: {
    backgroundColor: CARD,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BORDER,
    width: "100%",
    maxWidth: 480, // Increased from 400
    height: "80%", // Increased from 70%
    maxHeight: 700, // Increased from 600
    zIndex: 1,
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOpacity: 0.15,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: 8 },
      },
      android: { elevation: 10 },
    }),
  },
  header: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  headerIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
  },
  title: { color: TEXT, fontWeight: "900", fontSize: 16 },
  subtitle: { color: MUTED, fontSize: 11, fontWeight: "600", marginTop: 1 },
  headerBtn: {
    height: 32,
    width: 32,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: CARD,
  },
  
  body: { 
    flex: 1,
    paddingHorizontal: 14, 
    paddingTop: 10,
  },
  
  quickActions: { marginBottom: 14, position: "relative", zIndex: 100 },
  quickMainBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: "#f8fafc",
  },
  quickMainBtnExpanded: {
    borderBottomLeftRadius: 4,
    borderBottomRightRadius: 4,
  },
  quickMainBtnText: { color: TEXT, fontWeight: "700", fontSize: 14, flex: 1 },
  quickDropdown: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderTopWidth: 0,
    borderColor: BORDER,
    borderBottomLeftRadius: 12,
    borderBottomRightRadius: 12,
    marginTop: -1,
    zIndex: 200,
    maxHeight: 200,
    // Add card shadow to elevate above content
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOpacity: 0.1,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 4 },
      },
      android: { elevation: 8 },
    }),
  },
  quickOption: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: BORDER,
    backgroundColor: "#fff", // Ensure solid background
  },
  quickOptionLast: {
    borderBottomWidth: 0,
  },
  quickOptionText: { color: TEXT, fontSize: 13, lineHeight: 18 },
  
  timeline: { flex: 1, marginBottom: 8, zIndex: 1 }, // Lower z-index than dropdown
  msgRow: { marginBottom: 8, flexDirection: "row" },
  msgRowMine: { justifyContent: "flex-end", flex: 1 }, // user messages right
  msgRowBot: { justifyContent: "flex-start", flex: 1 }, // bot messages left
  msgBubble: {
    maxWidth: "82%",
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
  },
  msgBubbleMine: { backgroundColor: BRAND, borderColor: BRAND },
  msgBubbleBot: { backgroundColor: "#f8fafc", borderColor: BORDER },
  msgText: { fontSize: 13, lineHeight: 18 }, // Smaller font
  msgTextMine: { color: "#fff", fontWeight: "500" },
  msgTextBot: { color: TEXT },
  
  emptyState: {
    alignItems: "center",
    paddingVertical: 24,
  },
  emptyIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    marginBottom: 10,
  },
  emptyTitle: { color: TEXT, fontWeight: "900", fontSize: 14, marginBottom: 3 },
  emptyText: { color: MUTED, textAlign: "center", lineHeight: 18, fontSize: 12 },
  
  // Remove actionBar and refreshIconBtn styles
  // Add inline refresh icon style
  refreshIconInline: {
    marginTop: 2,
    marginLeft: 6,
    alignSelf: "flex-start",
    padding: 0,
  },
  
  composer: {
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 14,
    borderTopWidth: 1,
    borderTopColor: BORDER,
  },
  inputContainer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 6,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 10,
    backgroundColor: "#fff",
    paddingRight: 6,
  },
  composerInput: {
    flex: 1,
    minHeight: 38,
    maxHeight: 100,
    paddingHorizontal: 10,
    paddingVertical: 10,
    color: TEXT,
    fontSize: 13,
  },
  sendBtn: {
    width: 32,
    height: 32,
    borderRadius: 6,
    backgroundColor: BRAND,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 3,
  },

  // Ticket form
  card: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
    padding: 12,
  },
  sectionTitle: { color: TEXT, fontWeight: "900", marginBottom: 8 },
  label: {
    color: MUTED,
    fontWeight: "700",
    marginTop: 6,
    marginBottom: 6,
    fontSize: 12,
  },
  input: {
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 10,
    color: TEXT,
    backgroundColor: "#fff",
  },
  textArea: { minHeight: 100 },
  row: { flexDirection: "row", gap: 10, marginTop: 12 },
  primaryBtn: {
    flex: 1,
    backgroundColor: BRAND,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
  },
  primaryBtnText: { color: "#fff", fontWeight: "900" },
  secondaryBtn: {
    flex: 1,
    backgroundColor: "#f8fafc",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
  },
  secondaryBtnText: { color: TEXT, fontWeight: "900" },

  clipboardIcon: {
    marginLeft: 4,
    alignSelf: "center",
    backgroundColor: "#f8fafc",
    borderRadius: 6,
    padding: 4,
    borderWidth: 1,
    borderColor: BORDER,
    // subtle shadow
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOpacity: 0.08,
        shadowRadius: 4,
        shadowOffset: { width: 0, height: 2 },
      },
      android: { elevation: 2 },
    }),
  },
  clipboardIconBottomLeft: {
    position: "absolute",
    left: 4,
    bottom: 4,
    // Remove background/border for minimal look
    zIndex: 10,
  },
  clipboardIconSlide: {
    alignSelf: "flex-start",
    marginTop: 2,
    marginLeft: 12,
    // Animate slide up (simple fade-in and translateY)
    // You can use Animated for a real slide, but for simplicity:
    // Just position below the bubble
  },
  msgBubbleWithActions: {
    minHeight: 54, // increase bubble height to allow space for actions below
    paddingBottom: 28, // add padding so actions don't overlap bubble
  },
  bubbleActionsRow: {
    flexDirection: "row",
    alignItems: "center",
    position: "absolute",
    left: 0,
    bottom: 4, // now inside the bubble's extra padding
    zIndex: 20,
    paddingLeft: 4,
    gap: 8,
  },
  bubbleActionIcon: {
    padding: 4,
  },
});