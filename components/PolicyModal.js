// app/components/PolicyModal.js
import React, { useState } from "react";
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Platform,
  StatusBar,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Linking from "expo-linking";
import * as Haptics from "expo-haptics";
import { Feather } from "@expo/vector-icons";
import Markdown from "react-native-markdown-display";

/* THEME */
const BRAND = "#2a86ff";
const TEXT = "#0b1220";
const MUTED = "#6b7280";
const CARD = "#ffffff";
const BORDER = "#e6e9ee";

export default function PolicyModal({
  visible,
  title = "Policy",
  content = "",
  onClose,
}) {
  const [scrolledToBottom, setScrolledToBottom] = useState(false);
  const [acceptEnabled, setAcceptEnabled] = useState(true);
  const [containerHeight, setContainerHeight] = useState(0);
  const [contentHeight, setContentHeight] = useState(0);

  const openWebsite = async () => {
    if (!websiteUrl) return;
    try { await Linking.openURL(websiteUrl); } catch {}
  };

  const handleAccept = () => {
    if (!acceptEnabled) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onAccept?.();
  };

  const handleClose = () => {
    Haptics.selectionAsync();
    onClose?.();
  };

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <View style={styles.container}>
          <View style={styles.header}>
            <Text style={styles.title}>{title}</Text>
            <TouchableOpacity style={styles.closeButton} onPress={onClose}>
              <Text style={{ fontWeight: "bold", color: TEXT }}>Close</Text>
            </TouchableOpacity>
          </View>
          <ScrollView style={styles.contentBox}>
            <Markdown style={markdownStyles}>{content}</Markdown>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "transparent", // fully transparent, no dim
    justifyContent: "center",
    alignItems: "center",
    padding: 16,
  },
  container: {
    backgroundColor: CARD,
    borderRadius: 16,
    width: "95%",
    maxWidth: 500,
    padding: 16,
    borderWidth: 1,
    borderColor: BORDER,
    ...Platform.select({
      ios: { shadowColor: "#000", shadowOpacity: 0.12, shadowRadius: 16, shadowOffset: { width: 0, height: 6 } },
      android: { elevation: 8 },
    }),
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  title: { fontSize: 18, fontWeight: "bold", color: TEXT, flex: 1 },
  closeButton: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: "#f3f4f6",
  },
  contentBox: {
    maxHeight: 400,
  },
  contentText: {
    color: TEXT,
    fontSize: 15,
    lineHeight: 22,
  },
});

const markdownStyles = {
  body: { color: TEXT, fontSize: 15, lineHeight: 22, fontFamily: Platform.OS === "ios" ? "System" : "Roboto" },
  heading1: { color: TEXT, fontSize: 22, fontWeight: "900", marginTop: 16, marginBottom: 12, lineHeight: 28 },
  heading2: { color: TEXT, fontSize: 18, fontWeight: "800", marginTop: 14, marginBottom: 8, lineHeight: 24 },
  heading3: { color: TEXT, fontSize: 16, fontWeight: "700", marginTop: 12, marginBottom: 6, lineHeight: 22 },
  paragraph: { marginBottom: 12, lineHeight: 22 },
  bullet_list: { marginBottom: 12 },
  bullet_list_icon: { color: BRAND, marginRight: 8, marginTop: 2, fontSize: 14 },
  bullet_list_content: { flex: 1, color: TEXT, lineHeight: 22 },
  ordered_list_icon: { color: BRAND, marginRight: 8, marginTop: 2, fontSize: 14, fontWeight: "600" },
  strong: { color: TEXT, fontWeight: "800" },
  em: { fontStyle: "italic", color: TEXT },
  link: { color: BRAND, textDecorationLine: "underline", fontWeight: "600" },
  code_inline: { backgroundColor: "#f1f5f9", color: TEXT, paddingHorizontal: 4, paddingVertical: 2, borderRadius: 4, fontSize: 13 },
  blockquote: {
    backgroundColor: "#f8fafc", borderLeftWidth: 4, borderLeftColor: BRAND,
    paddingLeft: 12, paddingVertical: 8, marginVertical: 8, borderRadius: 4,
  },
};