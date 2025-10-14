// app/(app)/jobs/[id]/payments/index.js
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Modal,
  Pressable,
  Platform,
  ActivityIndicator,
  Alert,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { supabase } from "../../../../../lib/supabase";
import { ChevronLeft, Plus, Trash2, Edit2, CheckCircle } from "lucide-react-native";

/* theme (kept consistent with jobs screen) */
const BG = "#f5f7fb";
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

function Badge({ label, color, soft = true }) {
  return (
    <View
      style={[
        styles.badge,
        { backgroundColor: soft ? color + "22" : color, borderColor: color },
      ]}
    >
      <Text style={[styles.badgeTxt, { color }]}>{label}</Text>
    </View>
  );
}

export default function PaymentsScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams();
  const jobId = String(id || "");

  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState(null);
  const [jobTitle, setJobTitle] = useState("Payments");

  const [currency, setCurrency] = useState("GBP");
  const sym = useMemo(() => (currency === "GBP" ? "£" : currency === "USD" ? "$" : "£"), [currency]);

  const [rows, setRows] = useState([]);

  // editor modal
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const emptyDraft = { amount: "", paid_at: "", reference: "", method: "", is_deposit: false, due_only: true };
  const [draft, setDraft] = useState(emptyDraft);
  const [saving, setSaving] = useState(false);

  const inFlight = useRef(false);

  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      setLoading(true);
      const auth = await supabase.auth.getUser();
      const user = auth?.data?.user;
      if (!user) {
        router.replace("/(auth)/login");
        return;
      }
      setUserId(user.id);

      // currency + title from profile / job
      const prof = await supabase.from("profiles").select("invoice_currency").eq("id", user.id).maybeSingle();
      if (prof?.data?.invoice_currency) setCurrency(String(prof.data.invoice_currency));

      const jobQ = await supabase.from("jobs").select("title").eq("id", jobId).maybeSingle();
      if (!jobQ.error && jobQ.data) setJobTitle(jobQ.data.title || "Payments");

      // load payments
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
      setLoading(false);
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
    setOpen(true);
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
    setOpen(true);
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
      setOpen(false);
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

  return (
    <View style={styles.screen}>
      {/* header */}
      <View style={styles.top}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => router.replace(`/jobs/${jobId}`)}
          activeOpacity={0.9}
        >
          <ChevronLeft size={18} color={BRAND} />
          <Text style={styles.backTxt}>Back</Text>
        </TouchableOpacity>

        <Text style={styles.h1} numberOfLines={1}>Payments</Text>

        <TouchableOpacity style={styles.addBtn} onPress={() => openAdd(false)} activeOpacity={0.9}>
          <Plus size={18} color="#fff" />
          <Text style={styles.addTxt}>Add</Text>
        </TouchableOpacity>
      </View>

      {/* summary card */}
      <View style={[styles.card, styles.shadow, { marginHorizontal: 14 }]}>
        <Text style={styles.section}>Summary</Text>
        <View style={styles.rowBetween}>
          <Text style={styles.muted}>Paid</Text>
          <Text style={styles.bold}>{money(totals.paid, sym)}</Text>
        </View>
        <View style={styles.rowBetween}>
          <Text style={styles.muted}>Due</Text>
          <Text style={styles.bold}>{money(totals.due, sym)}</Text>
        </View>

        {/* slim progress */}
        <View style={styles.progressTrack}>
          <View
            style={[
              styles.progressFill,
              { width: `${(totals.paid / Math.max(1, totals.paid + totals.due)) * 100}%` },
            ]}
          />
        </View>
      </View>

      {/* list */}
      {loading ? (
        <View style={[styles.center, { flex: 1 }]}>
          <ActivityIndicator color={BRAND} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingBottom: 32 }}
          showsVerticalScrollIndicator={false}
        >
          <View style={{ paddingHorizontal: 14, gap: 10, marginTop: 10 }}>
            {rows.length === 0 ? (
              <View style={[styles.card, { alignItems: "center" }]}>
                <Text style={styles.muted}>No payments yet.</Text>
              </View>
            ) : (
              rows.map((p, i) => (
                <View key={p.id} style={[styles.card, styles.shadow]}>
                  <View style={styles.rowTop}>
                    <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
                      <Badge
                        label={p.paid_at ? "PAID" : "DUE"}
                        color={p.paid_at ? SUCCESS : WARN}
                      />
                      {p.is_deposit ? <Badge label="DEP" color={BRAND} /> : null}
                    </View>

                    <Text style={styles.amount}>{money(p.amount, sym)}</Text>
                  </View>

                  <View style={{ marginTop: 6 }}>
                    <Text style={styles.subLine}>
                      {p.paid_at ? "Paid " + String(p.paid_at) : "Due —"}
                    </Text>
                    {(p.method || p.reference) ? (
                      <Text style={styles.subLine}>
                        {(p.method ? p.method : "—") + "  " + (p.reference ? "• " + p.reference : "")}
                      </Text>
                    ) : null}
                  </View>

                  <View style={styles.rowActions}>
                    <TouchableOpacity
                      onPress={() => togglePaid(p)}
                      style={[styles.actionBtn, styles.ghostBtn]}
                      activeOpacity={0.9}
                    >
                      <CheckCircle size={18} color={p.paid_at ? SUCCESS : MUTED} />
                      <Text style={[styles.actionTxt, { color: p.paid_at ? SUCCESS : TEXT }]}>
                        {p.paid_at ? "Mark due" : "Mark paid"}
                      </Text>
                    </TouchableOpacity>

                    <View style={{ flexDirection: "row", gap: 8 }}>
                      <TouchableOpacity
                        onPress={() => openEdit(p)}
                        style={[styles.iconBtn, { borderColor: BORDER }]}
                        activeOpacity={0.85}
                      >
                        <Edit2 size={16} color={TEXT} />
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => remove(p.id)}
                        style={[styles.iconBtn, { borderColor: "#ffd3d3", backgroundColor: "#fff5f5" }]}
                        activeOpacity={0.85}
                      >
                        <Trash2 size={16} color={RED} />
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              ))
            )}
          </View>
        </ScrollView>
      )}

      {/* editor modal */}
      <Modal visible={open} animationType="fade" transparent onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.modalBg} onPress={() => setOpen(false)}>
          <Pressable style={styles.modalCard} onPress={() => {}}>
            <Text style={styles.modalTitle}>{editingId ? "Edit payment" : "Add payment"}</Text>

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
                style={[styles.checkRow]}
                activeOpacity={0.9}
              >
                <View style={[styles.checkbox, draft.is_deposit && styles.checkboxOn]} />
                <Text style={styles.checkLabel}>Deposit</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => setDraft((s) => ({ ...s, due_only: !s.due_only }))}
                style={[styles.checkRow]}
                activeOpacity={0.9}
              >
                <View style={[styles.checkbox, !draft.due_only && styles.checkboxOn]} />
                <Text style={styles.checkLabel}>{draft.due_only ? "Set as Due" : "Mark Paid (today)"}</Text>
              </TouchableOpacity>
            </View>

            <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalGhost]}
                onPress={() => setOpen(false)}
                activeOpacity={0.9}
              >
                <Text style={[styles.modalBtnTxt, { color: TEXT }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalPrimary]}
                onPress={save}
                activeOpacity={0.9}
                disabled={saving}
              >
                <Text style={[styles.modalBtnTxt, { color: "#fff" }]}>{saving ? "Saving…" : "Save"}</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

