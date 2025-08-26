// app/(app)/support/index.js
import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Linking,
  Platform,
  ScrollView,
} from 'react-native';
import Constants from 'expo-constants';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

// ---- Brand tokens to match the app (same as list/settings) ----
const BRAND = '#2a86ff';
const TEXT = '#0b1220';
const MUTED = '#6b7280';
const CARD = '#ffffff';
const BG = '#f5f7fb';
const BORDER = '#e6e9ee';

// ---- Config ----
const SUPPORT_EMAIL = 'support@tradematequotes.app';
const FAQ_URL = 'https://tradematequotes.app/faq';         // update if needed
const STATUS_URL = 'https://status.tradematequotes.app';    // optional: your status page
const PRIVACY_URL = 'https://tradematequotes.app/privacy';
const TERMS_URL = 'https://tradematequotes.app/terms';

export default function SupportScreen() {
  const insets = useSafeAreaInsets();

  const openURL = async (url) => {
    try {
      const can = await Linking.canOpenURL(url);
      if (!can) throw new Error('Cannot open URL');
      await Linking.openURL(url);
    } catch {
      Alert.alert('Unavailable', 'That page could not be opened on this device.');
    }
  };

  const openMail = (subject, body = '') => {
    const app = Constants.expoConfig?.name || 'TradeMate Quotes';
    const v = Constants.expoConfig?.version || Constants.manifest?.version || '0.0.0';
    const sys = `${Platform.OS} ${Platform.Version}`;
    const details = 
      `${body}\n\n---\nApp: ${app}\nVersion: ${v}\nOS: ${sys}\nDevice: ${Constants.deviceName || 'Unknown'}\nBuild: ${Constants.nativeBuildVersion || '-'}`;
    const url = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(details)}`;
    Linking.openURL(url).catch(() =>
      Alert.alert('Error', 'Could not open your mail app.')
    );
  };

  return (
    <SafeAreaView edges={['top', 'left', 'right', 'bottom']} style={styles.wrap}>
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: 12,
          paddingBottom: Math.max(insets.bottom, 28),
        }}
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.h1}>Help & Support</Text>
          <Text style={styles.hint}>Get help fast, or self-serve common issues.</Text>
        </View>

        {/* Contact / report */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Contact us</Text>
          <Text style={styles.body}>We typically reply within 1 business day.</Text>

          <TouchableOpacity
            style={[styles.primaryBtn]}
            onPress={() => openMail('Support request')}
            activeOpacity={0.9}
          >
            <Text style={styles.primaryBtnText}>Contact support</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.rowBtn]}
            onPress={() => openMail('Bug report', 'Describe the issue here…')}
            activeOpacity={0.9}
          >
            <Text style={styles.rowBtnText}>Report a bug</Text>
          </TouchableOpacity>
        </View>

        {/* Self-serve resources */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Resources</Text>

          <TouchableOpacity style={styles.rowLink} onPress={() => openURL(FAQ_URL)} activeOpacity={0.9}>
            <Text style={styles.linkText}>FAQs & How-tos</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.rowLink} onPress={() => openURL(STATUS_URL)} activeOpacity={0.9}>
            <Text style={styles.linkText}>System status</Text>
          </TouchableOpacity>
        </View>

        {/* Troubleshooting tips */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Quick fixes</Text>
          <View style={styles.list}>
            {[
              'Force-close and reopen the app.',
              'Check you have a stable internet connection (Wi-Fi or mobile data).',
              'Make sure you’re on the latest app version from the store.',
              'If a PDF won’t save/share, ensure Files/Storage permissions are granted.',
              'Sign out and back in if your data seems out of date.',
            ].map((t, i) => (
              <View key={i} style={styles.li}>
                <Text style={styles.bullet}>•</Text>
                <Text style={styles.liText}>{t}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Data & legal */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Data & legal</Text>

          <TouchableOpacity style={styles.rowLink} onPress={() => openURL(PRIVACY_URL)} activeOpacity={0.9}>
            <Text style={styles.linkText}>Privacy Policy</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.rowLink} onPress={() => openURL(TERMS_URL)} activeOpacity={0.9}>
            <Text style={styles.linkText}>Terms of Use</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.rowLink}
            onPress={() => openMail('Request: Delete my data', 'Please delete my account and associated personal data.')}
            activeOpacity={0.9}
          >
            <Text style={styles.linkText}>Request data deletion</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.rowLink}
            onPress={() => openMail('Request: Export my data', 'Please send me a copy of my data.')}
            activeOpacity={0.9}
          >
            <Text style={styles.linkText}>Request data export</Text>
          </TouchableOpacity>
        </View>

        {/* About / build info */}
        <View style={styles.metaCard}>
          <Text style={styles.metaText}>
            {Constants.expoConfig?.name || 'TradeMate Quotes'} • v{Constants.expoConfig?.version || Constants.manifest?.version || '0.0.0'}
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
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
  body: { color: MUTED, marginBottom: 8 },

  primaryBtn: {
    backgroundColor: BRAND,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  primaryBtnText: { color: '#fff', fontWeight: '800' },

  rowBtn: {
    marginTop: 10,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: '#eef2f7',
    borderWidth: 1,
    borderColor: BORDER,
  },
  rowBtnText: { color: TEXT, fontWeight: '800' },

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

  list: { marginTop: 2 },
  li: { flexDirection: 'row', alignItems: 'flex-start', marginVertical: 2 },
  bullet: { color: MUTED, width: 16, textAlign: 'center' },
  liText: { color: TEXT, flex: 1 },

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