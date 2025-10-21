import { loginHref } from "../../lib/nav";
// app/(auth)/reset.js
import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ActivityIndicator, Image, StatusBar } from 'react-native';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import { supabase } from '../../lib/supabase';

// --- Brand tokens (copied from login.js) ---
const BRAND = "#2a86ff";
const TEXT = "#0b1220";
const SUBTLE = "#6b7280";
const SURFACE = "#f6f7f9";
const BORDER = "#e6e9ee";
const OK = "#16a34a";
const DANGER = "#b3261e";

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
    <View style={styles.screen}>
      <StatusBar barStyle="dark-content" />
      <View style={styles.card}>
        <Image
          source={require("../../assets/images/trademate-login-logo.png")}
          style={styles.logo}
          resizeMode="contain"
        />
        <Text style={styles.title}>Reset your password</Text>
        <Text style={styles.subtitle}>
          {ready ? 'Enter a new password.' : 'Open this screen using the link we emailed to you.'}
        </Text>

        {!ready && (
          <>
            <Text style={styles.waitingText}>
              Waiting for a valid reset link…
            </Text>
            <TouchableOpacity
              style={styles.testBtn}
              onPress={() => setReady(true)}
            >
              <Text style={styles.testBtnText}>Test reset (dev only)</Text>
            </TouchableOpacity>
          </>
        )}

        <TextInput
          placeholder="New password"
          placeholderTextColor={SUBTLE}
          secureTextEntry
          value={pw1}
          onChangeText={setPw1}
          style={styles.input}
          editable={ready && !processing}
        />
        <TextInput
          placeholder="Confirm new password"
          placeholderTextColor={SUBTLE}
          secureTextEntry
          value={pw2}
          onChangeText={setPw2}
          style={styles.input}
          editable={ready && !processing}
        />

        <TouchableOpacity
          style={[styles.primaryBtn, (!ready || processing) && { opacity: 0.7 }]}
          onPress={doUpdate}
          disabled={!ready || processing}
        >
          {processing ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Update password</Text>}
        </TouchableOpacity>

        <TouchableOpacity style={{ marginTop: 16 }} onPress={() => router.replace(loginHref)}>
          <Text style={styles.linkText}>Back to Sign In</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Match login.js layout
  screen: { flex: 1, backgroundColor: "#ffffff", paddingHorizontal: 20, justifyContent: "center" },
  card: { backgroundColor: "#ffffff", borderRadius: 18, padding: 22, alignItems: "center", elevation: 4 },
  logo: { width: 156, height: 156, marginBottom: 14 },
  title: { color: TEXT, fontSize: 26, fontWeight: "800", marginBottom: 6, textAlign: "center" },
  subtitle: { color: SUBTLE, fontSize: 14, marginBottom: 12, textAlign: "center" },
  waitingText: { color: "#ffa94d", marginTop: 6, marginBottom: 10, textAlign: "center" },

  input: {
    width: "100%",
    backgroundColor: SURFACE,
    color: TEXT,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: BORDER,
    fontSize: 16,
    marginBottom: 12,
  },
  primaryBtn: { width: "100%", backgroundColor: BRAND, borderRadius: 12, padding: 14, alignItems: "center", marginTop: 4 },
  primaryBtnText: { color: "#fff", fontWeight: "800", fontSize: 16 },
  linkText: { color: BRAND, fontWeight: "700", textAlign: "center" },
  testBtn: {
    marginTop: 8,
    backgroundColor: "#e0e7ff",
    borderRadius: 8,
    padding: 8,
    alignItems: "center",
  },
  testBtnText: {
    color: BRAND,
    fontWeight: "700",
    fontSize: 14,
  },
});