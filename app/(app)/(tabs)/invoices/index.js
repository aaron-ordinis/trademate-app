// app/(app)/invoices/index.js
import React, { useEffect, useState, useCallback } from "react";
import {
  View, Text, StyleSheet, Platform, ActivityIndicator, FlatList,
  TouchableOpacity, Alert, TextInput, Pressable
} from "react-native";
import { Settings, Plus, Trash2, CalendarDays, MapPin, Search } from "lucide-react-native";
import { useRouter } from "expo-router";
import { supabase } from "../../../../lib/supabase";
import TopBar, { IconBtn } from "../../../../components/TopBar";
import { invoiceWizardHref, settingsHref } from "../../../../lib/nav";
import { isPremiumUser, getPremiumStatus, isUserBlocked } from "../../../../lib/premium";
import PaywallModal from "../../../../components/PaywallModal";

const BG = "#f5f7fb";
const CARD = "#ffffff";
const TEXT = "#0b1220";
const MUTED = "#6b7280";
const BORDER = "#e6e9ee";
const BRAND = "#2a86ff";

const money = (v = 0) =>
  "£" + Number(v || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

export default function InvoicesHome() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [invoices, setInvoices] = useState([]);
  const [deletingId, setDeletingId] = useState(null);
  const [query, setQuery] = useState("");
  const [premiumStatus, setPremiumStatus] = useState({ isPremium: false, status: 'no_profile' });
  const [showPaywall, setShowPaywall] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const { data: auth } = await supabase.auth.getUser();
      const user = auth?.user;
      if (!user) return;

      // Load premium status
      const { data: profile } = await supabase
        .from("profiles")
        .select("trial_ends_at, plan_tier, plan_status")
        .eq("id", user.id)
        .maybeSingle();
      
      if (profile) {
        const status = getPremiumStatus(profile);
        setPremiumStatus(status);
        
        // Hard block if trial expired
        if (status.isBlocked) {
          router.replace("/(app)/trial-expired");
          return;
        }
      }

      let q = supabase
        .from("invoices")
        .select(`
          id,
          user_id,
          invoice_number,
          status,
          client_name,
          client_address,
          site_address,
          total,
          balance_due,
          currency,
          due_date
        `)
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(200);

      if (query.trim()) {
        const t = query.trim();
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
    // Premium feature check
    if (!premiumStatus.isPremium) {
      setShowPaywall(true);
      return;
    }

    Alert.alert(
      "Delete invoice?",
      `This will delete ${inv.invoice_number} and all related items/payments/attachments. This cannot be undone.`,
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

  const renderCard = ({ item }) => {
    const address = item.site_address || item.client_address || "";
    const due = item.due_date ? new Date(item.due_date).toLocaleDateString() : "No due date";

    return (
      <Pressable
        onPress={() =>
          router.push({
            pathname: "/(app)/invoices/preview",
            params: {
              id: item.id,
              name: item?.invoice_number ? `${item.invoice_number}.pdf` : "invoice.pdf",
            },
          })
        }
        style={({ pressed }) => [styles.card, pressed && { transform: [{ scale: 0.995 }] }]}
      >
        {/* invoice number tiny (same as Quotes) */}
        {!!item.invoice_number && (
          <Text style={styles.invoiceTiny} numberOfLines={1}>{item.invoice_number}</Text>
        )}

        {/* bin button (same as Quotes) */}
        <TouchableOpacity
          style={[styles.binBtn, deletingId === item.id && { opacity: 0.5 }]}
          onPress={() => confirmDelete(item)}
          disabled={deletingId === item.id}
          activeOpacity={0.85}
        >
          <Trash2 size={18} color="#b91c1c" />
        </TouchableOpacity>

        {/* client */}
        <Text style={styles.client} numberOfLines={1}>
          {item.client_name || "Client"}
        </Text>

        {/* date */}
        <View style={styles.rowMini}>
          <CalendarDays size={16} color={MUTED} />
          <Text style={styles.rowMiniText}>  {due}</Text>
        </View>

        {/* address row with total on the right (like Jobs/Quotes) */}
        <View style={styles.rowMini}>
          <MapPin size={16} color={MUTED} />
          <Text style={[styles.rowMiniText, styles.addressText]} numberOfLines={1}>
            {"  "}{address}
          </Text>
          <Text style={styles.totalRight}>{money(item.total || 0)}</Text>
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

      {/* search (identical to Quotes) */}
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

  // Search row
  searchRow: {
    marginTop: 14, marginHorizontal: 16, backgroundColor: CARD, borderRadius: 12,
    borderWidth: 1, borderColor: BORDER, paddingHorizontal: 12, paddingVertical: 10,
    flexDirection: "row", alignItems: "center",
  },
  searchInput: { flex: 1, color: TEXT },

  // Card (matches Quotes/Jobs)
  card: {
    backgroundColor: CARD, marginHorizontal: 16, padding: 14, borderRadius: 16,
    borderWidth: 1, borderColor: BORDER, shadowColor: "#0b1220", shadowOpacity: 0.04,
    shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 2, marginBottom: 2,
    minHeight: 92,
  },
  client: { color: TEXT, fontWeight: "900", fontSize: 16 },

  rowMini: { flexDirection: "row", alignItems: "center", marginTop: 6 },
  rowMiniText: { color: MUTED },
  addressText: { flex: 1, paddingRight: 8, marginLeft: 2 }, // flex expands, keeps total to the right
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