import React, { useCallback, useEffect, useState, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  Platform,
  ActivityIndicator,
  TouchableOpacity,
  TextInput,
  ScrollView,
  DeviceEventEmitter,
  StatusBar,
  Keyboard,
  LayoutAnimation,
  UIManager,
  RefreshControl,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { supabase } from "../../../../lib/supabase";
import { loginHref } from "../../../../lib/nav";
import {
  Calendar,
  MapPin,
  Receipt,
  FileText,
  Banknote,
  Mail,
  Phone,
} from "lucide-react-native";
import { Feather } from "@expo/vector-icons";
import { getPremiumStatus } from "../../../../lib/premium";
import SharedCalendar from "../../../../components/SharedCalendar";
import * as NavigationBar from "expo-navigation-bar";
import * as SystemUI from "expo-system-ui";

// Enable layout animations on Android
if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

/* ---- theme (match create.js) ---- */
const BRAND = "#2a86ff";
const TEXT = "#0b1220";
const MUTED = "#6b7280";
const CARD = "#ffffff";
const BG = "#ffffff";
const BORDER = "#e6e9ee";
const SUCCESS = "#16a34a";

/* ---- helpers ---- */
const money = (v = 0) => "£" + Number(v || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const formatDate = (dateStr) => {
  if (!dateStr) return "Not set";
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-GB");
};
const normalizeStatus = (s) =>
  String(s || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/^open$/, "scheduled");

const toYMD = (date) => {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const smooth = () => LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
const showToast = (message) => console.warn("Toast:", message);

/* ----------------- small shared UI ----------------- */
const Card = ({ children, style = {} }) => <View style={[styles.card, style]}>{children}</View>;

const Label = ({ children, required = false }) => (
  <Text style={styles.label}>
    {children}
    {required && <Text style={{ color: "#dc2626" }}> *</Text>}
  </Text>
);

const Btn = ({ children, onPress, style = {}, disabled = false, variant = "primary" }) => {
  const bg = disabled ? "#9ca3af" : variant === "secondary" ? "#f8fafc" : BRAND;
  const color = variant === "secondary" ? TEXT : "#ffffff";
  return (
    <TouchableOpacity
      style={[styles.btn, { backgroundColor: bg }, style]}
      onPress={onPress}
      activeOpacity={0.85}
      disabled={disabled}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
    >
      <Text style={[styles.btnText, { color }]}>{children}</Text>
    </TouchableOpacity>
  );
};

const StatusChip = ({ label, selected, onPress, saving = false }) => (
  <TouchableOpacity
    style={[styles.chip, selected && styles.chipSelected]}
    onPress={onPress}
    activeOpacity={0.85}
    hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
  >
    <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
      {label}
      {saving && selected ? " ✓" : ""}
    </Text>
  </TouchableOpacity>
);

const SummaryCard = ({ icon, title, value, subtitle, onPress, isEmpty = false }) => (
  <TouchableOpacity
    style={styles.summaryCard}
    onPress={onPress}
    activeOpacity={0.85}
    hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
  >
    <View style={styles.summaryIcon}>{icon}</View>
    <Text style={styles.summaryTitle}>{title}</Text>
    {isEmpty ? (
      <Text style={styles.summaryEmpty}>No items yet</Text>
    ) : (
      <>
        <Text style={styles.summaryValue} numberOfLines={1}>
          {value}
        </Text>
        {subtitle && <Text style={styles.summarySubtitle}>{subtitle}</Text>}
      </>
    )}
  </TouchableOpacity>
);

/* ---- Editable Field Component ---- */
const EditableField = ({
  label,
  value,
  onChangeText,
  placeholder,
  multiline = false,
  keyboardType = "default",
  autoCapitalize = "sentences",
  required = false,
  icon = null,
  onPress = null,
  saving = false,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [localValue, setLocalValue] = useState(value || "");
  const inputRef = useRef(null);

  useEffect(() => setLocalValue(value || ""), [value]);

  const handlePress = () => {
    if (onPress) return onPress();
    Haptics.selectionAsync();
    setIsEditing(true);
    setTimeout(() => inputRef.current?.focus(), 80);
  };

  const commit = () => {
    setIsEditing(false);
    if (onChangeText && localValue !== value) onChangeText(localValue);
  };

  return (
    <View style={styles.editableField}>
      <Label required={required}>
        {label}
        {saving && <Text style={{ color: SUCCESS, fontSize: 11 }}> ✓</Text>}
      </Label>

      {isEditing ? (
        <TextInput
          ref={inputRef}
          style={[
            styles.input,
            multiline && { minHeight: 96, textAlignVertical: "top", paddingVertical: 10 },
          ]}
          value={localValue}
          onChangeText={setLocalValue}
          onBlur={commit}
          onSubmitEditing={() => {
            if (!multiline) commit();
          }}
          placeholder={placeholder}
          placeholderTextColor={MUTED}
          multiline={multiline}
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize}
          returnKeyType={multiline ? "default" : "done"}
          blurOnSubmit={!multiline}
        />
      ) : (
        <TouchableOpacity onPress={handlePress} style={styles.fieldTouchable}>
          <View style={[styles.fieldDisplay, multiline && { minHeight: 96, alignItems: "flex-start" }]}>
            {icon && <View style={styles.fieldIcon}>{icon}</View>}
            <Text style={[styles.fieldText, !value && { color: MUTED }, multiline && { lineHeight: 20 }]}>
              {value || placeholder || "Tap to edit"}
            </Text>
          </View>
        </TouchableOpacity>
      )}
    </View>
  );
};

/* ---- Date Field Component ---- */
const DateField = ({ label, value, onDateChange, required = false, saving = false }) => {
  const [showCalendar, setShowCalendar] = useState(false);
  const [calMonth, setCalMonth] = useState(() => {
    const d = value ? new Date(value) : new Date();
    d.setDate(1);
    return d;
  });

  const handleDateSelect = (selectedDate) => {
    onDateChange(toYMD(selectedDate));
    setShowCalendar(false);
  };

  return (
    <>
      <View style={styles.editableField}>
        <Label required={required}>
          {label}
          {saving && <Text style={{ color: SUCCESS, fontSize: 11 }}> ✓</Text>}
        </Label>
        <TouchableOpacity onPress={() => setShowCalendar(true)} style={styles.fieldTouchable}>
          <View style={styles.fieldDisplay}>
            <View style={styles.fieldIcon}>
              <Calendar size={18} color={MUTED} />
            </View>
            <Text style={styles.fieldText}>{formatDate(value)}</Text>
          </View>
        </TouchableOpacity>
      </View>

      {showCalendar && (
        <View style={styles.calendarSheet}>
          <View style={styles.calendarHeader}>
            <Text style={styles.calendarTitle}>Select Start Date</Text>
            <TouchableOpacity onPress={() => setShowCalendar(false)} style={styles.calendarCloseBtn}>
              <Text style={styles.calendarCloseText}>Done</Text>
            </TouchableOpacity>
          </View>
          <SharedCalendar
            month={calMonth}
            onChangeMonth={setCalMonth}
            selectedDate={value ? new Date(value) : new Date()}
            onSelectDate={handleDateSelect}
            jobs={[]}
            span={null}
            blockStarts={false}
            accentColor={BRAND}
          />
        </View>
      )}
    </>
  );
};

/* ---------------- main ---------------- */
export default function JobDetails() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams();
  const jobId = String(id || "");

  // State
  const [job, setJob] = useState(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const jobRef = useRef(null);
  const [savingFields, setSavingFields] = useState({});
  const fieldTimeouts = useRef({});

  // Force white system chrome
  useEffect(() => {
    const forceWhite = async () => {
      StatusBar.setBarStyle("dark-content", false);
      if (Platform.OS === "android") {
        StatusBar.setBackgroundColor("#ffffff", false);
        await NavigationBar.setBackgroundColorAsync("#ffffff");
        await NavigationBar.setButtonStyleAsync("dark");
        NavigationBar.setBorderColorAsync?.("#ffffff");
      }
      SystemUI.setBackgroundColorAsync?.("#ffffff");
    };
    forceWhite();
  }, []);

  // Initial load
  const load = useCallback(async () => {
    try {
      if (!jobId) return;
      const auth = await supabase.auth.getUser();
      const user = auth?.data?.user;
      if (!user) {
        router.replace(loginHref);
        return;
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("trial_ends_at, plan_tier, plan_status")
        .eq("id", user.id)
        .maybeSingle();
      if (profile) {
        const status = getPremiumStatus(profile);
        if (status.isBlocked) {
          router.replace("/(app)/trial-expired");
          return;
        }
      }

      const { data: jobData, error: jobError } = await supabase
        .from("jobs")
        .select(
          `
          id, title, description, start_date, duration_days, end_date_working,
          status, client_id, client_name, client_email, client_phone, client_address, quote_id
        `
        )
        .eq("id", jobId)
        .eq("user_id", user.id)
        .maybeSingle();

      if (jobError) throw jobError;
      if (!jobData) {
        setError("Job not found");
        return;
      }

      let expensesCount = 0;
      let expensesTotal = 0;
      let documentsCount = 0;
      let paymentsDue = 0;

      try {
        const { data: expensesData } = await supabase.from("expenses").select("amount").eq("job_id", jobId);
        if (Array.isArray(expensesData)) {
          expensesCount = expensesData.length;
          expensesTotal = expensesData.reduce((sum, exp) => sum + (Number(exp.amount) || 0), 0);
        }

        const { count: documentsCountResult } = await supabase
          .from("documents")
          .select("id", { count: "exact", head: true })
          .eq("job_id", jobId);
        if (documentsCountResult !== null) documentsCount = documentsCountResult;

        const { data: paymentsData } = await supabase
          .from("payments")
          .select("amount, paid_at, voided_at")
          .eq("job_id", jobId);
        if (Array.isArray(paymentsData)) {
          const activePayments = paymentsData.filter((p) => !p.voided_at);
          paymentsDue = activePayments.filter((p) => !p.paid_at).reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
        }
      } catch (e) {
        console.warn("Summary queries failed:", e);
      }

      const finalJob = {
        ...jobData,
        expenses_count: expensesCount,
        expenses_total: expensesTotal,
        documents_count: documentsCount,
        payments_due: paymentsDue,
      };

      setJob(finalJob);
      jobRef.current = finalJob;
    } catch (err) {
      console.error("Failed to load job:", err);
      setError(err.message || "Failed to load job");
    } finally {
      setInitialLoading(false);
    }
  }, [jobId, router]);

  // Background revalidation
  const revalidateInBackground = useCallback(async () => {
    if (!job) return;
    try {
      const auth = await supabase.auth.getUser();
      const user = auth?.data?.user;
      if (!user) return;

      const { data: jobData, error: jobError } = await supabase
        .from("jobs")
        .select(
          `
          id, title, description, start_date, duration_days, end_date_working,
          status, client_id, client_name, client_email, client_phone, client_address, quote_id
        `
        )
        .eq("id", jobId)
        .eq("user_id", user.id)
        .maybeSingle();
      if (jobError || !jobData) return;

      let expensesCount = 0;
      let expensesTotal = 0;
      let documentsCount = 0;
      let paymentsDue = 0;

      try {
        const { data: expensesData } = await supabase.from("expenses").select("amount").eq("job_id", jobId);
        if (Array.isArray(expensesData)) {
          expensesCount = expensesData.length;
          expensesTotal = expensesData.reduce((sum, exp) => sum + (Number(exp.amount) || 0), 0);
        }

        const { count: documentsCountResult } = await supabase
          .from("documents")
          .select("id", { count: "exact", head: true })
          .eq("job_id", jobId);
        if (documentsCountResult !== null) documentsCount = documentsCountResult;

        const { data: paymentsData } = await supabase
          .from("payments")
          .select("amount, paid_at, voided_at")
          .eq("job_id", jobId);
        if (Array.isArray(paymentsData)) {
          const activePayments = paymentsData.filter((p) => !p.voided_at);
          paymentsDue = activePayments.filter((p) => !p.paid_at).reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
        }
      } catch (e) {
        console.warn("Background summary reload failed:", e);
      }

      const updatedJob = {
        ...jobData,
        expenses_count: expensesCount,
        expenses_total: expensesTotal,
        documents_count: documentsCount,
        payments_due: paymentsDue,
      };
      setJob((prev) => ({ ...prev, ...updatedJob }));
    } catch (err) {
      console.warn("Background revalidation failed:", err);
    }
  }, [job, jobId]);

  useEffect(() => {
    load();
  }, [load]);

  // Optimistic mutation
  const mutateJob = useCallback(
    async (patch, field = null) => {
      if (!job) return;
      jobRef.current = job;
      if (field) setSavingFields((p) => ({ ...p, [field]: true }));
      smooth();
      setJob((prev) => ({ ...prev, ...patch }));
      try {
        const { error } = await supabase
          .from("jobs")
          .update({ ...patch, updated_at: new Date().toISOString() })
          .eq("id", job.id);
        if (error) throw error;
        DeviceEventEmitter.emit("jobs:changed");
        setTimeout(revalidateInBackground, 800);
      } catch (e) {
        console.error("Failed to save field:", e);
        smooth();
        setJob(jobRef.current);
        showToast("Could not save changes");
      } finally {
        if (field) setTimeout(() => setSavingFields((p) => ({ ...p, [field]: false })), 700);
      }
    },
    [job, revalidateInBackground]
  );

  const updateJobField = useCallback(
    (field, value) => {
      if (!job) return;
      if (fieldTimeouts.current[field]) clearTimeout(fieldTimeouts.current[field]);
      fieldTimeouts.current[field] = setTimeout(() => mutateJob({ [field]: value }, field), 500);
    },
    [job, mutateJob]
  );

  const updateClientField = useCallback(
    (field, value) => {
      if (!job) return;
      const clientField = `client_${field}`;
      mutateJob({ [clientField]: value }, clientField);
    },
    [job, mutateJob]
  );

  const updateStatus = useCallback(
    (newStatus) => {
      if (!job) return;
      Haptics.selectionAsync();
      mutateJob({ status: newStatus }, "status");
    },
    [job, mutateJob]
  );

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await revalidateInBackground();
    setRefreshing(false);
  }, [revalidateInBackground]);

  // Nav
  const routerPush = (path) => {
    Haptics.selectionAsync();
    router.push(path);
  };
  const handleExpensesPress = useCallback(() => routerPush(`/(app)/jobs/${jobId}/expenses`), [jobId]);
  const handleDocumentsPress = useCallback(() => routerPush(`/(app)/jobs/${jobId}/documents`), [jobId]);
  const handlePaymentsPress = useCallback(() => routerPush(`/(app)/jobs/${jobId}/payments`), [jobId]);
  const handleCreateInvoice = useCallback(
    () =>
      router.push({
        pathname: "/(app)/invoices/wizard",
        params: { jobId, type: "invoice" },
      }),
    [jobId, router]
  );
  const handleViewQuote = useCallback(() => job?.quote_id && routerPush(`/(app)/quotes/view?id=${job.quote_id}`), [job?.quote_id]);

  // Loading
  if (initialLoading) {
    return (
      <View style={[styles.screen, styles.center]}>
        <ActivityIndicator size="large" color={BRAND} />
      </View>
    );
  }

  if (error || !job) {
    return (
      <View style={styles.screen}>
        <StatusBar barStyle="dark-content" backgroundColor="#ffffff" translucent={false} />
        <View style={{ height: insets.top, backgroundColor: CARD }} />

        <View style={styles.header}>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
            <Feather name="arrow-left" size={20} color={TEXT} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Job Details</Text>
          <View style={{ width: 40 }} />
        </View>

        <View style={styles.center}>
          <Card style={styles.errorCard}>
            <Text style={styles.errorText}>{error || "Job not found"}</Text>
            <Btn onPress={load} style={{ marginTop: 12 }}>
              Retry
            </Btn>
          </Card>
        </View>
      </View>
    );
  }

  const currentStatus = normalizeStatus(job.status);

  return (
    <View style={styles.screen}>
      <StatusBar barStyle="dark-content" backgroundColor="#ffffff" translucent={false} />

      {/* Safe area top like create.js */}
      <View style={{ height: insets.top, backgroundColor: CARD }} />

      {/* Header — compact */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Feather name="arrow-left" size={20} color={TEXT} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1} ellipsizeMode="tail">
          {job.title || "Job"}
        </Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingTop: 10,
          paddingHorizontal: 14,
          // keep just enough bottom space to clear the sticky bar
          paddingBottom: insets.bottom + 64,
        }}
        overScrollMode="never"
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={BRAND} colors={[BRAND]} />
        }
      >
        {/* Status */}
        <Card style={styles.compactCard}>
          <Text style={styles.compactCardTitle}>Status</Text>
          <View style={styles.compactStatusContainer}>
            <StatusChip
              label="Not started"
              selected={currentStatus === "scheduled"}
              onPress={() => updateStatus("scheduled")}
              saving={savingFields.status && currentStatus === "scheduled"}
            />
            <StatusChip
              label="In progress"
              selected={currentStatus === "in_progress"}
              onPress={() => updateStatus("in_progress")}
              saving={savingFields.status && currentStatus === "in_progress"}
            />
            <StatusChip
              label="Completed"
              selected={currentStatus === "complete"}
              onPress={() => updateStatus("complete")}
              saving={savingFields.status && currentStatus === "complete"}
            />
          </View>
        </Card>

        {/* Details */}
        <Card style={styles.compactCard}>
          <Text style={styles.compactCardTitle}>Details</Text>

          <EditableField
            label="Job Title"
            value={job.title}
            onChangeText={(value) => updateJobField("title", value)}
            placeholder="Enter job title"
            required
            saving={savingFields.title}
          />

          <EditableField
            label="Description"
            value={job.description}
            onChangeText={(value) => updateJobField("description", value)}
            placeholder="Enter job description"
            multiline
            saving={savingFields.description}
          />

          <DateField
            label="Start Date"
            value={job.start_date}
            onDateChange={(value) => updateJobField("start_date", value)}
            saving={savingFields.start_date}
          />

          <EditableField
            label="Duration"
            value={job.duration_days ? `${job.duration_days} days` : ""}
            onChangeText={(text) => {
              const n = parseInt(text.replace(/[^0-9]/g, ""), 10) || 1;
              updateJobField("duration_days", Math.max(1, n));
            }}
            placeholder="Duration in days"
            keyboardType="number-pad"
            saving={savingFields.duration_days}
          />

          <View style={styles.compactInfoBox}>
            <Text style={styles.infoText}>
              Ends: <Text style={styles.infoBold}>{formatDate(job.end_date_working)}</Text> (working days)
            </Text>
          </View>
        </Card>

        {/* Client */}
        <Card style={styles.compactCard}>
          <Text style={styles.compactCardTitle}>Client</Text>

          <EditableField
            label="Name"
            value={job.client_name}
            onChangeText={(value) => updateClientField("name", value)}
            placeholder="Client name"
            required
            saving={savingFields.client_name}
          />

          <EditableField
            label="Email"
            value={job.client_email}
            onChangeText={(value) => updateClientField("email", value)}
            placeholder="Email address"
            keyboardType="email-address"
            autoCapitalize="none"
            icon={<Mail size={16} color={MUTED} />}
            saving={savingFields.client_email}
          />

          <EditableField
            label="Phone"
            value={job.client_phone}
            onChangeText={(value) => updateClientField("phone", value)}
            placeholder="Phone number"
            keyboardType="phone-pad"
            icon={<Phone size={16} color={MUTED} />}
            saving={savingFields.client_phone}
          />

          <EditableField
            label="Address"
            value={job.client_address}
            onChangeText={(value) => updateClientField("address", value)}
            placeholder="Client address"
            multiline
            icon={<MapPin size={16} color={MUTED} />}
            saving={savingFields.client_address}
          />
        </Card>

        {/* Summary */}
        <View style={styles.compactSummaryGrid}>
          <SummaryCard
            icon={<Receipt size={18} color={"#b45309"} />}
            title="Expenses"
            value={`${job.expenses_count} • ${money(job.expenses_total)}`}
            onPress={handleExpensesPress}
            isEmpty={job.expenses_count === 0}
          />
          <SummaryCard
            icon={<FileText size={18} color={BRAND} />}
            title="Documents"
            value={job.documents_count}
            onPress={handleDocumentsPress}
            isEmpty={job.documents_count === 0}
          />
        </View>

        <View style={styles.compactSummaryGrid}>
          <SummaryCard
            icon={<Banknote size={18} color={SUCCESS} />}
            title="Payments"
            value={`Due ${money(job.payments_due)}`}
            onPress={handlePaymentsPress}
            isEmpty={job.payments_due === 0}
          />
        </View>
      </ScrollView>

      {/* Sticky bottom bar (compact) */}
      <View style={[styles.actionBar, { paddingBottom: insets.bottom }]}>
        <View style={styles.bottomActionsTop}>
          {job.quote_id ? (
            <TouchableOpacity onPress={handleViewQuote} style={styles.smallBtn}>
              <Text style={styles.smallBtnText}>View Quote</Text>
            </TouchableOpacity>
          ) : null}
        </View>
        <Btn onPress={handleCreateInvoice} style={styles.fullWidthBtn}>
          Create Invoice
        </Btn>
      </View>

      {/* bottom safe area fill */}
      <View style={{ height: insets.bottom, backgroundColor: "#ffffff" }} />
    </View>
  );
}

