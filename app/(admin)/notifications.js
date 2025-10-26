import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  StatusBar,
  Platform,
  TouchableOpacity,
  ScrollView,
  RefreshControl,
  Alert,
  Modal,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as NavigationBar from "expo-navigation-bar";
import * as SystemUI from "expo-system-ui";
import { Feather } from "@expo/vector-icons";
import { supabase } from '../../lib/supabase';

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

/* ---------- INFO BUTTON COMPONENT ---------- */
// function InfoButton({ title, tips = [] }) {
//   const [open, setOpen] = useState(false);
//   return (
//     <>
//       <TouchableOpacity onPress={() => setOpen(true)} style={styles.infoBtn}>
//         <Text style={{ color: MUTED, fontWeight: "900" }}>i</Text>
//       </TouchableOpacity>
//       <Modal visible={open} animationType="fade" transparent onRequestClose={() => setOpen(false)}>
//         <View style={styles.modalBackdrop} />
//         <View style={styles.modalWrap}>
//           <View style={styles.modalCard}>
//             <View style={styles.modalHead}>
//               <Text style={{ color: TEXT, fontWeight: "900", fontSize: 16 }}>{title}</Text>
//               <TouchableOpacity onPress={() => setOpen(false)} style={styles.smallBtn}>
//                 <Text style={styles.smallBtnText}>Close</Text>
//               </TouchableOpacity>
//             </View>
//             {tips.slice(0, 6).map((t, i) => (
//               <View key={i} style={{ flexDirection: "row", gap: 8, marginBottom: 8 }}>
//                 <Text style={{ color: BRAND, fontWeight: "900" }}>•</Text>
//                 <Text style={{ color: TEXT, flex: 1 }}>{t}</Text>
//               </View>
//             ))}
//           </View>
//         </View>
//       </Modal>
//     </>
//   );
// }

function getNotificationIcon(type) {
  switch (type?.toLowerCase()) {
    case 'error':
    case 'critical':
      return { name: 'alert-circle', color: DANGER };
    case 'warning':
      return { name: 'alert-triangle', color: WARNING };
    case 'success':
      return { name: 'check-circle', color: SUCCESS };
    case 'info':
    default:
      return { name: 'info', color: BRAND };
  }
}

function formatRelativeTime(dateString) {
  if (!dateString) return '';
  
  try {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    
    return date.toLocaleDateString();
  } catch {
    return '';
  }
}

