// app/(app)/settings/reports.js
import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  StatusBar,
  Platform,
  ScrollView,
  ActivityIndicator,
  TouchableOpacity,
  Alert,
  Dimensions,
  Linking,
  Modal,
} from "react-native";
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from "expo-router";
import * as NavigationBar from "expo-navigation-bar";
import * as SystemUI from "expo-system-ui";
import { Feather } from "@expo/vector-icons";
import TopBar from "../../../components/TopBar";
import { supabase } from "../../../lib/supabase";
import * as FileSystem from "expo-file-system";
import * as Sharing from "expo-sharing";
import { LineChart } from "react-native-chart-kit";

/* ---------- THEME ---------- */
const CARD = "#ffffff";
const TEXT = "#0b1220";
const MUTED = "#6b7280";
const BORDER = "#e6e9ee";
const BRAND = "#2a86ff";
const OK = "#16a34a";
const BG = "#ffffff";

/* ---------- HELPERS ---------- */
const money = (v = 0, sym = "£") =>
  sym + Number(v || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const symFor = (cur) => (cur === "USD" ? "$" : cur === "EUR" ? "€" : "£");

function firstDayOfTaxYear() {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth(); // 0-11
  
  // If we're in Jan-Mar, tax year started previous April
  // If we're in Apr-Dec, tax year started this April
  const taxYearStart = currentMonth < 3 ? currentYear - 1 : currentYear;
  return new Date(taxYearStart, 3, 6).toISOString().slice(0, 10); // April 6th
}

function lastDayOfCurrentMonthISO() {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString().slice(0, 10);
}

function getMonthInitial(monthStr) {
  // monthStr format: "2024-04" -> "A" for April
  const monthNames = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
  const monthIndex = parseInt(monthStr.slice(5, 7)) - 1; // Extract month and convert to 0-11
  return monthNames[monthIndex] || '';
}

/* ---------- SMALL UI ---------- */
function InfoButton({ title, tips = [] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <TouchableOpacity onPress={() => setOpen(true)} style={styles.infoBtn}>
        <Text style={{ color: MUTED, fontWeight: "900" }}>i</Text>
      </TouchableOpacity>
      <Modal visible={open} animationType="fade" transparent onRequestClose={() => setOpen(false)}>
        <View style={styles.modalBackdrop} />
        <View style={styles.modalWrap}>
          <View style={styles.modalCard}>
            <View style={styles.modalHead}>
              <Text style={{ color: TEXT, fontWeight: "900", fontSize: 16 }}>{title}</Text>
              <TouchableOpacity onPress={() => setOpen(false)} style={styles.smallBtn}>
                <Text style={styles.smallBtnText}>Close</Text>
              </TouchableOpacity>
            </View>
            {tips.slice(0, 6).map((t, i) => (
              <View key={i} style={{ flexDirection: "row", gap: 8, marginBottom: 8 }}>
                <Text style={{ color: BRAND, fontWeight: "900" }}>•</Text>
                <Text style={{ color: TEXT, flex: 1 }}>{t}</Text>
              </View>
            ))}
          </View>
        </View>
      </Modal>
    </>
  );
}

export default function ReportsSettings() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [serverExporting, setServerExporting] = useState(false);
  const [currency, setCurrency] = useState("GBP");
  const [sym, setSym] = useState("£");
  const [userId, setUserId] = useState(null);

  // headline metrics
  const [revenueYTD, setRevenueYTD] = useState(0);
  const [paymentsYTD, setPaymentsYTD] = useState(0);
  const [outstanding, setOutstanding] = useState(0);
  const [overdueCount, setOverdueCount] = useState(0);

  // monthly
  const [months, setMonths] = useState([]);
  const [monthlyRevenue, setMonthlyRevenue] = useState([]);
  const [monthlyPayments, setMonthlyPayments] = useState([]);

  // raw rows for CSV
  const [invoiceRows, setInvoiceRows] = useState([]);
  const [paymentRows, setPaymentRows] = useState([]);

  /* ---------- STATUS BAR ---------- */
  useEffect(() => {
    StatusBar.setBarStyle("dark-content", false);
    if (Platform.OS === "android") {
      StatusBar.setBackgroundColor("#ffffff", false);
      NavigationBar.setBackgroundColorAsync?.("#ffffff");
      NavigationBar.setButtonStyleAsync?.("dark");
      NavigationBar.setBorderColorAsync?.("#ffffff");
    }
    SystemUI.setBackgroundColorAsync?.("#ffffff");
  }, []);

  /* ---------- MAIN LOAD ---------- */
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);

        const { data: { user } } = await supabase.auth.getUser();
        if (!user) { setLoading(false); return; }
        setUserId(user.id);

        const pref = await supabase.from("profiles").select("invoice_currency").eq("id", user.id).single();
        const cur = (pref.data?.invoice_currency || "GBP").toUpperCase();
        setCurrency(cur);
        setSym(symFor(cur));

        const { data, error } = await supabase.functions.invoke("reports_summary");
        if (error) throw error;
        if (!data?.ok) throw new Error(data?.error || "Failed to load reports");
        if (!alive) return;

        setRevenueYTD(Number(data.revenue_ytd || 0));
        setPaymentsYTD(Number(data.payments_ytd || 0));
        setOutstanding(Number(data.outstanding_total || 0));
        setOverdueCount(Number(data.overdue_count || 0));

        // Process monthly data to start from April (tax year order)
        const monthlyData = Array.isArray(data.monthly) ? data.monthly : [];
        const dataMap = {};
        monthlyData.forEach(m => {
          dataMap[m.month] = m;
        });

        // Generate tax year months (April to March)
        const now = new Date();
        const currentYear = now.getFullYear();
        const currentMonth = now.getMonth(); // 0-11
        const taxYearStart = currentMonth < 3 ? currentYear - 1 : currentYear;
        
        const taxYearMonths = [];
        const taxYearRevenue = [];
        const taxYearPayments = [];
        
        // Generate all 12 months from April of tax year start to March of next year
        for (let i = 0; i < 12; i++) {
          const monthIndex = (3 + i) % 12; // Start from April (index 3)
          const year = monthIndex < 3 ? taxYearStart + 1 : taxYearStart;
          const monthStr = `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
          
          taxYearMonths.push(monthStr);
          const monthData = dataMap[monthStr];
          taxYearRevenue.push(Number(monthData?.revenue || 0));
          taxYearPayments.push(Number(monthData?.payments || 0));
        }

        setMonths(taxYearMonths);
        setMonthlyRevenue(taxYearRevenue);
        setMonthlyPayments(taxYearPayments);

        // preload export rows (local CSV)
        const minIso = firstDayOfTaxYear();
        const maxIso = lastDayOfCurrentMonthISO();

        const inv12 = await supabase
          .from("invoices")
          .select("id,total,issue_date,status")
          .eq("user_id", user.id)
          .gte("issue_date", minIso)
          .lte("issue_date", maxIso)
          .in("status", ["issued", "sent", "partially_paid", "paid"])
          .neq("type", "credit_note");
        if (!inv12.error && alive) setInvoiceRows(inv12.data || []);

        const pay12 = await supabase
          .from("payments")
          .select("amount,paid_at,voided_at,invoice_id,method,reference")
          .is("voided_at", null)
          .not("paid_at", "is", null)
          .gte("paid_at", minIso)
          .lte("paid_at", maxIso);
        if (!pay12.error && alive) setPaymentRows(pay12.data || []);
      } catch (e) {
        Alert.alert("Reports error", String(e?.message || e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  /* ---------- CSV EXPORT (LOCAL) ---------- */
  const toCSV = (rows, headers, mapRow) => {
    const esc = (v) => '"' + String(v ?? "").replace(/"/g, '""') + '"';
    const head = headers.map(esc).join(",");
    const body = rows.map(r => mapRow(r).map(esc).join(",")).join("\n");
    return head + "\n" + body + "\n";
  };

  const exportInvoicesCSV = async () => {
    try {
      if (!invoiceRows.length) { Alert.alert("No invoice data to export"); return; }
      const csv = toCSV(
        invoiceRows,
        ["issue_date", "invoice_id", "total", "status"],
        (r) => [r.issue_date, r.id, r.total, r.status]
      );
      const path = FileSystem.cacheDirectory + "invoices_" + Date.now() + ".csv";
      await FileSystem.writeAsStringAsync(path, csv, { encoding: FileSystem.EncodingType.UTF8 });
      await Sharing.shareAsync(path, { mimeType: "text/csv", dialogTitle: "Export Invoices CSV" });
    } catch (e) {
      Alert.alert("Export failed", String(e?.message || e));
    }
  };

  const exportPaymentsCSV = async () => {
    try {
      if (!paymentRows.length) { Alert.alert("No payment data to export"); return; }
      const csv = toCSV(
        paymentRows,
        ["paid_at", "invoice_id", "amount", "method", "reference"],
        (p) => [p.paid_at, p.invoice_id || "", p.amount, p.method || "", p.reference || ""]
      );
      const path = FileSystem.cacheDirectory + "payments_" + Date.now() + ".csv";
      await FileSystem.writeAsStringAsync(path, csv, { encoding: FileSystem.EncodingType.UTF8 });
      await Sharing.shareAsync(path, { mimeType: "text/csv", dialogTitle: "Export Payments CSV" });
    } catch (e) {
      Alert.alert("Export failed", String(e?.message || e));
    }
  };

  /* ---------- CSV EXPORT (SERVER) ---------- */
  async function exportServer(kind) {
    try {
      setServerExporting(true);
      const { data, error } = await supabase.functions.invoke("reports_export", {
        body: { kind: kind },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || "Export failed");

      const urls = [];
      if (data.invoices_signed_url) urls.push(data.invoices_signed_url);
      if (data.payments_signed_url) urls.push(data.payments_signed_url);

      if (!urls.length) {
        Alert.alert("Export created", "No download link returned.");
        return;
      }
      for (let i = 0; i < urls.length; i++) {
        const u = urls[i];
        const canOpen = await Linking.canOpenURL(u);
        if (canOpen) await Linking.openURL(u);
      }
    } catch (e) {
      Alert.alert("Server export failed", String(e?.message || e));
    } finally {
      setServerExporting(false);
    }
  }

  /* ---------- UI ---------- */
  const headline = useMemo(
    () => [
      { label: "Revenue YTD", value: money(revenueYTD, sym) },
      { label: "Payments YTD", value: money(paymentsYTD, sym) },
      { label: "Outstanding", value: money(outstanding, sym) },
      { label: "Overdue invoices", value: String(overdueCount) },
    ],
    [revenueYTD, paymentsYTD, outstanding, overdueCount, sym]
  );

  const { width } = Dimensions.get("window");
  const chartWidth = width - 48; // Better margin calculation
  const chartLabels = months.map((m) => getMonthInitial(m));

  const chartConfig = {
    backgroundGradientFrom: "#ffffff",
    backgroundGradientTo: "#ffffff",
    decimalPlaces: 0,
    color: (opacity = 1) => "rgba(42,134,255," + opacity + ")", // Use BRAND color
    labelColor: (opacity = 1) => "rgba(107,114,128," + opacity + ")",
    style: {
      borderRadius: 12,
    },
    propsForDots: { 
      r: "4",
      strokeWidth: "2",
      stroke: "#ffffff"
    },
    propsForBackgroundLines: { 
      stroke: BORDER,
      strokeDasharray: ""
    },
    propsForLabels: {
      fontSize: 11,
      fontWeight: "600"
    },
    strokeWidth: 3,
    useShadowColorFromDataset: false,
    formatYLabel: (value) => {
      const num = Math.abs(Number(value));
      if (num >= 1000000) return '£' + (num / 1000000).toFixed(1) + 'M';
      if (num >= 1000) return '£' + (num / 1000).toFixed(0) + 'K';
      return '£' + num.toFixed(0);
    },
  };

  const readyForChart =
    !loading &&
    months.length > 0 &&
    (monthlyRevenue.some((n) => n > 0) || monthlyPayments.some((n) => n > 0));

  if (loading) {
    return (
      <View style={styles.screen}>
        <View style={{ height: insets.top, backgroundColor: CARD }} />
        <View style={styles.header}>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
            <Feather name="arrow-left" size={20} color={TEXT} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Reports & Analytics</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={BRAND} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <View style={{ height: insets.top, backgroundColor: CARD }} />
      
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Feather name="arrow-left" size={20} color={TEXT} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Reports & Analytics</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView style={styles.content} contentContainerStyle={styles.contentContainer}>
        {/* Headline Metrics */}
        <View style={styles.metricsRow}>
          {headline.map((h, idx) => (
            <View key={idx} style={styles.metricCard}>
              <Text style={styles.metricLabel} numberOfLines={2}>{h.label}</Text>
              <Text style={styles.metricValue} numberOfLines={1}>{h.value}</Text>
            </View>
          ))}
        </View>

        {/* Chart */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>Tax Year Revenue & Payments</Text>
            <InfoButton
              title="How this chart works"
              tips={[
                "Shows data from the current UK tax year (April 6th to April 5th).",
                "Revenue = invoice totals on their issue month (excluding credit notes).",
                "Payments = cash received per month (voided payments ignored).",
                "Values reflect your profile currency.",
              ]}
            />
          </View>

          {/* Custom Legend */}
          <View style={styles.chartLegend}>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: BRAND }]} />
              <Text style={styles.legendText}>Revenue (issued)</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: OK }]} />
              <Text style={styles.legendText}>Payments (received)</Text>
            </View>
          </View>

          <View style={styles.chartContainer}>
            {readyForChart ? (
              <View style={styles.chartWrapper}>
                <LineChart
                  width={chartWidth}
                  height={220}
                  data={{
                    labels: chartLabels,
                    datasets: [
                      { 
                        data: monthlyRevenue, 
                        strokeWidth: 3, 
                        color: () => BRAND,
                        withDots: true,
                      },
                      { 
                        data: monthlyPayments, 
                        strokeWidth: 3, 
                        color: () => OK,
                        withDots: true,
                      },
                    ],
                  }}
                  chartConfig={chartConfig}
                  bezier
                  style={styles.chart}
                  withHorizontalLabels={true}
                  withVerticalLabels={true}
                  withInnerLines={true}
                  withOuterLines={false}
                  withHorizontalLines={true}
                  withVerticalLines={false}
                  segments={4}
                />
              </View>
            ) : (
              <View style={styles.chartPlaceholder}>
                <ActivityIndicator size="large" color={BRAND} />
                <Text style={styles.chartPlaceholderText}>Loading chart data...</Text>
              </View>
            )}
          </View>
        </View>

        {/* Exports */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>Export Data</Text>
            <InfoButton
              title="Export options"
              tips={[
                "Export your invoice and payment data as CSV files for analysis or record keeping.",
                "Files can be opened in Excel, Google Sheets, or other spreadsheet applications.",
                "Data includes the last 12 months of transactions.",
              ]}
            />
          </View>

          <View style={styles.exportGrid}>
            <TouchableOpacity style={styles.exportBtn} onPress={exportInvoicesCSV}>
              <Feather name="file-text" size={18} color={BRAND} />
              <Text style={styles.exportBtnText}>Export Invoices</Text>
              <Text style={styles.exportBtnSub}>CSV format</Text>
            </TouchableOpacity>
            
            <TouchableOpacity style={styles.exportBtn} onPress={exportPaymentsCSV}>
              <Feather name="credit-card" size={18} color={BRAND} />
              <Text style={styles.exportBtnText}>Export Payments</Text>
              <Text style={styles.exportBtnSub}>CSV format</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={[styles.exportAllBtn, serverExporting && { opacity: 0.6 }]}
            onPress={() => exportServer("both")}
            disabled={serverExporting}
          >
            {serverExporting ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Feather name="download" size={18} color="#fff" />
            )}
            <Text style={styles.exportAllBtnText}>
              {serverExporting ? "Preparing Export..." : "Export All Data"}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={{ height: 20 }} />
      </ScrollView>
    </View>
  );
}

/* ---------- STYLES ---------- */
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

  metricsRow: { 
    flexDirection: "row", 
    gap: 8,
    marginBottom: 16,
  },
  
  metricCard: {
    flex: 1,
    backgroundColor: CARD,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 10,
    minHeight: 60,
    justifyContent: "space-between",
    ...Platform.select({
      ios: { 
        shadowColor: "#0b1220", 
        shadowOpacity: 0.04, 
        shadowRadius: 6, 
        shadowOffset: { width: 0, height: 2 } 
      },
      android: { elevation: 2 },
    }),
  },
  
  metricLabel: { 
    color: MUTED, 
    fontWeight: "600", 
    marginBottom: 4,
    fontSize: 11,
    lineHeight: 13,
  },
  
  metricValue: { 
    color: TEXT, 
    fontWeight: "900", 
    fontSize: 13,
  },

  card: {
    backgroundColor: CARD,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 16,
    marginBottom: 16,
    ...Platform.select({
      ios: { 
        shadowColor: "#0b1220", 
        shadowOpacity: 0.06, 
        shadowRadius: 8, 
        shadowOffset: { width: 0, height: 4 } 
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
  
  cardTitle: { 
    color: TEXT, 
    fontWeight: "900", 
    fontSize: 16 
  },

  chartContainer: { 
    minHeight: 260, 
    justifyContent: "center",
    alignItems: "center",
    marginTop: 8,
  },

  chartWrapper: {
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
  },

  chart: {
    marginVertical: 8,
    borderRadius: 12,
  },

  chartLegend: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 24,
    marginBottom: 8,
    paddingVertical: 8,
  },

  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },

  legendDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },

  legendText: {
    fontSize: 12,
    fontWeight: "600",
    color: TEXT,
  },

  chartPlaceholder: {
    height: 220,
    alignItems: "center", 
    justifyContent: "center",
    gap: 12,
  },

  chartPlaceholderText: {
    color: MUTED,
    fontSize: 14,
    fontWeight: "500",
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

  exportGrid: { 
    flexDirection: "row", 
    gap: 12,
    marginTop: 8,
    marginBottom: 16,
  },

  exportBtn: {
    flex: 1,
    backgroundColor: "#fff",
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 12,
    alignItems: "center",
    borderWidth: 1,
    borderColor: BORDER,
    gap: 6,
  },
  
  exportBtnText: { 
    color: TEXT, 
    fontWeight: "700",
    fontSize: 13,
    textAlign: "center",
  },

  exportBtnSub: {
    color: MUTED,
    fontSize: 11,
    fontWeight: "500",
  },

  exportAllBtn: {
    backgroundColor: BRAND,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: BRAND,
    flexDirection: "row",
    gap: 8,
  },
  
  exportAllBtnText: { 
    color: "#fff", 
    fontWeight: "700",
    fontSize: 14,
  },

  /* Modal */
  modalBackdrop: {
    position: "absolute",
    inset: 0,
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  modalWrap: { 
    flex: 1, 
    justifyContent: "center", 
    alignItems: "center", 
    padding: 16,
  },
  modalCard: {
    backgroundColor: CARD,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: BORDER,
    width: "92%",
    maxWidth: 480,
    ...Platform.select({
      ios: { 
        shadowColor: "#000", 
        shadowOpacity: 0.15, 
        shadowRadius: 16, 
        shadowOffset: { width: 0, height: 6 } 
      },
      android: { elevation: 10 },
    }),
  },
  modalHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  smallBtn: { 
    paddingVertical: 6, 
    paddingHorizontal: 12, 
    borderRadius: 8, 
    backgroundColor: "#f3f4f6" 
  },
  smallBtnText: { 
    color: TEXT, 
    fontWeight: "700", 
    fontSize: 12 
  },
});