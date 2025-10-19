// app/(app)/jobs/index.js
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Platform,
  TouchableOpacity,
  FlatList,
  ScrollView,
  RefreshControl,
  Alert,
  TextInput,
  StatusBar,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { supabase } from "../../../../lib/supabase";
import {
  List as ListIcon,
  Calendar as CalendarIcon,
  Settings,
  MapPin,
  RefreshCcw,
  Trash2,
  CalendarDays,
  Search,
  Eye,
  PoundSterling,
} from "lucide-react-native";
import { jobHref, jobCreateHref } from "../../../../lib/nav";
import SharedCalendar from "../../../../components/SharedCalendar.js";

/* --- AI assistant --- */
import AssistantFab from "../../../../components/AssistantFab";
import AssistantSheet from "../../../../components/AssistantSheet";

/* Theme */
const BG = "#f5f7fb";
const CARD = "#ffffff";
const TEXT = "#0b1220";
const MUTED = "#6b7280";
const BORDER = "#e6e9ee";
const BRAND = "#2a86ff";

/* Logger */
function log(tag, data) {
  try { console.log("[jobs.index]", tag, data || {}); } catch {}
}

/* Helpers */
const money = (v = 0) =>
  "£" + Number(v || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

export default function JobsIndex() {
  const router = useRouter();

  const [mode, setMode] = useState("list");
  const [refreshing, setRefreshing] = useState(false);
  const [jobs, setJobs] = useState([]);
  const [month, setMonth] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return d;
  });
  const [activeDate, setActiveDate] = useState(new Date());
  const [query, setQuery] = useState("");
  const [expandedJobId, setExpandedJobId] = useState(null);
  const [dataLoaded, setDataLoaded] = useState(false);

  /* --- AI assistant state --- */
  const [assistantOpen, setAssistantOpen] = useState(false);
  const openAssistant = () => {
    if (assistantOpen) return;
    setAssistantOpen(true);
    log("assistant.open", { screen: "jobs" });
  };
  const closeAssistant = () => {
    setAssistantOpen(false);
    log("assistant.close", { screen: "jobs" });
  };

  // soft haptics (optional)
  const haptic = useRef(null);
  useEffect(() => {
    (async () => {
      try {
        const m = await import("expo-haptics");
        haptic.current = m;
      } catch {}
    })();
  }, []);
  const buzz = () => haptic.current?.selectionAsync?.();

  const sortByStart = (arr) =>
    [...arr].sort(
      (a, b) => new Date(a.start_date || 0) - new Date(b.start_date || 0)
    );

  const load = useCallback(async () => {
    try {
      log("load.start");
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setJobs([]);
        setDataLoaded(true);
        log("load.no_user");
        return;
      }
      const { data: jobsRaw, error } = await supabase
        .from("jobs")
        .select(
          "id, title, client_name, client_address, site_address, start_date, end_date, total, include_weekends, user_id"
        )
        .eq("user_id", user.id)
        .order("start_date", { ascending: true });
      if (error) throw error;
      setJobs(sortByStart(jobsRaw || []));
      setDataLoaded(true);
      log("load.ok", { count: (jobsRaw || []).length });
    } catch (e) {
      console.error("[jobs] load", e);
      setDataLoaded(true);
      log("load.error", { msg: String(e && e.message ? e.message : e) });
    } finally {
      setRefreshing(false);
      log("load.end");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load();
  }, [load]);

  /* Delete */
  const requestDeleteJob = (job) => {
    Alert.alert("Delete job?", "This will delete this job and its data.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            const prevJobs = jobs;
            setJobs(prevJobs.filter((j) => j.id !== job.id));

            const del = await supabase.from("jobs").delete().eq("id", job.id);
            if (del.error) {
              setJobs(prevJobs);
              throw del.error;
            }
          } catch (e) {
            Alert.alert("Error", e.message);
          }
        },
      },
    ]);
  };

  const toggleExpansion = (jobId) => {
    setExpandedJobId((prev) => (prev === jobId ? null : jobId));
  };

  const renderCard = ({ item }) => {
    const address = item.site_address || item.client_address || "";
    const date = item.start_date
      ? new Date(item.start_date).toLocaleDateString()
      : "No date";
    const isExpanded = expandedJobId === item.id;

    return (
      <View style={st.cardContainer}>
        <TouchableOpacity
          style={[st.card, isExpanded && st.cardExpanded]}
          activeOpacity={0.9}
          onPress={() => toggleExpansion(item.id)}
        >
          <TouchableOpacity
            style={st.binBtn}
            onPress={() => requestDeleteJob(item)}
            activeOpacity={0.85}
          >
            <Trash2 size={18} color="#b91c1c" />
          </TouchableOpacity>

          <View style={{ flexShrink: 1, paddingRight: 110 }}>
            <Text style={st.clientTitle} numberOfLines={1}>
              {item.client_name || "Client"}
            </Text>
            <View style={st.rowMini}>
              <CalendarDays size={16} color={MUTED} />
              <Text style={st.rowMiniText} numberOfLines={1}>
                {"  "}
                {date}
              </Text>
            </View>
            {!!address && (
              <View style={st.rowMini}>
                <MapPin size={16} color={MUTED} />
                <Text
                  style={[st.rowMiniText, { flexShrink: 1 }]}
                  numberOfLines={1}
                >
                  {"  "}
                  {address}
                </Text>
              </View>
            )}
          </View>

          <Text style={st.totalBottom}>{money(item.total || 0)}</Text>
        </TouchableOpacity>

        {isExpanded && (
          <View style={st.expandedActions}>
            <View style={st.actionRow}>
              <TouchableOpacity
                style={[st.actionBtn, st.actionBtnPrimary]}
                onPress={() => {
                  setExpandedJobId(null);
                  router.push(jobHref(item.id));
                }}
                activeOpacity={0.9}
              >
                <Eye size={18} color="#fff" />
                <Text style={[st.actionBtnText, { color: "#fff" }]}>View</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[st.actionBtn, st.actionBtnSecondary]}
                onPress={() => {
                  setExpandedJobId(null);
                  router.push("/(app)/invoices/wizard?job_id=" + item.id);
                }}
                activeOpacity={0.9}
              >
                <PoundSterling size={18} color={TEXT} />
                <Text style={st.actionBtnText}>Invoice</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>
    );
  };

  const filteredJobs = useMemo(() => {
    const t = query.trim().toLowerCase();
    if (!t) return jobs;
    return jobs.filter((j) => {
      const hay =
        (j.title || "") +
        " " +
        (j.client_name || "") +
        " " +
        (j.client_address || "") +
        " " +
        (j.site_address || "");
      return hay.toLowerCase().includes(t);
    });
  }, [jobs, query]);

  if (!dataLoaded) {
    return (
      <View style={st.screen}>
        <StatusBar barStyle="dark-content" backgroundColor="#ffffff" />
        <SafeAreaView edges={["top"]} style={st.headerSafe}>
          <View style={st.header}>
            <Text style={st.headerTitle}>Jobs</Text>
            <View style={st.headerRight}>
              <View style={[st.iconBtn, { backgroundColor: "#f3f4f6" }]} />
              <View style={[st.iconBtn, { backgroundColor: "#f3f4f6" }]} />
              <View style={[st.iconBtn, { backgroundColor: "#f3f4f6" }]} />
            </View>
          </View>
        </SafeAreaView>
        <View style={st.searchRow}>
          <View style={{ width: 18, height: 18, backgroundColor: "#f3f4f6", borderRadius: 9 }} />
          <View style={{ flex: 1, height: 18, backgroundColor: "#f3f4f6", borderRadius: 4, marginLeft: 8 }} />
        </View>
      </View>
    );
  }

  const right = (
    <View style={{ flexDirection: "row", gap: 8 }}>
      <TouchableOpacity
        style={st.iconBtn}
        onPress={onRefresh}
        activeOpacity={0.9}
      >
        <RefreshCcw size={18} color={MUTED} />
      </TouchableOpacity>
      <TouchableOpacity
        style={st.iconBtn}
        onPress={() => {
          setMode((m) => (m === "list" ? "calendar" : "list"));
          buzz();
          log("mode.toggle", { mode: mode === "list" ? "calendar" : "list" });
        }}
        activeOpacity={0.9}
      >
        {mode === "list" ? (
          <CalendarIcon size={18} color={MUTED} />
        ) : (
          <ListIcon size={18} color={MUTED} />
        )}
      </TouchableOpacity>
      <TouchableOpacity
        style={st.iconBtn}
        onPress={() => router.push("/(app)/settings")}
        activeOpacity={0.9}
      >
        <Settings size={18} color={MUTED} />
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={st.screen}>
      {/* White header including status bar — matches Quotes exactly */}
      <StatusBar barStyle="dark-content" backgroundColor="#ffffff" />
      <SafeAreaView edges={["top"]} style={st.headerSafe}>
        <View style={st.header}>
          <Text style={st.headerTitle}>Jobs</Text>
          <View style={st.headerRight}>{right}</View>
        </View>
      </SafeAreaView>

      {mode === "list" ? (
        <>
          <View style={st.searchRow}>
            <Search size={18} color={MUTED} style={{ marginRight: 8 }} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search client, job or address"
              placeholderTextColor={MUTED}
              style={st.searchInput}
              returnKeyType="search"
            />
          </View>

          <FlatList
            data={filteredJobs}
            keyExtractor={(it) => String(it.id)}
            contentContainerStyle={{
              paddingBottom: 140,
              paddingTop: 14,
              paddingHorizontal: 16,
            }}
            renderItem={renderCard}
            ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
            }
            ListEmptyComponent={
              <Text
                style={{
                  color: MUTED,
                  textAlign: "center",
                  marginTop: 28,
                  fontWeight: "800",
                }}
              >
                No jobs found.
              </Text>
            }
          />
        </>
      ) : (
        <ScrollView
          style={{ paddingHorizontal: 12 }}
          contentContainerStyle={{ paddingBottom: 12 }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
        >
          <View style={st.calCard}>
            <SharedCalendar
              month={month}
              onChangeMonth={setMonth}
              selectedDate={activeDate}
              onSelectDate={(d) => {
                setActiveDate(d);
                buzz();
              }}
              jobs={jobs}
              onDayLongPress={(day) => {
                const iso = new Date(
                  day.getFullYear(),
                  day.getMonth(),
                  day.getDate()
                )
                  .toISOString()
                  .split("T")[0];
                router.push({ pathname: jobCreateHref, params: { start: iso } });
              }}
            />
          </View>
          <View style={{ height: 96 }} />
        </ScrollView>
      )}

      {/* AI Assistant FAB (bottom-left) + sheet */}
      <AssistantFab onPress={openAssistant} />
      <AssistantSheet
        visible={assistantOpen}
        onClose={closeAssistant}
        context="jobs"
      />
    </View>
  );
}

const st = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },

  // Header wrapper to ensure status bar + header are pure white
  headerSafe: { backgroundColor: "#ffffff" },

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

  /* Search */
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

  /* List card */
  cardContainer: { marginBottom: 10 },
  card: {
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 16,
    padding: 14,
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
  cardExpanded: { borderBottomLeftRadius: 4, borderBottomRightRadius: 4 },
  binBtn: {
    position: "absolute",
    right: 12,
    top: 12,
    height: 36,
    width: 36,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fee2e2",
    borderWidth: 1,
    borderColor: "#fecaca",
    zIndex: 5,
  },
  clientTitle: { color: TEXT, fontWeight: "900", fontSize: 16 },
  rowMini: { flexDirection: "row", alignItems: "center", marginTop: 6 },
  rowMiniText: { color: MUTED },
  totalBottom: {
    position: "absolute",
    right: 16,
    bottom: 12,
    fontSize: 16,
    fontWeight: "900",
    color: TEXT,
  },

  /* Calendar card */
  calCard: {
    backgroundColor: CARD,
    borderRadius: 18,
    padding: 12,
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
    marginTop: 12,
  },

  /* Expanded actions */
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