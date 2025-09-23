// app/(app)/quotes/list.js
import {
  loginHref,
  settingsHref,
  quoteCreateHref,
  quotePreviewHref,
  jobHref,
} from "../../../lib/nav";

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
  ActivityIndicator,
  Platform,
  Switch,
  Alert,
} from "react-native";
import { useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { supabase } from "../../../lib/supabase";
import {
  Search,
  Plus,
  ChevronRight,
  CalendarDays,
  PoundSterling,
  Settings,
  Trash2,
  Eye,
  CalendarPlus,
  RefreshCcw,
  MapPin,
  Minus,
  Plus as PlusIcon,
} from "lucide-react-native";

import SharedCalendar from "../../../components/SharedCalendar";
import { getPremiumStatus } from "../../../lib/premium";
import PaywallModal from "../../../components/PaywallModal";

/* ---------- theme ---------- */
const BRAND = "#2a86ff";
const TEXT = "#0b1220";
const MUTED = "#6b7280";
const CARD = "#ffffff";
const BG = "#f5f7fb";
const BORDER = "#e6e9ee";
const DANGER = "#dc2626";
const ORANGE = "#f59e0b";
const GREEN = "#16a34a";

/* ---------- status helpers ---------- */
const normalizeStatus = (s) =>
  String(s || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/^open$/, "scheduled");

const STATUS_COLOR = {
  scheduled: BRAND,
  in_progress: ORANGE,
  complete: GREEN,
};

const badgeColorForJobs = (arr = []) => {
  const hasInProg = arr.some((j) => normalizeStatus(j.status) === "in_progress");
  const hasDone = arr.some((j) => normalizeStatus(j.status) === "complete");
  if (hasInProg) return STATUS_COLOR.in_progress;
  if (hasDone) return STATUS_COLOR.complete;
  return STATUS_COLOR.scheduled;
};

/* ---------- utils ---------- */
const money = (v = 0) =>
  "£" + Number(v || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

const displayQuoteId = (q) => {
  const ref = String(q?.reference || "").trim();
  if (ref) {
    if (/^QUO-/i.test(ref)) return ref.toUpperCase();
    const m = ref.match(/^[A-Z]{2,4}-(\d{4})\d{4}-?-(\d{1,4})$/);
    if (m) return `QUO-${m[1]}-${m[2].padStart(4, "0")}`;
  }
  const num = q?.quote_number ?? 0;
  const year = q?.created_at ? new Date(q.created_at).getFullYear() : new Date().getFullYear();
  return "QUO-" + year + "-" + String(num).padStart(4, "0");
};

const pad = (n) => (n < 10 ? "0" + n : String(n));
const toYMD = (d) =>
  d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
const toLocalMidnight = (d) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};
const isWeekend = (d) => d.getDay() === 0 || d.getDay() === 6;
const addWorkingDays = (startDate, days, includeWeekends) => {
  const s = toLocalMidnight(startDate);
  if (days <= 1) return s;
  let remaining = days - 1;
  const cur = new Date(s);
  while (remaining > 0) {
    cur.setDate(cur.getDate() + 1);
    if (includeWeekends || !isWeekend(cur)) remaining--;
  }
  return cur;
};
const sameDay = (a, b) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

/* ---------- availability helpers ---------- */
const atMidnight = (d) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};
const spanEnd = (start, days, includeWeekends) =>
  addWorkingDays(start, Math.max(1, days), includeWeekends);

const eachDay = (a, b, cb) => {
  const cur = atMidnight(a),
    end = atMidnight(b);
  while (cur <= end) {
    cb(new Date(cur));
    cur.setDate(cur.getDate() + 1);
  }
};

