// app/(app)/settings/tax.js
import React, { useEffect, useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  StatusBar,
  Platform,
  Switch,
  TextInput,
  TouchableOpacity,
  Alert,
  ScrollView,
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

const CURRENCIES = ["GBP", "EUR", "USD"];

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

export default function TaxSettings() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [uid, setUid] = useState(null);

  const [vatRegistered, setVatRegistered] = useState(false);     // profiles.vat_registered
  const [vatNumber, setVatNumber] = useState("");                // profiles.vat_number (optional)
  const [taxRate, setTaxRate] = useState("20");                  // profiles.invoice_tax_rate
  const [currency, setCurrency] = useState("GBP");               // profiles.invoice_currency

  const [saving, setSaving] = useState(false);

  /* Make header/status/nav fully white */
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

  /* Load current profile values */
  const load = useCallback(async () => {
    try {
      const { data: auth } = await supabase.auth.getUser();
      const user = auth?.user;
      if (!user) return;
      setUid(user.id);

      const { data, error } = await supabase
        .from("profiles")
        .select("vat_registered, vat_number, invoice_tax_rate, invoice_currency")
        .eq("id", user.id)
        .maybeSingle();

      if (error) throw error;

      if (data) {
        setVatRegistered(!!data.vat_registered);
        setVatNumber(data.vat_number || "");
        setTaxRate(
          data.invoice_tax_rate != null
            ? String(Number(data.invoice_tax_rate))
            : "20"
        );
        setCurrency(data.invoice_currency || "GBP");
      }
    } catch (e) {
      console.warn("[tax-settings] load", e?.message || e);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /* Save updates */
  const save = useCallback(async () => {
    if (!uid) return;

    // clamp tax rate to sensible range
    const pct = Math.max(0, Math.min(100, parseFloat(taxRate || "0") || 0));

    try {
      setSaving(true);
      const payload = {
        vat_registered: !!vatRegistered,
        vat_number: vatRegistered ? (vatNumber?.trim() || null) : null,
        invoice_tax_rate: pct,
        invoice_currency: currency || "GBP",
        updated_at: new Date().toISOString(),
      };

      const { error } = await supabase.from("profiles").update(payload).eq("id", uid);
      if (error) throw error;

      Alert.alert("Saved", "Tax & currency settings updated.");
    } catch (e) {
      Alert.alert("Save failed", e?.message || "Could not save your settings.");
    } finally {
      setSaving(false);
    }
  }, [uid, vatRegistered, vatNumber, taxRate, currency]);

  return (
    <View style={styles.screen}>
      <View style={{ height: insets.top, backgroundColor: CARD }} />
      
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Feather name="arrow-left" size={20} color={TEXT} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Tax & Currency</Text>
        <TouchableOpacity
          onPress={save}
          disabled={saving}
          style={[styles.saveBtn, saving && { opacity: 0.5 }]}
        >
          <Text style={styles.saveTxt}>{saving ? "Saving..." : "Save"}</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.content} contentContainerStyle={styles.contentContainer}>
        {/* VAT section */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>VAT Settings</Text>
            <InfoButton
              title="VAT Information"
              tips={[
                "VAT (Value Added Tax) is a consumption tax in the UK and EU.",
                "If you're VAT registered, you must charge VAT on eligible goods and services.",
                "Standard UK VAT rate is 20%, but some items have reduced rates (5%) or are exempt (0%).",
                "You can override the VAT rate on individual invoices if needed.",
              ]}
            />
          </View>

          <View style={styles.toggleRow}>
            <Text style={styles.toggleLabel}>VAT registered business</Text>
            <Switch 
              value={vatRegistered} 
              onValueChange={setVatRegistered}
              trackColor={{ false: "#e2e8f0", true: BRAND + "40" }}
              thumbColor={vatRegistered ? BRAND : "#f1f5f9"}
            />
          </View>

          {vatRegistered && (
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>VAT Registration Number (Optional)</Text>
              <TextInput
                value={vatNumber}
                onChangeText={setVatNumber}
                style={styles.input}
                placeholder="GB 123 4567 89"
                placeholderTextColor={MUTED}
                autoCapitalize="characters"
              />
              <Text style={styles.helpText}>
                Your VAT number will appear on invoices when provided.
              </Text>
            </View>
          )}

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Default VAT Rate (%)</Text>
            <TextInput
              value={taxRate}
              onChangeText={(t) =>
                setTaxRate(
                  t
                    .replace(/[^\d.]/g, "")
                    .replace(/^(\d*\.\d{0,2}).*$/, "$1") // keep 2dp
                )
              }
              keyboardType="decimal-pad"
              style={styles.input}
              placeholder="20.00"
              placeholderTextColor={MUTED}
            />
            <Text style={styles.helpText}>
              Standard UK VAT rate is 20%. This will be applied to new invoices by default.
            </Text>
          </View>
        </View>

        {/* Currency */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>Invoice Currency</Text>
            <InfoButton
              title="Currency Settings"
              tips={[
                "Choose your default invoice currency based on your primary market.",
                "GBP (£) - British Pound Sterling for UK businesses",
                "EUR (€) - Euro for European Union businesses", 
                "USD ($) - US Dollar for international businesses",
                "You can set different currencies for individual quotes if needed.",
              ]}
            />
          </View>

          <View style={styles.chipRow}>
            {CURRENCIES.map((c) => (
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
            This currency will be used for all new invoices. Existing invoices remain unchanged.
          </Text>
        </View>

        <View style={styles.footerNote}>
          <Text style={styles.footerText}>
            Changes to tax and currency settings only affect new invoices going forward. You can always override these settings on individual invoices.
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

  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  
  toggleLabel: {
    fontSize: 14,
    fontWeight: "700",
    color: TEXT,
    flex: 1,
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
    marginBottom: 12,
    flexWrap: "wrap",
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