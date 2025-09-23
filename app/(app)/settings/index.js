/* app/(app)/settings/index.js */
import { loginHref, accountHref, profileHref, supportHref } from "../../../lib/nav";

import React, { useEffect, useMemo, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  Image,
  Modal,
  Pressable,
  Platform,
  Linking,
} from "react-native";
  // SafeArea + navigation
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";

  // Files + Supabase
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system";
import { supabase } from "../../../lib/supabase";

  // Icons
import {
  ChevronRight,
  Crown,
  Building2,
  CreditCard,
  HelpCircle,
  LogOut,
  Image as ImageIcon,
  FileText,
  Pencil,
  Trash2,
  ExternalLink,
  ChevronLeft,
} from "lucide-react-native";

/* ---------------- theme ---------------- */
const BRAND = "#2a86ff";
const TEXT = "#0b1220";
const MUTED = "#6b7280";
const CARD = "#ffffff";
const BG = "#f5f7fb";
const BORDER = "#e6e9ee";

/* -------- helpers -------- */
function base64ToBytes(b64) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const lookup = new Uint8Array(256);
  for (let i = 0; i < alphabet.length; i++) lookup[alphabet.charCodeAt(i)] = i;
  const clean = b64.replace(/[^A-Za-z0-9+/=]/g, "");
  const len = clean.length;
  const pads = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0;
  const bytesLen = ((len * 3) >> 2) - pads;
  const out = new Uint8Array(bytesLen);
  let p = 0, i = 0;
  while (i < len) {
    const a = lookup[clean.charCodeAt(i++)];
    const b = lookup[clean.charCodeAt(i++)];
    const c = lookup[clean.charCodeAt(i++)];
    const d = lookup[clean.charCodeAt(i++)];
    const trip = (a << 18) | (b << 12) | (c << 6) | d;
    if (p < bytesLen) out[p++] = (trip >> 16) & 0xff;
    if (p < bytesLen) out[p++] = (trip >> 8) & 0xff;
    if (p < bytesLen) out[p++] = trip & 0xff;
  }
  return out;
}

/** Try to produce a usable URL for a storage object (public bucket OR signed). */
async function resolveStorageUrl(pathInBucket) {
  const { data: pub, error: pubErr } = supabase.storage.from("logos").getPublicUrl(pathInBucket);
  if (!pubErr && pub?.publicUrl) return pub.publicUrl;

  const expiresIn = 60 * 60 * 24 * 365 * 5; // 5 years
  const { data: signed, error: sErr } = await supabase.storage
    .from("logos")
    .createSignedUrl(pathInBucket, expiresIn);
  if (!sErr && signed?.signedUrl) return signed.signedUrl;

  throw new Error(pubErr?.message || sErr?.message || "Could not get file URL");
}