/* ---------- small helpers ---------- */
const num = (v, d = 0) => {
  if (v == null) return d;
  const n = Number(String(v).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : d;
};
const calcAmount = (it) => {
  const direct = it.total ?? it.unit_total ?? it.line_total ?? it.amount;
  if (direct != null) return num(direct, 0);
  return +(num(it.unit_price ?? it.price ?? it.rate, 0) * num(it.qty ?? it.quantity ?? 1, 1)).toFixed(2);
};
const flattenItems = (src) => {
  if (!src) return [];
  let data = src;
  if (typeof data === "string") {
    try { data = JSON.parse(data); } catch { data = []; }
  }
  if (Array.isArray(data)) return data;

  const flat = [];
  for (const [k, v] of Object.entries(data || {})) {
    if (Array.isArray(v)) flat.push(...v.map((x) => ({ ...x, group: k })));
  }
  return flat;
};
/** djb2 text hash → hex-ish fingerprint */
const fingerprintOf = (txt) => {
  let h = 5381;
  for (let i = 0; i < txt.length; i++) h = ((h << 5) + h) + txt.charCodeAt(i);
  return "fp_" + (h >>> 0).toString(16);
};

/* ---------- build rows that match public.expenses schema ---------- */
const buildExpenseRows = ({ quote, jobId, userId, dateISO }) => {
  const items = flattenItems(quote?.line_items);
  const quoteId = quote?.id ?? quote?.source_quote_id ?? null;
  const rows = [];

  items.forEach((it, idx) => {
    const type = String(it.type ?? "").toLowerCase();
    if (type === "labour" || type === "labor") return;

    const amount = calcAmount(it);
    if (!(amount > 0)) return;

    const title = it.title ?? it.name ?? it.description ?? "Expense";
    const base = userId + "|" + jobId + "|" + (quoteId || "noquote") + "|" + title + "|" + amount.toFixed(2) + "|" + idx;
    const fingerprint = fingerprintOf(base);

    rows.push({
      job_id: jobId,
      user_id: userId,
      title,
      name: title || "Item",
      amount: Number(amount),
      total: Number(amount),
      date: dateISO,
      notes: it.description || null,
      source_quote_id: quoteId,
      fingerprint,
      qty: num(it.qty ?? it.quantity, null) || null,
      unit_cost: num(it.unit_price ?? it.price ?? it.rate, null) || null,
    });
  });

  return rows;
};

/* ---------- component ---------- */
export default function QuoteList() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [quotes, setQuotes] = useState([]);
  const [query, setQuery] = useState("");

  const [actionOpen, setActionOpen] = useState(false);
  const [selectedQuote, setSelectedQuote] = useState(null);

  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [pendingQuote, setPendingQuote] = useState(null);

  const [cjBusy, setCjBusy] = useState(false);
  const [cjError, setCjError] = useState("");
  const [cjNotice, setCjNotice] = useState("");
  const [cjIncludeWeekends, setCjIncludeWeekends] = useState(false);
  const [cjDays, setCjDays] = useState(1);
  const [cjStart, setCjStart] = useState(toLocalMidnight(new Date()));

  const [userId, setUserId] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [calMonth, setCalMonth] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return d;
  });

  const [premiumStatus, setPremiumStatus] = useState({ isPremium: false, status: "no_profile" });
  const [showPaywall, setShowPaywall] = useState(false);

  const endDate = useMemo(
    () => spanEnd(cjStart, Math.max(1, cjDays), cjIncludeWeekends),
    [cjStart, cjDays, cjIncludeWeekends]
  );
  const spanBlocked = useMemo(
    () => !isSpanFree(cjStart, cjDays, cjIncludeWeekends, jobs),
    [cjStart, cjDays, cjIncludeWeekends, jobs]
  );

  const haptic = useRef(null);
  useEffect(() => {
    (async () => {
      try {
        const m = await import("expo-haptics");
        haptic.current = m;
      } catch {}
    })();
  }, []);
  const buzz = (style = "selection") => {
    const H = haptic.current;
    if (!H) return;
    style === "selection"
      ? H.selectionAsync?.()
      : H.impactAsync?.(H.ImpactFeedbackStyle.Light);
  };

  const loadQuotes = useCallback(async () => {
    setLoading(true);
    try {
      const { data: auth } = await supabase.auth.getUser();
      const user = auth?.user;
      if (!user) {
        router.replace(loginHref);
        return;
      }
      setUserId(user.id);

      // profile → premium status
      const { data: profile } = await supabase
        .from("profiles")
        .select("trial_ends_at, plan_tier, plan_status")
        .eq("id", user.id)
        .maybeSingle();

      if (profile) {
        const status = getPremiumStatus(profile);
        setPremiumStatus(status);
        if (status.isBlocked) {
          router.replace("/(app)/trial-expired");
          return;
        }
      }

      let q = supabase
        .from("quotes")
        .select(
          "id, quote_number, reference, client_name, total, created_at, pdf_url, client_address, status, job_id"
        )
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });

      if (query.trim()) {
        const t = query.trim();
        q = q.or(
          "client_name.ilike.%"+t+"%,quote_number.ilike.%"+t+"%,reference.ilike.%"+t+"%"
        );
      }

      const res = await q.limit(400);
      if (res.error) throw res.error;
      setQuotes((res.data || []).filter((x) => !x.job_id));
    } finally {
      setLoading(false);
    }
  }, [router, query]);

  const loadJobs = useCallback(async () => {
    if (!userId) return;
    const { data, error } = await supabase
      .from("jobs")
      .select("id, title, start_date, end_date, status, include_weekends, user_id")
      .eq("user_id", userId);
    if (!error) setJobs(data || []);
  }, [userId]);

  useEffect(() => {
    loadQuotes();
  }, [loadQuotes]);
  useFocusEffect(
    useCallback(() => {
      loadQuotes();
    }, [loadQuotes])
  );

  useEffect(() => {
    if (!scheduleOpen) return;
    if (!isSpanFree(cjStart, cjDays, cjIncludeWeekends, jobs)) {
      const best = nextAvailableStart(cjStart, cjDays, cjIncludeWeekends, jobs);
      setCjStart(best);
      setCalMonth(new Date(best.getFullYear(), best.getMonth(), 1));
    }
  }, [jobs, cjDays, cjIncludeWeekends, scheduleOpen, cjStart]);

  const openActionFor = (q) => {
    setSelectedQuote(q);
    setActionOpen(true);
  };

  const openCreateJob = async (q) => {
    if (!q) return;
    if (String(q?.status || "").toLowerCase() === "draft") {
      buzz("impact");
      return;
    }

    // premium gate
    if (!premiumStatus.isPremium) {
      setShowPaywall(true);
      return;
    }

    setCjBusy(true);
    setCjError("");
    setCjNotice("");

    const { data: full, error } = await supabase
      .from("quotes")
      .select("*")
      .eq("id", q.id)
      .maybeSingle();

    if (!error) {
      let days = 1;
      try {
        const blob =
          typeof full?.job_details === "string"
            ? JSON.parse(full.job_details)
            : full?.job_details || {};
        const meta = blob?.ai_meta || blob?.meta || {};
        if (meta?.day_rate_calc) {
          const d = Number(meta.day_rate_calc.days || 0);
          const rem = Number(meta.day_rate_calc.remainder_hours || 0);
          days = Math.max(1, d + (rem > 0 ? 1 : 0));
        } else if (Number(meta?.estimated_hours)) {
          const hpd =
            Number(meta?.hours_per_day || blob?.profile?.hours_per_day || 8) ||
            8;
          days = Math.max(1, Math.ceil(Number(meta.estimated_hours) / hpd));
        }
      } catch {}
      setPendingQuote(full || q);
      setCjDays(Math.max(1, Math.floor(days || 1)));
      setCjIncludeWeekends(false);

      await loadJobs();
      const seed = toLocalMidnight(new Date());
      const best = nextAvailableStart(seed, Math.max(1, days || 1), false, jobs);
      setCjStart(best);
      setCalMonth(new Date(best.getFullYear(), best.getMonth(), 1));
      setScheduleOpen(true);
    }

    setCjBusy(false);
  };

  const createJobInternal = async (
    full,
    days,
    includeWeekends,
    startDateOverride
  ) => {
    try {
      setCjBusy(true);
      setCjError("");
      setCjNotice("");

      const { data: auth } = await supabase.auth.getUser();
      const user = auth?.user;
      if (!user) {
        router.replace(loginHref);
        return;
      }

      const startDate = startDateOverride || cjStart;
      const start = toYMD(startDate);
      const end = toYMD(
        addWorkingDays(
          startDate,
          Math.max(1, Math.floor(days || 1)),
          includeWeekends
        )
      );

      const insert = {
        user_id: user.id,
        title: full.job_summary || "Job",
        client_name: full.client_name || "Client",
        client_address: full.client_address || null,
        site_address: full.site_address || full.client_address || null,
        status: "scheduled",
        start_date: start,
        end_date: end,
        duration_days: Math.max(1, Math.floor(days || 1)),
        include_weekends: includeWeekends,
        total: Number(full.total || 0),
        cost: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        source_quote_id: full.id,
      };

      const ins = await supabase
        .from("jobs")
        .insert(insert)
        .select("id")
        .single();
      if (ins.error) throw ins.error;
      const jobId = ins.data.id;

      // ------- EXPENSES (schema-aligned) -------
      const expenseRows = buildExpenseRows({
        quote: full,
        jobId,
        userId: user.id,
        dateISO: start,
      });

      if (expenseRows.length) {
        const expRes = await supabase
          .from("expenses")
          .insert(expenseRows)
          .select("id, amount");
        if (expRes.error) throw expRes.error;

        const created = expRes.data || [];
        const totalExpenses = created.reduce((s, e) => s + (Number(e.amount) || 0), 0);
        setCjNotice(`Created ${created.length} expenses (£${totalExpenses.toFixed(2)})`);
      } else {
        setCjNotice("No non-labour items found to create expenses.");
      }

      const upd = await supabase
        .from("quotes")
        .update({
          status: "accepted",
          updated_at: new Date().toISOString(),
          job_id: jobId,
        })
        .eq("id", full.id);
      if (upd.error) throw upd.error;

      setScheduleOpen(false);
      setQuotes((prev) => prev.filter((x) => x.id !== full.id));
      router.push(jobHref(jobId));
    } catch (e) {
      setCjError(e?.message || "Create job failed");
    } finally {
      setCjBusy(false);
    }
  };

  const adjustIfBlocked = useCallback(
    (nextDays, nextWeekends) => {
      if (!isSpanFree(cjStart, nextDays, nextWeekends, jobs)) {
        const best = nextAvailableStart(cjStart, nextDays, nextWeekends, jobs);
        setCjStart(best);
        setCalMonth(new Date(best.getFullYear(), best.getMonth(), 1));
      }
    },
    [cjStart, jobs]
  );

  const renderCard = ({ item }) => {
    const address = item.client_address || "";
    const dispId = displayQuoteId(item);

    return (
      <TouchableOpacity onPress={() => openActionFor(item)} activeOpacity={0.9} style={styles.card}>
        <TouchableOpacity
          style={styles.binBtn}
          onPress={async () => {
            Alert.alert(
              "Delete quote?",
              "This will permanently delete this quote.",
              [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Delete",
                  style: "destructive",
                  onPress: async () => {
                    const del = await supabase.from("quotes").delete().eq("id", item.id);
                    if (!del.error) {
                      setQuotes((prev) => prev.filter((x) => x.id !== item.id));
                    } else {
                      Alert.alert("Delete failed", del.error.message || "Please try again.");
                    }
                  },
                },
              ]
            );
          }}
          activeOpacity={0.85}
        >
          <Trash2 size={18} color="#b91c1c" />
        </TouchableOpacity>

        {!!dispId && (
          <Text style={styles.quoteTiny} numberOfLines={1}>
            {dispId}
          </Text>
        )}

        <View style={{ flexShrink: 1, paddingRight: 110 }}>
          <Text style={styles.clientName} numberOfLines={1}>
            {item.client_name || "—"}
          </Text>

          <View style={styles.rowMini}>
            <CalendarDays size={16} color={MUTED} />
            <Text style={styles.rowMiniText}>{"  "}{new Date(item.created_at).toLocaleDateString()}</Text>
          </View>

          {!!address && (
            <View style={styles.rowMini}>
              <MapPin size={16} color={MUTED} />
              <Text style={[styles.rowMiniText, { flexShrink: 1 }]} numberOfLines={1}>
                {"  "}{address}
              </Text>
            </View>
          )}
        </View>

        <Text style={styles.totalBottom}>{money(item.total || 0)}</Text>
        <ChevronRight
          size={18}
          color={MUTED}
          style={{ position: "absolute", right: 46, top: 12, opacity: 0.6 }}
        />
      </TouchableOpacity>
    );
  };

  // dynamic label for Create button
  const createBtnLabel = cjBusy ? "Creating..." : spanBlocked ? "Pick another start" : "Create";

  return (
    <View style={styles.screen}>
      {/* Topbar */}
      <View style={styles.topbar}>
        <Text style={styles.h1}>Quotes</Text>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <TouchableOpacity style={styles.iconBtn} onPress={loadQuotes}>
            <RefreshCcw size={20} color={MUTED} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.iconBtn} onPress={() => router.push("/(app)/settings")}>
            <Settings size={20} color={MUTED} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Search */}
      <View style={styles.searchRow}>
        <Search size={18} color={MUTED} style={{ marginRight: 8 }} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search client or quote number"
          placeholderTextColor={MUTED}
          style={styles.searchInput}
          returnKeyType="search"
          onSubmitEditing={loadQuotes}
        />
      </View>

      {/* List */}
      {loading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={BRAND} />
        </View>
      ) : (
        <FlatList
          data={quotes}
          keyExtractor={(it) => String(it.id)}
          renderItem={renderCard}
          contentContainerStyle={{ paddingBottom: 180, paddingTop: 14, paddingHorizontal: 16 }}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
          ListEmptyComponent={
            <View style={{ paddingTop: 40, alignItems: "center" }}>
              <PoundSterling size={28} color={MUTED} />
              <Text style={{ color: MUTED, marginTop: 8 }}>No quotes found.</Text>
            </View>
          }
        />
      )}

      {/* FAB */}
      <TouchableOpacity onPress={() => router.push(quoteCreateHref())} style={styles.fab} activeOpacity={0.9}>
        <Plus size={24} color="#fff" />
      </TouchableOpacity>

      {/* Action Modal */}
      <Modal visible={actionOpen} animationType="fade" transparent>
        <Pressable style={styles.modalBackdrop} onPress={() => setActionOpen(false)} />
        <View style={styles.centerWrap}>
          <View style={styles.actionCard}>
            <View style={styles.handle} />
            <View style={styles.centerRow}>
              <TouchableOpacity
                style={[styles.centerBtn, styles.centerBtnPrimary]}
                onPress={() => {
                  setActionOpen(false);
                  if (!selectedQuote) return;
                  // ✅ Use helper that appends ?id=<uuid> (prevents "preview" as id)
                  router.push(quotePreviewHref(selectedQuote.id));
                }}
                activeOpacity={0.9}
              >
                <Eye size={18} color="#fff" />
                <Text style={[styles.centerBtnText, { color: "#fff" }]}>View</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.centerBtn, styles.centerBtnNeutral]}
                onPress={async () => {
                  setActionOpen(false);
                  if (selectedQuote) await openCreateJob(selectedQuote);
                }}
                activeOpacity={0.9}
              >
                <CalendarPlus size={18} color={TEXT} />
                <Text style={styles.centerBtnText}>Create job</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Schedule Modal */}
      <Modal visible={scheduleOpen} animationType="fade" transparent>
        <Pressable style={styles.modalBackdrop} onPress={() => setScheduleOpen(false)} />
        <View style={styles.sheet}>
          <Text style={styles.sheetTitle}>Create job</Text>

          <SharedCalendar
            month={calMonth}
            onChangeMonth={setCalMonth}
            selectedDate={cjStart}
            onSelectDate={(d) => setCjStart(d)}
            jobs={jobs}
            span={{ start: cjStart, days: cjDays, includeWeekends: cjIncludeWeekends }}
            blockStarts
            onDayLongPress={(day, jobsOnDay) => {
              if (jobsOnDay?.length) router.push(jobHref(jobsOnDay[0].id));
            }}
          />

          {/* Duration */}
          <View style={styles.durationBlock}>
            <Text style={styles.controlHeader}>Duration</Text>
            <View style={styles.spinRow}>
              <TouchableOpacity
                style={styles.spinBtn}
                onPress={() => {
                  const d = Math.max(1, cjDays - 1);
                  setCjDays(d);
                  adjustIfBlocked(d, cjIncludeWeekends);
                }}
              >
                <Minus size={18} color={TEXT} />
              </TouchableOpacity>
              <Text style={styles.spinValue}>{cjDays} day{cjDays > 1 ? "s" : ""}</Text>
              <TouchableOpacity
                style={styles.spinBtn}
                onPress={() => {
                  const d = cjDays + 1;
                  setCjDays(d);
                  adjustIfBlocked(d, cjIncludeWeekends);
                }}
              >
                <PlusIcon size={18} color={TEXT} />
              </TouchableOpacity>
            </View>
          </View>

          {/* Weekends toggle */}
          <View style={styles.weekendRow}>
            <Text style={styles.controlHeader}>Include weekends</Text>
            <Switch
              value={cjIncludeWeekends}
              onValueChange={(v) => {
                setCjIncludeWeekends(v);
                adjustIfBlocked(cjDays, v);
              }}
            />
          </View>

          {/* Start/End + hint */}
          <Text style={styles.endPreview}>
            Start: <Text style={styles.bold}>{toYMD(cjStart)}</Text>  •  End: <Text style={styles.bold}>{toYMD(endDate)}</Text>
          </Text>
          <Text style={[styles.endPreview, { textAlign: "left", opacity: 0.8 }]}>
            {(() => {
              const first = new Date(calMonth.getFullYear(), calMonth.getMonth(), 1);
              const last = new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 0);
              let count = 0;
              eachDay(first, last, (d) => {
                if (!isSpanFree(d, cjDays, cjIncludeWeekends, jobs)) count++;
              });
              return `${count} starts blocked this month`;
            })()}
          </Text>

          {spanBlocked && (
            <Text style={styles.blockedWarn}>
              This start overlaps an existing job. Pick a different date or change duration/weekends.
            </Text>
          )}
          {!!cjError && <Text style={[styles.blockedWarn, { marginTop: 6 }]}>{cjError}</Text>}
          {!!cjNotice && !cjError && (
            <Text style={{ marginTop: 8, color: "#065f46", fontWeight: "900" }}>
              {cjNotice}
            </Text>
          )}

          <View style={styles.sheetBtns}>
            <TouchableOpacity style={[styles.sheetBtn, styles.sheetBtnGhost]} onPress={() => setScheduleOpen(false)} activeOpacity={0.9}>
              <Text style={[styles.sheetBtnText, { color: TEXT }]}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.sheetBtn, styles.sheetBtnPrimary, (cjBusy || spanBlocked) && { opacity: 0.55 }]}
              activeOpacity={0.9}
              disabled={cjBusy || spanBlocked}
              onPress={async () => {
                if (!pendingQuote) return;
                await createJobInternal(pendingQuote, cjDays, cjIncludeWeekends, cjStart);
              }}
              accessibilityLabel={spanBlocked ? "Start date overlaps an existing job" : "Create job"}
            >
              <CalendarPlus size={18} color="#fff" />
              <Text style={[styles.sheetBtnText, { color: "#fff" }]} numberOfLines={1}>{createBtnLabel}</Text>
            </TouchableOpacity>
          </View>

          {spanBlocked && !cjError && (
            <Text
              style={{
                color: MUTED,
                fontSize: 12,
                textAlign: "center",
                marginTop: 6,
                fontWeight: "800",
              }}
            >
              Try a different start date or adjust duration/weekends.
            </Text>
          )}
        </View>
      </Modal>

      {/* Paywall Modal */}
      <PaywallModal
        visible={showPaywall}
        onClose={() => setShowPaywall(false)}
        onSubscribe={() => {
          setShowPaywall(false);
          router.push("/(app)/billing");
        }}
        title="Premium Feature"
        message={
          premiumStatus.status === "expired"
            ? "Your trial has ended. Subscribe to create jobs from quotes."
            : "Job creation is a premium feature. Upgrade to unlock it."
        }
      />
    </View>
  );
}

