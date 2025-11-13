// app/(app)/invoices/wizard.js
import React, { useEffect, useMemo, useState, useCallback } from "react";
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  ActivityIndicator, Alert, Modal, Dimensions,
  StatusBar, StyleSheet, Platform
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { supabase } from "../../../lib/supabase";
import * as Haptics from "expo-haptics";
import { Feather } from "@expo/vector-icons";
import * as NavigationBar from "expo-navigation-bar";
import TemplatePicker from "../../../components/TemplatePicker";

/* ---------------- Theme ---------------- */
const BRAND = "#2a86ff";
const TEXT = "#0b1220";
const MUTED = "#6b7280";
const CARD = "#ffffff";
const BG = "#ffffff";
const BORDER = "#e6e9ee";
const OK = "#16a34a";
const DISABLED = "#9ca3af";
const WARN = "#dc2626";

/* ---------------- Utils ---------------- */
function money(n) { if (!isFinite(n)) return "0.00"; return (Math.round(n * 100) / 100).toFixed(2); }
function num(v, d = 0) { const n = Number(v); return Number.isFinite(n) ? n : d; }
function todayISO() { return new Date().toISOString().slice(0, 10); }
function isHoursUnit(u) {
  const t = String(u || "").trim().toLowerCase();
  return t === "h" || t === "hr" || t === "hrs" || t === "hour" || t === "hours";
}
function isLabourItem(row) {
  const kindRaw = row && (row.kind ?? row.type);
  const kind = String(kindRaw || "").toLowerCase();
  if (kind === "labour" || kind === "labor") return true;
  if (isHoursUnit(row?.unit)) return true;
  return false;
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const haversineMiles = (lat1, lon1, lat2, lon2) => {
  const toRad = (x) => (x * Math.PI) / 180;
  const R_km = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = ((lon1 - lon2) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R_km * c * 0.621371;
};

async function tryJson(url, opts = {}, tries = 2) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, opts);
      return await res.json();
    } catch (e) {
      lastErr = e;
      await sleep(150 + i * 200);
    }
  }
  throw lastErr;
}

async function probeUrl(url) {
  const bust = "cb=" + Date.now() + "&r=" + Math.random().toString(36).slice(2);
  const u = url && url.indexOf("?") >= 0 ? url + "&" + bust : url + "?" + bust;
  try {
    let res = await fetch(u, { method: "HEAD" });
    if (res.ok || res.status === 206 || res.status === 304) return true;
    res = await fetch(u, { method: "GET", headers: { Range: "bytes=0-1" } });
    if (res.status === 200 || res.status === 206 || res.status === 304) return true;
    res = await fetch(u, { method: "GET" });
    return res.ok;
  } catch { return false; }
}

/* --- Helper: derive expense total for display + totals (non-destructive) --- */
function deriveExpenseTotal(e) {
  const t = Number(e?.total);
  if (Number.isFinite(t) && t >= 0) return Math.round(t * 100) / 100;
  const qty = Number(e?.qty);
  const unit = Number(e?.unit_cost);
  if (Number.isFinite(qty) && Number.isFinite(unit)) {
    return Math.round(qty * unit * 100) / 100;
  }
  return 0;
}

/* ---------------- Wizard ---------------- */
const TOTAL_STEPS = 8;
const STEP_TITLES = ["Hours", "Expenses", "Attachments", "Deposit", "Client", "Terms", "Template", "Review"];

