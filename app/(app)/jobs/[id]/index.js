// app/(app)/jobs/[id].js
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Platform,
  ActivityIndicator,
  TouchableOpacity,
  TextInput,
  Alert,
  ScrollView,
  DeviceEventEmitter,
  Modal,
  Pressable,
  Linking,
  Switch,
} from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { supabase } from "../../../../lib/supabase";
import { jobDocsHref, jobExpensesHref, loginHref, invoiceWizardHref } from "../../../../lib/nav";
import {
  Pencil,
  Save,
  CalendarDays,
  FileText,
  Receipt,
  Check,
  Mail,
  Phone,
  MapPin,
  ChevronLeft,
  ChevronRight,
  Minus,
  Plus as PlusIcon,
  Banknote,
} from "lucide-react-native";

import SharedCalendar from "../../../../components/SharedCalendar";
import { getPremiumStatus } from "../../../../lib/premium";

/* ---- theme ---- */
const BG = "#f5f7fb";
const CARD = "#ffffff";
const TEXT = "#0b1220";
const MUTED = "#6b7280";
const BORDER = "#e6e9ee";
const BRAND = "#2a86ff";
const SUCCESS = "#16a34a";
const WARN = "#f59e0b";
const ORANGE = "#f59e0b";

/* ---- helpers ---- */
const normalizeStatus = (s) =>
  String(s || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/^open$/, "scheduled");

