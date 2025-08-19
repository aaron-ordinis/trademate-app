// app/(auth)/register.js
import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  Alert, ActivityIndicator
} from 'react-native';
import { useRouter, Link } from 'expo-router';
import { supabase } from '../../lib/supabase';

export default function Register() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPw, setShowPw] = useState(false);

  const validate = () => {
    if (!email.trim() || !password.trim() || !confirm.trim()) {
      Alert.alert('Missing info', 'Please fill in all fields.');
      return false;
    }
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      Alert.alert('Invalid email', 'Please enter a valid email address.');
      return false;
    }
    if (password !== confirm) {
      Alert.alert('Passwords do not match', 'Please re-enter your password.');
      return false;
    }
    if (password.length < 6) {
      Alert.alert('Weak password', 'Use at least 6 characters.');
      return false;
    }
    return true;
  };

  const handleRegister = async () => {
    if (!validate()) return;
    try {
      setLoading(true);

      // IMPORTANT: add redirect so reset links & email confirmation open your app
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          emailRedirectTo: 'tradematequotes://(auth)/login',
          // You can add user_metadata here if you want:
          // data: { onboarded: false }
        }
      });
      if (error) throw error;

      // If your project DISABLES email confirmations, user will exist immediately.
      if (data.user) {
        // Optionally create a starter profile
        try {
          await supabase.from('profiles').upsert({
            id: data.user.id,
            business_name: null,
            hourly_rate: null,
            materials_markup_pct: null,
          }, { onConflict: 'id' });
        } catch {}
        Alert.alert('Account created', 'You can sign in now.');
        router.replace('/(auth)/login');
        return;
      }

      // If confirmations are ENABLED, prompt user to check email.
      Alert.alert('Check your email', 'We sent you a confirmation link. After confirming, open the app and sign in.');
    } catch (e) {
      console.error('[TMQ][REGISTER] Error', e);
      Alert.alert('Register failed', e?.message ?? 'Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Create your account</Text>
      <Text style={styles.subtitle}>Start sending quotes in minutes</Text>

      <TextInput
        placeholder="Email"
        placeholderTextColor="#8d8f95"
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
        style={styles.input}
      />

      <TextInput
        placeholder="Password"
        placeholderTextColor="#8d8f95"
        secureTextEntry={!showPw}
        value={password}
        onChangeText={setPassword}
        style={styles.input}
      />
      <TextInput
        placeholder="Confirm password"
        placeholderTextColor="#8d8f95"
        secureTextEntry={!showPw}
        value={confirm}
        onChangeText={setConfirm}
        style={styles.input}
      />
      <TouchableOpacity onPress={() => setShowPw(s => !s)} style={styles.toggle}>
        <Text style={styles.toggleText}>{showPw ? 'Hide' : 'Show'} passwords</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.button, { opacity: loading ? 0.7 : 1 }]}
        onPress={handleRegister}
        disabled={loading}
      >
        {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Create account</Text>}
      </TouchableOpacity>

      <Text style={styles.small}>
        Already have an account?{' '}
        <Link href="/(auth)/login" style={styles.linkText}>
          Sign in
        </Link>
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0b0b0c', padding: 20, justifyContent: 'center' },
  title: { color: 'white', fontSize: 26, fontWeight: '700', marginBottom: 8, textAlign: 'center' },
  subtitle: { color: '#c7c7c7', fontSize: 14, marginBottom: 24, textAlign: 'center' },
  input: {
    backgroundColor: '#1a1a1b', color: 'white', borderRadius: 12,
    padding: 14, marginBottom: 12, borderWidth: 1, borderColor: '#2b2c2f'
  },
  toggle: { alignSelf: 'flex-end', marginBottom: 8 },
  toggleText: { color: '#a9a9ac', fontSize: 12 },
  button: { backgroundColor: '#3ecf8e', borderRadius: 12, padding: 14, alignItems: 'center', marginTop: 4 },
  buttonText: { color: '#0b0b0c', fontWeight: '800' },
  linkText: { color: '#9db9ff', fontWeight: '700' },
  small: { color: '#a9a9ac', marginTop: 16, textAlign: 'center' },
});