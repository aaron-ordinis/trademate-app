// app/(app)/jobs/index.js
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View, Text, StyleSheet, Platform, TouchableOpacity, FlatList, ActivityIndicator,
  Linking, PanResponder, Modal, Pressable, ScrollView, RefreshControl, AppState,
  DeviceEventEmitter,
} from "react-native";
import { useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { supabase } from "../../../../lib/supabase";
import TopBar, { IconBtn } from "../../../../components/TopBar";
import {
  Plus, List as ListIcon, Calendar as CalendarIcon, Settings, ChevronLeft, ChevronRight,
  MapPin, Mail, Phone, RefreshCcw,
} from "lucide-react-native";
import { jobHref, jobCreateHref } from "../../../../lib/nav";

/* Theme */
const BG = "#f5f7fb";
const CARD = "#ffffff";
const TEXT = "#0b1220";
const MUTED = "#6b7280";
const BORDER = "#e6e9ee";
const BRAND = "#2a86ff";
const SUCCESS = "#16a34a";
const DANGER = "#dc2626";

const STATUS_COLORS = { scheduled: "#2a86ff", in_progress: "#f59e0b", completed: "#059669" };

/* Helpers */
const money = (v = 0) =>
  "£" + Number(v || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

const sameDay = (a, b) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

const toDate = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(+d) ? null : d;
};

/* Month grid */
const monthMatrix = (anyDate) => {
  const first = new Date(anyDate.getFullYear(), anyDate.getMonth(), 1);
  const firstWeekday = (first.getDay() + 6) % 7; // Mon=0
  const start = new Date(first);
  start.setDate(first.getDate() - firstWeekday);
  const weeks = [];
  for (let w = 0; w < 6; w++) {
    const row = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + w * 7 + i);
      row.push(d);
    }
    weeks.push(row);
  }
  return weeks;
};

function buildWeekRanges(weekDays, jobs) {
  const weekStart = new Date(weekDays[0]); weekStart.setHours(0,0,0,0);
  const weekEnd   = new Date(weekDays[6]); weekEnd.setHours(0,0,0,0);
  const ranges = [], lanes = [];
  const _sameDay = (a,b)=>a.getFullYear()===b.getFullYear()&&a.getMonth()===b.getMonth()&&a.getDate()===b.getDate();
  const colOf = (d) => { const base=new Date(weekStart); for (let c=0;c<7;c++){ if (_sameDay(base,d)) return c; base.setDate(base.getDate()+1);} return 0; };

  for (const j of jobs) {
    const s0 = toDate(j.start_date), e0 = toDate(j.end_date) || s0;
    if (!s0) continue;
    const s = new Date(s0); s.setHours(0,0,0,0);
    const e = new Date(e0); e.setHours(0,0,0,0);

    const start = new Date(Math.max(weekStart, s));
    const end   = new Date(Math.min(weekEnd,   e));
    if (end < start) continue;

    let lane = 0;
    for (; lane < lanes.length; lane++) if (lanes[lane] < start.getTime()) break;
    lanes[lane] = end.getTime();

    ranges.push({
      startCol: colOf(start),
      endCol: colOf(end),
      isStart: _sameDay(start, s),
      isEnd: _sameDay(end, e),
      lane,
      color: STATUS_COLORS[j.status || "scheduled"] || BRAND,
    });
  }
  const laneCount = Math.min(3, Math.max(1, lanes.length));
  return { ranges, laneCount };
}

const buildYears = (centerYear) => {
  const arr = [];
  for (let y = centerYear - 5; y <= centerYear + 5; y++) arr.push(y);
  return arr;
};

