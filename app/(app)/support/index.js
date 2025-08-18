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

const SUPPORT_EMAIL = 'support@tradematequotes.app'; // <-- set your real inbox

export default function SupportScreen() {
  const insets = useSafeAreaInsets();

  const openMail = (subject, body = '') => {
    const app = Constants.expoConfig?.name || 'TradeMate Quotes';
    const v = Constants.expoConfig?.version || Constants.manifest?.version || '0.0.0';
    const sys = `${Platform.OS} ${Platform.Version}`;
    const pre = `${body}\n\n---\nApp: ${app}\nVersion: ${v}\nOS: ${sys}\nDevice: ${Constants.deviceName || 'Unknown'}\nBuild: ${Constants.nativeBuildVersion || '-'}`;
    const url = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(pre)}`;
    Linking.openURL(url).catch(() => Alert.alert('Error', 'Could not open your mail app.'));
  };

  return (
    <SafeAreaView edges={['top', 'left', 'right', 'bottom']} style={styles.wrap}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: Math.max(insets.bottom, 24) }}>
        <Text style={styles.h1}>Help & Support</Text>

        <View style={styles.card}>
          <Text style={styles.text}>
            Stuck or spotted a bug? Get in touch and we’ll help you out.
          </Text>

          <TouchableOpacity
            style={[styles.btn, styles.btnPrimary]}
            onPress={() => openMail('Support request')}
          >
            <Text style={[styles.btnText, { color: '#0b0b0c' }]}>Contact support</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.btn, styles.btnDark]}
            onPress={() => openMail('Bug report', 'Describe the issue here…')}
          >
            <Text style={styles.btnText}>Report a bug</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.btn, styles.btnDark]}
            onPress={() => Alert.alert('FAQs', 'Coming soon!')}
          >
            <Text style={styles.btnText}>View FAQs</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.card}>
          <Text style={[styles.text, { opacity: 0.8 }]}>
            We usually reply within 1 business day.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#0b0b0c' },
  h1: { color: 'white', fontSize: 22, fontWeight: '800', marginBottom: 12 },
  card: {
    backgroundColor: '#17171a',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#2b2c2f',
    marginBottom: 14,
  },
  text: { color: '#cfcfd2' },
  btn: {
    marginTop: 10,
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
    borderWidth: 1,
  },
  btnPrimary: { backgroundColor: '#3ecf8e', borderColor: '#3ecf8e' },
  btnDark: { backgroundColor: '#1f1f21', borderColor: '#34353a' },
  btnText: { color: 'white', fontWeight: '800' },
});