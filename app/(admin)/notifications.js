import React, { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  StatusBar,
  Platform,
  TouchableOpacity,
  ScrollView,
  Alert,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import * as NavigationBar from "expo-navigation-bar";
import * as SystemUI from "expo-system-ui";
import { Feather } from "@expo/vector-icons";
import { supabase } from "../../lib/supabase";

/* ---------- THEME ---------- */
const CARD = "#ffffff";
const TEXT = "#0b1220";
const MUTED = "#6b7280";
const BORDER = "#e6e9ee";
const BRAND = "#2a86ff";
const BG = "#ffffff";
const SUCCESS = "#10b981";
const WARNING = "#f59e0b";
const DANGER = "#dc2626";

/* ---------- HELPERS ---------- */
function getNotificationIcon(type) {
  var t = type ? String(type).toLowerCase() : "info";
  if (t === "support_message") return { name: "message-circle", color: BRAND };
  if (t === "quote_created") return { name: "file-plus", color: SUCCESS };
  if (t === "error" || t === "critical") return { name: "alert-circle", color: DANGER };
  if (t === "warning") return { name: "alert-triangle", color: WARNING };
  if (t === "success") return { name: "check-circle", color: SUCCESS };
  return { name: "info", color: BRAND };
}

function formatRelativeTime(dateString) {
  if (!dateString) return "";
  try {
    var date = new Date(dateString);
    var now = new Date();
    var diffMs = now.getTime() - date.getTime();
    var diffMins = Math.floor(diffMs / (1000 * 60));
    var diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    var diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return String(diffMins) + "m ago";
    if (diffHours < 24) return String(diffHours) + "h ago";
    if (diffDays < 7) return String(diffDays) + "d ago";
    return date.toLocaleDateString();
  } catch (e) {
    return "";
  }
}

/* ---------- SCREEN ---------- */
export default function AdminNotifications() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [rows, setRows] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUnreadCount, setLastUnreadCount] = useState(0);
  const [showUnreadDot, setShowUnreadDot] = useState(false);

  useEffect(function () {
    StatusBar.setBarStyle("dark-content", false);
    if (Platform.OS === "android") {
      StatusBar.setBackgroundColor("#ffffff", false);
      if (NavigationBar.setBackgroundColorAsync) NavigationBar.setBackgroundColorAsync("#ffffff");
      if (NavigationBar.setButtonStyleAsync) NavigationBar.setButtonStyleAsync("dark");
      if (NavigationBar.setBorderColorAsync) NavigationBar.setBorderColorAsync("#ffffff");
    }
    if (SystemUI.setBackgroundColorAsync) SystemUI.setBackgroundColorAsync("#ffffff");
  }, []);

  const loadNotifications = useCallback(async function () {
    try {
      const q = supabase
        .from("notifications")
        .select("id, title, body, created_at, read, type, quote_id, ticket_id")
        .order("created_at", { ascending: false })
        .limit(100);
      const { data, error } = await q;
      if (error) throw error;
      setRows(data || []);
    } catch (e) {
      Alert.alert("Error", "Failed to load notifications");
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(function () {
    const unsub = router.addListener ? router.addListener("focus", function () { loadNotifications(); }) : null;
    loadNotifications();
    return function () { if (unsub && unsub.remove) unsub.remove(); };
  }, [router, loadNotifications]);

  useEffect(function () {
    const unreadCount = rows.filter(function (n) { return !n.read; }).length;
    if (unreadCount > lastUnreadCount) {
      setShowUnreadDot(true);
      setTimeout(function () { setShowUnreadDot(false); }, 30000);
    }
    setLastUnreadCount(unreadCount);
  }, [rows, lastUnreadCount]);

  const onRefresh = function () {
    setRefreshing(true);
    loadNotifications();
  };

  async function markAsRead(id) {
    try {
      const { error } = await supabase
        .from("notifications")
        .update({ read: true })
        .eq("id", id);
      if (error) throw error;
      setRows(function (prev) {
        return prev.map(function (n) { return n.id === id ? Object.assign({}, n, { read: true }) : n; });
      });
    } catch (e) {
      Alert.alert("Error", "Failed to mark as read");
    }
  }

  async function markAsUnread(id) {
    try {
      const { error } = await supabase
        .from("notifications")
        .update({ read: false })
        .eq("id", id);
      if (error) throw error;
      setRows(function (prev) {
        return prev.map(function (n) { return n.id === id ? Object.assign({}, n, { read: false }) : n; });
      });
    } catch (e) {
      Alert.alert("Error", "Failed to mark as unread");
    }
  }

  async function deleteNotification(id) {
    try {
      const { error } = await supabase.from("notifications").delete().eq("id", id);
      if (error) throw error;
      setRows(function (prev) { return prev.filter(function (n) { return n.id !== id; }); });
    } catch (e) {
      Alert.alert("Error", "Failed to delete notification");
    }
  }

  function openTarget(n) {
    // Route based on type + id (supports your two types)
    if (n && n.type === "support_message" && n.ticket_id) {
      router.replace("/support/ticket?id=" + String(n.ticket_id));
      return;
    }
    if (n && n.type === "quote_created" && n.quote_id) {
      router.replace("/quotes/preview?id=" + String(n.quote_id));
      return;
    }
    // Fallback inbox
    router.push("/notifications");
  }

  async function handleOpenNotification(n) {
    if (n && !n.read) {
      await markAsRead(n.id);
    }
    openTarget(n);
  }

  const unread = rows.filter(function (n) { return !n.read; });
  const read = rows.filter(function (n) { return n.read; });
  const unreadCount = unread.length;

  return (
    <View style={styles.screen}>
      <View style={{ height: insets.top, backgroundColor: CARD }} />

      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={function () { router.back(); }}>
          <Feather name="arrow-left" size={20} color={TEXT} />
        </TouchableOpacity>

        <View style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center" }}>
          <Text style={styles.headerTitle}>Notifications</Text>
          {unreadCount > 0 ? (
            <View style={styles.notifBubble}>
              <Text style={styles.notifBubbleText}>{unreadCount > 99 ? "99+" : String(unreadCount)}</Text>
            </View>
          ) : null}
          {showUnreadDot ? <View style={styles.hotBadge} /> : null}
        </View>

        <TouchableOpacity style={{ width: 40, alignItems: "flex-end" }} onPress={onRefresh}>
          <Feather name="refresh-ccw" size={18} color={MUTED} />
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.content} contentContainerStyle={styles.contentContainer}>
        {unread.length > 0 ? (
          <View>
            <Text style={styles.cardTitle}>Unread</Text>
            {unread.map(function (n) {
              return (
                <NotificationCard
                  key={n.id}
                  notification={n}
                  unread
                  onPress={function () { handleOpenNotification(n); }}
                  onDelete={function () { deleteNotification(n.id); }}
                />
              );
            })}
          </View>
        ) : null}

        {read.length > 0 ? (
          <View>
            <Text style={styles.cardTitle}>Read</Text>
            {read.map(function (n) {
              return (
                <NotificationCard
                  key={n.id}
                  notification={n}
                  onPress={function () { handleOpenNotification(n); }}
                  onUnread={function () { markAsUnread(n.id); }}
                  onDelete={function () { deleteNotification(n.id); }}
                />
              );
            })}
          </View>
        ) : null}

        {rows.length === 0 && !refreshing ? (
          <View style={styles.emptyState}>
            <Feather name="bell" size={48} color={MUTED} />
            <Text style={styles.emptyTitle}>No notifications</Text>
            <Text style={styles.emptySubtitle}>Notifications will appear here when they arrive.</Text>
          </View>
        ) : null}

        <View style={{ height: 20 }} />
      </ScrollView>
    </View>
  );
}

/* ---------- CARD ---------- */
function NotificationCard(props) {
  var notification = props.notification;
  var unread = props.unread;
  var icon = getNotificationIcon(notification.type);
  return (
    <TouchableOpacity
      style={[styles.notificationCard, unread ? styles.notificationCardUnread : null]}
      onPress={props.onPress}
      activeOpacity={0.85}
    >
      <View style={styles.notificationCardIconWrap}>
        <Feather name={icon.name} size={20} color={icon.color} />
      </View>

      <View style={styles.notificationCardContent}>
        <Text style={styles.notificationCardTitle} numberOfLines={1}>
          {notification.title ? notification.title : "Notification"}
        </Text>
        {notification.body ? (
          <Text style={styles.notificationCardMessage} numberOfLines={1}>
            {notification.body}
          </Text>
        ) : null}
        <Text style={styles.notificationCardTime}>
          {formatRelativeTime(notification.created_at)}
        </Text>
      </View>

      {!unread ? (
        <TouchableOpacity
          style={styles.notificationCardAction}
          onPress={function (e) {
            e.stopPropagation();
            if (props.onUnread) props.onUnread();
          }}
        >
          <Feather name="rotate-ccw" size={16} color={BRAND} />
        </TouchableOpacity>
      ) : null}

      <TouchableOpacity
        style={styles.notificationCardAction}
        onPress={function (e) {
          e.stopPropagation();
          if (props.onDelete) props.onDelete();
        }}
      >
        <Feather name="trash-2" size={16} color={DANGER} />
      </TouchableOpacity>

      <Feather name="chevron-right" size={16} color={MUTED} style={{ marginLeft: 2 }} />
    </TouchableOpacity>
  );
}

/* ---------- STYLES ---------- */
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },
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
    flex: 1,
    textAlign: "center",
    marginHorizontal: 16,
  },
  notifBubble: {
    marginLeft: 6,
    backgroundColor: DANGER,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    minWidth: 24,
    alignItems: "center",
  },
  notifBubbleText: {
    color: "#fff",
    fontWeight: "800",
    fontSize: 12,
  },
  hotBadge: {
    marginLeft: 6,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#22c55e",
  },
  content: { flex: 1 },
  contentContainer: { padding: 16 },
  cardTitle: {
    color: TEXT,
    fontWeight: "900",
    fontSize: 16,
    marginBottom: 12,
    marginTop: 8,
    marginLeft: 4,
  },
  notificationCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: CARD,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: BORDER,
    ...Platform.select({
      ios: { shadowColor: "#0b1220", shadowOpacity: 0.06, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
      android: { elevation: 2 },
    }),
  },
  notificationCardUnread: {
    backgroundColor: "#e8f3ff",
    borderColor: BRAND,
    shadowColor: BRAND,
    ...Platform.select({
      ios: { shadowOpacity: 0.1 },
      android: { elevation: 3 },
    }),
  },
  notificationCardIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#f3f6fa",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },
  notificationCardContent: { flex: 1, minWidth: 0 },
  notificationCardTitle: { color: TEXT, fontWeight: "700", fontSize: 14, marginBottom: 1 },
  notificationCardMessage: { color: MUTED, fontSize: 12, lineHeight: 16, marginBottom: 2 },
  notificationCardTime: { color: MUTED, fontSize: 10, fontWeight: "600" },
  notificationCardAction: { padding: 4, marginLeft: 2 },
  emptyState: { alignItems: "center", justifyContent: "center", paddingVertical: 60 },
  emptyTitle: { color: TEXT, fontWeight: "800", fontSize: 18, marginTop: 16, marginBottom: 8 },
  emptySubtitle: { color: MUTED, fontSize: 14, textAlign: "center", lineHeight: 20 },
});