const STATUS_COLOR = { scheduled: BRAND, in_progress: ORANGE, complete: SUCCESS };
const pad = (n) => String(n).padStart(2, "0");
const toYMD = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const toLocalMidnight = (d) => { const x = new Date(d); x.setHours(0,0,0,0); return x; };
const isWeekend = (d) => d.getDay() === 0 || d.getDay() === 6;
const addWorkingDays = (start, days, includeWeekends) => {
  const s = toLocalMidnight(start);
  if (days <= 1) return s;
  let r = days - 1;
  const cur = new Date(s);
  while (r > 0) { cur.setDate(cur.getDate() + 1); if (includeWeekends || !isWeekend(cur)) r--; }
  return cur;
};
const money = (v = 0) => "£" + Number(v || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const isMissingColumn = (err) =>
  err && (err.code === "42703" || /column .* does not exist/i.test(err.message || ""));

/* ---- screen ---- */
export default function JobDetails() {
  const router = useRouter();
  const { id } = useLocalSearchParams();
  const jobId = String(id || "");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [edit, setEdit] = useState(false);

  const [job, setJob] = useState(null);

  // editable fields
  const [title, setTitle] = useState("");
  const [client, setClient] = useState("");
  const [start, setStart] = useState(toLocalMidnight(new Date()));
  const [showPicker, setShowPicker] = useState(false);
  const [dur, setDur] = useState(1);
  const [weekends, setWeekends] = useState(false);
  const end = useMemo(
    () => addWorkingDays(start, Math.max(1, Math.floor(dur || 1)), weekends),
    [start, dur, weekends]
  );

  // summaries
  const [docsCount, setDocsCount] = useState(0);
  const [expCount, setExpCount] = useState(0);
  const [expTotal, setExpTotal] = useState(0);

  // payments summary (both due + paid)
  const [payCount, setPayCount] = useState(0);
  const [payDueTotal, setPayDueTotal] = useState(0);
  const [payPaidTotal, setPayPaidTotal] = useState(0);

  // description (job.notes fallback to quote.job_summary)
  const [description, setDescription] = useState("");

  // client modal
  const [showClient, setShowClient] = useState(false);
  const [clientEdit, setClientEdit] = useState(false);
  const [clientInfo, setClientInfo] = useState({ id: null, name: "", email: "", phone: "", address: "" });

  // status checkboxes
  const [isInProgress, setIsInProgress] = useState(false);
  const [isCompleted, setIsCompleted] = useState(false);

  const inFlight = useRef(false);

  // calendar state
  const [userId, setUserId] = useState(null);
  const [jobs, setJobs] = useState([]); // other jobs
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [calMonth, setCalMonth] = useState(()=>{const d=new Date(); d.setDate(1); return d;});

  /* ---- expense summary + sync jobs.cost ---- */
  const loadExpenseSummary = useCallback(async () => {
    try {
      const countQ = await supabase.from("expenses").select("id", { count: "exact", head: true }).eq("job_id", jobId);
      if (countQ.error && !isMissingColumn(countQ.error)) throw countQ.error;
      const count = countQ.count || 0;

      let total = 0;
      const expensesQ = await supabase.from("expenses").select("amount, total, qty, unit_cost").eq("job_id", jobId);
      if (expensesQ.error && !isMissingColumn(expensesQ.error)) throw expensesQ.error;

      for (const e of expensesQ.data || []) {
        let t = 0;
        if (e.amount != null && Number.isFinite(Number(e.amount))) t = Number(e.amount);
        else if (e.total != null && Number.isFinite(Number(e.total))) t = Number(e.total);
        else if (e.qty && e.unit_cost) t = (Number(e.qty) || 0) * (Number(e.unit_cost) || 0);
        total += t;
      }

      setExpCount(count);
      setExpTotal(total);

      try {
        const nowIso = new Date().toISOString();
        const { error: updErr } = await supabase.from("jobs").update({ cost: total, updated_at: nowIso }).eq("id", jobId);
        if (updErr && !isMissingColumn(updErr)) console.warn("Failed to update job cost:", updErr);
      } catch (e) { console.warn("Failed to sync job cost:", e); }
    } catch (e) {
      console.error("Failed to load expense summary:", e);
      setExpCount(0);
      setExpTotal(0);
    }
  }, [jobId]);

  /* ---- payments summary (both DUE & PAID) ---- */
  const loadPaymentsSummary = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from("payments")
        .select("id, amount, paid_at, voided_at")
        .eq("job_id", jobId);
      if (error && !isMissingColumn(error)) throw error;

      const active = (data || []).filter(p => !p.voided_at);
      const count = active.length;
      const dueTotal = active
        .filter(p => !p.paid_at)
        .reduce((s, p) => s + Number(p.amount || 0), 0);
      const paidTotal = active
        .filter(p => !!p.paid_at)
        .reduce((s, p) => s + Number(p.amount || 0), 0);

      setPayCount(count);
      setPayDueTotal(dueTotal);
      setPayPaidTotal(paidTotal);
    } catch (e) {
      console.warn("payments summary failed:", e?.message || e);
      setPayCount(0);
      setPayDueTotal(0);
      setPayPaidTotal(0);
    }
  }, [jobId]);

  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      if (!jobId) return;
      setLoading(true);

      const auth = await supabase.auth.getUser();
      const user = auth?.data?.user;
      if (!user) { router.replace(loginHref); return; }
      setUserId(user.id);

      // block if trial expired
      const { data: profile } = await supabase.from("profiles").select("trial_ends_at, plan_tier, plan_status").eq("id", user.id).maybeSingle();
      if (profile) {
        const status = getPremiumStatus(profile);
        if (status.isBlocked) { router.replace("/(app)/trial-expired"); return; }
      }

      const res = await supabase
        .from("jobs")
        .select("id,user_id,title,client_name,client_email,client_phone,client_address,client_id,start_date,end_date,duration_days,include_weekends,total,cost,status,notes")
        .eq("id", jobId).eq("user_id", user.id).maybeSingle();
      if (res.error) throw res.error;
      if (!res.data) { Alert.alert("Not found","This job does not exist."); router.back(); return; }

      const j = res.data;
      setJob(j);

      // set title + core fields
      setTitle(j.title || "");
      setClient(j.client_name || "");
      const s = j.start_date ? new Date(j.start_date) : new Date();
      setStart(toLocalMidnight(s));
      setDur(Math.max(1, Number(j.duration_days || 1)));
      setWeekends(!!j.include_weekends);

      const status = normalizeStatus(j.status || "scheduled");
      setIsInProgress(status === "in_progress");
      setIsCompleted(status === "complete");

      // description: job.notes || quote.job_summary
      let desc = (j.notes || "").trim();
      if (!desc) {
        const { data: sourceQuote } = await supabase.from("quotes").select("job_summary").eq("job_id", jobId).maybeSingle();
        if (sourceQuote && sourceQuote.job_summary) desc = String(sourceQuote.job_summary).trim();
      }
      setDescription(desc);

      if (j.client_id) {
        const cQ = await supabase.from("clients").select("id,name,email,phone,address").eq("id", j.client_id).maybeSingle();
        if (!cQ.error && cQ.data) {
          setClientInfo({
            id: cQ.data.id,
            name: cQ.data.name || j.client_name || "",
            email: cQ.data.email || j.client_email || "",
            phone: cQ.data.phone || j.client_phone || "",
            address: cQ.data.address || j.client_address || "",
          });
        }
      } else {
        setClientInfo({
          id: null,
          name: j.client_name || "",
          email: j.client_email || "",
          phone: j.client_phone || "",
          address: j.client_address || "",
        });
      }

      const docsQ = await supabase.from("documents").select("id", { count: "exact", head: true }).eq("job_id", jobId);
      if (docsQ.error) throw docsQ.error;
      setDocsCount(docsQ.count || 0);

      // summaries
      await Promise.all([loadExpenseSummary(), loadPaymentsSummary()]);
    } catch (e) {
      console.error("[job details] load", e);
      Alert.alert("Error", e?.message || "Failed to load job");
    } finally {
      setLoading(false);
      inFlight.current = false;
    }
  }, [jobId, router, loadExpenseSummary, loadPaymentsSummary]);

  useEffect(()=>{ load(); }, [load]);
  useEffect(()=>{ const sub = DeviceEventEmitter.addListener("jobs:changed", ()=>{ if(!inFlight.current) load(); }); return ()=>sub.remove(); }, [load]);

  const loadJobs = useCallback(async () => {
    if (!userId) return;
    const { data, error } = await supabase
      .from("jobs")
      .select("id,title,start_date,end_date,status,user_id")
      .eq("user_id", userId);
    if (!error) setJobs((data || []).filter((j)=> j.id !== jobId));
  }, [userId, jobId]);

  useEffect(() => { if (scheduleOpen) loadJobs(); }, [isInProgress, isCompleted, scheduleOpen, loadJobs]);

  /* ---------- auto-save for date-related fields ---------- */
  const saveDatesOnly = useCallback(
    async (s = start, d = dur, w = weekends) => {
      if (!job) return;
      try {
        const payload = {
          start_date: toYMD(s),
          end_date: toYMD(addWorkingDays(s, Math.max(1, Math.floor(d || 1)), w)),
          duration_days: Math.max(1, Math.floor(d || 1)),
          include_weekends: !!w,
          updated_at: new Date().toISOString(),
        };
        const { error } = await supabase.from("jobs").update(payload).eq("id", job.id);
        if (error) throw error;
        DeviceEventEmitter.emit("jobs:changed");
      } catch (e) { console.error("[job details] auto-save dates", e); }
    },
    [job, start, dur, weekends]
  );

  useEffect(() => {
    if (!scheduleOpen) return;
    (async () => {
      await loadJobs();
      setCalMonth(new Date(start.getFullYear(), start.getMonth(), 1));
    })();
  }, [scheduleOpen]); // eslint-disable-line

  const save = useCallback(async () => {
    try {
      if (!job) return;
      if (!title.trim()) { Alert.alert("Missing","Enter a job title."); return; }
      if (!client.trim()) { Alert.alert("Missing","Enter the client name."); return; }
      setSaving(true);
      const payload = { title: title.trim(), client_name: client.trim(), updated_at: new Date().toISOString() };
      const { error } = await supabase.from("jobs").update(payload).eq("id", job.id);
      if (error) throw error;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      setEdit(false);
      await load();
    } catch (e) {
      console.error("[job details] save", e);
      Alert.alert("Save failed", e?.message || "Could not save changes.");
    } finally { setSaving(false); }
  }, [job, title, client, load]);

  const goToInvoiceWizard = useCallback(() => {
    Haptics.selectionAsync();
    router.push(invoiceWizardHref({ jobId }));
  }, [router, jobId]);

  const writeStatus = async (next) => {
    try {
      setSaving(true);
      const allowed = normalizeStatus(next);
      const toWrite = allowed === "complete" || allowed === "in_progress" || allowed === "scheduled" ? allowed : "scheduled";
      const { error } = await supabase.from("jobs").update({ status: toWrite, updated_at: new Date().toISOString() }).eq("id", job.id);
      if (error) throw error;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setIsInProgress(toWrite === "in_progress");
      setIsCompleted(toWrite === "complete");
      await load();
    } catch (e) { Alert.alert("Update failed", e?.message || "Could not update status."); }
    finally { setSaving(false); }
  };

  const onToggleInProgress = async () => {
    Haptics.selectionAsync();
    const next = isInProgress ? (isCompleted ? "complete" : "scheduled") : "in_progress";
    await writeStatus(next);
  };
  const onToggleCompleted = async () => {
    Haptics.selectionAsync();
    const next = isCompleted ? (isInProgress ? "in_progress" : "scheduled") : "complete";
    await writeStatus(next);
  };

  // client modal
  const openClientModal = () => { Haptics.selectionAsync(); setShowClient(true); };
  const saveClient = async () => {
    try {
      setSaving(true);
      const payload = {
        name: clientInfo.name?.trim() || "",
        email: clientInfo.email?.trim() || null,
        phone: clientInfo.phone?.trim() || null,
        address: clientInfo.address?.trim() || null,
        updated_at: new Date().toISOString(),
      };
      if (clientInfo.id) {
        const { error } = await supabase.from("clients").update(payload).eq("id", clientInfo.id);
        if (error) throw error;
      } else if (job) {
        const { error } = await supabase.from("jobs").update({
          client_name: payload.name, client_email: payload.email, client_phone: payload.phone,
          client_address: payload.address, updated_at: new Date().toISOString(),
        }).eq("id", job.id);
        if (error) throw error;
        setClient(payload.name);
      }
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      setClientEdit(false);
      await load();
    } catch (e) { console.error("[client] save", e); Alert.alert("Save failed", e?.message || "Could not save client."); }
    finally { setSaving(false); }
  };
  const linkTo = (type, value) => {
    if (!value) return;
    if (type === "mail") Linking.openURL(`mailto:${value}`);
    if (type === "tel") Linking.openURL(`tel:${value}`);
    if (type === "maps") Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(value)}`);
  };

  // calendar open — always allowed
  const openStartDatePicker = async () => { Haptics.selectionAsync(); setScheduleOpen(true); };

  const spanColor = isInProgress ? STATUS_COLOR.in_progress : (isCompleted ? STATUS_COLOR.complete : STATUS_COLOR.scheduled);

  if (loading || !job) {
    return (<View style={[styles.screen, styles.center]}><ActivityIndicator color={BRAND} /></View>);
  }

  return (
    <View style={styles.screen}>
      {/* Header — JUST the title */}
      <View style={styles.top}>
        <Pressable onPress={() => router.push("/(tabs)/jobs")} style={styles.backBtn} android_ripple={{ color: "rgba(0,0,0,0.06)" }}>
          <ChevronLeft size={18} color={BRAND} />
          <Text style={styles.backTxt}>back</Text>
        </Pressable>
        <Text style={styles.h1} numberOfLines={1}>{title || "Job"}</Text>
        <View style={{ width: 50 }} />
      </View>

      {/* Status */}
      <View style={styles.actionBar}>
        <TouchableOpacity style={[styles.tileBtn, styles.tileNeutral]} onPress={onToggleInProgress} activeOpacity={0.9}>
          <View style={[styles.checkbox, isInProgress && styles.checkboxChecked]}>{isInProgress ? <Check size={16} color="#fff" /> : null}</View>
          <Text style={styles.tileNeutralTxt}>In progress</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tileBtn, styles.tileNeutral]} onPress={onToggleCompleted} activeOpacity={0.9}>
          <View style={[styles.checkbox, isCompleted && styles.checkboxChecked]}>{isCompleted ? <Check size={16} color="#fff" /> : null}</View>
          <Text style={styles.tileNeutralTxt}>Completed</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
        {/* ---- Details ---- */}
        <View style={styles.card}>
          <TouchableOpacity onPress={edit ? save : () => { Haptics.selectionAsync(); setEdit(true); }} style={styles.cardEditBtn} activeOpacity={0.85}>
            {edit ? <Save size={18} color={MUTED} /> : <Pencil size={18} color={MUTED} />}
          </TouchableOpacity>

          <Text style={styles.section}>Details</Text>

          <Text style={styles.label}>Job title</Text>
          <TextInput style={[styles.input, !edit && styles.inputReadonly]} value={title} onChangeText={setTitle} editable={edit} placeholder="e.g. Kitchen install" />

          {/* Description box — shows job.notes or quote.job_summary */}
          <Text style={styles.label}>Description</Text>
          <View style={styles.descBox}>
            <Text style={styles.descText}>{description ? description : "No description provided."}</Text>
          </View>

          <Text style={styles.label}>Start date</Text>
          <TouchableOpacity activeOpacity={0.9} onPress={openStartDatePicker}>
            <View style={{ position: "relative" }}>
              <TextInput style={[styles.input, styles.inputReadonly]} editable={false} value={start.toLocaleDateString()} placeholder="Pick a date" />
              <View style={styles.inputIcon}><CalendarDays size={18} color={MUTED} /></View>
            </View>
          </TouchableOpacity>

          {showPicker ? (
            <DateTimePicker
              value={start}
              mode="date"
              display={Platform.OS === "ios" ? "inline" : "default"}
              onChange={(e, d) => {
                if (Platform.OS === "android") setShowPicker(false);
                if (d) {
                  const ns = toLocalMidnight(d);
                  setStart(ns);
                  saveDatesOnly(ns, dur, weekends);
                }
              }}
              maximumDate={new Date(2199, 11, 31)}
            />
          ) : null}

          <Text style={styles.label}>Duration (days)</Text>
          <TextInput
            style={[styles.input, !edit && styles.inputReadonly]}
            value={String(dur)}
            onChangeText={(t) => {
              const val = Math.max(1, Math.floor(Number(String(t).replace(/[^0-9]/g, "")) || 1));
              setDur(val);
              if (edit) saveDatesOnly(start, val, weekends);
            }}
            keyboardType="number-pad"
            editable={edit}
            placeholder={!edit ? "Change via the calendar" : undefined}
          />

          {edit ? (
            <TouchableOpacity
              style={styles.checkRow}
              onPress={() => {
                Haptics.selectionAsync();
                setWeekends((prev) => {
                  const v = !prev;
                  saveDatesOnly(start, dur, v);
                  return v;
                });
              }}
              activeOpacity={0.9}
            >
              <View style={[styles.checkboxSmall, weekends && styles.checkboxSmallChecked]}>{weekends ? <Text style={styles.checkboxTick}>✓</Text> : null}</View>
              <Text style={{ color: TEXT, fontWeight: "800" }}>Include weekends</Text>
            </TouchableOpacity>
          ) : null}

          <View style={[styles.infoBox, !edit && styles.inputReadonly]}>
            <Text style={{ color: TEXT, fontWeight: "800" }}>
              Ends: {addWorkingDays(start, Math.max(1, Math.floor(dur || 1)), weekends).toLocaleDateString()} ({weekends ? "calendar days" : "working days"})
            </Text>
          </View>
        </View>

        {/* ---- Client summary card (no field titles, with chevrons) ---- */}
        <ClientSummaryCard
          client={clientInfo}
          onEdit={() => {
            setClientEdit(false);
            openClientModal();
          }}
          onLink={linkTo}
        />

        {/* ---- Summary row (Expenses & Documents) ---- */}
        <View style={styles.row2}>
          <SummaryCard
            icon={<Receipt size={18} color={WARN} />}
            title="Expenses"
            value={`${expCount} • ${money(expTotal)}`}
            onPress={() => { Haptics.selectionAsync(); router.replace(jobExpensesHref(jobId)); }}
          />
          <SummaryCard
            icon={<FileText size={18} color={BRAND} />}
            title="Documents"
            value={docsCount}
            onPress={() => { Haptics.selectionAsync(); router.replace(jobDocsHref(jobId)); }}
          />
        </View>

        {/* ---- Payments row (shows DUE / PAID columns) ---- */}
        <View style={styles.row2}>
          <PaymentSummaryCard
            due={payDueTotal}
            paid={payPaidTotal}
            onPress={() => {
              Haptics.selectionAsync();
              router.replace({ pathname: "/(app)/jobs/[id]/payments", params: { id: jobId } });
            }}
          />
        </View>

        {/* ---- Create Invoice ---- */}
        <View style={{ paddingHorizontal: 14, marginTop: 14 }}>
          <TouchableOpacity style={[styles.tileBtn, styles.tilePrimary]} onPress={goToInvoiceWizard} activeOpacity={0.9}>
            <FileText size={18} color="#fff" />
            <Text style={styles.tilePrimaryTxt}>Create Invoice</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* Client modal */}
      <Modal visible={showClient} transparent animationType="fade" onRequestClose={() => setShowClient(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setShowClient(false)}>
          <Pressable style={styles.modalCard} onPress={() => {}}>
            <TouchableOpacity onPress={clientEdit ? saveClient : () => setClientEdit(true)} style={styles.cardEditBtn} activeOpacity={0.85}>
              {clientEdit ? <Save size={18} color={MUTED} /> : <Pencil size={18} color={MUTED} />}
            </TouchableOpacity>

            <Text style={[styles.modalTitle, { paddingRight: 42 }]}>Client</Text>
            <View style={{ height: 8 }} />

            <Text style={styles.label}>Name</Text>
            <TextInput style={[styles.input, !clientEdit && styles.inputReadonly]} editable={clientEdit} value={clientInfo.name} onChangeText={(t)=>setClientInfo((p)=>({...p,name:t}))} />

            <Text style={styles.label}>Email</Text>
            <View style={styles.linkRow}>
              <TextInput style={[styles.input, styles.linkInput, !clientEdit && styles.inputReadonly]} editable={clientEdit} value={clientInfo.email || ""} onChangeText={(t)=>setClientInfo((p)=>({...p,email:t}))} keyboardType="email-address" autoCapitalize="none" />
              {!clientEdit && !!clientInfo.email && (
                <TouchableOpacity style={styles.linkBtn} onPress={() => linkTo("mail", clientInfo.email)}>
                  <Mail size={16} color={BRAND} />
                </TouchableOpacity>
              )}
            </View>

            <Text style={styles.label}>Phone</Text>
            <View style={styles.linkRow}>
              <TextInput style={[styles.input, styles.linkInput, !clientEdit && styles.inputReadonly]} editable={clientEdit} value={clientInfo.phone || ""} onChangeText={(t)=>setClientInfo((p)=>({...p,phone:t}))} keyboardType="phone-pad" />
              {!clientEdit && !!clientInfo.phone && (
                <TouchableOpacity style={styles.linkBtn} onPress={() => linkTo("tel", clientInfo.phone)}>
                  <Phone size={16} color={BRAND} />
                </TouchableOpacity>
              )}
            </View>

            <Text style={styles.label}>Address</Text>
            <View style={styles.linkRow}>
              <TextInput
                style={[styles.input, styles.linkInput, !clientEdit && styles.inputReadonly, { height: 70, textAlignVertical: "top" }]}
                editable={clientEdit}
                value={clientInfo.address || ""}
                onChangeText={(t)=>setClientInfo((p)=>({...p,address:t}))}
                multiline
              />
              {!clientEdit && !!clientInfo.address && (
                <TouchableOpacity style={styles.linkBtn} onPress={() => linkTo("maps", clientInfo.address)}>
                  <MapPin size={16} color={BRAND} />
                </TouchableOpacity>
              )}
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Calendar modal */}
      <Modal visible={scheduleOpen} animationType="fade" transparent>
        <Pressable style={styles.calBackdrop} onPress={() => setScheduleOpen(false)} />
        <View style={styles.sheet}>
          <Text style={styles.sheetTitle}>Pick start date</Text>

          <SharedCalendar
            month={calMonth}
            onChangeMonth={(d) => {
              setCalMonth(d);
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            }}
            selectedDate={start}
            onSelectDate={(d) => {
              const ns = toLocalMidnight(d);
              setStart(ns);
              saveDatesOnly(ns, dur, weekends);
              Haptics.selectionAsync();
            }}
            jobs={jobs}
            span={{ start, days: Math.max(1, Math.floor(dur || 1)), includeWeekends: weekends }}
            blockStarts
            accentColor={spanColor}
          />

          {/* Duration + Weekends */}
          <View style={styles.durationBlock}>
            <Text style={styles.controlHeader}>Duration</Text>
            <View style={styles.spinRow}>
              <TouchableOpacity
                style={styles.spinBtn}
                onPress={()=>{
                  const d = Math.max(1, Math.floor(dur)-1);
                  setDur(d);
                  saveDatesOnly(start, d, weekends);
                }}
              >
                <Minus size={18} color={TEXT} />
              </TouchableOpacity>
              <Text style={styles.spinValue}>{dur} day{dur>1?"s":""}</Text>
              <TouchableOpacity
                style={styles.spinBtn}
                onPress={()=>{
                  const d = Math.max(1, Math.floor(dur)+1);
                  setDur(d);
                  saveDatesOnly(start, d, weekends);
                }}
              >
                <PlusIcon size={18} color={TEXT} />
              </TouchableOpacity>
            </View>
          </View>
          <View style={styles.weekendRow}>
            <Text style={styles.controlHeader}>Include weekends</Text>
            <Switch value={weekends} onValueChange={(v)=>{ setWeekends(v); saveDatesOnly(start, dur, v); }} />
          </View>

          {/* Start / End */}
          <View style={styles.endRow}>
            <Text style={styles.endText}>Start: <Text style={styles.bold}>{toYMD(start)}</Text></Text>
            <Text style={styles.endText}>End: <Text style={styles.bold}>{toYMD(addWorkingDays(start, Math.max(1, Math.floor(dur || 1)), weekends))}</Text></Text>
          </View>

          {/* Footer */}
          <View style={styles.calFooter}>
            <TouchableOpacity style={[styles.calBtn, styles.calBtnGhost]} activeOpacity={0.9} onPress={() => { Haptics.selectionAsync(); setScheduleOpen(false); }}>
              <Text style={[styles.calBtnText, { color: TEXT }]}>Close</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.calBtn, styles.calBtnPrimary]} activeOpacity={0.9} onPress={() => { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); setScheduleOpen(false); }}>
              <Text style={[styles.calBtnText, { color: "#fff" }]}>Save</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

/* ---- small bits ---- */
const SummaryCard = ({ icon, title, value, onPress }) => (
  <TouchableOpacity style={[styles.summary, styles.deepShadow]} onPress={onPress} activeOpacity={0.85}>
    <View style={styles.summaryIcon}>{icon}</View>
    <Text style={styles.summaryTitle}>{title}</Text>
    <Text style={styles.summaryValue} numberOfLines={1}>{value}</Text>
  </TouchableOpacity>
);

const PaymentSummaryCard = ({ due = 0, paid = 0, onPress }) => {
  const showDue = Number(due) > 0;
  const showPaid = Number(paid) > 0;
  return (
    <TouchableOpacity style={[styles.summary, styles.deepShadow]} onPress={onPress} activeOpacity={0.85}>
      <View style={styles.summaryIcon}><Banknote size={18} color={SUCCESS} /></View>
      <Text style={styles.summaryTitle}>Payments</Text>

      {(!showDue && !showPaid) ? (
        <Text style={[styles.summaryValue, { color: MUTED }]}>No balance</Text>
      ) : (
        <View style={styles.payRow}>
          {showDue && (
            <View style={styles.payCol}>
              <Text style={styles.payLabel}>Due</Text>
              <Text style={styles.payValue}>{money(due)}</Text>
            </View>
          )}
          {showPaid && (
            <View style={styles.payCol}>
              <Text style={styles.payLabel}>Paid</Text>
              <Text style={styles.payValue}>{money(paid)}</Text>
            </View>
          )}
        </View>
      )}
    </TouchableOpacity>
  );
};

const ClientSummaryCard = ({ client = {}, onEdit, onLink }) => {
  const hasName = !!(client.name && client.name.trim());
  const hasEmail = !!(client.email && client.email.trim());
  const hasPhone = !!(client.phone && client.phone.trim());
  const hasAddress = !!(client.address && client.address.trim());
  const hasAny = hasName || hasEmail || hasPhone || hasAddress;

  return (
    <View style={[styles.card, styles.deepShadow, { marginTop: 10 }]}>
      <TouchableOpacity onPress={onEdit} style={styles.cardEditBtn} activeOpacity={0.85}>
        <Pencil size={18} color={MUTED} />
      </TouchableOpacity>

      <Text style={styles.section}>Client</Text>

      {/* Big name at top if present */}
      {hasName ? (
        <Text style={styles.clientName} numberOfLines={1}>{client.name}</Text>
      ) : null}

      {/* Rows – icon + value + tiny chevron */}
      {hasEmail ? (
        <Pressable style={styles.clientRow} onPress={() => onLink("mail", client.email)}>
          <Mail size={16} color={BRAND} />
          <Text style={styles.clientValue} numberOfLines={1}>{client.email}</Text>
          <ChevronRight size={16} color={MUTED} />
        </Pressable>
      ) : null}

      {hasPhone ? (
        <Pressable style={styles.clientRow} onPress={() => onLink("tel", client.phone)}>
          <Phone size={16} color={BRAND} />
          <Text style={styles.clientValue} numberOfLines={1}>{client.phone}</Text>
          <ChevronRight size={16} color={MUTED} />
        </Pressable>
      ) : null}

      {hasAddress ? (
        <Pressable style={[styles.clientRow, { alignItems: "flex-start" }]} onPress={() => onLink("maps", client.address)}>
          <MapPin size={16} color={BRAND} style={{ marginTop: 2 }} />
          <Text style={[styles.clientValue, { lineHeight: 18 }]} numberOfLines={2}>{client.address}</Text>
          <ChevronRight size={16} color={MUTED} style={{ marginTop: 2 }} />
        </Pressable>
      ) : null}

      {!hasAny && (
        <TouchableOpacity onPress={onEdit} activeOpacity={0.85} style={styles.clientEmpty}>
          <Text style={{ color: MUTED, fontWeight: "600" }}>Add client details</Text>
        </TouchableOpacity>
      )}
    </View>
  );
};

/* ---- styles ---- */
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG, paddingTop: Platform.OS === "android" ? 8 : 0 },
  center: { alignItems: "center", justifyContent: "center" },

  top: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, paddingVertical: 12 },
  backBtn: { minWidth: 72, flexDirection: "row", alignItems: "center", paddingVertical: 6, paddingLeft: 2, paddingRight: 8, borderRadius: 10 },
  backTxt: { color: BRAND, fontWeight: "800", fontSize: 16 },
  h1: { color: TEXT, fontWeight: "900", fontSize: 22 },

  actionBar: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, marginBottom: 6 },
  tileBtn: { flex: 1, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 14, borderRadius: 14, borderWidth: 1, shadowColor: "#0b1220", shadowOpacity: 0.08, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 3 },
  tilePrimary: { backgroundColor: BRAND, borderColor: "#2a86ff" },
  tilePrimaryTxt: { color: "#fff", fontWeight: "900" },
  tileNeutral: { backgroundColor: CARD, borderColor: BORDER },
  tileNeutralTxt: { color: TEXT, fontWeight: "900" },

  checkbox: { width: 22, height: 22, borderRadius: 7, borderWidth: 1.5, borderColor: "#cbd5e1", backgroundColor: "#fff", alignItems: "center", justifyContent: "center" },
  checkboxChecked: { backgroundColor: SUCCESS, borderColor: SUCCESS },

  row2: { flexDirection: "row", gap: 8, marginTop: 10, paddingHorizontal: 14 },
  summary: { flex: 1, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, borderRadius: 14, padding: 12 },
  summaryIcon: { height: 34, width: 34, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: "#f3f4f6", borderWidth: 1, borderColor: BORDER, marginBottom: 8 },
  summaryTitle: { color: MUTED, fontWeight: "800" },
  summaryValue: { color: TEXT, fontWeight: "900", marginTop: 2 },

  // Payments sub-row
  payRow: { flexDirection: "row", gap: 14, marginTop: 6 },
  payCol: { flexDirection: "column", flexShrink: 1, minWidth: 90 },
  payLabel: { color: MUTED, fontWeight: "800", marginBottom: 2 },
  payValue: { color: TEXT, fontWeight: "900" },

  card: { backgroundColor: CARD, marginHorizontal: 14, marginTop: 10, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: BORDER, shadowColor: "#0b1220", shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 3, position: "relative" },
  cardEditBtn: { position: "absolute", top: 10, right: 10, height: 34, width: 34, borderRadius: 10, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: BORDER, backgroundColor: CARD, shadowColor: "#0b1220", shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 3, zIndex: 5 },

  section: { color: TEXT, fontWeight: "900", fontSize: 16, marginBottom: 8 },
  label: { color: MUTED, fontWeight: "800", marginTop: 8, marginBottom: 6 },

  input: {
    backgroundColor: "#fff",
    color: TEXT,
    borderRadius: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: BORDER,
    shadowColor: "#0b1220",
    shadowOpacity: 0.03,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 1,
  },
  inputReadonly: { backgroundColor: "#eef2f6", shadowOpacity: 0, elevation: 0 },

  inputIcon: {
    position: "absolute",
    right: 6,
    top: 6,
    height: 30,
    width: 30,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f3f4f6",
    borderWidth: 1,
    borderColor: BORDER,
  },

  // Client card (clean)
  clientName: { color: TEXT, fontWeight: "900", fontSize: 16, marginTop: 2 },
  clientRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 8,
    paddingVertical: 6,
  },
  clientValue: { color: TEXT, fontWeight: "600", flex: 1 },

  checkRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 8 },
  checkboxSmall: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: "#cbd5e1",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#ffffff",
  },
  checkboxSmallChecked: { backgroundColor: BRAND, borderColor: BRAND },
  checkboxTick: { color: "#ffffff", fontWeight: "800" },

  infoBox: {
    marginTop: 8,
    padding: 10,
    borderRadius: 10,
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: BORDER,
  },

  /* description box */
  descBox: { backgroundColor: "#f8fafc", borderWidth: 1, borderColor: BORDER, padding: 10, borderRadius: 10 },
  descText: { color: TEXT, fontWeight: "600" },

  /* empty client prompt */
  clientEmpty: {
    marginTop: 6,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: "#f8fafc",
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
  },

  /* modal + calendar */
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.25)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
  },
  modalCard: {
    width: "100%",
    maxWidth: 520,
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: BORDER,
    shadowColor: "#0b1220",
    shadowOpacity: 0.15,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
    position: "relative",
  },
  modalTitle: { color: TEXT, fontWeight: "900", fontSize: 18 },
  linkRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  linkInput: { flex: 1 },
  linkBtn: {
    height: 36,
    width: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#eef6ff",
    borderWidth: 1,
    borderColor: "#dbeafe",
  },

  calBackdrop: { flex: 1, backgroundColor: "#0009" },
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
    elevation: 0,
    shadowOpacity: 0,
    maxHeight: "86%",
    overflow: "hidden",
  },
  sheetTitle: { color: TEXT, fontWeight: "900", fontSize: 18, textAlign: "center", marginBottom: 8 },

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

  endRow: { marginTop: 10, flexDirection: "row", justifyContent: "space-between" },
  endText: { color: MUTED, fontWeight: "800" },
  bold: { color: TEXT, fontWeight: "900" },

  calFooter: { flexDirection: "row", gap: 10, marginTop: 14 },
  calBtn: {
    flex: 1,
    height: 48,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  calBtnGhost: { backgroundColor: "#eef2f7", borderColor: BORDER },
  calBtnPrimary: { backgroundColor: BRAND, borderColor: BRAND },
  calBtnText: { fontWeight: "900", fontSize: 15, includeFontPadding: false },

  deepShadow: {
    shadowColor: "#0b1220",
    shadowOpacity: 0.1,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
});