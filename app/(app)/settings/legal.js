// app/(app)/settings/legal.js
import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  StatusBar,
  Platform,
  TouchableOpacity,
  ScrollView,
  Modal,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import * as NavigationBar from "expo-navigation-bar";
import * as SystemUI from "expo-system-ui";
import { Feather } from "@expo/vector-icons";
import PolicyModal from "../../../components/PolicyModal";

/* Policy modules */
import { TERMS_MD, TERMS_VERSION } from "../../../lib/policies/terms";
import { PRIVACY_POLICY_MD, PRIVACY_POLICY_VERSION } from "../../../lib/policies/privacy";
import { POLICIES } from "../../../lib/policies/registry";

/* THEME */
const CARD = "#ffffff";
const TEXT = "#0b1220";
const MUTED = "#6b7280";
const BORDER = "#e6e9ee";
const BRAND = "#2a86ff";
const BG = "#ffffff";

/* ---- Info button with NO blur/dim ---- */
function InfoButton({ title, tips = [] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <TouchableOpacity onPress={() => setOpen(true)} style={styles.infoBtn}>
        <Text style={{ color: MUTED, fontWeight: "900" }}>i</Text>
      </TouchableOpacity>
      <Modal visible={open} animationType="fade" transparent onRequestClose={() => setOpen(false)}>
        {/* Transparent backdrop (no blur/dim) */}
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

export default function LegalSettings() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(null); // 'terms' | 'privacy' | 'registry'

  // Direct mapping for modal content
  const policyMap = {
    terms: {
      title: "Terms & Conditions — TradeMate",
      content: TERMS_MD,
      meta: { version: TERMS_VERSION },
    },
    privacy: {
      title: "Privacy Policy — TradeMate",
      content: PRIVACY_POLICY_MD,
      meta: { version: PRIVACY_POLICY_VERSION },
    },
    registry: {
      title: "Data Processing Registry — TradeMate",
      content: POLICIES[0]?.content || "No registry policy available.",
      meta: { version: POLICIES[0]?.version },
    },
  };

  const current = open ? policyMap[open] : null;

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

  return (
    <View style={styles.screen}>
      <View style={{ height: insets.top, backgroundColor: CARD }} />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Feather name="arrow-left" size={20} color={TEXT} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Legal & Privacy</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView style={styles.content} contentContainerStyle={styles.contentContainer}>
        {/* Legal Documents */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>Legal Documents</Text>
            <InfoButton
              title="Legal Information"
              tips={[
                "These documents outline your rights and responsibilities as a TradeMate user.",
                "Terms & Conditions cover usage, billing, and legal obligations.",
                "Privacy Policy details how your personal data is collected, used, and protected.",
                "Documents are regularly updated to reflect current practices and regulations.",
              ]}
            />
          </View>

          <SectionCard
            title="Terms & Conditions"
            subtitle="Your agreement with TradeMate: usage, billing, and legal responsibilities."
            meta={policyMap.terms.meta}
            onPress={() => setOpen("terms")}
          />

          <SectionCard
            title="Privacy Policy"
            subtitle="How TradeMate collects, uses, and safeguards your personal data."
            meta={policyMap.privacy.meta}
            onPress={() => setOpen("privacy")}
          />
        </View>

        {/* Compliance */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>Data Compliance</Text>
            <InfoButton
              title="Compliance Information"
              tips={[
                "TradeMate maintains records of data processing activities for regulatory compliance.",
                "GDPR requires businesses to document how personal data is processed.",
                "Our registry demonstrates compliance with data protection laws.",
                "This information may be requested by data protection authorities.",
              ]}
            />
          </View>

          <SectionCard
            title="Data Processing Registry"
            subtitle="Records of processing activities for GDPR and legal compliance."
            meta={policyMap.registry.meta}
            onPress={() => setOpen("registry")}
          />
        </View>

        <View style={styles.footerNote}>
          <Text style={styles.footerText}>
            All legal documents are available for review at any time. Contact support if you need copies by email or have questions about these policies.
          </Text>
        </View>

        <View style={{ height: 20 }} />
      </ScrollView>

      {/* Policy modal */}
      {current && (
        <PolicyModal
          visible={!!open}
          dimmed={false}
          title={current.title}
          content={current.content}
          onClose={() => setOpen(null)}
        />
      )}
    </View>
  );
}

/* Presentational card */
function SectionCard({ title, subtitle, meta, onPress }) {
  const metaLine = [];
  if (meta?.version) metaLine.push("v" + meta.version);
  if (meta?.updatedAt) metaLine.push("Updated " + meta.updatedAt);

  return (
    <TouchableOpacity onPress={onPress} style={styles.sectionCard} activeOpacity={0.7}>
      <View style={styles.sectionContent}>
        <View style={styles.sectionIcon}>
          <Feather name="file-text" size={18} color={BRAND} />
        </View>
        <View style={styles.sectionTextWrap}>
          <Text style={styles.sectionTitle}>{title}</Text>
          <Text style={styles.sectionSubtitle}>{subtitle}</Text>
          {metaLine.length > 0 && <Text style={styles.sectionMeta}>{metaLine.join(" • ")}</Text>}
        </View>
        <Feather name="chevron-right" size={16} color={MUTED} />
      </View>
    </TouchableOpacity>
  );
}

/* STYLES */
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

  content: { flex: 1 },
  contentContainer: { padding: 16 },

  card: {
    backgroundColor: CARD,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 16,
    marginBottom: 16,
    ...Platform.select({
      ios: { shadowColor: "#0b1220", shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } },
      android: { elevation: 3 },
    }),
  },
  cardHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16 },
  cardTitle: { color: TEXT, fontWeight: "900", fontSize: 16 },

  sectionCard: {
    backgroundColor: "#f8fafc",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    marginBottom: 12,
    overflow: "hidden",
  },
  sectionContent: { flexDirection: "row", alignItems: "center", padding: 16, gap: 12 },
  sectionIcon: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: BRAND + "15",
    alignItems: "center", justifyContent: "center",
  },
  sectionTextWrap: { flex: 1 },
  sectionTitle: { color: TEXT, fontWeight: "700", fontSize: 15, marginBottom: 2 },
  sectionSubtitle: { color: MUTED, fontSize: 13, lineHeight: 18 },
  sectionMeta: { color: MUTED, fontSize: 11, marginTop: 6, fontWeight: "600" },

  footerNote: { backgroundColor: "#f8fafc", borderRadius: 12, padding: 12, marginTop: 8 },
  footerText: { color: MUTED, fontSize: 12, textAlign: "center", lineHeight: 16 },

  infoBtn: {
    width: 26, height: 26, borderRadius: 8, borderWidth: 1, borderColor: BORDER,
    alignItems: "center", justifyContent: "center", backgroundColor: "#f8fafc",
  },

  /* Info modal: no backdrop dim */
  modalWrap: {
    flex: 1, justifyContent: "center", alignItems: "center", padding: 16,
    backgroundColor: "transparent",
  },
  modalCard: {
    backgroundColor: CARD, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: BORDER,
    width: "92%", maxWidth: 480,
    ...Platform.select({
      ios: { shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 16, shadowOffset: { width: 0, height: 6 } },
      android: { elevation: 10 },
    }),
  },
  modalHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  smallBtn: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8, backgroundColor: "#f3f4f6" },
  smallBtnText: { color: TEXT, fontWeight: "700", fontSize: 12 },
});