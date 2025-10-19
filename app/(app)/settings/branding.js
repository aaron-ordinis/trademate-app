// app/(app)/settings/branding.js
import React, { useEffect, useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  StatusBar,
  Platform,
  TextInput,
  TouchableOpacity,
  Alert,
  Image,
  ScrollView,
  Modal,
} from "react-native";
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from "expo-router";
import * as NavigationBar from "expo-navigation-bar";
import * as SystemUI from "expo-system-ui";
import * as ImagePicker from "expo-image-picker";
import { Feather } from "@expo/vector-icons";
import { supabase } from "../../../lib/supabase";

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

export default function BrandingSettings() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [uid, setUid] = useState(null);
  const [logoUrl, setLogoUrl] = useState("");
  const [theme, setTheme] = useState("slate");
  const [templateVersion, setTemplateVersion] = useState("");
  const [saving, setSaving] = useState(false);

  /* ---------- system chrome (white header to status bar) ---------- */
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

  /* ---------- load existing branding ---------- */
  const load = useCallback(async () => {
    try {
      const { data: auth } = await supabase.auth.getUser();
      const user = auth?.user;
      if (!user) return;
      setUid(user.id);

      const { data: prof, error } = await supabase
        .from("profiles")
        .select("custom_logo_url, preferred_template_key, preferred_template_version")
        .eq("id", user.id)
        .maybeSingle();

      if (error) throw error;
      if (prof) {
        setLogoUrl(prof.custom_logo_url || "");
        setTheme(prof.preferred_template_key || "slate");
        setTemplateVersion(prof.preferred_template_version?.toString() || "");
      }
    } catch (e) {
      console.warn("[branding] load", e?.message || e);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /* ---------- pick image ---------- */
  const pickLogo = useCallback(async () => {
    try {
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.7,
        base64: false,
      });
      if (res.canceled || !res.assets?.[0]) return;

      const asset = res.assets[0];
      const ext = asset.uri.split(".").pop() || "jpg";
      const path = `logos/${uid}/${Date.now()}.${ext}`;
      const response = await fetch(asset.uri);
      const blob = await response.blob();

      const { error: upErr } = await supabase.storage
        .from("logos")
        .upload(path, blob, { upsert: true, contentType: "image/" + ext });
      if (upErr) throw upErr;

      const { data: pub } = supabase.storage.from("logos").getPublicUrl(path);
      setLogoUrl(pub.publicUrl);
      Alert.alert("Logo uploaded", "Your logo has been updated.");
    } catch (e) {
      console.warn("[branding] pickLogo", e);
      Alert.alert("Upload failed", e?.message || "Could not upload logo.");
    }
  }, [uid]);

  /* ---------- save ---------- */
  const save = useCallback(async () => {
    if (!uid) return;
    try {
      setSaving(true);
      const updates = {
        custom_logo_url: logoUrl || null,
        preferred_template_key: theme || "slate",
        preferred_template_version: templateVersion ? Number(templateVersion) : null,
        updated_at: new Date().toISOString(),
      };
      const { error } = await supabase.from("profiles").update(updates).eq("id", uid);
      if (error) throw error;
      Alert.alert("Saved", "Your branding has been updated.");
    } catch (e) {
      Alert.alert("Save failed", e?.message || "Could not save branding.");
    } finally {
      setSaving(false);
    }
  }, [uid, logoUrl, theme, templateVersion]);

  const clearLogo = useCallback(() => {
    setLogoUrl("");
  }, []);

  return (
    <View style={styles.screen}>
      <View style={{ height: insets.top, backgroundColor: CARD }} />
      
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Feather name="arrow-left" size={20} color={TEXT} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Branding & Logo</Text>
        <TouchableOpacity
          onPress={save}
          disabled={saving}
          style={[styles.saveBtn, saving && { opacity: 0.5 }]}
        >
          <Text style={styles.saveTxt}>{saving ? "Saving..." : "Save"}</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.content} contentContainerStyle={styles.contentContainer}>
        {/* Company Logo */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>Company Logo</Text>
            <InfoButton
              title="Company Logo"
              tips={[
                "Upload your company logo to appear on invoices and quotes.",
                "Supports PNG, JPG, and other common image formats.",
                "Logo will be automatically resized to fit document templates.",
                "You can upload a file or paste a direct URL to an image.",
              ]}
            />
          </View>

          {logoUrl ? (
            <View style={styles.logoPreviewWrap}>
              <Image source={{ uri: logoUrl }} style={styles.logoPreview} resizeMode="contain" />
              <TouchableOpacity onPress={clearLogo} style={styles.removeBtn} activeOpacity={0.9}>
                <Text style={styles.removeTxt}>Remove Logo</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.noLogoWrap}>
              <Feather name="image" size={32} color={MUTED} />
              <Text style={styles.noLogoText}>No logo uploaded</Text>
            </View>
          )}

          <TouchableOpacity onPress={pickLogo} style={styles.uploadBtn} activeOpacity={0.9}>
            <Feather name="upload" size={16} color="#fff" />
            <Text style={styles.uploadTxt}>Upload Logo</Text>
          </TouchableOpacity>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Or paste logo URL</Text>
            <TextInput
              value={logoUrl}
              onChangeText={setLogoUrl}
              placeholder="https://example.com/logo.png"
              placeholderTextColor={MUTED}
              style={styles.input}
              autoCapitalize="none"
            />
            <Text style={styles.helpText}>
              Enter a direct link to your logo image hosted online.
            </Text>
          </View>
        </View>

        {/* Theme Colors */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>Document Colors</Text>
            <InfoButton
              title="Color Themes"
              tips={[
                "Choose a color theme for your invoices and quotes.",
                "Slate: Professional gray theme",
                "Blue: Modern blue accents", 
                "Green: Natural green highlights",
                "Mono: Classic black and white",
                "Colors affect headers, borders, and accent elements.",
              ]}
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Color Theme</Text>
            <View style={styles.themeGrid}>
              {[
                { key: "slate", name: "Slate", color: "#374151" },
                { key: "blue", name: "Blue", color: "#2563eb" },
                { key: "green", name: "Green", color: "#16a34a" },
                { key: "mono", name: "Mono", color: "#111827" },
              ].map((item) => (
                <TouchableOpacity
                  key={item.key}
                  onPress={() => setTheme(item.key)}
                  activeOpacity={0.9}
                  style={[
                    styles.themeChip,
                    theme === item.key && { backgroundColor: BRAND + "15", borderColor: BRAND },
                  ]}
                >
                  <View style={[styles.colorDot, { backgroundColor: item.color }]} />
                  <Text
                    style={[
                      styles.themeTxt,
                      theme === item.key && { color: BRAND, fontWeight: "900" },
                    ]}
                  >
                    {item.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Template Version (Optional)</Text>
            <TextInput
              value={templateVersion}
              onChangeText={setTemplateVersion}
              placeholder="1"
              placeholderTextColor={MUTED}
              style={styles.input}
              keyboardType="numeric"
            />
            <Text style={styles.helpText}>
              Advanced setting for template versioning. Leave blank to use default.
            </Text>
          </View>
        </View>

        <View style={styles.footerNote}>
          <Text style={styles.footerText}>
            Changes to branding apply to new documents only. Existing invoices and quotes remain unchanged.
          </Text>
        </View>

        <View style={{ height: 20 }} />
      </ScrollView>
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
  
  saveBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: BRAND,
    minWidth: 60,
    alignItems: "center",
  },
  
  saveTxt: { 
    color: "#fff", 
    fontWeight: "900",
    fontSize: 14,
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
    marginBottom: 12,
  },
  
  cardTitle: { 
    color: TEXT, 
    fontWeight: "900", 
    fontSize: 16 
  },

  logoPreviewWrap: { 
    alignItems: "center", 
    marginVertical: 16,
    padding: 16,
    backgroundColor: "#f8fafc",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
  },
  
  logoPreview: { 
    width: 120, 
    height: 80, 
    borderRadius: 8,
    marginBottom: 12,
  },
  
  removeBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: "#fca5a5",
    borderRadius: 8,
    backgroundColor: "#fee2e2",
  },
  
  removeTxt: { 
    color: "#b91c1c", 
    fontWeight: "700",
    fontSize: 12,
  },

  noLogoWrap: {
    alignItems: "center",
    padding: 32,
    backgroundColor: "#f8fafc",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    marginBottom: 16,
    gap: 8,
  },

  noLogoText: {
    color: MUTED,
    fontSize: 14,
    fontWeight: "500",
  },
  
  uploadBtn: {
    backgroundColor: BRAND,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
    flexDirection: "row",
    gap: 8,
  },
  
  uploadTxt: { 
    color: "#fff", 
    fontWeight: "900",
    fontSize: 14,
  },

  inputGroup: {
    marginBottom: 16,
  },

  inputLabel: { 
    color: TEXT, 
    fontWeight: "700", 
    marginBottom: 6,
    fontSize: 14,
  },

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

  helpText: { 
    color: MUTED, 
    fontSize: 12, 
    marginTop: 6,
    lineHeight: 16,
  },
  
  themeGrid: { 
    flexDirection: "row", 
    gap: 8,
    marginBottom: 8,
  },
  
  themeChip: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 8,
    gap: 6,
  },
  
  themeTxt: { 
    color: TEXT, 
    fontWeight: "700",
    fontSize: 12,
  },
  
  colorDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.8)",
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
    lineHeight: 16,
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