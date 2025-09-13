// app/(app)/jobs/[id].js
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Platform,
  ActivityIndicator,
  TouchableOpacity,
  TextInput,
  Alert,
  ScrollView,
  DeviceEventEmitter,
} from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useLocalSearchParams, useRouter } from "expo-router";
import { supabase } from "../../../lib/supabase";
import { jobDocsHref, jobExpensesHref, loginHref } from "../../../lib/nav";
import {
  Pencil,
  Save,
  CalendarDays,
  FileText,
  Image as ImageIcon,
  Receipt,
  ChevronRight,
  Trash2,
} from "lucide-react-native";

/* ---- theme ---- */
const BG = "#f5f7fb";
const CARD = "#ffffff";
const TEXT = "#0b1220";
const MUTED = "#6b7280";
const BORDER = "#e6e9ee";
const BRAND = "#2a86ff";
const DANGER = "#e11d48";
const SUCCESS = "#16a34a";
const WARN = "#f59e0b";

/* ---- date helpers ---- */
const pad = (n) => String(n).padStart(2, "0");
const toYMD = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const toLocalMidnight = (d) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};
const isWeekend = (d) => d.getDay() === 0 || d.getDay() === 6;
const addWorkingDays = (start, days, includeWeekends) => {
  const s = toLocalMidnight(start);
  if (days <= 1) return s;
  let r = days - 1;
  const cur = new Date(s);
  while (r > 0) {
    cur.setDate(cur.getDate() + 1);
    if (includeWeekends || !isWeekend(cur)) r--;
  }
  return cur;
};
const money = (v = 0) =>
  "£" +
  Number(v || 0)
    .toFixed(2)
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");

// detect “column does not exist” from Postgres
const isMissingColumn = (err) =>
  err && (err.code === "42703" || /column .* does not exist/i.test(err.message || ""));

