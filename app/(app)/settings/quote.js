// app/(app)/settings/quote.js
// If you want "rounding" persisted, run this first in your DB (optional):
//   ALTER TABLE public.profiles
//   ADD COLUMN IF NOT EXISTS quote_round_to text CHECK (quote_round_to IN ('none','nearest_50p','nearest_1','nearest_5')) DEFAULT 'none';
//
// This screen manages default quote markup + currency (and optional rounding if the column exists).

import React, { useEffect, useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  StatusBar,
  Platform,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
  Modal,
} from "react-native";
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from "expo-router";
import * as NavigationBar from "expo-navigation-bar";
import * as SystemUI from "expo-system-ui";
import { Feather } from "@expo/vector-icons";
import { supabase } from "../../../lib/supabase";

/* ---------- THEME ---------- */
const CARD = "#ffffff";
const TEXT = "#0b1220";
const MUTED = "#6b7280";
const BORDER = "#e6e9ee";
const BRAND = "#2a86ff";
const BG = "#ffffff";

const CURRENCY_CHOICES = ["GBP", "USD", "EUR"];
const ROUNDING_CHOICES = [
  { key: "none", label: "No rounding" },
  { key: "nearest_50p", label: "Nearest 50p" },
  { key: "nearest_1", label: "Nearest £1" },
  { key: "nearest_5", label: "Nearest £5" },
];

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

