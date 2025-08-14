// app/(app)/settings.js
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

export default function Settings() {
  console.log('[TMQ][SETTINGS] mounted');
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Settings</Text>
      <Text style={styles.text}>Branding & subscription will live here.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0b0b0c', padding: 16 },
  title: { color: 'white', fontSize: 24, fontWeight: '700' },
  text: { color: '#c7c7c7', marginTop: 10 },
});