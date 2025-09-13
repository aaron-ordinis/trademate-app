// app/(app)/jobs/create.js
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
  ActivityIndicator,
  TextInput,
  Switch,
  Alert,
} from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useLocalSearchParams, useRouter } from "expo-router";
import { supabase } from "../../../lib/supabase";
import { ChevronLeft, CalendarDays, Check, X, User, PoundSterling } from "lucide-react-native";
import { jobHref, loginHref } from "../../../lib/nav";

/* Theme */
const BRAND = "#2a86ff";
const TEXT = "#0b1220";
const MUTED = "#6b7280";
const CARD = "#ffffff";
const BG = "#f5f7fb";
const BORDER = "#e6e9ee";

/* Helpers */
const pad = (n) => (n < 10 ? "0" + n : String(n));
const toYMD = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
const fromYMD = (s) => {
  const [y, m, d] = String(s || "").split("-").map((x) => parseInt(x, 10));
  if (!y || !m || !d) return new Date();
  return new Date(y, m - 1, d);
};
const money = (v = 0) =>
  "£" +
  Number(v || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

function addDaysSkippingWeekends(startDate, days, includeWeekends) {
  if (includeWeekends) {
    const d = new Date(startDate);
    d.setDate(d.getDate() + Math.max(0, days - 1));
    return d;
  }
  let remaining = Math.max(0, days - 1);
  const d = new Date(startDate);
  while (remaining > 0) {
    d.setDate(d.getDate() + 1);
    const day = d.getDay(); // 0 Sun, 6 Sat
    if (day !== 0 && day !== 6) remaining--;
  }
  return d;
}

function guessDurationDaysFromQuote(quote) {
  try {
    const jd =
      typeof quote.job_details === "string"
        ? JSON.parse(quote.job_details)
        : quote.job_details || {};
    const meta = jd?.ai_meta || jd?.meta || {};
    if (meta.days && Number(meta.days) > 0) return Math.ceil(Number(meta.days));
    const dr = meta.day_rate_calc;
    if (dr?.days != null || dr?.remainder_hours != null) {
      const d = Number(dr.days || 0);
      const remH = Number(dr.remainder_hours || 0);
      return Math.max(1, d + (remH > 0 ? 1 : 0));
    }
    if (meta.estimated_hours && jd?.profile?.hours_per_day) {
      const hours = Number(meta.estimated_hours);
      const hpd = Number(jd.profile.hours_per_day || 8);
      if (hours > 0 && hpd > 0) return Math.max(1, Math.ceil(hours / hpd));
    }
  } catch {}
  return 1;
}

export default function CreateJob() {
  const router = useRouter();
  const params = useLocalSearchParams();

  const quoteId = params?.quoteId ? String(params.quoteId) : null;
  const startParam = params?.start ? String(params.start) : null;

  // UI state
  const [loading, setLoading] = useState(!!quoteId);
  const [saving, setSaving] = useState(false);
  const [showPicker, setShowPicker] = useState(false);

  // base form fields
  const [title, setTitle] = useState("");
  const [clientName, setClientName] = useState("");
  const [total, setTotal] = useState(0);

  // scheduling
  const [startDate, setStartDate] = useState(startParam ? startParam : toYMD(new Date()));
  const [durationDays, setDurationDays] = useState("1");
  const [includeWeekends, setIncludeWeekends] = useState(false);

  const endDate = useMemo(() => {
    const d = addDaysSkippingWeekends(fromYMD(startDate), parseInt(durationDays || "1", 10), includeWeekends);
    return toYMD(d);
  }, [startDate, durationDays, includeWeekends]);

  const loadFromQuote = useCallback(async () => {
    try {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.replace(loginHref);
        return;
      }
      const { data, error } = await supabase.from("quotes").select("*").eq("id", quoteId).maybeSingle();
      if (error) throw error;
      if (!data) throw new Error("Quote not found");

      const status = String(data.status || "").toLowerCase();
      if (status === "draft") throw new Error("This quote is a draft. Generate it before creating a job.");

      setTitle(data.job_summary || "New job");
      setClientName(data.client_name || "Client");
      setTotal(Number(data.total || 0));

      const days = guessDurationDaysFromQuote(data);
      setDurationDays(String(Math.max(1, days)));
    } catch (e) {
      console.error("[JOBS][CREATE] load", e);
      Alert.alert("Alert", e.message || "Could not load the quote.");
      router.back();
    } finally {
      setLoading(false);
    }
  }, [quoteId, router]);

  useEffect(() => {
    if (quoteId) loadFromQuote();
  }, [quoteId, loadFromQuote]);

  const save = useCallback(async () => {
    try {
      if (saving) return;

      if (!title.trim()) { Alert.alert("Alert", "Please enter a job title."); return; }
      if (!startDate) { Alert.alert("Alert", "Please choose a start date."); return; }
      const dur = parseInt(durationDays || "1", 10);
      if (!Number.isFinite(dur) || dur < 1) { Alert.alert("Alert", "Duration must be at least 1 day."); return; }

      setSaving(true);

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.replace(loginHref); return; }

      // NOTE: your schema uses source_quote_id, not quote_id
      const { data, error } = await supabase
        .from("jobs")
        .insert({
          user_id: user.id,
          source_quote_id: quoteId || null,   // <-- correct column
          title: title.trim(),
          client_name: clientName.trim(),
          start_date: startDate,
          end_date: endDate,
          duration_days: dur,
          include_weekends: includeWeekends,
          total: Number(total || 0),
          cost: 0,
          status: "scheduled",
        })
        .select("id")
        .single();

      if (error) throw error;

      // Link quote to job & mark accepted (best-effort)
      if (quoteId) {
        await supabase.from("quotes").update({ job_id: data.id, status: "accepted" }).eq("id", quoteId);
      }

      // Invoke the Edge Function to copy the quote PDF and insert a doc row
      if (quoteId) {
        try {
          const { data: fnData, error: fnError } = await supabase.functions.invoke("copy-quote-pdf", {
            body: { jobId: data.id, quoteId },
          });
          if (fnError) {
            console.warn("[JOBS][CREATE] copy-quote-pdf error:", fnError.message || fnError);
          } else {
            console.log("[JOBS][CREATE] copy-quote-pdf ok:", fnData);
          }
        } catch (fnErr) {
          console.warn("[JOBS][CREATE] copy-quote-pdf invoke failed:", fnErr?.message || fnErr);
        }
      }

      router.replace(jobHref(data.id));
    } catch (e) {
      console.error("[JOBS][CREATE] save", e);
      Alert.alert("Alert", e.message || "Save failed.");
    } finally {
      setSaving(false);
    }
  }, [
    saving,
    title,
    clientName,
    startDate,
    endDate,
    durationDays,
    includeWeekends,
    total,
    quoteId,
    router,
  ]);

  if (loading) {
    return (
      <View style={[styles.screen, { alignItems: "center", justifyContent: "center" }]}>
        <ActivityIndicator color={BRAND} />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <View style={styles.topbar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn}>
          <ChevronLeft color={MUTED} />
        </TouchableOpacity>
        <Text style={styles.h1}>{quoteId ? "Create Job from Quote" : "Create Job"}</Text>
        <View style={{ width: 38 }} />
      </View>

      <View style={styles.card}>
        {quoteId ? (
          <>
            <Text style={styles.label}>From quote</Text>
            <Text style={styles.badge}>{quoteId}</Text>
          </>
        ) : null}

        <Text style={[styles.label, { marginTop: 12 }]}>Title</Text>
        <TextInput
          style={styles.input}
          value={title}
          onChangeText={setTitle}
          placeholder="Job title"
          placeholderTextColor={MUTED}
        />

        <Text style={styles.label}>Client</Text>
        <View style={styles.inline}>
          <User size={16} color={MUTED} />
          <TextInput
            style={[styles.input, { flex: 1 }]}
            value={clientName}
            onChangeText={setClientName}
            placeholder="Client name"
            placeholderTextColor={MUTED}
          />
        </View>

        <Text style={styles.label}>Start date</Text>
        <TouchableOpacity onPress={() => setShowPicker(true)} style={[styles.input, styles.dateBtn]} activeOpacity={0.9}>
          <CalendarDays size={18} color={MUTED} />
          <Text style={styles.dateText}>{startDate}</Text>
        </TouchableOpacity>
        {showPicker && (
          <DateTimePicker
            value={fromYMD(startDate)}
            mode="date"
            display={Platform.OS === "ios" ? "inline" : "default"}
            onChange={(e, d) => {
              if (Platform.OS === "android") setShowPicker(false);
              if (d) setStartDate(toYMD(d));
            }}
          />
        )}

        <View style={{ flexDirection: "row", gap: 10 }}>
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>Duration (days)</Text>
            <TextInput
              style={styles.input}
              keyboardType="number-pad"
              value={durationDays}
              onChangeText={setDurationDays}
              placeholder="1"
              placeholderTextColor={MUTED}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>End date</Text>
            <View style={[styles.input, styles.dateBtn, { opacity: 0.9 }]}>
              <CalendarDays size={18} color={MUTED} />
              <Text style={styles.dateText}>{endDate}</Text>
            </View>
          </View>
        </View>

        <View style={styles.toggleRow}>
          <Text style={[styles.label, { marginBottom: 0 }]}>Include weekends</Text>
          <Switch value={includeWeekends} onValueChange={setIncludeWeekends} />
        </View>

        <View style={styles.totalRow}>
          <PoundSterling size={18} color={MUTED} />
          <Text style={styles.totalTxt}> Total: {money(total)}</Text>
        </View>

        <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
          <TouchableOpacity onPress={() => router.back()} style={[styles.btn, { backgroundColor: "#eef2f7" }]}>
            <X color={TEXT} />
            <Text style={[styles.btnTxt, { color: TEXT }]}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={save}
            disabled={saving}
            style={[styles.btn, { backgroundColor: BRAND, flex: 1, opacity: saving ? 0.7 : 1 }]}
          >
            <Check color="#fff" />
            <Text style={[styles.btnTxt, { color: "#fff" }]}>{saving ? "Saving…" : "Create job"}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG, paddingTop: Platform.OS === "android" ? 8 : 0 },
  topbar: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  h1: { color: TEXT, fontSize: 20, fontWeight: "900" },
  iconBtn: {
    height: 38, width: 38,
    borderRadius: 10, borderWidth: 1, borderColor: BORDER,
    alignItems: "center", justifyContent: "center", backgroundColor: CARD,
  },
  card: {
    backgroundColor: CARD, borderRadius: 16, borderWidth: 1, borderColor: BORDER,
    margin: 16, padding: 16,
  },
  label: { color: MUTED, fontWeight: "800", marginBottom: 6 },
  badge: {
    alignSelf: "flex-start", backgroundColor: "#eef6ff", borderColor: "#dbeafe", borderWidth: 1,
    color: "#1e40af", fontWeight: "900", paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999,
  },
  input: {
    backgroundColor: "#f8fafc", borderColor: BORDER, borderWidth: 1, borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 12, color: TEXT, marginBottom: 10,
  },
  inline: { flexDirection: "row", alignItems: "center", gap: 8 },
  dateBtn: { flexDirection: "row", alignItems: "center", gap: 8 },
  dateText: { color: TEXT, fontWeight: "800" },
  toggleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 4, marginBottom: 2 },
  totalRow: { flexDirection: "row", alignItems: "center", marginTop: 10 },
  totalTxt: { color: TEXT, fontWeight: "900", marginLeft: 6 },
  btn: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingVertical: 12, paddingHorizontal: 14, borderRadius: 12,
    borderWidth: 1, borderColor: BORDER,
  },
  btnTxt: { fontWeight: "900" },
});