// app/(app)/billing/cancel.js
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { supabase } from '../../../lib/supabase';

const BRAND = '#2a86ff';
const TEXT = '#0b1220';
const MUTED = '#6b7280';
const CARD = '#ffffff';
const BG = '#f5f7fb';
const BORDER = '#e6e9ee';

export default function BillingCancel() {
  const router = useRouter();
  const [bizName, setBizName] = useState('');
  const [logoUrl, setLogoUrl] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const { data } = await supabase
          .from('profiles')
          .select('business_name, custom_logo_url')
          .eq('id', user.id)
          .maybeSingle();

        setBizName((data?.business_name || '').toString());
        setLogoUrl(data?.custom_logo_url || null);
      } catch {
        // no-op
      }
    })();
  }, []);

  const initials = useMemo(() => {
    const src = (bizName || '').toString().trim();
    if (!src) return 'TM';
    const parts = src.replace(/[^a-zA-Z ]/g, ' ').split(/\s+/).slice(0, 2);
    return parts.map(p => p.charAt(0).toUpperCase()).join('') || 'TM';
  }, [bizName]);

  return (
    <SafeAreaView edges={['top', 'left', 'right', 'bottom']} style={styles.wrap}>
      <View style={styles.card}>
        <View style={styles.logoWrap}>
          {logoUrl ? (
            <Image source={{ uri: logoUrl }} style={styles.logoImg} resizeMode="contain" />
          ) : (
            <View style={styles.fallbackLogo}>
              <Text style={styles.fallbackLogoText}>{initials}</Text>
            </View>
          )}
        </View>

        <Text style={styles.title}>Checkout canceled</Text>
        <Text style={styles.msg}>
          No charges were made. You can try again at any time.
        </Text>

        <TouchableOpacity
          onPress={() => router.replace('/(app)/settings')}
          style={styles.btn}
          activeOpacity={0.92}
        >
          <Text style={styles.btnText}>Back to Settings</Text>
        </TouchableOpacity>

        <Text style={styles.hint}>
          Manage plan & billing from Settings whenever you’re ready.
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: BG, padding: 16, justifyContent: 'center' },
  card: {
    backgroundColor: CARD,
    borderRadius: 16,
    paddingVertical: 22,
    paddingHorizontal: 18,
    borderWidth: 1,
    borderColor: BORDER,
    alignSelf: 'center',
    width: '100%',
    maxWidth: 520,
    alignItems: 'center',
    shadowColor: '#0b1220',
    shadowOpacity: 0.05,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 2,
  },

  logoWrap: { marginBottom: 10, alignItems: 'center', justifyContent: 'center' },
  logoImg: { width: 88, height: 40 },
  fallbackLogo: {
    width: 64,
    height: 64,
    borderRadius: 16,
    backgroundColor: BRAND + '12',
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fallbackLogoText: { color: BRAND, fontWeight: '900', fontSize: 18 },

  title: { color: TEXT, fontSize: 20, fontWeight: '800', marginTop: 2, textAlign: 'center' },
  msg: { color: MUTED, marginTop: 6, textAlign: 'center' },

  btn: { marginTop: 14, backgroundColor: BRAND, borderRadius: 12, padding: 12, alignItems: 'center', minWidth: 220 },
  btnText: { color: '#fff', fontWeight: '800' },

  hint: { color: MUTED, marginTop: 12, fontSize: 12, textAlign: 'center' },
});