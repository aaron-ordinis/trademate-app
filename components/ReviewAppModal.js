// app/components/ReviewAppModal.tsx
import React from "react";
import { Modal, View, Text, TouchableOpacity, StyleSheet, Platform } from "react-native";

const BRAND = "#2a86ff";
const TEXT = "#0b1220";
const MUTED = "#6b7280";
const CARD = "#ffffff";
const BORDER = "#e6e9ee";

/**
 * @param {{ visible: boolean, onRateNow: () => void, onLater: () => void }} props
 */
export default function ReviewAppModal({ visible, onRateNow, onLater }) {
  if (!visible) return null;

  return (
    <Modal visible={visible} animationType="fade" transparent>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.title}>Enjoying TradeMate?</Text>
          <Text style={styles.subtitle}>
            If TradeMate saves you time, a quick review on {Platform.OS === "android" ? "Google Play" : "the App Store"} helps a lot!
          </Text>

          <View style={styles.actions}>
            <TouchableOpacity style={[styles.btn, styles.secondary]} onPress={onLater} activeOpacity={0.85}>
              <Text style={styles.secondaryText}>Maybe Later</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.btn, styles.primary]} onPress={onRateNow} activeOpacity={0.85}>
              <Text style={styles.primaryText}>Rate TradeMate</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(12,18,32,0.5)", alignItems: "center", justifyContent: "center", padding: 16 },
  sheet: {
    width: "100%",
    maxWidth: 420,
    backgroundColor: CARD,
    borderRadius: 18,
    padding: 18,
    borderWidth: 1,
    borderColor: BORDER,
  },
  title: { fontSize: 18, fontWeight: "800", color: TEXT, marginBottom: 6 },
  subtitle: { fontSize: 14, color: MUTED, lineHeight: 20, marginBottom: 16 },
  actions: { flexDirection: "row", gap: 10 },
  btn: { flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  primary: { backgroundColor: BRAND },
  primaryText: { color: "#fff", fontWeight: "800" },
  secondary: { backgroundColor: "#fff", borderWidth: 1, borderColor: BORDER },
  secondaryText: { color: TEXT, fontWeight: "800" },
});