// app/(app)/invoices/wizard.js
import React, { useEffect, useMemo, useState } from "react";
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  ActivityIndicator, Alert, Modal, Platform, Pressable, Dimensions,
  StatusBar, PlatformColor
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { supabase } from "../../../lib/supabase";
import * as Haptics from "expo-haptics";
import { BlurView } from "expo-blur";
import { Feather } from "@expo/vector-icons";
import * as NavigationBar from "expo-navigation-bar";

// ---- System background (matches status/nav bar) ----
const sysBG =
  Platform.OS === "ios"
    ? PlatformColor?.("systemGray6") ?? "#EEF2F6"
    : PlatformColor?.("@android:color/system_neutral2_100") ?? "#EEF2F6";

const BG = sysBG;        // Use for Views (PlatformColor OK)
const BG_HEX = "#eEF2F6"; // Use for StatusBar/NavigationBar ONLY

const CARD = "#ffffff";
const TEXT = "#0b1220";
const MUTED = "#6b7280";
const BRAND = "#2a86ff";
const OK = "#16a34a";
const DISABLED = "#9ca3af";
const BORDER = "#e5e7eb";

function money(n) { if (!isFinite(n)) return "0.00"; return (Math.round(n * 100) / 100).toFixed(2); }
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function todayISO() { return new Date().toISOString().slice(0,10); }

const TOTAL_STEPS = 7;
const STEP_TITLES = ["Hours","Expenses","Attachments","Deposit","Client","Terms","Review"];

// leave enough space so content never hides behind footer
const FOOTER_SPACE = 220;