/** Premium/trial badge + access logic */
function getPremiumStatus(profile) {
  if (!profile) return { isPremium: false, chip: "Expired", color: "#9ca3af" };

  const tier = String(profile.plan_tier || "").toLowerCase();
  const status = String(profile.plan_status || "").toLowerCase();

  // Active subscription wins
  if (tier === "pro" && status === "active") {
    return { isPremium: true, chip: "Premium", color: "#10b981" };
  }

  // Trial window
  if (profile.trial_ends_at) {
    const ends = new Date(profile.trial_ends_at);
    const now = new Date();
    if (ends > now) {
      const days = Math.ceil((ends.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      return { isPremium: true, chip: "Trial · " + days + "d left", color: "#2a86ff" };
    }
  }

  // Otherwise expired
  return { isPremium: false, chip: "Expired", color: "#9ca3af" };
}

export default function SettingsHome() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [loading, setLoading] = useState(true);
  const [userProfileData, setUserProfileData] = useState(null);
  const [userEmail, setUserEmail] = useState("");
  const [userId, setUserId] = useState("");
  const [working, setWorking] = useState(false);

  const [logoModalOpen, setLogoModalOpen] = useState(false);
  const [errBanner, setErrBanner] = useState("");

  const showError = (msg) => {
    setErrBanner(msg || "Something went wrong");
    setTimeout(() => setErrBanner(""), 5000);
    console.warn("[Settings] ERROR:", msg);
  };

  const normalizeLogo = (val) => {
    if (val == null) return null;
    const v = String(val).trim();
    if (!v || v.toUpperCase() === "EMPTY" || v.toUpperCase() === "NULL") return null;
    return v;
  };

  // Load the profile row (columns aligned to your table)
  const loadProfile = useCallback(async () => {
    async function attempt() {
      const authRes = await supabase.auth.getUser();
      const user = authRes?.data?.user;
      if (!user) { router.replace(loginHref); return null; }
      setUserEmail(user.email || "");
      setUserId(user.id);

      // NOTE: single string (no template literals or comments) - removed reminder columns
      const { data, error } = await supabase
        .from("profiles")
        .select("id,business_name,trade_type,custom_logo_url,plan_tier,plan_status,trial_ends_at")
        .eq("id", user.id)
        .maybeSingle();
      if (error) throw error;

      const cleaned = { ...(data || {}) };
      cleaned.custom_logo_url = normalizeLogo(cleaned.custom_logo_url);
      return cleaned;
    }

    try {
      setLoading(true);
      const p = await attempt();
      if (!p) return;
      setUserProfileData(p);
    } catch (e1) {
      try {
        const p = await attempt();
        if (!p) return;
        setUserProfileData(p);
      } catch (e2) {
        showError(e2?.message || String(e2));
      }
    } finally {
      setLoading(false);
    }
  }, [router]);

  // Load once + on focus
  useEffect(() => { loadProfile(); }, [loadProfile]);
  useEffect(() => {
    const unsub = router.addListener?.("focus", loadProfile);
    return () => { try { unsub && unsub(); } catch {} };
  }, [router, loadProfile]);

  const planInfo = useMemo(() => getPremiumStatus(userProfileData), [userProfileData]);
  const isPremium = planInfo.isPremium;
  const planLabel = planInfo.chip;

  const initials = useMemo(() => {
    const src = String(userProfileData?.business_name || userEmail || "")
      .replace(/[^a-zA-Z ]/g, " ")
      .trim();
    if (!src) return "U";
    const parts = src.split(/\s+/).slice(0, 2);
    return parts.map((p) => p.charAt(0).toUpperCase()).join("") || "U";
  }, [userProfileData?.business_name, userEmail]);

  const hasLogo = !!normalizeLogo(userProfileData?.custom_logo_url);
  const isPdfLogo = hasLogo && /\.pdf($|\?)/i.test(userProfileData?.custom_logo_url || "");

  // Human summary for reminder prefs
  const reminderSummary = useMemo(() => {
    if (!userProfileData) return "Configure when to chase invoices";
    const dueOn = (userProfileData.reminder_due_enabled ?? true)
      ? "Due: " + String(userProfileData.reminder_days_before ?? 2) + "d before"
      : "Due: off";
    const overOn = (userProfileData.reminder_overdue_enabled ?? true)
      ? "Overdue: every " + String(userProfileData.reminder_overdue_every_days ?? 7) + "d"
      : "Overdue: off";
    const hour = Number(userProfileData.reminder_send_hour_utc ?? 9);
    return dueOn + " • " + overOn + " • " + hour + ":00 UTC";
  }, [userProfileData]);

  const onLogout = async () => {
    try { await supabase.auth.signOut(); }
    catch (e) { showError(e?.message || String(e)); }
    finally { router.replace(loginHref); }
  };

  /** Upload / replace logo to logos/users/<uid>/logo.<ext> */
  const pickAndUploadLogo = async () => {
    try {
      setWorking(true);

      const result = await DocumentPicker.getDocumentAsync({
        multiple: false,
        copyToCacheDirectory: true,
        type: ["image/*", "application/pdf"],
      });
      if (result.canceled) return;

      const file = result.assets[0];
      const uri = file.uri;
      const name = file.name || (Platform.OS === "ios" ? uri.split("/").pop() : "upload");
      const ext = (name?.split(".").pop() || "").toLowerCase();

      let contentType = "application/octet-stream";
      if (ext === "pdf") contentType = "application/pdf";
      else if (ext === "jpg" || ext === "jpeg") contentType = "image/jpeg";
      else if (ext === "png") contentType = "image/png";
      else if (ext === "webp") contentType = "image/webp";
      else if (file.mimeType) contentType = file.mimeType;

      const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
      if (!base64) throw new Error("Could not read file data");

      const bytes = base64ToBytes(base64);
      const suffix = ext ? ext : "bin";
      const pathInBucket = "users/" + userId + "/logo." + suffix;

      const up = await supabase.storage.from("logos").upload(pathInBucket, bytes, {
        contentType,
        upsert: true,
      });
      if (up.error) throw up.error;

      const publicishUrl = await resolveStorageUrl(pathInBucket);

      const upd = await supabase
        .from("profiles")
        .update({ custom_logo_url: publicishUrl })
        .eq("id", userId);
      if (upd.error) throw upd.error;

      setUserProfileData((p) => ({ ...(p || {}), custom_logo_url: publicishUrl }));
    } catch (e) {
      showError(e?.message || String(e));
    } finally {
      setWorking(false);
      setLogoModalOpen(false);
    }
  };

  const removeLogo = async () => {
    try {
      if (!hasLogo) { setLogoModalOpen(false); return; }
      setWorking(true);

      const url = String(userProfileData?.custom_logo_url || "");
      let storagePath = null;
      const anchors = [
        "/storage/v1/object/public/logos/",
        "/object/public/logos/",
        "/logos/",
      ];
      for (let i = 0; i < anchors.length; i++) {
        const idx = url.indexOf(anchors[i]);
        if (idx !== -1) {
          storagePath = url.substring(idx + anchors[i].length);
          break;
        }
      }
      if (!storagePath) storagePath = "users/" + userId + "/logo.png";

      await supabase.storage.from("logos").remove([storagePath]).catch(() => {});

      const upd = await supabase.from("profiles").update({ custom_logo_url: null }).eq("id", userId);
      if (upd.error) throw upd.error;

      setUserProfileData((p) => ({ ...(p || {}), custom_logo_url: null }));
    } catch (e) {
      showError(e?.message || String(e));
    } finally {
      setWorking(false);
      setLogoModalOpen(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView edges={["top", "left", "right", "bottom"]} style={styles.loading}>
        <ActivityIndicator color={BRAND} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={["top", "left", "right", "bottom"]} style={styles.wrap}>
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: 12,
          paddingBottom: Math.max(insets.bottom, 28),
        }}
      >
        {/* Back Button */}
        <TouchableOpacity 
          style={styles.backButton}
          onPress={() => router.back()}
          activeOpacity={0.7}
        >
          <ChevronLeft size={20} color={BRAND} />
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>

        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.h1}>Settings</Text>
          <Text style={styles.hint}>Manage your account and preferences</Text>
        </View>

        {/* Profile / hero card */}
        <View style={styles.centerRow}>
          <View style={styles.profileCard}>
            <TouchableOpacity activeOpacity={0.9} onPress={() => setLogoModalOpen(true)} style={styles.avatarWrap}>
              {hasLogo && !isPdfLogo ? (
                <Image source={{ uri: userProfileData.custom_logo_url }} style={styles.avatarImg} resizeMode="cover" />
              ) : hasLogo && isPdfLogo ? (
                <View style={[styles.avatar, { backgroundColor: "#fef3c7", borderColor: "#fde68a" }]}>
                  <FileText size={22} color="#92400e" />
                </View>
              ) : (
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>{initials}</Text>
                </View>
              )}
              <View style={styles.editBadge}>
                <Pencil size={14} color="#fff" />
              </View>
            </TouchableOpacity>

            <Text style={styles.bizName} numberOfLines={1}>
              {userProfileData?.business_name || "Your Business"}
            </Text>
            <Text style={styles.email} numberOfLines={1}>{userEmail}</Text>

            <View style={styles.badgesRow}>
              <View style={[styles.badge, { backgroundColor: planInfo.color }]}>
                <Text style={styles.badgeText}>{planLabel}</Text>
              </View>
              {!!userProfileData?.trade_type && (
                <View style={[styles.badge, styles.badgeMuted]}>
                  <Text style={styles.badgeText}>{String(userProfileData.trade_type).trim()}</Text>
                </View>
              )}
            </View>

            {hasLogo && (
              <TouchableOpacity onPress={() => Linking.openURL(userProfileData.custom_logo_url)} style={{ flexDirection: "row", alignItems: "center", marginTop: 10 }}>
                <ExternalLink size={16} color={MUTED} />
                <Text style={{ color: MUTED, marginLeft: 6 }}>Open current logo</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Upsell banner (only if not actively subscribed) */}
        {!isPremium && (
          <View style={styles.upgradeCard}>
            <View style={styles.upgradeLeft}>
              <View style={styles.crownWrap}>
                <Crown size={18} color={BRAND} />
              </View>
              <View style={{ flexShrink: 1 }}>
                <Text style={styles.upTitle}>Upgrade to Premium</Text>
                <Text style={styles.upSub} numberOfLines={2}>
                  Unlock duplication, advanced editing, and pro features.
                </Text>
              </View>
            </View>
            <TouchableOpacity onPress={() => router.push(accountHref)} style={styles.upBtn} activeOpacity={0.92}>
              <Text style={styles.upBtnText}>Upgrade</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Sections */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Account</Text>
          <Row icon={<CreditCard size={18} color={MUTED} />} title="Plan & Billing" subtitle="Manage / Upgrade" onPress={() => router.push(accountHref)} />
          <Row icon={<Building2 size={18} color={MUTED} />} title="Business Profile" subtitle="Edit details & branding" onPress={() => router.push(profileHref)} />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Support</Text>
          <Row icon={<HelpCircle size={18} color={MUTED} />} title="Help & Support" subtitle="FAQs, guides, contact us" onPress={() => router.push(supportHref)} />
        </View>

        <TouchableOpacity style={[styles.logoutBtn]} activeOpacity={0.9} onPress={onLogout}>
          <LogOut size={18} color="#fff" style={{ marginRight: 8 }} />
          <Text style={styles.logoutText}>Log out</Text>
        </TouchableOpacity>
      </ScrollView>

      {!!errBanner && (
        <View style={styles.errBanner}>
          <Text style={styles.errText}>{errBanner}</Text>
        </View>
      )}

      {/* Upload / Replace / Remove logo */}
      <Modal visible={logoModalOpen} animationType="fade" transparent>
        <Pressable style={styles.modalBackdrop} onPress={() => !working && setLogoModalOpen(false)} />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>{hasLogo ? "Update your logo" : "Upload a logo"}</Text>
          <Text style={styles.sheetSub}>Supported: JPG, PNG, or PDF.</Text>

          <TouchableOpacity style={[styles.primaryBtn, working && { opacity: 0.6 }]} disabled={working} onPress={pickAndUploadLogo} activeOpacity={0.9}>
            {working ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <ImageIcon size={18} color="#fff" style={{ marginRight: 8 }} />
                <Text style={styles.primaryBtnText}>{hasLogo ? "Choose new logo" : "Choose logo"}</Text>
              </>
            )}
          </TouchableOpacity>

          {hasLogo && (
            <TouchableOpacity style={styles.dangerBtn} onPress={removeLogo} disabled={working} activeOpacity={0.9}>
              <Trash2 size={18} color="#fff" style={{ marginRight: 8 }} />
              <Text style={styles.dangerBtnText}>Remove logo</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity style={styles.secondaryBtn} onPress={() => setLogoModalOpen(false)} disabled={working} activeOpacity={0.9}>
            <Text style={styles.secondaryBtnText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

/* ----- Row component ----- */
function Row({ icon, title, subtitle, onPress }) {
  return (
    <TouchableOpacity style={rowStyles.row} activeOpacity={0.9} onPress={onPress}>
      <View style={rowStyles.left}>
        <View style={rowStyles.iconWrap}>{icon}</View>
        <View style={{ flexShrink: 1 }}>
          <Text style={rowStyles.title} numberOfLines={1}>{title}</Text>
          {!!subtitle && <Text style={rowStyles.sub} numberOfLines={1}>{subtitle}</Text>}
        </View>
      </View>
      <ChevronRight size={18} color={MUTED} />
    </TouchableOpacity>
  );
}

/* ------------------ styles ------------------ */
const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: BG },
  loading: { flex: 1, backgroundColor: BG, alignItems: "center", justifyContent: "center" },
  
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 8,
    paddingHorizontal: 8,
    marginLeft: -8,
    marginBottom: 8,
  },
  backText: {
    color: BRAND,
    fontSize: 16,
    fontWeight: '800',
  },
  
  header: { alignItems: "center", marginBottom: 12 },
  h1: { color: TEXT, fontSize: 24, fontWeight: "800" },
  hint: { color: MUTED, marginTop: 4 },

  centerRow: { alignItems: "center", marginTop: 6 },
  profileCard: {
    width: "100%", maxWidth: 520, backgroundColor: CARD, borderRadius: 16,
    paddingVertical: 18, paddingHorizontal: 16, borderWidth: 1, borderColor: BORDER,
    alignItems: "center", shadowColor: "#0b1220", shadowOpacity: 0.05, shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 }, elevation: 2,
  },
  avatarWrap: { position: "relative" },
  avatar: {
    width: 64, height: 64, borderRadius: 32, backgroundColor: BRAND + "15",
    alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: BORDER, marginBottom: 10,
  },
  avatarImg: {
    width: 64, height: 64, borderRadius: 32, borderWidth: 1, borderColor: BORDER, marginBottom: 10,
  },
  avatarText: { color: BRAND, fontWeight: "900", fontSize: 20 },
  editBadge: {
    position: "absolute", right: -2, bottom: 6, height: 22, width: 22, borderRadius: 11,
    alignItems: "center", justifyContent: "center",
    backgroundColor: BRAND, borderWidth: 1, borderColor: "#ffffff",
  },
  bizName: { color: TEXT, fontWeight: "900", fontSize: 18 },
  email: { color: MUTED, marginTop: 4 },
  badgesRow: { flexDirection: "row", gap: 8, marginTop: 12 },
  badge: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999 },
  badgeText: { color: "#fff", fontWeight: "800", fontSize: 12 },
  badgeMuted: { backgroundColor: "#6b7280" },

  upgradeCard: {
    width: "100%", maxWidth: 520, alignSelf: "center", marginTop: 14, backgroundColor: CARD,
    borderRadius: 16, borderWidth: 1, borderColor: BORDER, padding: 14, flexDirection: "row",
    alignItems: "center", justifyContent: "space-between",
    shadowColor: "#0b1220", shadowOpacity: 0.05, shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 }, elevation: 2,
  },
  upgradeLeft: { flexDirection: "row", alignItems: "center", gap: 12, flexShrink: 1 },
  crownWrap: {
    height: 34, width: 34, borderRadius: 17, backgroundColor: BRAND + "15",
    borderWidth: 1, borderColor: BORDER, alignItems: "center", justifyContent: "center",
  },
  upTitle: { color: TEXT, fontWeight: "900" },
  upSub: { color: MUTED, marginTop: 2 },
  upBtn: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, backgroundColor: BRAND },
  upBtnText: { color: "#fff", fontWeight: "800" },

  section: {
    width: "100%", maxWidth: 520, alignSelf: "center", backgroundColor: CARD,
    borderRadius: 16, borderWidth: 1, borderColor: BORDER, paddingVertical: 8, marginTop: 16,
    shadowColor: "#0b1220", shadowOpacity: 0.05, shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 }, elevation: 2,
  },
  sectionTitle: { color: MUTED, fontWeight: "900", fontSize: 12, paddingHorizontal: 14, paddingTop: 6, paddingBottom: 4 },

  logoutBtn: {
    width: "100%", maxWidth: 520, alignSelf: "center", marginTop: 16,
    backgroundColor: "#dc2626", borderRadius: 14, padding: 14,
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    shadowColor: "#dc2626", shadowOpacity: 0.25, shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 }, elevation: 3,
  },
  logoutText: { color: "#fff", fontWeight: "900" },

  errBanner: {
    position: "absolute", left: 16, right: 16, bottom: 18,
    backgroundColor: "#111827", paddingVertical: 10, paddingHorizontal: 14,
    borderRadius: 12, alignItems: "center",
    shadowColor: "#000", shadowOpacity: 0.25, shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 }, elevation: 4,
  },
  errText: { color: "#fff", fontWeight: "700" },

  modalBackdrop: { flex: 1, backgroundColor: "#0008" },
  sheet: {
    position: "absolute", left: 0, right: 0, bottom: 0,
    backgroundColor: CARD, borderTopLeftRadius: 18, borderTopRightRadius: 18,
    padding: 16, borderTopWidth: 1, borderColor: BORDER,
  },
  sheetHandle: { alignSelf: "center", width: 44, height: 5, borderRadius: 999, backgroundColor: BORDER, marginBottom: 10 },
  sheetTitle: { color: TEXT, fontWeight: "900", fontSize: 18 },
  sheetSub: { color: MUTED, marginTop: 6, marginBottom: 12 },

  primaryBtn: {
    backgroundColor: BRAND, borderRadius: 12, paddingVertical: 12,
    alignItems: "center", flexDirection: "row", justifyContent: "center",
  },
  primaryBtnText: { color: "#fff", fontWeight: "800" },

  dangerBtn: {
    marginTop: 10, backgroundColor: "#ef4444", borderRadius: 12,
    paddingVertical: 12, alignItems: "center", flexDirection: "row", justifyContent: "center",
  },
  dangerBtnText: { color: "#fff", fontWeight: "800" },

  secondaryBtn: { marginTop: 10, backgroundColor: "#eef2f7", borderRadius: 12, paddingVertical: 12, alignItems: "center" },
  secondaryBtnText: { color: TEXT, fontWeight: "800" },
});

const rowStyles = StyleSheet.create({
  row: {
    paddingHorizontal: 12, paddingVertical: 12, marginHorizontal: 8, marginVertical: 4,
    borderRadius: 12, borderWidth: 1, borderColor: BORDER, backgroundColor: "#f9fafb",
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
  },
  left: { flexDirection: "row", alignItems: "center", gap: 12, flexShrink: 1 },
  iconWrap: {
    height: 34, width: 34, borderRadius: 10, backgroundColor: "#f3f4f6",
    borderWidth: 1, borderColor: BORDER, alignItems: "center", justifyContent: "center",
  },
  title: { color: TEXT, fontWeight: "900" },
  sub: { color: MUTED, marginTop: 2, fontSize: 12 },
});