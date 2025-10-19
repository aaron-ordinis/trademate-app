// app/(app)/settings/info.js
import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  StatusBar,
  Platform,
  ScrollView,
  TouchableOpacity,
  Alert,
  Linking,
  Modal,
} from "react-native";
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from "expo-router";
import * as NavigationBar from "expo-navigation-bar";
import * as SystemUI from "expo-system-ui";
import * as Application from "expo-application";
import * as Updates from "expo-updates";
import * as Clipboard from "expo-clipboard";
import { Feather } from "@expo/vector-icons";

/* ---------- THEME ---------- */
const CARD = "#ffffff";
const TEXT = "#0b1220";
const MUTED = "#6b7280";
const BORDER = "#e6e9ee";
const BRAND = "#2a86ff";
const BG = "#ffffff";

/* ---------- INFO BUTTON COMPONENT ---------- */
function InfoButton({ title, tips = [] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <TouchableOpacity onPress={() => setOpen(true)} style={styles.infoBtn}>
        <Text style={{ color: MUTED, fontWeight: "900" }}>i</Text>
      </TouchableOpacity>
      <Modal visible={open} animationType="fade" transparent onRequestClose={() => setOpen(false)}>
        <View style={styles.modalBackdrop} />
        <View style={styles.modalWrap}>
          <View style={styles.modalCard}>
            <View style={styles.modalHead}>
              <Text style={{ color: TEXT, fontWeight: "900", fontSize: 16 }}>{title}</Text>
              <TouchableOpacity onPress={() => setOpen(false)} style={styles.smallBtn}>
                <Text style={styles.smallBtnText}>Close</Text>
              </TouchableOpacity>
            </View>
            {tips.slice(0, 6).map((t, i) => (
              <View key={i} style={{ flexDirection: "row", gap: 8, marginBottom: 8 }}>
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

export default function InfoSettings() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [checking, setChecking] = useState(false);
  const [isUpdateAvailable, setIsUpdateAvailable] = useState(false);

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

  /* --- App info --- */
  const appFacts = useMemo(() => {
    return {
      appId: Application.applicationId || "",
      version: Application.nativeApplicationVersion || "unknown",
      build: Application.nativeBuildVersion || "unknown",
      runtimeVersion: Updates.runtimeVersion || "n/a",
      channel: Updates.channel || "n/a",
      updateId: Updates.updateId || "n/a",
    };
  }, []);

  /* --- Basic system info --- */
  const deviceFacts = useMemo(() => {
    return {
      os: Platform.OS,
      osVersion: Platform.Version || "unknown",
      isPhysicalDevice: typeof navigator !== "undefined" ? "Yes" : "Unknown",
    };
  }, []);

  /* --- Actions --- */
  const copy = async (text, label) => {
    try {
      await Clipboard.setStringAsync(String(text || ""));
      Alert.alert("Copied", `${label} copied to clipboard`);
    } catch {
      Alert.alert("Copy failed");
    }
  };

  const openPlayStore = () => {
    const id = Application.applicationId || "";
    const marketUrl = `market://details?id=${id}`;
    const webUrl = `https://play.google.com/store/apps/details?id=${id}`;
    Linking.openURL(marketUrl).catch(() => Linking.openURL(webUrl));
  };

  const openWebsite = () => {
    Linking.openURL("https://tradematequotes.com").catch(() => {});
  };

  const checkForUpdates = async () => {
    try {
      setChecking(true);
      const result = await Updates.checkForUpdateAsync();
      if (result.isAvailable) {
        setIsUpdateAvailable(true);
        Alert.alert("Update available", "Download now?", [
          { text: "Cancel", style: "cancel" },
          {
            text: "Download",
            onPress: async () => {
              await Updates.fetchUpdateAsync();
              Alert.alert("Ready", "Restart to apply update", [
                { text: "Restart", onPress: () => Updates.reloadAsync() },
              ]);
            },
          },
        ]);
      } else {
        Alert.alert("Up to date", "You're running the latest version.");
      }
    } catch (err) {
      Alert.alert("Error checking for updates", err.message);
    } finally {
      setChecking(false);
    }
  };

  const infoRowsApp = [
    { label: "Version", value: appFacts.version },
    { label: "Build", value: appFacts.build },
    { label: "App ID", value: appFacts.appId, copyable: true },
    { label: "Runtime Version", value: appFacts.runtimeVersion },
    { label: "Channel", value: appFacts.channel },
    { label: "Update ID", value: appFacts.updateId, copyable: !!appFacts.updateId },
  ];

  const infoRowsSystem = [
    { label: "OS", value: `${deviceFacts.os} ${deviceFacts.osVersion}` },
    { label: "Physical Device", value: deviceFacts.isPhysicalDevice },
  ];

  return (
    <View style={styles.screen}>
      <View style={{ height: insets.top, backgroundColor: CARD }} />
      
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Feather name="arrow-left" size={20} color={TEXT} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>App Information</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView style={styles.content} contentContainerStyle={styles.contentContainer}>
        {/* Application Info */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>Application Details</Text>
            <InfoButton
              title="App Information"
              tips={[
                "Version shows the current app version from the App Store.",
                "Build number helps identify specific app releases for debugging.",
                "Runtime version is used for over-the-air updates via Expo.",
                "Update ID tracks the current update bundle if using Expo Updates.",
              ]}
            />
          </View>

          {infoRowsApp.map((row, idx) => (
            <InfoRow
              key={idx}
              label={row.label}
              value={row.value}
              onCopy={row.copyable ? () => copy(row.value, row.label) : undefined}
            />
          ))}

          <View style={styles.actionRow}>
            <TouchableOpacity
              onPress={checkForUpdates}
              disabled={checking}
              style={[styles.primaryBtn, checking && { opacity: 0.6 }]}
              activeOpacity={0.85}
            >
              <Feather name="refresh-ccw" size={16} color="#fff" />
              <Text style={styles.primaryBtnText}>
                {checking ? "Checking..." : "Check Updates"}
              </Text>
            </TouchableOpacity>
            
            <TouchableOpacity
              onPress={openWebsite}
              style={styles.secondaryBtn}
              activeOpacity={0.85}
            >
              <Feather name="external-link" size={16} color={TEXT} />
              <Text style={styles.secondaryBtnText}>Release Notes</Text>
            </TouchableOpacity>
          </View>

          {isUpdateAvailable && (
            <View style={styles.updateNotice}>
              <Feather name="download" size={16} color="#16a34a" />
              <Text style={styles.updateText}>A new update is available!</Text>
            </View>
          )}
        </View>

        {/* System Info */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>System Information</Text>
            <InfoButton
              title="System Details"
              tips={[
                "OS version helps identify compatibility issues.",
                "Physical device info distinguishes between real devices and simulators.",
                "This information is useful for troubleshooting and support.",
              ]}
            />
          </View>

          {infoRowsSystem.map((row, idx) => (
            <InfoRow
              key={idx}
              label={row.label}
              value={row.value}
              onCopy={() => copy(row.value, row.label)}
            />
          ))}
        </View>

        {/* Quick Actions */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>Quick Actions</Text>
            <InfoButton
              title="App Actions"
              tips={[
                "Rate the app to help others discover TradeMate.",
                "Visit our website for additional resources and support.",
                "Your feedback helps us improve the app for everyone.",
              ]}
            />
          </View>

          <View style={styles.actionCol}>
            <TouchableOpacity onPress={openPlayStore} style={styles.actionItem} activeOpacity={0.7}>
              <View style={styles.actionIcon}>
                <Feather name="star" size={18} color={BRAND} />
              </View>
              <View style={styles.actionTextWrap}>
                <Text style={styles.actionTitle}>Rate on Play Store</Text>
                <Text style={styles.actionSubtitle}>Help others discover TradeMate</Text>
              </View>
              <Feather name="chevron-right" size={16} color={MUTED} />
            </TouchableOpacity>

            <TouchableOpacity onPress={openWebsite} style={styles.actionItem} activeOpacity={0.7}>
              <View style={styles.actionIcon}>
                <Feather name="globe" size={18} color={BRAND} />
              </View>
              <View style={styles.actionTextWrap}>
                <Text style={styles.actionTitle}>Visit Website</Text>
                <Text style={styles.actionSubtitle}>Resources and support</Text>
              </View>
              <Feather name="chevron-right" size={16} color={MUTED} />
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.footerNote}>
          <Text style={styles.footerText}>
            TradeMate — built to make quoting, invoicing, and job management simple for tradespeople and contractors.
          </Text>
        </View>

        <View style={{ height: 20 }} />
      </ScrollView>
    </View>
  );
}

/* --- Subcomponents --- */
function InfoRow({ label, value, onCopy }) {
  return (
    <View style={styles.row}>
      <View style={styles.rowContent}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={styles.rowValue} numberOfLines={1}>{value}</Text>
      </View>
      {onCopy && (
        <TouchableOpacity style={styles.copyBtn} onPress={onCopy} activeOpacity={0.7}>
          <Feather name="copy" size={14} color={MUTED} />
        </TouchableOpacity>
      )}
    </View>
  );
}

/* ---------- STYLES ---------- */
const styles = StyleSheet.create({
  screen: { 
    flex: 1, 
    backgroundColor: BG 
  },
  
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
  
  content: {
    flex: 1,
  },
  
  contentContainer: {
    padding: 16,
  },

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
        shadowOffset: { width: 0, height: 4 } 
      },
      android: { elevation: 3 },
    }),
  },
  
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  
  cardTitle: { 
    color: TEXT, 
    fontWeight: "900", 
    fontSize: 16 
  },

  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#f8fafc",
  },

  rowContent: {
    flex: 1,
  },

  rowLabel: { 
    color: MUTED, 
    fontSize: 12, 
    fontWeight: "700", 
    marginBottom: 4 
  },
  
  rowValue: { 
    color: TEXT, 
    fontSize: 14, 
    fontWeight: "700" 
  },

  copyBtn: {
    padding: 8,
    marginLeft: 8,
    borderRadius: 8,
    backgroundColor: "#f8fafc",
  },

  actionRow: { 
    flexDirection: "row", 
    gap: 12, 
    marginTop: 16 
  },

  actionCol: {
    gap: 0,
    marginTop: 4,
  },

  primaryBtn: {
    flex: 1,
    backgroundColor: BRAND,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
    ...Platform.select({
      ios: {
        shadowColor: BRAND,
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.2,
        shadowRadius: 4,
      },
      android: { elevation: 2 },
    }),
  },

  primaryBtnText: { 
    color: "#fff", 
    fontWeight: "900",
    fontSize: 14,
  },

  secondaryBtn: {
    flex: 1,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },

  secondaryBtnText: { 
    color: TEXT, 
    fontWeight: "900",
    fontSize: 14,
  },

  updateNotice: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 12,
    padding: 12,
    backgroundColor: "#f0fdf4",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#bbf7d0",
  },

  updateText: { 
    color: "#16a34a", 
    fontSize: 14, 
    fontWeight: "700" 
  },

  actionItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 16,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: "#f8fafc",
    gap: 12,
  },

  actionIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: BRAND + "15",
    alignItems: "center",
    justifyContent: "center",
  },

  actionTextWrap: {
    flex: 1,
  },

  actionTitle: {
    color: TEXT,
    fontWeight: "700",
    fontSize: 15,
    marginBottom: 2,
  },

  actionSubtitle: {
    color: MUTED,
    fontSize: 13,
    lineHeight: 18,
  },

  footerNote: {
    backgroundColor: "#f8fafc",
    borderRadius: 12,
    padding: 12,
    marginTop: 8,
  },

  footerText: { 
    color: MUTED, 
    fontSize: 12, 
    textAlign: "center",
    lineHeight: 18,
  },

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
  modalWrap: { 
    flex: 1, 
    justifyContent: "center", 
    alignItems: "center", 
    padding: 16,
  },
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
        shadowOffset: { width: 0, height: 6 } 
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
    backgroundColor: "#f3f4f6" 
  },
  smallBtnText: { 
    color: TEXT, 
    fontWeight: "700", 
    fontSize: 12 
  },
});