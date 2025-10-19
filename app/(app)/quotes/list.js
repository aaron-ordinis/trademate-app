// app/(app)/quotes/list.js
import React, { useCallback, useEffect, useMemo, useState } from "react";
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
  Switch,
  Alert,
  StatusBar,
} from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
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
  MapPin,
  Minus,
  Plus as PlusIcon,
  RefreshCcw,
} from "lucide-react-native";

import SharedCalendar from "../../../components/SharedCalendar";
import AssistantFab from "../../../components/AssistantFab";
import AssistantSheet from "../../../components/AssistantSheet";
import { quoteCreateHref, quotePreviewHref, jobHref, loginHref } from "../../../lib/nav";

/* ---------- tiny logger ---------- */
const log = (tag, obj) => {
  try { console.log("[quotes.list]", tag, obj || {}); } catch {}
};

/* ---------- theme ---------- */
const BRAND = "#2a86ff";
const TEXT = "#0b1220";
const MUTED = "#6b7280";
const CARD = "#ffffff";
const BG = "#f5f7fb";
const BORDER = "#e6e9ee";
const DANGER = "#dc2626";

/* VAT defaults */
const VAT_ENABLED_DEFAULT = true;
const VAT_RATE_DEFAULT = 0.2;

/* ---------- utils ---------- */
const money = (v = 0) =>
  "£" + Number(v || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

const pad = (n) => (n < 10 ? "0" + n : String(n));
const toYMD = (d) =>
  d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
const atMidnight = (d) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};
const isWeekend = (d) => d.getDay() === 0 || d.getDay() === 6;

const addWorkingDays = (startDate, days, includeWeekends) => {
  const s = atMidnight(startDate);
  if (days <= 1) return s;
  let remaining = days - 1;
  const cur = new Date(s);
  while (remaining > 0) {
    cur.setDate(cur.getDate() + 1);
    if (includeWeekends || !isWeekend(cur)) remaining--;
  }
  return cur;
};

const eachDay = (a, b, cb) => {
  const cur = atMidnight(a),
    end = atMidnight(b);
  while (cur <= end) {
    cb(new Date(cur));
    cur.setDate(cur.getDate() + 1);
  }
};

const num = (v, d = 0) => {
  if (v == null) return d;
  const n = Number(String(v).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : d;
};
const calcAmount = (it) => {
  const direct = it.total ?? it.unit_total ?? it.line_total ?? it.amount;
  if (direct != null) return num(direct, 0);
  return +(
    num(it.unit_price ?? it.price ?? it.rate, 0) *
    num(it.qty ?? it.quantity ?? 1, 1)
  ).toFixed(2);
};
const flattenItems = (src) => {
  if (!src) return [];
  let data = src;
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {
      data = [];
    }
  }
  if (Array.isArray(data)) return data;
  const flat = [];
  for (const [k, v] of Object.entries(data || {})) {
    if (Array.isArray(v)) flat.push(...v.map((x) => ({ ...x, group: k })));
  }
  return flat;
};
const fingerprintOf = (txt) => {
  let h = 5381;
  for (let i = 0; i < txt.length; i++) h = ((h << 5) + h) + txt.charCodeAt(i);
  return "fp_" + (h >>> 0).toString(16);
};

const displayQuoteId = (q) => {
  const ref = String(q?.reference || "").trim();
  if (ref) {
    if (/^QUO-/i.test(ref)) return ref.toUpperCase();
  }
  const numPart = q?.quote_number ?? 0;
  const year = q?.created_at
    ? new Date(q.created_at).getFullYear()
    : new Date().getFullYear();
  return "QUO-" + year + "-" + String(numPart).padStart(4, "0");
};

