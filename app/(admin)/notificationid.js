import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Platform,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Feather } from "@expo/vector-icons";
import { supabase } from '../../lib/supabase';

const CARD = "#ffffff";
const TEXT = "#0b1220";
const MUTED = "#6b7280";
const BORDER = "#e6e9ee";
const BRAND = "#2a86ff";
const SUCCESS = "#10b981";
const DANGER = "#dc2626";

export default function NotificationIdScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams();
  const [notification, setNotification] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchNotification = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('admin_notifications')
        .select('*')
        .eq('id', id)
        .single();
      if (error) throw error;
      setNotification(data);
    } catch (e) {
      Alert.alert('Error', 'Failed to load notification');
      setNotification(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  // Mark as read if not already read
  const markAsRead = useCallback(async () => {
    try {
      if (!notification?.dismissed_at) {
        const now = new Date().toISOString();
        const { error } = await supabase
          .from('admin_notifications')
          .update({ dismissed_at: now })
          .eq('id', id);
        if (!error) {
          setNotification((prev) => prev ? { ...prev, dismissed_at: now } : prev);
        }
      }
    } catch {}
  }, [id, notification]);

  useEffect(() => {
    fetchNotification();
  }, [fetchNotification]);

  useEffect(() => {
    if (notification && !notification.dismissed_at) {
      markAsRead();
    }
  }, [notification, markAsRead]);

  // When marking as unread, update, then go back to notifications (where it will be highlighted as unread)
  const markAsUnread = async () => {
    try {
      const { error } = await supabase
        .from('admin_notifications')
        .update({ dismissed_at: null })
        .eq('id', id);
      if (error) throw error;
      // Fire a custom event to force notifications index to reload immediately
      window.dispatchEvent?.(new Event('reloadNotifications'));
      router.back();
    } catch (e) {
      Alert.alert('Error', 'Failed to mark as unread');
    }
  };

  const deleteNotification = async () => {
    try {
      const { error } = await supabase
        .from('admin_notifications')
        .delete()
        .eq('id', id);
      if (error) throw error;
      router.back();
    } catch (e) {
      Alert.alert('Error', 'Failed to delete notification');
    }
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={BRAND} />
      </View>
    );
  }

  if (!notification) {
    return (
      <View style={styles.centered}>
        <Text style={{ color: DANGER, fontWeight: "700" }}>Notification not found</Text>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Text style={{ color: BRAND, fontWeight: "700" }}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Feather name="arrow-left" size={20} color={TEXT} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Notification</Text>
        <View style={{ width: 40 }} />
      </View>
      <ScrollView style={styles.content} contentContainerStyle={styles.contentContainer}>
        <Text style={styles.label}>ID</Text>
        <Text style={styles.value}>{notification.id}</Text>
        <Text style={styles.label}>Title</Text>
        <Text style={styles.value}>{notification.title || 'No title'}</Text>
        {notification.message && (
          <>
            <Text style={styles.label}>Message</Text>
            <Text style={styles.value}>{notification.message}</Text>
          </>
        )}
        <Text style={styles.label}>Type</Text>
        <Text style={styles.value}>{notification.type || 'info'}</Text>
        <Text style={styles.label}>Created</Text>
        <Text style={styles.value}>
          {new Date(notification.created_at).toLocaleString()}
        </Text>
        {notification.dismissed_at && (
          <>
            <Text style={styles.label}>Read</Text>
            <Text style={styles.value}>
              {new Date(notification.dismissed_at).toLocaleString()}
            </Text>
          </>
        )}
        {notification.metadata && (
          <>
            <Text style={styles.label}>Additional Data</Text>
            <Text style={styles.code}>
              {JSON.stringify(notification.metadata, null, 2)}
            </Text>
          </>
        )}
      </ScrollView>
      <View style={styles.actions}>
        {notification.dismissed_at && (
          <TouchableOpacity style={styles.actionBtn} onPress={markAsUnread}>
            <Text style={styles.actionBtnText}>Mark as Unread</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={styles.deleteBtn} onPress={deleteNotification}>
          <Text style={styles.deleteBtnText}>Delete</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: CARD,
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
    padding: 18,
  },
  label: {
    color: MUTED,
    fontWeight: "700",
    fontSize: 12,
    marginBottom: 2,
    marginTop: 12,
    textTransform: "uppercase",
  },
  value: {
    color: TEXT,
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 2,
  },
  code: {
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
  actions: {
    flexDirection: "row",
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: BORDER,
    gap: 12,
    backgroundColor: "#f8fafc",
  },
  actionBtn: {
    flex: 1,
    backgroundColor: BRAND,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: "center",
    marginRight: 8,
  },
  actionBtnText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 14,
  },
  deleteBtn: {
    flex: 1,
    backgroundColor: DANGER,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: "center",
  },
  deleteBtnText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 14,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: CARD,
  },
});
