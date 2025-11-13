import React, { useEffect } from 'react';
import { View, Text, StatusBar, Platform, StyleSheet } from 'react-native';

const BRAND = '#2a86ff';
const TEXT = '#0b1220';
const BG = '#ffffff';

export default function SplashScreen({ onComplete }) {
  useEffect(() => {
    // set status bar appropriately
    StatusBar.setBarStyle('dark-content');
    if (Platform.OS === 'android') {
      try { StatusBar.setBackgroundColor(BG, true); } catch {}
    }

    // Immediately signal completion (short tick so UI can render)
    const t = setTimeout(() => onComplete?.(), 50);
    return () => clearTimeout(t);
  }, [onComplete]);

  return (
    <View style={styles.container}>
      <StatusBar backgroundColor={BG} barStyle="dark-content" translucent={false} />
      <View style={styles.content}>
        <Text style={styles.title}>TradeMate</Text>
        <Text style={styles.subtitle}>Professional Trade Quotes</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BG,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    alignItems: 'center',
  },
  title: {
    fontSize: 32,
    fontWeight: '900',
    color: TEXT,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    fontWeight: '600',
    color: BRAND,
  },
});