export default function JobsIndex() {
  const router = useRouter();

  // ✅ Always default to LIST
  const [mode, setMode] = useState("list"); // "list" | "calendar"
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [jobs, setJobs] = useState([]);
  const [month, setMonth] = useState(() => { const d = new Date(); d.setDate(1); return d; });
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [activeStatuses, setActiveStatuses] = useState(["scheduled","in_progress","completed"]);
  const [userId, setUserId] = useState(null);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerYear, setPickerYear] = useState(new Date().getFullYear());

  // haptics
  const haptic = useRef(null);
  useEffect(() => { (async () => { try { const m = await import("expo-haptics"); haptic.current = m; } catch {} })(); }, []);
  const buzz = (t = "selection") => { const H = haptic.current; if (!H) return; t === "selection" ? H.selectionAsync?.() : H.impactAsync?.(H.ImpactFeedbackStyle.Light); };

  const sortByStart = (arr) => [...arr].sort((a,b) => new Date(a.start_date||0) - new Date(b.start_date||0));
  const setJobsIfChanged = (next) => { setJobs(sortByStart(next)); };

  /** Loader: jobs + expenses, compute profit */
  const load = useCallback(async () => {
    try {
      setLoading(true);

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setUserId(null); setJobs([]); return; }
      if (user.id !== userId) setUserId(user.id);

      // Jobs
      const { data: jobsRaw, error: jErr } = await supabase
        .from("jobs")
        .select(`
          id, title, client_name, client_email, client_phone, client_address, site_address,
          start_date, end_date, total, cost, status, created_at, updated_at, user_id
        `)
        .eq("user_id", user.id)
        .order("start_date", { ascending: true });
      if (jErr) throw jErr;

      const list = jobsRaw || [];
      if (list.length === 0) { setJobsIfChanged([]); return; }

      // Expenses: only select columns that actually exist
      const ids = list.map(j => j.id);
      const { data: expData, error: expErr } = await supabase
        .from("expenses")
        .select("job_id, amount")
        .in("job_id", ids);
      if (expErr) throw expErr;

      // Sum amounts per job
      const sumByJob = {};
      for (const r of (expData || [])) {
        const k = r.job_id;
        if (!k) continue;
        const n = Number(r.amount) || 0;
        sumByJob[k] = (sumByJob[k] || 0) + n;
      }

      const merged = list.map(j => {
        const expenses_total = +(Number(sumByJob[j.id] || 0).toFixed(2));
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

  // Initial load
  useEffect(() => { load(); }, [load]);

  // 🔁 Always reset to LIST on focus + hard reload
  useFocusEffect(
    useCallback(() => {
      setMode("list");
      load();
      return () => {};
    }, [load])
  );

  // Pull to refresh
  const onRefresh = useCallback(() => { setRefreshing(true); load(); }, [load]);

  // Foreground refresh
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => { if (s === "active") load(); });
    return () => sub.remove();
  }, [load]);

  // Auth changes
  useEffect(() => {
    const { data: authSub } = supabase.auth.onAuthStateChange((_event, session) => {
      const uid = session?.user?.id || null; setUserId(uid); load();
    });
    return () => authSub.subscription.unsubscribe();
  }, [load]);

  // Realtime: jobs + expenses tables
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

  // ✅ Option B fallback: listen for manual app events
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

  /** -------- Compact, labeled card -------- */
  const renderCard = ({ item }) => {
    const sDate = toDate(item.start_date);
    const eDate = toDate(item.end_date) || sDate;
    const location = item.site_address || item.client_address || "";
    const profit = Number.isFinite(item.profit)
      ? item.profit
      : Number(item.total || 0) - (Number(item.cost || 0) + Number(item.expenses_total || 0));

    return (
      <TouchableOpacity style={st.card} activeOpacity={0.9} onPress={() => router.push(jobHref(item.id))}>
        {/* Header */}
        <View style={st.cardHead}>
          <View style={{ flex: 1, paddingRight: 8 }}>
            <Text style={st.title} numberOfLines={1}>{item.title || "Job"}</Text>
            <Text style={st.subtle}>
              {sDate ? sDate.toLocaleDateString() : "No date"}
              {eDate && !sameDay(sDate || new Date(), eDate) ? ` → ${eDate.toLocaleDateString()}` : ""}
            </Text>
          </View>
          <StatusChip status={item.status} />
        </View>

        {/* Labeled rows */}
        <View style={st.rows}>
          {!!item.client_name && (
            <View style={st.row}>
              <View style={st.rowL}><Text style={st.rowLabel}>Client</Text></View>
              <Text style={st.rowValue} numberOfLines={1}>{item.client_name}</Text>
            </View>
          )}

          {!!item.client_phone && (
            <TouchableOpacity
              style={st.row}
              activeOpacity={0.8}
              onPress={() => Linking.openURL(`tel:${item.client_phone}`)}
            >
              <View style={st.rowL}>
                <Phone size={14} color={MUTED} />
                <Text style={st.rowLabel}>Phone</Text>
              </View>
              <Text style={[st.rowValue, st.link]} numberOfLines={1}>{item.client_phone}</Text>
            </TouchableOpacity>
          )}

          {!!item.client_email && (
            <TouchableOpacity
              style={st.row}
              activeOpacity={0.8}
              onPress={() => Linking.openURL(`mailto:${item.client_email}`)}
            >
              <View style={st.rowL}>
                <Mail size={14} color={MUTED} />
                <Text style={st.rowLabel}>Email</Text>
              </View>
              <Text style={[st.rowValue, st.link]} numberOfLines={1}>{item.client_email}</Text>
            </TouchableOpacity>
          )}

          {!!location && (
            <TouchableOpacity
              style={st.row}
              activeOpacity={0.8}
              onPress={() =>
                Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location)}`)
              }
            >
              <View style={st.rowL}>
                <MapPin size={14} color={MUTED} />
                <Text style={st.rowLabel}>Address</Text>
              </View>
              <Text style={[st.rowValue, st.link]} numberOfLines={2}>{location}</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Money bar */}
        <View style={st.moneyBar}>
          <Text style={[st.money, { color: TEXT }]}>Total: {money(item.total || 0)}</Text>
          <Text style={[st.money, { color: profit >= 0 ? SUCCESS : DANGER }]}>Est. profit: {money(profit)}</Text>
        </View>
      </TouchableOpacity>
    );
  };

  /** Calendar helpers */
  const grid = useMemo(() => monthMatrix(month), [month]);
  const nextMonth = () => { const d = new Date(month); d.setMonth(d.getMonth() + 1); setMonth(d); buzz("impact"); };
  const prevMonth = () => { const d = new Date(month); d.setMonth(d.getMonth() - 1); setMonth(d); buzz("impact"); };
  const goToday = () => { const d = new Date(); d.setDate(1); setMonth(d); setSelectedDate(new Date()); buzz(); };

  // Debounce swipes to avoid double month jumps
  const panLock = useRef(false);
  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 24 && Math.abs(g.dy) < 18,
      onPanResponderRelease: (_, g) => {
        if (panLock.current) return;
        panLock.current = true;
        if (g.dx < -40) nextMonth();
        else if (g.dx > 40) prevMonth();
        setTimeout(() => { panLock.current = false; }, 250);
      },
    })
  ).current;

  const toggleStatus = (k) => {
    setActiveStatuses((cur) => {
      const on = cur.includes(k);
      const next = on ? cur.filter((x) => x !== k) : [...cur, k];
      return next.length ? next : cur;
    });
    buzz();
  };

  const visibleJobs = useMemo(
    () => jobs.filter((j) => activeStatuses.includes(j.status || "scheduled")),
    [jobs, activeStatuses]
  );

  const keyOf = (d) => d.getFullYear() + "-" + d.getMonth() + "-" + d.getDate();
  const jobsByDayKey = useMemo(() => {
    const m = new Map();
    for (const j of visibleJobs) {
      const s = toDate(j.start_date);
      const e = toDate(j.end_date) || s;
      if (!s) continue;
      const d = new Date(s); d.setHours(0,0,0,0);
      const end = new Date(e); end.setHours(0,0,0,0);
      for (; d <= end; d.setDate(d.getDate() + 1)) {
        const k = keyOf(d);
        const arr = m.get(k) || [];
        arr.push(j);
        m.set(k, arr);
      }
    }
    return m;
  }, [visibleJobs]);

  const selectedDayJobs = useMemo(() => jobsByDayKey.get(keyOf(selectedDate)) || [], [jobsByDayKey, selectedDate]);

  const monthSummary = useMemo(() => {
    const count = visibleJobs.filter((j) => {
      const s = toDate(j.start_date);
      return s && s.getMonth() === month.getMonth() && s.getFullYear() === month.getFullYear();
    }).length;
    const profit = visibleJobs.reduce((sum, j) => {
      const s = toDate(j.start_date);
      const inMonth = s && s.getMonth() === month.getMonth() && s.getFullYear() === month.getFullYear();
      const p = Number.isFinite(j.profit) ? j.profit : Number(j.total||0) - (Number(j.cost||0) + Number(j.expenses_total||0));
      return inMonth ? sum + p : sum;
    }, 0);
    return { count, profit };
  }, [visibleJobs, month]);

  const openPicker = () => { setPickerYear(month.getFullYear()); setPickerOpen(true); buzz(); };
  const jumpTo = (y, m) => { const d = new Date(y, m, 1); setMonth(d); setPickerOpen(false); buzz(); };
  const onCreateForDate = (day) => {
    const iso = new Date(day.getFullYear(), day.getMonth(), day.getDate()).toISOString().split("T")[0];
    router.push({ pathname: jobCreateHref, params: { start: iso } });
  };

  return (
    <View style={st.screen}>
      <TopBar title="Jobs" right={right} />

      <>
        {loading ? (
          <View style={{ paddingTop: 20 }}><ActivityIndicator color={BRAND} /></View>
        ) : mode === "list" ? (
          <FlatList
            data={jobs}
            keyExtractor={(it) => String(it.id)}
            contentContainerStyle={{ paddingHorizontal: 12, paddingTop: 8, paddingBottom: 120 }}
            renderItem={renderCard}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
            ListEmptyComponent={<Text style={{ color: MUTED, textAlign: "center", marginTop: 28, fontWeight: "800" }}>No jobs yet.</Text>}
          />
        ) : (
          <ScrollView
            style={{ paddingHorizontal: 12 }}
            contentContainerStyle={{ paddingBottom: 12 }}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
            {...pan.panHandlers}
          >
            <View>
              {/* Month overview above the calendar */}
              <View style={st.monthSummaryCard}>
                <Text style={st.monthSummaryText}>
                  Jobs: {monthSummary.count} · Est. profit: {money(monthSummary.profit)}
                </Text>
              </View>

              <View style={st.calCard}>
                <View style={st.calHeader}>
                  <TouchableOpacity style={st.navBtn} onPress={prevMonth}><ChevronLeft size={18} color={TEXT} /></TouchableOpacity>
                  <TouchableOpacity onPress={openPicker} activeOpacity={0.8}>
                    <Text style={st.calTitle}>{month.toLocaleString(undefined, { month: "long", year: "numeric" })}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={st.navBtn} onPress={nextMonth}><ChevronRight size={18} color={TEXT} /></TouchableOpacity>
                </View>

                <View style={st.toolbar}>
                  <TouchableOpacity onPress={goToday} style={st.todayBtn}><Text style={st.todayTxt}>Today</Text></TouchableOpacity>
                  <View style={st.legendRow}>
                    {[
                      ["scheduled", "Scheduled"],
                      ["in_progress", "In progress"],
                      ["completed", "Completed"],
                    ].map(([key, label]) => {
                      const active = activeStatuses.includes(key);
                      const color = STATUS_COLORS[key];
                      return (
                        <TouchableOpacity
                          key={key}
                          onPress={() => toggleStatus(key)}
                          style={[st.legendChipSm, active && { backgroundColor: color + "14", borderColor: color + "55" }]}
                          activeOpacity={0.8}
                        >
                          <View style={[st.legendDotSm, { backgroundColor: color }]} />
                          <Text style={[st.legendTextSm, active && { color }]} numberOfLines={1}>{label}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>

                <View style={st.weekHeader}>
                  {["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map((d) => <Text key={d} style={st.weekHeadText}>{d}</Text>)}
                </View>

                {grid.map((week, wi) => {
                  const weekJobs = visibleJobs.filter((j) => {
                    const s = toDate(j.start_date);
                    const e = toDate(j.end_date) || s;
                    if (!s) return false;
                    const weekStart = week[0];
                    const weekEnd = week[6];
                    return e >= weekStart && s <= weekEnd;
                  });
                  const { ranges, laneCount } = buildWeekRanges(week, weekJobs);
                  const rowH = 44 + (laneCount - 1) * 8;
                  return (
                    <View key={`w-${wi}`} style={[st.weekRow, { height: rowH }]}>
                      <View style={st.bandsLayer} pointerEvents="none">
                        {ranges.map((r, i) => {
                          if (r.lane > 2) return null;
                          const left = r.startCol * (100 / 7);
                          const width = (r.endCol - r.startCol + 1) * (100 / 7);
                          return (
                            <View
                              key={`mb-${i}`}
                              style={[
                                st.microBand,
                                { left: `${left}%`, width: `${width}%`, top: 34 + r.lane * 6, backgroundColor: r.color + "66" },
                                r.isStart ? { borderTopLeftRadius: 999, borderBottomLeftRadius: 999 } : null,
                                r.isEnd ? { borderTopRightRadius: 999, borderBottomRightRadius: 999 } : null,
                              ]}
                            />
                          );
                        })}
                      </View>

                      {week.map((day, di) => {
                        const inMonth = day.getMonth() === month.getMonth() && day.getFullYear() === month.getFullYear();
                        const isToday = sameDay(day, new Date());
                        const isSelected = sameDay(day, selectedDate);
                        const jobsForDay = jobsByDayKey.get(keyOf(day)) || [];
                        const count = jobsForDay.length;
                        return (
                          <TouchableOpacity
                            key={`d-${di}`}
                            style={st.dayCell}
                            activeOpacity={0.8}
                            onPress={() => { setSelectedDate(new Date(day)); buzz(); }}
                            onLongPress={() => onCreateForDate(day)}
                          >
                            <View style={[
                              st.dayNumWrap,
                              isSelected && st.daySelected,
                              isToday && !isSelected && st.dayToday,
                              !inMonth && { opacity: 0.35 },
                            ]}>
                              <Text style={st.dayNum}>{day.getDate()}</Text>
                              {count > 1 && (<View style={st.badge}><Text style={st.badgeText}>+{count - 1}</Text></View>)}
                            </View>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  );
                })}
              </View>

              <View style={st.summaryCard}>
                <Text style={st.summaryTitle}>
                  {selectedDate.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}
                </Text>

                {selectedDayJobs.length === 0 ? (
                  <Text style={st.summaryEmpty}>No jobs on this day.</Text>
                ) : (
                  selectedDayJobs.map((j) => (
                    <TouchableOpacity key={j.id} style={st.dayJobRow} activeOpacity={0.85} onPress={() => router.push(jobHref(j.id))}>
                      <View style={[st.legendDotSm, { backgroundColor: STATUS_COLORS[j.status || "scheduled"] }]} />
                      <View style={{ flex: 1 }}>
                        <Text style={[st.summaryLine, { color: TEXT }]} numberOfLines={1}>{j.title || "Job"}</Text>
                        {!!j.client_name && <Text style={st.summarySub} numberOfLines={1}>{j.client_name}</Text>}
                      </View>
                    </TouchableOpacity>
                  ))
                )}
              </View>

              <View style={{ height: 96 }} />
            </View>
          </ScrollView>
        )}

        <TouchableOpacity style={st.fab} activeOpacity={0.9} onPress={() => router.push(jobCreateHref)}>
          <Plus size={22} color="#fff" />
        </TouchableOpacity>

        <Modal visible={pickerOpen} animationType="fade" transparent>
          <Pressable style={st.backdrop} onPress={() => setPickerOpen(false)} />
          <View style={st.pickerSheet}>
            <Text style={st.pickerTitle}>Jump to</Text>

            <View style={st.pickerRow}>
              <TouchableOpacity style={st.yearBtn} onPress={() => setPickerYear((y) => y - 1)}><ChevronLeft size={18} color={TEXT} /></TouchableOpacity>
              <Text style={st.yearLabel}>{pickerYear}</Text>
              <TouchableOpacity style={st.yearBtn} onPress={() => setPickerYear((y) => y + 1)}><ChevronRight size={18} color={TEXT} /></TouchableOpacity>
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
      </>
    </View>
  );
}

/* Small UI bits */
function StatusChip({ status }) {
  const label = status === "completed" ? "Completed" : status === "in_progress" ? "In progress" : "Scheduled";
  const color = STATUS_COLORS[status || "scheduled"] || BRAND;
  return (
    <View style={[st.chip, { borderColor: color + "55", backgroundColor: color + "12" }]}>
      <View style={[st.dot, { backgroundColor: color }]} />
      <Text style={[st.chipText, { color }]}>{label}</Text>
    </View>
  );
}

const st = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG, paddingTop: Platform.OS === "android" ? 8 : 0 },

  /* List – compact pro card */
  card: {
    backgroundColor: CARD,
    borderWidth: 1, borderColor: BORDER, borderRadius: 16,
    padding: 12, marginTop: 10,
    shadowColor: "#0b1220", shadowOpacity: 0.03, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 1,
  },
  cardHead: { flexDirection: "row", alignItems: "center", marginBottom: 6 },
  title: { color: TEXT, fontWeight: "900", fontSize: 16 },
  subtle: { color: MUTED, fontWeight: "800", marginTop: 2 },

  rows: { marginTop: 2, gap: 6 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderColor: "#f0f3f7",
  },
  rowL: { flexDirection: "row", alignItems: "center", gap: 6, minWidth: 84 },
  rowLabel: { color: MUTED, fontWeight: "900", fontSize: 12, textTransform: "uppercase", letterSpacing: 0.3 },
  rowValue: { flex: 1, textAlign: "right", color: TEXT, fontWeight: "800" },
  link: { textDecorationLine: "underline" },

  moneyBar: { flexDirection: "row", justifyContent: "space-between", marginTop: 8 },
  money: { fontWeight: "900" },

  chip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, borderWidth: 1 },
  chipText: { fontWeight: "900" },
  dot: { width: 8, height: 8, borderRadius: 999 },

  /* Calendar container */
  calCard: {
    backgroundColor: CARD, borderRadius: 18, padding: 12, borderWidth: 1, borderColor: BORDER,
    shadowColor: "#0b1220", shadowOpacity: 0.04, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, marginTop: 12,
  },
  calHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  calTitle: { color: TEXT, fontWeight: "900", fontSize: 20, letterSpacing: 0.2 },
  navBtn: { height: 32, width: 32, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: "#f2f4fa" },

  /* Toolbar + legend */
  toolbar: { marginTop: 8, marginBottom: 4, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  todayBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: BORDER, backgroundColor: "#f7f8fb" },
  todayTxt: { color: TEXT, fontWeight: "900", fontSize: 12 },
  legendRow: { flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 1 },
  legendChipSm: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999, borderWidth: 1, borderColor: BORDER, backgroundColor: "#fff" },
  legendDotSm: { width: 8, height: 8, borderRadius: 999 },
  legendTextSm: { color: MUTED, fontWeight: "800", fontSize: 11 },

  /* Week header + rows */
  weekHeader: { flexDirection: "row", marginTop: 2, marginBottom: 2, borderBottomWidth: 1, borderColor: BORDER, paddingBottom: 6 },
  weekHeadText: { flex: 1, textAlign: "center", color: MUTED, fontWeight: "900", fontSize: 12 },
  weekRow: { position: "relative", flexDirection: "row", gap: 0, marginBottom: 4 },

  /* Micro-bands */
  bandsLayer: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0 },
  microBand: { position: "absolute", height: 4, borderRadius: 6 },

  /* Day cells */
  dayCell: { flex: 1, alignItems: "center" },
  dayNumWrap: {
    marginTop: 6, width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: "transparent", backgroundColor: "transparent",
  },
  dayNum: { color: TEXT, fontWeight: "800", fontSize: 14 },
  dayToday: { borderColor: BRAND + "55" },
  daySelected: { borderColor: BRAND + "70" },
  badge: {
    position: "absolute", top: -6, right: -8, minWidth: 16, height: 16, paddingHorizontal: 3, borderRadius: 8,
    backgroundColor: "#0ea5e9", alignItems: "center", justifyContent: "center",
  },
  badgeText: { color: "#fff", fontSize: 10, fontWeight: "900" },

  /* Day summary */
  summaryCard: {
    marginTop: 10, marginBottom: 8, backgroundColor: CARD, borderRadius: 14, padding: 12, borderWidth: 1, borderColor: BORDER,
  },
  summaryTitle: { color: TEXT, fontWeight: "900", marginBottom: 6 },
  summaryLine: { color: TEXT, fontWeight: "800" },
  summarySub: { color: MUTED, fontWeight: "800" },
  summaryEmpty: { color: MUTED, fontWeight: "800" },
  dayJobRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 6 },

  /* Month overview (above calendar) */
  monthSummaryCard: {
    backgroundColor: CARD, borderRadius: 14, borderWidth: 1, borderColor: BORDER,
    paddingVertical: 10, paddingHorizontal: 12, marginTop: 12,
  },
  monthSummaryText: { color: TEXT, fontWeight: "900" },

  /* FAB */
  fab: {
    position: "absolute", right: 16, bottom: 26, height: 56, width: 56, borderRadius: 28,
    alignItems: "center", justifyContent: "center", backgroundColor: BRAND,
    shadowColor: "#1e293b", shadowOpacity: 0.25, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 3,
  },

  /* Month jump modal */
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