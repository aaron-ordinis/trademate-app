// app/(app)/about/index.js
import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Linking,
  Alert,
  Platform,
  ScrollView,
} from 'react-native';
import Constants from 'expo-constants';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

// ---- Brand tokens (match list/settings/support) ----
const BRAND = '#2a86ff';
const TEXT = '#0b1220';
const MUTED = '#6b7280';
const CARD = '#ffffff';
const BG = '#f5f7fb';
const BORDER = '#e6e9ee';

// ---- Links (replace with your real URLs) ----
const LINKS = {
  website: 'https://example.com',
  privacy: 'https://example.com/privacy',
  terms: 'https://example.com/terms',
  faq: 'https://example.com/faq',
  status: 'https://status.example.com',
  changelog: 'https://example.com/changelog',
  licenses: 'https://example.com/licenses', // open-source acknowledgements
  twitter: 'https://x.com/yourbrand',       // optional
};

// ---- Contact (same address as Support) ----
const SUPPORT_EMAIL = 'support@tradematequotes.app';

export default function AboutScreen() {
  const insets = useSafeAreaInsets();

  const appName  = Constants.expoConfig?.name || 'TradeMate Quotes';
  const version  = Constants.expoConfig?.version || Constants.manifest?.version || '0.0.0';
  const build    = Constants.nativeBuildVersion || '-';
  const os       = `${Platform.OS} ${Platform.Version}`;
  const device   = Constants.deviceName || 'Unknown';

  const open = async (url) => {
    try {
      const can = await Linking.canOpenURL(url);
      if (!can) throw new Error('Cannot open URL');
      await Linking.openURL(url);
    } catch {
      Alert.alert('Error', 'Could not open link.');
    }
  };

  const mail = (subject, body = '') => {
    const diag = 
      `${body}\n\n---\nApp: ${appName}\nVersion: ${version}\nBuild: ${build}\nOS: ${os}\nDevice: ${device}`;
    const url = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(diag)}`;
    Linking.openURL(url).catch(() => Alert.alert('Error', 'Could not open your mail app.'));
  };

  return (
    <SafeAreaView edges={['top','left','right','bottom']} style={styles.wrap}>
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: 12,
          paddingBottom: Math.max(insets.bottom, 28),
        }}
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.h1}>About</Text>
          <Text style={styles.hint}>Version, links, and company info</Text>
        </View>

        {/* App info */}
        <View style={styles.card}>
          <Text style={styles.app}>{appName}</Text>
          <Text style={styles.meta}>Version {version} (build {build})</Text>
          <View style={styles.badgesRow}>
            <View style={styles.badge}><Text style={styles.badgeText}>Made for trades</Text></View>
          </View>
        </View>

        {/* Official links */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Official</Text>
          <RowLink label="Website" onPress={() => open(LINKS.website)} />
          <RowLink label="Privacy Policy" onPress={() => open(LINKS.privacy)} />
          <RowLink label="Terms of Service" onPress={() => open(LINKS.terms)} />
        </View>

        {/* Help resources */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Help & resources</Text>
          <RowLink label="FAQs & Guides" onPress={() => open(LINKS.faq)} />
          <RowLink label="System Status" onPress={() => open(LINKS.status)} />
          <RowLink label="Release Notes" onPress={() => open(LINKS.changelog)} />
          <RowLink label="Open-source Licenses" onPress={() => open(LINKS.licenses)} />
        </View>

        {/* Contact / social */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Contact</Text>
          <PrimaryBtn label="Contact support" onPress={() => mail('Support request')} />
          <GhostBtn label="Report a bug" onPress={() => mail('Bug report', 'Describe the issue here…')} />
          <GhostBtn label="Follow on X / Twitter" onPress={() => open(LINKS.twitter)} />
        </View>

        {/* Diagnostics */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Diagnostics</Text>
          <RowTight label="App version" value={version} />
          <RowTight label="Build" value={String(build)} />
          <RowTight label="OS" value={os} />
          <RowTight label="Device" value={device} />
          <GhostBtn label="Email diagnostics" onPress={() => mail('Diagnostics', 'Adding diagnostics…')} />
        </View>

        {/* Legal footer / copyright */}
        <View style={styles.metaCard}>
          <Text style={styles.metaText}>
            © {new Date().getFullYear()} {appName}. All rights reserved.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

/* ------ Small presentational components ------ */
function RowLink({ label, onPress }) {
  return (
    <TouchableOpacity style={rowStyles.rowLink} activeOpacity={0.9} onPress={onPress}>
      <Text style={rowStyles.linkText}>{label}</Text>
    </TouchableOpacity>
  );
}
function PrimaryBtn({ label, onPress }) {
  return (
    <TouchableOpacity style={rowStyles.primaryBtn} activeOpacity={0.92} onPress={onPress}>
      <Text style={rowStyles.primaryBtnText}>{label}</Text>
    </TouchableOpacity>
  );
}
function GhostBtn({ label, onPress }) {
  return (
    <TouchableOpacity style={rowStyles.ghostBtn} activeOpacity={0.9} onPress={onPress}>
      <Text style={rowStyles.ghostBtnText}>{label}</Text>
    </TouchableOpacity>
  );
}

/* ---------------- styles ---------------- */
const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: BG },

  header: { alignItems: 'center', marginBottom: 12 },
  h1: { color: TEXT, fontSize: 24, fontWeight: '800' },
  hint: { color: MUTED, marginTop: 4 },

  card: {
    width: '100%',
    maxWidth: 520,
    alignSelf: 'center',
    backgroundColor: CARD,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 14,
    marginTop: 14,
    shadowColor: '#0b1220',
    shadowOpacity: 0.05,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 2,
  },
  cardTitle: { color: TEXT, fontWeight: '900', marginBottom: 6 },

  app: { color: TEXT, fontSize: 18, fontWeight: '900' },
  meta: { color: MUTED, marginTop: 6 },

  badgesRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  badge: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: BRAND },
  badgeText: { color: '#fff', fontWeight: '800', fontSize: 12 },

  metaCard: {
    width: '100%',
    maxWidth: 520,
    alignSelf: 'center',
    backgroundColor: 'transparent',
    padding: 10,
    alignItems: 'center',
  },
  metaText: { color: MUTED, fontSize: 12 },
});

const rowStyles = StyleSheet.create({
  rowLink: {
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: '#f9fafb',
    marginVertical: 4,
  },
  linkText: { color: TEXT, fontWeight: '800' },

  primaryBtn: {
    marginTop: 8,
    backgroundColor: BRAND,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  primaryBtnText: { color: '#fff', fontWeight: '800' },

  ghostBtn: {
    marginTop: 10,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: '#eef2f7',
    borderWidth: 1,
    borderColor: BORDER,
  },
  ghostBtnText: { color: TEXT, fontWeight: '800' },
});

const RowTight = ({ label, value }) => (
  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginVertical: 3 }}>
    <Text style={{ color: MUTED }}>{label}</Text>
    <Text style={{ color: TEXT, fontWeight: '700' }}>{value}</Text>
  </View>
);