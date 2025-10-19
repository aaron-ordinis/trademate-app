// app/(app)/settings/admin.js
import React, { useEffect, useState } from 'react';
import { 
  View, 
  Text, 
  Switch, 
  ActivityIndicator, 
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  StatusBar,
  Platform,
  Modal,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as NavigationBar from "expo-navigation-bar";
import * as SystemUI from "expo-system-ui";
import { Feather } from "@expo/vector-icons";
import { supabase } from '../../../lib/supabase';
import { useDeviceId } from '../../../lib/useDeviceId';
import { useAdminGate } from '../../../lib/useAdminGate';

/* ---------- THEME ---------- */
const CARD = "#ffffff";
const TEXT = "#0b1220";
const MUTED = "#6b7280";
const BORDER = "#e6e9ee";
const BRAND = "#2a86ff";
const BG = "#ffffff";
const SUCCESS = "#10b981";
const WARNING = "#f59e0b";

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

export default function AdminSettings() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const deviceId = useDeviceId();
  const gate = useAdminGate();
  const [isOwner, setIsOwner] = useState(null); // null = unknown, true/false = known
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [navBusy, setNavBusy] = useState(false);
  const [dataLoaded, setDataLoaded] = useState(false);

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

  // Load owner flag and whether THIS device is in admin_devices
  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      const uid = u?.user?.id;
      if (!uid || !deviceId) return;

      // Use Promise.all for faster parallel loading
      const [profResult, devResult] = await Promise.all([
        supabase
          .from('profiles')
          .select('admin_owner')
          .eq('id', uid)
          .maybeSingle(),
        supabase
          .from('admin_devices')
          .select('device_id')
          .eq('user_id', uid)
          .eq('device_id', deviceId)
          .maybeSingle()
      ]);

      if (!mounted) return;
      
      setIsOwner(Boolean(profResult.data?.admin_owner));
      setEnabled(Boolean(devResult.data?.device_id));
      setDataLoaded(true);
    })();
    return () => {
      mounted = false;
    };
  }, [deviceId, gate.lastChecked]);

  const toggle = async (next) => {
    if (isOwner === null || !deviceId || busy) return;
    
    // Optimistic update - show change immediately
    setEnabled(next);
    setBusy(true);

    try {
      const { data: u } = await supabase.auth.getUser();
      const uid = u?.user?.id;
      if (!uid) throw new Error('Not authenticated');

      if (next) {
        const { error } = await supabase
          .from('admin_devices')
          .upsert({ user_id: uid, device_id: deviceId });
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('admin_devices')
          .delete()
          .eq('user_id', uid)
          .eq('device_id', deviceId);
        if (error) throw error;
      }

      // Refresh the server-side gate
      await gate.refresh();

      // Optional audit log
      await supabase
        .rpc('rpc_write_audit', {
          p_device_id: deviceId,
          p_action: next ? 'admin_enable_device' : 'admin_disable_device',
          p_target: deviceId,
          p_metadata: {},
        })
        .catch(() => {});
    } catch (e) {
      console.warn('[AdminSettings.toggle] error', e?.message || e);
      // Revert optimistic update on error
      setEnabled(!next);
    } finally {
      setBusy(false);
    }
  };

  const goAdmin = async () => {
    setNavBusy(true);
    await gate.refresh();
    setNavBusy(false);
    if (gate.allowed) {
      router.push('/(admin)/');
    } else {
      console.warn('Admin not allowed yet for this device.');
    }
  };

  // Show content immediately, even while loading
  const showOwnerStatus = isOwner !== null;
  const showWarning = showOwnerStatus && !isOwner;

  return (
    <View style={styles.screen}>
      <View style={{ height: insets.top, backgroundColor: CARD }} />
      
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.push('/(app)/settings/')}>
          <Feather name="arrow-left" size={20} color={TEXT} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Admin Access</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView style={styles.content} contentContainerStyle={styles.contentContainer}>
        {/* Device Status */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>Device Status</Text>
            <InfoButton
              title="Admin Access"
              tips={[
                "Admin access allows you to manage users, view system data, and configure advanced settings.",
                "Only owner accounts can enable admin access on devices.",
                "Each device must be individually authorized for security.",
                "Device ID uniquely identifies this specific device.",
              ]}
            />
          </View>

          <View style={styles.statusCard}>
            <View style={styles.statusRow}>
              <Feather name="smartphone" size={20} color={MUTED} />
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={styles.statusLabel}>Device ID</Text>
                {deviceId ? (
                  <Text style={styles.statusValue}>{deviceId}</Text>
                ) : (
                  <View style={styles.skeletonText} />
                )}
              </View>
            </View>

            <View style={styles.statusRow}>
              <Feather name="user" size={20} color={MUTED} />
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={styles.statusLabel}>Account Type</Text>
                {showOwnerStatus ? (
                  <Text style={styles.statusValue}>{isOwner ? 'Owner' : 'Standard User'}</Text>
                ) : (
                  <View style={styles.skeletonText} />
                )}
              </View>
              {showOwnerStatus ? (
                <View style={[
                  styles.statusBadge, 
                  { backgroundColor: isOwner ? SUCCESS : MUTED }
                ]}>
                  <Text style={styles.statusBadgeText}>
                    {isOwner ? 'Owner' : 'User'}
                  </Text>
                </View>
              ) : (
                <View style={[styles.statusBadge, { backgroundColor: '#f3f4f6' }]}>
                  <View style={styles.skeletonBadge} />
                </View>
              )}
            </View>

            <View style={styles.statusRow}>
              <Feather name="shield" size={20} color={MUTED} />
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={styles.statusLabel}>Admin Status</Text>
                <Text style={styles.statusValue}>
                  {gate.allowed ? 'Access Granted' : 'Access Denied'}
                </Text>
              </View>
              <View style={[
                styles.statusBadge, 
                { backgroundColor: gate.allowed ? SUCCESS : WARNING }
              ]}>
                <Text style={styles.statusBadgeText}>
                  {gate.allowed ? 'Active' : 'Inactive'}
                </Text>
              </View>
            </View>
          </View>

          {showWarning && (
            <View style={styles.warningCard}>
              <Feather name="alert-triangle" size={16} color="#dc2626" />
              <Text style={styles.warningText}>
                Only owner accounts can enable admin access on devices.
              </Text>
            </View>
          )}
        </View>

        {/* Admin Controls */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>Admin Controls</Text>
            <InfoButton
              title="Device Authorization"
              tips={[
                "Enable admin access to unlock advanced features on this device.",
                "Admin access is device-specific for enhanced security.",
                "You can disable access at any time from this screen.",
                "Changes take effect immediately after toggling.",
              ]}
            />
          </View>

          <View style={styles.toggleRow}>
            <Text style={styles.toggleLabel}>Enable admin on this device</Text>
            {showOwnerStatus ? (
              <Switch
                value={enabled}
                onValueChange={toggle}
                disabled={!isOwner || busy || !deviceId}
                trackColor={{ false: "#e2e8f0", true: BRAND + "40" }}
                thumbColor={enabled ? BRAND : "#f1f5f9"}
              />
            ) : (
              <View style={styles.skeletonSwitch} />
            )}
          </View>

          {busy && (
            <View style={styles.loadingRow}>
              <ActivityIndicator size="small" color={BRAND} />
              <Text style={styles.loadingText}>Updating device access...</Text>
            </View>
          )}

          <Text style={styles.helpText}>
            Status: {gate.reason}
          </Text>

          {gate.allowed && (
            <TouchableOpacity
              onPress={goAdmin}
              disabled={navBusy}
              style={[styles.adminButton, navBusy && { opacity: 0.6 }]}
              activeOpacity={0.8}
            >
              <Feather name="settings" size={18} color="#fff" />
              <Text style={styles.adminButtonText}>
                {navBusy ? 'Checking...' : 'Open Admin Panel'}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.footerNote}>
          <Text style={styles.footerText}>
            Admin access provides elevated permissions for system management. Use responsibly and only enable on trusted devices.
          </Text>
        </View>

        <View style={{ height: 20 }} />
      </ScrollView>
    </View>
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
    marginBottom: 16,
  },
  
  cardTitle: { 
    color: TEXT, 
    fontWeight: "900", 
    fontSize: 16 
  },

  statusCard: {
    backgroundColor: "#f8fafc",
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: BORDER,
    gap: 12,
  },

  statusRow: {
    flexDirection: "row",
    alignItems: "center",
  },

  statusLabel: {
    color: MUTED,
    fontSize: 12,
    fontWeight: "600",
    marginBottom: 2,
  },

  statusValue: {
    color: TEXT,
    fontSize: 14,
    fontWeight: "700",
  },

  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },

  statusBadgeText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 11,
  },

  warningCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 12,
    padding: 12,
    backgroundColor: "#fee2e2",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#fca5a5",
  },

  warningText: {
    color: "#b91c1c",
    fontWeight: "600",
    fontSize: 13,
    flex: 1,
  },

  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  
  toggleLabel: {
    fontSize: 14,
    fontWeight: "700",
    color: TEXT,
    flex: 1,
  },

  loadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 12,
  },

  loadingText: {
    color: MUTED,
    fontSize: 13,
    fontWeight: "600",
  },

  helpText: { 
    color: MUTED, 
    fontSize: 12, 
    marginBottom: 16,
    lineHeight: 16,
  },

  adminButton: {
    backgroundColor: SUCCESS,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    ...Platform.select({
      ios: {
        shadowColor: SUCCESS,
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.2,
        shadowRadius: 4,
      },
      android: { elevation: 2 },
    }),
  },

  adminButtonText: {
    color: "#fff",
    fontWeight: "800",
    fontSize: 15,
  },

  footerNote: {
    backgroundColor: "#f8fafc",
    borderRadius: 12,
    padding: 12,
    marginTop: 8,
  },

  footerText: { 
    color: MUTED, 
    fontSize: 12, 
    textAlign: "center",
    lineHeight: 16,
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

  /* Modal */
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

  skeletonText: {
    width: '70%',
    height: 14,
    backgroundColor: '#f3f4f6',
    borderRadius: 4,
  },

  skeletonBadge: {
    width: 40,
    height: 11,
    backgroundColor: '#e2e8f0',
    borderRadius: 3,
  },

  skeletonSwitch: {
    width: 51,
    height: 31,
    backgroundColor: '#f3f4f6',
    borderRadius: 16,
  },
});