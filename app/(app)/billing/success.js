import React, { useEffect } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../../../lib/supabase';

export default function BillingSuccess() {
  const router = useRouter();

  useEffect(() => {
    // Refresh profile so the new plan shows immediately (webhook also updates it)
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          // simple no-op fetch to warm things up; your UI pages will refetch on focus anyway
          await supabase.from('profiles').select('branding, premium_since').eq('id', user.id).maybeSingle();
        }
      } catch {}
      // give a beat for UI, then return user
      setTimeout(() => router.replace('/(app)/account'), 900);
    })();
  }, [router]);

  return (
    <SafeAreaView edges={['top', 'left', 'right', 'bottom']} style={styles.wrap}>
      <View style={styles.card}>
        <Text style={styles.title}>Payment successful 🎉</Text>
        <Text style={styles.msg}>Updating your account…</Text>
        <ActivityIndicator color="#3ecf8e" style={{ marginTop: 12 }} />
        <TouchableOpacity onPress={() => router.replace('/(app)/account')} style={styles.btn}>
          <Text style={styles.btnText}>Continue</Text>
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
  btn: { marginTop: 14, backgroundColor: '#3ecf8e', borderRadius: 12, padding: 12, alignItems: 'center' },
  btnText: { color: '#0b0b0c', fontWeight: '800' },
});