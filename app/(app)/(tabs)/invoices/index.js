// app/(app)/invoices/index.js
import React, { useEffect, useState, useCallback } from "react";
import {
  View, Text, StyleSheet, Platform, ActivityIndicator, FlatList,
  TouchableOpacity, Alert, TextInput, Pressable
} from "react-native";
import { Settings, Trash2, CalendarDays, MapPin, Search } from "lucide-react-native";
import { useRouter } from "expo-router";
import { supabase } from "../../../../lib/supabase";
import TopBar, { IconBtn } from "../../../../components/TopBar";
import { settingsHref } from "../../../../lib/nav";
import { getPremiumStatus } from "../../../../lib/premium";
import PaywallModal from "../../../../components/PaywallModal";

const BG = "#f5f7fb";
const CARD = "#ffffff";
const TEXT = "#0b1220";
const MUTED = "#6b7280";
const BORDER = "#e6e9ee";
const BRAND = "#2a86ff";

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
  const [loading, setLoading] = useState(true);
  const [invoices, setInvoices] = useState([]);
  const [deletingId, setDeletingId] = useState(null);
  const [query, setQuery] = useState("");
  const [premiumStatus, setPremiumStatus] = useState({ isPremium: false, status: "no_profile" });
  const [showPaywall, setShowPaywall] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const { data: auth } = await supabase.auth.getUser();
      const user = auth?.user;
      if (!user) return;

      // premium state
      const prof = await supabase
        .from("profiles")
        .select("trial_ends_at, plan_tier, plan_status")
        .eq("id", user.id)
        .maybeSingle();
      if (!prof.error && prof.data) {
        const status = getPremiumStatus(prof.data);
        setPremiumStatus(status);
        if (status.isBlocked) {
          router.replace("/(app)/trial-expired");
          return;
        }
      }

      // NOTE: we join both clients and jobs to derive display fields when invoice columns are empty
      // - clients:client_id ( name, address )
      // - jobs:job_id ( client_name, client_address, site_address )
      let q = supabase
        .from("invoices")
        .select(`
          id,
          user_id,
          invoice_number,
          status,
          client_id,
          job_id,
          client_name,
          client_address,
          site_address,
          total,
          balance_due,
          currency,
          due_date,
          clients:client_id ( name, address ),
          jobs:job_id ( client_name, client_address, site_address )
        `)
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(200);

      if (query.trim()) {
        const t = query.trim();
        // search against invoice number and client name on invoice row
        // (joins can't be filtered in a single OR easily without RLS complexity; this keeps it simple)
        q = q.or(`client_name.ilike.%${t}%,invoice_number.ilike.%${t}%`);
      }

      const { data, error } = await q;
      if (!error) setInvoices(data || []);
    } finally {
      setLoading(false);
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
        { text: "Delete", style: "destructive", onPress: () => handleDelete(inv.id) },
      ]
    );
  };

  const handleDelete = async (invoiceId) => {
    try {
      setDeletingId(invoiceId);
      const prev = invoices;
      setInvoices((list) => list.filter((x) => x.id !== invoiceId));
      const { error } = await supabase.functions.invoke("delete_invoice", { body: { invoice_id: invoiceId } });
      if (error) {
        setInvoices(prev);
        Alert.alert("Delete failed", error.message || "Please try again.");
      }
    } finally {
      setDeletingId(null);
    }
  };

  function deriveName(row) {
    return (
      row?.client_name ||
      row?.clients?.name ||
      row?.jobs?.client_name ||
      "Client"
    );
  }
  function deriveAddress(row) {
    return (
      row?.site_address ||
      row?.client_address ||
      row?.jobs?.site_address ||
      row?.jobs?.client_address ||
      row?.clients?.address ||
      ""
    );
  }

  const renderCard = ({ item }) => {
    const address = deriveAddress(item);
    const due = item.due_date ? new Date(item.due_date).toLocaleDateString() : "No due date";
    const displayName = deriveName(item);

    return (
      <Pressable
        onPress={() =>
          router.push({
            pathname: "/(app)/invoices/preview",
            params: {
              invoice_id: item.id, // accept invoice_id in preview
              name: item?.invoice_number ? (item.invoice_number + ".pdf") : "invoice.pdf",
            },
          })
        }
        style={({ pressed }) => [styles.card, pressed && { transform: [{ scale: 0.995 }] }]}
      >
        {!!item.invoice_number && (
          <Text style={styles.invoiceTiny} numberOfLines={1}>{item.invoice_number}</Text>
        )}

        <TouchableOpacity
          style={[styles.binBtn, deletingId === item.id && { opacity: 0.5 }]}
          onPress={() => confirmDelete(item)}
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

  return (
    <View style={styles.screen}>
      <TopBar
        title="Invoices"
        right={
          <IconBtn onPress={() => router.push(settingsHref)}>
            <Settings size={20} color={MUTED} />
          </IconBtn>
        }
      />

      <View style={styles.searchRow}>
        <Search size={18} color={MUTED} style={{ marginRight: 8 }} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search client or invoice number"
          placeholderTextColor={MUTED}
          style={styles.searchInput}
          returnKeyType="search"
          onSubmitEditing={load}
          paddingVertical={10}
        />
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={BRAND} />
        </View>
      ) : (
        <FlatList
          data={invoices}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderCard}
          contentContainerStyle={{ paddingBottom: 120, paddingTop: 14 }}
          ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
        />
      )}

      <PaywallModal
        visible={showPaywall}
        onClose={() => setShowPaywall(false)}
        onSubscribe={() => {
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
  screen: { flex: 1, backgroundColor: BG, paddingTop: Platform.OS === "android" ? 8 : 0 },

  searchRow: {
    marginTop: 14, marginHorizontal: 16, backgroundColor: CARD, borderRadius: 12,
    borderWidth: 1, borderColor: BORDER, paddingHorizontal: 12, paddingVertical: 10,
    flexDirection: "row", alignItems: "center",
  },
  searchInput: { flex: 1, color: TEXT },

  card: {
    backgroundColor: CARD, marginHorizontal: 16, padding: 14, borderRadius: 16,
    borderWidth: 1, borderColor: BORDER, shadowColor: "#0b1220", shadowOpacity: 0.04,
    shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 2, marginBottom: 2,
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