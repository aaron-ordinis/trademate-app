// app/(admin)/support/index.js
import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Platform,
  TouchableOpacity,
  ScrollView,
  RefreshControl,
  Alert,
  Modal,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Feather } from "@expo/vector-icons";
import { supabase } from '../../../lib/supabase'; // <— moved up one level

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

/* ---------- Status helpers (admin badges) ---------- */
function mapStatusForAdmin(dbStatus) {
  const v = String(dbStatus || '').toLowerCase();
  if (v === 'open') return 'new';
  if (v === 'pending') return 'pending';
  if (v === 'closed') return 'closed';
  return 'new';
}
function getAdminStatusFromDB(dbStatus) { return mapStatusForAdmin(dbStatus); }
function getDBStatusFromAdmin(adminStatus) {
  const v = String(adminStatus || '').toLowerCase();
  if (v === 'new') return 'open';
  if (v === 'pending') return 'pending';
  if (v === 'closed') return 'closed';
  return 'open';
}
function getStatusColor(status) {
  switch (String(status || '').toLowerCase()) {
    case 'new': return DANGER;
    case 'pending': return WARNING;
    case 'closed': return SUCCESS;
    default: return MUTED;
  }
}
function getStatusIcon(status) {
  switch (String(status || '').toLowerCase()) {
    case 'new': return 'mail';
    case 'pending': return 'message-circle';
    case 'closed': return 'check-circle';
    default: return 'help-circle';
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
  } catch { return ''; }
}

