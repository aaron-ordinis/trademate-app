// app/(app)/jobs/index.js
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  ScrollView,
  RefreshControl,
  AppState,
  DeviceEventEmitter,
  Alert,
  TextInput,
} from "react-native";
import { useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { supabase } from "../../../../lib/supabase";
import TopBar, { IconBtn } from "../../../../components/TopBar";
import {
  Plus,
  List as ListIcon,
  Calendar as CalendarIcon,
  Settings,
  ChevronLeft,
  ChevronRight,
  MapPin,
  RefreshCcw,
  Trash2,
  CalendarDays,
  Search,
} from "lucide-react-native";
import { jobHref, jobCreateHref } from "../../../../lib/nav";
import SharedCalendar from "../../../../components/SharedCalendar.js";

/* Theme */
const BG = "#f5f7fb";
const CARD = "#ffffff";
const TEXT = "#0b1220";
const MUTED = "#6b7280";
const BORDER = "#e6e9ee";
const BRAND = "#2a86ff";
const ORANGE = "#f59e0b";
const SUCCESS = "#16a34a";

/* Status helpers */
const normalizeStatus = (s) =>
  String(s || "").trim().toLowerCase().replace(/[\s-]+/g, "_").replace(/^open$/, "scheduled");
const STATUS_COLOR = { scheduled: BRAND, in_progress: ORANGE, complete: SUCCESS };

/* Helpers */
const money = (v = 0) => "£" + Number(v || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const sameDay = (a, b) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const toDate = (v) => { if (!v) return null; const d = new Date(v); return isNaN(+d) ? null : d; };
const atMidnight = (d) => { const x = new Date(d); x.setHours(0,0,0,0); return x; };
const isWeekend = (d) => d.getDay() === 0 || d.getDay() === 6;

/** weekday-aware day map (respects job.include_weekends) */
const buildJobsByDayKey = (jobs = []) => {
  const m = new Map();
  for (const j of jobs) {
    const s0 = toDate(j.start_date);
    const e0 = toDate(j.end_date) || s0;
    if (!s0) continue;
    const inc = !!j.include_weekends;
    const start = atMidnight(s0);
    const end = atMidnight(e0);
    const cur = new Date(start);
    while (cur <= end) {
      if (inc || !isWeekend(cur)) {
        const k = `${cur.getFullYear()}-${cur.getMonth()}-${cur.getDate()}`;
        const arr = m.get(k) || [];
        arr.push(j);
        m.set(k, arr);
      }
      cur.setDate(cur.getDate() + 1);
    }
  }
  return m;
};

const buildYears = (centerYear) => { const arr=[]; for (let y=centerYear-5;y<=centerYear+5;y++) arr.push(y); return arr; };

export default function JobsIndex() {
  const router = useRouter();

  const [mode, setMode] = useState("list"); // "list" | "calendar"
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [jobs, setJobs] = useState([]);
  const [month, setMonth] = useState(() => { const d = new Date(); d.setDate(1); return d; });
  const [activeDate, setActiveDate] = useState(new Date()); // Add this missing state
  const [userId, setUserId] = useState(null);

  // list search
  const [query, setQuery] = useState("");

  // month picker
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerYear, setPickerYear] = useState(new Date().getFullYear());

  // haptics
  const haptic = useRef(null);
  useEffect(() => { (async () => { try { const m = await import("expo-haptics"); haptic.current = m; } catch {} })(); }, []);
  const buzz = (t = "selection") => { const H = haptic.current; if (!H) return; t==="selection"?H.selectionAsync?.():H.impactAsync?.(H.ImpactFeedbackStyle.Light); };

  const sortByStart = (arr) => [...arr].sort((a,b)=> new Date(a.start_date||0)-new Date(b.start_date||0));
  const setJobsIfChanged = (next) => setJobs(sortByStart(next));

  /** Load jobs + expenses (includes include_weekends) */
  const load = useCallback(async () => {
    try {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setUserId(null); setJobs([]); return; }
      if (user.id !== userId) setUserId(user.id);

      const { data: jobsRaw, error: jErr } = await supabase
        .from("jobs")
        .select(`
          id, title, client_name, client_email, client_phone, client_address, site_address,
          start_date, end_date, total, cost, status, include_weekends, created_at, updated_at, user_id
        `)
        .eq("user_id", user.id)
        .order("start_date", { ascending: true });
      if (jErr) throw jErr;

      const list = jobsRaw || [];
      if (list.length === 0) { setJobsIfChanged([]); return; }

      const ids = list.map((j) => j.id);
      const { data: expData, error: expErr } = await supabase
        .from("expenses")
        .select("job_id, amount")
        .in("job_id", ids);
      if (expErr) throw expErr;

      const sumByJob = {};
      for (const r of expData || []) {
        const k = r.job_id; if (!k) continue;
        const n = Number(r.amount) || 0;
        sumByJob[k] = (sumByJob[k] || 0) + n;
      }

      const merged = list.map((j) => {
        const expenses_total = +Number(sumByJob[j.id] || 0).toFixed(2);
        const revenue = Number(j.total || 0);
        const jobCost = Number(j.cost || 0);
        const profit = +(revenue - (jobCost + expenses_total)).toFixed(2);
        return { ...j, expenses_total, profit };
      });

      setJobsIfChanged(merged);
    } catch (e) {
      console.error("[jobs] load", e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [userId]);

  useEffect(() => { load(); }, [load]);
  useFocusEffect(useCallback(() => { setMode("list"); load(); return () => {}; }, [load]));

  const onRefresh = useCallback(() => { setRefreshing(true); load(); }, [load]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => { if (s === "active") load(); });
    return () => sub.remove();
  }, [load]);

  useEffect(() => {
    const { data: authSub } = supabase.auth.onAuthStateChange((_event, session) => {
      const uid = session?.user?.id || null;
      setUserId(uid);
      load();
    });
    return () => authSub.subscription.unsubscribe();
  }, [load]);

  // realtime
  const jobsChRef = useRef(null);
  const expChRef = useRef(null);
  const reconcileTimer = useRef(null);
  useEffect(() => {
    if (!userId) return;
    if (jobsChRef.current) supabase.removeChannel(jobsChRef.current);
    if (expChRef.current) supabase.removeChannel(expChRef.current);

    const tick = () => {
      if (reconcileTimer.current) clearTimeout(reconcileTimer.current);
      reconcileTimer.current = setTimeout(load, 250);
    };

    jobsChRef.current = supabase
      .channel(`jobs-live-${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "jobs" }, (p) => {
        const n = p.new || {}, o = p.old || {};
        if (n.user_id === userId || o.user_id === userId) tick();
      })
      .subscribe();

    expChRef.current = supabase
      .channel(`expenses-live-${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "expenses" }, () => tick())
      .subscribe();

    return () => {
      if (jobsChRef.current) supabase.removeChannel(jobsChRef.current);
      if (expChRef.current) supabase.removeChannel(expChRef.current);
      if (reconcileTimer.current) clearTimeout(reconcileTimer.current);
    };
  }, [userId, load]);

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener("jobs:changed", () => load());
    return () => sub.remove();
  }, [load]);

  /** Topbar actions */
  const right = (
    <View style={{ flexDirection: "row", gap: 8 }}>
      <IconBtn onPress={onRefresh}><RefreshCcw size={18} color={MUTED} /></IconBtn>
      <IconBtn onPress={() => { setMode((m) => (m === "list" ? "calendar" : "list")); buzz(); }}>
        {mode === "list" ? <CalendarIcon size={18} color={MUTED} /> : <ListIcon size={18} color={MUTED} />}
      </IconBtn>
      <IconBtn onPress={() => router.push("/(app)/settings")}><Settings size={18} color={MUTED} /></IconBtn>
    </View>
  );

  /** Delete */
  const requestDeleteJob = (job) => {
    Alert.alert("Delete job?", "This will delete this job and all of its documents and expenses.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            const [d1, d2] = await Promise.all([
              supabase.from("documents").delete().eq("job_id", job.id),
              supabase.from("expenses").delete().eq("job_id", job.id),
            ]);
            if (d1.error) throw d1.error;
            if (d2.error) throw d2.error;
            const del = await supabase.from("jobs").delete().eq("id", job.id);
            if (del.error) throw del.error;
            DeviceEventEmitter.emit("jobs:changed");
          } catch (e) {
            console.error("[jobs] delete", e);
            Alert.alert("Delete failed", e?.message || "Could not delete this job.");
          }
        },
      },
    ]);
  };

  /* ---------- List card ---------- */
  const renderCard = ({ item }) => {
    const cardStartDate = toDate(item.start_date);
    const cardEndDate = toDate(item.end_date) || cardStartDate;
    const address = item.site_address || item.client_address || "";

    const dateLabel = cardStartDate
      ? cardEndDate && !sameDay(cardStartDate, cardEndDate)
        ? `${cardStartDate.toLocaleDateString()} – ${cardEndDate.toLocaleDateString()}`
        : cardStartDate.toLocaleDateString()
      : "No date";

    return (
      <TouchableOpacity style={st.card} activeOpacity={0.9} onPress={() => router.push(jobHref(item.id))}>
        <TouchableOpacity style={st.binBtn} onPress={() => requestDeleteJob(item)} activeOpacity={0.85}>
          <Trash2 size={18} color="#b91c1c" />
        </TouchableOpacity>

        <View style={{ flexShrink: 1, paddingRight: 110 }}>
          <Text style={st.clientTitle} numberOfLines={1}>{item.client_name || "Client"}</Text>
          <View style={st.rowMini}>
            <CalendarDays size={16} color={MUTED} />
            <Text style={st.rowMiniText} numberOfLines={1}>{"  "}{dateLabel}</Text>
          </View>
          {!!address && (
            <View style={st.rowMini}>
              <MapPin size={16} color={MUTED} />
              <Text style={[st.rowMiniText, { flexShrink: 1 }]} numberOfLines={1}>{"  "}{address}</Text>
            </View>
          )}
        </View>

        <Text style={st.totalBottom}>{money(item.total || 0)}</Text>
      </TouchableOpacity>
    );
  };

  /* ---------- Search (list only) ---------- */
  const filteredJobs = useMemo(() => {
    const t = query.trim().toLowerCase();
    if (!t) return jobs;
    return jobs.filter((j) => {
      const hay = (j.title || "") + " " + (j.client_name || "") + " " + (j.client_address || "") + " " + (j.site_address || "");
      return hay.toLowerCase().includes(t);
    });
  }, [jobs, query]);

  /* ---------- Day list & month summary (using weekday-aware map) ---------- */
  const jobsByDayKey = useMemo(() => buildJobsByDayKey(jobs), [jobs]);
  const selectedKey = `${activeDate.getFullYear()}-${activeDate.getMonth()}-${activeDate.getDate()}`;
  const selectedDayJobs = useMemo(() => jobsByDayKey.get(selectedKey) || [], [jobsByDayKey, selectedKey]);

  const monthSummary = useMemo(() => {
    const count = jobs.filter((j) => {
      const s = toDate(j.start_date);
      return s && s.getMonth() === month.getMonth() && s.getFullYear() === month.getFullYear();
    }).length;
    const profit = jobs.reduce((sum, j) => {
      const s = toDate(j.start_date);
      const inMonth = s && s.getMonth() === month.getMonth() && s.getFullYear() === month.getFullYear();
      const p = Number(j.total || 0) - (Number(j.cost || 0) + Number(j.expenses_total || 0));
      return inMonth ? sum + p : sum;
    }, 0);
    return { count, profit };
  }, [jobs, month]);

  const openPicker = () => { setPickerYear(month.getFullYear()); setPickerOpen(true); buzz(); };
  const jumpTo = (y, m) => { const d = new Date(y, m, 1); setMonth(d); setPickerOpen(false); buzz(); };
  const onCreateForDate = (day) => {
    const iso = new Date(day.getFullYear(), day.getMonth(), day.getDate()).toISOString().split("T")[0];
    router.push({ pathname: jobCreateHref, params: { start: iso } });
  };

  return (
    <View style={st.screen}>
      <TopBar title="Jobs" right={right} />

      {loading ? (
        <View style={{ paddingTop: 20 }}><ActivityIndicator color={BRAND} /></View>
      ) : mode === "list" ? (
        <>
          {/* Search */}
          <View style={st.searchRow}>
            <Search size={18} color={MUTED} style={{ marginRight: 8 }} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search job, client or address"
              placeholderTextColor={MUTED}
              style={st.searchInput}
              returnKeyType="search"
            />
          </View>

          <FlatList
            data={filteredJobs}
            keyExtractor={(it) => String(it.id)}
            contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 120 }}
            renderItem={renderCard}
            ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
            ListEmptyComponent={<Text style={{ color: MUTED, textAlign: "center", marginTop: 28, fontWeight: "800" }}>No jobs match your search.</Text>}
          />
        </>
      ) : (
        <ScrollView
          style={{ paddingHorizontal: 12 }}
          contentContainerStyle={{ paddingBottom: 12 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
          <View>
            {/* Month summary */}
            <View style={st.monthSummaryCard}>
              <Text style={st.monthSummaryText}>
                Jobs: {monthSummary.count} · Est. profit: {money(monthSummary.profit)}
              </Text>
            </View>

            {/* Calendar in its own card */}
            <View style={st.calCard}>
              <SharedCalendar
                month={month}
                onChangeMonth={setMonth}
                selectedDate={activeDate}
                onSelectDate={(d) => { setActiveDate(d); buzz(); }}
                jobs={jobs}
                onDayLongPress={(day) => onCreateForDate(day)}
              />
            </View>

            {/* Day summary in separate card below */}
            <View style={st.summaryCard}>
              <View style={st.summaryHeader}>
                <Text style={st.summaryTitle}>
                  {activeDate.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}
                </Text>
              </View>

              {selectedDayJobs.length === 0 ? (
                <View style={st.summaryEmptyCard}>
                  <Text style={st.summaryEmpty}>No jobs on this day.</Text>
                </View>
              ) : (
                selectedDayJobs.map((j) => {
                  const cardStartDate = toDate(j.start_date);
                  const cardEndDate = toDate(j.end_date) || cardStartDate;
                  const address = j.site_address || j.client_address || "";

                  const dateLabel = cardStartDate
                    ? cardEndDate && !sameDay(cardStartDate, cardEndDate)
                      ? `${cardStartDate.toLocaleDateString()} – ${cardEndDate.toLocaleDateString()}`
                      : cardStartDate.toLocaleDateString()
                    : "No date";

                  return (
                    <TouchableOpacity
                      key={j.id}
                      style={[st.card, { marginBottom: 10, marginHorizontal: 0 }]}
                      activeOpacity={0.9}
                      onPress={() => router.push(jobHref(j.id))}
                    >
                      <TouchableOpacity style={st.binBtn} onPress={() => requestDeleteJob(j)} activeOpacity={0.85}>
                        <Trash2 size={18} color="#b91c1c" />
                      </TouchableOpacity>

                      <View style={{ flexShrink: 1, paddingRight: 110 }}>
                        <Text style={st.clientTitle} numberOfLines={1}>{j.client_name || "Client"}</Text>
                        <View style={st.rowMini}>
                          <CalendarDays size={16} color={MUTED} />
                          <Text style={st.rowMiniText} numberOfLines={1}>{"  "}{dateLabel}</Text>
                        </View>
                        {!!address && (
                          <View style={st.rowMini}>
                            <MapPin size={16} color={MUTED} />
                            <Text style={[st.rowMiniText, { flexShrink: 1 }]} numberOfLines={1}>{"  "}{address}</Text>
                          </View>
                        )}
                      </View>

                      <Text style={st.totalBottom}>{money(j.total || 0)}</Text>
                    </TouchableOpacity>
                  );
                })
              )}
            </View>

            <View style={{ height: 96 }} />
          </View>
        </ScrollView>
      )}

      {/* Month/Year picker */}
      <Modal visible={pickerOpen} animationType="fade" transparent>
        <Pressable style={st.backdrop} onPress={() => setPickerOpen(false)} />
        <View style={st.pickerSheet}>
          <Text style={st.pickerTitle}>Jump to</Text>

          <View style={st.pickerRow}>
            <TouchableOpacity style={st.yearBtn} onPress={() => setPickerYear((y) => y - 1)}>
              <ChevronLeft size={18} color={TEXT} />
            </TouchableOpacity>
            <Text style={st.yearLabel}>{pickerYear}</Text>
            <TouchableOpacity style={st.yearBtn} onPress={() => setPickerYear((y) => y + 1)}>
              <ChevronRight size={18} color={TEXT} />
            </TouchableOpacity>
          </View>

          <View style={st.monthGrid}>
            {["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"].map((mLabel, i) => (
              <TouchableOpacity key={mLabel} style={st.monthBtn} onPress={() => jumpTo(pickerYear, i)} activeOpacity={0.8}>
                <Text style={st.monthTxt}>{mLabel}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingTop: 6 }}>
            {buildYears(new Date().getFullYear()).map((y) => (
              <TouchableOpacity
                key={y}
                style={[st.yearChip, y === pickerYear && { backgroundColor: BRAND + "15", borderColor: BRAND + "55" }]}
                onPress={() => setPickerYear(y)}
              >
                <Text style={[st.yearChipTxt, y === pickerYear && { color: BRAND }]}>{y}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const st = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG, paddingTop: Platform.OS === "android" ? 8 : 0 },

  /* Search */
  searchRow: {
    marginTop: 12, marginHorizontal: 16, backgroundColor: CARD, borderRadius: 12,
    borderWidth: 1, borderColor: BORDER, paddingHorizontal: 12, paddingVertical: 10,
    flexDirection: "row", alignItems: "center",
  },
  searchInput: { flex: 1, color: TEXT },

  /* List card */
  card: {
    backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, borderRadius: 16, padding: 14,
    shadowColor: "#0b1220", shadowOpacity: 0.04, shadowRadius: 12, shadowOffset: { width: 0, height: 6 },
    elevation: 2, marginHorizontal: 0,
  },
  binBtn: {
    position: "absolute", right: 12, top: 12, height: 36, width: 36, borderRadius: 12,
    alignItems: "center", justifyContent: "center", backgroundColor: "#fee2e2",
    borderWidth: 1, borderColor: "#fecaca", zIndex: 5,
  },
  clientTitle: { color: TEXT, fontWeight: "900", fontSize: 16 },
  rowMini: { flexDirection: "row", alignItems: "center", marginTop: 6 },
  rowMiniText: { color: MUTED },
  totalBottom: { position: "absolute", right: 16, bottom: 12, fontSize: 16, fontWeight: "900", color: TEXT },

  /* Calendar container - now separate */
  calCard: {
    backgroundColor: CARD, 
    borderRadius: 18, 
    padding: 12, 
    borderWidth: 1, 
    borderColor: BORDER,
    shadowColor: "#0b1220", 
    shadowOpacity: 0.04, 
    shadowRadius: 12, 
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
    marginTop: 12,
  },

  /* Summary container - separate card */
  summaryCard: {
    backgroundColor: CARD, 
    borderRadius: 18, 
    padding: 12, 
    borderWidth: 1, 
    borderColor: BORDER,
    shadowColor: "#0b1220", 
    shadowOpacity: 0.04, 
    shadowRadius: 12, 
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
    marginTop: 12,
  },

  summaryHeader: {
    paddingBottom: 8
  },
  summaryTitle: { 
    color: TEXT, 
    fontWeight: "900", 
    fontSize: 16 
  },
  summaryEmptyCard: {
    backgroundColor: "#f8fafc", 
    borderRadius: 12,
    padding: 12, 
    borderWidth: 1, 
    borderColor: BORDER,
    marginTop: 8
  },

  monthSummaryCard: {
    backgroundColor: CARD, borderRadius: 14, borderWidth: 1, borderColor: BORDER,
    paddingVertical: 10, paddingHorizontal: 12, marginTop: 12,
  },
  monthSummaryText: { color: TEXT, fontWeight: "900" },

  backdrop: { flex: 1, backgroundColor: "#0007" },
  pickerSheet: {
    position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: CARD,
    borderTopLeftRadius: 18, borderTopRightRadius: 18, borderTopWidth: 1, borderColor: BORDER, padding: 14,
  },
  pickerTitle: { color: TEXT, fontWeight: "900", fontSize: 16, marginBottom: 10 },
  pickerRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 14, marginBottom: 8 },
  yearBtn: { height: 34, width: 34, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: "#f2f4fa" },
  yearLabel: { color: TEXT, fontWeight: "900", fontSize: 18 },
  monthGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  monthBtn: { width: "22.5%", paddingVertical: 10, alignItems: "center", borderRadius: 12, borderWidth: 1, borderColor: BORDER, backgroundColor: "#f8fafc" },
  monthTxt: { color: TEXT, fontWeight: "800" },
  yearChip: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999, borderWidth: 1, borderColor: BORDER, backgroundColor: "#fff" },
  yearChipTxt: { color: MUTED, fontWeight: "900" },
});