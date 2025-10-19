// app/components/PolicyModal.js
import React, { useState } from "react";
import {
  View,
  Text,
  Modal,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Platform,
  Dimensions,
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
  content = "",          // <-- pass plain markdown here
  websiteUrl,           // optional external link
  showAccept = false,   // optional: force scroll to enable Accept
  dimmed = false,       // keep false for no background dim
  onAccept,
  onClose,
}) {
  const [scrolledToBottom, setScrolledToBottom] = useState(false);
  const [acceptEnabled, setAcceptEnabled] = useState(!showAccept);
  const [containerHeight, setContainerHeight] = useState(0);
  const [contentHeight, setContentHeight] = useState(0);

  const { height } = Dimensions.get("window");
  const maxHeight = Math.min(height * 0.82, 620);

  const reevaluateFit = (cH, contH) => {
    if (!showAccept) return;
    if (!cH || !contH) return;
    if (cH <= contH + 1) {
      if (!acceptEnabled) Haptics.selectionAsync();
      setScrolledToBottom(true);
      setAcceptEnabled(true);
    }
  };

  const handleScroll = (e) => {
    if (!showAccept) return;
    const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
    const atEnd = contentOffset.y + layoutMeasurement.height >= contentSize.height - 16;
    if (atEnd && !scrolledToBottom) {
      setScrolledToBottom(true);
      setAcceptEnabled(true);
      Haptics.selectionAsync();
    }
  };

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
      statusBarTranslucent={Platform.OS === "android"}
      onRequestClose={handleClose}
      hardwareAccelerated
    >
      {/* No blur/dim unless dimmed=true */}
      <StatusBar backgroundColor={dimmed ? "rgba(0,0,0,0.5)" : "transparent"} barStyle="light-content" />
      <View style={[styles.backdrop, dimmed ? styles.backdropDim : styles.backdropClear]}>
        <SafeAreaView style={styles.safeArea}>
          <View style={[styles.container, { maxHeight }]}>
            {/* Header */}
            <View style={styles.header}>
              <View style={styles.headerContent}>
                <Text style={styles.title}>{title}</Text>
                <TouchableOpacity style={styles.closeButton} onPress={handleClose} activeOpacity={0.7}>
                  <Feather name="x" size={18} color={TEXT} />
                </TouchableOpacity>
              </View>
            </View>

            {/* Content */}
            <View
              style={styles.scrollWrap}
              onLayout={(e) => {
                const h = e.nativeEvent.layout.height;
                setContainerHeight(h);
                reevaluateFit(contentHeight, h);
              }}
            >
              <ScrollView
                style={styles.content}
                contentContainerStyle={styles.contentContainer}
                onScroll={handleScroll}
                scrollEventThrottle={16}
                showsVerticalScrollIndicator
                onContentSizeChange={(_, h) => {
                  setContentHeight(h);
                  reevaluateFit(h, containerHeight);
                }}
              >
                {content ? (
                  <Markdown style={markdownStyles}>{content}</Markdown>
                ) : (
                  <View style={styles.loadingContainer}>
                    <Feather name="alert-circle" size={32} color={MUTED} />
                    <Text style={styles.errorText}>Policy content not available</Text>
                    <Text style={styles.errorSubText}>
                      The policy content could not be loaded. Please try again or contact support.
                    </Text>
                  </View>
                )}
                <View style={{ height: 32 }} />
              </ScrollView>
            </View>

            {/* Scroll hint for accept flow */}
            {showAccept && !scrolledToBottom && content && (
              <View style={styles.progressContainer}>
                <View style={styles.progressContent}>
                  <Feather name="file-text" size={16} color={BRAND} />
                  <Text style={styles.progressText}>Scroll to read the full policy</Text>
                </View>
                <Feather name="chevron-down" size={18} color={BRAND} />
              </View>
            )}

            {/* Actions */}
            <View style={styles.actions}>
              {!!websiteUrl && (
                <TouchableOpacity style={styles.secondaryButton} onPress={openWebsite} activeOpacity={0.8}>
                  <Feather name="external-link" size={16} color={TEXT} />
                  <Text style={styles.secondaryButtonText}>View Online</Text>
                </TouchableOpacity>
              )}

              {showAccept ? (
                <TouchableOpacity
                  style={[styles.primaryButton, !acceptEnabled && styles.disabledButton]}
                  onPress={handleAccept}
                  disabled={!acceptEnabled}
                  activeOpacity={acceptEnabled ? 0.85 : 1}
                >
                  {acceptEnabled ? (
                    <>
                      <Feather name="check" size={16} color="#fff" />
                      <Text style={styles.primaryButtonText}>Accept & Continue</Text>
                    </>
                  ) : (
                    <Text style={styles.disabledButtonText}>Scroll to Accept</Text>
                  )}
                </TouchableOpacity>
              ) : (
                <TouchableOpacity style={styles.primaryButton} onPress={handleClose} activeOpacity={0.85}>
                  <Text style={styles.primaryButtonText}>Done</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

/* STYLES */
const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "center", alignItems: "center", padding: 16 },
  backdropDim: { backgroundColor: "rgba(12,18,32,0.6)" },
  backdropClear: { backgroundColor: "transparent" },

  safeArea: { flex: 1, width: "100%", justifyContent: "center" },
  container: {
    backgroundColor: CARD,
    borderRadius: 16,
    width: "100%",
    maxWidth: 540,
    alignSelf: "center",
    overflow: "hidden",
    borderWidth: 1,
    borderColor: BORDER,
    ...Platform.select({
      ios: { shadowColor: "#0b1220", shadowOffset: { width: 0, height: 12 }, shadowOpacity: 0.12, shadowRadius: 20 },
      android: { elevation: 10 },
    }),
  },

  header: { borderBottomWidth: 1, borderBottomColor: BORDER, backgroundColor: "#fafbfc" },
  headerContent: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 16 },
  title: { fontSize: 18, fontWeight: "900", color: TEXT, flex: 1, marginRight: 16 },
  closeButton: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: "#f1f5f9", alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: BORDER,
  },

  scrollWrap: { maxHeight: 450, flex: 1 },
  content: { flexGrow: 0 },
  contentContainer: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 0 },

  loadingContainer: { alignItems: "center", justifyContent: "center", paddingVertical: 40 },
  errorText: { fontSize: 16, color: TEXT, fontWeight: "600", marginTop: 12, textAlign: "center" },
  errorSubText: { fontSize: 14, color: MUTED, marginTop: 8, textAlign: "center", lineHeight: 20 },

  progressContainer: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 20, paddingVertical: 12,
    backgroundColor: "#f8fafc", borderTopWidth: 1, borderTopColor: BORDER,
  },
  progressContent: { flexDirection: "row", alignItems: "center", gap: 8 },
  progressText: { fontSize: 13, color: MUTED, fontWeight: "600" },

  actions: {
    flexDirection: "row", paddingHorizontal: 16, paddingVertical: 16, gap: 12,
    borderTopWidth: 1, borderTopColor: BORDER, backgroundColor: CARD,
  },
  primaryButton: {
    flex: 2, backgroundColor: BRAND, paddingVertical: 12, paddingHorizontal: 16,
    borderRadius: 12, alignItems: "center", justifyContent: "center",
    flexDirection: "row", gap: 8,
    ...Platform.select({
      ios: { shadowColor: BRAND, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 4 },
      android: { elevation: 2 },
    }),
  },
  secondaryButton: {
    flex: 1, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER,
    paddingVertical: 12, paddingHorizontal: 16, borderRadius: 12,
    alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8,
  },
  disabledButton: { backgroundColor: "#e5e7eb", borderColor: "#e5e7eb", ...(Platform.OS === "android" ? { elevation: 0 } : { shadowOpacity: 0 }) },
  primaryButtonText: { color: "#ffffff", fontSize: 14, fontWeight: "700" },
  secondaryButtonText: { color: TEXT, fontSize: 14, fontWeight: "700" },
  disabledButtonText: { color: "#9ca3af", fontSize: 14, fontWeight: "700" },
});

/* MARKDOWN STYLES */
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