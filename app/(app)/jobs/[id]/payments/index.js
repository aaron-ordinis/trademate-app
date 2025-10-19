// app/(app)/jobs/[id]/payments/index.js
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  TextInput,
  Modal,
  Pressable,
  Platform,
  Alert,
  StatusBar,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import * as NavigationBar from "expo-navigation-bar";
import * as SystemUI from "expo-system-ui";
import { supabase } from "../../../../../lib/supabase";
import { jobHref } from "../../../../../lib/nav";
import { Feather } from "@expo/vector-icons";
import { Plus, Trash2, Edit2, CheckCircle } from "lucide-react-native";

/* ---- theme (match create.js / expenses / documents) ---- */
const BG = "#ffffff";
const CARD = "#ffffff";
const TEXT = "#0b1220";
const MUTED = "#6b7280";
const BORDER = "#e6e9ee";
const BRAND = "#2a86ff";
const SUCCESS = "#16a34a";
const WARN = "#f59e0b";
const RED = "#ef4444";

/* helpers */
const money = (v = 0, sym = "£") =>
  sym + Number(v || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

function Pill({ children, tone = "brand" }) {
  const tones = {
    brand: { bg: "#eef2ff", border: "#c7d2fe", txt: BRAND },
    ok: { bg: "#ecfdf5", border: "#bbf7d0", txt: SUCCESS },
    warn: { bg: "#fff7ed", border: "#fed7aa", txt: WARN },
  };
  const t = tones[tone] || tones.brand;
  return (
    <View style={[styles.pill, { backgroundColor: t.bg, borderColor: t.border }]}>
      <Text style={[styles.pillTxt, { color: t.txt }]}>{children}</Text>
    </View>
  );
}

export default function PaymentsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams();
  const jobId = String(id || "");

  const [userId, setUserId] = useState(null);
  const [currency, setCurrency] = useState("GBP");
  const sym = useMemo(() => (currency === "GBP" ? "£" : currency === "USD" ? "$" : "£"), [currency]);
  const [rows, setRows] = useState([]);

  // editor sheet
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const emptyDraft = { amount: "", paid_at: "", reference: "", method: "", is_deposit: false, due_only: true };
  const [draft, setDraft] = useState(emptyDraft);
  const [saving, setSaving] = useState(false);

  const inFlight = useRef(false);

  /* ---- force white system chrome like create.js ---- */
  useEffect(() => {
    const forceWhite = async () => {
      try {
        StatusBar.setBarStyle("dark-content", false);
        if (Platform.OS === "android") {
          StatusBar.setBackgroundColor("#ffffff", false);
          await NavigationBar.setBackgroundColorAsync("#ffffff");
          await NavigationBar.setButtonStyleAsync("dark");
          if (NavigationBar.setBorderColorAsync) {
            await NavigationBar.setBorderColorAsync("#ffffff");
          }
        }
        await SystemUI.setBackgroundColorAsync("#ffffff");
      } catch {}
    };
    forceWhite();
  }, []);

  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const auth = await supabase.auth.getUser();
      const user = auth?.data?.user;
      if (!user) {
        router.replace("/(auth)/login");
        return;
      }
      setUserId(user.id);

      const prof = await supabase
        .from("profiles")
        .select("invoice_currency")
        .eq("id", user.id)
        .maybeSingle();
      if (prof?.data?.invoice_currency) setCurrency(String(prof.data.invoice_currency));

      const q = await supabase
        .from("payments")
        .select("id, amount, paid_at, method, reference, is_deposit, job_id, invoice_id, created_at, voided_at")
        .eq("job_id", jobId)
        .is("deleted_at", null)
        .order("created_at", { ascending: true });

      setRows(q.data || []);
    } catch (e) {
      console.error("[payments] load", e);
      Alert.alert("Error", e?.message || "Failed to load payments");
    } finally {
      inFlight.current = false;
    }
  }, [jobId, router]);

  useEffect(() => { load(); }, [load]);

  const totals = useMemo(() => {
    let paid = 0;
    let due = 0;
    for (const p of rows) {
      if (p.voided_at) continue;
      const amt = Number(p.amount || 0);
      if (p.paid_at) paid += amt;
      else due += amt;
    }
    return { paid, due };
  }, [rows]);

  function openAdd(depositDefault = false) {
    Haptics.selectionAsync();
    setEditingId(null);
    setDraft({
      amount: "",
      paid_at: "",
      method: "",
      reference: "",
      is_deposit: !!depositDefault,
      due_only: true,
    });
    setSheetOpen(true);
  }

  function openEdit(p) {
    Haptics.selectionAsync();
    setEditingId(p.id);
    setDraft({
      amount: String(p.amount ?? ""),
      paid_at: p.paid_at ? String(p.paid_at) : "",
      method: p.method || "",
      reference: p.reference || "",
      is_deposit: !!p.is_deposit,
      due_only: !p.paid_at,
    });
    setSheetOpen(true);
  }

  async function save() {
    try {
      if (!userId || !jobId) return;
      setSaving(true);

      const payload = {
        job_id: jobId,
        amount: draft.amount === "" ? 0 : Number(draft.amount),
        paid_at: draft.due_only ? null : (draft.paid_at || new Date().toISOString().slice(0, 10)),
        method: draft.method || null,
        reference: draft.reference || null,
        is_deposit: !!draft.is_deposit,
      };

      if (!payload.amount || payload.amount <= 0) {
        Alert.alert("Enter amount", "Amount must be greater than 0.");
        setSaving(false);
        return;
      }

      if (editingId) {
        const { error } = await supabase.from("payments").update(payload).eq("id", editingId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("payments").insert(payload);
        if (error) throw error;
      }
      setSheetOpen(false);
      setDraft(emptyDraft);
      await load();
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch (e) {
      console.error("[payments] save", e);
      Alert.alert("Save failed", e?.message || "Could not save payment.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id) {
    try {
      Haptics.selectionAsync();
      const { error } = await supabase.from("payments").update({ deleted_at: new Date().toISOString() }).eq("id", id);
      if (error) throw error;
      await load();
    } catch (e) {
      Alert.alert("Delete failed", e?.message || "Could not delete payment.");
    }
  }

  async function togglePaid(p) {
    try {
      const nextPaidAt = p.paid_at ? null : new Date().toISOString().slice(0, 10);
      const { error } = await supabase.from("payments").update({ paid_at: nextPaidAt }).eq("id", p.id);
      if (error) throw error;
      await load();
      Haptics.selectionAsync();
    } catch (e) {
      Alert.alert("Update failed", e?.message || "Could not update.");
    }
  }

  /* ---- COMPACT card like Documents/Expenses: amount + small pills + icon buttons ---- */
  const renderRow = ({ item: p }) => {
    const isPaid = !!p.paid_at;
    return (
      <View style={styles.cardCompact}>
        <View style={{ flex: 1 }}>
          <Text style={styles.amountTitle} numberOfLines={1}>
            {money(p.amount, sym)}
          </Text>

          <View style={styles.badgeRow}>
            <Pill tone={isPaid ? "ok" : "warn"}>{isPaid ? "PAID" : "DUE"}</Pill>
            {p.is_deposit ? <Pill>DEP</Pill> : null}
          </View>
        </View>

        <View style={styles.iconRow}>
          <TouchableOpacity
            onPress={() => togglePaid(p)}
            style={styles.iconBtnSm}
            activeOpacity={0.85}
          >
            <CheckCircle size={16} color={isPaid ? SUCCESS : MUTED} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => openEdit(p)}
            style={styles.iconBtnSm}
            activeOpacity={0.85}
          >
            <Edit2 size={16} color={TEXT} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => remove(p.id)}
            style={[styles.iconBtnSm, { backgroundColor: "#fff5f5", borderColor: "#ffd3d3" }]}
            activeOpacity={0.85}
          >
            <Trash2 size={16} color={RED} />
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.screen}>
      <StatusBar barStyle="dark-content" backgroundColor="#ffffff" translucent={false} />
      {/* Safe top */}
      <View style={{ height: insets.top, backgroundColor: CARD }} />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => router.replace(jobHref(jobId))}
        >
          <Feather name="arrow-left" size={20} color={TEXT} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Payments</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Info row with compact pills (no spinner) */}
      <View style={styles.infoRow}>
        <Pill tone="ok">Paid {money(totals.paid, sym)}</Pill>
        <Pill tone="warn">Due {money(totals.due, sym)}</Pill>
      </View>

      {/* List (no loading flicker; quietly refreshes) */}
      <FlatList
        data={rows}
        keyExtractor={(p) => String(p.id)}
        contentContainerStyle={{ padding: 12, paddingBottom: 96 + insets.bottom }}
        renderItem={renderRow}
        ListEmptyComponent={
          <View style={[styles.cardEmpty, { alignItems: "center" }]}>
            <Text style={styles.muted}>No payments yet.</Text>
          </View>
        }
        // No refreshing spinner to avoid flicker; if you want pull-to-refresh use a state here.
      />

      {/* FAB */}
      <TouchableOpacity
        style={[styles.fab, { bottom: 24 + insets.bottom }]}
        onPress={() => openAdd(false)}
        activeOpacity={0.92}
      >
        <Plus size={20} color="#fff" />
      </TouchableOpacity>

      {/* Bottom sheet */}
      <Modal visible={sheetOpen} animationType="fade" transparent onRequestClose={() => setSheetOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setSheetOpen(false)} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.sheetHead}>
            <Text style={styles.sheetTitle}>{editingId ? "Edit payment" : "Add payment"}</Text>
            <TouchableOpacity onPress={() => setSheetOpen(false)} style={styles.iconBtnMini} activeOpacity={0.85}>
              <Feather name="x" size={16} color={MUTED} />
            </TouchableOpacity>
          </View>

          <Text style={styles.label}>Amount</Text>
          <TextInput
            value={draft.amount}
            onChangeText={(t) => setDraft((s) => ({ ...s, amount: t.replace(/[^0-9.]/g, "") }))}
            keyboardType="decimal-pad"
            style={styles.input}
            placeholder="0.00"
            placeholderTextColor={MUTED}
          />

          <View style={{ flexDirection: "row", gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Method</Text>
              <TextInput
                value={draft.method}
                onChangeText={(t) => setDraft((s) => ({ ...s, method: t }))}
                style={styles.input}
                placeholder="e.g. Bank transfer"
                placeholderTextColor={MUTED}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Reference</Text>
              <TextInput
                value={draft.reference}
                onChangeText={(t) => setDraft((s) => ({ ...s, reference: t }))}
                style={styles.input}
                placeholder="optional"
                placeholderTextColor={MUTED}
              />
            </View>
          </View>

          <View style={{ flexDirection: "row", gap: 10 }}>
            <TouchableOpacity
              onPress={() => setDraft((s) => ({ ...s, is_deposit: !s.is_deposit }))}
              style={styles.checkRow}
              activeOpacity={0.9}
            >
              <View style={[styles.checkbox, draft.is_deposit && styles.checkboxOn]} />
              <Text style={styles.checkLabel}>Deposit</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => setDraft((s) => ({ ...s, due_only: !s.due_only }))}
              style={styles.checkRow}
              activeOpacity={0.9}
            >
              <View style={[styles.checkbox, !draft.due_only && styles.checkboxOn]} />
              <Text style={styles.checkLabel}>{draft.due_only ? "Set as Due" : "Mark Paid (today)"}</Text>
            </TouchableOpacity>
          </View>

          <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
            <TouchableOpacity
              style={[styles.sheetBtn, { flex: 1, backgroundColor: "#eef2f7" }]}
              onPress={() => setSheetOpen(false)}
              activeOpacity={0.9}
            >
              <Text style={[styles.sheetBtnTxt, { color: TEXT }]}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.primaryAction, { flex: 1 }]}
              onPress={save}
              activeOpacity={0.9}
              disabled={saving}
            >
              <Text style={styles.primaryActionTxt}>{saving ? "Saving…" : "Save"}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Safe bottom */}
      <View style={{ height: insets.bottom, backgroundColor: "#ffffff" }} />
    </View>
  );
}