export default function AdminSupportInbox() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const insets = useSafeAreaInsets();
  const [tickets, setTickets] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  const initialUnreadCount = params.initialCount ? parseInt(params.initialCount) : 0;
  const cachedData = params.cachedData ? JSON.parse(params.cachedData) : [];

  useEffect(() => {
    if (cachedData && cachedData.length > 0) {
      const quickTickets = cachedData.map(t => ({
        id: t.id,
        subject: t.subject || 'No subject',
        status: mapStatusForAdmin(t.status),
        raw_status: t.status,
        created_at: t.created_at,
        last_message_at: t.created_at,
        message: '',
        user_email: '',
        user_name: '',
        isLoading: false
      }));
      setTickets(quickTickets);
    }
  }, []);

  const loadTickets = useCallback(async () => {
    try {
      if (tickets.length === 0) {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) { router.replace('/(auth)/login'); return; }
        const { data: profile } = await supabase
          .from('profiles').select('admin_owner').eq('id', user.id).maybeSingle();
        if (!profile?.admin_owner) { Alert.alert('Access Denied', 'Admin access required'); router.back(); return; }
      }

      const { data: baseTickets, error: tErr } = await supabase
        .from('support_tickets')
        .select('id, user_id, subject, status, priority, last_message_at, created_at')
        .order('last_message_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(50);
      if (tErr) throw tErr;

      const list = baseTickets || [];
      if (list.length === 0) { setTickets([]); return; }

      const ticketIds = list.map(t => t.id);
      const userIds = Array.from(new Set(list.map(t => t.user_id).filter(Boolean)));
      const [msgsResult, profsResult] = await Promise.all([
        supabase.from('support_messages')
          .select('ticket_id, body, created_at')
          .in('ticket_id', ticketIds)
          .order('created_at', { ascending: false }),
        userIds.length > 0
          ? supabase.from('profiles')
              .select('id, full_name, company_name, billing_email, business_name, email')
              .in('id', userIds)
          : { data: [] }
      ]);

      const latestByTicket = {};
      (msgsResult.data || []).forEach(m => { if (!latestByTicket[m.ticket_id]) latestByTicket[m.ticket_id] = m; });

      const profilesById = {};
      (profsResult.data || []).forEach(p => { profilesById[p.id] = p; });

      const enriched = list.map(t => {
        const latest = latestByTicket[t.id];
        const prof = profilesById[t.user_id] || {};
        const adminStatus = getAdminStatusFromDB(t.status);
        return {
          id: t.id,
          subject: t.subject,
          status: adminStatus,
          raw_status: t.status,
          created_at: t.created_at,
          last_message_at: t.last_message_at || latest?.created_at || t.created_at,
          message: latest?.body || '',
          user_email: prof.email || prof.billing_email || '',
          user_business: prof.business_name || prof.company_name || '',
          isLoading: false
        };
      });

      setTickets(enriched);
    } catch (e) {
      console.warn('Failed to load support tickets:', e);
      if (tickets.length === 0) Alert.alert('Error', e?.message || 'Failed to load support tickets');
    } finally {
      setRefreshing(false);
    }
  }, [router, tickets.length]);

  useEffect(() => { loadTickets(); }, [loadTickets]);

  useEffect(() => {
    const ch1 = supabase
      .channel('admin_support_tickets')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'support_tickets' }, () => loadTickets())
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'support_tickets' }, () => loadTickets())
      .subscribe();

    const ch2 = supabase
      .channel('admin_support_messages')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'support_messages' }, () => loadTickets())
      .subscribe();

    return () => {
      try { supabase.removeChannel(ch1); } catch {}
      try { supabase.removeChannel(ch2); } catch {}
    };
  }, [loadTickets]);

  const onRefresh = () => { setRefreshing(true); loadTickets(); };

  const deleteTicket = async (ticketId) => {
    try {
      setDeletingId(ticketId);
      const prevTickets = tickets;
      setTickets(prev => prev.filter(t => t.id !== ticketId));
      // Remove edge function, use direct delete
      const { error } = await supabase
        .from('support_tickets')
        .delete()
        .eq('id', ticketId);
      if (error) { setTickets(prevTickets); throw error; }
    } catch (e) {
      console.warn('Failed to delete ticket:', e);
      Alert.alert('Delete Failed', e?.message || 'Could not delete ticket. Please try again.');
    } finally {
      setDeletingId(null);
    }
  };

  const confirmDelete = (ticket) => {
    Alert.alert(
      'Delete Ticket',
      `Are you sure you want to delete "${ticket.subject || 'this ticket'}"? This will permanently delete the ticket and all its messages. This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => deleteTicket(ticket.id) },
      ]
    );
  };

  const markAsRead = async (ticketId) => {
    try {
      const { error } = await supabase
        .from('support_tickets')
        .update({ status: 'pending', last_message_at: new Date().toISOString() })
        .eq('id', ticketId)
        .eq('status', 'open');
      if (error) throw error;

      setTickets(prev =>
        prev.map(t => t.id === ticketId
          ? { ...t, status: 'pending', raw_status: 'pending', last_message_at: new Date().toISOString() }
          : t
        )
      );
    } catch (e) { console.warn('Failed to mark as read:', e); }
  };

  const newTickets = tickets.filter(t => t.status === 'new');
  const pendingTickets = tickets.filter(t => t.status === 'pending');
  const closedTickets = tickets.filter(t => t.status === 'closed');
  const displayNewCount = newTickets.length || initialUnreadCount;

  return (
    <View style={styles.screen}>
      <View style={{ height: useSafeAreaInsets().top, backgroundColor: CARD }} />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Feather name="arrow-left" size={20} color={TEXT} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Support Inbox</Text>
        <TouchableOpacity onPress={onRefresh} style={styles.refreshBtn}>
          <Feather name="refresh-cw" size={18} color={BRAND} />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.content}
        contentContainerStyle={styles.contentContainer}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* New */}
        {displayNewCount > 0 && newTickets.length > 0 && (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>New Tickets ({displayNewCount})</Text>
              <InfoButton
                title="New Tickets"
                tips={[
                  "Newly created tickets appear here.",
                  "These require immediate attention.",
                  "Tap to view and reply.",
                  "Moves to 'Pending' after first admin view/reply.",
                ]}
              />
            </View>

            {newTickets.length > 0
              ? newTickets.map((t) => (
                  <TicketItem
                    key={t.id}
                    ticket={t}
                    onPress={() => {
                      if (t.status === 'new') markAsRead(t.id);
                      router.push(`/(admin)/support/${t.id}`); // <— fixed
                    }}
                    onDelete={() => confirmDelete(t)}
                    isDeleting={deletingId === t.id}
                  />
                ))
              : Array.from({ length: Math.min(displayNewCount, 3) }).map((_, i) => (
                  <SkeletonTicketItem key={`skeleton-new-${i}`} />
                ))}
          </View>
        )}

        {/* Pending */}
        {pendingTickets.length > 0 && (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>Pending Tickets ({pendingTickets.length})</Text>
              <InfoButton
                title="Pending Tickets"
                tips={[
                  "Ongoing conversations.",
                  "Awaiting customer response or admin action.",
                  "Close when resolved.",
                ]}
              />
            </View>

            {pendingTickets.slice(0, 20).map((t) => (
              <TicketItem
                key={t.id}
                ticket={t}
                onPress={() => router.push(`/(admin)/support/${t.id}`)} // <— fixed
                onDelete={() => confirmDelete(t)}
                isDeleting={deletingId === t.id}
              />
            ))}

            {pendingTickets.length > 20 && (
              <Text style={styles.moreText}>
                And {pendingTickets.length - 20} more pending tickets...
              </Text>
            )}
          </View>
        )}

        {/* Closed */}
        {closedTickets.length > 0 && (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>Closed Tickets ({closedTickets.length})</Text>
              <InfoButton
                title="Closed Tickets"
                tips={[
                  "Resolved tickets that have been closed.",
                  "Can be deleted if no longer needed.",
                  "Tap to view conversation history.",
                ]}
              />
            </View>

            {closedTickets.slice(0, 15).map((t) => (
              <TicketItem
                key={t.id}
                ticket={t}
                onPress={() => router.push(`/(admin)/support/${t.id}`)} // <— fixed
                onDelete={() => confirmDelete(t)}
                isDeleting={deletingId === t.id}
                dimmed
              />
            ))}

            {closedTickets.length > 15 && (
              <Text style={styles.moreText}>
                And {closedTickets.length - 15} more closed tickets...
              </Text>
            )}
          </View>
        )}

        {/* Empty */}
        {displayNewCount === 0 && pendingTickets.length === 0 && closedTickets.length === 0 && !refreshing && (
          <View style={styles.emptyState}>
            <Feather name="inbox" size={48} color={MUTED} />
            <Text style={styles.emptyTitle}>No support tickets</Text>
            <Text style={styles.emptySubtitle}>
              Customer support requests will appear here when they arrive.
            </Text>
          </View>
        )}

        <View style={{ height: 20 }} />
      </ScrollView>
    </View>
  );
}

function SkeletonTicketItem() {
  return (
    <View style={[styles.ticketItem, { opacity: 0.6 }]}>
      <View style={styles.ticketIcon}>
        <View style={{ width: 18, height: 18, backgroundColor: MUTED, borderRadius: 9 }} />
      </View>
      <View style={styles.ticketContent}>
        <View style={{ width: '80%', height: 14, backgroundColor: '#f3f4f6', borderRadius: 4, marginBottom: 4 }} />
        <View style={{ width: '60%', height: 12, backgroundColor: '#f3f4f6', borderRadius: 4, marginBottom: 4 }} />
        <View style={{ width: '40%', height: 11, backgroundColor: '#f3f4f6', borderRadius: 4 }} />
      </View>
      <View style={styles.ticketActions}>
        <View style={[styles.statusDot, { backgroundColor: MUTED }]} />
      </View>
    </View>
  );
}

function TicketItem({ ticket, onPress, onDelete, isDeleting = false, dimmed = false }) {
  const statusColor = getStatusColor(ticket.status);
  const statusIcon = getStatusIcon(ticket.status);
  // Show business name then email in brackets
  const fromLine = ticket.user_business
    ? `${ticket.user_business}${ticket.user_email ? ` (${ticket.user_email})` : ""}`
    : ticket.user_email || 'Unknown user';
  const preview = (ticket.message || '').trim();

  return (
    <View style={[styles.ticketItem, dimmed && styles.dimmedItem]}>
      <TouchableOpacity style={styles.ticketContent} onPress={onPress} activeOpacity={0.7} disabled={isDeleting}>
        <View style={styles.ticketIcon}>
          <Feather name={statusIcon} size={22} color={statusColor} />
        </View>
        <View style={styles.ticketInfo}>
          <Text style={[styles.ticketSubject, dimmed && styles.dimmedText]} numberOfLines={1}>
            {ticket.subject || 'No subject'}
          </Text>
          <Text style={[styles.ticketFrom, dimmed && styles.dimmedText]} numberOfLines={1}>
            From: {fromLine}
          </Text>
          {!!preview && (
            <Text style={[styles.ticketMessage, dimmed && styles.dimmedText]} numberOfLines={2}>
              {preview}
            </Text>
          )}
          <Text style={styles.ticketTime}>{formatRelativeTime(ticket.last_message_at || ticket.created_at)}</Text>
        </View>
        <View style={styles.ticketActions}>
          <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
        </View>
      </TouchableOpacity>

      <TouchableOpacity style={[styles.deleteBtn, isDeleting && { opacity: 0.5 }]} onPress={onDelete} disabled={isDeleting} activeOpacity={0.7}>
        <Feather name="trash-2" size={22} color={DANGER} />
      </TouchableOpacity>
    </View>
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
  backBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 18, fontWeight: "900", color: TEXT, flex: 1, textAlign: "center", marginHorizontal: 16 },
  refreshBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: BRAND + "10", alignItems: "center", justifyContent: "center" },
  content: { flex: 1 },
  contentContainer: { padding: 16 },
  card: {
    backgroundColor: CARD, borderRadius: 12, borderWidth: 1, borderColor: BORDER, padding: 16, marginBottom: 16,
    ...Platform.select({ ios: { shadowColor: "#0b1220", shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } }, android: { elevation: 3 } }),
  },
  cardHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  cardTitle: { color: TEXT, fontWeight: "900", fontSize: 16, marginBottom: 12 },
  ticketItem: { flexDirection: "row", alignItems: "center", paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#f8fafc", gap: 8 },
  dimmedItem: { opacity: 0.6 },
  ticketIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#f8fafc",
    alignItems: "center",
    justifyContent: "center",
  },
  ticketContent: { flex: 1, flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 4 },
  ticketInfo: { flex: 1 },
  ticketSubject: { color: TEXT, fontWeight: "700", fontSize: 14, marginBottom: 2 },
  ticketFrom: { color: MUTED, fontSize: 12, marginBottom: 4 },
  ticketMessage: { color: MUTED, fontSize: 13, lineHeight: 18, marginBottom: 4 },
  ticketTime: { color: MUTED, fontSize: 11, fontWeight: "600" },
  dimmedText: { color: MUTED },
  ticketActions: { alignItems: "center", gap: 8 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  moreText: { color: MUTED, fontSize: 12, fontStyle: "italic", textAlign: "center", marginTop: 8 },
  emptyState: { alignItems: "center", justifyContent: "center", paddingVertical: 60 },
  emptyTitle: { color: TEXT, fontWeight: "800", fontSize: 18, marginTop: 16, marginBottom: 8 },
  emptySubtitle: { color: MUTED, fontSize: 14, textAlign: "center", lineHeight: 20 },
  infoBtn: { width: 26, height: 26, borderRadius: 8, borderWidth: 1, borderColor: BORDER, alignItems: "center", justifyContent: "center", backgroundColor: "#f8fafc" },
  modalBackdrop: { position: "absolute", inset: 0, backgroundColor: "rgba(0,0,0,0.4)" },
  modalWrap: { flex: 1, justifyContent: "center", alignItems: "center", padding: 16 },
  modalCard: {
    backgroundColor: CARD, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: BORDER, width: "92%", maxWidth: 480,
    ...Platform.select({ ios: { shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 16, shadowOffset: { width: 0, height: 6 } }, android: { elevation: 10 } }),
  },
  modalHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  smallBtn: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8, backgroundColor: "#f3f4f6" },
  smallBtnText: { color: TEXT, fontWeight: "700", fontSize: 12 },
  deleteBtn: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: "#fef2f2",
    borderWidth: 1,
    borderColor: "#fecaca",
    alignItems: "center",
    justifyContent: "center",
  },
});