export default function InvoiceWizard() {
  const params = useLocalSearchParams();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [step, setStep] = useState(1);

  const [loadingDefaults, setLoadingDefaults] = useState(true);
  const [jobId, setJobId] = useState(String(params.job_id || ""));
  const [job, setJob] = useState(null);
  const [fallbackClient, setFallbackClient] = useState({ name: "", email: "", phone: "", address: "" });

  const [expenses, setExpenses] = useState([]);
  const [selectedExpenseIds, setSelectedExpenseIds] = useState(new Set());
  const [loadingExpenses, setLoadingExpenses] = useState(true);

  const [documents, setDocuments] = useState([]);
  const [selectedDocIds, setSelectedDocIds] = useState(new Set());
  const [loadingDocs, setLoadingDocs] = useState(true);

  const [hoursQty, setHoursQty] = useState("1");
  const [hourlyRate, setHourlyRate] = useState("");
  const [taxRate, setTaxRate] = useState("");
  const [dueDays, setDueDays] = useState("14");
  const [deposit, setDeposit] = useState("0");
  const [note, setNote] = useState("");
  const [currency, setCurrency] = useState("GBP");

  const [submitting, setSubmitting] = useState(false);
  const [userId, setUserId] = useState(null);
  const [suggestedPaid, setSuggestedPaid] = useState(0);

  // Auto-calculation state
  const [profile, setProfile] = useState(null);
  const [distanceMiles, setDistanceMiles] = useState("");
  const [travelCharge, setTravelCharge] = useState(0);
  const [autoDistLoading, setAutoDistLoading] = useState(false);

  const [sourceQuoteId, setSourceQuoteId] = useState(params.quote_id ? String(params.quote_id) : "");

  // CIS defaults from profile + per-invoice override
  const [cisProfileEnabled, setCisProfileEnabled] = useState(false);
  const [cisProfileExcludeMaterials, setCisProfileExcludeMaterials] = useState(true);
  const [cisApply, setCisApply] = useState(false);
  const [cisRate, setCisRate] = useState("20"); // percent as string

  // Template selection
  const [templateCode, setTemplateCode] = useState(null);
  const [templatePreviewUrl, setTemplatePreviewUrl] = useState(null);
  const [templatePreviewHtml, setTemplatePreviewHtml] = useState(null);

  /* ---------------- Lifecycle ---------------- */
  useEffect(() => {
    StatusBar.setBarStyle("dark-content");
    if (Platform.OS === "android") {
      StatusBar.setBackgroundColor("#ffffff", false);
      (async () => { try { await NavigationBar.setBackgroundColorAsync("#ffffff"); } catch {} })();
    }
  }, []);

  // Load defaults (profile) - includes travel & CIS + default template
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoadingDefaults(true);
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) { setLoadingDefaults(false); return; }
        setUserId(user.id);

        const { data, error } = await supabase
          .from("profiles")
          .select(`
            invoice_terms, invoice_due_days, invoice_tax_rate, invoice_currency,
            hourly_rate, travel_rate_per_mile, address_line1, city, postcode,
            cis_enabled, cis_deduction_rate, cis_apply_by_default, cis_exclude_materials,
            default_template_code
          `)
          .eq("id", user.id)
          .single();

        if (!error && alive && data) {
          setProfile(data);
          const effectiveHourly = Number(data.hourly_rate);
          setHourlyRate(Number.isFinite(effectiveHourly) && effectiveHourly > 0 ? String(effectiveHourly) : "0");

          if (typeof data.invoice_due_days === "number") setDueDays(String(data.invoice_due_days));
          if (typeof data.invoice_tax_rate === "number") setTaxRate(String(data.invoice_tax_rate));
          if (data.invoice_currency) setCurrency(data.invoice_currency);
          if (data.invoice_terms && !note) setNote(data.invoice_terms);

          // Initial template selection (still user-changeable in the picker)
          if (data.default_template_code) {
            setTemplateCode(String(data.default_template_code));
          }

          const ded = Number(data.cis_deduction_rate);
          const rateStr = Number.isFinite(ded) ? String(ded) : "20";
          setCisProfileEnabled(!!data.cis_enabled);
          setCisProfileExcludeMaterials(data.cis_exclude_materials == null ? true : !!data.cis_exclude_materials);
          setCisApply(!!data.cis_apply_by_default && !!data.cis_enabled);
          setCisRate(rateStr);
        }
      } finally {
        if (alive) setLoadingDefaults(false);
      }
    })();
    return () => { alive = false; };
  }, []); // eslint-disable-line

  async function reloadExpenses(jid = null) {
    const useJob = jid ?? jobId;
    if (!useJob) { setExpenses([]); setSelectedExpenseIds(new Set()); return; }
    const ex = await supabase
      .from("expenses")
      .select("id, name, qty, unit, unit_cost, total, notes, date")
      .eq("job_id", useJob)
      .order("created_at", { ascending: true });
    if (!ex.error) {
      const list = ex.data || [];
      setExpenses(list);
      setSelectedExpenseIds(new Set(list.map(e => e.id)));
    }
  }
  async function reloadDocuments(jid = null) {
    const useJob = jid ?? jobId;
    if (!useJob) { setDocuments([]); setSelectedDocIds(new Set()); return; }
    const docs = await supabase
      .from("documents")
      .select("id, name, kind, url, mime, size, created_at")
      .eq("job_id", useJob)
      .order("created_at", { ascending: true });
    if (!docs.error) {
      const list = docs.data || [];
      setDocuments(list);
      setSelectedDocIds(new Set(list.map(d => d.id)));
    }
  }

  // Load job + auto-load expenses and documents + client snapshot fallback
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoadingExpenses(true);
        setLoadingDocs(true);

        if (jobId) {
          const j = await supabase
            .from("jobs")
            .select(`
              id, client_id, title, client_name, client_email, client_phone, client_address, site_address,
              start_date, end_date, duration_days, total, status, source_quote_id
            `)
            .eq("id", jobId)
            .single();

          if (!j.error && alive) {
            setJob(j.data || null);
            if (!params.quote_id && j.data?.source_quote_id) {
              setSourceQuoteId(String(j.data.source_quote_id));
            }

            if (j.data?.client_id) {
              const cr = await supabase
                .from("clients")
                .select("id, name, email, phone, address")
                .eq("id", j.data.client_id)
                .maybeSingle();
              if (!cr.error && cr.data) {
                setFallbackClient({
                  name: cr.data.name || "",
                  email: cr.data.email || "",
                  phone: cr.data.phone || "",
                  address: cr.data.address || ""
                });
              }
            }
          }
        }

        await Promise.all([reloadExpenses(jobId), reloadDocuments(jobId)]);
      } finally {
        if (alive) { setLoadingExpenses(false); setLoadingDocs(false); }
      }
    })();
    return () => { alive = false; };
  }, [jobId]); // eslint-disable-line

  // Travel charge recompute
  useEffect(() => {
    const oneWay = num(distanceMiles, 0);
    const rate = num(profile?.travel_rate_per_mile, 0);
    const roundTripCharge = oneWay * 2 * rate;
    setTravelCharge(Math.round(roundTripCharge * 100) / 100);
  }, [distanceMiles, profile]);

  // Google helpers
  const GOOGLE =
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY ||
    globalThis?.expo?.env?.EXPO_PUBLIC_GOOGLE_MAPS_KEY;

  const geocodeAddress = async (address) => {
    if (!GOOGLE) return null;
    const clean = String(address || "").replace(/\s*\n+\s*/g, ", ");
    const url =
      "https://maps.googleapis.com/maps/api/geocode/json?address=" +
      encodeURIComponent(clean) +
      "&language=en&region=GB&key=" +
      GOOGLE;
    try {
      const j = await tryJson(url, {}, 2);
      if (String(j?.status || "OK") !== "OK") return null;
      const loc = j?.results?.[0]?.geometry?.location;
      return loc ? { lat: loc.lat, lng: loc.lng } : null;
    } catch {
      return null;
    }
  };

  const getDrivingDistanceMiles = async (origLat, origLng, destLat, destLng) => {
    if (!GOOGLE) return null;
    const url =
      "https://maps.googleapis.com/maps/api/distancematrix/json?origins=" +
      origLat +
      "," +
      origLng +
      "&destinations=" +
      destLat +
      "," +
      destLng +
      "&units=imperial&language=en&region=GB&key=" +
      GOOGLE;
    try {
      const j = await tryJson(url, {}, 2);
      const meters = j?.rows?.[0]?.elements?.[0]?.distance?.value;
      if (!meters && meters !== 0) return null;
      return meters * 0.000621371;
    } catch {
      return null;
    }
  };

  const buildBusinessAddress = (p) => [p?.address_line1, p?.city, p?.postcode].filter(Boolean).join(", ").trim();

  const autoCalcDistance = useCallback(async (clientAddress = "", siteAddress = "") => {
    try {
      if (!profile) return;
      const addr = siteAddress || clientAddress || "";
      if (!addr.trim()) return;
      const originText = buildBusinessAddress(profile);
      if (!originText) return;

      setAutoDistLoading(true);
      const origin = await geocodeAddress(originText);
      const dest = await geocodeAddress(addr.trim());
      if (!origin || !dest) return;

      let miles = await getDrivingDistanceMiles(origin.lat, origin.lng, dest.lat, dest.lng);
      if (!miles) miles = haversineMiles(origin.lat, origin.lng, dest.lat, dest.lng);
      const rounded = Math.round(Number(miles) * 100) / 100;
      if (Number.isFinite(rounded)) setDistanceMiles(String(rounded));
    } catch {
      // ignore
    } finally {
      setAutoDistLoading(false);
    }
  }, [profile]);

  // Pull details from quote (hours inference + client fallback + auto-distance)
  useEffect(() => {
    let alive = true;
    const effectiveQuoteId = params.quote_id || sourceQuoteId;
    if (!effectiveQuoteId) return;

    (async () => {
      try {
        const q = await supabase
          .from("quotes")
          .select("id, job_id, client_name, client_email, client_phone, client_address, line_items, site_address")
          .eq("id", effectiveQuoteId)
          .single();
        if (q.error || !q.data || !alive) return;

        if (!jobId && q.data.job_id) setJobId(String(q.data.job_id));

        setFallbackClient(prev => ({
          name: q.data.client_name || prev.name || "",
          email: q.data.client_email || prev.email || "",
          phone: q.data.client_phone || prev.phone || "",
          address: q.data.client_address || prev.address || "",
        }));

        const li = Array.isArray(q.data.line_items) ? q.data.line_items : [];
        let inferred = 0;
        for (const row of li) {
          if (!isLabourItem(row)) continue;
          const qty = Number(row?.qty);
          if (Number.isFinite(qty) && qty > 0) {
            inferred += qty;
            continue;
          }
          const desc = String(row?.description || "");
          const m = desc.match(/(\d+(?:\.\d+)?)\s*(?:hr|hrs|hours|h)\b/i);
          if (m) inferred += Number(m[1]) || 0;
        }
        if (inferred > 0 && (hoursQty === "" || Number(hoursQty) <= 1)) {
          const rounded = Math.round(inferred * 100) / 100;
          setHoursQty(String(rounded));
        }

        const clientAddr = q.data.client_address || "";
        const siteAddr = q.data.site_address || clientAddr;
        if (siteAddr && profile && !distanceMiles) {
          autoCalcDistance(clientAddr, siteAddr);
        }
      } catch {}
    })();

    return () => { alive = false; };
  }, [params.quote_id, sourceQuoteId, profile, autoCalcDistance]); // eslint-disable-line

  // Prefill deposit from legacy deposit invoice
  useEffect(() => {
    let alive = true;
    if (!jobId) return;
    const currentDep = Number(deposit || "0");
    if (currentDep > 0) return;

    (async () => {
      try {
        const inv = await supabase
          .from("invoices")
          .select("id, total, type, status, job_id, created_at")
          .eq("job_id", jobId)
          .eq("type", "deposit")
          .in("status", ["issued", "sent", "partially_paid", "paid"])
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!inv.error && inv.data && alive) {
          const depTotal = Number(inv.data.total);
          if (Number.isFinite(depTotal) && depTotal > 0) {
            setDeposit(String(depTotal));
          }
        }
      } catch {}
    })();

    return () => { alive = false; };
  }, [jobId]); // eslint-disable-line

  // Prefill deposit from actually PAID payments (non-voided)
  useEffect(() => {
    let alive = true;
    if (!jobId) return;

    (async () => {
      try {
        const res = await supabase
          .from("payments")
          .select("amount, paid_at, voided_at")
          .eq("job_id", jobId);

        if (res.error || !alive) return;

        const paidSum = (res.data || [])
          .filter(p => p && p.paid_at && !p.voided_at)
          .reduce((s, p) => s + Number(p.amount || 0), 0);

        setSuggestedPaid(paidSum);

        const cur = Number(deposit || "0");
        if (!Number.isFinite(cur) || cur <= 0) {
          setDeposit(String(paidSum));
        }
      } catch {}
    })();

    return () => { alive = false; };
  }, [jobId]); // eslint-disable-line

  /* ---------------- Expense Modal ---------------- */
  const [expModalOpen, setExpModalOpen] = useState(false);
  const [expEditingId, setExpEditingId] = useState(null);
  const emptyDraft = { name: "", qty: "", unit: "", unit_cost: "", total: "", notes: "", date: todayISO() };
  const [expDraft, setExpDraft] = useState(emptyDraft);
  const [savingExpense, setSavingExpense] = useState(false);

  function openAddExpense() {
    setExpEditingId(null);
    setExpDraft(emptyDraft);
    setExpModalOpen(true);
    Haptics.selectionAsync();
  }
  function openEditExpense(e) {
    setExpEditingId(e.id);
    setExpDraft({
      name: e.name || "",
      qty: e.qty != null ? String(e.qty) : "",
      unit: e.unit || "",
      unit_cost: e.unit_cost != null ? String(e.unit_cost) : "",
      total: e.total != null ? String(e.total) : "",
      notes: e.notes || "",
      date: e.date || todayISO(),
    });
    setExpModalOpen(true);
    Haptics.selectionAsync();
  }
  async function saveExpense() {
    try {
      if (!userId || !jobId) { Alert.alert("Missing context", "Login or select a job first."); return; }
      setSavingExpense(true);
      const qty = expDraft.qty === "" ? null : Number(expDraft.qty);
      const unit_cost = expDraft.unit_cost === "" ? null : Number(expDraft.unit_cost);
      let total = expDraft.total === "" ? null : Number(expDraft.total);
      if ((total == null || !Number.isFinite(total)) && Number.isFinite(qty) && Number.isFinite(unit_cost)) {
        total = Math.round(qty * unit_cost * 100) / 100;
      }
      const payload = {
        job_id: jobId, user_id, kind: "expense",
        name: expDraft.name || "Item", qty, unit: (expDraft.unit || null),
        unit_cost, total, notes: expDraft.notes || null, date: expDraft.date || todayISO(),
        fingerprint: "ui-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8)
      };
      if (expEditingId) {
        const { error } = await supabase.from("expenses").update(payload).eq("id", expEditingId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("expenses").insert(payload);
        if (error) throw error;
      }
      await reloadExpenses();
      setExpModalOpen(false);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch (e) {
      Alert.alert("Expense error", String(e?.message || e));
    } finally { setSavingExpense(false); }
  }

  /* ---------------- Document Modal ---------------- */
  const [docModalOpen, setDocModalOpen] = useState(false);
  const [docEditingId, setDocEditingId] = useState(null);
  const emptyDoc = { name: "", kind: "other", url: "", mime: "", size: "" };
  const [docDraft, setDocDraft] = useState(emptyDoc);
  const [savingDoc, setSavingDoc] = useState(false);

  function openAddDoc() {
    setDocEditingId(null);
    setDocDraft(emptyDoc);
    setDocModalOpen(true);
    Haptics.selectionAsync();
  }
  function openEditDoc(d) {
    setDocEditingId(d.id);
    setDocDraft({ name: d.name || "", kind: d.kind || "other", url: d.url || "", mime: d.mime || "", size: d.size != null ? String(d.size) : "" });
    setDocModalOpen(true);
    Haptics.selectionAsync();
  }
  async function saveDoc() {
    try {
      if (!jobId) { Alert.alert("Missing job", "Select or pass a job_id to attach documents."); return; }
      if (!docDraft.url.trim()) { Alert.alert("Missing URL", "Enter a document URL."); return; }
      setSavingDoc(true);
      const payload = { job_id: jobId, name: docDraft.name || null, kind: (docDraft.kind || "other"), url: docDraft.url.trim(), mime: docDraft.mime || null, size: docDraft.size === "" ? null : Number(docDraft.size) };
      if (docEditingId) {
        const { error } = await supabase.from("documents").update(payload).eq("id", docEditingId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("documents").insert(payload);
        if (error) throw error;
      }
      await reloadDocuments();
      setDocModalOpen(false);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch (e) {
      Alert.alert("Document error", String(e?.message || e));
    } finally { setSavingDoc(false); }
  }

  /* ---------------- Totals + CIS ---------------- */
  const selectedExpenses = useMemo(() => expenses.filter(e => selectedExpenseIds.has(e.id)), [expenses, selectedExpenseIds]);
  const selectedDocuments = useMemo(() => documents.filter(d => selectedDocIds.has(d.id)), [documents, selectedDocIds]);

  const totals = useMemo(() => {
    const h = parseFloat(hoursQty || "0");
    const r = parseFloat(hourlyRate || "0");
    const vat = parseFloat(taxRate || "0");
    const labour = h > 0 && r > 0 ? h * r : 0;
    const exp = selectedExpenses.reduce((s, e) => s + deriveExpenseTotal(e), 0);
    const travel = Number(travelCharge) || 0;
    const subtotal = labour + exp + travel;
    const tax = Math.round((subtotal * (isNaN(vat) ? 0 : vat) / 100) * 100) / 100;
    const total = subtotal + tax;
    const dep = parseFloat(deposit || "0");
    const depositAmt = isNaN(dep) ? 0 : dep;

    const cisEnabledForInvoice = cisProfileEnabled && cisApply;
    const cisRateNum = Math.min(100, Math.max(0, Number(cisRate || "0")));
    const cisBase = cisProfileExcludeMaterials ? labour : (labour + exp);
    const cisDeduction = cisEnabledForInvoice ? Math.round((cisBase * (cisRateNum / 100)) * 100) / 100 : 0;

    const balance = total - depositAmt - cisDeduction;

    return {
      labour, expenses: exp, travel, subtotal, tax, total,
      deposit: depositAmt,
      cis: { enabled: cisEnabledForInvoice, rate: cisRateNum, base: cisBase, deduction: cisDeduction, excludeMaterials: cisProfileExcludeMaterials },
      balance
    };
  }, [hoursQty, hourlyRate, taxRate, selectedExpenses, deposit, travelCharge, cisApply, cisRate, cisProfileEnabled, cisProfileExcludeMaterials]);

  /* ---------------- Step Control ---------------- */
  function next() { setStep(s => { const n = Math.min(s + 1, TOTAL_STEPS); if (n !== s) Haptics.selectionAsync(); return n; }); }
  function back() { setStep(s => { const n = Math.max(s - 1, 1); if (n !== s) Haptics.selectionAsync(); return n; }); }

  /* ---------------- Generate Invoice ---------------- */
  async function onGenerate() {
    try {
      if (submitting) return;
      if (totals.total <= 0) { Alert.alert("Nothing to bill", "Add hours or include at least one expense."); return; }
      if (Number(hoursQty) > 0 && Number(hourlyRate) <= 0) { Alert.alert("Hourly rate required", "Set your hourly rate in Settings → Business Profile, then try again."); return; }

      setSubmitting(true);

      // build IDs/URLs for payload
      const selectedExpenseIdsArr = expenses.filter(e => selectedExpenseIds.has(e.id)).map(e => e.id);
      const selectedDocUrlsArr = documents.filter(d => selectedDocIds.has(d.id)).map(d => d.url).filter(Boolean);

      const payload = {
        job_id: jobId || null,
        quote_id: params.quote_id || sourceQuoteId || null,
        client_id: job?.client_id || null,
        hours_qty: Number(hoursQty || "0"),
        hourly_rate: Number(hourlyRate || "0"),
        tax_rate_percent: Number(taxRate || "0"),
        due_in_days: Number(dueDays || "14"),
        deposit_amount: Number(deposit || "0"),
        note: note || null,
        billable_expense_ids: selectedExpenseIdsArr,
        attachment_paths: selectedDocUrlsArr,
        currency: currency || "GBP",
        client_snapshot: {
          name: clientName || null,
          email: clientEmail || null,
          phone: clientPhone || null,
          address: clientAddress || null
        },
        cis: {
          enabled: totals.cis.enabled,
          rate_percent: totals.cis.rate,
          deduction_amount: totals.cis.deduction,
          base_amount: totals.cis.base,
          exclude_materials: totals.cis.excludeMaterials
        },
        travel_charge: Number(travelCharge || 0),
        distance_miles_one_way: Number(distanceMiles || 0),
        template_code: templateCode || null
      };

      const { data, error } = await supabase.functions.invoke("create_invoice", { body: payload });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || "Unknown error");

      const createdInvoiceId = String(data.invoice_id || "");
      let readyUrl = data.pdf_signed_url || "";
      if (!readyUrl && data.pdf_path) {
        try {
          const { data: sig } = await supabase.storage.from(data.bucket || "secured").createSignedUrl(data.pdf_path, 600);
          readyUrl = sig?.signedUrl || "";
        } catch {}
      }
      for (let i = 0; i < 10; i++) {
        if (readyUrl && await probeUrl(readyUrl)) break;
        await sleep(250);
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.push({ pathname: "/invoices/preview", params: { invoice_id: createdInvoiceId } });
    } catch (e) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert("Error", String(e?.message || e));
    } finally {
      setSubmitting(false);
    }
  }

  const actionsDisabled = submitting || loadingDefaults || loadingExpenses || loadingDocs;
  const loading = loadingDefaults || loadingExpenses || loadingDocs;

  const roClient = job ? {
    name: job.client_name || fallbackClient.name || "",
    email: job.client_email || fallbackClient.email || "",
    phone: job.client_phone || fallbackClient.phone || "",
    address: job.client_address || fallbackClient.address || ""
  } : fallbackClient;

  const { width } = Dimensions.get("window");

  /* ---------------- UI Render ---------------- */
  return (
    <View style={{ flex: 1, backgroundColor: BG }}>
      <StatusBar barStyle="dark-content" backgroundColor="#ffffff" translucent={false} />
      <View style={{ height: insets.top, backgroundColor: CARD }} />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => {
          if (step > 1) {
            back();
          } else {
            Haptics.selectionAsync();
            router.back();
          }
        }}>
          <Feather name="arrow-left" size={20} color={TEXT} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Create Invoice</Text>
        <TouchableOpacity style={styles.backBtn} onPress={() => { Haptics.selectionAsync(); router.back(); }}>
          <Feather name="x" size={20} color={TEXT} />
        </TouchableOpacity>
      </View>

      {/* Content */}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 100 }}>
        {/* Step progress */}
        <View style={styles.stepProgress}>
          <View style={styles.stepRow}>
            <Text style={styles.stepTitle}>{STEP_TITLES[step - 1]}</Text>
            <Text style={styles.stepCounter}>Step {step} of {TOTAL_STEPS}</Text>
          </View>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: (step / TOTAL_STEPS) * 100 + "%" }]} />
          </View>
        </View>

        {loading ? (
          <View style={styles.card}>
            <View style={{ alignItems: "center", justifyContent: "center", paddingVertical: 40 }}>
              <ActivityIndicator size="large" color={BRAND} />
              <Text style={{ color: MUTED, marginTop: 12, fontSize: 14 }}>Loading…</Text>
            </View>
          </View>
        ) : (
          <>
            {/* Step 1: Hours + Travel */}
            {step === 1 && (
              <>
                <View style={styles.card}>
                  <View style={styles.cardHeader}>
                    <Text style={styles.cardTitle}>Hours worked</Text>
                    <InfoButton title="Hours" tips={[
                      "Hours: Enter the time you actually worked on the job.",
                      "Rate: Pulled from your Business Profile.",
                      "Auto-fill: We infer hours from labour lines in the quote."
                    ]} />
                  </View>
                  <Label>Hours</Label>
                  <Input keyboardType="decimal-pad" value={hoursQty} onChangeText={setHoursQty} placeholder="e.g. 8" />
                  <Label>Hourly rate ({currency})</Label>
                  <Input keyboardType="decimal-pad" value={hourlyRate} onChangeText={() => {}} editable={false} style={{ opacity: 0.7 }} placeholder="Set in Settings → Business Profile" />
                  <Text style={styles.hint}>This rate is pulled from your profile.</Text>
                </View>

                <View style={styles.card}>
                  <View style={styles.cardHeader}>
                    <Text style={styles.cardTitle}>Travel & Distance</Text>
                    <InfoButton title="Travel & Distance" tips={[
                      "Distance: One-way miles from your business address.",
                      "Charge: Round trip × your per-mile rate.",
                      "Tip: Fix the site address in the job/quote if it looks off."
                    ]} />
                  </View>
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    <View style={{ flex: 1 }}>
                      <Label>Distance (miles)</Label>
                      <Input
                        placeholder="Distance"
                        keyboardType="decimal-pad"
                        value={distanceMiles}
                        onChangeText={setDistanceMiles}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Label>Travel Charge</Label>
                      <View style={styles.calcRow}>
                        {autoDistLoading ? (
                          <ActivityIndicator size="small" color={BRAND} />
                        ) : (
                          <Text style={styles.calcValue}>
                            {currency} {(travelCharge || 0).toFixed(2)}
                          </Text>
                        )}
                      </View>
                    </View>
                  </View>
                  <Text style={styles.hint}>Travel calculated as round trip at {profile?.travel_rate_per_mile || 0} per mile.</Text>
                </View>
              </>
            )}

            {/* Step 2: Expenses */}
            {step === 2 && (
              <View style={styles.card}>
                <View style={styles.cardHeader}>
                  <Text style={styles.cardTitle}>Expenses</Text>
                  <InfoButton title="Expenses" tips={[
                    "Tick to include: Only ticked items appear on the invoice.",
                    "Totals: If qty & unit cost exist, we auto-calc total.",
                    "Edit: Tap the pencil to change or add an expense."
                  ]} />
                </View>
                <Text style={styles.hint}>Tick items to include on the invoice.</Text>
                {expenses.length === 0 && <Text style={{ color: MUTED, marginTop: 12 }}>No expenses yet.</Text>}
                {expenses.map((ex) => {
                  const included = selectedExpenseIds.has(ex.id);
                  const displayTotal = deriveExpenseTotal(ex);
                  return (
                    <View key={ex.id} style={styles.rowLine}>
                      <Checkbox checked={included} onPress={() => setSelectedExpenseIds(prev => { const next = new Set(prev); next.has(ex.id) ? next.delete(ex.id) : next.add(ex.id); return next; })} />
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: TEXT, fontWeight: "600" }}>
                          {ex.name || "Item"}{ex.qty ? " • " + ex.qty + (ex.unit ? " " + ex.unit : "") : ""}
                        </Text>
                        <Text style={{ color: MUTED, fontSize: 12 }}>
                          {currency} {money(displayTotal)}{ex.date ? " • " + String(ex.date) : ""}
                        </Text>
                      </View>
                      <TouchableOpacity onPress={() => openEditExpense(ex)} style={styles.iconBtn}>
                        <Feather name="edit-2" size={16} color={TEXT} />
                      </TouchableOpacity>
                    </View>
                  );
                })}
                <TouchableOpacity onPress={openAddExpense} style={styles.actionBtn}>
                  <Text style={styles.actionBtnText}>Add expense</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Step 3: Attachments */}
            {step === 3 && (
              <View style={styles.card}>
                <View style={styles.cardHeader}>
                  <Text style={styles.cardTitle}>Attachments</Text>
                  <InfoButton title="Attachments" tips={[
                    "Merge: Ticked PDFs are merged into the invoice.",
                    "Images: Convert images to PDF if you need them merged.",
                    "Order: We use upload order."
                  ]} />
                </View>
                <Text style={styles.hint}>Tick files to merge into the invoice PDF.</Text>
                {documents.length === 0 && <Text style={{ color: MUTED, marginTop: 12 }}>No documents yet.</Text>}
                {documents.map((d) => {
                  const included = selectedDocIds.has(d.id);
                  return (
                    <View key={d.id} style={styles.rowLine}>
                      <Checkbox checked={included} onPress={() => setSelectedDocIds(prev => { const next = new Set(prev); next.has(d.id) ? next.delete(d.id) : next.add(d.id); return next; })} />
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: TEXT, fontWeight: "600" }}>
                          {d.name || "(unnamed)"} • {d.kind || "other"}
                        </Text>
                        <Text style={{ color: MUTED, fontSize: 12 }}>
                          {d.mime || "file"}{d.size ? " • " + d.size + " bytes" : ""}
                        </Text>
                      </View>
                      <TouchableOpacity onPress={() => openEditDoc(d)} style={styles.iconBtn}>
                        <Feather name="edit-2" size={16} color={TEXT} />
                      </TouchableOpacity>
                    </View>
                  );
                })}
                <TouchableOpacity onPress={openAddDoc} style={styles.actionBtn}>
                  <Text style={styles.actionBtnText}>Add document</Text>
                </TouchableOpacity>
                <Text style={[styles.hint, { marginTop: 8 }]}>We merge PDFs server-side. Images ignored unless you add image→PDF.</Text>
              </View>
            )}

            {/* Step 4: Deposit */}
            {step === 4 && (
              <View style={styles.card}>
                <View style={styles.cardHeader}>
                  <Text style={styles.cardTitle}>Deposit (already paid)</Text>
                  <InfoButton title="Deposit" tips={[
                    "Enter any money already paid (e.g. deposit).",
                    "We auto-detect paid (non-voided) payments on this job.",
                    "Deposit reduces balance due, not VAT."
                  ]} />
                </View>
                <Label>Amount paid</Label>
                <Input keyboardType="decimal-pad" value={deposit} onChangeText={setDeposit} placeholder="e.g. 100" />
                {suggestedPaid > 0 ? (
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                    <Text style={styles.hint}>Detected paid on this job: {currency} {money(suggestedPaid)}</Text>
                    {Number(deposit || "0") !== Number(suggestedPaid) ? (
                      <TouchableOpacity onPress={() => setDeposit(String(suggestedPaid))} style={styles.smallBtn}>
                        <Text style={styles.smallBtnText}>Use {currency} {money(suggestedPaid)}</Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                ) : (
                  <Text style={styles.hint}>Enter any amount already paid (e.g. a deposit).</Text>
                )}
              </View>
            )}

            {/* Step 5: Client */}
            {step === 5 && (
              <View style={styles.card}>
                <View style={styles.cardHeader}>
                  <Text style={styles.cardTitle}>Client</Text>
                  <InfoButton title="Client" tips={[
                    "You can edit client details for this invoice snapshot.",
                    "This won't change the saved client or job records.",
                  ]} />
                </View>
                <Label>Name</Label>
                <Input value={clientName} onChangeText={setClientName} placeholder="Client name" />
                <Label>Email</Label>
                <Input
                  value={clientEmail}
                  onChangeText={setClientEmail}
                  placeholder="email@example.com"
                  autoCapitalize="none"
                  keyboardType="email-address"
                />
                <Label>Phone</Label>
                <Input
                  value={clientPhone}
                  onChangeText={setClientPhone}
                  placeholder="+44…"
                  keyboardType="phone-pad"
                />
                <Label>Address</Label>
                <Input
                  value={clientAddress}
                  onChangeText={setClientAddress}
                  placeholder="Address"
                  multiline
                  numberOfLines={4}
                  style={{ minHeight: 96, textAlignVertical: "top" }}
                />
                {!job && <Text style={styles.hint}>Using details from the quote.</Text>}
              </View>
            )}

            {/* Step 6: Terms (+ CIS) */}
            {step === 6 && (
              <View style={styles.card}>
                <View style={styles.cardHeader}>
                  <Text style={styles.cardTitle}>Terms</Text>
                  <InfoButton title="Terms" tips={[
                    "Due in: Days until payment is due.",
                    "VAT: Use your VAT rate (e.g. 20).",
                    "CIS: If enabled in your profile, you can apply CIS here.",
                  ]} />
                </View>
                <Label>Due in (days)</Label>
                <Input keyboardType="number-pad" value={dueDays} onChangeText={setDueDays} placeholder="14" />
                <Label>Tax rate % (VAT)</Label>
                <Input keyboardType="decimal-pad" value={taxRate} onChangeText={setTaxRate} placeholder="20" />
                <Label>Currency</Label>
                <Input value={currency} onChangeText={setCurrency} placeholder="GBP" />
                <Label>Note / Terms</Label>
                <Input multiline numberOfLines={4} value={note} onChangeText={setNote} placeholder="Any terms or notes…" style={{ minHeight: 100, textAlignVertical: "top" }} />

                {/* CIS */}
                {cisProfileEnabled ? (
                  <View style={[styles.card, { marginTop: 12, marginBottom: 0 }]}>
                    <View style={styles.cardHeader}>
                      <Text style={styles.cardTitle}>CIS (UK)</Text>
                      <InfoButton title="CIS" tips={[
                        "CIS deduction is withheld by the contractor.",
                        "Deduction applies to labour only when 'exclude materials' is on.",
                        "VAT is calculated on the subtotal; CIS reduces the amount due.",
                      ]} />
                    </View>
                    <View style={styles.rowLine}>
                      <Text style={{ color: TEXT, fontWeight: "800" }}>Apply CIS to this invoice</Text>
                      <SwitchLike checked={cisApply} onChange={setCisApply} />
                    </View>
                    <Label>Rate (%)</Label>
                    <Input
                      keyboardType="decimal-pad"
                      value={cisRate}
                      onChangeText={(t) => setCisRate(t.replace(/[^0-9.]/g, ""))}
                      placeholder="20"
                    />
                    <Text style={styles.hint}>
                      Base used: {cisProfileExcludeMaterials ? "Labour only" : "Labour + expenses"}.
                    </Text>
                  </View>
                ) : (
                  <Text style={[styles.hint, { marginTop: 8 }]}>
                    To enable CIS defaults, go to Settings → CIS (UK).
                  </Text>
                )}
              </View>
            )}

            {/* Step 7: Template */}
            {step === 7 && (
              <View style={styles.card}>
                <View style={styles.cardHeader}>
                  <Text style={styles.cardTitle}>Template</Text>
                  <InfoButton title="Template" tips={[
                    "Choose how your invoice PDF will look.",
                    "Preview updates automatically below.",
                    "This uses the same templates as Quotes and Deposit Invoices."
                  ]} />
                </View>
                <TemplatePicker
                  selected={templateCode}
                  onSelect={setTemplateCode}
                />
              </View>
            )}

            {/* Step 8: Review */}
            {step === 8 && (
              <View style={styles.card}>
                <View style={styles.cardHeader}>
                  <Text style={styles.cardTitle}>Review</Text>
                  <InfoButton title="Review" tips={[
                    "Double-check hours, expenses, tax, deposit, and CIS.",
                    "Ensure the right PDFs are ticked to merge.",
                    "Confirm currency for this client."
                  ]} />
                </View>
                <View style={styles.reviewRow}>
                  <Text style={styles.reviewLabel}>Hours</Text>
                  <Text style={styles.reviewValue}>{String(hoursQty) + " @ " + currency + " " + String(hourlyRate) + "/h"}</Text>
                </View>
                <View style={styles.reviewRow}>
                  <Text style={styles.reviewLabel}>Client</Text>
                  <Text style={styles.reviewValue}>{clientName || "(none)"}</Text>
                </View>
                {!!clientEmail && (
                  <View style={styles.reviewRow}>
                    <Text style={styles.reviewLabel}>Email</Text>
                    <Text style={styles.reviewValue}>{clientEmail}</Text>
                  </View>
                )}
                {!!clientPhone && (
                  <View style={styles.reviewRow}>
                    <Text style={styles.reviewLabel}>Phone</Text>
                    <Text style={styles.reviewValue}>{clientPhone}</Text>
                  </View>
                )}
                <View style={styles.reviewRow}>
                  <Text style={styles.reviewLabel}>Expenses included</Text>
                  <Text style={styles.reviewValue}>{selectedExpenses.length}</Text>
                </View>
                <View style={styles.reviewRow}>
                  <Text style={styles.reviewLabel}>Attachments to merge</Text>
                  <Text style={styles.reviewValue}>{selectedDocuments.length}</Text>
                </View>
                <View style={styles.reviewRow}>
                  <Text style={styles.reviewLabel}>Tax rate</Text>
                  <Text style={styles.reviewValue}>{String(taxRate) + "%"}</Text>
                </View>
                <View style={styles.reviewRow}>
                  <Text style={styles.reviewLabel}>Due in</Text>
                  <Text style={styles.reviewValue}>{String(dueDays) + " days"}</Text>
                </View>
                <View style={styles.reviewRow}>
                  <Text style={styles.reviewLabel}>Currency</Text>
                  <Text style={styles.reviewValue}>{currency}</Text>
                </View>
                {totals?.cis?.enabled && (
                  <>
                    <View style={styles.reviewRow}>
                      <Text style={styles.reviewLabel}>CIS rate</Text>
                      <Text style={styles.reviewValue}>{totals.cis.rate}%</Text>
                    </View>
                    <View style={styles.reviewRow}>
                      <Text style={styles.reviewLabel}>CIS base</Text>
                      <Text style={styles.reviewValue}>{currency} {money(totals.cis.base)}</Text>
                    </View>
                    <View style={styles.reviewRow}>
                      <Text style={styles.reviewLabel}>CIS deduction</Text>
                      <Text style={styles.reviewValue}>- {currency} {money(totals.cis.deduction)}</Text>
                    </View>
                  </>
                )}
                {!!note && (
                  <View style={{ marginTop: 12 }}>
                    <Text style={{ color: MUTED, fontSize: 12, marginBottom: 4 }}>Note</Text>
                    <Text style={{ color: TEXT }}>{note}</Text>
                  </View>
                )}
              </View>
            )}

            {/* Totals Card */}
            <View style={styles.totalsCard}>
              <Totals totals={totals} currency={currency} />
            </View>
          </>
        )}
      </ScrollView>

      {/* Sticky Bottom Action Bar */}
      <View style={[styles.actionBarContainer, { paddingBottom: insets.bottom }]}>
        <View style={styles.actionBarContent}>
          <TouchableOpacity
            style={[styles.secondaryActionBtn, { opacity: step === 1 || actionsDisabled ? 0.5 : 1 }]}
            onPress={back}
            disabled={step === 1 || actionsDisabled}
          >
            <Text style={[styles.actionBtnText, { color: TEXT }]}>Back</Text>
          </TouchableOpacity>

          {step < TOTAL_STEPS && (
            <TouchableOpacity
              style={[styles.primaryActionBtn, { opacity: actionsDisabled ? 0.5 : 1 }]}
              onPress={next}
              disabled={actionsDisabled}
            >
              <Text style={[styles.actionBtnText, { color: "#ffffff" }]}>Next</Text>
            </TouchableOpacity>
          )}

          {step === TOTAL_STEPS && (
            <TouchableOpacity
              style={[styles.primaryActionBtn, { opacity: actionsDisabled || totals.total <= 0 ? 0.5 : 1 }]}
              onPress={onGenerate}
              disabled={actionsDisabled || totals.total <= 0}
            >
              <Text style={[styles.actionBtnText, { color: "#ffffff" }]}>
                {submitting ? "Creating…" : "Generate"}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      <View style={{ height: insets.bottom, backgroundColor: "#ffffff" }} />

      {/* Expense Editor */}
      <CenteredEditor visible={expModalOpen} onClose={() => setExpModalOpen(false)}>
        <Text style={{ color: TEXT, fontWeight: "800", fontSize: 16, marginBottom: 16 }}>
          {expEditingId ? "Edit expense" : "Add expense"}
        </Text>

        <Label>Name</Label>
        <Input
          value={expDraft.name}
          onChangeText={(t) => setExpDraft(s => ({ ...s, name: t }))}
          placeholder="Item"
        />

        <View style={{ flexDirection: "row", gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Label>Qty</Label>
            <Input
              keyboardType="decimal-pad"
              value={expDraft.qty}
              onChangeText={(t) => setExpDraft(s => ({ ...s, qty: t }))}
              placeholder="e.g. 5"
            />
          </View>
          <View style={{ flex: 1 }}>
            <Label>Unit</Label>
            <Input
              value={expDraft.unit}
              onChangeText={(t) => setExpDraft(s => ({ ...s, unit: t }))}
              placeholder="hrs / pcs / m"
            />
          </View>
        </View>

        <View style={{ flexDirection: "row", gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Label>Unit cost</Label>
            <Input
              keyboardType="decimal-pad"
              value={expDraft.unit_cost}
              onChangeText={(t) => setExpDraft(s => ({ ...s, unit_cost: t }))}
              placeholder="e.g. 25"
            />
          </View>
          <View style={{ flex: 1 }}>
            <Label>Total</Label>
            <Input
              keyboardType="decimal-pad"
              value={expDraft.total}
              onChangeText={(t) => setExpDraft(s => ({ ...s, total: t }))}
              placeholder="auto if blank"
            />
          </View>
        </View>

        <Label>Date (YYYY-MM-DD)</Label>
        <Input
          value={expDraft.date}
          onChangeText={(t) => setExpDraft(s => ({ ...s, date: t }))}
          placeholder={todayISO()}
        />

        <Label>Notes</Label>
        <Input
          value={expDraft.notes}
          onChangeText={(t) => setExpDraft(s => ({ ...s, notes: t }))}
          placeholder="Optional"
          multiline
          style={{ minHeight: 80, textAlignVertical: "top" }}
        />

        <View style={{ flexDirection: "row", gap: 8, marginTop: 16 }}>
          <Btn variant="secondary" onPress={() => setExpModalOpen(false)}>Cancel</Btn>
          <Btn onPress={saveExpense} variant="primary" disabled={savingExpense}>
            {savingExpense ? "Saving…" : "Save"}
          </Btn>
        </View>
      </CenteredEditor>

      {/* Document Editor */}
      <CenteredEditor visible={docModalOpen} onClose={() => setDocModalOpen(false)}>
        <Text style={{ color: TEXT, fontWeight: "800", fontSize: 16, marginBottom: 16 }}>
          {docEditingId ? "Edit document" : "Add document"}
        </Text>

        <Label>Name</Label>
        <Input
          value={docDraft.name}
          onChangeText={(t) => setDocDraft(s => ({ ...s, name: t }))}
          placeholder="e.g. Receipt / Photo / Quote PDF"
        />

        <Label>Kind</Label>
        <Input
          value={docDraft.kind}
          onChangeText={(t) => setDocDraft(s => ({ ...s, kind: t }))}
          placeholder="quote | photo | receipt | other | quote_pdf"
        />

        <Label>URL</Label>
        <Input
          value={docDraft.url}
          onChangeText={(t) => setDocDraft(s => ({ ...s, url: t }))}
          placeholder="https://…"
          autoCapitalize="none"
        />

        <View style={{ flexDirection: "row", gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Label>MIME</Label>
            <Input
              value={docDraft.mime}
              onChangeText={(t) => setDocDraft(s => ({ ...s, mime: t }))}
              placeholder="application/pdf"
              autoCapitalize="none"
            />
          </View>
          <View style={{ flex: 1 }}>
            <Label>Size (bytes)</Label>
            <Input
              keyboardType="decimal-pad"
              value={docDraft.size}
              onChangeText={(t) => setDocDraft(s => ({ ...s, size: t }))}
              placeholder="optional"
            />
          </View>
        </View>

        <View style={{ flexDirection: "row", gap: 8, marginTop: 16 }}>
          <Btn variant="secondary" onPress={() => setDocModalOpen(false)}>Cancel</Btn>
          <Btn onPress={saveDoc} variant="primary" disabled={savingDoc}>
            {savingDoc ? "Saving…" : "Save"}
          </Btn>
        </View>
      </CenteredEditor>
    </View>
  );
}

/* ---------------- Shared UI Components ---------------- */
function Label({ children, required = false }) {
  return (
    <Text style={styles.label}>
      {children}
      {required && <Text style={{ color: WARN }}> *</Text>}
    </Text>
  );
}

function Input(props) {
  return (
    <TextInput
      {...props}
      style={[styles.input, props.style || {}]}
      placeholderTextColor={MUTED}
    />
  );
}

function Btn(props) {
  const disabled = !!props.disabled;
  const variant = props.variant || "primary";
  const bg = disabled ? DISABLED : variant === "secondary" ? BORDER : variant === "primary" ? OK : BRAND;
  const color = variant === "secondary" ? TEXT : "#ffffff";
  return (
    <TouchableOpacity
      onPress={disabled ? () => {} : () => { Haptics.selectionAsync(); props.onPress && props.onPress(); }}
      style={[styles.btn, { backgroundColor: bg }]}
    >
      <Text style={[styles.btnText, { color }]}>
        {typeof props.children === "string" ? props.children : "Button"}
      </Text>
    </TouchableOpacity>
  );
}

function Checkbox({ checked, onPress }) {
  return (
    <TouchableOpacity
      onPress={() => {
        Haptics.selectionAsync();
        onPress && onPress();
      }}
      style={[styles.checkbox, {
        borderColor: checked ? BRAND : "#cbd5e1",
        backgroundColor: checked ? BRAND : "#fff",
      }]}
    >
      {checked ? <Feather name="check" size={14} color="#fff" /> : null}
    </TouchableOpacity>
  );
}

// Simple switch-like control
function SwitchLike({ checked, onChange }) {
  return (
    <TouchableOpacity
      onPress={() => { Haptics.selectionAsync(); onChange && onChange(!checked); }}
      style={{
        width: 48, height: 28, borderRadius: 999, borderWidth: 1, borderColor: checked ? BRAND : BORDER,
        backgroundColor: checked ? BRAND : "#fff", padding: 2, justifyContent: "center"
      }}
      activeOpacity={0.8}
    >
      <View style={{
        width: 22, height: 22, borderRadius: 999, backgroundColor: checked ? "#fff" : "#cbd5e1",
        transform: [{ translateX: checked ? 20 : 0 }]
      }}/>
    </TouchableOpacity>
  );
}

function Totals({ totals: t = { subtotal: 0, tax: 0, total: 0, deposit: 0, balance: 0, labour: 0, expenses: 0, travel: 0, cis: { enabled:false, deduction:0, rate:0 } }, currency: cur = "GBP" }) {
  return (
    <View>
      <View style={styles.totalsRow}><Text style={styles.totalsLabel}>Labour</Text><Text style={styles.totalsValue}>{cur} {money(t.labour)}</Text></View>
      <View style={styles.totalsRow}><Text style={styles.totalsLabel}>Expenses</Text><Text style={styles.totalsValue}>{cur} {money(t.expenses)}</Text></View>
      {t.travel > 0 && (
        <View style={styles.totalsRow}><Text style={styles.totalsLabel}>Travel</Text><Text style={styles.totalsValue}>{cur} {money(t.travel)}</Text></View>
      )}
      <View style={styles.totalsRow}><Text style={styles.totalsLabel}>Subtotal</Text><Text style={styles.totalsValue}>{cur} {money(t.subtotal)}</Text></View>
      <View style={styles.totalsRow}><Text style={styles.totalsLabel}>Tax</Text><Text style={styles.totalsValue}>{cur} {money(t.tax)}</Text></View>
      <View style={styles.totalsRow}><Text style={[styles.totalsValue, { fontWeight: "800" }]}>Total</Text><Text style={[styles.totalsValue, { fontWeight: "800" }]}>{cur} {money(t.total)}</Text></View>
      {t.deposit > 0 ? (
        <View style={styles.totalsRow}><Text style={styles.totalsLabel}>Deposit</Text><Text style={styles.totalsValue}>- {cur} {money(t.deposit)}</Text></View>
      ) : null}
      {t?.cis?.enabled && t?.cis?.deduction > 0 ? (
        <View style={styles.totalsRow}>
          <Text style={styles.totalsLabel}>CIS deduction ({t.cis.rate}%)</Text>
          <Text style={styles.totalsValue}>- {cur} {money(t.cis.deduction)}</Text>
        </View>
      ) : null}
      <View style={styles.totalsRow}><Text style={styles.totalsValue}>Balance due</Text><Text style={styles.totalsValue}>{cur} {money(t.balance)}</Text></View>
    </View>
  );
}

/* -------- CenteredEditor -------- */
function CenteredEditor({ visible, onClose, children }) {
  const { width } = Dimensions.get("window");
  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      presentationStyle="overFullScreen"
      onRequestClose={onClose}
    >
      <View style={{ position: "absolute", inset: 0, backgroundColor: "rgba(0,0,0,0.5)" }} />
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: 12 }}>
        <View style={[styles.modalCard, { width: Math.min(width - 32, 560) }]}>
          <View style={{ flexDirection: "row", justifyContent: "flex-end", marginBottom: 8 }}>
            <TouchableOpacity onPress={onClose} style={styles.smallBtn}>
              <Text style={styles.smallBtnText}>Close</Text>
            </TouchableOpacity>
          </View>
          {children}
        </View>
      </View>
    </Modal>
  );
}

/* ---------------- Info helpers ---------------- */
function InfoButton({ title = "Info", tips = [], inline = false }) {
  const [open, setOpen] = useState(false);
  if (inline) {
    return (
      <>
        <TouchableOpacity onPress={() => { Haptics.selectionAsync(); setOpen(true); }} style={styles.infoBtn}>
          <Feather name="info" size={16} color={MUTED} />
        </TouchableOpacity>
        <InfoSheet open={open} onClose={() => setOpen(false)} title={title} tips={tips} />
      </>
    );
  }
  return (
    <>
      <TouchableOpacity onPress={() => { Haptics.selectionAsync(); setOpen(true); }} style={styles.infoBtn}>
        <Feather name="info" size={16} color={MUTED} />
      </TouchableOpacity>
      <InfoSheet open={open} onClose={() => setOpen(false)} title={title} tips={tips} />
    </>
  );
}

function InfoSheet({ open, onClose, title, tips = [] }) {
  const { width } = Dimensions.get("window");
  return (
    <Modal visible={open} animationType="fade" transparent onRequestClose={onClose}>
      <View style={{ position: "absolute", inset: 0, backgroundColor: "rgba(0,0,0,0.4)" }} />
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: 14 }}>
        <View style={[styles.modalCard, { width: Math.min(width - 32, 520) }]}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <Text style={{ color: TEXT, fontWeight: "800", fontSize: 16 }}>{title}</Text>
            <TouchableOpacity onPress={onClose} style={styles.smallBtn}>
              <Text style={styles.smallBtnText}>Close</Text>
            </TouchableOpacity>
          </View>
          {tips.slice(0, 5).map((t, i) => (
            <View key={i} style={{ flexDirection: "row", gap: 8, marginBottom: 8 }}>
              <Text style={{ color: BRAND, fontWeight: "900" }}>•</Text>
              <Text style={{ color: TEXT, flex: 1 }}>{t}</Text>
            </View>
          ))}
        </View>
      </View>
    </Modal>
  );
}

/* ---------------- Styles ---------------- */
const styles = StyleSheet.create({
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
  backBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 18, fontWeight: "900", color: TEXT },

  stepProgress: { marginBottom: 16 },
  stepRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
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
      ios: { shadowColor: "#0b1220", shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } },
      android: { elevation: 3 },
    }),
  },
  cardHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  cardTitle: { color: TEXT, fontWeight: "800", fontSize: 16 },

  label: { color: TEXT, fontWeight: "800", marginBottom: 6 },
  input: {
    backgroundColor: CARD, borderColor: BORDER, borderWidth: 1, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 12, color: TEXT, marginBottom: 12,
  },
  hint: { color: MUTED, fontSize: 12, marginTop: -6, marginBottom: 8 },

  btn: { flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: "center" },
  btnText: { fontWeight: "800" },
  smallBtn: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8, backgroundColor: "#f3f4f6" },
  smallBtnText: { color: TEXT, fontWeight: "700", fontSize: 12 },

  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, alignItems: "center", justifyContent: "center" },

  rowLine: {
    flexDirection: "row", gap: 12, alignItems: "center", paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: BORDER,
  },

  iconBtn: { padding: 8, borderRadius: 8 },
  actionBtn: { marginTop: 12, backgroundColor: BRAND, borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  actionBtnText: { color: "#fff", fontWeight: "800" },

  kvRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: BORDER },
  kvLabel: { color: MUTED, fontWeight: "600" },
  kvValue: { color: TEXT, textAlign: "right", maxWidth: "65%", fontWeight: "600" },

  reviewRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: BORDER },
  reviewLabel: { color: MUTED, fontWeight: "600" },
  reviewValue: { color: TEXT, fontWeight: "600", textAlign: "right" },

  totalsCard: {
    backgroundColor: CARD, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: BORDER, marginBottom: 16,
    ...Platform.select({ ios: { shadowColor: "#0b1220", shadowOpacity: 0.08, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } }, android: { elevation: 4 } }),
  },
  totalsRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6 },
  totalsLabel: { color: MUTED, fontWeight: "600" },
  totalsValue: { color: TEXT, fontWeight: "600" },

  calcRow: {
    backgroundColor: "#eef2f7", borderWidth: 1, borderColor: BORDER, paddingVertical: 12, paddingHorizontal: 14,
    borderRadius: 10, marginBottom: 12, alignItems: "center", justifyContent: "center"
  },
  calcValue: { color: TEXT, fontWeight: "900" },

  actionBarContainer: {
    backgroundColor: CARD,
    borderTopWidth: 1,
    borderTopColor: BORDER,
    paddingHorizontal: 16,
    paddingTop: 10
  },
  actionBarContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10
  },
  primaryActionBtn: {
    flex: 1,
    backgroundColor: BRAND,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center"
  },
  secondaryActionBtn: {
    flex: 1,
    backgroundColor: "#f3f4f6",
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center"
  },
  infoBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f3f4f6"
  },
  modalCard: {
    backgroundColor: CARD,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: BORDER
  }
});