/* ---- styles (COMPACT like documents/expenses) ---- */
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },
  /* header */
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
  headerTitle: { fontSize: 18, fontWeight: "900", color: TEXT },

  /* info row under header */
  infoRow: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  pill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  pillTxt: { fontWeight: "900", fontSize: 13 },

  /* compact cards */
  cardCompact: {
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 14,
    padding: 10,
    marginBottom: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    ...Platform.select({
      ios: {
        shadowColor: "#0b1220",
        shadowOpacity: 0.03,
        shadowRadius: 6,
        shadowOffset: { width: 0, height: 2 },
      },
      android: { elevation: 1 },
    }),
  },
  amountTitle: { color: TEXT, fontWeight: "900", fontSize: 15 },
  badgeRow: { flexDirection: "row", gap: 6, marginTop: 4 },

  iconRow: { flexDirection: "row", gap: 6 },
  iconBtnSm: {
    height: 30,
    width: 30,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: "#f3f4f6",
  },

  cardEmpty: {
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 14,
    padding: 12,
    marginBottom: 8,
  },

  muted: { color: MUTED, fontWeight: "700" },

  /* FAB */
  fab: {
    position: "absolute",
    right: 16,
    height: 52,
    width: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: BRAND,
    shadowColor: "#1e293b",
    shadowOpacity: 0.22,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },

  /* bottom sheet */
  backdrop: { flex: 1, backgroundColor: "#0008" },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: CARD,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    padding: 16,
    borderTopWidth: 1,
    borderColor: BORDER,
  },
  handle: {
    alignSelf: "center",
    width: 44,
    height: 5,
    borderRadius: 999,
    backgroundColor: BORDER,
    marginBottom: 8,
  },
  sheetHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  sheetTitle: { color: TEXT, fontWeight: "900", fontSize: 16 },
  iconBtnMini: {
    height: 28,
    width: 28,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: "#f3f4f6",
  },

  label: { color: MUTED, fontWeight: "800", marginTop: 8, marginBottom: 6 },
  input: {
    backgroundColor: "#fff",
    color: TEXT,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: BORDER,
    marginBottom: 10,
    fontWeight: "600",
  },

  checkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 4,
    paddingVertical: 6,
    paddingHorizontal: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: "#f8fafc",
    flex: 1,
  },
  checkbox: {
    width: 18,
    height: 18,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: "#cbd5e1",
    backgroundColor: "#ffffff",
  },
  checkboxOn: { backgroundColor: BRAND, borderColor: BRAND },
  checkLabel: { color: TEXT, fontWeight: "800" },

  sheetBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: "#f8fafc",
    marginTop: 8,
  },
  sheetBtnTxt: { color: TEXT, fontWeight: "800" },

  primaryAction: {
    backgroundColor: BRAND,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: BRAND,
  },
  primaryActionTxt: { color: "#fff", fontWeight: "900" },
});