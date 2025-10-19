/* app/(app)/jobs/[id]/expenses/index.js */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Platform,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  Modal,
  Pressable,
  TextInput,
  Alert,
  DeviceEventEmitter,
  StatusBar,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as NavigationBar from "expo-navigation-bar";
import * as SystemUI from "expo-system-ui";
import { supabase } from "../../../../../lib/supabase";
import { jobHref } from "../../../../../lib/nav";
import { Plus, Trash2, X, Pencil } from "lucide-react-native";
import { Feather } from "@expo/vector-icons";

/* ---------- THEME: match create.js ---------- */
const BG = "#ffffff",
  CARD = "#ffffff",
  TEXT = "#0b1220",
  MUTED = "#6b7280",
  BORDER = "#e6e9ee",
  BRAND = "#2a86ff",
  DANGER = "#e11d48";

/* ---------- helpers ---------- */
const money = (v = 0) =>
  "£" + Number(v || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const isMissingColumn = (err) =>
  err && (err.code === "42703" || /column .* does not exist/i.test(err.message || ""));
const isUniqueViolation = (err) => err && err.code === "23505";

export default function JobExpenses() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams();
  const jobId = String(id || "");

  const [busy, setBusy] = useState(false);
  const [items, setItems] = useState([]);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");

  const resetSheet = () => {
    setEditingId(null);
    setTitle("");
    setAmount("");
    setNote("");
  };

  /* ---------- Force white system chrome like create.js ---------- */
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

  /* ---------- server-first recalc (RPC), otherwise client fallback ---------- */
  const recalcJobTotals = useCallback(
    async (listForFallback) => {
      if (!jobId) return;
      try {
        const rpc = await supabase.rpc("recalc_job_totals", { p_job_id: jobId });
        if (!rpc.error) {
          DeviceEventEmitter.emit("jobs:changed");
          return;
        }
        if (rpc.error && rpc.error.code !== "42883") {
          console.warn("[expenses] recalc RPC err:", rpc.error);
        }
      } catch (e) {
        console.warn("[expenses] recalc RPC threw:", e?.message || e);
      }

      // fallback compute
      try {
        const cost = Array.isArray(listForFallback)
          ? listForFallback.reduce((a, e) => a + Number(e.amount || 0), 0)
          : 0;

        const jr = await supabase.from("jobs").select("id,total").eq("id", jobId).maybeSingle();
        const totalJob = Number(jr.data?.total || 0);
        const profit = totalJob - cost;
        const margin_pct = totalJob > 0 ? Number(((profit / totalJob) * 100).toFixed(2)) : 0;

        let payload = { cost, profit, margin_pct, updated_at: new Date().toISOString() };
        let upd = await supabase.from("jobs").update(payload).eq("id", jobId);

        if (upd.error && isMissingColumn(upd.error)) {
          payload = { cost, profit, updated_at: new Date().toISOString() };
          const upd2 = await supabase.from("jobs").update(payload).eq("id", jobId);
          if (upd2.error && isMissingColumn(upd2.error)) {
            await supabase
              .from("jobs")
              .update({ cost, updated_at: new Date().toISOString() })
              .eq("id", jobId);
          }
        }

        DeviceEventEmitter.emit("jobs:changed");
      } catch (e) {
        console.warn("[expenses] client recalc failed:", e?.message || e);
      }
    },
    [jobId]
  );

  /* ---------- load expenses ---------- */
  const load = useCallback(async () => {
    if (!jobId) return;
    setBusy(true);
    try {
      let { data, error } = await supabase
        .from("expenses")
        .select("id, name, qty, unit_cost, total, notes, created_at")
        .eq("job_id", jobId)
        .order("created_at", { ascending: false });

      if (error && isMissingColumn(error)) {
        // legacy
        const res2 = await supabase
          .from("expenses")
          .select("id, title, amount, date, note, created_at")
          .eq("job_id", jobId)
          .order("created_at", { ascending: false });
        if (res2.error) throw res2.error;

        const mappedLegacy = (res2.data || []).map((r) => ({
          id: r.id,
          title: r.title || "Expense",
          amount: Number(r.amount || 0),
          date: r.date || r.created_at,
          note: r.note || null,
          created_at: r.created_at,
        }));
        setItems(mappedLegacy);
        await recalcJobTotals(mappedLegacy);
        return;
      }
      if (error) throw error;

      const mappedNew = (data || []).map((r) => {
        const totalNum = Number(r.total);
        const qtyNum = Number(r.qty);
        const unitNum = Number(r.unit_cost);
        const computed = Number.isFinite(totalNum)
          ? totalNum
          : Number.isFinite(qtyNum) && Number.isFinite(unitNum)
          ? qtyNum * unitNum
          : Number.isFinite(unitNum)
          ? unitNum
          : 0;

        return {
          id: r.id,
          title: r.name || "Expense",
          amount: Number(computed),
          date: r.created_at,
          note: r.notes || null,
          created_at: r.created_at,
        };
      });
      setItems(mappedNew);
      await recalcJobTotals(mappedNew);
    } catch (e) {
      console.error("[expenses] load", e);
      Alert.alert("Error", e?.message || "Failed to load expenses");
    } finally {
      setBusy(false);
    }
  }, [jobId, recalcJobTotals]);

  useEffect(() => {
    load();
  }, [load]);

  const total = useMemo(
    () =>
      Array.isArray(items)
        ? items.reduce((a, e) => a + Number(e.amount || 0), 0)
        : 0,
    [items]
  );

  /* ---------- add OR edit expense ---------- */
  const saveSheet = async () => {
    try {
      const n = Number(String(amount).replace(/[^0-9.-]/g, ""));
      if (!Number.isFinite(n)) {
        Alert.alert("Amount required", "Enter a valid number.");
        return;
      }
      setBusy(true);

      const nowIso = new Date().toISOString();
      const expenseBaseName = (title || "").trim() || "Expense";

      if (editingId) {
        // UPDATE (new schema → legacy fallback)
        let upd = await supabase
          .from("expenses")
          .update({
            name: expenseBaseName,
            qty: 1,
            unit_cost: n,
            total: n,
            notes: (note || "").trim() || null,
            updated_at: nowIso,
          })
          .eq("id", editingId);

        if (upd.error && isMissingColumn(upd.error)) {
          const upd2 = await supabase
            .from("expenses")
            .update({
              title: expenseBaseName,
              amount: n,
              note: (note || "").trim() || null,
              date: nowIso.slice(0, 10),
            })
            .eq("id", editingId);
          if (upd2.error) throw upd2.error;
        } else if (upd.error) {
          throw upd.error;
        }
      } else {
        // INSERT
        const { data: auth } = await supabase.auth.getUser();
        const userId = auth?.user?.id;
        if (!userId) throw new Error("Not signed in");

        let fingerprint = `${expenseBaseName.toLowerCase()}|job:${jobId}|user:${userId}|${n}|${nowIso}`;

        let ins = await supabase.from("expenses").insert({
          user_id: userId,
          job_id: jobId,
          kind: "expense",
          name: expenseBaseName,
          qty: 1,
          unit: null,
          unit_cost: n,
          total: n,
          notes: (note || "").trim() || null,
          fingerprint,
          created_at: nowIso,
          updated_at: nowIso,
        });

        if (ins.error && isUniqueViolation(ins.error)) {
          fingerprint = `${fingerprint}|rnd:${Math.random().toString(36).slice(2)}`;
          ins = await supabase.from("expenses").insert({
            user_id: userId,
            job_id: jobId,
            kind: "expense",
            name: expenseBaseName,
            qty: 1,
            unit: null,
            unit_cost: n,
            total: n,
            notes: (note || "").trim() || null,
            fingerprint,
            created_at: nowIso,
            updated_at: nowIso,
          });
        }

        if (ins.error && isMissingColumn(ins.error)) {
          const res2 = await supabase.from("expenses").insert({
            job_id: jobId,
            title: expenseBaseName,
            amount: n,
            date: nowIso.slice(0, 10),
            note: (note || "").trim() || null,
          });
          if (res2.error) throw res2.error;
        } else if (ins.error) {
          throw ins.error;
        }
      }

      resetSheet();
      setSheetOpen(false);
      await load();
    } catch (e) {
      console.error("[expenses] saveSheet", e);
      Alert.alert("Save failed", e?.message || "Could not save expense.");
    } finally {
      setBusy(false);
    }
  };

  /* ---------- delete expense ---------- */
  const remove = async (row) => {
    try {
      setBusy(true);
      const { error } = await supabase.from("expenses").delete().eq("id", row.id);
      if (error) throw error;
      await load();
    } catch (e) {
      console.error("[expenses] delete", e);
      Alert.alert("Delete failed", e?.message || "Could not delete expense.");
    } finally {
      setBusy(false);
    }
  };

  const openAdd = () => {
    resetSheet();
    setSheetOpen(true);
  };
  const openEdit = (row) => {
    setEditingId(row.id);
    setTitle(row.title || "");
    setAmount(String(row.amount ?? ""));
    setNote(row.note || "");
    setSheetOpen(true);
  };

  const goBackToJob = () => {
    DeviceEventEmitter.emit("jobs:changed");
    router.replace(jobHref(jobId));
  };

  /* ---------- UI ---------- */
  return (
    <View style={s.screen}>
      <StatusBar barStyle="dark-content" backgroundColor="#ffffff" translucent={false} />
      {/* Safe top like create.js */}
      <View style={{ height: insets.top, backgroundColor: CARD }} />

      {/* Header: back, centered title, spacer */}
      <View style={s.header}>
        <TouchableOpacity style={s.backBtn} onPress={goBackToJob}>
          <Feather name="arrow-left" size={20} color={TEXT} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Expenses</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Tiny info row below header */}
      <View style={s.infoRow}>
        <View style={s.totalPill}>
          <Text style={s.totalPillTxt}>Total {money(total)}</Text>
        </View>
        {busy ? <ActivityIndicator size="small" color={BRAND} /> : null}
      </View>

      {/* Compact list */}
      <FlatList
        data={items}
        keyExtractor={(it) => String(it.id)}
        refreshing={busy}
        onRefresh={load}
        contentContainerStyle={{ padding: 12, paddingBottom: 96 + insets.bottom }}
        renderItem={({ item }) => (
          <View style={s.card}>
            <View style={{ flex: 1 }}>
              <Text style={s.name} numberOfLines={2}>
                {item.title || "Expense"}
              </Text>
              <Text style={s.meta} numberOfLines={2}>
                {new Date(item.date || item.created_at).toLocaleDateString()}
                {item.note ? ` • ${item.note}` : ""}
              </Text>
            </View>

            <View style={s.rightCol}>
              <Text style={s.amount}>{money(item.amount)}</Text>
              <View style={s.rowBtns}>
                <TouchableOpacity style={s.iconBtn} onPress={() => openEdit(item)}>
                  <Pencil size={16} color={MUTED} />
                </TouchableOpacity>
                <TouchableOpacity
                  style={[s.iconBtn, s.iconBtnDanger]}
                  onPress={() => remove(item)}
                >
                  <Trash2 size={16} color={DANGER} />
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}
        ListEmptyComponent={
          !busy ? (
            <View style={{ alignItems: "center", marginTop: 24 }}>
              <Text style={{ color: MUTED, fontWeight: "800", fontSize: 13 }}>No expenses yet.</Text>
            </View>
          ) : null
        }
      />

      {/* FAB (slightly smaller, compact) */}
      <TouchableOpacity style={[s.fab, { bottom: 24 + insets.bottom }]} onPress={openAdd} activeOpacity={0.92}>
        <Plus size={20} color="#fff" />
      </TouchableOpacity>

      {/* Add/Edit Sheet */}
      <Modal visible={sheetOpen} animationType="fade" transparent>
        <Pressable style={s.backdrop} onPress={() => setSheetOpen(false)} />
        <View style={s.sheet}>
          <View style={s.handle} />
          <View style={s.sheetHead}>
            <Text style={s.sheetTitle}>{editingId ? "Edit expense" : "Add expense (manual)"}</Text>
            <TouchableOpacity style={s.iconBtn} onPress={() => setSheetOpen(false)}>
              <X size={18} color={MUTED} />
            </TouchableOpacity>
          </View>

          <Text style={s.label}>Title</Text>
          <TextInput
            style={s.input}
            value={title}
            onChangeText={setTitle}
            placeholder="e.g. Materials"
            placeholderTextColor={MUTED}
          />

          <Text style={s.label}>Amount</Text>
          <TextInput
            style={s.input}
            value={amount}
            onChangeText={(t) => setAmount(t.replace(/[^0-9.-]/g, ""))}
            keyboardType="decimal-pad"
            placeholder="0.00"
            placeholderTextColor={MUTED}
          />

          <Text style={s.label}>Note (optional)</Text>
          <TextInput
            style={[s.input, { height: 44 }]}
            value={note}
            onChangeText={setNote}
            placeholder="Short note"
            placeholderTextColor={MUTED}
          />

          <TouchableOpacity
            style={[s.primaryAction]}
            onPress={saveSheet}
            activeOpacity={0.9}
          >
            <Text style={s.primaryActionTxt}>{editingId ? "Save changes" : "Save"}</Text>
          </TouchableOpacity>
        </View>
      </Modal>

      {/* Safe bottom */}
      <View style={{ height: insets.bottom, backgroundColor: "#ffffff" }} />
    </View>
  );
}

