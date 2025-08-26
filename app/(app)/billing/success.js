import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { supabase } from '../../../lib/supabase';

const BRAND = '#2a86ff';
const TEXT = '#0b1220';
const MUTED = '#6b7280';
const CARD = '#ffffff';
const BG = '#f5f7fb';
const BORDER = '#e6e9ee';

export default function BillingSuccess() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [branding, setBranding] = useState('');
  const [bizName, setBizName] = useState('');
  const [logoUrl, setLogoUrl] = useState(null);
  const [tries, setTries] = useState(0);
  const timerRef = useRef(null);

  const isPremiumLike = useMemo(() => {
    const b = (branding || '').toString().toLowerCase();
    return b === 'premium' || b === 'trialing' || b === 'past_due';
  }, [branding]);

  const initials = useMemo(() => {
    const src = (bizName || '').trim();
    if (!src) return 'TM';
    const parts = src.replace(/[^a-zA-Z ]/g, ' ').split(/\s+/).slice(0, 2);
    return parts.map(p => p.charAt(0).toUpperCase()).join('') || 'TM';
  }, [bizName]);

  async function fetchProfileOnce() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    const { data, error } = await supabase
      .from('profiles')
      .select('branding, business_name, custom_logo_url')
      .eq('id', user.id)
      .maybeSingle();

    if (error) return null;

    if (data) {
      setBranding(data.branding || '');
      setBizName(data.business_name || '');
      setLogoUrl(data.custom_logo_url || null);
    }
    return data;
  }

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        await fetchProfileOnce();
      } catch {}
      setLoading(false);

      timerRef.current = setInterval(async () => {
        if (cancelled) return;
        setTries(t => t + 1);

        try {
          await fetchProfileOnce();
        } catch {}

        if (isPremiumLike) {
          clearInterval(timerRef.current);
          timerRef.current = null;
          router.replace('/(app)/settings');
        } else if (tries >= 12) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
      }, 1500);
    })();

    return () => {
      cancelled = true;
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isPremiumLike, router]);

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

        <Text style={styles.title}>Payment successful 🎉</Text>
        <Text style={styles.msg}>
          {isPremiumLike
            ? 'Your plan is active. Taking you to Settings…'
            : 'We’re updating your account. This usually takes a few seconds.'}
        </Text>

        <View style={{ height: 14 }} />
        {loading ? (
          <ActivityIndicator color={BRAND} />
        ) : (
          <>
            {!isPremiumLike && <ActivityIndicator color={BRAND} />}
            <View style={{ height: 10 }} />
            <TouchableOpacity
              onPress={() => router.replace('/(app)/settings')}
              style={styles.btn}
              activeOpacity={0.92}
            >
              <Text style={styles.btnText}>
                {isPremiumLike ? 'Go to Settings' : 'Go to Settings anyway'}
              </Text>
            </TouchableOpacity>
          </>
        )}

        <Text style={styles.hint}>You can manage your subscription any time in Plan & Billing.</Text>
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