/* styles */
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG, paddingTop: Platform.OS === "android" ? 8 : 0 },
  center: { alignItems: "center", justifyContent: "center" },

  top: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, paddingVertical: 12 },
  backBtn: { minWidth: 72, flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 6, paddingLeft: 2, paddingRight: 8, borderRadius: 10 },
  backTxt: { color: BRAND, fontWeight: "800", fontSize: 16 },
  h1: { color: TEXT, fontWeight: "900", fontSize: 22 },
  addBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: BRAND, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12 },
  addTxt: { color: "#fff", fontWeight: "900" },

  card: { backgroundColor: CARD, borderRadius: 14, borderWidth: 1, borderColor: BORDER, padding: 12 },
  shadow: { shadowColor: "#0b1220", shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 3 },

  section: { color: TEXT, fontWeight: "900", fontSize: 16, marginBottom: 8 },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2 },
  muted: { color: MUTED, fontWeight: "700" },
  bold: { color: TEXT, fontWeight: "900" },

  progressTrack: { height: 8, borderRadius: 999, backgroundColor: "#e9eef6", marginTop: 10, overflow: "hidden" },
  progressFill: { height: 8, backgroundColor: SUCCESS },

  rowTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  amount: { color: TEXT, fontWeight: "900", fontSize: 18 },

  subLine: { color: MUTED, marginTop: 2, fontWeight: "700" },

  rowActions: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 10 },
  ghostBtn: { backgroundColor: "#f3f6fb", borderColor: BORDER },
  actionBtn: { flexDirection: "row", gap: 8, alignItems: "center", paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, borderWidth: 1 },
  actionTxt: { fontWeight: "800" },
  iconBtn: { height: 38, width: 38, borderRadius: 12, alignItems: "center", justifyContent: "center", borderWidth: 1, backgroundColor: "#fff" },

  badge: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, borderWidth: 1 },
  badgeTxt: { fontWeight: "900", fontSize: 12 },

  /* modal */
  modalBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.25)", alignItems: "center", justifyContent: "center", paddingHorizontal: 18 },
  modalCard: { width: "100%", maxWidth: 520, backgroundColor: "#fff", borderRadius: 16, padding: 16, borderWidth: 1, borderColor: BORDER, shadowColor: "#0b1220", shadowOpacity: 0.15, shadowRadius: 18, shadowOffset: { width: 0, height: 10 }, elevation: 8 },
  modalTitle: { color: TEXT, fontWeight: "900", fontSize: 18, marginBottom: 6 },
  label: { color: MUTED, fontWeight: "800", marginTop: 8, marginBottom: 6 },
  input: { backgroundColor: "#fff", color: TEXT, borderRadius: 10, padding: 10, borderWidth: 1, borderColor: BORDER },

  checkRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 },
  checkbox: { width: 20, height: 20, borderRadius: 6, borderWidth: 1.5, borderColor: "#cbd5e1", backgroundColor: "#ffffff" },
  checkboxOn: { backgroundColor: BRAND, borderColor: BRAND },
  checkLabel: { color: TEXT, fontWeight: "800" },

  modalBtn: { flex: 1, height: 46, borderRadius: 12, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  modalGhost: { backgroundColor: "#eef2f7", borderColor: BORDER },
  modalPrimary: { backgroundColor: BRAND, borderColor: BRAND },
  modalBtnTxt: { fontWeight: "900", fontSize: 15 },
});