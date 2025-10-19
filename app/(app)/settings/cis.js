// app/(app)/settings/cis.js (or your current path)
import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  StatusBar,
  Platform,
  TextInput,
  Switch,
  TouchableOpacity,
  Alert,
  KeyboardAvoidingView,
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
const DANGER = "#b91c1c";
const BG = "#ffffff";

const ROLES = ["contractor", "subcontractor"];

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const parsePct = (v, def = 20) => {
  const n = Number(String(v ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? clamp(+n, 0, 100) : def;
};

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

export default function CISSettings() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  // ---------- state ----------
  const [userId, setUserId] = useState(null);
  const [initial, setInitial] = useState(null); // snapshot for dirty compare
  const [saving, setSaving] = useState(false);

  const [cis_enabled, setCisEnabled] = useState(false);
  const [cis_role, setCisRole] = useState("contractor");
  const [cis_utr, setCisUtr] = useState("");
  const [cis_verification_number, setCisVerificationNumber] = useState("");
  const [cis_deduction_rate, setCisDeductionRate] = useState(20);
  const [cis_apply_by_default, setCisApplyByDefault] = useState(false);
  const [cis_exclude_materials, setCisExcludeMaterials] = useState(true);

  // ---------- load (quiet, no spinner) ----------
  const load = useCallback(async () => {
    try {
      const { data: auth } = await supabase.auth.getUser();
      const user = auth?.user;
      if (!user) {
        router.replace("/(auth)/login");
        return;
      }
      setUserId(user.id);
      const { data, error } = await supabase
        .from("profiles")
        .select(
          `
          cis_enabled,
          cis_role,
          cis_utr,
          cis_verification_number,
          cis_deduction_rate,
          cis_apply_by_default,
          cis_exclude_materials
        `
        )
        .eq("id", user.id)
        .maybeSingle();

      if (error) throw error;

      const row = data || {};
      setCisEnabled(!!row.cis_enabled);
      setCisRole(ROLES.includes(row.cis_role) ? row.cis_role : "contractor");
      setCisUtr(row.cis_utr || "");
      setCisVerificationNumber(row.cis_verification_number || "");
      setCisDeductionRate(parsePct(row.cis_deduction_rate, 20));
      setCisApplyByDefault(!!row.cis_apply_by_default);
      // default true by schema; if null, keep true
      setCisExcludeMaterials(row.cis_exclude_materials == null ? true : !!row.cis_exclude_materials);

      setInitial({
        cis_enabled: !!row.cis_enabled,
        cis_role: ROLES.includes(row.cis_role) ? row.cis_role : "contractor",
        cis_utr: row.cis_utr || "",
        cis_verification_number: row.cis_verification_number || "",
        cis_deduction_rate: parsePct(row.cis_deduction_rate, 20),
        cis_apply_by_default: !!row.cis_apply_by_default,
        cis_exclude_materials:
          row.cis_exclude_materials == null ? true : !!row.cis_exclude_materials,
      });
    } catch (e) {
      console.warn("[cis] load", e?.message || e);
    }
  }, [router]);

  useEffect(() => {
    load();
  }, [load]);

  // ---------- derived ----------
  const dirty = useMemo(() => {
    if (!initial) return false;
    return (
      initial.cis_enabled !== cis_enabled ||
      initial.cis_role !== cis_role ||
      initial.cis_utr !== cis_utr ||
      initial.cis_verification_number !== cis_verification_number ||
      Number(initial.cis_deduction_rate) !== Number(cis_deduction_rate) ||
      initial.cis_apply_by_default !== cis_apply_by_default ||
      initial.cis_exclude_materials !== cis_exclude_materials
    );
  }, [
    initial,
    cis_enabled,
    cis_role,
    cis_utr,
    cis_verification_number,
    cis_deduction_rate,
    cis_apply_by_default,
    cis_exclude_materials,
  ]);

  // ---------- save ----------
  const onSave = useCallback(async () => {
    if (!userId) return;
    try {
      // validate
      if (cis_enabled) {
        if (!ROLES.includes(cis_role)) {
          Alert.alert("CIS role is invalid", "Choose contractor or subcontractor.");
          return;
        }
        if (!cis_utr || cis_utr.trim().length < 10) {
          Alert.alert("UTR looks short", "Enter a valid 10-digit UTR.");
          return;
        }
        const pct = clamp(Number(cis_deduction_rate || 0), 0, 100);
        if (!Number.isFinite(pct)) {
          Alert.alert("Rate invalid", "Enter a valid deduction rate between 0 and 100.");
          return;
        }
      }

      setSaving(true);

      const payload = {
        cis_enabled,
        cis_role,
        cis_utr: cis_utr.trim() || null,
        cis_verification_number: (cis_verification_number || "").trim() || null,
        cis_deduction_rate: clamp(Number(cis_deduction_rate || 0), 0, 100),
        cis_apply_by_default,
        cis_exclude_materials,
        updated_at: new Date().toISOString(),
      };

      const { error } = await supabase.from("profiles").update(payload).eq("id", userId);
      if (error) throw error;

      setInitial({ ...payload });
      Alert.alert("Saved", "Your CIS settings have been updated.");
    } catch (e) {
      console.error("[cis] save", e);
      Alert.alert("Save failed", e?.message || "Could not save CIS settings.");
    } finally {
      setSaving(false);
    }
  }, [
    userId,
    cis_enabled,
    cis_role,
    cis_utr,
    cis_verification_number,
    cis_deduction_rate,
    cis_apply_by_default,
    cis_exclude_materials,
  ]);

  // ---------- ui ----------
  const RoleChip = ({ value, label }) => {
    const active = cis_role === value;
    return (
      <TouchableOpacity
        onPress={() => setCisRole(value)}
        activeOpacity={0.9}
        style={[
          styles.chip,
          active && { backgroundColor: BRAND + "15", borderColor: BRAND },
        ]}
      >
        <View style={[styles.dot, active && { backgroundColor: BRAND, borderColor: BRAND }]} />
        <Text style={[styles.chipTxt, active && { color: BRAND }]}>{label}</Text>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.screen}>
      <View style={{ height: insets.top, backgroundColor: CARD }} />
      
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Feather name="arrow-left" size={20} color={TEXT} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>CIS Settings</Text>
        <TouchableOpacity
          onPress={onSave}
          disabled={!dirty || saving}
          style={[styles.saveBtn, (!dirty || saving) && { opacity: 0.5 }]}
        >
          <Text style={styles.saveTxt}>{saving ? "Saving..." : "Save"}</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.content} contentContainerStyle={styles.contentContainer}>
        {/* Enable CIS */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>Enable CIS</Text>
            <InfoButton
              title="CIS Overview"
              tips={[
                "CIS (Construction Industry Scheme) is a UK tax deduction scheme for construction work.",
                "Contractors deduct money from subcontractor payments and pay it to HMRC.",
                "This covers the subcontractor's advance payment towards their tax and National Insurance.",
                "Enable this to add CIS calculations to your invoices automatically.",
              ]}
            />
          </View>
          <View style={styles.toggleRow}>
            <Text style={styles.toggleLabel}>Enable CIS features</Text>
            <Switch 
              value={cis_enabled} 
              onValueChange={setCisEnabled}
              trackColor={{ false: "#e2e8f0", true: BRAND + "40" }}
              thumbColor={cis_enabled ? BRAND : "#f1f5f9"}
            />
          </View>
        </View>

        {/* Role */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>Your CIS Role</Text>
            <InfoButton
              title="CIS Roles"
              tips={[
                "Contractor: You hire subcontractors and must deduct CIS from their payments.",
                "Subcontractor: You work for contractors who deduct CIS from your payments.",
                "Choose the role that best describes your business relationship.",
              ]}
            />
          </View>
          <View style={styles.chipRow}>
            <RoleChip value="contractor" label="Contractor" />
            <RoleChip value="subcontractor" label="Subcontractor" />
          </View>
        </View>

        {/* UTR / Verification */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>Tax Details</Text>
            <InfoButton
              title="Tax Information"
              tips={[
                "UTR (Unique Taxpayer Reference) is your 10-digit tax reference number from HMRC.",
                "Verification number is issued by HMRC when you register for CIS.",
                "These details may be required on CIS invoices and certificates.",
              ]}
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Unique Taxpayer Reference (UTR)</Text>
            <TextInput
              style={styles.input}
              value={cis_utr}
              onChangeText={setCisUtr}
              placeholder="Enter 10-digit UTR"
              placeholderTextColor={MUTED}
              keyboardType="number-pad"
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Verification Number (Optional)</Text>
            <TextInput
              style={styles.input}
              value={cis_verification_number}
              onChangeText={setCisVerificationNumber}
              placeholder="HMRC verification number"
              placeholderTextColor={MUTED}
            />
          </View>
        </View>

        {/* Deduction */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>Deduction Rate</Text>
            <InfoButton
              title="CIS Deduction Rates"
              tips={[
                "Standard rate: 20% for registered subcontractors",
                "Higher rate: 30% for unverified subcontractors",
                "Some subcontractors may qualify for gross payment (0%)",
                "Enter the rate that applies to your CIS status",
              ]}
            />
          </View>
          
          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Deduction Rate (%)</Text>
            <TextInput
              style={styles.input}
              value={String(cis_deduction_rate)}
              onChangeText={(t) => setCisDeductionRate(parsePct(t))}
              keyboardType="decimal-pad"
              placeholder="20"
              placeholderTextColor={MUTED}
            />
            <Text style={styles.helpText}>
              Enter a rate between 0-100%. Common rates are 20% (registered) or 30% (unverified).
            </Text>
          </View>
        </View>

        {/* Defaults */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>Default Settings</Text>
            <InfoButton
              title="CIS Defaults"
              tips={[
                "Apply by default: Automatically include CIS calculations on new invoices",
                "Exclude materials: Materials are typically exempt from CIS deductions",
                "You can always override these settings on individual invoices",
              ]}
            />
          </View>

          <View style={styles.toggleRow}>
            <Text style={styles.toggleLabel}>Apply CIS by default</Text>
            <Switch 
              value={cis_apply_by_default} 
              onValueChange={setCisApplyByDefault}
              trackColor={{ false: "#e2e8f0", true: BRAND + "40" }}
              thumbColor={cis_apply_by_default ? BRAND : "#f1f5f9"}
            />
          </View>

          <View style={[styles.toggleRow, { marginTop: 12 }]}>
            <Text style={styles.toggleLabel}>Exclude materials from CIS</Text>
            <Switch 
              value={cis_exclude_materials} 
              onValueChange={setCisExcludeMaterials}
              trackColor={{ false: "#e2e8f0", true: BRAND + "40" }}
              thumbColor={cis_exclude_materials ? BRAND : "#f1f5f9"}
            />
          </View>

          <Text style={styles.helpText}>
            When enabled, material costs are excluded from CIS deduction calculations.
          </Text>
        </View>

        <View style={styles.footerNote}>
          <Text style={styles.footerText}>
            Changes affect new invoices and jobs going forward. You can override CIS settings on individual invoices as needed.
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
  },
  
  toggleLabel: {
    fontSize: 14,
    fontWeight: "700",
    color: TEXT,
    flex: 1,
  },

  chipRow: { 
    flexDirection: "row", 
    gap: 12, 
    marginTop: 8 
  },

  chip: {
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: "#fff",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
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