import { useEffect } from 'react';
import { View, ActivityIndicator, Text, StyleSheet } from 'react-native';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import { supabase } from '../../lib/supabase';

export default function AuthReturn() {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        // get the deep link URL that opened the app
        const url = await Linking.getInitialURL();
        console.log('[AUTH RETURN] initial URL =', url);

        if (!url) throw new Error('No URL returned from Linking.getInitialURL');

        // exchange OAuth code for Supabase session
        const { data, error } = await supabase.auth.exchangeCodeForSession(url);
        console.log('[AUTH RETURN] exchange result', data?.session ? '✅ success' : '❌ failed', error?.message);

        if (error) throw error;
        if (cancelled) return;

        // redirect to your main app area
        router.replace('/(app)/onboarding');
      } catch (e) {
        console.error('[AUTH RETURN] Error:', e?.message);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <View style={styles.wrap}>
      <ActivityIndicator size="large" />
      <Text style={styles.text}>Finishing sign-in...</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#fff' },
  text: { marginTop: 12, fontSize: 16, textAlign: 'center' },
});