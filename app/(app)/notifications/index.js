import React, { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  RefreshControl,
  StatusBar,
  TouchableOpacity,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "../../../lib/supabase";
import { useRouter } from "expo-router";
import { ArrowLeft, Bell } from "lucide-react-native";

const BG = "#f5f7fb";
const CARD = "#ffffff";
const TEXT = "#0b1220";
const MUTED = "#6b7280";
const BORDER = "#e6e9ee";

export default function NotificationsScreen() {
  const router = useRouter();
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Add a computed value for unread notifications
  const hasUnread = notifications.some((n) => !n.read);

  const loadNotifications = useCallback(async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setNotifications([]);
        setLoading(false);
        return;
      }
      const { data, error } = await supabase
        .from("notifications")
        .select("id, title, body, created_at, read")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(50);
      if (!error) setNotifications(data || []);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const markAllAsRead = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      await supabase
        .from("notifications")
        .update({ read: true })
        .eq("user_id", user.id)
        .eq("read", false);
      setNotifications((prev) =>
        prev.map((n) => n.read ? n : { ...n, read: true })
      );
    };

    loadNotifications().then(markAllAsRead);
  }, [loadNotifications]);

  const onRefresh = () => {
    setRefreshing(true);
    loadNotifications();
  };

  const markAsRead = async (id) => {
    await supabase.from("notifications").update({ read: true }).eq("id", id);
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n))
    );
  };

  const markAsUnread = async (id) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: false } : n))
    );
    await supabase.from("notifications").update({ read: false }).eq("id", id);
  };

  const renderItem = ({ item }) => (
    <View style={[styles.card, !item.read && styles.unreadCard]}>
      <Text style={styles.title}>{item.title}</Text>
      {!!item.body && <Text style={styles.body}>{item.body}</Text>}
      <Text style={styles.date}>
        {new Date(item.created_at).toLocaleString()}
      </Text>
      {!item.read ? (
        <Text
          style={styles.markRead}
          onPress={() => markAsRead(item.id)}
        >
          Mark as read
        </Text>
      ) : (
        <Text
          style={styles.markUnread}
          onPress={() => markAsUnread(item.id)}
        >
          Mark as unread
        </Text>
      )}
    </View>
  );

  return (
    <View style={styles.screen}>
      <StatusBar barStyle="dark-content" backgroundColor="#ffffff" />
      <SafeAreaView edges={["top"]} style={styles.headerSafe}>
        <View style={styles.header}>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <ArrowLeft
              size={22}
              color={TEXT}
              style={{ marginRight: 10 }}
              onPress={() => router.back()}
            />
            <Text style={styles.headerTitle}>Notifications</Text>
          </View>
          <TouchableOpacity onPress={loadNotifications} style={{ padding: 4 }}>
            <View>
              <Bell size={20} color={MUTED} />
              {hasUnread && (
                <View style={styles.bellDot} />
              )}
            </View>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={MUTED} />
      ) : (
        <FlatList
          data={notifications}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={{ padding: 16, paddingBottom: 80 }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
          ListEmptyComponent={
            <Text style={{ color: MUTED, textAlign: "center", marginTop: 40 }}>
              No notifications.
            </Text>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },
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
  headerTitle: { color: TEXT, fontSize: 22, fontWeight: "900" },
  card: {
    backgroundColor: CARD,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 14,
    marginBottom: 12,
  },
  unreadCard: {
    borderColor: "#2a86ff",
    backgroundColor: "#eaf2ff",
  },
  title: { fontWeight: "900", fontSize: 16, color: TEXT },
  body: { color: TEXT, marginTop: 4 },
  date: { color: MUTED, marginTop: 8, fontSize: 12 },
  markRead: {
    color: "#2a86ff",
    marginTop: 8,
    fontWeight: "bold",
    fontSize: 13,
    alignSelf: "flex-start",
  },
  markUnread: {
    color: "#ff7a2a",
    marginTop: 8,
    fontWeight: "bold",
    fontSize: 13,
    alignSelf: "flex-start",
  },
  bellDot: {
    position: "absolute",
    top: -2,
    right: -2,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#2a86ff",
    borderWidth: 1,
    borderColor: "#fff",
  },
});
