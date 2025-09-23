import React, { useState } from "react";
import {
  Modal, View, Text, TouchableOpacity, StyleSheet,
} from "react-native";
import { BlurView } from "expo-blur";
import * as Haptics from "expo-haptics";
import { Crown } from "lucide-react-native";

const BRAND = "#2a86ff";
const TEXT = "#0b1220";
const MUTED = "#6b7280";
const CARD = "#ffffff";
const BORDER = "#e6e9ee";

export default function PaywallModal({
  visible,
  blocking = false,
  onClose,
  onSubscribe,
  onSignOut,                 // <-- NEW
  title = "Trial Ended",
  message = "Your free trial has ended. To continue using TradeMate, you need an active subscription. Choose a monthly or yearly plan to unlock the app.",
}) {
  const [busy, setBusy] = useState(false);

  const buzz = () => Haptics.selectionAsync().catch(()=>{});

  const handleSubscribe = async () => {
    buzz();
    onSubscribe?.();
  };

  const handleClose = () => {
    if (blocking) return; // don't close if we’re hard-blocking
    buzz();
    onClose?.();
  };

  const handleSignOut = async () => {
    if (!onSignOut) return;
    try {
      setBusy(true);
      buzz();
      await onSignOut();   // parent handles auth + navigation
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleClose}>
      <BlurView intensity={10} tint="systemThinMaterialLight" style={{ flex: 1 }} />
      <View style={styles.overlay} pointerEvents="box-none">
        <View style={styles.modal}>
          <View style={styles.iconContainer}><Crown size={48} color="#f59e0b" /></View>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.message}>{message}</Text>

          <TouchableOpacity style={styles.subscribeButton} onPress={handleSubscribe} activeOpacity={0.9} disabled={busy}>
            <Text style={styles.subscribeButtonText}>{busy ? "Please wait…" : "Choose a Plan"}</Text>
          </TouchableOpacity>

          {/* Sign out always available, even when blocking */}
          <TouchableOpacity style={styles.signOutBtn} onPress={handleSignOut} activeOpacity={0.8} disabled={busy}>
            <Text style={styles.signOutText}>↪ Sign out</Text>
          </TouchableOpacity>

          {!blocking && (
            <TouchableOpacity style={styles.closeButton} onPress={handleClose} activeOpacity={0.7} disabled={busy}>
              <Text style={styles.closeButtonText}>Maybe Later</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { position: "absolute", inset: 0, justifyContent: "center", alignItems: "center", padding: 20 },
  modal: {
    backgroundColor: CARD, borderRadius: 20, padding: 24, width: "100%", maxWidth: 380,
    borderWidth: 1, borderColor: BORDER, shadowColor: "#0b1220", shadowOpacity: 0.15, shadowRadius: 24, elevation: 16,
    alignItems: "center",
  },
  iconContainer: { width: 80, height: 80, borderRadius: 40, backgroundColor: "rgba(245,158,11,0.1)", alignItems: "center", justifyContent: "center", marginBottom: 16 },
  title: { fontSize: 22, fontWeight: "800", color: TEXT, textAlign: "center", marginBottom: 8 },
  message: { fontSize: 16, color: MUTED, textAlign: "center", lineHeight: 22, marginBottom: 20 },
  subscribeButton: {
    backgroundColor: BRAND, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 32, width: "100%", alignItems: "center",
    marginBottom: 12,
  },
  subscribeButtonText: { color: "#fff", fontSize: 16, fontWeight: "800" },
  signOutBtn: { paddingVertical: 10 },
  signOutText: { color: "#dc2626", fontWeight: "800", fontSize: 15 },
  closeButton: { paddingVertical: 8 },
  closeButtonText: { color: MUTED, fontSize: 14, fontWeight: "600" },
});