export default function InvoiceWizard() {
  const params = useLocalSearchParams();
  const initialJobIdParam = String(params.job_id || "");
  const quoteId = params.quote_id ? String(params.quote_id) : "";
  const router = useRouter();

  const [visible, setVisible] = useState(true);
  const [step, setStep] = useState(1);

  const [loadingDefaults, setLoadingDefaults] = useState(true);
  const [jobId, setJobId] = useState(initialJobIdParam);
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

  // Match OS chrome
  useEffect(() => {
    StatusBar.setBarStyle("dark-content");
    if (Platform.OS === "android") {
      StatusBar.setBackgroundColor(BG_HEX, true); // must be a plain string
      (async () => { try { await NavigationBar.setBackgroundColorAsync(BG_HEX); } catch {} })();
    }
  }, []);

  // ---------- Load profile defaults ----------
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
          .select("invoice_terms, invoice_due_days, invoice_tax_rate, invoice_currency, default_hourly_rate, hourly_rate")
          .eq("id", user.id)
          .single();

        if (!error && alive && data) {
          const profDefault = Number(data.default_hourly_rate);
          const profLegacy  = Number(data.hourly_rate);
          const effectiveHourly =
            Number.isFinite(profDefault) && profDefault > 0 ? profDefault :
            Number.isFinite(profLegacy)  && profLegacy  > 0 ? profLegacy  : 0;

          setHourlyRate(effectiveHourly > 0 ? String(effectiveHourly) : "0");
          if (typeof data.invoice_due_days === "number") setDueDays(String(data.invoice_due_days));
          if (typeof data.invoice_tax_rate === "number") setTaxRate(String(data.invoice_tax_rate));
          if (data.invoice_currency) setCurrency(data.invoice_currency);
          if (data.invoice_terms && !note) setNote(data.invoice_terms);
        }
      } finally {
        if (alive) setLoadingDefaults(false);
      }
    })();
    return () => { alive = false; };
  }, []); // eslint-disable-line

  // ---------- Prefill from QUOTE ----------
  useEffect(() => {
    let alive = true;
    if (!quoteId) return;
    (async () => {
      try {
        const q = await supabase
          .from("quotes")
          .select("id, job_id, client_name, client_email, client_phone, client_address, line_items")
          .eq("id", quoteId)
          .single();
        if (q.error || !q.data || !alive) return;

        if (!jobId && q.data.job_id) setJobId(String(q.data.job_id));

        setFallbackClient({
          name: q.data.client_name || "",
          email: q.data.client_email || "",
          phone: q.data.client_phone || "",
          address: q.data.client_address || "",
        });

        const li = Array.isArray(q.data.line_items) ? q.data.line_items : [];
        const timeKinds = ["hour", "hours", "time", "labour", "labor"];
        let inferred = 0;
        for (const row of li) {
          const kindRaw = row && (row.kind ?? row.type);
          const kind = String(kindRaw || "").toLowerCase();
          if (!timeKinds.includes(kind)) continue;
          const total = num(row?.total ?? row?.amount ?? 0);
          let rate = num(row?.unit_price ?? row?.unitPrice ?? 0);
          if (!rate) rate = num(hourlyRate);
          if (total > 0 && rate > 0) {
            inferred += total / rate;
          } else {
            const desc = String(row?.description || "");
            const m = desc.match(/(\d+(?:\.\d+)?)\s*(?:hr|hrs|hours)/i);
            if (m) inferred += num(m[1]);
          }
        }
        if (inferred > 0 && num(hoursQty) <= 1) {
          setHoursQty(String(Math.round(inferred * 100) / 100));
        }
      } catch {}
    })();
    return () => { alive = false; };
  }, [quoteId, hourlyRate]); // eslint-disable-line

  // ---------- Load job + expenses + documents ----------
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
      setSelectedExpenseIds(new Set(list.map(e => e.id))); // select all by default
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
      setSelectedDocIds(new Set(list.map(d => d.id))); // select all by default
    }
  }
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
              start_date, end_date, duration_days, total, status
            `)
            .eq("id", jobId)
            .single();
          if (!j.error && alive) setJob(j.data || null);
        }
        await Promise.all([reloadExpenses(jobId), reloadDocuments(jobId)]);
      } finally {
        if (alive) { setLoadingExpenses(false); setLoadingDocs(false); }
      }
    })();
    return () => { alive = false; };
  }, [jobId]); // eslint-disable-line

  // ---------- Expense editor ----------
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
      if (!userId || !jobId) { Alert.alert("Missing context","Login or select a job first."); return; }
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
        fingerprint: `ui-${Date.now()}-${Math.random().toString(36).slice(2,8)}`
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

  // ---------- Document editor ----------
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

  // include toggles
  function toggleExpense(id) {
    setSelectedExpenseIds(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
    Haptics.selectionAsync();
  }
  function toggleDoc(id) {
    setSelectedDocIds(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
    Haptics.selectionAsync();
  }

  const selectedExpenses = useMemo(() => expenses.filter(e => selectedExpenseIds.has(e.id)), [expenses, selectedExpenseIds]);
  const selectedDocuments = useMemo(() => documents.filter(d => selectedDocIds.has(d.id)), [documents, selectedDocIds]);

  const totals = useMemo(() => {
    const h = parseFloat(hoursQty || "0");
    const r = parseFloat(hourlyRate || "0");
    const vat = parseFloat(taxRate || "0");
    const labour = h > 0 && r > 0 ? h * r : 0;
    const exp = selectedExpenses.reduce((s, e) => s + (Number(e.total) || 0), 0);
    const subtotal = labour + exp;
    const tax = Math.round((subtotal * (isNaN(vat) ? 0 : vat) / 100) * 100) / 100;
    const total = subtotal + tax;
    const dep = parseFloat(deposit || "0");
    const balance = total - (isNaN(dep) ? 0 : dep);
    return { labour, expenses: exp, subtotal, tax, total, deposit: isNaN(dep) ? 0 : dep, balance };
  }, [hoursQty, hourlyRate, taxRate, selectedExpenses, deposit]);

  // nav
  function next() { setStep(s => { const n = Math.min(s + 1, TOTAL_STEPS); if (n !== s) Haptics.selectionAsync(); return n; }); }
  function back() { setStep(s => { const n = Math.max(s - 1, 1); if (n !== s) Haptics.selectionAsync(); return n; }); }

  async function onGenerate() {
    try {
      if (submitting) return;
      if (totals.total <= 0) { Alert.alert("Nothing to bill", "Add hours or include at least one expense."); return; }
      if (Number(hoursQty) > 0 && Number(hourlyRate) <= 0) { Alert.alert("Hourly rate required", "Set your hourly rate in Settings → Business Profile, then try again."); return; }

      setSubmitting(true);

      const payload = {
        job_id: jobId || null,
        quote_id: quoteId || null,
        client_id: job?.client_id || null,
        hours_qty: Number(hoursQty || "0"),
        hourly_rate: Number(hourlyRate || "0"),
        tax_rate_percent: Number(taxRate || "0"),
        due_in_days: Number(dueDays || "14"),
        deposit_amount: Number(deposit || "0"),
        note: note || null,
        billable_expense_ids: selectedExpenses.map(e => e.id),
        attachment_paths: selectedDocuments.map(d => d.url).filter(Boolean),
        currency: currency || "GBP",
        client_snapshot: !job ? {
          name: fallbackClient.name || null, email: fallbackClient.email || null,
          phone: fallbackClient.phone || null, address: fallbackClient.address || null
        } : null
      };

      const { data, error } = await supabase.functions.invoke("create_invoice", { body: payload });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || "Unknown error");
      const createdInvoiceId = String(data.invoice_id || "");

      try {
        await supabase.functions.invoke("merge_invoice_attachments", {
          body: { invoice_id: createdInvoiceId, attachment_urls: selectedDocuments.map(d => d.url).filter(Boolean) }
        });
      } catch (_) {}

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.push({ pathname: "/invoices/preview", params: { invoice_id: createdInvoiceId } });
      setVisible(false);
    } catch (e) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert("Error", String(e?.message || e));
    } finally { setSubmitting(false); }
  }

  const loading = loadingDefaults || loadingExpenses || loadingDocs;
  const roClient = job ? {
    name: job.client_name || "", email: job.client_email || "", phone: job.client_phone || "", address: job.client_address || ""
  } : fallbackClient;

  // Centered modal sizing
  const { width, height } = Dimensions.get("window");
  const maxW = Math.min(width - 24, 640);
  const maxH = Math.min(height - 120, 760);

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      onRequestClose={() => { setVisible(false); router.back(); }}
    >
      {/* light blur over existing UI */}
      <BlurView intensity={10} tint="systemThinMaterialLight" style={{ position: "absolute", inset: 0 }} />

      <StatusBar backgroundColor={BG_HEX} barStyle="dark-content" />

      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: 12 }}>
        {/* Modal bubble */}
        <View style={[modalCard, { width: maxW, maxHeight: maxH, backgroundColor: CARD, overflow: "hidden" }]}>
          {/* Header */}
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8, paddingHorizontal: 12 }}>
            <Text style={{ fontSize: 16, fontWeight: "800", color: TEXT }}>Create Invoice</Text>
            <SmallBtn onPress={() => { Haptics.selectionAsync(); setVisible(false); router.back(); }} variant="light">Close</SmallBtn>
          </View>

          {/* Step header */}
          <View style={{ paddingHorizontal: 12 }}>
            <StepHeader step={step} total={TOTAL_STEPS} title={STEP_TITLES[step-1]} />
          </View>

          {/* CONTENT – scrollable */}
          <View style={{ flex: 1, paddingHorizontal: 12 }}>
            {loading ? (
              <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
                <ActivityIndicator />
                <Text style={{ color: MUTED, marginTop: 6, fontSize: 12 }}>Loading…</Text>
              </View>
            ) : (
              <>
                <ScrollView
                  style={{ flex: 1 }}
                  contentContainerStyle={{ paddingBottom: FOOTER_SPACE }}
                  showsVerticalScrollIndicator={false}
                >
                  {/* Step 1 */}
                  {step === 1 && (
                    <View style={{ gap: 6 }}>
                      <Card>
                        <Label>Hours worked</Label>
                        <Input keyboardType="decimal-pad" value={hoursQty} onChangeText={setHoursQty} placeholder="e.g. 8" />
                        <Label>Hourly rate ({currency})</Label>
                        <Input keyboardType="decimal-pad" value={hourlyRate} onChangeText={() => {}} editable={false} style={{ opacity: 0.7 }} placeholder="Set in Settings → Business Profile" />
                        <Hint>This rate is pulled from your profile.</Hint>
                      </Card>
                    </View>
                  )}

                  {/* Step 2 – Expenses */}
                  {step === 2 && (
                    <View style={{ gap: 6 }}>
                      <Card>
                        <Label>Expenses</Label>
                        <Hint>Tick items to include on the invoice.</Hint>
                        {expenses.length === 0 && <Text style={{ color: MUTED, marginTop: 6 }}>No expenses yet.</Text>}
                        {expenses.map((ex) => {
                          const included = selectedExpenseIds.has(ex.id);
                          return (
                            <RowLine key={ex.id}>
                              <Checkbox checked={included} onPress={() => toggleExpense(ex.id)} />
                              <View style={{ flex: 1 }}>
                                <Text style={{ color: TEXT, fontWeight: "600" }}>
                                  {ex.name || "Item"}{ex.qty ? ` • ${ex.qty}${ex.unit ? ` ${ex.unit}` : ""}` : ""}
                                </Text>
                                <Text style={{ color: MUTED, fontSize: 12 }}>
                                  {currency} {money(Number(ex.total || 0))}{ex.date ? ` • ${String(ex.date)}` : ""}
                                </Text>
                              </View>
                              <IconBtn onPress={() => openEditExpense(ex)} name="edit-2" />
                            </RowLine>
                          );
                        })}
                        <TouchableOpacity onPress={openAddExpense} style={primaryBtn}><Text style={primaryBtnText}>Add expense</Text></TouchableOpacity>
                      </Card>
                    </View>
                  )}

                  {/* Step 3 – Attachments */}
                  {step === 3 && (
                    <View style={{ gap: 6 }}>
                      <Card>
                        <Label>Attachments</Label>
                        <Hint>Tick files to merge into the invoice PDF.</Hint>
                        {documents.length === 0 && <Text style={{ color: MUTED, marginTop: 6 }}>No documents yet.</Text>}
                        {documents.map((d) => {
                          const included = selectedDocIds.has(d.id);
                          return (
                            <RowLine key={d.id}>
                              <Checkbox checked={included} onPress={() => toggleDoc(d.id)} />
                              <View style={{ flex: 1 }}>
                                <Text style={{ color: TEXT, fontWeight: "600" }}>
                                  {d.name || "(unnamed)"} • {d.kind || "other"}
                                </Text>
                                <Text style={{ color: MUTED, fontSize: 12 }}>
                                  {d.mime || "file"}{d.size ? ` • ${d.size} bytes` : ""}
                                </Text>
                              </View>
                              <IconBtn onPress={() => openEditDoc(d)} name="edit-2" />
                            </RowLine>
                          );
                        })}
                        <TouchableOpacity onPress={openAddDoc} style={primaryBtn}><Text style={primaryBtnText}>Add document</Text></TouchableOpacity>
                        <Hint style={{ marginTop: 6 }}>We merge PDFs server-side. Images ignored unless you add image→PDF.</Hint>
                      </Card>
                    </View>
                  )}

                  {/* Step 4 */}
                  {step === 4 && (
                    <View style={{ gap: 6 }}>
                      <Card>
                        <Label>Deposit (already paid)</Label>
                        <Input keyboardType="decimal-pad" value={deposit} onChangeText={setDeposit} placeholder="e.g. 100" />
                      </Card>
                    </View>
                  )}

                  {/* Step 5 */}
                  {step === 5 && (
                    <View style={{ gap: 6 }}>
                      <Card>
                        <Label>Client</Label>
                        <KV label="Name" value={roClient.name || "—"} />
                        <KV label="Email" value={roClient.email || "—"} />
                        <KV label="Phone" value={roClient.phone || "—"} />
                        <KV label="Address" value={roClient.address || "—"} />
                        {!job && <Hint>Using details from the quote.</Hint>}
                      </Card>
                    </View>
                  )}

                  {/* Step 6 */}
                  {step === 6 && (
                    <View style={{ gap: 6 }}>
                      <Card>
                        <Label>Terms</Label>
                        <KVEdit label="Due in (days)"><Input keyboardType="number-pad" value={dueDays} onChangeText={setDueDays} placeholder="14" /></KVEdit>
                        <KVEdit label="Tax rate % (VAT)"><Input keyboardType="decimal-pad" value={taxRate} onChangeText={setTaxRate} placeholder="20" /></KVEdit>
                        <KVEdit label="Currency"><Input value={currency} onChangeText={setCurrency} placeholder="GBP" /></KVEdit>
                        <KVEdit label="Note / Terms"><Input multiline numberOfLines={4} value={note} onChangeText={setNote} placeholder="Any terms or notes…" /></KVEdit>
                      </Card>
                    </View>
                  )}

                  {/* Step 7 – Review */}
                  {step === 7 && (
                    <View style={{ gap: 6 }}>
                      <Card>
                        <Label>Review</Label>
                        <ReviewRow l="Hours" r={`${hoursQty} @ ${currency} ${hourlyRate}/h`} />
                        <ReviewRow l="Client" r={roClient.name || "(none)"} />
                        {!!roClient.email && <ReviewRow l="Email" r={roClient.email} />}
                        {!!roClient.phone && <ReviewRow l="Phone" r={roClient.phone} />}
                        <ReviewRow l="Expenses included" r={selectedExpenses.length} />
                        <ReviewRow l="Attachments to merge" r={selectedDocuments.length} />
                        <ReviewRow l="Tax rate" r={`${taxRate}%`} />
                        <ReviewRow l="Due in" r={dueDays + " days"} />
                        <ReviewRow l="Currency" r={currency} />
                        {!!note && (
                          <View style={{ marginTop: 6 }}>
                            <Text style={{ color: MUTED, fontSize: 12, marginBottom: 4 }}>Note</Text>
                            <Text style={{ color: TEXT }}>{note}</Text>
                          </View>
                        )}
                      </Card>
                    </View>
                  )}
                </ScrollView>

                {/* STICKY FOOTER (full-width, attached) */}
                <View style={footerWrap}>
                  <View style={{ paddingHorizontal: 12, paddingTop: 8 }}>
                    <Totals totals={totals} currency={currency} />
                  </View>
                  <View style={{ flexDirection: "row", gap: 8, paddingHorizontal: 12, paddingBottom: 12, paddingTop: 8 }}>
                    <Btn variant="secondary" onPress={back} disabled={step === 1 || submitting}>Back</Btn>
                    {step < TOTAL_STEPS && <Btn onPress={next} disabled={submitting}>Next</Btn>}
                    {step === TOTAL_STEPS && (
                      <Btn onPress={onGenerate} disabled={submitting || totals.total <= 0} variant="primary">
                        {submitting ? "Creating…" : "Generate"}
                      </Btn>
                    )}
                  </View>
                </View>
              </>
            )}
          </View>

          {/* Expense Editor Modal */}
          <CenteredEditor visible={expModalOpen} onClose={()=>setExpModalOpen(false)}>
            <Text style={{ color: TEXT, fontWeight: "800", fontSize: 15, marginBottom: 6 }}>
              {expEditingId ? "Edit expense" : "Add expense"}
            </Text>
            <Label>Name</Label>
            <Input value={expDraft.name} onChangeText={(t)=>setExpDraft(s=>({...s,name:t}))} placeholder="Item" />
            <View style={{ flexDirection:"row", gap:6 }}>
              <View style={{ flex:1 }}>
                <Label>Qty</Label>
                <Input keyboardType="decimal-pad" value={expDraft.qty} onChangeText={(t)=>setExpDraft(s=>({...s,qty:t}))} placeholder="e.g. 5" />
              </View>
              <View style={{ flex:1 }}>
                <Label>Unit</Label>
                <Input value={expDraft.unit} onChangeText={(t)=>setExpDraft(s=>({...s,unit:t}))} placeholder="hrs / pcs / m" />
              </View>
            </View>
            <View style={{ flexDirection:"row", gap:6 }}>
              <View style={{ flex:1 }}>
                <Label>Unit cost</Label>
                <Input keyboardType="decimal-pad" value={expDraft.unit_cost} onChangeText={(t)=>setExpDraft(s=>({...s,unit_cost:t}))} placeholder="e.g. 25" />
              </View>
              <View style={{ flex:1 }}>
                <Label>Total</Label>
                <Input keyboardType="decimal-pad" value={expDraft.total} onChangeText={(t)=>setExpDraft(s=>({...s,total:t}))} placeholder="auto if blank" />
              </View>
            </View>
            <Label>Date (YYYY-MM-DD)</Label>
            <Input value={expDraft.date} onChangeText={(t)=>setExpDraft(s=>({...s,date:t}))} placeholder={todayISO()} />
            <Label>Notes</Label>
            <Input value={expDraft.notes} onChangeText={(t)=>setExpDraft(s=>({...s,notes:t}))} placeholder="Optional" multiline />
            <View style={{ flexDirection:"row", gap:8, marginTop: 6 }}>
              <Btn variant="secondary" onPress={()=>setExpModalOpen(false)}>Cancel</Btn>
              <Btn onPress={saveExpense} variant="primary">{savingExpense ? "Saving…" : "Save"}</Btn>
            </View>
          </CenteredEditor>

          {/* Document Editor Modal */}
          <CenteredEditor visible={docModalOpen} onClose={()=>setDocModalOpen(false)}>
            <Text style={{ color: TEXT, fontWeight: "800", fontSize: 15, marginBottom: 6 }}>
              {docEditingId ? "Edit document" : "Add document"}
            </Text>
            <Label>Name</Label>
            <Input value={docDraft.name} onChangeText={(t)=>setDocDraft(s=>({...s,name:t}))} placeholder="e.g. Receipt / Photo / Quote PDF" />
            <Label>Kind</Label>
            <Input value={docDraft.kind} onChangeText={(t)=>setDocDraft(s=>({...s,kind:t}))} placeholder="quote | photo | receipt | other | quote_pdf" />
            <Label>URL</Label>
            <Input value={docDraft.url} onChangeText={(t)=>setDocDraft(s=>({...s,url:t}))} placeholder="https://…" autoCapitalize="none" />
            <View style={{ flexDirection:"row", gap:6 }}>
              <View style={{ flex:1 }}>
                <Label>MIME</Label>
                <Input value={docDraft.mime} onChangeText={(t)=>setDocDraft(s=>({...s,mime:t}))} placeholder="application/pdf" autoCapitalize="none" />
              </View>
              <View style={{ flex:1 }}>
                <Label>Size (bytes)</Label>
                <Input keyboardType="decimal-pad" value={docDraft.size} onChangeText={(t)=>setDocDraft(s=>({...s,size:t}))} placeholder="optional" />
              </View>
            </View>
            <View style={{ flexDirection:"row", gap:8, marginTop: 6 }}>
              <Btn variant="secondary" onPress={()=>setDocModalOpen(false)}>Cancel</Btn>
              <Btn onPress={saveDoc} variant="primary">{savingDoc ? "Saving…" : "Save"}</Btn>
            </View>
          </CenteredEditor>
        </View>
      </View>
    </Modal>
  );
}

/* ---------- Styles & small UI helpers ---------- */
const modalShadow = Platform.select({
  ios: { shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 18, shadowOffset: { width: 0, height: 6 } },
  android: { elevation: 18 }
});
const modalCard = {
  backgroundColor: BG,
  borderRadius: 18,
  paddingTop: 12,
  borderWidth: 1,
  borderColor: BORDER,
  ...modalShadow,
  flex: 1
};
const editorCard = {
  backgroundColor: CARD,
  borderRadius: 16,
  padding: 12,
  borderWidth: 1,
  borderColor: BORDER,
  ...Platform.select({ ios: { shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 16, shadowOffset: { width: 0, height: 6 } }, android: { elevation: 14 } })
};

// Full-width footer, attached to modal bubble
const footerWrap = {
  position: "absolute",
  left: 0,
  right: 0,
  bottom: 0,
  borderTopWidth: 1,
  borderTopColor: BORDER,
  backgroundColor: CARD,
  borderBottomLeftRadius: 18,
  borderBottomRightRadius: 18,
  ...Platform.select({ ios: { shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 10, shadowOffset: { width: 0, height: -2 } }, android: { elevation: 10 } })
};

const primaryBtn = { marginTop: 8, backgroundColor: BRAND, borderRadius: 10, paddingVertical: 10, alignItems: "center" };
const primaryBtnText = { color: "#fff", fontWeight: "800" };

function Card(props) {
  return (
    <View style={{
      backgroundColor: CARD,
      borderRadius: 12,
      padding: 10,
      borderWidth: 1,
      borderColor: BORDER,
      marginBottom: 8,
      ...Platform.select({ ios: { shadowColor: "#000", shadowOpacity: 0.07, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } }, android: { elevation: 4 } })
    }}>
      {props.children}
    </View>
  );
}
function RowLine({ children }) {
  return (
    <View style={{ flexDirection: "row", gap: 8, alignItems: "center", paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: BORDER }}>
      {children}
    </View>
  );
}
function Label(props) { return <Text style={{ color: TEXT, fontWeight: "700", marginBottom: 6 }}>{props.children}</Text>; }
function Hint(props) { return <Text style={{ color: MUTED, fontSize: 12 }}>{props.children}</Text>; }
function KV({ label, value }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 6 }}>
      <Text style={{ color: MUTED }}>{label}</Text>
      <Text style={{ color: TEXT, maxWidth: "65%", textAlign: "right" }}>{value}</Text>
    </View>
  );
}
function KVEdit({ label, children }) {
  return (
    <View style={{ marginBottom: 6 }}>
      <Text style={{ color: MUTED, marginBottom: 4 }}>{label}</Text>
      {children}
    </View>
  );
}
function ReviewRow({ l, r }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 6 }}>
      <Text style={{ color: MUTED }}>{l}</Text>
      <Text style={{ color: TEXT, fontWeight: "600" }}>{r}</Text>
    </View>
  );
}
function Input(props) {
  return (
    <TextInput
      {...props}
      style={[
        { backgroundColor: CARD, borderColor: BORDER, borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, color: TEXT, marginBottom: 8 },
        props.style || {}
      ]}
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
      style={{ flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: "center", backgroundColor: bg }}
    >
      <Text style={{ color, fontWeight: "700" }}>{typeof props.children === "string" ? props.children : "Button"}</Text>
    </TouchableOpacity>
  );
}
function SmallBtn({ children, onPress, variant="default" }) {
  const bg = variant === "danger" ? "#ef4444" : variant === "light" ? "#f3f4f6" : BORDER;
  const color = variant === "danger" ? "#fff" : TEXT;
  return (
    <TouchableOpacity onPress={() => { Haptics.selectionAsync(); onPress && onPress(); }} style={{ paddingVertical: 6, paddingHorizontal: 10, borderRadius: 10, backgroundColor: bg }}>
      <Text style={{ color, fontWeight: "700" }}>{typeof children === "string" ? children : "Action"}</Text>
    </TouchableOpacity>
  );
}
function IconBtn({ name, onPress }) {
  return (
    <TouchableOpacity onPress={() => { Haptics.selectionAsync(); onPress && onPress(); }} style={{ padding: 6, borderRadius: 8 }}>
      <Feather name={name} size={16} color={TEXT} />
    </TouchableOpacity>
  );
}
function Totals({ totals: t = { subtotal: 0, tax: 0, total: 0, deposit: 0, balance: 0, labour: 0, expenses: 0 }, currency: cur = "GBP" }) {
  return (
    <View style={{
      backgroundColor: CARD, borderRadius: 12, padding: 10, borderWidth: 1, borderColor: BORDER,
      ...Platform.select({ ios: { shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } }, android: { elevation: 2 } })
    }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 }}>
        <Text style={{ color: MUTED }}>Labour</Text><Text style={{ color: TEXT }}>{cur} {money(t.labour)}</Text>
      </View>
      <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 }}>
        <Text style={{ color: MUTED }}>Expenses</Text><Text style={{ color: TEXT }}>{cur} {money(t.expenses)}</Text>
      </View>
      <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 }}>
        <Text style={{ color: MUTED }}>Subtotal</Text><Text style={{ color: TEXT }}>{cur} {money(t.subtotal)}</Text>
      </View>
      <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 }}>
        <Text style={{ color: MUTED }}>Tax</Text><Text style={{ color: TEXT }}>{cur} {money(t.tax)}</Text>
      </View>
      <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 }}>
        <Text style={{ color: TEXT, fontWeight: "800" }}>Total</Text><Text style={{ color: TEXT, fontWeight: "800" }}>{cur} {money(t.total)}</Text>
      </View>
      {t.deposit > 0 ? (
        <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 }}>
          <Text style={{ color: MUTED }}>Deposit</Text><Text style={{ color: TEXT }}>- {cur} {money(t.deposit)}</Text>
        </View>
      ) : null}
      <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 }}>
        <Text style={{ color: TEXT }}>Balance due</Text><Text style={{ color: TEXT }}>{cur} {money(t.balance)}</Text>
      </View>
    </View>
  );
}

// Step header (no pills)
function StepHeader({ step, total, title }) {
  const pct = Math.max(0, Math.min(1, step / total));
  return (
    <View style={{ marginBottom: 8 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
        <Text style={{ color: TEXT, fontWeight: "800" }}>{title}</Text>
        <Text style={{ color: MUTED, fontWeight: "600", fontSize: 12 }}>Step {step} of {total}</Text>
      </View>
      <View style={{ height: 6, backgroundColor: "#dde3ea", borderRadius: 999 }}>
        <View style={{ width: `${pct * 100}%`, height: 6, backgroundColor: BRAND, borderRadius: 999 }} />
      </View>
    </View>
  );
}

// Proper checkbox with tick
function Checkbox({ checked, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        width: 22, height: 22, borderRadius: 6, borderWidth: 2,
        borderColor: checked ? BRAND : "#cbd5e1",
        alignItems: "center", justifyContent: "center",
        backgroundColor: checked ? BRAND : "#fff"
      }}
    >
      {checked ? <Feather name="check" size={14} color="#fff" /> : null}
    </Pressable>
  );
}

// Reusable centered editor
function CenteredEditor({ visible, onClose, children }) {
  const { width } = Dimensions.get("window");
  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <BlurView intensity={20} tint="systemMaterialLight" style={{ position:"absolute", inset:0 }} />
      <View style={{ flex:1, justifyContent:"center", alignItems:"center", padding:12 }}>
        <View style={[editorCard, { width: Math.min(width-32, 520) }]}>
          {children}
        </View>
      </View>
    </Modal>
  );
}