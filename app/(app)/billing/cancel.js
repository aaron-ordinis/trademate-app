import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

export default function BillingCancel() {
  const router = useRouter();

  return (
    <SafeAreaView edges={['top', 'left', 'right', 'bottom']} style={styles.wrap}>
      <View style={styles.card}>
        <Text style={styles.title}>Checkout canceled</Text>
        <Text style={styles.msg}>No charges were made. You can try again at any time.</Text>
        <TouchableOpacity onPress={() => router.replace('/(app)/account')} style={styles.btn}>
          <Text style={styles.btnText}>Back to Plan & Billing</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#0b0b0c', padding: 16, justifyContent: 'center' },
  card: { backgroundColor: '#17171a', borderRadius: 16, padding: 20, borderWidth: 1, borderColor: '#2b2c2f' },
  title: { color: 'white', fontSize: 20, fontWeight: '800' },
  msg: { color: '#cfcfd2', marginTop: 6 },
  btn: { marginTop: 14, backgroundColor: '#2a86ff', borderRadius: 12, padding: 12, alignItems: 'center' },
  btnText: { color: 'white', fontWeight: '800' },
});