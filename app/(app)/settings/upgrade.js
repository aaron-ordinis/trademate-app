// app/(app)/settings/upgrade.js
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';

export default function Upgrade() {
  const router = useRouter();

  return (
    <ScrollView style={{ flex: 1, backgroundColor: '#0b0b0c' }} contentContainerStyle={{ padding: 20 }}>
      <Text style={styles.h1}>Go Premium</Text>
      <Text style={styles.p}>
        Unlock editing quotes, duplicating quotes, custom logos (no footer), and more.
      </Text>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Premium features</Text>
         <Text style={styles.li}>• Unlimited Quotes</Text>
        <Text style={styles.li}>• Edit prices & line items</Text>
        <Text style={styles.li}>• Duplicate quotes</Text>
        <Text style={styles.li}>• Remove “powered by” footer</Text>
        <Text style={styles.li}>• Custom logo on PDFs</Text>
      </View>

      <TouchableOpacity style={[styles.btn, { backgroundColor: '#3ecf8e' }]} onPress={() => {/* TODO: start checkout */}}>
        <Text style={[styles.btnText, { color: '#0b0b0c' }]}>Upgrade now</Text>
      </TouchableOpacity>

      <TouchableOpacity style={[styles.btn, { backgroundColor: '#1f1f21', borderWidth: 1, borderColor: '#34353a' }]} onPress={() => router.back()}>
        <Text style={styles.btnText}>Back</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  h1: { color: 'white', fontSize: 24, fontWeight: '800', marginBottom: 10 },
  p: { color: '#cfcfd2', marginBottom: 16 },
  card: { backgroundColor: '#1a1a1b', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: '#2b2c2f', marginBottom: 16 },
  cardTitle: { color: 'white', fontSize: 16, fontWeight: '800', marginBottom: 8 },
  li: { color: '#d1d1d4', marginBottom: 6 },
  btn: { borderRadius: 12, padding: 14, alignItems: 'center', marginBottom: 10 },
  btnText: { color: 'white', fontWeight: '800' },
});