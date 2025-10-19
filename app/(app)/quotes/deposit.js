import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from "../../../lib/supabase";
import {
  Eye,
  CalendarPlus,
  CheckSquare,
  Square,
  Minus,
  Plus as PlusIcon,
  ArrowLeft,
  Info,
} from "lucide-react-native";
import { Feather } from "@expo/vector-icons";
import { quotePreviewHref, jobHref, loginHref } from "../../../lib/nav";
import * as Haptics from "expo-haptics";
import SharedCalendar from "../../../components/SharedCalendar";

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
      it.id || it.key || it.code || fingerprintOf(`${title}|${qty}|${unit}|${idx}`);
    const norm = { ref, title, qty, unit, total };

    if (
      type === "labour" ||
      type === "labor" ||
      /labou?r/i.test(type || title)
    ) {
      labourItems.push(norm);
    } else if (
      type === "material" ||
      type === "materials" ||
      /material/i.test(type || title)
    ) {
      materialItems.push(norm);
    }
  });

  const labourSubtotal = labourItems.reduce((s, x) => s + (x.total || 0), 0);
  return { labourSubtotal, materialItems };
}

const buildExpenseRows = ({ quote, jobId, userId, dateISO }) => {
  const items = flattenItems(quote?.line_items);
  const quoteId = quote?.id ?? quote?.source_quote_id ?? null;
  const rows = [];

  items.forEach((it, idx) => {
    const type = String(it.type ?? it.kind ?? "").toLowerCase();
    if (type === "labour" || type === "labor") return;

    const amount = calcAmount(it);
    if (!(amount > 0)) return;

    const title = it.title ?? it.name ?? it.description ?? "Expense";
    const base =
      userId +
      "|" +
      jobId +
      "|" +
      (quoteId || "noquote") +
      "|" +
      title +
      "|" +
      amount.toFixed(2) +
      "|" +
      idx;
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

const TOTAL_STEPS = 2;
const STEP_TITLES = ["Deposit Options", "Schedule"];

/** conflict detection */
const hasConflictWith = (startDate, days, includeWeekends, jobs) => {
  const start = atMidnight(startDate);
  const end = addWorkingDays(start, Math.max(1, days), includeWeekends);
  
  return jobs.some(job => {
    const jobStart = job.start_date ? atMidnight(new Date(job.start_date)) : null;
    const jobEnd = job.end_date ? atMidnight(new Date(job.end_date)) : jobStart;
    if (!jobStart) return false;
    
    // Check if date ranges overlap
    return start <= jobEnd && end >= jobStart;
  });
};

/** find next available slot */
const findNextAvailableSlot = (startDate, days, includeWeekends, jobs, maxDaysToCheck = 90) => {
  let candidate = atMidnight(startDate);
  let attempts = 0;
  
  while (attempts < maxDaysToCheck) {
    if (!hasConflictWith(candidate, days, includeWeekends, jobs)) {
      return candidate;
    }
    candidate = new Date(candidate);
    candidate.setDate(candidate.getDate() + 1);
    attempts++;
  }
  
  return null; // No slot found within reasonable time
};

export default function DepositScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams();
  const quoteId = params.id;

  // Steps
  const [step, setStep] = useState(1);
  const next = () => setStep((s) => { 
    const n = Math.min(s + 1, TOTAL_STEPS); 
    if (n !== s) Haptics.selectionAsync(); 
    return n; 
  });
  const back = () => setStep((s) => { 
    const n = Math.max(s - 1, 1); 
    if (n !== s) Haptics.selectionAsync(); 
    return n; 
  });

  const [loading, setLoading] = useState(true);
  const [quote, setQuote] = useState(null);
  const [userId, setUserId] = useState(null);
  const [jobs, setJobs] = useState([]);

  /* Deposit UI - same state as modal */
  const [depEnabled, setDepEnabled] = useState(false);
  const [depMaterials, setDepMaterials] = useState([]); // {ref,title,qty,unit,total,selected}
  const [depLabourPct, setDepLabourPct] = useState(10);
  const [depLabourSubtotal, setDepLabourSubtotal] = useState(0);

  /* Scheduling - same as modal */
  const [cjDays, setCjDays] = useState(1);
  const [cjIncludeWeekends, setCjIncludeWeekends] = useState(false);
  const [cjStart, setCjStart] = useState(atMidnight(new Date()));
  const [cjBusy, setCjBusy] = useState(false);
  const [cjError, setCjError] = useState("");

  /* Calendar state */
  const [calMonth, setCalMonth] = useState(new Date());
  const [showConflictWarning, setShowConflictWarning] = useState(false);
  const [inlineJobDetails, setInlineJobDetails] = useState(null);

  /* Tooltip state */
  const [showTooltip, setShowTooltip] = useState(false);

  /* Haptics (soft) */
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

  /* Load data - same logic as modal */
  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      try {
        const { data: auth } = await supabase.auth.getUser();
        const user = auth?.user;
        if (!user) {
          router.replace(loginHref);
          return;
        }
        setUserId(user.id);

        const { data: full } = await supabase
          .from("quotes")
          .select("*")
          .eq("id", quoteId)
          .maybeSingle();

        if (full) {
          setQuote(full);
          const { labourSubtotal, materialItems } = splitQuoteItems(full);
          setDepLabourSubtotal(labourSubtotal);
          setDepMaterials((materialItems || []).map((m) => ({ ...m, selected: false })));
        }

        // Load jobs for scheduling
        const { data: jobsData } = await supabase
          .from("jobs")
          .select("id, title, start_date, end_date, status, include_weekends, user_id")
          .eq("user_id", user.id);
        setJobs(jobsData || []);
      } finally {
        setLoading(false);
      }
    };

    if (quoteId) loadData();
  }, [quoteId, router]);

  /* Create Job flow - same logic as modal */
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

      console.log("[CREATE_JOB] inserting job…", { start, end, cjDays, cjIncludeWeekends });

      // Create job
      const ins = await supabase
        .from("jobs")
        .insert({
          user_id: user.id,
          title: quote.job_summary || "Job",
          client_name: quote.client_name || "Client",
          client_address: quote.client_address || null,
          site_address: quote.site_address || quote.client_address || null,
          status: "scheduled",
          start_date: start,
          end_date: end,
          duration_days: Math.max(1, cjDays),
          include_weekends: !!cjIncludeWeekends,
          total: Number(quote.total || 0),
          cost: 0,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          source_quote_id: quote.id,
        })
        .select("id")
        .single();

      if (ins.error) throw ins.error;
      const jobId = ins.data.id;
      console.log("[CREATE_JOB] job inserted:", jobId);

      // Expenses for materials
      const expenseRows = buildExpenseRows({
        quote: quote,
        jobId,
        userId: user.id,
        dateISO: start,
      });
      if (expenseRows.length) {
        const exIns = await supabase.from("expenses").insert(expenseRows);
        if (exIns.error) console.warn("[CREATE_JOB] expenses insert failed", exIns.error);
        else console.log("[CREATE_JOB] expenses inserted:", expenseRows.length);
      }

      // Link quote → job
      const upQ = await supabase
        .from("quotes")
        .update({
          status: "accepted",
          updated_at: new Date().toISOString(),
          job_id: jobId,
        })
        .eq("id", quote.id);
      if (upQ.error) console.warn("[CREATE_JOB] link quote->job failed", upQ.error);
      else console.log("[CREATE_JOB] quote linked to job:", jobId);

      if (depEnabled) {
        // Call Edge Function to create deposit PDF -> documents + jobdocs
        try {
          const material_item_ids = depMaterials.filter((m) => m.selected).map((m) => m.ref);
          const labour_percent = Math.min(100, Math.max(0, Math.floor(depLabourPct || 0)));
          const idempotency_key = `dep|${user.id}|${quote.id}|job:${jobId}|${material_item_ids.slice().sort().join(",")}|${labour_percent}`;

          const payload = {
            user_id: user.id,
            quote_id: quote.id,
            job_id: jobId, // critical
            labour_percent,
            material_item_ids,
            idempotency_key,
          };
          console.log("[DEPOSIT] invoke payload:", payload);

          const { data: efData, error: efError } = await supabase.functions.invoke(
            "create_deposit_invoice",
            { body: payload }
          );

          if (efError) {
            console.warn("[DEPOSIT] EF network error", efError);
            // Continue to job page even if deposit fails
            router.replace(jobHref(jobId));
            return;
          }

          console.log("[DEPOSIT] EF response:", JSON.stringify(efData, null, 2));
          
          if (efData?.ok || efData?.success) {
            // Try multiple navigation strategies based on response format
            let navigated = false;

            // Strategy 1: Direct document ID
            if ((efData.document_id || efData.documentId) && (efData.document_id || efData.documentId) !== 'undefined') {
              const docId = efData.document_id || efData.documentId;
              console.log("[DEPOSIT] Navigating with document_id:", docId);
              router.replace(`/(app)/invoices/deposit/preview?docId=${encodeURIComponent(docId)}&jobId=${encodeURIComponent(jobId)}&name=deposit.pdf`);
              navigated = true;
            }
            // Strategy 2: Direct PDF URL
            else if ((efData.pdf_url || efData.pdfUrl || efData.url) && (efData.pdf_url || efData.pdfUrl || efData.url) !== 'undefined') {
              const pdfUrl = efData.pdf_url || efData.pdfUrl || efData.url;
              console.log("[DEPOSIT] Navigating with pdf_url:", pdfUrl);
              router.replace(`/(app)/invoices/deposit/preview?url=${encodeURIComponent(pdfUrl)}&jobId=${encodeURIComponent(jobId)}&name=deposit.pdf`);
              navigated = true;
            }
            // Strategy 3: Signed URL
            else if ((efData.signed_url || efData.signedUrl) && (efData.signed_url || efData.signedUrl) !== 'undefined') {
              const signedUrl = efData.signed_url || efData.signedUrl;
              console.log("[DEPOSIT] Navigating with signed_url:", signedUrl);
              router.replace(`/(app)/invoices/deposit/preview?url=${encodeURIComponent(signedUrl)}&jobId=${encodeURIComponent(jobId)}&name=deposit.pdf`);
              navigated = true;
            }
            // Strategy 4: Check documents table by job_id with a slight delay
            else {
              console.log("[DEPOSIT] No direct URL, checking documents table after delay...");
              setTimeout(async () => {
                try {
                  const { data: docCheck, error: docCheckError } = await supabase
                    .from("documents")
                    .select("id, url, name")
                    .eq("job_id", jobId)
                    .eq("kind", "invoice_pdf")
                    .order("created_at", { ascending: false })
                    .limit(1)
                    .maybeSingle();
                  
                  console.log("[DEPOSIT] Documents check result:", { data: docCheck, error: docCheckError });
                  
                  if (!docCheckError && docCheck) {
                    if (docCheck.id) {
                      console.log("[DEPOSIT] Found document, navigating with ID:", docCheck.id);
                      router.replace(`/(app)/invoices/deposit/preview?docId=${encodeURIComponent(docCheck.id)}&jobId=${encodeURIComponent(jobId)}&name=${encodeURIComponent(docCheck.name || 'deposit.pdf')}`);
                      return;
                    } else if (docCheck.url) {
                      console.log("[DEPOSIT] Found document, navigating with URL:", docCheck.url);
                      router.replace(`/(app)/invoices/deposit/preview?url=${encodeURIComponent(docCheck.url)}&jobId=${encodeURIComponent(jobId)}&name=${encodeURIComponent(docCheck.name || 'deposit.pdf')}`);
                      return;
                    }
                  }
                  
                  // If still no document found, navigate to job page
                  console.warn("[DEPOSIT] No document found after delay, navigating to job");
                  router.replace(jobHref(jobId));
                } catch (e) {
                  console.error("[DEPOSIT] Error checking documents table:", e);
                  router.replace(jobHref(jobId));
                }
              }, 2000); // 2 second delay to allow document creation
              
              // Don't return here, let the timeout handle navigation
            }

            // If we haven't navigated by now and no timeout was set, go to job
            if (!navigated && !(efData.document_id || efData.documentId || efData.pdf_url || efData.pdfUrl || efData.url || efData.signed_url || efData.signedUrl)) {
              console.warn("[DEPOSIT] No valid document reference and no fallback, navigating to job");
              router.replace(jobHref(jobId));
            }
            
            return;
          } else {
            console.warn("[DEPOSIT] EF returned not ok", efData);
            // Continue to job page if deposit creation failed
          }
        } catch (ef) {
          console.warn("[DEPOSIT] EF exception", ef?.message || ef);
          // Continue to job page if deposit creation failed
        }
      }

      // Default route: job page
      router.replace(jobHref(jobId));
    } catch (e) {
      console.warn("[CREATE_JOB] error", e);
      setCjError(e?.message || "Create job failed");
    } finally {
      setCjBusy(false);
    }
  };

  // Calendar span for visualizing the selected job duration
  const calSpan = useMemo(() => ({
    start: cjStart,
    days: cjDays,
    includeWeekends: cjIncludeWeekends,
  }), [cjStart, cjDays, cjIncludeWeekends]);

  // Check for conflicts with current selection
  const hasConflict = useMemo(() => {
    if (!cjStart || !cjDays) return false;
    return hasConflictWith(cjStart, cjDays, cjIncludeWeekends, jobs);
  }, [cjStart, cjDays, cjIncludeWeekends, jobs]);

  // Auto-adjustment effect
  useEffect(() => {
    if (!cjStart || !hasConflict) return;
    setShowConflictWarning(true);
  }, [cjStart, hasConflict]);

  // Auto-calculation: When duration or weekend settings change, find next available slot
  useEffect(() => {
    if (!cjStart || !hasConflict) return;
    
    const nextSlot = findNextAvailableSlot(cjStart, cjDays, cjIncludeWeekends, jobs);
    if (nextSlot && nextSlot.getTime() !== cjStart.getTime()) {
      setCjStart(nextSlot);
      setShowConflictWarning(false);
      Haptics.selectionAsync();
    }
  }, [cjDays, cjIncludeWeekends]); // Only trigger on duration/weekend changes, not date changes

  // Find next available slot
  const findNextSlot = useCallback(() => {
    if (!cjStart) return;
    
    const nextSlot = findNextAvailableSlot(cjStart, cjDays, cjIncludeWeekends, jobs);
    if (nextSlot) {
      setCjStart(nextSlot);
      setShowConflictWarning(false);
      Haptics.selectionAsync();
    }
  }, [cjStart, cjDays, cjIncludeWeekends, jobs]);

  // Smart date selection handler
  const handleDateSelect = useCallback((date) => {
    const wouldHaveConflict = hasConflictWith(date, cjDays, cjIncludeWeekends, jobs);
    
    if (wouldHaveConflict) {
      // Try to find next available slot starting from selected date
      const nextSlot = findNextAvailableSlot(date, cjDays, cjIncludeWeekends, jobs);
      if (nextSlot) {
        setCjStart(nextSlot);
        setShowConflictWarning(false);
      } else {
        // No available slot found, still select but show warning
        setCjStart(date);
        setShowConflictWarning(true);
      }
    } else {
      setCjStart(date);
      setShowConflictWarning(false);
    }
    Haptics.selectionAsync();
  }, [cjDays, cjIncludeWeekends, jobs]);

  // Enhanced day long press handler
  const handleDayLongPress = useCallback((day, jobsOnDay) => {
    if (jobsOnDay.length > 0) {
      // Show inline job details instead of alert
      setInlineJobDetails({
        date: day,
        jobs: jobsOnDay
      });
    }
  }, []);

  if (loading) {
    return (
      <View style={styles.screen}>
        <View style={{ height: insets.top, backgroundColor: CARD }} />
        <View style={styles.header}>
          <TouchableOpacity style={styles.backBtn} onPress={() => {
            if (step > 1) {
              back();
            } else {
              router.back();
            }
          }}>
            <Feather name="arrow-left" size={20} color={TEXT} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Create Job</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={BRAND} />
        </View>
      </View>
    );
  }

  if (!quote) {
    return (
      <View style={styles.screen}>
        <View style={{ height: insets.top, backgroundColor: CARD }} />
        <View style={styles.header}>
          <TouchableOpacity style={styles.backBtn} onPress={() => {
            if (step > 1) {
              back();
            } else {
              router.back();
            }
          }}>
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

  return (
    <View style={styles.screen}>
      {/* Safe area top */}
      <View style={{ height: insets.top, backgroundColor: CARD }} />
      
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => {
          if (step > 1) {
            back();
          } else {
            router.back();
          }
        }}>
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
            <Text style={styles.stepTitle}>{STEP_TITLES[step - 1]}</Text>
            <Text style={styles.stepCounter}>Step {step} of {TOTAL_STEPS}</Text>
          </View>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${(step / TOTAL_STEPS) * 100}%` }]} />
          </View>
        </View>

        {/* Step 1: Deposit Options */}
        {step === 1 && (
          <>
            {/* Primary toggle with tooltip */}
            <View style={styles.card}>
              <View style={styles.toggleRow}>
                <View style={styles.toggleLabelRow}>
                  <Text style={styles.toggleLabel}>Generate a deposit invoice</Text>
                  <TouchableOpacity 
                    style={styles.infoBtn}
                    onPress={() => setShowTooltip(!showTooltip)}
                  >
                    <Info size={16} color={MUTED} />
                  </TouchableOpacity>
                </View>
                <Switch 
                  value={depEnabled} 
                  onValueChange={(v) => { 
                    setDepEnabled(v); 
                    Haptics.selectionAsync(); 
                    if (showTooltip) setShowTooltip(false);
                  }} 
                />
              </View>
              
              {showTooltip && (
                <View style={styles.tooltip}>
                  <Text style={styles.tooltipText}>
                    When enabled, a deposit PDF will be generated on Create and saved under the job's documents.
                  </Text>
                </View>
              )}
            </View>

            {/* Deposit configuration - always visible */}
            <View style={[styles.depositCard, !depEnabled && styles.disabledCard]}>
              <Text style={[styles.depositTitle, !depEnabled && styles.disabledText]}>
                Deposit details
              </Text>

              {/* Materials chooser */}
              <View style={styles.sectionRow}>
                <Text style={[styles.sectionLabel, !depEnabled && styles.disabledText]}>
                  Materials to include
                </Text>
                <View style={styles.linkRow}>
                  <TouchableOpacity 
                    disabled={!depEnabled}
                    onPress={() => setDepMaterials((prev) => prev.map((m) => ({ ...m, selected: true })))}
                  >
                    <Text style={[styles.linkSm, !depEnabled && styles.disabledLink]}>
                      Select all
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity 
                    disabled={!depEnabled}
                    onPress={() => setDepMaterials((prev) => prev.map((m) => ({ ...m, selected: false })))}
                  >
                    <Text style={[styles.linkSm, !depEnabled && styles.disabledLink]}>
                      Clear
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>

              {depMaterials.length ? (
                <View style={styles.materialListWrap}>
                  <ScrollView style={{ maxHeight: 200 }}>
                    {depMaterials.map((m) => {
                      const Icon = m.selected ? CheckSquare : Square;
                      return (
                        <Pressable
                          key={m.ref}
                          disabled={!depEnabled}
                          onPress={() =>
                            setDepMaterials((prev) =>
                              prev.map((x) => (x.ref === m.ref ? { ...x, selected: !x.selected } : x))
                            )
                          }
                          style={[styles.materialRow, !depEnabled && styles.disabledRow]}
                        >
                          <Icon size={18} color={m.selected && depEnabled ? BRAND : MUTED} />
                          <View style={{ flex: 1, marginLeft: 8 }}>
                            <Text style={[styles.materialTitle, !depEnabled && styles.disabledText]} numberOfLines={1}>
                              {m.title}
                            </Text>
                            <Text style={[styles.materialSub, !depEnabled && styles.disabledText]} numberOfLines={1}>
                              {m.qty} × {money(m.unit)}
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
                <Text style={[styles.emptyHint, !depEnabled && styles.disabledText]}>
                  No materials on this quote.
                </Text>
              )}

              {/* Labour percent */}
              <View style={[styles.sectionRow, { marginTop: 12 }]}>
                <Text style={[styles.sectionLabel, !depEnabled && styles.disabledText]}>
                  Labour deposit (%)
                </Text>
                <View style={[styles.counterWrap, !depEnabled && styles.disabledCounter]}>
                  <TouchableOpacity
                    style={styles.counterBtn}
                    disabled={!depEnabled}
                    onPress={() =>
                      setDepLabourPct((p) => Math.max(0, Math.floor((p || 0) - 1)))
                    }
                  >
                    <Minus size={16} color={depEnabled ? TEXT : MUTED} />
                  </TouchableOpacity>
                  <Text style={[styles.counterValue, !depEnabled && styles.disabledText]}>
                    {Math.min(100, Math.max(0, Math.floor(depLabourPct || 0)))}%
                  </Text>
                  <TouchableOpacity
                    style={styles.counterBtn}
                    disabled={!depEnabled}
                    onPress={() =>
                      setDepLabourPct((p) => Math.min(100, Math.floor((p || 0) + 1)))
                    }
                  >
                    <PlusIcon size={16} color={depEnabled ? TEXT : MUTED} />
                  </TouchableOpacity>
                </View>
              </View>
              <Text style={[styles.helpText, !depEnabled && styles.disabledText]}>
                Applies to labour subtotal only.
              </Text>

              {/* Totals (visual only) */}
              <View style={styles.totalsBlock}>
                <View style={styles.totalRow}>
                  <Text style={[styles.totalLabel, !depEnabled && styles.disabledText]}>
                    Materials selected
                  </Text>
                  <Text style={[styles.totalVal, !depEnabled && styles.disabledText]}>
                    £{depMaterials.filter((m) => m.selected).reduce((s, x) => s + (x.total || 0), 0).toFixed(2)}
                  </Text>
                </View>
                <View
                  style={[
                    styles.totalRow,
                    { borderTopWidth: 1, borderTopColor: BORDER, paddingTop: 6, marginTop: 6 }
                  ]}
                >
                  <Text style={[styles.totalLabel, { fontWeight: "900" }, !depEnabled && styles.disabledText]}>
                    Labour deposit (%)
                  </Text>
                  <Text style={[styles.totalVal, { fontWeight: "900" }, !depEnabled && styles.disabledText]}>
                    {Math.min(100, Math.max(0, Math.floor(depLabourPct || 0)))}%
                  </Text>
                </View>
              </View>
            </View>
          </>
        )}

        {/* Step 2: Schedule */}
        {step === 2 && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Job Schedule</Text>
            
            {/* Conflict Warning Banner */}
            {showConflictWarning && hasConflict && (
              <View style={styles.conflictBanner}>
                <View style={styles.conflictContent}>
                  <Text style={styles.conflictTitle}>Schedule Conflict</Text>
                  <Text style={styles.conflictText}>
                    This job overlaps with existing work. Duration: {cjDays} day{cjDays !== 1 ? 's' : ''}
                    {cjIncludeWeekends ? ' (including weekends)' : ' (working days)'}
                  </Text>
                </View>
                <TouchableOpacity 
                  style={styles.conflictButton} 
                  onPress={findNextSlot}
                  activeOpacity={0.8}
                >
                  <Text style={styles.conflictButtonText}>Find Next Available</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Inline Job Details */}
            {inlineJobDetails && (
              <View style={styles.inlineJobDetails}>
                <View style={styles.inlineJobHeader}>
                  <Text style={styles.inlineJobDate}>
                    Jobs on {inlineJobDetails.date.toLocaleDateString()}
                  </Text>
                  <TouchableOpacity 
                    onPress={() => setInlineJobDetails(null)}
                    style={styles.closeButton}
                  >
                    <Text style={styles.closeButtonText}>×</Text>
                  </TouchableOpacity>
                </View>
                {inlineJobDetails.jobs.map((job, index) => (
                  <View key={job.id || index} style={styles.inlineJobItem}>
                    <Text style={styles.inlineJobTitle}>
                      {job.title || 'Untitled Job'}
                    </Text>
                    <Text style={styles.inlineJobStatus}>
                      Status: {job.status || 'scheduled'}
                    </Text>
                  </View>
                ))}
              </View>
            )}
            
            <View style={styles.scheduleSection}>
              {/* Calendar */}
              <View style={styles.calendarContainer}>
                <SharedCalendar
                  month={calMonth}
                  onChangeMonth={setCalMonth}
                  selectedDate={cjStart}
                  onSelectDate={handleDateSelect}
                  jobs={jobs}
                  span={calSpan}
                  blockStarts={false}
                  onDayLongPress={handleDayLongPress}
                />
              </View>
              
              {/* Duration controls */}
              <View style={[styles.sectionRow, { marginTop: 16 }]}>
                <Text style={styles.sectionLabel}>Duration (days)</Text>
                <View style={styles.counterWrap}>
                  <TouchableOpacity
                    style={styles.counterBtn}
                    onPress={() => {
                      setCjDays((d) => Math.max(1, d - 1));
                      Haptics.selectionAsync();
                    }}
                  >
                    <Minus size={16} color={TEXT} />
                  </TouchableOpacity>
                  <Text style={styles.counterValue}>{cjDays}</Text>
                  <TouchableOpacity
                    style={styles.counterBtn}
                    onPress={() => {
                      setCjDays((d) => d + 1);
                      Haptics.selectionAsync();
                    }}
                  >
                    <PlusIcon size={16} color={TEXT} />
                  </TouchableOpacity>
                </View>
              </View>

              {/* Include weekends toggle */}
              <View style={styles.toggleRow}>
                <Text style={styles.toggleLabel}>Include weekends</Text>
                <Switch 
                  value={cjIncludeWeekends} 
                  onValueChange={(v) => {
                    setCjIncludeWeekends(v);
                    Haptics.selectionAsync();
                  }}
                />
              </View>
              
              {/* Error display */}
              {cjError && (
                <Text style={styles.errorText}>{cjError}</Text>
              )}
            </View>
          </View>
        )}

        {/* Bottom padding for sticky action bar */}
        <View style={{ height: 80 }} />
      </ScrollView>

      {/* Sticky bottom action bar */}
      <View style={[styles.actionBar, { paddingBottom: insets.bottom }]}>
        <TouchableOpacity
          style={[styles.actionBtn, styles.primaryActionBtn, cjBusy && { opacity: 0.55 }]}
          activeOpacity={0.9}
          disabled={cjBusy}
          onPress={step < TOTAL_STEPS ? next : createJobInternal}
        >
          <Text style={[styles.actionBtnText, { color: "#fff" }]} numberOfLines={1}>
            {step < TOTAL_STEPS ? "Continue" : (cjBusy ? "Creating..." : "Create Job")}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { 
    flex: 1, 
    backgroundColor: BG 
  },
  
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
  
  content: {
    flex: 1,
  },
  
  contentContainer: {
    padding: 16,
  },

  stepProgress: {
    marginBottom: 16,
  },
  
  stepRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  
  stepTitle: {
    color: TEXT,
    fontWeight: "800",
    fontSize: 16,
  },
  
  stepCounter: {
    color: MUTED,
    fontWeight: "600",
    fontSize: 12,
  },
  
  progressTrack: {
    height: 6,
    backgroundColor: "#dde3ea",
    borderRadius: 999,
  },
  
  progressFill: {
    height: 6,
    backgroundColor: BRAND,
    borderRadius: 999,
  },
  
  card: {
    backgroundColor: CARD,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: BORDER,
    marginBottom: 16,
    ...Platform.select({
      ios: {
        shadowColor: '#0b1220',
        shadowOpacity: 0.06,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 4 },
      },
      android: { elevation: 3 },
    }),
  },

  cardTitle: {
    fontWeight: "900",
    color: TEXT,
    marginBottom: 16,
    fontSize: 16,
  },
  
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  
  toggleLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  
  toggleLabel: {
    fontSize: 16,
    fontWeight: "900",
    color: TEXT,
  },
  
  infoBtn: {
    marginLeft: 8,
    padding: 4,
  },
  
  tooltip: {
    marginTop: 12,
    padding: 12,
    backgroundColor: "#f8fafc",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
  },
  
  tooltipText: {
    fontSize: 14,
    color: MUTED,
    lineHeight: 18,
  },
  
  depositCard: {
    backgroundColor: CARD,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 16,
  },
  
  disabledCard: {
    opacity: 0.6,
  },
  
  depositTitle: {
    fontWeight: "900",
    color: TEXT,
    marginBottom: 16,
    fontSize: 16,
  },
  
  sectionRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  
  sectionLabel: {
    fontWeight: "900",
    color: TEXT,
  },
  
  linkRow: {
    flexDirection: "row",
    gap: 14,
  },
  
  linkSm: {
    color: BRAND,
    fontWeight: "900",
    fontSize: 14,
  },
  
  disabledLink: {
    color: MUTED,
  },
  
  disabledText: {
    color: MUTED,
  },
  
  materialListWrap: {
    marginTop: 8,
    marginBottom: 8,
  },
  
  materialRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#f1f5f9",
  },
  
  disabledRow: {
    opacity: 0.6,
  },
  
  materialTitle: {
    color: TEXT,
    fontWeight: "800",
    fontSize: 14,
  },
  
  materialSub: {
    color: MUTED,
    fontSize: 12,
    marginTop: 2,
  },
  
  materialAmt: {
    color: TEXT,
    fontWeight: "900",
    marginLeft: 8,
  },
  
  emptyHint: {
    color: MUTED,
    marginTop: 6,
    fontStyle: "italic",
  },
  
  counterWrap: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
    overflow: "hidden",
  },
  
  disabledCounter: {
    opacity: 0.6,
  },
  
  counterBtn: {
    height: 36,
    width: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  
  counterValue: {
    minWidth: 64,
    textAlign: "center",
    fontWeight: "900",
    color: TEXT,
  },
  
  helpText: {
    color: MUTED,
    fontSize: 12,
    marginTop: 8,
  },
  
  totalsBlock: {
    marginTop: 16,
  },
  
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 4,
  },
  
  totalLabel: {
    color: TEXT,
    fontSize: 14,
  },
  
  totalVal: {
    color: TEXT,
    fontWeight: "800",
    fontSize: 14,
  },
  
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
      android: {
        elevation: 8,
      },
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
  
  primaryActionBtn: {
    backgroundColor: BRAND,
    borderColor: BRAND,
  },
  
  actionBtnText: {
    fontSize: 15,
    fontWeight: "900",
    color: TEXT,
  },
  
  scheduleSection: {
    gap: 12,
  },

  calendarContainer: {
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: BORDER,
  },

  inlineJobDetails: {
    backgroundColor: '#f0f9ff',
    borderWidth: 1,
    borderColor: '#bae6fd',
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
  },

  inlineJobHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },

  inlineJobDate: {
    color: '#0369a1',
    fontWeight: '800',
    fontSize: 14,
  },

  closeButton: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#bae6fd',
    alignItems: 'center',
    justifyContent: 'center',
  },

  closeButtonText: {
    color: '#0369a1',
    fontSize: 16,
    fontWeight: '700',
    lineHeight: 20,
  },

  inlineJobItem: {
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#bae6fd',
    marginBottom: 4,
  },

  inlineJobTitle: {
    color: '#0c4a6e',
    fontWeight: '700',
    fontSize: 14,
  },

  inlineJobStatus: {
    color: '#075985',
    fontSize: 12,
    marginTop: 2,
  },

  errorText: {
    color: "#dc2626",
    fontSize: 12,
    fontWeight: "600",
    marginTop: 8,
  },

  conflictBanner: {
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca',
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },

  conflictContent: {
    flex: 1,
  },

  conflictTitle: {
    color: '#dc2626',
    fontWeight: '800',
    fontSize: 14,
    marginBottom: 4,
  },

  conflictText: {
    color: '#7f1d1d',
    fontSize: 12,
    lineHeight: 16,
  },

  conflictButton: {
    backgroundColor: '#dc2626',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
  },

  conflictButtonText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
});
