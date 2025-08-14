// app/(auth)/login.js
import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '../../lib/supabase';

export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    try {
      setLoading(true);
      console.log('[TMQ][LOGIN] Attempt', email);
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      const user = data.user;
      console.log('[TMQ][LOGIN] Success', user?.id);

      // fetch profile to decide where to go
      const { data: profile, error: pErr } = await supabase
        .from('profiles')
        .select('business_name, hourly_rate, materials_markup_pct')
        .eq('id', user.id)
        .maybeSingle();

      if (pErr) throw pErr;
      console.log('[TMQ][LOGIN] Profile', profile);

      const needsOnboarding = !profile || !profile.business_name || profile.hourly_rate === null;
      if (needsOnboarding) {
        router.replace('/(app)/onboarding');
      } else {
        router.replace('/(app)/quotes/list');
      }
    } catch (e) {
      console.error('[TMQ][LOGIN] Error', e);
      Alert.alert('Login failed', e.message ?? 'Please check your credentials.');
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async () => {
    try {
      setLoading(true);
      console.log('[TMQ][REGISTER] Attempt', email);
      const { data, error } = await supabase.auth.signUp({ email, password });
      if (error) throw error;
      Alert.alert('Check your email', 'We sent you a confirmation link. After confirming, come back and sign in.');
    } catch (e) {
      console.error('[TMQ][REGISTER] Error', e);
      Alert.alert('Register failed', e.message ?? 'Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>TradeMate Quotes</Text>
      <Text style={styles.subtitle}>Sign in to start creating quotes</Text>

      <TextInput
        placeholder="Email"
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
        style={styles.input}
      />
      <TextInput
        placeholder="Password"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
        style={styles.input}
      />

      <TouchableOpacity style={styles.button} onPress={handleLogin} disabled={loading}>
        {loading ? <ActivityIndicator /> : <Text style={styles.buttonText}>Sign In</Text>}
      </TouchableOpacity>

      <TouchableOpacity style={styles.link} onPress={handleRegister} disabled={loading}>
        <Text style={styles.linkText}>New here? Create account</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0b0b0c', padding: 20, justifyContent: 'center' },
  title: { color: 'white', fontSize: 28, fontWeight: '700', marginBottom: 8, textAlign: 'center' },
  subtitle: { color: '#c7c7c7', fontSize: 14, marginBottom: 24, textAlign: 'center' },
  input: { backgroundColor: '#1a1a1b', color: 'white', borderRadius: 12, padding: 14, marginBottom: 12 },
  button: { backgroundColor: '#2a86ff', borderRadius: 12, padding: 14, alignItems: 'center', marginTop: 4 },
  buttonText: { color: 'white', fontWeight: '700' },
  link: { marginTop: 14, alignItems: 'center' },
  linkText: { color: '#9db9ff' },
});