export default function AdminNotifications() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [notifications, setNotifications] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUnreadCount, setLastUnreadCount] = useState(0);
  const [showUnreadDot, setShowUnreadDot] = useState(false);

  // Remove shouldReload logic, always reload on focus
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

  const loadNotifications = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('admin_notifications')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      setNotifications(data || []);
    } catch (e) {
      Alert.alert('Error', 'Failed to load notifications');
    } finally {
      setRefreshing(false);
    }
  }, []);

  // Always reload notifications when screen is focused or when coming back from detail
  useEffect(() => {
    const unsubscribe = router.addListener?.('focus', () => {
      loadNotifications();
    });
    // Also load on mount
    loadNotifications();
    return unsubscribe;
  }, [router, loadNotifications]);

  // Add a helper to force reload notifications from other screens
  useEffect(() => {
    const reloadHandler = () => loadNotifications();
    window.addEventListener?.('reloadNotifications', reloadHandler);
    return () => window.removeEventListener?.('reloadNotifications', reloadHandler);
  }, [loadNotifications]);

  // Track unread count and show a bubble dot when new unread notifications arrive
  useEffect(() => {
    const unreadCount = notifications.filter(n => !n.dismissed_at).length;
    if (unreadCount > lastUnreadCount) {
      setShowUnreadDot(true);
      setTimeout(() => setShowUnreadDot(false), 30000); // hide after 30s
    }
    setLastUnreadCount(unreadCount);
  }, [notifications, lastUnreadCount]);

  const onRefresh = () => {
    setRefreshing(true);
    loadNotifications();
  };

  // Mark as read (set dismissed_at)
  const markAsRead = async (id) => {
    try {
      const now = new Date().toISOString();
      const { error } = await supabase
        .from('admin_notifications')
        .update({ dismissed_at: now })
        .eq('id', id);
      if (error) throw error;
      setNotifications(prev =>
        prev.map(n => n.id === id ? { ...n, dismissed_at: now } : n)
      );
    } catch (e) {
      Alert.alert('Error', 'Failed to mark as read');
    }
  };

  // Mark as unread (set dismissed_at to null)
  const markAsUnread = async (id) => {
    try {
      const { error } = await supabase
        .from('admin_notifications')
        .update({ dismissed_at: null })
        .eq('id', id);
      if (error) throw error;
      setNotifications(prev =>
        prev.map(n => n.id === id ? { ...n, dismissed_at: null } : n)
      );
    } catch (e) {
      Alert.alert('Error', 'Failed to mark as unread');
    }
  };

  // Delete notification
  const deleteNotification = async (id) => {
    try {
      const { error } = await supabase
        .from('admin_notifications')
        .delete()
        .eq('id', id);
      if (error) throw error;
      setNotifications(prev => prev.filter(n => n.id !== id));
    } catch (e) {
      Alert.alert('Error', 'Failed to delete notification');
    }
  };

  const activeNotifications = notifications.filter(n => !n.dismissed_at);
  const readNotifications = notifications.filter(n => n.dismissed_at);

  // When opening a notification, mark it as read and move it to "Read"
  const handleOpenNotification = async (n) => {
    if (!n.dismissed_at) {
      await markAsRead(n.id);
    }
    router.push({ pathname: '/(admin)/notificationid', params: { id: n.id } });
  };

  // Add unreadCount for badge
  const unreadCount = notifications.filter(n => !n.dismissed_at).length;

  return (
    <View style={styles.screen}>
      <View style={{ height: insets.top, backgroundColor: CARD }} />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Feather name="arrow-left" size={20} color={TEXT} />
        </TouchableOpacity>
        <View style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center" }}>
          <Text style={styles.headerTitle}>Notifications</Text>
          {unreadCount > 0 && (
            <View style={styles.notifBubble}>
              <Text style={styles.notifBubbleText}>
                {unreadCount > 99 ? "99+" : unreadCount}
              </Text>
            </View>
          )}
          {showUnreadDot && (
            <View style={styles.hotBadge} />
          )}
        </View>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        style={styles.content}
        contentContainerStyle={styles.contentContainer}
      >
        {/* Unread */}
        {activeNotifications.length > 0 && (
          <View>
            <Text style={styles.cardTitle}>Unread</Text>
            {activeNotifications.map((n) => (
              <NotificationCard
                key={n.id}
                notification={n}
                onPress={() => handleOpenNotification(n)}
                unread
                onDelete={() => deleteNotification(n.id)}
              />
            ))}
          </View>
        )}

        {/* Read */}
        {readNotifications.length > 0 && (
          <View>
            <Text style={styles.cardTitle}>Read</Text>
            {readNotifications.map((n) => (
              <NotificationCard
                key={n.id}
                notification={n}
                onPress={() => handleOpenNotification(n)}
                onUnread={() => markAsUnread(n.id)}
                onDelete={() => deleteNotification(n.id)}
              />
            ))}
          </View>
        )}

        {/* Empty */}
        {notifications.length === 0 && !refreshing && (
          <View style={styles.emptyState}>
            <Feather name="bell" size={48} color={MUTED} />
            <Text style={styles.emptyTitle}>No notifications</Text>
            <Text style={styles.emptySubtitle}>
              System notifications will appear here when they arrive.
            </Text>
          </View>
        )}

        <View style={{ height: 20 }} />
      </ScrollView>
    </View>
  );
}