/* ---------- styles ---------- */
const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: BG,
    paddingTop: Platform.OS === "android" ? 8 : 0,
  },

  topbar: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  h1: { color: TEXT, fontSize: 24, fontWeight: "800" },

  iconBtn: {
    height: 38,
    width: 38,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: CARD,
  },

  searchRow: {
    marginTop: 14,
    marginHorizontal: 16,
    backgroundColor: CARD,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
  },
  searchInput: { flex: 1, color: TEXT },

  card: {
    backgroundColor: CARD,
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BORDER,
    shadowColor: "#0b1220",
    shadowOpacity: 0.06,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
    minHeight: 78,
    marginBottom: 10,
  },
  quoteTiny: {
    position: "absolute",
    right: 72,
    top: 14,
    color: MUTED,
    fontSize: 12,
    maxWidth: 200,
    textAlign: "right",
    fontWeight: "800",
  },
  clientName: { color: TEXT, fontWeight: "900", fontSize: 16 },
  rowMini: { flexDirection: "row", alignItems: "center", marginTop: 4 },
  rowMiniText: { color: MUTED },

  totalBottom: {
    position: "absolute",
    right: 16,
    bottom: 12,
    fontSize: 16,
    fontWeight: "900",
    color: TEXT,
  },

  binBtn: {
    position: "absolute",
    right: 12,
    top: 10,
    height: 30,
    width: 30,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fee2e2",
    borderWidth: 1,
    borderColor: "#fecaca",
    zIndex: 5,
  },

  fab: {
    position: "absolute",
    right: 18,
    bottom: 18,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: BRAND,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: BRAND,
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },

  /* Overlay */
  modalBackdrop: { flex: 1, backgroundColor: "#0009" },

  /* Polished action modal (centered) */
  centerWrap: {
    position: "absolute",
    top: 0, left: 0, right: 0, bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  actionCard: {
    width: "100%",
    backgroundColor: CARD,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 16,
    paddingTop: 12,
    shadowColor: "#0b1220",
    shadowOpacity: 0.22,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 14 },
    elevation: 12,
  },
  handle: {
    alignSelf: "center",
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#e5e7eb",
    marginBottom: 10,
  },
  centerRow: { flexDirection: "row", gap: 10 },
  centerBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
    backgroundColor: "#f8fafc",
    shadowColor: "#0b1220",
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  centerBtnPrimary: { backgroundColor: BRAND, borderColor: BRAND },
  centerBtnNeutral: { backgroundColor: "#f7f8fb" },
  centerBtnText: { fontSize: 15, fontWeight: "900", color: TEXT },

  /* Schedule sheet */
  sheet: {
    position: "absolute",
    alignSelf: "center",
    top: "8%",
    width: "92%",
    backgroundColor: CARD,
    borderRadius: 20,
    padding: 14,
    paddingBottom: 16,
    borderWidth: 1,
    borderColor: BORDER,
    shadowColor: "#0b1220",
    shadowOpacity: 0.14,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 12,
    maxHeight: "86%",
    overflow: "hidden",
  },
  sheetTitle: {
    color: TEXT,
    fontWeight: "900",
    fontSize: 18,
    textAlign: "center",
    marginBottom: 8,
  },

  endPreview: {
    color: MUTED,
    marginTop: 10,
    textAlign: "right",
    fontWeight: "800",
  },
  bold: { color: TEXT, fontWeight: "900" },

  blockedWarn: {
    marginTop: 8,
    color: DANGER,
    fontWeight: "900",
  },

  durationBlock: { marginTop: 10, alignItems: "center", justifyContent: "center" },
  weekendRow: { marginTop: 10, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  controlHeader: { color: TEXT, fontWeight: "900", fontSize: 15 },

  spinRow: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 8 },
  spinBtn: {
    height: 40,
    width: 40,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: "#f7f8fb",
    alignItems: "center",
    justifyContent: "center",
  },
  spinValue: { color: TEXT, fontWeight: "900", minWidth: 120, textAlign: "center", fontSize: 16 },

  sheetBtns: { flexDirection: "row", gap: 10, marginTop: 14 },
  sheetBtn: {
    flex: 1,
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 10,
  },
  sheetBtnGhost: { backgroundColor: "#eef2f7", borderColor: BORDER },
  sheetBtnPrimary: { backgroundColor: BRAND, borderColor: BRAND },
  sheetBtnText: { fontWeight: "900", fontSize: 15, includeFontPadding: false },
});

