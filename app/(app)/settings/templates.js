import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, StatusBar, Platform, ActivityIndicator, Alert, TouchableOpacity } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import * as NavigationBar from "expo-navigation-bar";
import * as SystemUI from "expo-system-ui";
import { Feather } from "@expo/vector-icons";
import TemplatePicker from "../../../components/TemplatePicker";
import { supabase } from "../../../lib/supabase";

const CARD = "#ffffff";
const TEXT = "#0b1220";
const MUTED = "#6b7280";
const BORDER = "#e6e9ee";

export default function TemplatesSettings() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [template, setTemplate] = useState(null);
  const [error, setError] = useState(null);
  const [userId, setUserId] = useState(null);

  // Load current user's default_template_code and user id
  useEffect(() => {
    StatusBar.setBarStyle("dark-content", false);
    if (Platform.OS === "android") {
      StatusBar.setBackgroundColor("#ffffff", false);
      NavigationBar.setBackgroundColorAsync?.("#ffffff");
      NavigationBar.setButtonStyleAsync?.("dark");
      NavigationBar.setBorderColorAsync?.("#ffffff");
    }
    SystemUI.setBackgroundColorAsync?.("#ffffff");

    let alive = true;
    (async () => {
      setLoading(true);
      setError(null);
      // Get user id
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (!alive) return;
      if (userError || !userData?.user?.id) {
        setError("Failed to get user");
        setLoading(false);
        return;
      }
      setUserId(userData.user.id);

      // Get default_template_code
      const { data, error } = await supabase
        .from("profiles")
        .select("default_template_code")
        .eq("id", userData.user.id)
        .single();
      if (!alive) return;
      if (error) setError(error.message || "Failed to load profile");
      else setTemplate(data?.default_template_code || null);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, []);

  // Save template selection to profile
  const handleSelect = async (code) => {
    if (!code || code === template || !userId) return;
    setSaving(true);
    setError(null);
    const { error } = await supabase
      .from("profiles")
      .update({ default_template_code: code })
      .eq("id", userId);
    setSaving(false);
    if (error) {
      setError(error.message || "Failed to update template");
      Alert.alert("Error", error.message || "Failed to update template");
    } else {
      setTemplate(code);
    }
  };

  return (
    <View style={styles.screen}>
      <View style={{ height: insets.top, backgroundColor: CARD }} />
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.replace("/settings")}>
          <Feather name="arrow-left" size={20} color={TEXT} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Templates & Layouts</Text>
        <View style={{ width: 40 }} /> {/* Placeholder for symmetry */}
      </View>
      <View style={styles.content}>
        <View style={styles.card}>
          <Text style={styles.title}>Choose Default Template</Text>
          <Text style={styles.subtitle}>Select your default layout for new documents.</Text>
        </View>
        <View style={styles.pickerContainer}>
          {loading ? (
            <ActivityIndicator size="large" color="#2a86ff" style={{ marginTop: 24 }} />
          ) : (
            <TemplatePicker selected={template} onSelect={handleSelect} />
          )}
          {saving && <ActivityIndicator size="small" color="#2a86ff" style={{ marginTop: 12 }} />}
          {error && <Text style={{ color: "#b91c1c", marginTop: 10 }}>{error}</Text>}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#ffffff",
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
  content: { flex: 1, padding: 16, backgroundColor: "#ffffff" },
  card: {
    backgroundColor: CARD,
    borderRadius: 16,
    paddingVertical: 5,
    paddingHorizontal: 18,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: "center",
    shadowColor: "#0b1220",
    shadowOpacity: 0.05,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 2,
    marginBottom: 16,
  },
  pickerContainer: {
    alignItems: "center",
    marginTop: 8,
    marginBottom: 8,
  },
  title: { fontSize: 18, fontWeight: "900", color: TEXT, marginBottom: 8 },
  subtitle: { fontSize: 14, color: MUTED },
});
