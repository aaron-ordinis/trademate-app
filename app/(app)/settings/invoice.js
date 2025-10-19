// app/(app)/settings/invoice.js
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
  Switch,
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

export default function InvoiceSettings() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [uid, setUid] = useState(null);

  // Core invoice fields
  const [terms, setTerms] = useState("");
  const [dueDays, setDueDays] = useState("14");
  const [taxRate, setTaxRate] = useState("20");
  const [currency, setCurrency] = useState("GBP");
  const [footer, setFooter] = useState("");

  // Optional reminders (useful defaults exist in schema)
  const [remindDueEnabled, setRemindDueEnabled] = useState(true);
  const [remindOverEnabled, setRemindOverEnabled] = useState(true);
  const [remindDaysBefore, setRemindDaysBefore] = useState("2");
  const [remindOverEvery, setRemindOverEvery] = useState("7");
  const [remindHourUtc, setRemindHourUtc] = useState("9");

  const [saving, setSaving] = useState(false);

  /* ---- system chrome (white header up to status bar) ---- */
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

      const { data: prof, error } = await supabase
        .from("profiles")
        .select(
          `
            invoice_terms,
            invoice_due_days,
            invoice_tax_rate,
            invoice_currency,
            invoice_footer,
            reminder_due_enabled,
            reminder_overdue_enabled,
            reminder_days_before,
            reminder_overdue_every_days,
            reminder_send_hour_utc
          `
        )
        .eq("id", user.id)
        .maybeSingle();

      if (error) throw error;
      if (!prof) return;

      setTerms(prof.invoice_terms ?? "");
      setDueDays(
        prof.invoice_due_days != null ? String(prof.invoice_due_days) : "14"
      );
      setTaxRate(
        prof.invoice_tax_rate != null ? String(prof.invoice_tax_rate) : "20"
      );
      setCurrency(prof.invoice_currency || "GBP");
      setFooter(prof.invoice_footer ?? "");

      setRemindDueEnabled(
        prof.reminder_due_enabled != null ? !!prof.reminder_due_enabled : true
      );
      setRemindOverEnabled(
        prof.reminder_overdue_enabled != null
          ? !!prof.reminder_overdue_enabled
          : true
      );
      setRemindDaysBefore(
        prof.reminder_days_before != null
          ? String(prof.reminder_days_before)
          : "2"
      );
      setRemindOverEvery(
        prof.reminder_overdue_every_days != null
          ? String(prof.reminder_overdue_every_days)
          : "7"
      );
      setRemindHourUtc(
        prof.reminder_send_hour_utc != null
          ? String(prof.reminder_send_hour_utc)
          : "9"
      );
    } catch (e) {
      console.warn("[invoice-settings] load", e?.message || e);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /* ---- persist ---- */
  const save = useCallback(async () => {
    if (!uid) return;

    // light validation / coercion
    const dueDaysNum = Math.max(0, parseInt(dueDays || "0", 10) || 0);
    const taxNum = Math.max(0, parseFloat(taxRate || "0") || 0);
    const daysBeforeNum = Math.max(0, parseInt(remindDaysBefore || "0", 10) || 0);
    const overEveryNum = Math.max(1, parseInt(remindOverEvery || "1", 10) || 1);
    const hourNum = Math.min(
      23,
      Math.max(0, parseInt(remindHourUtc || "9", 10) || 9)
    );

    try {
      setSaving(true);
      const payload = {
        invoice_terms: terms || null,
        invoice_due_days: dueDaysNum,
        invoice_tax_rate: taxNum,
        invoice_currency: currency || "GBP",
        invoice_footer: footer || null,
        reminder_due_enabled: !!remindDueEnabled,
        reminder_overdue_enabled: !!remindOverEnabled,
        reminder_days_before: daysBeforeNum,
        reminder_overdue_every_days: overEveryNum,
        reminder_send_hour_utc: hourNum,
        updated_at: new Date().toISOString(),
      };

      const { error } = await supabase
        .from("profiles")
        .update(payload)
        .eq("id", uid);

      if (error) throw error;
      Alert.alert("Saved", "Invoice settings updated.");
    } catch (e) {
      Alert.alert("Save failed", e?.message || "Could not save settings.");
    } finally {
      setSaving(false);
    }
  }, [
    uid,
    terms,
    dueDays,
    taxRate,
    currency,
    footer,
    remindDueEnabled,
    remindOverEnabled,
    remindDaysBefore,
    remindOverEvery,
    remindHourUtc,
  ]);

  return (
    <View style={styles.screen}>
      <View style={{ height: insets.top, backgroundColor: CARD }} />
      
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Feather name="arrow-left" size={20} color={TEXT} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Invoice Settings</Text>
        <TouchableOpacity
          onPress={save}
          disabled={saving}
          style={[styles.saveBtn, saving && { opacity: 0.5 }]}
        >
          <Text style={styles.saveTxt}>{saving ? "Saving..." : "Save"}</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.content} contentContainerStyle={styles.contentContainer}>
        {/* Invoice basics */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>Default Settings</Text>
            <InfoButton
              title="Invoice Defaults"
              tips={[
                "These settings apply to all new invoices created from quotes or manually.",
                "Currency should match your primary business location.",
                "Due days determine when payment is expected (e.g., 14 days = due in 2 weeks).",
                "Tax rate is your standard VAT/sales tax percentage.",
              ]}
            />
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
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Payment Due (Days)</Text>
            <TextInput
              value={dueDays}
              onChangeText={(t) => setDueDays(t.replace(/[^0-9]/g, ""))}
              keyboardType="number-pad"
              style={styles.input}
              placeholder="14"
              placeholderTextColor={MUTED}
            />
            <Text style={styles.helpText}>
              Number of days after invoice date when payment is due. Common values: 7, 14, 30 days.
            </Text>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Default Tax Rate (%)</Text>
            <TextInput
              value={taxRate}
              onChangeText={(t) =>
                setTaxRate(t.replace(/[^\d.]/g, "").replace(/^(\d*\.\d{0,2}).*$/, "$1"))
              }
              keyboardType="decimal-pad"
              style={styles.input}
              placeholder="20.00"
              placeholderTextColor={MUTED}
            />
            <Text style={styles.helpText}>
              VAT or sales tax percentage. UK standard rate is 20%. Can be overridden per invoice.
            </Text>
          </View>
        </View>

        {/* Text blocks */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>Terms & Footer</Text>
            <InfoButton
              title="Invoice Text"
              tips={[
                "Terms appear on invoices to specify payment conditions and policies.",
                "Footer is perfect for bank details, contact info, or legal disclaimers.",
                "Keep terms concise but legally clear about payment expectations.",
                "Include your business registration details in the footer if required.",
              ]}
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Payment Terms</Text>
            <TextInput
              value={terms}
              onChangeText={setTerms}
              placeholder="Payment due within 14 days of invoice date. Late payments may incur charges."
              placeholderTextColor={MUTED}
              style={[styles.input, styles.multiline]}
              multiline
              textAlignVertical="top"
            />
            <Text style={styles.helpText}>
              Standard terms that appear on all invoices. Include payment timeline and any late fees.
            </Text>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Invoice Footer</Text>
            <TextInput
              value={footer}
              onChangeText={setFooter}
              placeholder="Bank: Barclays | Sort: 12-34-56 | Account: 12345678 | Registered in England: 12345678"
              placeholderTextColor={MUTED}
              style={[styles.input, styles.multiline]}
              multiline
              textAlignVertical="top"
            />
            <Text style={styles.helpText}>
              Bank details, registration numbers, and other important information that appears at the bottom of invoices.
            </Text>
          </View>
        </View>

        {/* Reminders */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>Payment Reminders</Text>
            <InfoButton
              title="Email Reminders"
              tips={[
                "Due reminders are sent before the payment due date to prompt early payment.",
                "Overdue reminders help follow up on late payments professionally.",
                "All times are in UTC - adjust the hour based on your timezone.",
                "Reminders use your configured email settings and templates.",
              ]}
            />
          </View>

          <View style={styles.toggleRow}>
            <Text style={styles.toggleLabel}>Send due date reminders</Text>
            <Switch
              value={remindDueEnabled}
              onValueChange={setRemindDueEnabled}
              trackColor={{ false: "#e2e8f0", true: BRAND + "40" }}
              thumbColor={remindDueEnabled ? BRAND : "#f1f5f9"}
            />
          </View>

          <View style={styles.toggleRow}>
            <Text style={styles.toggleLabel}>Send overdue reminders</Text>
            <Switch
              value={remindOverEnabled}
              onValueChange={setRemindOverEnabled}
              trackColor={{ false: "#e2e8f0", true: BRAND + "40" }}
              thumbColor={remindOverEnabled ? BRAND : "#f1f5f9"}
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Days Before Due (Reminder)</Text>
            <TextInput
              value={remindDaysBefore}
              onChangeText={(t) => setRemindDaysBefore(t.replace(/[^0-9]/g, ""))}
              keyboardType="number-pad"
              style={styles.input}
              placeholder="2"
              placeholderTextColor={MUTED}
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Overdue Reminder Frequency (Days)</Text>
            <TextInput
              value={remindOverEvery}
              onChangeText={(t) => setRemindOverEvery(t.replace(/[^0-9]/g, ""))}
              keyboardType="number-pad"
              style={styles.input}
              placeholder="7"
              placeholderTextColor={MUTED}
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Send Time (UTC Hour 0-23)</Text>
            <TextInput
              value={remindHourUtc}
              onChangeText={(t) => setRemindHourUtc(t.replace(/[^0-9]/g, ""))}
              keyboardType="number-pad"
              style={styles.input}
              placeholder="9"
              placeholderTextColor={MUTED}
            />
            <Text style={styles.helpText}>
              Hour in UTC when reminders are sent. UK is UTC+0 (winter) or UTC+1 (summer).
            </Text>
          </View>
        </View>

        <View style={styles.footerNote}>
          <Text style={styles.footerText}>
            These settings apply to new invoices only. You can always customize individual invoices as needed.
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

  multiline: { 
    minHeight: 80,
    paddingTop: 12,
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