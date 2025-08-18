// app/(app)/about/index.js
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Linking, Alert } from 'react-native';
import Constants from 'expo-constants';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

const LINKS = {
  website: 'https://example.com',         // <- replace
  privacy: 'https://example.com/privacy', // <- replace
  terms: 'https://example.com/terms',     // <- replace
};

export default function AboutScreen() {
  const insets = useSafeAreaInsets();

  const appName = Constants.expoConfig?.name || 'TradeMate Quotes';
  const version = Constants.expoConfig?.version || Constants.manifest?.version || '0.0.0';
  const build = Constants.nativeBuildVersion || '-';

  const open = async (url) => {
    try { await Linking.openURL(url); }
    catch { Alert.alert('Error', 'Could not open link.'); }
  };

  return (
    <SafeAreaView
      edges={['top', 'left', 'right', 'bottom']}
      style={{ flex: 1, backgroundColor: '#0b0b0c' }}
    >
      <View style={[styles.wrap, { paddingBottom: Math.max(insets.bottom, 16) }]}>
        <Text style={styles.h1}>About</Text>

        <View style={styles.card}>
          <Text style={styles.app}>{appName}</Text>
          <Text style={styles.meta}>Version {version} (build {build})</Text>
        </View>

        <View style={styles.card}>
          <TouchableOpacity style={styles.rowBtn} onPress={() => open(LINKS.website)}>
            <Text style={styles.rowText}>Website</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.rowBtn} onPress={() => open(LINKS.privacy)}>
            <Text style={styles.rowText}>Privacy Policy</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.rowBtn} onPress={() => open(LINKS.terms)}>
            <Text style={styles.rowText}>Terms of Service</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.footer}>© {new Date().getFullYear()} {appName}</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#0b0b0c', padding: 16 },
  h1: { color: 'white', fontSize: 22, fontWeight: '800', marginBottom: 12 },
  card: { backgroundColor: '#17171a', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: '#2b2c2f', marginBottom: 14 },
  app: { color: 'white', fontSize: 18, fontWeight: '800' },
  meta: { color: '#9aa0a6', marginTop: 6 },
  rowBtn: { backgroundColor: '#1a1a1d', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#2b2c2f', marginVertical: 6 },
  rowText: { color: 'white', fontWeight: '700' },
  footer: { color: '#6f7076', textAlign: 'center', marginTop: 8 },
});