/* ---------- styles ---------- */
const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },

  /* header (match create.js) */
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
  },

  /* small info row below header */
  infoRow: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  totalPill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "#eef2ff",
    borderWidth: 1,
    borderColor: "#c7d2fe",
  },
  totalPillTxt: { color: BRAND, fontWeight: "900", fontSize: 13 },

  /* list card (compact) */
  card: {
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
    padding: 10,
    marginBottom: 8,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    ...Platform.select({
      ios: {
        shadowColor: "#0b1220",
        shadowOpacity: 0.04,
        shadowRadius: 6,
        shadowOffset: { width: 0, height: 2 },
      },
      android: { elevation: 2 },
    }),
  },
  name: { color: TEXT, fontWeight: "900", fontSize: 14 },
  meta: { color: MUTED, marginTop: 2, fontWeight: "700", fontSize: 12 },

  rightCol: { alignItems: "flex-end", gap: 6, minWidth: 110 },
  amount: { color: TEXT, fontWeight: "900", fontSize: 14 },
  rowBtns: { flexDirection: "row", gap: 6 },

  iconBtn: {
    height: 28,
    width: 28,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: "#f3f4f6",
  },
  iconBtnDanger: { backgroundColor: "#fee2e2", borderColor: "#fecaca" },

  /* modal actions & inputs */
  label: { color: MUTED, fontWeight: "800", marginTop: 6, marginBottom: 4, fontSize: 12 },
  input: {
    backgroundColor: "#ffffff",
    color: TEXT,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: BORDER,
    marginBottom: 8,
    fontSize: 14,
    fontWeight: "600",
  },

  primaryAction: {
    marginTop: 8,
    backgroundColor: BRAND,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: BRAND,
  },
  primaryActionTxt: { color: "#fff", fontWeight: "900" },

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

  /* sheet */
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
  sheetHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  sheetTitle: { color: TEXT, fontWeight: "900", fontSize: 16 },
});