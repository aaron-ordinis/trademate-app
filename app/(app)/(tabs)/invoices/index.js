// app/(app)/invoices/index.js
import React, { useEffect, useState, useCallback } from "react";
import {
  View, Text, StyleSheet, Platform, FlatList,
  TouchableOpacity, Alert, TextInput, Pressable, StatusBar
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Settings, Trash2, CalendarDays, MapPin, Search, RefreshCcw } from "lucide-react-native";
import { useRouter } from "expo-router";
import { supabase } from "../../../../lib/supabase";
import { settingsHref } from "../../../../lib/nav";
import { getPremiumStatus } from "../../../../lib/premium";
import PaywallModal from "../../../../components/PaywallModal";

/* --- AI assistant --- */
import AssistantFab from "../../../../components/AssistantFab";
import AssistantSheet from "../../../../components/AssistantSheet";

const BG = "#f5f7fb";
const CARD = "#ffffff";
const TEXT = "#0b1220";
const MUTED = "#6b7280";
const BORDER = "#e6e9ee";
const BRAND = "#2a86ff";

/* tiny logger */
function log(tag, obj) {
  try { console.log("[invoices.index]", tag, obj || {}); } catch {}
}

function moneyGBP(v = 0) {
  return "£" + Number(v || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
function sym(cur) {
  const c = String(cur || "GBP").toUpperCase();
  if (c === "USD") return "$";
  if (c === "EUR") return "€";
  if (c === "GBP" || c === "UKP") return "£";
  if (c === "AUD" || c === "CAD" || c === "NZD") return "$";
  return "£";
}
function money(v = 0, cur = "GBP") {
  const s = sym(cur);
  return s + Number(v || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export default function InvoicesHome() {
  const router = useRouter();
  const [invoices, setInvoices] = useState([]);
  const [deletingId, setDeletingId] = useState(null);
  const [query, setQuery] = useState("");
  const [premiumStatus, setPremiumStatus] = useState({ isPremium: false, status: "no_profile" });
  const [showPaywall, setShowPaywall] = useState(false);
  const [dataLoaded, setDataLoaded] = useState(false);

  /* --- AI assistant state --- */
  const [assistantOpen, setAssistantOpen] = useState(false);

  const openAssistant = () => {
    if (assistantOpen) return;
    setAssistantOpen(true);
    log("assistant.open", { screen: "invoices" });
  };
  const closeAssistant = () => {
    setAssistantOpen(false);
    log("assistant.close", { screen: "invoices" });
  };

  const load = useCallback(async () => {
    try {
      const { data: auth } = await supabase.auth.getUser();
      const user = auth && auth.user ? auth.user : null;
      if (!user) return;

      const profQuery = supabase
        .from("profiles")
        .select("trial_ends_at, plan_tier, plan_status")
        .eq("id", user.id)
        .maybeSingle();

      const invoicesQuery = (function () {
        let q = supabase
          .from("invoices")
          .select("\n              id,\n              user_id,\n              invoice_number,\n              status,\n              client_id,\n              job_id,\n              client_name,\n              client_address,\n              site_address,\n              total,\n              balance_due,\n              currency,\n              due_date,\n              clients:client_id ( name, address ),\n              jobs:job_id ( client_name, client_address, site_address )\n            ")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(200);

        if (query.trim()) {
          const t = query.trim();
          q = q.or("client_name.ilike.%"+t+"%,invoice_number.ilike.%"+t+"%");
        }
        return q;
      })();

      const results = await Promise.all([profQuery, invoicesQuery]);
      const profResult = results[0];
      const invoicesResult = results[1];

      if (!profResult.error && profResult.data) {
        const status = getPremiumStatus(profResult.data);
        setPremiumStatus(status);
        if (status.isBlocked) {
          router.replace("/(app)/trial-expired");
          return;
        }
      }

      if (!invoicesResult.error) {
        setInvoices(invoicesResult.data || []);
      }

      setDataLoaded(true);
    } catch (e) {
      console.error("[invoices] load", e);
      setDataLoaded(true);
    }
  }, [query, router]);

  useEffect(() => { load(); }, [load]);

  const confirmDelete = (inv) => {
    if (!premiumStatus.isPremium) {
      setShowPaywall(true);
      return;
    }
    Alert.alert(
      "Delete invoice?",
      "This will delete " + (inv.invoice_number || "the invoice") + " and all related items/payments/attachments. This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: function () { handleDelete(inv.id); } },
      ]
    );
  };

  const handleDelete = async (invoiceId) => {
    try {
      setDeletingId(invoiceId);
      const prev = invoices;
      setInvoices(function (list) { return list.filter(function (x) { return x.id !== invoiceId; }); });

      const call = await supabase.functions.invoke("delete_invoice", { body: { invoice_id: invoiceId } });
      const error = call && call.error ? call.error : null;
      if (error) {
        setInvoices(prev);
        Alert.alert("Delete failed", error.message || "Please try again.");
      }
    } catch (error) {
      console.warn("[InvoicesHome] delete error:", error);
    } finally {
      setDeletingId(null);
    }
  };

  function deriveName(row) {
    return (
      row && row.client_name
        ? row.client_name
        : row && row.clients && row.clients.name
          ? row.clients.name
          : row && row.jobs && row.jobs.client_name
            ? row.jobs.client_name
            : "Client"
    );
  }
  function deriveAddress(row) {
    if (!row) return "";
    return (
      row.site_address ||
      row.client_address ||
      (row.jobs && row.jobs.site_address) ||
      (row.jobs && row.jobs.client_address) ||
      (row.clients && row.clients.address) ||
      ""
    );
  }

  const renderCard = ({ item }) => {
    const address = deriveAddress(item);
    const due = item && item.due_date ? new Date(item.due_date).toLocaleDateString() : "No due date";
    const displayName = deriveName(item);

    return (
      <Pressable
        onPress={function () {
          router.push({
            pathname: "/(app)/invoices/preview",
            params: {
              invoice_id: item.id,
              name: item && item.invoice_number ? item.invoice_number + ".pdf" : "invoice.pdf",
            },
          });
        }}
        style={function ({ pressed }) { return [styles.card, pressed && { transform: [{ scale: 0.995 }] }]; }}
      >
        {!!item.invoice_number && (
          <Text style={styles.invoiceTiny} numberOfLines={1}>{item.invoice_number}</Text>
        )}

        <TouchableOpacity
          style={[styles.binBtn, deletingId === item.id && { opacity: 0.5 }]}
          onPress={function () { confirmDelete(item); }}
          disabled={deletingId === item.id}
          activeOpacity={0.85}
        >
          <Trash2 size={18} color="#b91c1c" />
        </TouchableOpacity>

        <Text style={styles.client} numberOfLines={1}>
          {displayName}
        </Text>

        <View style={styles.rowMini}>
          <CalendarDays size={16} color={MUTED} />
          <Text style={styles.rowMiniText}>  {due}</Text>
        </View>

        <View style={styles.rowMini}>
          <MapPin size={16} color={MUTED} />
          <Text style={[styles.rowMiniText, styles.addressText]} numberOfLines={1}>
            {"  "}{address}
          </Text>
          <Text style={styles.totalRight}>{money(item.total || 0, item.currency || "GBP")}</Text>
        </View>
      </Pressable>
    );
  };

  if (!dataLoaded) {
    return (
      <View style={styles.screen}>
        <StatusBar barStyle="dark-content" backgroundColor="#ffffff" />
        <SafeAreaView edges={["top"]} style={styles.headerSafe}>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>Invoices</Text>
            <View style={styles.headerRight}>
              <View style={[styles.iconBtn, { backgroundColor: "#f3f4f6" }]} />
              <View style={[styles.iconBtn, { backgroundColor: "#f3f4f6" }]} />
            </View>
          </View>
        </SafeAreaView>
        <View style={styles.searchRow}>
          <View style={{ width: 18, height: 18, backgroundColor: "#f3f4f6", borderRadius: 9 }} />
          <View style={{ flex: 1, height: 18, backgroundColor: "#f3f4f6", borderRadius: 4, marginLeft: 8 }} />
        </View>
      </View>
    );
  }

  const right = (
    <View style={{ flexDirection: "row", gap: 8 }}>
      <TouchableOpacity
        style={styles.iconBtn}
        onPress={load}
        activeOpacity={0.9}
      >
        <RefreshCcw size={18} color={MUTED} />
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.iconBtn}
        onPress={function () { router.push(settingsHref); }}
        activeOpacity={0.9}
      >
        <Settings size={18} color={MUTED} />
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={styles.screen}>
      {/* White header including status bar — matches Quotes exactly */}
      <StatusBar barStyle="dark-content" backgroundColor="#ffffff" />
      <SafeAreaView edges={["top"]} style={styles.headerSafe}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Invoices</Text>
          <View style={styles.headerRight}>{right}</View>
        </View>
      </SafeAreaView>

      <View style={styles.searchRow}>
        <Search size={18} color={MUTED} style={{ marginRight: 8 }} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search client, invoice number or address"
          placeholderTextColor={MUTED}
          style={styles.searchInput}
          returnKeyType="search"
          onSubmitEditing={load}
        />
      </View>

      <FlatList
        data={invoices}
        keyExtractor={function (item) { return String(item.id); }}
        renderItem={renderCard}
        contentContainerStyle={{
          paddingBottom: 140,
          paddingTop: 14,
          paddingHorizontal: 16,
        }}
        ItemSeparatorComponent={function () { return <View style={{ height: 10 }} />; }}
        ListEmptyComponent={
          <Text
            style={{
              color: MUTED,
              textAlign: "center",
              marginTop: 28,
              fontWeight: "800",
            }}
          >
            No invoices found.
          </Text>
        }
      />

      {/* AI Assistant FAB (bottom-left) + sheet */}
      <AssistantFab onPress={openAssistant} />
      <AssistantSheet
        visible={assistantOpen}
        onClose={closeAssistant}
        context="invoices"
      />

      <PaywallModal
        visible={showPaywall}
        onClose={function () { setShowPaywall(false); }}
        onSubscribe={function () {
          setShowPaywall(false);
          router.push("/(app)/billing");
        }}
        title="Premium Feature"
        message="Advanced invoice management is a premium feature."
      />
    </View>
  );
}

const styles = StyleSheet.create({
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

  card: {
    backgroundColor: CARD,
    padding: 14,
    borderRadius: 16,
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
    minHeight: 92,
  },
  client: { color: TEXT, fontWeight: "900", fontSize: 16 },

  rowMini: { flexDirection: "row", alignItems: "center", marginTop: 6 },
  rowMiniText: { color: MUTED },
  addressText: { flex: 1, paddingRight: 8, marginLeft: 2 },
  totalRight: { fontSize: 16, fontWeight: "900", color: TEXT, marginLeft: 8 },

  invoiceTiny: {
    position: "absolute", right: 54, top: 14, color: MUTED, fontSize: 12, maxWidth: 140, textAlign: "right",
  },
  binBtn: {
    position: "absolute",
    right: 12, top: 12, height: 34, width: 34, borderRadius: 10,
    alignItems: "center", justifyContent: "center",
    backgroundColor: "#fee2e2", borderWidth: 1, borderColor: "#fecaca", zIndex: 5,
  },
});