/* ---- screen ---- */
export default function JobDetails() {
  const router = useRouter();
  const { id } = useLocalSearchParams();
  const jobId = String(id || "");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [edit, setEdit] = useState(false);

  const [job, setJob] = useState(null);

  // keep a guard so we don't re-enter load()
  const inFlight = useRef(false);

  // editable fields
  const [title, setTitle] = useState("");
  const [client, setClient] = useState("");
  const [start, setStart] = useState(toLocalMidnight(new Date()));
  const [showPicker, setShowPicker] = useState(false);
  const [dur, setDur] = useState(1);
  const [weekends, setWeekends] = useState(false);
  const end = useMemo(
    () => addWorkingDays(start, Math.max(1, Math.floor(dur || 1)), weekends),
    [start, dur, weekends]
  );

  // dashboard summary
  const [docsCount, setDocsCount] = useState(0);
  const [expCount, setExpCount] = useState(0);
  const [expTotal, setExpTotal] = useState(0);

  // ---- expense summary (new + legacy) + sync jobs.cost ----
  const loadExpenseSummary = useCallback(async () => {
    let total = 0;
    let count = 0;

    // Count (fast; head=true)
    const countQ = await supabase
      .from("expenses")
      .select("id", { count: "exact", head: true })
      .eq("job_id", jobId);
    if (countQ.error) throw countQ.error;
    count = countQ.count || 0;

    // First: query NEW schema fields only
    const newQ = await supabase
      .from("expenses")
      .select("id,total,qty,unit_cost")
      .eq("job_id", jobId);
    if (newQ.error) throw newQ.error;

    for (const r of newQ.data || []) {
      const t = Number(r.total);
      if (Number.isFinite(t)) {
        total += t;
      } else {
        const q = Number(r.qty);
        const u = Number(r.unit_cost);
        if (Number.isFinite(q) && Number.isFinite(u)) total += q * u;
      }
    }

    // Best-effort legacy add (ignore errors if column missing)
    try {
      const legQ = await supabase
        .from("expenses")
        .select("id,amount")
        .eq("job_id", jobId);
      if (!legQ.error) {
        for (const r of legQ.data || []) {
          const a = Number(r.amount);
          if (Number.isFinite(a)) total += a;
        }
      }
    } catch {}

    setExpCount(count);
    setExpTotal(total);

    // Keep jobs.cost in sync (do NOT emit here; the expenses screen will)
    try {
      const nowIso = new Date().toISOString();
      const upd = await supabase.from("jobs").update({ cost: total, updated_at: nowIso }).eq("id", jobId);
      if (upd.error && isMissingColumn(upd.error)) {
        // old schema without cost — ignore
      }
    } catch {}
  }, [jobId]);

  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      if (!jobId) return;
      setLoading(true);

      const auth = await supabase.auth.getUser();
      const user = auth?.data?.user;
      if (!user) {
        router.replace(loginHref);
        return;
      }

      // job
      const res = await supabase
        .from("jobs")
        .select(
          "id, user_id, title, client_name, start_date, end_date, duration_days, include_weekends, total, cost, status, notes"
        )
        .eq("id", jobId)
        .eq("user_id", user.id)
        .maybeSingle();
      if (res.error) throw res.error;
      if (!res.data) {
        Alert.alert("Not found", "This job does not exist.");
        router.back();
        return;
      }

      const j = res.data;
      setJob(j);
      setTitle(j.title || "");
      setClient(j.client_name || "");
      const s = j.start_date ? new Date(j.start_date) : new Date();
      setStart(toLocalMidnight(s));
      setDur(Math.max(1, Number(j.duration_days || 1)));
      setWeekends(!!j.include_weekends);

      // summary: docs + expenses
      const docsQ = await supabase
        .from("documents")
        .select("id", { count: "exact", head: true })
        .eq("job_id", jobId);
      if (docsQ.error) throw docsQ.error;
      setDocsCount(docsQ.count || 0);

      await loadExpenseSummary();
    } catch (e) {
      console.error("[job details] load", e);
      Alert.alert("Error", e?.message || "Failed to load job");
    } finally {
      setLoading(false);
      inFlight.current = false;
    }
  }, [jobId, router, loadExpenseSummary]);

  useEffect(() => {
    load();
  }, [load]);

  // Listen for external changes; call ONLY load() to avoid double work
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener("jobs:changed", () => {
      if (!inFlight.current) load();
    });
    return () => sub.remove();
  }, [load]);

  const save = useCallback(async () => {
    try {
      if (!job) return;
      if (!title.trim()) {
        Alert.alert("Missing", "Enter a job title.");
        return;
      }
      if (!client.trim()) {
        Alert.alert("Missing", "Enter the client name.");
        return;
      }
      setSaving(true);
      const payload = {
        title: title.trim(),
        client_name: client.trim(),
        start_date: toYMD(start),
        end_date: toYMD(end),
        duration_days: Math.max(1, Math.floor(Number(dur || 1))),
        include_weekends: !!weekends,
        updated_at: new Date().toISOString(),
      };
      const { error } = await supabase.from("jobs").update(payload).eq("id", job.id);
      if (error) throw error;
      setEdit(false);
      await load();
    } catch (e) {
      console.error("[job details] save", e);
      Alert.alert("Save failed", e?.message || "Could not save changes.");
    } finally {
      setSaving(false);
    }
  }, [job, title, client, start, end, dur, weekends, load]);

  const changeStatus = async (next) => {
    try {
      if (!job) return;
      setSaving(true);
      const { error } = await supabase
        .from("jobs")
        .update({ status: next, updated_at: new Date().toISOString() })
        .eq("id", job.id);
      if (error) throw error;
      await load();
    } catch (e) {
      Alert.alert("Update failed", e?.message || "Could not update status.");
    } finally {
      setSaving(false);
    }
  };

  /** Delete job (with cascading deletes for documents & expenses) */
  const confirmDeleteJob = useCallback(() => {
    if (!job) return;
    Alert.alert(
      "Delete job?",
      "This will permanently delete this job AND all of its documents and expenses.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              setSaving(true);

              // Delete related rows first (manual cascade for safety)
              const [d1, d2] = await Promise.all([
                supabase.from("documents").delete().eq("job_id", job.id),
                supabase.from("expenses").delete().eq("job_id", job.id),
              ]);
              if (d1.error) throw d1.error;
              if (d2.error) throw d2.error;

              // Delete the job
              const { error: delErr } = await supabase.from("jobs").delete().eq("id", job.id);
              if (delErr) throw delErr;

              // notify jobs list to refresh and go back
              DeviceEventEmitter.emit("jobs:changed");
              router.back();
            } catch (e) {
              console.error("[job details] delete", e);
              Alert.alert("Delete failed", e?.message || "Could not delete this job.");
            } finally {
              setSaving(false);
            }
          },
        },
      ]
    );
  }, [job, router]);

  if (loading || !job) {
    return (
      <View style={[styles.screen, styles.center]}>
        <ActivityIndicator color={BRAND} />
      </View>
    );
  }

  const status = String(job.status || "scheduled");
  const statusColor =
    status === "completed" ? SUCCESS : status === "in_progress" ? WARN : BRAND;

  return (
    <View style={styles.screen}>
      {/* Header */}
      <View style={styles.top}>
        <Text style={styles.h1} numberOfLines={1}>
          {job.title || "Job"}
        </Text>
        <TouchableOpacity onPress={edit ? save : () => setEdit(true)} style={styles.iconBtn}>
          {edit ? <Save size={18} color={MUTED} /> : <Pencil size={18} color={MUTED} />}
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        {/* Status chips */}
        <View style={styles.statusRow}>
          {[
            ["scheduled", "Scheduled"],
            ["in_progress", "In progress"],
            ["completed", "Completed"],
          ].map(([key, label]) => {
            const active = status === key;
            return (
              <TouchableOpacity
                key={key}
                onPress={() => changeStatus(key)}
                disabled={saving}
                style={[
                  styles.statusChip,
                  active && { backgroundColor: statusColor + "22", borderColor: statusColor + "66" },
                ]}
              >
                <View
                  style={[
                    styles.dot,
                    { backgroundColor: key === "completed" ? SUCCESS : key === "in_progress" ? WARN : BRAND },
                  ]}
                />
                <Text style={[styles.statusTxt, active && { color: statusColor }]}>{label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Timeline strip */}
        <View style={styles.card}>
          <Text style={styles.section}>Timeline</Text>
          <Timeline start={start} end={end} weekends={weekends} />
        </View>

        {/* Summary */}
        <View style={styles.row2}>
          <SummaryCard
            icon={<FileText size={18} color={BRAND} />}
            title="Documents"
            value={docsCount}
            onPress={() => router.replace(jobDocsHref(jobId))}
          />
          <SummaryCard
            icon={<Receipt size={18} color={WARN} />}
            title="Expenses"
            value={`${expCount} • ${money(expTotal)}`}
            onPress={() => router.replace(jobExpensesHref(jobId))}
          />
        </View>

        {/* Details / edit */}
        <View style={styles.card}>
          <Text style={styles.section}>Details</Text>

          <Text style={styles.label}>Job title</Text>
          <TextInput
            style={styles.input}
            value={title}
            onChangeText={setTitle}
            editable={edit}
            placeholder="e.g. Kitchen install"
          />

          <Text style={styles.label}>Client</Text>
          <TextInput
            style={styles.input}
            value={client}
            onChangeText={setClient}
            editable={edit}
            placeholder="Client name"
          />

          <Text style={styles.label}>Start date</Text>
          <View style={{ position: "relative" }}>
            <TextInput style={styles.input} editable={false} value={start.toLocaleDateString()} />
            <TouchableOpacity
              disabled={!edit}
              onPress={() => setShowPicker(true)}
              style={styles.inputIcon}
            >
              <CalendarDays size={18} color={MUTED} />
            </TouchableOpacity>
          </View>
          {showPicker ? (
            <DateTimePicker
              value={start}
              mode="date"
              display={Platform.OS === "ios" ? "inline" : "default"}
              onChange={(e, d) => {
                if (Platform.OS === "android") setShowPicker(false);
                if (d) {
                  const clean = toLocalMidnight(d);
                  setStart(clean);
                }
              }}
              maximumDate={new Date(2199, 11, 31)}
            />
          ) : null}

          <Text style={styles.label}>Duration (days)</Text>
          <TextInput
            style={styles.input}
            value={String(dur)}
            onChangeText={(t) =>
              setDur(Math.max(1, Math.floor(Number(String(t).replace(/[^0-9]/g, "")) || 1)))
            }
            keyboardType="number-pad"
            editable={edit}
          />

          <TouchableOpacity
            disabled={!edit}
            style={styles.checkRow}
            onPress={() => setWeekends((v) => !v)}
          >
            <View style={[styles.checkboxBox, weekends && styles.checkboxBoxChecked]}>
              {weekends ? <Text style={styles.checkboxTick}>✓</Text> : null}
            </View>
            <Text style={{ color: TEXT, fontWeight: "800" }}>Include weekends</Text>
          </TouchableOpacity>

          <View style={styles.infoBox}>
            <Text style={{ color: TEXT, fontWeight: "800" }}>
              Ends: {end.toLocaleDateString()} ({weekends ? "calendar days" : "working days"})
            </Text>
          </View>

          {/* Quick actions */}
          <View style={{ height: 10 }} />
          <QuickLink
            icon={<FileText size={18} color={BRAND} />}
            label="Open Documents"
            onPress={() => router.replace(jobDocsHref(jobId))}
          />
          <QuickLink
            icon={<ImageIcon size={18} color={"#0891b2"} />}
            label="Add/Review Photos"
            onPress={() => router.replace(jobDocsHref(jobId))}
          />
          <QuickLink
            icon={<Receipt size={18} color={WARN} />}
            label="Track Expenses"
            right={money(expTotal)}
            onPress={() => router.replace(jobExpensesHref(jobId))}
          />
        </View>

        {/* Danger zone */}
        <View style={[styles.card, { borderColor: "#fecaca" }]}>
          <Text style={[styles.section, { color: DANGER }]}>Danger zone</Text>
          <TouchableOpacity
            disabled={saving}
            onPress={confirmDeleteJob}
            style={styles.deleteBtn}
            activeOpacity={0.85}
          >
            <Trash2 size={18} color="#fff" />
            <Text style={styles.deleteTxt}>{saving ? "Deleting…" : "Delete job"}</Text>
          </TouchableOpacity>
          <Text style={styles.deleteHelp}>
            This will delete the job and all of its documents and expenses. This action cannot be undone.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

/* ---- small bits ---- */
const Timeline = ({ start, end, weekends }) => {
  const today = toLocalMidnight(new Date());
  const totalMs = end.getTime() - start.getTime();
  const doneMs = Math.max(0, Math.min(totalMs, today.getTime() - start.getTime()));
  const pct = totalMs > 0 ? doneMs / totalMs : 0;

  return (
    <View>
      <View style={styles.timelineHeader}>
        <Text style={styles.metaTxt}>{start.toLocaleDateString()}</Text>
        <Text style={[styles.metaTxt, { fontWeight: "900" }]}>{weekends ? "Calendar days" : "Working days"}</Text>
        <Text style={styles.metaTxt}>{end.toLocaleDateString()}</Text>
      </View>
      <View style={styles.timelineBar}>
        <View style={[styles.timelineFill, { flex: Math.max(0.03, pct) }]} />
        <View style={{ flex: Math.max(0, 1 - pct) }} />
      </View>
    </View>
  );
};

const SummaryCard = ({ icon, title, value, onPress }) => (
  <TouchableOpacity style={styles.summary} onPress={onPress} activeOpacity={0.85}>
    <View style={styles.summaryIcon}>{icon}</View>
    <Text style={styles.summaryTitle}>{title}</Text>
    <Text style={styles.summaryValue} numberOfLines={1}>
      {value}
    </Text>
  </TouchableOpacity>
);

const QuickLink = ({ icon, label, right, onPress }) => (
  <TouchableOpacity style={styles.quick} onPress={onPress} activeOpacity={0.9}>
    <View style={styles.quickIcon}>{icon}</View>
    <Text style={styles.quickLabel}>{label}</Text>
    <View style={{ flex: 1 }} />
    {right ? <Text style={[styles.metaTxt, { marginRight: 8 }]}>{right}</Text> : null}
    <ChevronRight size={18} color={MUTED} />
  </TouchableOpacity>
);

/* ---- styles ---- */
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG, paddingTop: Platform.OS === "android" ? 8 : 0 },
  center: { alignItems: "center", justifyContent: "center" },

  top: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  h1: { color: TEXT, fontWeight: "900", fontSize: 22 },
  iconBtn: {
    height: 34,
    width: 34,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: CARD,
  },

  /* status */
  statusRow: { flexDirection: "row", gap: 8, paddingHorizontal: 14, marginBottom: 8 },
  statusChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: "#f7f8fb",
  },
  statusTxt: { color: MUTED, fontWeight: "900" },
  dot: { width: 8, height: 8, borderRadius: 999 },

  /* shared sections */
  section: { color: TEXT, fontWeight: "900", fontSize: 16, marginBottom: 8 },

  card: {
    backgroundColor: CARD,
    marginHorizontal: 14,
    marginTop: 10,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BORDER,
    shadowColor: "#0b1220",
    shadowOpacity: 0.03,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 1,
  },

  /* timeline */
  timelineHeader: { flexDirection: "row", justifyContent: "space-between", marginBottom: 6 },
  metaTxt: { color: MUTED, fontWeight: "800" },
  timelineBar: {
    height: 10,
    borderRadius: 999,
    overflow: "hidden",
    backgroundColor: "#eef2f7",
    borderWidth: 1,
    borderColor: BORDER,
    flexDirection: "row",
  },
  timelineFill: { backgroundColor: BRAND, borderRightWidth: 0 },

  /* summary row */
  row2: { flexDirection: "row", gap: 8, marginTop: 10, paddingHorizontal: 14 },
  summary: {
    flex: 1,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 14,
    padding: 12,
    shadowColor: "#0b1220",
    shadowOpacity: 0.03,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 1,
  },
  summaryIcon: {
    height: 34,
    width: 34,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f3f4f6",
    borderWidth: 1,
    borderColor: BORDER,
    marginBottom: 8,
  },
  summaryTitle: { color: MUTED, fontWeight: "800" },
  summaryValue: { color: TEXT, fontWeight: "900", marginTop: 2 },

  /* details */
  label: { color: MUTED, fontWeight: "800", marginTop: 8, marginBottom: 6 },
  input: {
    backgroundColor: "#fff",
    color: TEXT,
    borderRadius: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: BORDER,
  },
  inputIcon: {
    position: "absolute",
    right: 6,
    top: 6,
    height: 30,
    width: 30,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f3f4f6",
    borderWidth: 1,
    borderColor: BORDER,
  },
  checkRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 2, marginBottom: 6 },
  checkboxBox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: "#cbd5e1",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#ffffff",
  },
  checkboxBoxChecked: { backgroundColor: BRAND, borderColor: BRAND },
  checkboxTick: { color: "#ffffff", fontWeight: "800" },
  infoBox: {
    marginTop: 8,
    padding: 10,
    borderRadius: 10,
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: BORDER,
  },

  /* quick links */
  quick: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: "#fff",
    paddingVertical: 10,
    paddingHorizontal: 10,
    marginTop: 8,
  },
  quickIcon: {
    height: 30,
    width: 30,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f3f4f6",
    borderWidth: 1,
    borderColor: BORDER,
  },
  quickLabel: { color: TEXT, fontWeight: "900" },

  /* danger zone */
  deleteBtn: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: DANGER,
    borderWidth: 1,
    borderColor: "#fecaca",
    marginTop: 4,
  },
  deleteTxt: { color: "#fff", fontWeight: "900" },
  deleteHelp: { color: MUTED, fontWeight: "800", marginTop: 8 },
});