// Professional notification card component
function NotificationCard({ notification, onPress, onUnread, onDelete, unread }) {
  const icon = getNotificationIcon(notification.type);
  return (
    <TouchableOpacity
      style={[
        styles.notificationCard,
        unread && styles.notificationCardUnread,
      ]}
      onPress={onPress}
      activeOpacity={0.85}
    >
      <View style={styles.notificationCardIconWrap}>
        <Feather name={icon.name} size={20} color={icon.color} />
      </View>
      <View style={styles.notificationCardContent}>
        <Text style={styles.notificationCardTitle} numberOfLines={1}>
          {notification.title || 'Notification'}
        </Text>
        {notification.message && (
          <Text style={styles.notificationCardMessage} numberOfLines={1}>
            {notification.message}
          </Text>
        )}
        <Text style={styles.notificationCardTime}>
          {formatRelativeTime(notification.created_at)}
        </Text>
      </View>
      {!unread && (
        <TouchableOpacity
          style={styles.notificationCardAction}
          onPress={(e) => {
            e.stopPropagation();
            onUnread();
          }}
        >
          <Feather name="rotate-ccw" size={16} color={BRAND} />
        </TouchableOpacity>
      )}
      <TouchableOpacity
        style={styles.notificationCardAction}
        onPress={(e) => {
          e.stopPropagation();
          onDelete();
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
    flex: 1,
    textAlign: "center",
    marginHorizontal: 16,
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    padding: 16,
  },
  cardTitle: { 
    color: TEXT,
    fontWeight: "900",
    fontSize: 16,
    marginBottom: 12,
    marginTop: 8,
    marginLeft: 4,
  },
  // --- Notification Card Styles ---
  notificationCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: CARD,
    borderRadius: 12, // slimmer
    paddingVertical: 10, // slimmer
    paddingHorizontal: 12, // slimmer
    marginBottom: 10, // slimmer
    borderWidth: 1,
    borderColor: BORDER,
    ...Platform.select({
      ios: { 
        shadowColor: "#0b1220", 
        shadowOpacity: 0.06, 
        shadowRadius: 6, 
        shadowOffset: { width: 0, height: 2 } 
      },
      android: { elevation: 2 },
    }),
  },
  notificationCardUnread: {
    backgroundColor: "#e8f3ff",
    borderColor: BRAND,
    shadowColor: BRAND,
    ...Platform.select({
      ios: { shadowOpacity: 0.10 },
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
  notificationCardContent: {
    flex: 1,
    minWidth: 0,
  },
  notificationCardTitle: {
    color: TEXT,
    fontWeight: "700",
    fontSize: 14,
    marginBottom: 1,
  },
  notificationCardMessage: {
    color: MUTED,
    fontSize: 12,
    lineHeight: 16,
    marginBottom: 2,
  },
  notificationCardTime: {
    color: MUTED,
    fontSize: 10,
    fontWeight: "600",
  },
  notificationCardAction: {
    padding: 4,
    marginLeft: 2,
  },
  // --- End Notification Card Styles ---
  emptyState: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 60,
  },
  emptyTitle: {
    color: TEXT,
    fontWeight: "800",
    fontSize: 18,
    marginTop: 16,
    marginBottom: 8,
  },
  emptySubtitle: {
    color: MUTED,
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
  },
  /* Modal Styles */
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

  /* Detail Modal */
  detailModalWrap: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 16,
  },

  detailModal: {
    backgroundColor: CARD,
    borderRadius: 16,
    width: "100%",
    maxWidth: 500,
    maxHeight: "80%",
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

  detailHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },

  detailTitle: {
    color: TEXT,
    fontWeight: "900",
    fontSize: 18,
  },

  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f8fafc",
  },

  detailContent: {
    flex: 1,
    padding: 16,
  },

  detailSection: {
    marginBottom: 16,
  },

  detailLabel: {
    color: MUTED,
    fontWeight: "700",
    fontSize: 12,
    marginBottom: 4,
    textTransform: "uppercase",
  },

  detailText: {
    color: TEXT,
    fontSize: 14,
    lineHeight: 20,
  },

  detailCode: {
    color: TEXT,
    fontSize: 12,
    fontFamily: Platform.OS === "ios" ? "Courier" : "monospace",
    backgroundColor: "#f8fafc",
    padding: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: BORDER,
  },

  detailActions: {
    flexDirection: "row",
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: BORDER,
    gap: 12,
  },

  dismissBtn: {
    flex: 1,
    backgroundColor: DANGER,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: "center",
  },

  dismissBtnText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 14,
  },

  cancelBtn: {
    flex: 1,
    backgroundColor: "#f8fafc",
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: "center",
    borderWidth: 1,
    borderColor: BORDER,
  },

  cancelBtnText: {
    color: TEXT,
    fontWeight: "700",
    fontSize: 14,
  },

  idScreenOverlay: {
    position: "absolute",
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: "rgba(0,0,0,0.35)",
    zIndex: 100,
    justifyContent: "center",
    alignItems: "center",
  },
  idScreenCard: {
    backgroundColor: CARD,
    borderRadius: 16,
    width: "92%",
    maxWidth: 480,
    maxHeight: "85%",
    padding: 0,
    overflow: "hidden",
    ...Platform.select({
      ios: { shadowColor: "#000", shadowOpacity: 0.18, shadowRadius: 16, shadowOffset: { width: 0, height: 8 } },
      android: { elevation: 12 },
    }),
  },
  idScreenHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 18,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
    backgroundColor: "#f8fafc",
  },
  idScreenTitle: {
    color: TEXT,
    fontWeight: "900",
    fontSize: 18,
  },
  idScreenCloseBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f3f4f6",
  },
  idScreenContent: {
    padding: 18,
    maxHeight: 340,
  },
  idScreenLabel: {
    color: MUTED,
    fontWeight: "700",
    fontSize: 12,
    marginBottom: 2,
    marginTop: 12,
    textTransform: "uppercase",
  },
  idScreenValue: {
    color: TEXT,
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 2,
  },
  idScreenCode: {
    color: TEXT,
    fontSize: 12,
    fontFamily: Platform.OS === "ios" ? "Courier" : "monospace",
    backgroundColor: "#f8fafc",
    padding: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: BORDER,
    marginTop: 4,
  },
  idScreenActions: {
    flexDirection: "row",
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: BORDER,
    gap: 12,
    backgroundColor: "#f8fafc",
  },
});
