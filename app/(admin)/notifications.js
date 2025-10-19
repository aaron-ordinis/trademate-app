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
  const [selectedNotification, setSelectedNotification] = useState(null);

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
      console.warn('Failed to load notifications:', e);
      Alert.alert('Error', 'Failed to load notifications');
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadNotifications();
  }, [loadNotifications]);

  const onRefresh = () => {
    setRefreshing(true);
    loadNotifications();
  };

  const dismissNotification = async (id) => {
    try {
      const { error } = await supabase
        .from('admin_notifications')
        .update({ dismissed_at: new Date().toISOString() })
        .eq('id', id);

      if (error) throw error;
      
      setNotifications(prev => 
        prev.map(n => n.id === id ? { ...n, dismissed_at: new Date().toISOString() } : n)
      );
    } catch (e) {
      console.warn('Failed to dismiss notification:', e);
      Alert.alert('Error', 'Failed to dismiss notification');
    }
  };

  const dismissAll = async () => {
    try {
      const { error } = await supabase
        .from('admin_notifications')
        .update({ dismissed_at: new Date().toISOString() })
        .is('dismissed_at', null);

      if (error) throw error;
      
      const now = new Date().toISOString();
      setNotifications(prev => 
        prev.map(n => n.dismissed_at ? n : { ...n, dismissed_at: now })
      );
      
      Alert.alert('Success', 'All notifications dismissed');
    } catch (e) {
      console.warn('Failed to dismiss all notifications:', e);
      Alert.alert('Error', 'Failed to dismiss all notifications');
    }
  };

  const activeNotifications = notifications.filter(n => !n.dismissed_at);
  const dismissedNotifications = notifications.filter(n => n.dismissed_at);

  return (
    <View style={styles.screen}>
      <View style={{ height: insets.top, backgroundColor: CARD }} />
      
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Feather name="arrow-left" size={20} color={TEXT} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Notifications</Text>
        {activeNotifications.length > 0 && (
          <TouchableOpacity onPress={dismissAll} style={styles.actionBtn}>
            <Text style={styles.actionBtnText}>Dismiss All</Text>
          </TouchableOpacity>
        )}
        {activeNotifications.length === 0 && (
          <View style={{ width: 40 }} />
        )}
      </View>

      <ScrollView 
        style={styles.content} 
        contentContainerStyle={styles.contentContainer}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* Active Notifications */}
        {activeNotifications.length > 0 && (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>Unread ({activeNotifications.length})</Text>
              <InfoButton
                title="Notifications"
                tips={[
                  "System notifications alert you to important events and issues.",
                  "Tap a notification to view details and take action.",
                  "Use 'Dismiss' to mark notifications as read.",
                  "Critical notifications require immediate attention.",
                ]}
              />
            </View>

            {activeNotifications.map((notification) => (
              <NotificationItem
                key={notification.id}
                notification={notification}
                onPress={() => setSelectedNotification(notification)}
                onDismiss={() => dismissNotification(notification.id)}
              />
            ))}
          </View>
        )}

        {/* Dismissed Notifications */}
        {dismissedNotifications.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Dismissed ({dismissedNotifications.length})</Text>
            
            {dismissedNotifications.slice(0, 10).map((notification) => (
              <NotificationItem
                key={notification.id}
                notification={notification}
                onPress={() => setSelectedNotification(notification)}
                dismissed
              />
            ))}
            
            {dismissedNotifications.length > 10 && (
              <Text style={styles.moreText}>
                And {dismissedNotifications.length - 10} more dismissed notifications...
              </Text>
            )}
          </View>
        )}

        {/* Empty State */}
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

      {/* Notification Detail Modal */}
      {selectedNotification && (
        <Modal visible={true} animationType="slide" transparent>
          <View style={styles.modalBackdrop} />
          <View style={styles.detailModalWrap}>
            <View style={styles.detailModal}>
              <View style={styles.detailHeader}>
                <Text style={styles.detailTitle}>Notification Details</Text>
                <TouchableOpacity 
                  onPress={() => setSelectedNotification(null)}
                  style={styles.closeBtn}
                >
                  <Feather name="x" size={20} color={TEXT} />
                </TouchableOpacity>
              </View>

              <ScrollView style={styles.detailContent}>
                <View style={styles.detailSection}>
                  <Text style={styles.detailLabel}>Title</Text>
                  <Text style={styles.detailText}>{selectedNotification.title || 'No title'}</Text>
                </View>

                {selectedNotification.message && (
                  <View style={styles.detailSection}>
                    <Text style={styles.detailLabel}>Message</Text>
                    <Text style={styles.detailText}>{selectedNotification.message}</Text>
                  </View>
                )}

                <View style={styles.detailSection}>
                  <Text style={styles.detailLabel}>Type</Text>
                  <Text style={styles.detailText}>{selectedNotification.type || 'info'}</Text>
                </View>

                <View style={styles.detailSection}>
                  <Text style={styles.detailLabel}>Created</Text>
                  <Text style={styles.detailText}>
                    {new Date(selectedNotification.created_at).toLocaleString()}
                  </Text>
                </View>

                {selectedNotification.dismissed_at && (
                  <View style={styles.detailSection}>
                    <Text style={styles.detailLabel}>Dismissed</Text>
                    <Text style={styles.detailText}>
                      {new Date(selectedNotification.dismissed_at).toLocaleString()}
                    </Text>
                  </View>
                )}

                {selectedNotification.metadata && (
                  <View style={styles.detailSection}>
                    <Text style={styles.detailLabel}>Additional Data</Text>
                    <Text style={styles.detailCode}>
                      {JSON.stringify(selectedNotification.metadata, null, 2)}
                    </Text>
                  </View>
                )}
              </ScrollView>

              <View style={styles.detailActions}>
                {!selectedNotification.dismissed_at && (
                  <TouchableOpacity
                    style={styles.dismissBtn}
                    onPress={() => {
                      dismissNotification(selectedNotification.id);
                      setSelectedNotification(null);
                    }}
                  >
                    <Text style={styles.dismissBtnText}>Dismiss</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  style={styles.cancelBtn}
                  onPress={() => setSelectedNotification(null)}
                >
                  <Text style={styles.cancelBtnText}>Close</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}
    </View>
  );
}

function NotificationItem({ notification, onPress, onDismiss, dismissed = false }) {
  const icon = getNotificationIcon(notification.type);
  
  return (
    <TouchableOpacity
      style={[styles.notificationItem, dismissed && styles.dismissedItem]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={styles.notificationIcon}>
        <Feather name={icon.name} size={18} color={icon.color} />
      </View>
      
      <View style={styles.notificationContent}>
        <Text style={[styles.notificationTitle, dismissed && styles.dismissedText]} numberOfLines={2}>
          {notification.title || 'Notification'}
        </Text>
        {notification.message && (
          <Text style={[styles.notificationMessage, dismissed && styles.dismissedText]} numberOfLines={2}>
            {notification.message}
          </Text>
        )}
        <Text style={styles.notificationTime}>
          {formatRelativeTime(notification.created_at)}
        </Text>
      </View>

      {!dismissed && onDismiss && (
        <TouchableOpacity
          style={styles.dismissIconBtn}
          onPress={(e) => {
            e.stopPropagation();
            onDismiss();
          }}
        >
          <Feather name="x" size={16} color={MUTED} />
        </TouchableOpacity>
      )}

      <Feather name="chevron-right" size={16} color={MUTED} />
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

  actionBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: BRAND + "10",
  },

  actionBtnText: {
    color: BRAND,
    fontWeight: "700",
    fontSize: 12,
  },
  
  content: {
    flex: 1,
  },
  
  contentContainer: {
    padding: 16,
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
    fontSize: 16,
    marginBottom: 12,
  },

  notificationItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#f8fafc",
    gap: 12,
  },

  dismissedItem: {
    opacity: 0.6,
  },

  notificationIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#f8fafc",
    alignItems: "center",
    justifyContent: "center",
  },

  notificationContent: {
    flex: 1,
  },

  notificationTitle: {
    color: TEXT,
    fontWeight: "700",
    fontSize: 14,
    marginBottom: 2,
  },

  notificationMessage: {
    color: MUTED,
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 4,
  },

  notificationTime: {
    color: MUTED,
    fontSize: 11,
    fontWeight: "600",
  },

  dismissedText: {
    color: MUTED,
  },

  dismissIconBtn: {
    padding: 4,
    marginRight: 4,
  },

  moreText: {
    color: MUTED,
    fontSize: 12,
    fontStyle: "italic",
    textAlign: "center",
    marginTop: 8,
  },

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
});
