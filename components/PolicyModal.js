// app/components/PolicyModal.tsx
import React, { useState, useRef } from "react";
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
import Markdown from "react-native-markdown-display";

const BRAND = "#2a86ff";
const TEXT = "#0b1220";
const MUTED = "#6b7280";
const CARD = "#ffffff";
const BORDER = "#e6e9ee";

/**
 * @typedef {Object} Props
 * @property {boolean} visible
 * @property {string=} title
 * @property {string=} content        // Markdown string
 * @property {string=} websiteUrl
 * @property {boolean=} showAccept    // if true: show "Accept" and require scroll
 * @property {() => void=} onAccept
 * @property {() => void=} onClose
 */

export default function PolicyModal({
  visible,
  title = "Policy Update",
  content = "",
  websiteUrl,
  showAccept = false,
  onAccept,
  onClose,
}) {
  const [scrolledToBottom, setScrolledToBottom] = useState(false);
  const [acceptEnabled, setAcceptEnabled] = useState(!showAccept);
  const [containerHeight, setContainerHeight] = useState(0);
  const [contentHeight, setContentHeight] = useState(0);

  const { height } = Dimensions.get("window");
  const maxHeight = Math.min(height * 0.82, 620); // keep it compact + desktop-like

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
    const pad = 16;
    const atEnd =
      contentOffset.y + layoutMeasurement.height >= contentSize.height - pad;
    if (atEnd && !scrolledToBottom) {
      setScrolledToBottom(true);
      setAcceptEnabled(true);
      Haptics.selectionAsync();
    }
  };

  const openWebsite = async () => {
    if (!websiteUrl) return;
    try {
      await Linking.openURL(websiteUrl);
    } catch (error) {
      console.warn("Failed to open URL:", error);
    }
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
      animationType="fade"
      transparent
      onRequestClose={handleClose}
      statusBarTranslucent={Platform.OS === "android"}
    >
      <StatusBar backgroundColor="rgba(0,0,0,0.5)" barStyle="light-content" />

      <View style={styles.backdrop}>
        <SafeAreaView style={styles.safeArea}>
          <View style={[styles.container, { maxHeight }]}>
            {/* Header */}
            <View style={styles.header}>
              <Text style={styles.title}>{title}</Text>
              {!showAccept && (
                <TouchableOpacity
                  style={styles.closeButton}
                  onPress={handleClose}
                  activeOpacity={0.7}
                >
                  <Text style={styles.closeButtonText}>✕</Text>
                </TouchableOpacity>
              )}
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
                  <Markdown
                    style={markdownStyles}
                  >
                    {content}
                  </Markdown>
                ) : (
                  <Text style={styles.placeholderText}>
                    Policy content is loading…
                  </Text>
                )}
                {/* Spacer so final lines clear the bottom edge */}
                <View style={{ height: 32 }} />
              </ScrollView>
            </View>

            {/* Scroll hint */}
            {showAccept && !scrolledToBottom && (
              <View style={styles.progressContainer}>
                <Text style={styles.progressText}>
                  Scroll down to read the full policy
                </Text>
                <View style={styles.scrollIndicator}>
                  <Text style={styles.scrollArrow}>↓</Text>
                </View>
              </View>
            )}

            {/* Actions */}
            <View style={styles.actions}>
              {websiteUrl ? (
                <TouchableOpacity
                  style={[styles.button, styles.secondaryButton]}
                  onPress={openWebsite}
                  activeOpacity={0.8}
                >
                  <Text style={styles.secondaryButtonText}>View Online</Text>
                </TouchableOpacity>
              ) : null}

              {showAccept ? (
                <TouchableOpacity
                  style={[
                    styles.button,
                    styles.primaryButton,
                    !acceptEnabled && styles.disabledButton,
                  ]}
                  onPress={handleAccept}
                  disabled={!acceptEnabled}
                  activeOpacity={acceptEnabled ? 0.85 : 1}
                >
                  <Text
                    style={[
                      styles.primaryButtonText,
                      !acceptEnabled && styles.disabledButtonText,
                    ]}
                  >
                    {acceptEnabled ? "Accept & Continue" : "Scroll to Accept"}
                  </Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={[styles.button, styles.primaryButton]}
                  onPress={handleClose}
                  activeOpacity={0.85}
                >
                  <Text style={styles.primaryButtonText}>Close</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(12, 18, 32, 0.58)",
    justifyContent: "center",
    alignItems: "center",
    padding: 16,
  },
  safeArea: { flex: 1, width: "100%", justifyContent: "center" },
  container: {
    backgroundColor: CARD,
    borderRadius: 20,
    width: "100%",
    maxWidth: 520,
    alignSelf: "center",
    overflow: "hidden",
    borderWidth: 1,
    borderColor: BORDER,
    ...Platform.select({
      ios: {
        shadowColor: "#0b1220",
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.12,
        shadowRadius: 18,
      },
      android: { elevation: 10 },
    }),
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: BORDER,
    backgroundColor: "#fafbfc",
  },
  title: { fontSize: 18, fontWeight: "800", color: TEXT, flex: 1 },
  closeButton: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: "#f3f4f6",
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 12,
  },
  closeButtonText: { fontSize: 18, color: MUTED, fontWeight: "700" },

  scrollWrap: { maxHeight: 440 },
  content: { flexGrow: 0 },
  contentContainer: { paddingHorizontal: 18, paddingTop: 14, paddingBottom: 0 },
  placeholderText: { fontSize: 15, lineHeight: 22, color: MUTED },

  progressContainer: {
    alignItems: "center",
    paddingVertical: 8,
    backgroundColor: "#f8fafc",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: BORDER,
  },
  progressText: { fontSize: 13, color: MUTED, fontWeight: "600" },
  scrollIndicator: { marginTop: 4 },
  scrollArrow: { fontSize: 18, color: BRAND, fontWeight: "bold" },

  actions: {
    flexDirection: "row",
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: BORDER,
    backgroundColor: "#fff",
  },
  button: {
    flex: 1,
    paddingVertical: 10, // smaller buttons
    paddingHorizontal: 14,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryButton: {
    backgroundColor: BRAND,
    ...Platform.select({
      ios: {
        shadowColor: BRAND,
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.25,
        shadowRadius: 6,
      },
      android: { elevation: 3 },
    }),
  },
  secondaryButton: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: BORDER,
  },
  disabledButton: {
    backgroundColor: "#e5e7eb",
    ...Platform.select({
      ios: { shadowOpacity: 0 },
      android: { elevation: 0 },
    }),
  },
  primaryButtonText: { color: "#ffffff", fontSize: 15, fontWeight: "700" },
  secondaryButtonText: { color: TEXT, fontSize: 15, fontWeight: "700" },
  disabledButtonText: { color: "#9ca3af" },
});

/** Polished Markdown theme (brand headings, spacing, readable line-height) */
const markdownStyles = {
  body: {
    color: TEXT,
    fontSize: 15,
    lineHeight: 22,
  },
  heading1: {
    color: TEXT,
    fontSize: 22,
    fontWeight: "800",
    marginTop: 12,
    marginBottom: 8,
  },
  heading2: {
    color: TEXT,
    fontSize: 18,
    fontWeight: "800",
    marginTop: 10,
    marginBottom: 6,
  },
  heading3: {
    color: TEXT,
    fontSize: 16,
    fontWeight: "700",
    marginTop: 8,
    marginBottom: 4,
  },
  paragraph: {
    marginBottom: 10,
  },
  bullet_list_icon: {
    color: BRAND,
    marginRight: 8,
    marginTop: 6,
  },
  bullet_list_content: {
    flex: 1,
    color: TEXT,
  },
  ordered_list_icon: {
    color: BRAND,
    marginRight: 8,
    marginTop: 6,
  },
  strong: {
    color: TEXT,
    fontWeight: "800",
  },
  em: { fontStyle: "italic" },
  link: {
    color: BRAND,
    textDecorationLine: "underline",
  },
};