/** Return true if ANY working day of job intersects ANY working day in the proposed span. */
const jobOverlapsWorking = (job, spanStart, spanDays, spanIncludeWeekends) => {
  const js0 = job.start_date ? atMidnight(new Date(job.start_date)) : null;
  const je0 = job.end_date ? atMidnight(new Date(job.end_date)) : js0;
  if (!js0) return false;

  const spanEndDate = spanEnd(spanStart, Math.max(1, spanDays), spanIncludeWeekends);

  // Build a working-day Set for the span
  const spanKeys = new Set();
  eachDay(spanStart, spanEndDate, (d) => {
    if (spanIncludeWeekends || !isWeekend(d)) {
      spanKeys.add(d.getFullYear() + "-" + d.getMonth() + "-" + d.getDate());
    }
  });

  // Walk job days, respecting job.include_weekends
  const jobIncWknd = !!job.include_weekends;
  let hit = false;
  eachDay(js0, je0, (d) => {
    if (hit) return;
    if (jobIncWknd || !isWeekend(d)) {
      const k = d.getFullYear() + "-" + d.getMonth() + "-" + d.getDate();
      if (spanKeys.has(k)) hit = true;
    }
  });
  return hit;
};

const isSpanFree = (start, days, includeWeekends, allJobs) => {
  for (const j of allJobs) {
    if (jobOverlapsWorking(j, start, days, includeWeekends)) return false;
  }
  return true;
};

const nextAvailableStart = (
  fromDate,
  days,
  includeWeekends,
  allJobs,
  lookaheadDays = 365
) => {
  const start = atMidnight(fromDate);
  for (let i = 0; i < lookaheadDays; i++) {
    const tryDate = new Date(start);
    tryDate.setDate(start.getDate() + i);
    if (isSpanFree(tryDate, days, includeWeekends, allJobs)) return tryDate;
    }
  return start;
};