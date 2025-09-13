import { loginHref } from "../../lib/nav";
// app/(auth)/reset.js
import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import { supabase } from '../../lib/supabase';

export default function ResetPassword() {
  const router = useRouter();

  const [ready, setReady] = useState(false);         // becomes true after we process the deep link
  const [processing, setProcessing] = useState(false);
  const [pw1, setPw1] = useState('');
  const [pw2, setPw2] = useState('');

  // ---- Deep link parser that supports both hash (#) and query (?code=) flows
  const handleUrl = useCallback(async (url) => {
    if (!url) return;

    try {
      // Example incoming:
      // tradematequotes://reset#access_token=...&refresh_token=...&type=recovery
      // tradematequotes://reset?code=...&type=recovery
      const parsed = Linking.parse(url);
      // parsed.fragment is the stuff after "#", parsed.queryParams are after "?"
      const hash = parsed?.fragment || '';
      const query = parsed?.queryParams || {};

      // 1) Hash tokens?
      if (hash && hash.includes('access_token')) {
        const params = new URLSearchParams(hash);
        const access_token = params.get('access_token');
        const refresh_token = params.get('refresh_token');

        if (access_token && refresh_token) {
          // Set the session locally so we can call updateUser afterwards
          const { error } = await supabase.auth.setSession({ access_token, refresh_token });
          if (error) throw error;
          setReady(true);
          return;
        }
      }

      // 2) PKCE code flow?
      const code = query?.code || null;
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) throw error;
        setReady(true);
        return;
      }

      // If neither form is present, not a valid reset redirect
      setReady(false);
    } catch (e) {
      console.error('[TMQ][RESET] parse error', e);
      setReady(false);
      Alert.alert('Link error', e?.message ?? 'Could not read the reset link.');
    }
  }, []);

  // Listen for deep links (app open & background)
  useEffect(() => {
    // Cold start
    Linking.getInitialURL().then((url) => handleUrl(url)).catch(() => {});
    // Foreground events
    const sub = Linking.addEventListener('url', ({ url }) => handleUrl(url));
    return () => sub.remove();
  }, [handleUrl]);

  const doUpdate = async () => {
    if (!ready) {
      Alert.alert('Not ready', 'Open this page using the password reset email link.');
      return;
    }
    if (!pw1.trim() || pw1 !== pw2) {
      Alert.alert('Check passwords', 'Passwords are empty or do not match.');
      return;
    }
    try {
      setProcessing(true);
      const { error } = await supabase.auth.updateUser({ password: pw1.trim() });
      if (error) throw error;
      Alert.alert('Updated', 'Password changed. Please sign in.');
  router.replace(loginHref);
    } catch (e) {
      console.error('[TMQ][RESET] update error', e);
      Alert.alert('Update failed', e?.message ?? 'Please try again.');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Reset your password</Text>
      <Text style={styles.subtitle}>
        {ready ? 'Enter a new password.' : 'Open this screen using the link we emailed to you.'}
      </Text>

      {!ready && (
        <Text style={{ color: '#ffa94d', marginTop: 6, marginBottom: 10 }}>
          Waiting for a valid reset link…
        </Text>
      )}

      <TextInput
        placeholder="New password"
        placeholderTextColor="#8d8f95"
        secureTextEntry
        value={pw1}
        onChangeText={setPw1}
        style={styles.input}
        editable={ready && !processing}
      />
      <TextInput
        placeholder="Confirm new password"
        placeholderTextColor="#8d8f95"
        secureTextEntry
        value={pw2}
        onChangeText={setPw2}
        style={styles.input}
        editable={ready && !processing}
      />

      <TouchableOpacity
        style={[styles.button, { opacity: !ready || processing ? 0.7 : 1 }]}
        onPress={doUpdate}
        disabled={!ready || processing}
      >
        {processing ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Update password</Text>}
      </TouchableOpacity>

  <TouchableOpacity style={{ marginTop: 16 }} onPress={() => router.replace(loginHref)}>
        <Text style={styles.linkText}>Back to Sign In</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0b0b0c', padding: 20, justifyContent: 'center' },
  title: { color: 'white', fontSize: 28, fontWeight: '800', marginBottom: 8, textAlign: 'center' },
  subtitle: { color: '#c7c7c7', fontSize: 14, marginBottom: 16, textAlign: 'center' },
  input: {
    backgroundColor: '#1a1a1b', color: 'white', borderRadius: 12,
    padding: 14, marginBottom: 12, borderWidth: 1, borderColor: '#2b2c2f'
  },
  button: { backgroundColor: '#2a86ff', borderRadius: 12, padding: 14, alignItems: 'center', marginTop: 4 },
  buttonText: { color: 'white', fontWeight: '700' },
  linkText: { color: '#9db9ff', fontWeight: '700', textAlign: 'center' },
});