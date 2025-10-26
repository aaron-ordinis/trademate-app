// app/(admin)/index.js
import React, { useEffect, useState, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Platform,
  RefreshControl,
  ScrollView,
  Alert,
  StyleSheet,
  StatusBar,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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

function fmtInt(n) {
  const x = Number(n || 0);
  try { return x.toLocaleString(); } catch { return String(x); }
}

export default function AdminDashboard() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [refreshing, setRefreshing] = useState(false);

  const [overview, setOverview] = useState({
    new_users_1d: 0, // add 1d
    new_users_7d: 0,
    new_users_30d: 0, // add 30d
    users_total: 0,
    play_installs_7d: 0,
    play_installs_total: 0,
    play_active_devices: 0,
    play_crash_count: 0,
    play_anr_count: 0,
    play_revenue_cents_30d: 0,
    play_currency: 'USD',
    play_last_synced_at: null,
  });

  const [notif, setNotif] = useState({ count: 0 });
  const [inbox, setInbox] = useState({ unread: 0 });

  // transient "hot" badges when new items arrive
  const [lastNoteAt, setLastNoteAt] = useState(null);
  const [lastInboxAt, setLastInboxAt] = useState(null);

  const refreshBadgesTicker = useState(0)[1]; // force re-render for time-based badge clearing

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

  // Periodically update to clear transient badges after 30s
  useEffect(function ticker() {
    const t = setInterval(function() { refreshBadgesTicker(function(x){ return x + 1; }); }, 5000);
    return function cleanup(){ clearInterval(t); };
  }, [refreshBadgesTicker]);

  function isHot(ts) {
    if (!ts) return false;
    try {
      const age = Date.now() - new Date(ts).getTime();
      return age < 30000; // 30s window
    } catch { return false; }
  }

  const load = useCallback(async function() {
    try {
      const res = await supabase.rpc('rpc_admin_overview_combined');
      if (res.error) console.log('[admin] rpc_admin_overview_combined error:', res.error);
      const row = Array.isArray(res.data) ? (res.data[0] || null) : (res.data || null);

      let o = {};
      if (row) {
        o = {
          new_users_1d: row.new_users_1d || 0, // add 1d
          new_users_7d: row.new_users_7d || 0,
          new_users_30d: row.new_users_30d || 0, // add 30d
          users_total: row.users_total || 0,
          play_installs_7d: row.play_installs_7d || 0,
          play_installs_total: row.play_installs_total || 0,
          play_active_devices: row.play_active_devices || 0,
          play_crash_count: row.play_crash_count || 0,
          play_anr_count: row.play_anr_count || 0,
          play_revenue_cents_30d: row.play_revenue_cents_30d || 0,
          play_currency: row.play_currency || 'USD',
          play_last_synced_at: row.play_last_synced_at || null,
        };
      } else {
        // fallback if rpc not available
        const now = Date.now();
        const since1d = new Date(now - 1 * 24 * 60 * 60 * 1000).toISOString();
        const since7d = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
        const since30d = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();
        let newUsers1d = 0, newUsers7d = 0, newUsers30d = 0, totalUsers = 0;
        try {
          const r1 = await supabase.from('profiles').select('id', { count: 'exact', head: true }).gte('created_at', since1d);
          if (r1.error) console.log('[admin] new users 1d count error:', r1.error);
          const r2 = await supabase.from('profiles').select('id', { count: 'exact', head: true }).gte('created_at', since7d);
          if (r2.error) console.log('[admin] new users 7d count error:', r2.error);
          const r3 = await supabase.from('profiles').select('id', { count: 'exact', head: true }).gte('created_at', since30d);
          if (r3.error) console.log('[admin] new users 30d count error:', r3.error);
          const r4 = await supabase.from('profiles').select('id', { count: 'exact', head: true });
          if (r4.error) console.log('[admin] total users count error:', r4.error);
          newUsers1d = r1.count ?? 0;
          newUsers7d = r2.count ?? 0;
          newUsers30d = r3.count ?? 0;
          totalUsers = r4.count ?? 0;
        } catch (e) {
          console.log('[admin] fallback count threw:', e);
        }
        o = { new_users_1d: newUsers1d, new_users_7d: newUsers7d, new_users_30d: newUsers30d, users_total: totalUsers };
      }

      // Notifications / Inbox counts
      let nCount = 0;
      let unread = 0;
      let cachedTickets = [];
      try {
        const n = await supabase.from('admin_notifications').select('id', { count: 'exact', head: true }).is('dismissed_at', null);
        if (n.error) console.log('[admin] notif count error:', n.error);
        nCount = n.count ?? 0;
      } catch (e) {
        console.log('[admin] notif count threw:', e);
      }
      try {
        // Get both count and basic ticket data for instant display
        const s = await supabase
          .from('support_tickets')
          .select('id, subject, status, created_at, user_id')
          .eq('status', 'open')
          .order('created_at', { ascending: false })
          .limit(10);
        
        if (s.error) console.log('[admin] inbox count error:', s.error);
        unread = s.data?.length ?? 0;
        cachedTickets = s.data || [];
      } catch (e) {
        console.log('[admin] inbox count threw:', e);
      }

      setOverview(o);
      setNotif({ count: nCount });
      setInbox({ unread: unread, cachedTickets });
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(function() {
    load();
  }, [load]);

  // Realtime subscriptions: admin_notifications + support_threads
  useEffect(function() {
    const ch = supabase
      .channel('admin_dashboard_live')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'admin_notifications' },
        function(payload) {
          setNotif(function(prev) { return { count: (prev.count || 0) + 1 }; });
          setLastNoteAt(new Date().toISOString());
          const t = payload.new && payload.new.title ? String(payload.new.title) : 'New admin notification';
          Alert.alert('Notification', t);
        }
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'support_tickets' },
        function() {
          setInbox(function(prev) { return { unread: (prev.unread || 0) + 1 }; });
          setLastInboxAt(new Date().toISOString());
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'support_tickets' },
        function(payload) {
          try {
            const st = payload.new && payload.new.status ? String(payload.new.status) : '';
            if (st === 'open') {
              setInbox(function(prev) { return { unread: (prev.unread || 0) + 1 }; });
              setLastInboxAt(new Date().toISOString());
            }
            if (st === 'pending' || st === 'closed') {
              setInbox(function(prev) {
                const v = (prev.unread || 0) - 1;
                return { unread: v > 0 ? v : 0 };
              });
            }
          } catch {}
        }
      )
      .subscribe();

    return function cleanup() {
      supabase.removeChannel(ch);
    };
  }, []);

  const onRefresh = function() {
    setRefreshing(true);
    load();
  };

  const mrr = useMemo(function() { return (overview.play_revenue_cents_30d || 0) / 100; }, [overview]);
  const lastSync = useMemo(function() {
    if (!overview.play_last_synced_at) return '—';
    try {
      const d = new Date(overview.play_last_synced_at);
      return d.toLocaleDateString() + ' ' + d.toLocaleTimeString();
    } catch { return '—'; }
  }, [overview.play_last_synced_at]);

  const notifLabel = 'Notifications (' + fmtInt(notif.count) + ')';
  const inboxLabel = 'Inbox (' + fmtInt(inbox.unread) + ')';
  const notifHot = isHot(lastNoteAt);
  const inboxHot = isHot(lastInboxAt);

  // Calculate total tickets (new + pending)
  const supportTicketCount = useMemo(() => {
    // Use cachedTickets from inbox (open tickets), or fallback to inbox.unread
    return Array.isArray(inbox.cachedTickets) ? inbox.cachedTickets.length : (inbox.unread || 0);
  }, [inbox.cachedTickets, inbox.unread]);

  return (
    <View style={styles.screen}>
      <View style={{ height: insets.top, backgroundColor: CARD }} />
      
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.push('/(app)/settings/admin')}>
          <Feather name="arrow-left" size={20} color={TEXT} />
        </TouchableOpacity>
        <View style={styles.headerContent}>
          <Text style={styles.headerTitle}>Admin Dashboard</Text>
          <Text style={styles.headerSubtitle}>Control center for Marketing & Support</Text>
        </View>
        <TouchableOpacity onPress={onRefresh} style={styles.refreshBtn}>
          <Feather name="refresh-cw" size={18} color={BRAND} />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.content}
        contentContainerStyle={styles.contentContainer}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* Quick Actions */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Quick Actions</Text>
          <View style={styles.quickActionsGrid}>
            <QuickActionButton
              icon="bell"
              title="Notifications"
              subtitle={`${notif.count} unread`}
              onPress={() => router.push('/(admin)/notifications')}
              hot={notifHot}
            />
            <QuickActionButton
              icon="inbox"
              title="Support Inbox"
              subtitle={
                supportTicketCount === 1
                  ? "1 ticket"
                  : `${supportTicketCount} tickets`
              }
              notifCount={supportTicketCount}
              onPress={() =>
                router.push({
                  pathname: '/(admin)/support',
                  params: {
                    initialCount: inbox.unread,
                    cachedData: JSON.stringify(inbox.cachedTickets || [])
                  }
                })
              }
              hot={inboxHot}
            />
          </View>
        </View>

        {/* User Metrics */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>User Analytics</Text>
          <View style={styles.metricsGrid}>
            <MetricCard
              icon="user-plus"
              title="New Users (1d)"
              value={fmtInt(overview.new_users_1d)}
              color={SUCCESS}
            />
            <MetricCard
              icon="users"
              title="New Users (7d)"
              value={fmtInt(overview.new_users_7d)}
              color={SUCCESS}
            />
            <MetricCard
              icon="user-check"
              title="Total Users"
              value={fmtInt(overview.users_total)}
              color={BRAND}
            />
          </View>
          <View style={styles.metricsGrid}>
            <MetricCard
              icon="user-plus"
              title="New Users (30d)"
              value={fmtInt(overview.new_users_30d)}
              color={SUCCESS}
            />
          </View>
        </View>

        {/* App Store Metrics */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Play Store Analytics</Text>
          <View style={styles.metricsGrid}>
            <MetricCard
              icon="download"
              title="Installs (7d)"
              value={fmtInt(overview.play_installs_7d)}
              color={SUCCESS}
            />
            <MetricCard
              icon="trending-up"
              title="Total Installs"
              value={fmtInt(overview.play_installs_total)}
              color={BRAND}
            />
            <MetricCard
              icon="smartphone"
              title="Active Devices"
              value={fmtInt(overview.play_active_devices)}
              color={BRAND}
            />
          </View>
          
          <View style={styles.metricsGrid}>
            <MetricCard
              icon="dollar-sign"
              title="Revenue (30d)"
              value={`${overview.play_currency} ${Math.round(mrr).toLocaleString()}`}
              color={SUCCESS}
            />
            <MetricCard
              icon="alert-triangle"
              title="Crashes (7d)"
              value={fmtInt(overview.play_crash_count)}
              color={overview.play_crash_count > 0 ? DANGER : MUTED}
            />
            <MetricCard
              icon="clock"
              title="Last Sync"
              value={lastSync}
              color={MUTED}
              small
            />
          </View>
        </View>

        {/* Department Access */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Departments</Text>
          <View style={styles.departmentGrid}>
            <DepartmentCard
              icon="volume-2"
              title="Marketing"
              subtitle="Social media, campaigns & analytics"
              onPress={() => router.push('/(admin)/marketing')}
            />
            <DepartmentCard
              icon="headphones"
              title="Support"
              subtitle="Customer tickets & FAQ management"
              onPress={() => router.push({
                pathname: '/(admin)/support',
                params: { 
                  initialCount: inbox.unread,
                  cachedData: JSON.stringify(inbox.cachedTickets || [])
                }
              })}
            />
          </View>
        </View>

        <View style={{ height: 80 }} />
      </ScrollView>

      {/* Floating Boss Chat */}
      <TouchableOpacity
        style={styles.floatingChat}
        onPress={() => router.push('/(admin)/boss')}
        activeOpacity={0.8}
      >
        <Feather name="message-square" size={20} color="#fff" />
        <Text style={styles.floatingChatText}>Boss</Text>
      </TouchableOpacity>
    </View>
  );
}

/* Components */
function QuickActionButton({ icon, title, subtitle, onPress, hot, notifCount }) {
  return (
    <TouchableOpacity style={styles.quickActionBtn} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.quickActionIcon}>
        <Feather name={icon} size={20} color={BRAND} />
        {hot && <View style={styles.hotBadge} />}
        {notifCount > 0 && (
          <View style={styles.notifBubble}>
            <Text style={styles.notifBubbleText}>
              {notifCount > 99 ? "99+" : notifCount}
            </Text>
          </View>
        )}
      </View>
      <View style={styles.quickActionText}>
        <Text style={styles.quickActionTitle}>{title}</Text>
        <Text style={styles.quickActionSubtitle}>{subtitle}</Text>
      </View>
      <Feather name="chevron-right" size={16} color={MUTED} />
    </TouchableOpacity>
  );
}

