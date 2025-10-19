import React, { useEffect } from "react";
import { View, Text, StyleSheet, StatusBar, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import * as NavigationBar from "expo-navigation-bar";
import * as SystemUI from "expo-system-ui";
import TopBar from "../../../components/TopBar";

const CARD = "#ffffff";
const TEXT = "#0b1220";
const MUTED = "#6b7280";
const BORDER = "#e6e9ee";

export default function TemplatesSettings() {
  const router = useRouter();

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

  return (
    <SafeAreaView edges={["top"]} style={styles.container}>
      <TopBar title="Templates & Layouts" showBack onBack={() => router.back()} />
      <View style={styles.content}>
        <View style={styles.card}>
          <Text style={styles.title}>Coming soon</Text>
          <Text style={styles.subtitle}>Templates & Layouts</Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#ffffff" },
  content: { flex: 1, padding: 16, backgroundColor: "#ffffff" },
  card: {
    backgroundColor: CARD,
    borderRadius: 16,
    padding: 24,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: "center",
    shadowColor: "#0b1220",
    shadowOpacity: 0.05,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 2,
  },
  title: { fontSize: 18, fontWeight: "900", color: TEXT, marginBottom: 8 },
  subtitle: { fontSize: 14, color: MUTED },
});
