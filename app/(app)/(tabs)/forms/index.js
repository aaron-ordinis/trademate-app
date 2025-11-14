import React, { useCallback, useEffect, useState } from "react";
import {
  View, Text, StyleSheet, Platform, FlatList,
  TouchableOpacity, TextInput, Alert, StatusBar
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import {
  Settings, RefreshCcw, Bell, Search, Plus, CalendarDays, MapPin, FileText, Trash2
} from "lucide-react-native";
import { supabase } from "../../../../lib/supabase";
import AssistantFab from "../../../../components/AssistantFab";
import AssistantSheet from "../../../../components/AssistantSheet";

const BG = "#f5f7fb";
const CARD = "#ffffff";
const TEXT = "#0b1220";
const MUTED = "#6b7280";
const BORDER = "#e6e9ee";
const BRAND = "#2a86ff";

export default function FormsIndex() {
  const router = useRouter();
  const [forms, setForms] = useState([]);
  const [query, setQuery] = useState("");
  const [unreadCount, setUnreadCount] = useState(0);
  const [dataLoaded, setDataLoaded] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  const fetchUnread = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setUnreadCount(0); return; }
      const { count } = await supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("read", false);
      setUnreadCount(count || 0);
    } catch {}
  }, []);

  const load = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setForms([]); setDataLoaded(true); return; }
      let q = supabase
        .from("forms")
        .select("id, form_number, title, status, client_name, client_address, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(200);
      if (query.trim()) {
        const t = query.trim();
        q = q.or("client_name.ilike.%"+t+"%,form_number.ilike.%"+t+"%,title.ilike.%"+t+"%");
      }
      const res = await q;
      if (!res.error) setForms(res.data || []);
      setDataLoaded(true);
    } catch {
      setDataLoaded(true);
    }
  }, [query]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { fetchUnread(); const i = setInterval(fetchUnread, 30000); return () => clearInterval(i); }, [fetchUnread]);

  const confirmDelete = (row) => {
    Alert.alert(
      "Delete form?",
      "This will permanently delete this form.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              setDeletingId(row.id);
              const prev = forms;
              setForms(prev.filter(f => f.id !== row.id));
              const del = await supabase.from("forms").delete().eq("id", row.id);
              if (del.error) {
                setForms(prev);
                Alert.alert("Delete failed", del.error.message || "Please try again.");
              }
            } finally {
              setDeletingId(null);
            }
          }
        }
      ]
    );
  };

  const renderCard = ({ item }) => {
    return (
      <TouchableOpacity
        style={styles.card}
        activeOpacity={0.9}
        onPress={() => {
          router.push({
            pathname: "/(app)/forms/preview",
            params: { form_id: item.id }
          });
        }}
      >
        {!!item.form_number && (
          <Text style={styles.tiny} numberOfLines={1}>{item.form_number}</Text>
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
          {item.client_name || "Client"}
        </Text>

        <View style={styles.rowMini}>
          <CalendarDays size={16} color={MUTED} />
          <Text style={styles.rowMiniText}>  {new Date(item.created_at).toLocaleDateString()}</Text>
        </View>

        {!!item.title && (
          <View style={styles.rowMini}>
            <FileText size={16} color={MUTED} />
            <Text style={[styles.rowMiniText, { flex: 1 }]} numberOfLines={1}>  {item.title}</Text>
          </View>
        )}

        {!!item.client_address && (
          <View style={styles.rowMini}>
            <MapPin size={16} color={MUTED} />
            <Text style={[styles.rowMiniText, { flex: 1 }]} numberOfLines={1}>  {item.client_address}</Text>
          </View>
        )}
      </TouchableOpacity>
    );
  };

  if (!dataLoaded) {
    return (
      <View style={styles.screen}>
        <StatusBar barStyle="dark-content" backgroundColor="#ffffff" />
        <SafeAreaView edges={["top"]} style={styles.headerSafe}>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>Forms</Text>
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

  return (
    <View style={styles.screen}>
      <StatusBar barStyle="dark-content" backgroundColor="#ffffff" />
      <SafeAreaView edges={["top"]} style={styles.headerSafe}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Forms</Text>
          <View style={styles.headerRight}>
            <TouchableOpacity
              style={styles.iconBtn}
              onPress={() => router.push("/(app)/notifications")}
              activeOpacity={0.9}
            >
              <Bell size={18} color={MUTED} />
              {unreadCount > 0 && (
                <View style={styles.bellBadge}>
                  <Text style={styles.bellBadgeText}>{unreadCount > 9 ? "9+" : unreadCount}</Text>
                </View>
              )}
            </TouchableOpacity>
            <TouchableOpacity style={styles.iconBtn} onPress={load} activeOpacity={0.9}>
              <RefreshCcw size={18} color={MUTED} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.iconBtn}
              onPress={() => router.push("/(app)/settings")}
              activeOpacity={0.9}
            >
              <Settings size={18} color={MUTED} />
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>

      <View style={styles.searchRow}>
        <Search size={18} color={MUTED} style={{ marginRight: 8 }} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search client, form number or title"
          placeholderTextColor={MUTED}
          style={styles.searchInput}
          returnKeyType="search"
          onSubmitEditing={load}
        />
      </View>

      <FlatList
        data={forms}
        keyExtractor={(it) => String(it.id)}
        renderItem={renderCard}
        contentContainerStyle={{
          paddingBottom: 140,
          paddingTop: 14,
          paddingHorizontal: 16,
        }}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        ListEmptyComponent={
          <Text style={{ color: MUTED, textAlign: "center", marginTop: 28, fontWeight: "800" }}>
            No forms found.
          </Text>
        }
      />

      <TouchableOpacity
        onPress={() => router.push("/(app)/forms/create")}
        style={styles.fab}
        activeOpacity={0.9}
      >
        <Plus size={24} color="#fff" />
      </TouchableOpacity>

      <AssistantFab onPress={() => setAssistantOpen(true)} />
      <AssistantSheet
        visible={assistantOpen}
        onClose={() => setAssistantOpen(false)}
        context="forms"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },
  headerSafe: { backgroundColor: CARD },
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
    height: 38, width: 38, borderRadius: 10, borderWidth: 1, borderColor: BORDER,
    alignItems: "center", justifyContent: "center", backgroundColor: CARD,
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
    minHeight: 90,
    ...Platform.select({
      ios: {
        shadowColor: "#0b1220",
        shadowOpacity: 0.12,
        shadowRadius: 18,
        shadowOffset: { width: 0, height: 10 },
      },
      android: { elevation: 6 },
    }),
  },
  client: { color: TEXT, fontWeight: "900", fontSize: 16 },
  rowMini: { flexDirection: "row", alignItems: "center", marginTop: 6 },
  rowMiniText: { color: MUTED },
  tiny: {
    position: "absolute", right: 56, top: 14, color: MUTED, fontSize: 12, maxWidth: 140, textAlign: "right",
  },
  binBtn: {
    position: "absolute", right: 12, top: 12, height: 34, width: 34, borderRadius: 10,
    alignItems: "center", justifyContent: "center",
    backgroundColor: "#fee2e2", borderWidth: 1, borderColor: "#fecaca", zIndex: 5,
  },
  fab: {
    position: "absolute", right: 18, bottom: 18, width: 56, height: 56, borderRadius: 28,
    backgroundColor: BRAND, alignItems: "center", justifyContent: "center",
    shadowColor: BRAND, shadowOpacity: 0.35, shadowRadius: 10, shadowOffset: { width: 0, height: 6 }, elevation: 6,
  },
  bellBadge: {
    position: "absolute", top: 2, right: 2, minWidth: 16, height: 16, borderRadius: 8,
    backgroundColor: BRAND, alignItems: "center", justifyContent: "center", paddingHorizontal: 3,
    zIndex: 10, borderWidth: 2, borderColor: "#fff",
  },
  bellBadgeText: { color: "#fff", fontSize: 10, fontWeight: "bold" },
});
