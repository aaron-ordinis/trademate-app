// app/(app)/jobs/create.js
import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Switch,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Platform,
  Alert,
  StatusBar,
  Modal,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { supabase } from "../../../lib/supabase";
import { CheckSquare, Square, Minus, Plus as PlusIcon } from "lucide-react-native";
import { Feather } from "@expo/vector-icons";
import { jobHref, loginHref } from "../../../lib/nav";
import * as Haptics from "expo-haptics";
import SharedCalendar from "../../../components/SharedCalendar";
import Constants from "expo-constants";
import TemplatePicker from "../../../components/TemplatePicker";

/* ---------- theme ---------- */
const BRAND = "#2a86ff";
const TEXT = "#0b1220";
const MUTED = "#6b7280";
const CARD = "#ffffff";
const BG = "#ffffff";
const BORDER = "#e6e9ee";

/* ---------- utils ---------- */
const money = (v = 0) =>
  "£" + Number(v || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

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

function splitQuoteItems(quote) {
  const items = flattenItems(quote?.line_items);
  const labourItems = [];
  const materialItems = [];

  items.forEach((it, idx) => {
    const type = String(it.type ?? it.kind ?? "").toLowerCase();
    const title = it.title ?? it.name ?? it.description ?? "Item";
    const qty = num(it.qty ?? it.quantity, 1);
    const unit = num(it.unit_price ?? it.price ?? it.rate, 0);
    const total = calcAmount(it);
    const ref =
      it.id || it.key || it.code || fingerprintOf(title + "|" + qty + "|" + unit + "|" + idx);
    const norm = { ref, title, qty, unit, total };

    if (type === "labour" || type === "labor" || /labou?r/i.test(type || title)) {
      labourItems.push(norm);
    } else if (type === "material" || type === "materials" || /material/i.test(type || title)) {
      materialItems.push(norm);
    }
  });

  const labourSubtotal = labourItems.reduce((s, x) => s + (x.total || 0), 0);
  return { labourSubtotal, materialItems };
}

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

/* ---------- template helpers ---------- */
const normalizeTemplateCode = (code) => {
  if (!code) return "clean-classic.html";
  let c = String(code).trim();
  c = c.replace(/\s+/g, "");
  if (!/\.html$/i.test(c)) c += ".html";
  c = c.replace(/[^A-Za-z0-9._-]/g, "");
  return c.toLowerCase();
};

/* =================== Screen =================== */
export default function CreateJobScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams();
  const quoteId = params.id;

  // Steps
  const [step, setStep] = useState(1);

  /* Deposit UI */
  const [depEnabled, setDepEnabled] = useState(false);
  const [depMaterials, setDepMaterials] = useState([]);
  const [depLabourPct, setDepLabourPct] = useState(10);
  const [depLabourSubtotal, setDepLabourSubtotal] = useState(0);
  const [depTemplateCode, setDepTemplateCode] = useState("");

  /* Scheduling */
  const [cjDays, setCjDays] = useState(1);
  const [cjIncludeWeekends, setCjIncludeWeekends] = useState(false);
  const [cjStart, setCjStart] = useState(atMidnight(new Date()));
  const [calMonth, setCalMonth] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return d;
  });
  const [jobs, setJobs] = useState([]);
  const [cjBusy, setCjBusy] = useState(false);
  const [cjError, setCjError] = useState("");

  const [quote, setQuote] = useState(null);
  const [userId, setUserId] = useState(null);
  const [loading, setLoading] = useState(true);

  /* Dynamic steps based on deposit enabled */
  const stepTitles = useMemo(() => {
    return depEnabled ? ["Deposit Options", "Deposit Template", "Schedule"] : ["Deposit Options", "Schedule"];
  }, [depEnabled]);
  const totalSteps = stepTitles.length;

  const clampStep = (n) => Math.max(1, Math.min(n, totalSteps));
  const next = () => setStep((s) => clampStep(s + 1));
  const back = () => setStep((s) => clampStep(s - 1));

  // Clamp when toggling
  useEffect(() => {
    setStep((s) => clampStep(s));
  }, [totalSteps]);

  /* Load data */
  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);

        const { data: auth } = await supabase.auth.getUser();
        const user = auth?.user;
        if (!user) {
          router.replace(loginHref);
          return;
        }
        setUserId(user.id);

        // default template from profile
        try {
          const { data: prof } = await supabase
            .from("profiles")
            .select("default_template_code")
            .eq("id", user.id)
            .maybeSingle();

          const def = normalizeTemplateCode(prof?.default_template_code || "");
          setDepTemplateCode((cur) => cur || def);
        } catch {}

        if (quoteId) {
          const { data: full } = await supabase
            .from("quotes")
            .select("*")
            .eq("id", quoteId)
            .maybeSingle();

          if (full) {
            setQuote(full);
            const sp = splitQuoteItems(full);
            setDepLabourSubtotal(sp.labourSubtotal);
            setDepMaterials((sp.materialItems || []).map((m) => ({ ...m, selected: false })));
          }
        } else {
          setQuote({ id: null, client_name: "", job_summary: "" });
        }

        // jobs for calendar
        try {
          const { data: jobsData } = await supabase
            .from("jobs")
            .select("id, title, start_date, end_date, status, include_weekends, user_id")
            .eq("user_id", user?.id || "");
          setJobs(jobsData || []);
        } catch {
          setJobs([]);
        }
      } catch (e) {
        console.warn("[CREATE_JOB] Failed to load data:", e);
        setQuote({ id: null, client_name: "", job_summary: "" });
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, [quoteId, router]);

  /* Create Job */
  const createJobInternal = async () => {
    if (!quote) return;

    try {
      setCjBusy(true);
      setCjError("");

      const { data: auth } = await supabase.auth.getUser();
      const user = auth?.user;
      if (!user) {
        router.replace(loginHref);
        return;
      }

      const start = toYMD(cjStart);
      const end = toYMD(addWorkingDays(cjStart, Math.max(1, cjDays), cjIncludeWeekends));

      let jobId = null;
      let jobCreated = false;

      try {
        const basicPayload = {
          user_id: user.id,
          title: quote.job_summary || "Job",
          status: "scheduled",
          start_date: start,
          end_date: end,
          total: Number(quote.total || 0),
        };

        const { data: basicInsert, error: basicError } = await supabase
          .from("jobs")
          .insert(basicPayload)
          .select("id")
          .single();

        if (basicError) {
          throw new Error("Job creation failed: " + basicError.message);
        }

        jobId = basicInsert.id;

        const updatePayload = {
          client_name: quote.client_name || "Client",
          client_email: quote.client_email,
          client_phone: quote.client_phone,
          client_address: quote.client_address,
          site_address: quote.site_address || quote.client_address,
          end_date_working: end,
          duration_days: Math.max(1, cjDays),
          include_weekends: !!cjIncludeWeekends,
          cost: 0,
          source_quote_id: quote.id,
          quote_id: quote.id,
        };

        const { error: updateError } = await supabase
          .from("jobs")
          .update(updatePayload)
          .eq("id", jobId);

        if (updateError) {
          console.warn("[CREATE_JOB] Update warning:", updateError.message);
        }

        jobCreated = true;
      } catch (jobError) {
        console.error("[CREATE_JOB] Job creation failed:", jobError);
        Alert.alert("Database Error", "Could not create the job: " + jobError.message);
        setCjBusy(false);
        return;
      }

      // Update quote status
      if (quote.id && jobCreated) {
        await supabase
          .from("quotes")
          .update({
            status: "accepted",
            updated_at: new Date().toISOString(),
            job_id: jobId,
          })
          .eq("id", quote.id);
      }

      // Generate deposit invoice if enabled
      if (depEnabled) {
        const selectedIds = depMaterials
          .filter((m) => m.selected)
          .map((m) => m.ref);
        const labour_percent = Math.min(100, Math.max(0, Math.floor(depLabourPct || 0)));
        const tplCode = normalizeTemplateCode(depTemplateCode || "clean-classic.html");

        const payload = {
          user_id: user.id,
          quote_id: quote.id,
          job_id: jobId,
          labour_percent,
          material_item_ids: selectedIds,
          template_code: tplCode,
        };

        const extra = Constants.expoConfig?.extra ?? Constants.manifest?.extra ?? {};
        const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || extra.SUPABASE_URL || "";
        const FUNCTIONS_URL =
          (SUPABASE_URL || "").replace(/\/$/, "") + "/functions/v1/create_deposit_invoice";

        try {
          const { data: sessRes } = await supabase.auth.getSession();
          const accessToken = sessRes?.session?.access_token;

          const authHeaders = accessToken
            ? { Authorization: "Bearer " + accessToken }
            : {
                Authorization:
                  "Bearer " +
                  (process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || extra?.SUPABASE_ANON_KEY || ""),
                apikey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || extra?.SUPABASE_ANON_KEY || "",
              };

          const res = await fetch(FUNCTIONS_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...authHeaders },
            body: JSON.stringify(payload),
          });

          const text = await res.text();
          let efData = null;
          try {
            efData = text ? JSON.parse(text) : null;
          } catch {
            efData = null;
          }

          if (!res.ok) {
            Alert.alert(
              "Partial Success",
              "Job created, but deposit invoice generation failed."
            );
            router.replace(jobHref(jobId));
            return;
          }

          if (efData && (efData.ok || efData.success)) {
            const docId = efData.documentId || efData.document_id;
            const pdfUrl = efData.signedUrl || efData.pdf_url || efData.url;

            if (docId) {
              router.replace(
                "/(app)/invoices/deposit/preview?docId=" +
                  encodeURIComponent(docId) +
                  "&jobId=" +
                  encodeURIComponent(jobId) +
                  "&name=deposit.pdf"
              );
              return;
            }

            if (pdfUrl) {
              router.replace(
                "/(app)/invoices/deposit/preview?url=" +
                  encodeURIComponent(pdfUrl) +
                  "&jobId=" +
                  encodeURIComponent(jobId) +
                  "&name=deposit.pdf"
              );
              return;
            }

            Alert.alert("Success", "Job created and deposit invoice generated!");
            router.replace(jobHref(jobId));
            return;
          } else {
            Alert.alert(
              "Partial Success",
              "Job created, but deposit invoice may not have generated."
            );
            router.replace(jobHref(jobId));
            return;
          }
        } catch (e) {
          Alert.alert(
            "Partial Success",
            "Job created, but deposit invoice generation failed."
          );
          router.replace(jobHref(jobId));
          return;
        }
      }

      // Success - no deposit invoice requested
      Alert.alert(
        "Success",
        "Job created and scheduled!\n\nStart: " + start + "\nEnd: " + end
      );
      router.replace(jobHref(jobId));
    } catch (e) {
      console.error("[CREATE_JOB] General error", e);
      setCjError(e?.message || "Create job failed");
      Alert.alert("Error", e?.message || "Could not create job. Please try again.");
    } finally {
      setCjBusy(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.screen}>
        <StatusBar barStyle="dark-content" backgroundColor="#ffffff" translucent={false} />
        <View style={{ height: insets.top, backgroundColor: CARD }} />
        <View style={styles.header}>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
            <Feather name="arrow-left" size={20} color={TEXT} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Create Job</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator size="large" color={BRAND} />
          <Text style={{ color: MUTED, marginTop: 8 }}>Loading...</Text>
        </View>
      </View>
    );
  }

  if (!quote && quoteId) {
    return (
      <View style={styles.screen}>
        <StatusBar barStyle="dark-content" backgroundColor="#ffffff" translucent={false} />
        <View style={{ height: insets.top, backgroundColor: CARD }} />
        <View style={styles.header}>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
            <Feather name="arrow-left" size={20} color={TEXT} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Create Job</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: MUTED }}>Quote not found</Text>
        </View>
      </View>
    );
  }

  const currentTitle = stepTitles[step - 1] || "";

  return (
    <View style={styles.screen}>
      <StatusBar barStyle="dark-content" backgroundColor="#ffffff" translucent={false} />
      <View style={{ height: insets.top, backgroundColor: CARD }} />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => {
            if (step > 1) back();
            else router.back();
          }}
        >
          <Feather name="arrow-left" size={20} color={TEXT} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Create Job</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Content */}
      <ScrollView style={styles.content} contentContainerStyle={styles.contentContainer}>
        {/* Step progress */}
        <View style={styles.stepProgress}>
          <View style={styles.stepRow}>
            <Text style={styles.stepTitle}>{currentTitle}</Text>
            <Text style={styles.stepCounter}>
              Step {step} of {totalSteps}
            </Text>
          </View>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: String((step / totalSteps) * 100) + "%" }]} />
          </View>
        </View>

        {/* Step 1: Deposit Options */}
        {step === 1 && (
          <>
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardTitle}>Deposit Invoice</Text>
                <InfoButton
                  title="Deposit Invoice"
                  tips={[
                    "Generate a professional deposit invoice PDF for your client.",
                    "Select which materials to include in the deposit.",
                    "Set a percentage of labour costs to include.",
                    "The deposit PDF will be saved under the job's documents.",
                  ]}
                />
              </View>

              <View style={styles.toggleRow}>
                <Text style={styles.toggleLabel}>Generate deposit invoice</Text>
                <Switch
                  value={depEnabled}
                  onValueChange={function (v) {
                    setDepEnabled(v);
                    Haptics.selectionAsync();
                  }}
                  trackColor={{ false: "#e2e8f0", true: BRAND + "40" }}
                  thumbColor={depEnabled ? BRAND : "#f1f5f9"}
                />
              </View>
            </View>

            <View style={[styles.card, !depEnabled && styles.disabledCard]}>
              <View style={styles.cardHeader}>
                <Text style={[styles.cardTitle, !depEnabled && styles.disabledText]}>Deposit Configuration</Text>
                <InfoButton
                  title="Deposit Setup"
                  tips={[
                    "Materials: Choose which materials to charge upfront.",
                    "Labour: Set percentage of labour costs to include (0-100%).",
                    "Total: Automatically calculated from your selections.",
                  ]}
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={[styles.inputLabel, !depEnabled && styles.disabledText]}>Materials to include</Text>
                <View style={styles.linkRow}>
                  <TouchableOpacity
                    disabled={!depEnabled}
                    onPress={function () {
                      setDepMaterials(function (prev) { return prev.map(function (m) { return { ...m, selected: true }; }); });
                    }}
                  >
                    <Text style={[styles.linkSm, !depEnabled && styles.disabledLink]}>Select all</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    disabled={!depEnabled}
                    onPress={function () {
                      setDepMaterials(function (prev) { return prev.map(function (m) { return { ...m, selected: false }; }); });
                    }}
                  >
                    <Text style={[styles.linkSm, !depEnabled && styles.disabledLink]}>Clear all</Text>
                  </TouchableOpacity>
                </View>
              </View>

              {depMaterials.length ? (
                <View style={styles.materialListWrap}>
                  <ScrollView style={styles.materialScrollView} showsVerticalScrollIndicator={false}>
                    {depMaterials.map(function (m, index) {
                      const Icon = m.selected ? CheckSquare : Square;
                      const isLast = index === depMaterials.length - 1;
                      return (
                        <Pressable
                          key={m.ref}
                          disabled={!depEnabled}
                          onPress={function () {
                            setDepMaterials(function (prev) {
                              return prev.map(function (x) { return x.ref === m.ref ? { ...x, selected: !x.selected } : x; });
                            });
                          }}
                          style={[
                            styles.materialRow,
                            !depEnabled && styles.disabledRow,
                            isLast && { borderBottomWidth: 0 },
                          ]}
                        >
                          <Icon size={16} color={m.selected && depEnabled ? BRAND : MUTED} />
                          <View style={styles.materialContent}>
                            <Text
                              style={[styles.materialTitle, !depEnabled && styles.disabledText]}
                              numberOfLines={1}
                            >
                              {m.title}
                            </Text>
                          </View>
                          <Text style={[styles.materialAmt, !depEnabled && styles.disabledText]}>
                            {money(m.total)}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                </View>
              ) : (
                <View style={styles.emptyState}>
                  <Text style={[styles.emptyHint, !depEnabled && styles.disabledText]}>
                    No materials found on this quote.
                  </Text>
                </View>
              )}

              <View style={styles.inputGroup}>
                <Text style={[styles.inputLabel, !depEnabled && styles.disabledText]}>
                  Labour deposit percentage
                </Text>
                <View style={[styles.counterWrap, !depEnabled && styles.disabledCounter]}>
                  <TouchableOpacity
                    style={styles.counterBtn}
                    disabled={!depEnabled}
                    onPress={function () { setDepLabourPct(function (p) { return Math.max(0, Math.floor((p || 0) - 1)); }); }}
                  >
                    <Minus size={16} color={depEnabled ? TEXT : MUTED} />
                  </TouchableOpacity>
                  <Text style={[styles.counterValue, !depEnabled && styles.disabledText]}>
                    {Math.min(100, Math.max(0, Math.floor(depLabourPct || 0)))}%
                  </Text>
                  <TouchableOpacity
                    style={styles.counterBtn}
                    disabled={!depEnabled}
                    onPress={function () { setDepLabourPct(function (p) { return Math.min(100, Math.floor((p || 0) + 1)); }); }}
                  >
                    <PlusIcon size={16} color={depEnabled ? TEXT : MUTED} />
                  </TouchableOpacity>
                </View>
                <Text style={[styles.helpText, !depEnabled && styles.disabledText]}>
                  Percentage of labour costs to include in deposit (0-100%)
                </Text>
              </View>

              <View style={styles.summaryBlock}>
                <View style={styles.summaryRow}>
                  <Text style={[styles.summaryLabel, !depEnabled && styles.disabledText]}>
                    Selected materials
                  </Text>
                  <Text style={[styles.summaryValue, !depEnabled && styles.disabledText]}>
                    {money(depMaterials.filter(function (m) { return m.selected; }).reduce(function (s, x) { return s + (x.total || 0); }, 0))}
                  </Text>
                </View>
                <View style={styles.summaryRow}>
                  <Text style={[styles.summaryLabel, !depEnabled && styles.disabledText]}>
                    Labour deposit ({Math.min(100, Math.max(0, Math.floor(depLabourPct || 0)))}%)
                  </Text>
                  <Text style={[styles.summaryValue, !depEnabled && styles.disabledText]}>
                    {money((depLabourSubtotal * (depLabourPct || 0)) / 100)}
                  </Text>
                </View>
                <View style={[styles.summaryRow, styles.summaryTotal]}>
                  <Text
                    style={[styles.summaryLabel, styles.summaryTotalText, !depEnabled && styles.disabledText]}
                  >
                    Total deposit
                  </Text>
                  <Text
                    style={[styles.summaryValue, styles.summaryTotalText, !depEnabled && styles.disabledText]}
                  >
                    {money(
                      depMaterials.filter(function (m) { return m.selected; }).reduce(function (s, x) { return s + (x.total || 0); }, 0) +
                        (depLabourSubtotal * (depLabourPct || 0)) / 100
                    )}
                  </Text>
                </View>
              </View>
            </View>
          </>
        )}

        {/* Step 2: Deposit Template (only when deposit enabled) */}
        {depEnabled && step === 2 && (
          <TemplatePicker
            kind="deposit"
            selected={depTemplateCode}
            onSelect={function (code) {
              setDepTemplateCode(normalizeTemplateCode(code));
              Haptics.selectionAsync();
            }}
          />
        )}

        {/* Final Step: Schedule */}
        {((depEnabled && step === 3) || (!depEnabled && step === 2)) && (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>Job Schedule</Text>
              <InfoButton
                title="Job Scheduling"
                tips={[
                  "Select your preferred start date on the calendar.",
                  "Choose duration in working days.",
                  "Include weekends if you work on weekends.",
                  "End date is automatically calculated.",
                  "Existing jobs are shown to help avoid conflicts.",
                ]}
              />
            </View>

            <View style={styles.calendarContainer}>
              <SharedCalendar
                month={calMonth}
                onChangeMonth={setCalMonth}
                selectedDate={cjStart}
                onSelectDate={function (d) { setCjStart(atMidnight(d)); }}
                jobs={jobs}
                span={{
                  start: cjStart,
                  days: cjDays,
                  includeWeekends: cjIncludeWeekends,
                }}
                blockStarts
                onDayLongPress={function () {}}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Duration</Text>
              <View style={styles.counterWrap}>
                <TouchableOpacity
                  style={styles.counterBtn}
                  onPress={function () { setCjDays(function (d) { return Math.max(1, d - 1); }); }}
                >
                  <Minus size={16} color={TEXT} />
                </TouchableOpacity>
                <Text style={styles.counterValue}>
                  {cjDays} {cjDays === 1 ? "day" : "days"}
                </Text>
                <TouchableOpacity
                  style={styles.counterBtn}
                  onPress={function () { setCjDays(function (d) { return d + 1; }); }}
                >
                  <PlusIcon size={16} color={TEXT} />
                </TouchableOpacity>
              </View>
              <Text style={styles.helpText}>
                Duration in working days. End date will be calculated automatically.
              </Text>
            </View>

            <View style={styles.toggleRow}>
              <Text style={styles.toggleLabel}>Include weekends</Text>
              <Switch
                value={cjIncludeWeekends}
                onValueChange={function (v) {
                  setCjIncludeWeekends(v);
                  Haptics.selectionAsync();
                }}
                trackColor={{ false: "#e2e8f0", true: BRAND + "40" }}
                thumbColor={cjIncludeWeekends ? BRAND : "#f1f5f9"}
              />
            </View>

            <View style={styles.schedulePreview}>
              <Text style={styles.previewLabel}>Schedule Summary</Text>
              <Text style={styles.previewText}>
                <Text style={styles.previewBold}>Start:</Text> {toYMD(cjStart)}
              </Text>
              <Text style={styles.previewText}>
                <Text style={styles.previewBold}>End:</Text> {toYMD(addWorkingDays(cjStart, Math.max(1, cjDays), cjIncludeWeekends))}
              </Text>
              <Text style={styles.previewText}>
                <Text style={styles.previewBold}>Duration:</Text> {cjDays} {cjDays === 1 ? "day" : "days"} {cjIncludeWeekends ? "(including weekends)" : "(working days only)"}
              </Text>
            </View>

            {cjError && (
              <View style={styles.errorContainer}>
                <Text style={styles.errorText}>{cjError}</Text>
              </View>
            )}
          </View>
        )}

        <View style={{ height: 80 }} />
      </ScrollView>

      {/* Sticky Bottom Action Bar */}
      <View style={[styles.actionBar, { paddingBottom: insets.bottom }]}>
        <TouchableOpacity
          style={[styles.actionBtn, styles.primaryActionBtn, cjBusy && { opacity: 0.55 }]}
          activeOpacity={0.9}
          disabled={cjBusy}
          onPress={step < totalSteps ? next : createJobInternal}
        >
          <Text style={[styles.actionBtnText, { color: "#ffffff" }]} numberOfLines={1}>
            {step < totalSteps ? "Continue" : cjBusy ? "Creating..." : "Create Job"}
          </Text>
        </TouchableOpacity>
      </View>

      <View style={{ height: insets.bottom, backgroundColor: "#ffffff" }} />
    </View>
  );
}

/* ---------- Info button ---------- */
function InfoButton({ title, tips = [] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <TouchableOpacity
        onPress={function () {
          Haptics.selectionAsync();
          setOpen(true);
        }}
        style={styles.infoBtn}
      >
        <Text style={{ color: MUTED, fontWeight: "900" }}>i</Text>
      </TouchableOpacity>
      <Modal visible={open} animationType="fade" transparent onRequestClose={function () { setOpen(false); }}>
        <View style={styles.modalBackdrop} />
        <View style={styles.modalWrap}>
          <View style={styles.modalCard}>
            <View style={styles.modalHead}>
              <Text style={{ color: TEXT, fontWeight: "900", fontSize: 16 }}>{title}</Text>
              <TouchableOpacity onPress={function () { setOpen(false); }} style={styles.smallBtn}>
                <Text style={styles.smallBtnText}>Close</Text>
              </TouchableOpacity>
            </View>
            {tips.slice(0, 6).map(function (t, i) {
              return (
                <View key={i} style={{ flexDirection: "row", gap: 8, marginBottom: 8 }}>
                  <Text style={{ color: BRAND, fontWeight: "900" }}>•</Text>
                  <Text style={{ color: TEXT, flex: 1 }}>{t}</Text>
                </View>
              );
            })}
          </View>
        </View>
      </Modal>
    </>
  );
}

/* ---------- styles ---------- */
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },
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
  content: { flex: 1 },
  contentContainer: { padding: 16, paddingBottom: 100 },
  stepProgress: { marginBottom: 16 },
  stepRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  stepTitle: { color: TEXT, fontWeight: "800", fontSize: 16 },
  stepCounter: { color: MUTED, fontWeight: "600", fontSize: 12 },
  progressTrack: { height: 6, backgroundColor: "#dde3ea", borderRadius: 999 },
  progressFill: { height: 6, backgroundColor: BRAND, borderRadius: 999 },
  card: {
    backgroundColor: CARD,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: BORDER,
    marginBottom: 16,
    ...Platform.select({
      ios: {
        shadowColor: "#0b1220",
        shadowOpacity: 0.06,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 4 },
      },
      android: { elevation: 3 },
    }),
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  cardTitle: { fontWeight: "900", color: TEXT, fontSize: 16 },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  toggleLabel: { fontSize: 14, fontWeight: "700", color: TEXT, flex: 1 },
  disabledCard: { opacity: 0.6 },
  inputGroup: { marginBottom: 16 },
  inputLabel: { color: TEXT, fontWeight: "700", marginBottom: 6, fontSize: 14 },
  linkRow: { flexDirection: "row", gap: 14, marginBottom: 8 },
  linkSm: { color: BRAND, fontWeight: "900", fontSize: 14 },
  disabledLink: { color: MUTED },
  disabledText: { color: MUTED },

  materialListWrap: {
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
    backgroundColor: "#fff",
    overflow: "hidden",
  },
  materialScrollView: { maxHeight: 200 },
  materialRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: BORDER,
  },
  disabledRow: { opacity: 0.6 },
  materialContent: { flex: 1, marginLeft: 12, marginRight: 12 },
  materialTitle: { color: TEXT, fontWeight: "700", fontSize: 15, marginBottom: 2 },
  materialAmt: { color: TEXT, fontWeight: "900", fontSize: 15, minWidth: 80, textAlign: "right" },

  emptyState: { paddingVertical: 20, alignItems: "center" },
  emptyHint: { color: MUTED, fontSize: 12, fontStyle: "italic" },
  counterWrap: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
    overflow: "hidden",
    alignSelf: "flex-start",
  },
  disabledCounter: { opacity: 0.6 },
  counterBtn: { height: 36, width: 36, alignItems: "center", justifyContent: "center" },
  counterValue: { minWidth: 80, textAlign: "center", fontWeight: "900", color: TEXT, fontSize: 14 },
  helpText: { color: MUTED, fontSize: 12, marginTop: 6, lineHeight: 16 },

  summaryBlock: { marginTop: 20, paddingTop: 16, borderTopWidth: 1, borderTopColor: BORDER },
  summaryRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 8 },
  summaryTotal: { paddingTop: 8, marginTop: 8, borderTopWidth: 1, borderTopColor: BORDER },
  summaryLabel: { color: TEXT, fontSize: 14 },
  summaryValue: { color: TEXT, fontWeight: "700", fontSize: 14 },
  summaryTotalText: { fontWeight: "900", fontSize: 16 },

  schedulePreview: {
    marginTop: 12,
    padding: 12,
    backgroundColor: "#f8fafc",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
  },
  previewLabel: { color: TEXT, fontWeight: "900", fontSize: 14, marginBottom: 8 },
  previewText: { color: MUTED, fontSize: 13, lineHeight: 18 },
  previewBold: { fontWeight: "700", color: TEXT },

  errorContainer: {
    marginTop: 12,
    padding: 12,
    backgroundColor: "#fef2f2",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#fecaca",
  },
  errorText: { color: "#dc2626", fontSize: 12, fontWeight: "600" },

  actionBar: {
    backgroundColor: CARD,
    borderTopWidth: 1,
    borderTopColor: BORDER,
    paddingHorizontal: 16,
    paddingTop: 12,
    flexDirection: "row",
    gap: 12,
    justifyContent: "center",
    alignItems: "center",
    ...Platform.select({
      ios: {
        shadowColor: "#0b1220",
        shadowOpacity: 0.08,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: -4 },
      },
      android: { elevation: 8 },
    }),
  },
  actionBtn: {
    flex: 1,
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: "center",
    justifyContent: "center",
    marginHorizontal: 24,
  },
  primaryActionBtn: { backgroundColor: BRAND, borderColor: BRAND },
  actionBtnText: { fontSize: 15, fontWeight: "900", color: TEXT },

  calendarContainer: {
    marginTop: 6,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
    padding: 10,
    backgroundColor: "#fff",
    marginBottom: 16,
  },

  infoBtn: {
    width: 26,
    height: 26,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f8fafc",
  },
  modalBackdrop: { position: "absolute", inset: 0, backgroundColor: "rgba(0,0,0,0.4)" },
  modalWrap: { flex: 1, justifyContent: "center", alignItems: "center", padding: 16 },
  modalCard: {
    backgroundColor: CARD,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: BORDER,
    width: "92%",
    maxWidth: 480,
    ...Platform.select({
      ios: { shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 16, shadowOffset: { width: 0, height: 6 } },
      android: { elevation: 10 },
    }),
  },
  modalHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  smallBtn: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8, backgroundColor: "#f3f4f6" },
  smallBtnText: { color: TEXT, fontWeight: "700", fontSize: 12 },
});