/* ---------------- styles (compact) ---------------- */
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 12 },

  header: {
    backgroundColor: CARD,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
    paddingHorizontal: 14,
    paddingVertical: 10, // tighter
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  backBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 16, fontWeight: "900", color: TEXT, flex: 1, textAlign: "center", marginHorizontal: 10 },

  /* Card */
  card: {
    backgroundColor: CARD,
    borderRadius: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: BORDER,
    marginBottom: 8,
    ...Platform.select({
      ios: { shadowColor: "#0b1220", shadowOpacity: 0.04, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
      android: { elevation: 2 },
    }),
  },

  /* Section titles inside cards */
  compactCard: { padding: 10, borderRadius: 12, marginBottom: 8, borderColor: BORDER, borderWidth: 1, backgroundColor: CARD },
  compactCardTitle: { color: TEXT, fontWeight: "800", fontSize: 14, marginBottom: 8 },

  /* Status chips */
  compactStatusContainer: {
    backgroundColor: "#f8fafc",
    borderRadius: 12,
    padding: 4,
    flexDirection: "row",
    borderWidth: 1,
    borderColor: BORDER,
    gap: 6,
  },
  chip: {
    flex: 1,
    height: 30, // smaller
    paddingHorizontal: 10,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  chipSelected: { backgroundColor: BRAND },
  chipText: { color: BRAND, fontWeight: "600", fontSize: 13 },
  chipTextSelected: { color: "#fff", fontWeight: "700" },

  /* Editable fields */
  editableField: { marginBottom: 10 },
  label: { color: TEXT, fontWeight: "800", marginBottom: 4, fontSize: 13 },
  input: {
    backgroundColor: "#ffffff",
    borderColor: BORDER,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 10,
    color: TEXT,
    marginBottom: 10,
    fontWeight: "600",
    minHeight: 44,
  },
  fieldTouchable: { borderRadius: 10 },
  fieldDisplay: {
    backgroundColor: "#f8fafc",
    borderColor: BORDER,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 10,
    marginBottom: 10,
    flexDirection: "row",
    alignItems: "center",
    minHeight: 44,
  },
  fieldIcon: { marginRight: 8 },
  fieldText: { color: TEXT, fontWeight: "600", flex: 1, fontSize: 14 },

  /* Info */
  compactInfoBox: {
    backgroundColor: "#f0f9ff",
    borderWidth: 1,
    borderColor: "#bfdbfe",
    borderRadius: 8,
    padding: 8,
    marginTop: 2,
  },
  infoText: { color: MUTED, fontWeight: "600", fontSize: 13 },
  infoBold: { color: TEXT, fontWeight: "900" },

  /* Summary grid */
  compactSummaryGrid: { flexDirection: "row", gap: 8, marginBottom: 8 },
  summaryCard: {
    flex: 1,
    backgroundColor: CARD,
    borderRadius: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: BORDER,
    ...Platform.select({
      ios: { shadowColor: "#0b1220", shadowOpacity: 0.04, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
      android: { elevation: 2 },
    }),
  },
  summaryIcon: {
    height: 28,
    width: 28,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f3f4f6",
    borderWidth: 1,
    borderColor: BORDER,
    marginBottom: 6,
  },
  summaryTitle: { color: MUTED, fontWeight: "800", fontSize: 12, marginBottom: 2 },
  summaryValue: { color: TEXT, fontWeight: "900", fontSize: 14 },
  summarySubtitle: { color: MUTED, fontWeight: "600", fontSize: 11, marginTop: 2 },
  summaryEmpty: { color: MUTED, fontWeight: "600", fontSize: 13, fontStyle: "italic" },

  /* Bottom action bar (compact) */
  actionBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: CARD,
    borderTopWidth: 1,
    borderTopColor: BORDER,
    paddingHorizontal: 14,
    paddingTop: 8,
    ...Platform.select({
      ios: { shadowColor: "#0b1220", shadowOpacity: 0.08, shadowRadius: 10, shadowOffset: { width: 0, height: -4 } },
      android: { elevation: 6 },
    }),
  },
  bottomActionsTop: { flexDirection: "row", justifyContent: "flex-end", marginBottom: 8 },
  smallBtn: {
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 10,
    paddingVertical: 6,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  smallBtnText: { color: TEXT, fontWeight: "700", fontSize: 13 },

  btn: {
    paddingVertical: 12, // tighter
    paddingHorizontal: 18,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: BORDER,
  },
  btnText: { fontSize: 14, fontWeight: "900" },
  fullWidthBtn: { width: "100%" },

  /* Calendar sheet (kept compact) */
  calendarSheet: {
    backgroundColor: CARD,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: BORDER,
    marginTop: 8,
    marginBottom: 12,
    ...Platform.select({
      ios: { shadowColor: "#0b1220", shadowOpacity: 0.12, shadowRadius: 16, shadowOffset: { width: 0, height: 10 } },
      android: { elevation: 12 },
    }),
  },
  calendarHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  calendarTitle: { color: TEXT, fontWeight: "900", fontSize: 16 },
  calendarCloseBtn: { backgroundColor: BRAND, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  calendarCloseText: { color: "#fff", fontWeight: "700" },

  errorCard: { alignItems: "center", maxWidth: 380 },
  errorText: { color: TEXT, fontWeight: "600", fontSize: 15, textAlign: "center" },
});