function MetricCard({ icon, title, value, color, small }) {
  return (
    <View style={[styles.metricCard, small && styles.metricCardSmall]}>
      <View style={styles.metricHeader}>
        <Feather name={icon} size={16} color={color} />
        <Text style={styles.metricTitle}>{title}</Text>
      </View>
      <Text style={[styles.metricValue, { color }]}>{value}</Text>
    </View>
  );
}

function DepartmentCard({ icon, title, subtitle, onPress }) {
  return (
    <TouchableOpacity style={styles.departmentCard} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.departmentIcon}>
        <Feather name={icon} size={24} color={BRAND} />
      </View>
      <View style={styles.departmentContent}>
        <Text style={styles.departmentTitle}>{title}</Text>
        <Text style={styles.departmentSubtitle}>{subtitle}</Text>
      </View>
      <Feather name="chevron-right" size={16} color={MUTED} />
    </TouchableOpacity>
  );
}

/* Styles */
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
    paddingVertical: 16,
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
  
  headerContent: {
    flex: 1,
    marginHorizontal: 16,
  },
  
  headerTitle: {
    fontSize: 24,
    fontWeight: "900",
    color: TEXT,
    marginBottom: 2,
  },
  
  headerSubtitle: {
    fontSize: 14,
    color: MUTED,
    fontWeight: "500",
  },
  
  refreshBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: BRAND + "10",
    alignItems: "center",
    justifyContent: "center",
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
  
  cardTitle: { 
    color: TEXT, 
    fontWeight: "900", 
    fontSize: 16,
    marginBottom: 12,
  },

  quickActionsGrid: {
    gap: 8,
  },

  quickActionBtn: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderRadius: 8,
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: BORDER,
    gap: 12,
  },

  quickActionIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: BRAND + "15",
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },

  hotBadge: {
    position: "absolute",
    top: 2,
    right: 2,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: DANGER,
  },
  notifBubble: {
    position: "absolute",
    top: -4,
    right: -4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: BRAND,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
    zIndex: 2,
  },
  notifBubbleText: {
    color: "#fff",
    fontWeight: "bold",
    fontSize: 11,
    textAlign: "center",
  },

  quickActionText: {
    flex: 1,
  },

  quickActionTitle: {
    color: TEXT,
    fontWeight: "700",
    fontSize: 15,
    marginBottom: 2,
  },

  quickActionSubtitle: {
    color: MUTED,
    fontSize: 13,
  },

  metricsGrid: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 8,
  },

  metricCard: {
    flex: 1,
    backgroundColor: "#f8fafc",
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: BORDER,
    minHeight: 70,
  },

  metricCardSmall: {
    minHeight: 60,
  },

  metricHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 8,
  },

  metricTitle: {
    color: MUTED,
    fontSize: 11,
    fontWeight: "600",
    flex: 1,
  },

  metricValue: {
    fontSize: 16,
    fontWeight: "900",
  },

  departmentGrid: {
    gap: 12,
  },

  departmentCard: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 16,
    paddingHorizontal: 4,
    borderRadius: 12,
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: BORDER,
    gap: 12,
  },

  departmentIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: BRAND + "15",
    alignItems: "center",
    justifyContent: "center",
  },

  departmentContent: {
    flex: 1,
  },

  departmentTitle: {
    color: TEXT,
    fontWeight: "800",
    fontSize: 16,
    marginBottom: 2,
  },

  departmentSubtitle: {
    color: MUTED,
    fontSize: 13,
    lineHeight: 18,
  },

  floatingChat: {
    position: "absolute",
    left: 16,
    bottom: 16 + (Platform.OS === 'android' ? 8 : 0),
    backgroundColor: "#111827",
    borderRadius: 26,
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOpacity: 0.2,
        shadowRadius: 6,
        shadowOffset: { width: 0, height: 4 },
      },
      android: { elevation: 4 },
    }),
  },

  floatingChatText: {
    color: "#fff",
    fontWeight: "800",
    fontSize: 14,
  },
});