export default function QuoteSettings() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [uid, setUid] = useState(null);

  // Core quote defaults
  const [markupPct, setMarkupPct] = useState("0");    // profiles.materials_markup_pct
  const [currency, setCurrency] = useState("GBP");    // profiles.currency

  // Optional rounding (only shown if column exists)
  const [roundingKey, setRoundingKey] = useState("none"); // profiles.quote_round_to (if present)
  const [roundingAvailable, setRoundingAvailable] = useState(false);

  const [saving, setSaving] = useState(false);

  /* ---- system chrome (white to status bar) ---- */
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

  /* ---- load profile values ---- */
  const load = useCallback(async () => {
    try {
      const { data: auth } = await supabase.auth.getUser();
      const user = auth?.user;
      if (!user) return;
      setUid(user.id);

      // Try to select potential rounding column too; if it doesn't exist PostgREST returns 400.
      // We'll first fetch known fields, then a second lightweight probe for rounding.
      const base = await supabase
        .from("profiles")
        .select("materials_markup_pct, currency")
        .eq("id", user.id)
        .maybeSingle();
      if (base?.error) throw base.error;
      const prof = base?.data || {};

      setMarkupPct(
        prof.materials_markup_pct != null ? String(prof.materials_markup_pct) : "0"
      );
      setCurrency(prof.currency || "GBP");

      // Probe rounding column
      const probe = await supabase
        .from("profiles")
        .select("quote_round_to")
        .eq("id", user.id)
        .maybeSingle();

      if (!probe.error) {
        setRoundingAvailable(true);
        setRoundingKey(probe.data?.quote_round_to || "none");
      } else {
        setRoundingAvailable(false);
      }
    } catch (e) {
      console.warn("[quote-settings] load", e?.message || e);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /* ---- persist ---- */
  const save = useCallback(async () => {
    if (!uid) return;

    const pct = Math.max(0, Math.min(100, parseFloat(markupPct || "0") || 0));

    try {
      setSaving(true);

      const payload = {
        materials_markup_pct: pct,
        currency: currency || "GBP",
        updated_at: new Date().toISOString(),
      };

      if (roundingAvailable) {
        payload.quote_round_to = roundingKey || "none";
      }

      const { error } = await supabase.from("profiles").update(payload).eq("id", uid);
      if (error) throw error;

      Alert.alert("Saved", "Quote settings updated.");
    } catch (e) {
      Alert.alert("Save failed", e?.message || "Could not save settings.");
    } finally {
      setSaving(false);
    }
  }, [uid, markupPct, currency, roundingAvailable, roundingKey]);

  return (
    <View style={styles.screen}>
      <View style={{ height: insets.top, backgroundColor: CARD }} />
      
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Feather name="arrow-left" size={20} color={TEXT} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Quote Settings</Text>
        <TouchableOpacity
          onPress={save}
          disabled={saving}
          style={[styles.saveBtn, saving && { opacity: 0.5 }]}
        >
          <Text style={styles.saveTxt}>{saving ? "Saving..." : "Save"}</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.content} contentContainerStyle={styles.contentContainer}>
        {/* Quote defaults */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>Default Settings</Text>
            <InfoButton
              title="Quote Defaults"
              tips={[
                "Materials markup is added to your cost price to calculate the selling price.",
                "A 10% markup means if materials cost £100, you'll charge £110.",
                "Currency setting applies to new quotes only.",
                "You can override these settings on individual quotes.",
              ]}
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Materials Markup (%)</Text>
            <TextInput
              value={markupPct}
              onChangeText={(t) =>
                setMarkupPct(
                  t.replace(/[^\d.]/g, "").replace(/^(\d*\.\d{0,2}).*$/, "$1")
                )
              }
              keyboardType="decimal-pad"
              style={styles.input}
              placeholder="10.00"
              placeholderTextColor={MUTED}
            />
            <Text style={styles.helpText}>
              Applied to material costs. Enter 0-100%. Example: 15% markup on £100 materials = £115 total.
            </Text>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Default Currency</Text>
            <View style={styles.chipRow}>
              {CURRENCY_CHOICES.map((c) => (
                <TouchableOpacity
                  key={c}
                  onPress={() => setCurrency(c)}
                  activeOpacity={0.9}
                  style={[
                    styles.chip,
                    currency === c && {
                      backgroundColor: BRAND + "15",
                      borderColor: BRAND,
                    },
                  ]}
                >
                  <View style={[styles.dot, currency === c && { backgroundColor: BRAND, borderColor: BRAND }]} />
                  <Text
                    style={[
                      styles.chipTxt,
                      currency === c && { color: BRAND, fontWeight: "900" },
                    ]}
                  >
                    {c}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={styles.helpText}>
              Currency used for new quotes. Existing quotes remain unchanged.
            </Text>
          </View>
        </View>

        {/* Optional rounding */}
        {roundingAvailable && (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>Price Rounding</Text>
              <InfoButton
                title="Rounding Options"
                tips={[
                  "No rounding: Prices calculated to the penny (£12.34)",
                  "Nearest 50p: Rounds to .00 or .50 (£12.50)",
                  "Nearest £1: Rounds to whole pounds (£12.00)",
                  "Nearest £5: Rounds to £5 increments (£10.00, £15.00)",
                  "Rounding makes quotes look cleaner and easier to remember.",
                ]}
              />
            </View>
            
            <View style={styles.chipColumn}>
              {ROUNDING_CHOICES.map((opt) => (
                <TouchableOpacity
                  key={opt.key}
                  onPress={() => setRoundingKey(opt.key)}
                  activeOpacity={0.9}
                  style={[
                    styles.chipWide,
                    roundingKey === opt.key && {
                      backgroundColor: BRAND + "15",
                      borderColor: BRAND,
                    },
                  ]}
                >
                  <View style={[styles.dot, roundingKey === opt.key && { backgroundColor: BRAND, borderColor: BRAND }]} />
                  <Text
                    style={[
                      styles.chipTxt,
                      roundingKey === opt.key && { color: BRAND, fontWeight: "900" },
                    ]}
                  >
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        <View style={styles.footerNote}>
          <Text style={styles.footerText}>
            These settings apply to new quotes only. You can always override markup and currency when creating individual quotes.
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

  chipRow: { 
    flexDirection: "row", 
    gap: 12, 
    marginBottom: 8,
    flexWrap: "wrap",
  },

  chipColumn: {
    gap: 8,
    marginBottom: 8,
  },

  chip: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: "#fff",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minWidth: 80,
    justifyContent: "center",
  },

  chipWide: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: "#fff",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  
  chipTxt: { 
    color: TEXT, 
    fontWeight: "700",
    fontSize: 14,
  },
  
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: BORDER,
    backgroundColor: CARD,
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