/* ============================================= */
/*                    SCREEN                      */
/* ============================================= */
export default function QuoteList() {
  const router = useRouter();

  const [loading, setLoading] = useState(false);
  const [quotes, setQuotes] = useState([]);
  const [query, setQuery] = useState("");
  const [userId, setUserId] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [screenReady, setScreenReady] = useState(true);
  const [expandedQuoteId, setExpandedQuoteId] = useState(null);
  const [selectedQuote, setSelectedQuote] = useState(null);

  // Assistant sheet
  const [assistantOpen, setAssistantOpen] = useState(false);

  // Guarded open/close with logs
  const openAssistant = () => {
    if (assistantOpen) return; // avoid double-tap spam
    setAssistantOpen(true);
    log("assistant.open", { screen: "quotes" });
  };
  const closeAssistant = () => {
    setAssistantOpen(false);
    log("assistant.close", { screen: "quotes" });
  };

  /* Data */
  const loadQuotes = useCallback(async () => {
    try {
      const { data: auth } = await supabase.auth.getUser();
      const user = auth?.user;
      if (!user) {
        router.replace(loginHref);
        return;
      }
      setUserId(user.id);

      let q = supabase
        .from("quotes")
        .select(
          "id, quote_number, reference, client_name, total, created_at, client_address, status, job_id"
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
      if (!res.error) setQuotes((res.data || []).filter((x) => !x.job_id));
    } catch (error) {
      console.warn('[QuoteList] loadQuotes error:', error);
    }
  }, [router, query]);

  const loadJobs = useCallback(async () => {
    if (!userId) return [];
    try {
      const { data, error } = await supabase
        .from("jobs")
        .select(
          "id, title, start_date, end_date, status, include_weekends, user_id"
        )
        .eq("user_id", userId);
      if (!error) {
        setJobs(data || []);
        return data || [];
      }
    } catch (error) {
      console.warn('[QuoteList] loadJobs error:', error);
    }
    return [];
  }, [userId]);

  useEffect(() => {
    const loadAllData = async () => {
      await loadQuotes();
      if (userId) {
        await loadJobs();
      }
    };
    loadAllData();
  }, [loadQuotes, loadJobs, userId, query]);

  /* ---------- toggle expansion ---------- */
  const toggleExpansion = (quoteId) => {
    setExpandedQuoteId((prev) => (prev === quoteId ? null : quoteId));
    setSelectedQuote(quotes.find((q) => q.id === quoteId));
  };

  /* ---------- Create Job flow (trimmed) ---------- */
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [cjDays, setCjDays] = useState(1);
  const [cjIncludeWeekends, setCjIncludeWeekends] = useState(false);
  const [cjStart, setCjStart] = useState(atMidnight(new Date()));
  const [calMonth, setCalMonth] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return d;
  });
  const [cjBusy, setCjBusy] = useState(false);
  const [cjError, setCjError] = useState("");
  const endDate = useMemo(
    () => addWorkingDays(cjStart, Math.max(1, cjDays), cjIncludeWeekends),
    [cjStart, cjDays, cjIncludeWeekends]
  );

  const createJobInternal = async () => {
    if (!selectedQuote) return;
    try {
      setCjBusy(true);
      setCjError("");
      const { data: auth } = await supabase.auth.getUser();
      const user = auth?.user;
      if (!user) {
        router.replace(loginHref);
        return;
      }
      const { data: full, error } = await supabase
        .from("quotes")
        .select("*")
        .eq("id", selectedQuote.id)
        .maybeSingle();
      if (error || !full) throw error || new Error("Quote not found");

      const start = toYMD(cjStart);
      const end = toYMD(addWorkingDays(cjStart, Math.max(1, cjDays), cjIncludeWeekends));

      const ins = await supabase
        .from("jobs")
        .insert({
          user_id: user.id,
          title: full.job_summary || "Job",
          client_name: full.client_name || "Client",
          client_address: full.client_address || null,
          site_address: full.site_address || full.client_address || null,
          status: "scheduled",
          start_date: start,
          end_date: end,
          duration_days: Math.max(1, cjDays),
          include_weekends: !!cjIncludeWeekends,
          total: Number(full.total || 0),
          cost: 0,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          source_quote_id: full.id,
        })
        .select("id")
        .single();

      if (ins.error) throw ins.error;
      const jobId = ins.data.id;

      await supabase
        .from("quotes")
        .update({
          status: "accepted",
          updated_at: new Date().toISOString(),
          job_id: jobId,
        })
        .eq("id", full.id);

      setScheduleOpen(false);
      setQuotes((prev) => prev.filter((x) => x.id !== full.id));
      router.push(jobHref(jobId));
    } catch (e) {
      setCjError(e?.message || "Create job failed");
    } finally {
      setCjBusy(false);
    }
  };

  const renderCard = ({ item }) => {
    const address = item.client_address || "";
    const dispId = displayQuoteId(item);
    const isExpanded = expandedQuoteId === item.id;

    return (
      <View style={styles.cardContainer}>
        <TouchableOpacity
          onPress={() => toggleExpansion(item.id)}
          activeOpacity={0.9}
          style={[styles.card, isExpanded && styles.cardExpanded]}
        >
          <TouchableOpacity
            style={styles.binBtn}
            onPress={async () => {
              Alert.alert("Delete quote?", "This will permanently delete this quote.", [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Delete",
                  style: "destructive",
                  onPress: async () => {
                    const del = await supabase.from("quotes").delete().eq("id", item.id);
                    if (!del.error)
                      setQuotes((prev) => prev.filter((x) => x.id !== item.id));
                    else
                      Alert.alert("Delete failed", del.error.message || "Please try again.");
                  },
                },
              ]);
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
              <Text style={styles.rowMiniText}>
                {"  "}{new Date(item.created_at).toLocaleDateString()}
              </Text>
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
            style={[
              { position: "absolute", right: 46, top: 12, opacity: 0.6 },
              isExpanded && { transform: [{ rotate: "90deg" }] },
            ]}
          />
        </TouchableOpacity>

        {isExpanded && (
          <View style={styles.expandedActions}>
            <View style={styles.actionRow}>
              <TouchableOpacity
                style={[styles.actionBtn, styles.actionBtnPrimary]}
                onPress={() => {
                  setExpandedQuoteId(null);
                  router.push(quotePreviewHref(item.id));
                }}
                activeOpacity={0.9}
              >
                <Eye size={18} color="#fff" />
                <Text style={[styles.actionBtnText, { color: "#fff" }]}>View</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.actionBtn, styles.actionBtnSecondary]}
                onPress={() => {
                  setExpandedQuoteId(null);
                  setSelectedQuote(item);
                  setScheduleOpen(true);
                }}
                activeOpacity={0.9}
              >
                <CalendarPlus size={18} color={TEXT} />
                <Text style={styles.actionBtnText}>Create job</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>
    );
  };

  if (!screenReady) {
    return (
      <View style={styles.screen}>
        <StatusBar
          translucent={false}
          backgroundColor={CARD}
          barStyle="dark-content"
        />
        <SafeAreaView edges={["top"]} style={styles.headerSafe}>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>Quotes</Text>
            <View style={styles.headerRight}>
              <View style={[styles.iconBtn, { backgroundColor: '#f3f4f6' }]} />
              <View style={[styles.iconBtn, { backgroundColor: '#f3f4f6' }]} />
            </View>
          </View>
        </SafeAreaView>
        <View style={styles.searchRow}>
          <View style={{ width: 18, height: 18, backgroundColor: '#f3f4f6', borderRadius: 9 }} />
          <View style={{ flex: 1, height: 18, backgroundColor: '#f3f4f6', borderRadius: 4, marginLeft: 8 }} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      {/* Make the whole system/status bar area white */}
      <StatusBar
        translucent={false}
        backgroundColor={CARD}
        barStyle="dark-content"
      />
      <SafeAreaView edges={["top"]} style={styles.headerSafe}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Quotes</Text>
          <View style={styles.headerRight}>
            <TouchableOpacity
              style={styles.iconBtn}
              onPress={() => {
                loadQuotes();
              }}
              activeOpacity={0.9}
            >
              <RefreshCcw size={18} color={MUTED} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.iconBtn}
              onPress={() => router.push("/(app)/settings")}
              activeOpacity={0.9}
            >
              <Settings size={18} color={MUTED} />
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>

      {/* Search */}
      <View style={styles.searchRow}>
        <Search size={18} color={MUTED} style={{ marginRight: 8 }} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search client, quote number or address"
          placeholderTextColor={MUTED}
          style={styles.searchInput}
          returnKeyType="search"
          onSubmitEditing={loadQuotes}
        />
      </View>

      {/* List */}
      <FlatList
        data={quotes}
        keyExtractor={(it) => String(it.id)}
        renderItem={renderCard}
        contentContainerStyle={{
          paddingBottom: 140,
          paddingTop: 14,
          paddingHorizontal: 16,
        }}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        ListEmptyComponent={
          <View style={{ paddingTop: 40, alignItems: "center" }}>
            <PoundSterling size={28} color={MUTED} />
            <Text style={{ color: MUTED, marginTop: 8 }}>No quotes found.</Text>
          </View>
        }
      />

      {/* Create Quote FAB (bottom-right) */}
      <TouchableOpacity
        onPress={() => router.push(quoteCreateHref())}
        style={styles.fab}
        activeOpacity={0.9}
      >
        <Plus size={24} color="#fff" />
      </TouchableOpacity>

      {/* Assistant FAB (bottom-left) + Sheet */}
      <AssistantFab onPress={openAssistant} />
      <AssistantSheet
        visible={assistantOpen}
        onClose={closeAssistant}
        context="quotes"
      />

      {/* Schedule Modal */}
      <Modal visible={scheduleOpen} animationType="fade" transparent>
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => setScheduleOpen(false)}
        />
        <View style={styles.sheet}>
          <Text style={styles.sheetTitle}>Create job</Text>

          {/* Calendar */}
          <View
            style={{
              marginTop: 6,
              borderWidth: 1,
              borderColor: BORDER,
              borderRadius: 12,
              padding: 10,
              backgroundColor: "#fff",
            }}
          >
            <SharedCalendar
              month={calMonth}
              onChangeMonth={setCalMonth}
              selectedDate={cjStart}
              onSelectDate={(d) => setCjStart(atMidnight(d))}
              jobs={jobs}
              span={{ start: cjStart, days: cjDays, includeWeekends: cjIncludeWeekends }}
              blockStarts
              onDayLongPress={() => {}}
            />
          </View>

          {/* Duration */}
          <View style={styles.durationBlock}>
            <Text style={styles.controlHeader}>Duration</Text>
            <View style={styles.spinRow}>
              <TouchableOpacity
                style={styles.spinBtn}
                onPress={() => setCjDays((d) => Math.max(1, d - 1))}
              >
                <Minus size={18} color={TEXT} />
              </TouchableOpacity>
              <Text style={styles.spinValue}>
                {cjDays} day{cjDays > 1 ? "s" : ""}
              </Text>
              <TouchableOpacity
                style={styles.spinBtn}
                onPress={() => setCjDays((d) => d + 1)}
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
              onValueChange={(v) => setCjIncludeWeekends(v)}
            />
          </View>

          {/* Start/End */}
          <Text style={styles.endPreview}>
            Start: <Text style={styles.bold}>{toYMD(cjStart)}</Text>  •  End:{" "}
            <Text style={styles.bold}>{toYMD(endDate)}</Text>
          </Text>

          {!!cjError && (
            <Text style={[styles.blockedWarn, { marginTop: 6 }]}>{cjError}</Text>
          )}

          <View style={styles.sheetBtns}>
            <TouchableOpacity
              style={[styles.sheetBtn, styles.sheetBtnGhost]}
              onPress={() => setScheduleOpen(false)}
              activeOpacity={0.9}
            >
              <Text style={[styles.sheetBtnText, { color: TEXT }]}>Cancel</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.sheetBtn,
                styles.sheetBtnPrimary,
                cjBusy && { opacity: 0.55 },
              ]}
              activeOpacity={0.9}
              disabled={cjBusy}
              onPress={createJobInternal}
            >
              <CalendarPlus size={18} color="#fff" />
              <Text style={[styles.sheetBtnText, { color: "#fff" }]} numberOfLines={1}>
                {cjBusy ? "Creating..." : "Create"}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

