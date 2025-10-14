// app/(app)/quotes/list.js
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
  ScrollView,
} from "react-native";
import { useRouter } from "expo-router";
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
  CheckSquare,
  Square,
  RefreshCcw,
} from "lucide-react-native";

import SharedCalendar from "../../../components/SharedCalendar";
import { quoteCreateHref, quotePreviewHref, jobHref, loginHref } from "../../../lib/nav";

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

/* ---------- deposit helpers ---------- */
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

/* ---------- scheduling helpers ---------- */
const jobOverlapsWorking = (job, spanStart, spanDays, spanIncludeWeekends) => {
  const js0 = job.start_date ? atMidnight(new Date(job.start_date)) : null;
  const je0 = job.end_date ? atMidnight(new Date(job.end_date)) : js0;
  if (!js0) return false;

  const spanEndDate = addWorkingDays(
    spanStart,
    Math.max(1, spanDays),
    spanIncludeWeekends
  );

  const spanKeys = new Set();
  eachDay(spanStart, spanEndDate, (d) => {
    if (spanIncludeWeekends || !isWeekend(d)) {
      spanKeys.add(d.getFullYear() + "-" + d.getMonth() + "-" + d.getDate());
    }
  });

  const jobIncWknd = !!job.include_weekends;
  let hit = false;
  eachDay(js0, je0, (d) => {
    if (hit) return;
    const weekend = isWeekend(d);
    if (jobIncWknd || !weekend) {
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

/* Build expenses rows for non-labour items */
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

/* ============================================= */
/*                    SCREEN                      */
/* ============================================= */
export default function QuoteList() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [quotes, setQuotes] = useState([]);
  const [query, setQuery] = useState("");

  const [userId, setUserId] = useState(null);
  const [jobs, setJobs] = useState([]);

  /* Action sheet */
  const [actionOpen, setActionOpen] = useState(false);
  const [selectedQuote, setSelectedQuote] = useState(null);

  /* Deposit UI */
  const [depEnabled, setDepEnabled] = useState(false);
  const [depMaterials, setDepMaterials] = useState([]); // {ref,title,qty,unit,total,selected}
  const [depLabourPct, setDepLabourPct] = useState(10);
  const [depLabourSubtotal, setDepLabourSubtotal] = useState(0);
  const [vatEnabled, setVatEnabled] = useState(VAT_ENABLED_DEFAULT);
  const [vatRate, setVatRate] = useState(VAT_RATE_DEFAULT);

  /* Scheduling modal */
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

  /* Derived dates */
  const endDate = useMemo(
    () => addWorkingDays(cjStart, Math.max(1, cjDays), cjIncludeWeekends),
    [cjStart, cjDays, cjIncludeWeekends]
  );

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

  /* Data */
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

      const { data: profile } = await supabase
        .from("profiles")
        .select("vat_enabled, vat_rate")
        .eq("id", user.id)
        .maybeSingle();

      if (profile) {
        if (profile.vat_enabled != null) setVatEnabled(!!profile.vat_enabled);
        if (profile.vat_rate != null)
          setVatRate(Number(profile.vat_rate) || VAT_RATE_DEFAULT);
      }

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
    } finally {
      setLoading(false);
    }
  }, [router, query]);

  const loadJobs = useCallback(async () => {
    if (!userId) return [];
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
    return [];
  }, [userId]);

  useEffect(() => {
    loadQuotes();
  }, [loadQuotes]);
  useEffect(() => {
    loadJobs();
  }, [loadJobs, userId]);

  /* ---------- open action ---------- */
  const openActionFor = async (q) => {
    setSelectedQuote(q);
    setDepEnabled(false);
    setDepMaterials([]);
    setDepLabourPct(10);
    setDepLabourSubtotal(0);
    setCjError("");

    const { data: full } = await supabase
      .from("quotes")
      .select("*")
      .eq("id", q.id)
      .maybeSingle();

    if (full) {
      const { labourSubtotal, materialItems } = splitQuoteItems(full);
      setDepLabourSubtotal(labourSubtotal);
      setDepMaterials((materialItems || []).map((m) => ({ ...m, selected: false })));
    }

    setActionOpen(true);
  };

  /* ---------- Create Job flow (Option 1) ---------- */
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

      // Reload full quote for details
      const { data: full, error } = await supabase
        .from("quotes")
        .select("*")
        .eq("id", selectedQuote.id)
        .maybeSingle();
      if (error || !full) throw error || new Error("Quote not found");

      const start = toYMD(cjStart);
      const end = toYMD(addWorkingDays(cjStart, Math.max(1, cjDays), cjIncludeWeekends));

      console.log("[CREATE_JOB] inserting job…", { start, end, cjDays, cjIncludeWeekends });

      // Create job
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
      console.log("[CREATE_JOB] job inserted:", jobId);

      // Expenses for materials
      const expenseRows = buildExpenseRows({
        quote: full,
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
        .eq("id", full.id);
      if (upQ.error) console.warn("[CREATE_JOB] link quote->job failed", upQ.error);
      else console.log("[CREATE_JOB] quote linked to job:", jobId);

      if (depEnabled) {
        // Call Edge Function to create deposit PDF -> documents + jobdocs
        try {
          const material_item_ids = depMaterials.filter((m) => m.selected).map((m) => m.ref);
          const labour_percent = Math.min(100, Math.max(0, Math.floor(depLabourPct || 0)));
          const idempotency_key = `dep|${user.id}|${full.id}|job:${jobId}|${material_item_ids.slice().sort().join(",")}|${labour_percent}`;

          const payload = {
            user_id: user.id,
            quote_id: full.id,
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
            setScheduleOpen(false);
            setQuotes((prev) => prev.filter((x) => x.id !== full.id));
            router.push(jobHref(jobId));
            return;
          }

          console.log("[DEPOSIT] EF response:", JSON.stringify(efData, null, 2));
          
          if (efData?.ok || efData?.success) {
            setScheduleOpen(false);
            setQuotes((prev) => prev.filter((x) => x.id !== full.id));

            // Try multiple navigation strategies based on response format
            let navigated = false;

            // Strategy 1: Direct document ID
            if ((efData.document_id || efData.documentId) && (efData.document_id || efData.documentId) !== 'undefined') {
              const docId = efData.document_id || efData.documentId;
              console.log("[DEPOSIT] Navigating with document_id:", docId);
              router.push(`/(app)/invoices/deposit/preview?docId=${encodeURIComponent(docId)}&jobId=${encodeURIComponent(jobId)}&name=deposit.pdf`);
              navigated = true;
            }
            // Strategy 2: Direct PDF URL
            else if ((efData.pdf_url || efData.pdfUrl || efData.url) && (efData.pdf_url || efData.pdfUrl || efData.url) !== 'undefined') {
              const pdfUrl = efData.pdf_url || efData.pdfUrl || efData.url;
              console.log("[DEPOSIT] Navigating with pdf_url:", pdfUrl);
              router.push(`/(app)/invoices/deposit/preview?url=${encodeURIComponent(pdfUrl)}&jobId=${encodeURIComponent(jobId)}&name=deposit.pdf`);
              navigated = true;
            }
            // Strategy 3: Signed URL
            else if ((efData.signed_url || efData.signedUrl) && (efData.signed_url || efData.signedUrl) !== 'undefined') {
              const signedUrl = efData.signed_url || efData.signedUrl;
              console.log("[DEPOSIT] Navigating with signed_url:", signedUrl);
              router.push(`/(app)/invoices/deposit/preview?url=${encodeURIComponent(signedUrl)}&jobId=${encodeURIComponent(jobId)}&name=deposit.pdf`);
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
                      router.push(`/(app)/invoices/deposit/preview?docId=${encodeURIComponent(docCheck.id)}&jobId=${encodeURIComponent(jobId)}&name=${encodeURIComponent(docCheck.name || 'deposit.pdf')}`);
                      return;
                    } else if (docCheck.url) {
                      console.log("[DEPOSIT] Found document, navigating with URL:", docCheck.url);
                      router.push(`/(app)/invoices/deposit/preview?url=${encodeURIComponent(docCheck.url)}&jobId=${encodeURIComponent(jobId)}&name=${encodeURIComponent(docCheck.name || 'deposit.pdf')}`);
                      return;
                    }
                  }
                  
                  // If still no document found, navigate to job page
                  console.warn("[DEPOSIT] No document found after delay, navigating to job");
                  router.push(jobHref(jobId));
                } catch (e) {
                  console.error("[DEPOSIT] Error checking documents table:", e);
                  router.push(jobHref(jobId));
                }
              }, 2000); // 2 second delay to allow document creation
              
              // Don't return here, let the timeout handle navigation
            }

            // If we haven't navigated by now and no timeout was set, go to job
            if (!navigated && !(efData.document_id || efData.documentId || efData.pdf_url || efData.pdfUrl || efData.url || efData.signed_url || efData.signedUrl)) {
              console.warn("[DEPOSIT] No valid document reference and no fallback, navigating to job");
              router.push(jobHref(jobId));
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
      setScheduleOpen(false);
      setQuotes((prev) => prev.filter((x) => x.id !== full.id));
      router.push(jobHref(jobId));
    } catch (e) {
      console.warn("[CREATE_JOB] error", e);
      setCjError(e?.message || "Create job failed");
    } finally {
      setCjBusy(false);
    }
  };

  /* ---------- list rendering ---------- */
  const renderCard = ({ item }) => {
    const address = item.client_address || "";
    const dispId = displayQuoteId(item);
    return (
      <TouchableOpacity
        onPress={() => openActionFor(item)}
        activeOpacity={0.9}
        style={styles.card}
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
                    Alert.alert(
                      "Delete failed",
                      del.error.message || "Please try again."
                    );
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
              {"  "}
              {new Date(item.created_at).toLocaleDateString()}
            </Text>
          </View>

          {!!address && (
            <View style={styles.rowMini}>
              <MapPin size={16} color={MUTED} />
              <Text style={[styles.rowMiniText, { flexShrink: 1 }]} numberOfLines={1}>
                {"  "}
                {address}
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

  return (
    <View style={styles.screen}>
      {/* Topbar */}
      <View style={styles.topbar}>
        <Text style={styles.h1}>Quotes</Text>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <TouchableOpacity style={styles.iconBtn} onPress={loadQuotes}>
            <RefreshCcw size={20} color={MUTED} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.iconBtn}
            onPress={() => router.push("/(app)/settings")}
          >
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
      )}

      {/* FAB */}
      <TouchableOpacity
        onPress={() => router.push(quoteCreateHref())}
        style={styles.fab}
        activeOpacity={0.9}
      >
        <Plus size={24} color="#fff" />
      </TouchableOpacity>

      {/* Action Sheet */}
      <Modal visible={actionOpen} animationType="fade" transparent>
        <Pressable style={styles.modalBackdrop} onPress={() => setActionOpen(false)} />
        <View style={styles.centerWrap}>
          <View style={styles.actionCard}>
            <View style={styles.handle} />

            {/* Row: View / Create */}
            <View style={styles.centerRow}>
              <TouchableOpacity
                style={[styles.centerBtn, styles.centerBtnPrimary]}
                onPress={() => {
                  setActionOpen(false);
                  if (selectedQuote) router.push(quotePreviewHref(selectedQuote.id));
                }}
                activeOpacity={0.9}
              >
                <Eye size={18} color="#fff" />
                <Text style={[styles.centerBtnText, { color: "#fff" }]}>View</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.centerBtn, styles.centerBtnNeutral]}
                onPress={() => {
                  setActionOpen(false);
                  setScheduleOpen(true);
                }}
                activeOpacity={0.9}
              >
                <CalendarPlus size={18} color={TEXT} />
                <Text style={styles.centerBtnText}>Create job</Text>
              </TouchableOpacity>
            </View>

            {/* Deposit toggle + panel */}
            <View
              style={{
                marginTop: 14,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <Text style={styles.depositHeader}>Create upfront (deposit) invoice</Text>
              <Switch value={depEnabled} onValueChange={(v) => { setDepEnabled(v); buzz(); }} />
            </View>

            {depEnabled && (
              <View style={styles.depositCard}>
                <Text style={styles.depositTitle}>Deposit details</Text>

                {/* Materials chooser */}
                <View style={styles.sectionRow}>
                  <Text style={styles.sectionLabel}>Materials to include</Text>
                  <View style={{ flexDirection: "row", gap: 14 }}>
                    <Text onPress={() => setDepMaterials((prev) => prev.map((m) => ({ ...m, selected: true })))}
                          style={styles.linkSm}>
                      Select all
                    </Text>
                    <Text onPress={() => setDepMaterials((prev) => prev.map((m) => ({ ...m, selected: false })))}
                          style={styles.linkSm}>
                      Clear
                    </Text>
                  </View>
                </View>

                {depMaterials.length ? (
                  <View style={styles.materialListWrap}>
                    <ScrollView style={{ maxHeight: 160 }}>
                      {depMaterials.map((m) => {
                        const Icon = m.selected ? CheckSquare : Square;
                        return (
                          <Pressable
                            key={m.ref}
                            onPress={() =>
                              setDepMaterials((prev) =>
                                prev.map((x) => (x.ref === m.ref ? { ...x, selected: !x.selected } : x))
                              )
                            }
                            style={styles.materialRow}
                          >
                            <Icon size={18} color={m.selected ? BRAND : MUTED} />
                            <View style={{ flex: 1, marginLeft: 8 }}>
                              <Text style={styles.materialTitle} numberOfLines={1}>
                                {m.title}
                              </Text>
                              <Text style={styles.materialSub} numberOfLines={1}>
                                {m.qty} × {money(m.unit)}
                              </Text>
                            </View>
                            <Text style={styles.materialAmt}>{money(m.total)}</Text>
                          </Pressable>
                        );
                      })}
                    </ScrollView>
                  </View>
                ) : (
                  <Text style={styles.emptyHint}>No materials on this quote.</Text>
                )}

                {/* Labour percent */}
                <View style={[styles.sectionRow, { marginTop: 12 }]}>
                  <Text style={styles.sectionLabel}>Labour deposit (%)</Text>
                  <View style={styles.counterWrap}>
                    <TouchableOpacity
                      style={styles.counterBtn}
                      onPress={() =>
                        setDepLabourPct((p) => Math.max(0, Math.floor((p || 0) - 1)))
                      }
                    >
                      <Minus size={16} color={TEXT} />
                    </TouchableOpacity>
                    <Text style={styles.counterValue}>
                      {Math.min(100, Math.max(0, Math.floor(depLabourPct || 0)))}%
                    </Text>
                    <TouchableOpacity
                      style={styles.counterBtn}
                      onPress={() =>
                        setDepLabourPct((p) => Math.min(100, Math.floor((p || 0) + 1)))
                      }
                    >
                      <PlusIcon size={16} color={TEXT} />
                    </TouchableOpacity>
                  </View>
                </View>
                <Text style={styles.helpText}>Applies to labour subtotal only.</Text>

                {/* Totals (visual only) */}
                <View style={styles.totalsBlock}>
                  <View style={styles.totalRow}>
                    <Text style={styles.totalLabel}>Materials selected</Text>
                    <Text style={styles.totalVal}>
                      £{depMaterials.filter((m) => m.selected).reduce((s, x) => s + (x.total || 0), 0).toFixed(2)}
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.totalRow,
                      { borderTopWidth: 1, borderTopColor: BORDER, paddingTop: 6, marginTop: 6 }
                    ]}
                  >
                    <Text style={[styles.totalLabel, { fontWeight: "900" }]}>
                      Labour deposit (%)
                    </Text>
                    <Text style={[styles.totalVal, { fontWeight: "900" }]}>
                      {Math.min(100, Math.max(0, Math.floor(depLabourPct || 0)))}%
                    </Text>
                  </View>
                </View>

                <Text style={styles.microNote}>
                  If enabled, a deposit PDF will be generated on Create and saved
                  under the job’s documents.
                </Text>
              </View>
            )}
          </View>
        </View>
      </Modal>

      {/* Schedule Modal */}
      <Modal visible={scheduleOpen} animationType="fade" transparent>
        <Pressable style={styles.modalBackdrop} onPress={() => setScheduleOpen(false)} />
        <View style={styles.sheet}>
          <Text style={styles.sheetTitle}>Create job</Text>

          {/* Calendar */}
          <View style={{ marginTop: 6, borderWidth: 1, borderColor: BORDER, borderRadius: 12, padding: 10, backgroundColor: "#fff" }}>
            <SharedCalendar
              month={calMonth}
              onChangeMonth={setCalMonth}
              selectedDate={cjStart}
              onSelectDate={(d) => setCjStart(atMidnight(d))}
              jobs={jobs}
              span={{ start: cjStart, days: cjDays, includeWeekends: cjIncludeWeekends }}
              blockStarts={true}
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
              style={[styles.sheetBtn, styles.sheetBtnPrimary, cjBusy && { opacity: 0.55 }]}
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
  screen: { flex: 1, backgroundColor: BG, paddingTop: Platform.OS === "android" ? 8 : 0 },

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
  quoteTiny: { position: "absolute", right: 72, top: 14, color: MUTED, fontSize: 12, maxWidth: 200, textAlign: "right", fontWeight: "800" },
  clientName: { color: TEXT, fontWeight: "900", fontSize: 16 },
  rowMini: { flexDirection: "row", alignItems: "center", marginTop: 4 },
  rowMiniText: { color: MUTED },
  totalBottom: { position: "absolute", right: 16, bottom: 12, fontSize: 16, fontWeight: "900", color: TEXT },

  binBtn: {
    position: "absolute", right: 12, top: 10, height: 30, width: 30, borderRadius: 8, alignItems: "center", justifyContent: "center",
    backgroundColor: "#fee2e2", borderWidth: 1, borderColor: "#fecaca", zIndex: 5,
  },

  fab: {
    position: "absolute", right: 18, bottom: 18, width: 56, height: 56, borderRadius: 28, backgroundColor: BRAND,
    alignItems: "center", justifyContent: "center", shadowColor: BRAND, shadowOpacity: 0.35, shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 }, elevation: 6,
  },

  /* Overlay */
  modalBackdrop: { flex: 1, backgroundColor: "#0009" },

  /* Centered action sheet */
  centerWrap: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center", paddingHorizontal: 24 },
  actionCard: {
    width: "100%", backgroundColor: CARD, borderRadius: 20, borderWidth: 1, borderColor: BORDER, padding: 16, paddingTop: 12,
    shadowColor: "#0b1220", shadowOpacity: 0.22, shadowRadius: 24, shadowOffset: { width: 0, height: 14 }, elevation: 12,
  },
  handle: { alignSelf: "center", width: 36, height: 4, borderRadius: 2, backgroundColor: "#e5e7eb", marginBottom: 10 },

  centerRow: { flexDirection: "row", gap: 10 },
  centerBtn: {
    paddingVertical: 12, borderRadius: 14, borderWidth: 1, borderColor: BORDER, alignItems: "center", justifyContent: "center",
    flexDirection: "row", gap: 8, backgroundColor: "#f8fafc", elevation: 2, flex: 1,
  },
  centerBtnPrimary: { backgroundColor: BRAND, borderColor: BRAND },
  centerBtnNeutral: { backgroundColor: "#f7f8fb" },
  centerBtnText: { fontSize: 15, fontWeight: "900", color: TEXT },

  depositHeader: { color: TEXT, fontWeight: "900", fontSize: 16 },

  depositCard: { marginTop: 10, borderWidth: 1, borderColor: BORDER, backgroundColor: "#f9fafb", borderRadius: 14, padding: 12 },
  depositTitle: { fontWeight: "900", color: TEXT, marginBottom: 8 },
  sectionRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  sectionLabel: { fontWeight: "900", color: TEXT },
  linkSm: { color: BRAND, fontWeight: "900" },

  materialListWrap: { marginTop: 8 },
  materialRow: { flexDirection: "row", alignItems: "center", paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#eef2f7" },
  materialTitle: { color: TEXT, fontWeight: "800" },
  materialSub: { color: MUTED, fontSize: 12 },
  materialAmt: { color: TEXT, fontWeight: "900", marginLeft: 8 },
  emptyHint: { color: MUTED, marginTop: 6 },

  /* Compact counter */
  counterWrap: {
    flexDirection: "row", alignItems: "center", backgroundColor: "#fff", borderWidth: 1, borderColor: BORDER,
    borderRadius: 12, overflow: "hidden",
  },
  counterBtn: { height: 36, width: 36, alignItems: "center", justifyContent: "center" },
  counterValue: { minWidth: 64, textAlign: "center", fontWeight: "900", color: TEXT },

  helpText: { color: MUTED, fontSize: 12, marginTop: 6 },

  totalsBlock: { marginTop: 10 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 2 },
  totalLabel: { color: TEXT },
  totalVal: { color: TEXT, fontWeight: "800" },
  microNote: { color: MUTED, fontSize: 11, marginTop: 8 },

  /* Schedule sheet */
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
  },
  sheetTitle: { fontSize: 18, fontWeight: "900", color: TEXT, marginBottom: 6 },

  durationBlock: { marginTop: 10 },
  controlHeader: { fontWeight: "900", color: TEXT, marginBottom: 6 },
  spinRow: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: "#fff", borderWidth: 1, borderColor: BORDER,
    borderRadius: 12, overflow: "hidden", alignSelf: "flex-start"
  },
  spinBtn: { height: 36, width: 36, alignItems: "center", justifyContent: "center" },
  spinValue: { minWidth: 96, textAlign: "center", fontWeight: "900", color: TEXT },

  weekendRow: { marginTop: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  endPreview: { marginTop: 10, color: MUTED },
  bold: { fontWeight: "900", color: TEXT },

  blockedWarn: { color: DANGER, marginTop: 6 },

  sheetBtns: { flexDirection: "row", gap: 10, marginTop: 12 },
  sheetBtn: {
    flex: 1, paddingVertical: 12, borderRadius: 14, borderWidth: 1, borderColor: BORDER,
    alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8,
  },
  sheetBtnPrimary: { backgroundColor: BRAND, borderColor: BRAND },
  sheetBtnGhost: { backgroundColor: "#f7f8fb" },
  sheetBtnText: { fontSize: 15, fontWeight: "900" },
});