/* ---------- styles ---------- */
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },

  headerSafe: { backgroundColor: CARD },

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
  headerTitle: { color: TEXT, fontSize: 24, fontWeight: "900" },
  headerRight: { flexDirection: "row", gap: 8 },

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
    marginTop: 10,
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

  cardContainer: { marginBottom: 10 },
  card: {
    backgroundColor: CARD,
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BORDER,
    ...Platform.select({
      ios: {
        shadowColor: "#0b1220",
        shadowOpacity: 0.12,
        shadowRadius: 18,
        shadowOffset: { width: 0, height: 10 },
      },
      android: { elevation: 6 },
    }),
    minHeight: 78,
  },
  cardExpanded: {
    borderBottomLeftRadius: 4,
    borderBottomRightRadius: 4,
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

  modalBackdrop: { flex: 1, backgroundColor: "#0009" },

  sheet: {
    position: "absolute",
    left: 16,
    right: 16,
    top: Platform.OS === "ios" ? 80 : 40,
    bottom: Platform.OS === "ios" ? 80 : 40,
    backgroundColor: CARD,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 14,
    ...Platform.select({
      ios: {
        shadowColor: "#0b1220",
        shadowOpacity: 0.14,
        shadowRadius: 20,
        shadowOffset: { width: 0, height: 12 },
      },
      android: { elevation: 8 },
    }),
  },
  sheetTitle: { fontSize: 18, fontWeight: "900", color: TEXT, marginBottom: 6 },

  durationBlock: { marginTop: 10 },
  controlHeader: { fontWeight: "900", color: TEXT, marginBottom: 6 },
  spinRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
    overflow: "hidden",
    alignSelf: "flex-start",
  },
  spinBtn: { height: 36, width: 36, alignItems: "center", justifyContent: "center" },
  spinValue: { minWidth: 96, textAlign: "center", fontWeight: "900", color: TEXT },

  weekendRow: { marginTop: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  endPreview: { marginTop: 10, color: MUTED },
  bold: { fontWeight: "900", color: TEXT },

  blockedWarn: { color: DANGER, marginTop: 6 },

  sheetBtns: { flexDirection: "row", gap: 10, marginTop: 12 },
  sheetBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  sheetBtnPrimary: { backgroundColor: BRAND, borderColor: BRAND },
  sheetBtnGhost: { backgroundColor: "#f7f8fb" },
  sheetBtnText: { fontSize: 15, fontWeight: "900" },

  expandedActions: {
    backgroundColor: CARD,
    borderWidth: 1,
    borderTopWidth: 0,
    borderColor: BORDER,
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 16,
    padding: 12,
    paddingTop: 8,
    ...Platform.select({
      ios: {
        shadowColor: "#0b1220",
        shadowOpacity: 0.12,
        shadowRadius: 18,
        shadowOffset: { width: 0, height: 10 },
      },
      android: { elevation: 6 },
    }),
  },
  actionRow: { flexDirection: "row", gap: 10 },
  actionBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  actionBtnPrimary: { backgroundColor: BRAND, borderColor: BRAND },
  actionBtnSecondary: { backgroundColor: "#f8fafc", borderColor: BORDER },
  actionBtnText: { fontSize: 15, fontWeight: "900", color: TEXT },
});