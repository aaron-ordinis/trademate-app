import { onboardingHref, signupHref } from "../../lib/nav";
/* app/(auth)/login.js */
import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  Image,
  StatusBar,
} from 'react-native';
import { useRouter, Link } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Eye, EyeOff } from 'lucide-react-native';
import { supabase } from '../../lib/supabase';

const BRAND = '#2a86ff';
const TEXT = '#0b1220';
const SUBTLE = '#6b7280';
const SURFACE = '#f6f7f9';
const BORDER = '#e6e9ee';

const STORAGE_KEYS = {
  rememberMe: 'tmq.rememberMe',
  rememberedEmail: 'tmq.rememberedEmail',
};

export default function Login() {
  const router = useRouter();
  const pwRef = useRef(null);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [authError, setAuthError] = useState('');
  const [rememberMe, setRememberMe] = useState(true);

  // --- Prefill remembered email
  useEffect(() => {
    (async () => {
      try {
        const [rm, em] = await Promise.all([
          AsyncStorage.getItem(STORAGE_KEYS.rememberMe),
          AsyncStorage.getItem(STORAGE_KEYS.rememberedEmail),
        ]);
        if (rm != null) setRememberMe(rm === '1');
        if (em && (rm === '1' || rm === null)) setEmail(em);
      } catch {}
    })();
  }, []);

  const normEmail = () => email.trim().toLowerCase();

  const validate = () => {
    setAuthError('');
    const e = normEmail();
    if (!e || !password.trim()) {
      setAuthError('Please enter both email and password.');
      return false;
    }
    if (!/^\S+@\S+\.\S+$/.test(e)) {
      setAuthError('Please enter a valid email address.');
      return false;
    }
    return true;
  };

  const mapSupabaseError = (err) => {
    const msg = String(err?.message || '').toLowerCase();
    const code = String(err?.code || '').toLowerCase();
    if (code === 'invalid_credentials' || msg.includes('invalid login credentials')) {
      return 'Email or password is incorrect.';
    }
    if (msg.includes('email not confirmed')) {
      return 'Please confirm your email before signing in.';
    }
    return err?.message || 'Something went wrong. Please try again.';
  };

  const handleLogin = async () => {
    if (loading) return;
    if (!validate()) return;

    try {
      setLoading(true);
      const e = normEmail();

      // persist preferences immediately
      await Promise.all([
        AsyncStorage.setItem(STORAGE_KEYS.rememberMe, rememberMe ? '1' : '0'),
        rememberMe
          ? AsyncStorage.setItem(STORAGE_KEYS.rememberedEmail, e)
          : AsyncStorage.removeItem(STORAGE_KEYS.rememberedEmail),
      ]);

      const { data, error } = await supabase.auth.signInWithPassword({
        email: e,
        password,
      });
      if (error) throw error;

      // Navigate to onboarding route first - it will redirect if profile is complete
      router.replace('/(app)/onboarding');
    } catch (e) {
      const nice = mapSupabaseError(e);
      setAuthError(nice);
      Alert.alert('Login failed', nice);
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPw = async () => {
    if (loading) return;
    const e = normEmail();
    if (!e) {
      setAuthError('Enter your email above to receive a reset link.');
      return;
    }
    if (!/^\S+@\S+\.\S+$/.test(e)) {
      setAuthError('Please enter a valid email address.');
      return;
    }
    try {
      setLoading(true);
      setAuthError('');
      const { error } = await supabase.auth.resetPasswordForEmail(e, {
        redirectTo: 'tradematequotes://reset',
      });
      if (error) throw error;
      Alert.alert('Check your email', 'We sent a password reset link.');
    } catch (e) {
      const nice = mapSupabaseError(e);
      setAuthError(nice);
      Alert.alert('Reset failed', nice);
      console.error('[TMQ][RESET] Error', e);
    } finally {
      setLoading(false);
    }
  };

  const onSubmitEmail = () => pwRef.current?.focus?.();

  return (
    <View style={styles.screen}>
      <StatusBar barStyle="dark-content" />
      <View style={styles.card}>
        <Image
          source={require('../../assets/images/trademate-login-logo.png')}
          style={styles.logo}
          resizeMode="contain"
        />
        <Text style={styles.title}>TradeMate</Text>
        <Text style={styles.subtitle}>Sign in to start managing your trade business</Text>

        {!!authError && <Text style={styles.errorText}>{authError}</Text>}

        {/* Email */}
        <View style={styles.inputWrap}>
          <TextInput
            placeholder="Email"
            placeholderTextColor={SUBTLE}
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
            textContentType="username"
            value={email}
            onChangeText={(t) => {
              setEmail(t);
              if (authError) setAuthError('');
            }}
            style={styles.input}
            returnKeyType="next"
            onSubmitEditing={onSubmitEmail}
            editable={!loading}
          />
        </View>

        {/* Password + eye */}
        <View style={styles.inputWrap}>
          <TextInput
            ref={pwRef}
            placeholder="Password"
            placeholderTextColor={SUBTLE}
            secureTextEntry={!showPw}
            autoComplete="password"
            textContentType="password"
            value={password}
            onChangeText={(t) => {
              setPassword(t);
              if (authError) setAuthError('');
            }}
            style={[styles.input, styles.inputHasIcon]}
            returnKeyType="go"
            onSubmitEditing={handleLogin}
            editable={!loading}
          />
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={showPw ? 'Hide password' : 'Show password'}
            onPress={() => !loading && setShowPw((s) => !s)}
            style={styles.eyeBtn}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            disabled={loading}
          >
            {showPw ? (
              <Eye color="#9aa0a6" size={20} />
            ) : (
              <EyeOff color="#9aa0a6" size={20} />
            )}
          </TouchableOpacity>
        </View>

        {/* Remember me */}
        <View style={styles.checksRowSingle}>
          <TouchableOpacity
            onPress={() => setRememberMe((v) => !v)}
            style={styles.checkItem}
            activeOpacity={0.7}
          >
            <View style={[styles.checkbox, rememberMe && styles.checkboxOn]}>
              {rememberMe ? <Text style={styles.tick}>✓</Text> : null}
            </View>
            <Text style={styles.checkLabel}>Remember me</Text>
          </TouchableOpacity>
        </View>

        {/* Sign in */}
        <TouchableOpacity
          style={[styles.primaryBtn, loading && { opacity: 0.7 }]}
          onPress={handleLogin}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.primaryBtnText}>Sign In</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity style={styles.linkBtn} onPress={handleForgotPw} disabled={loading}>
          <Text style={styles.linkText}>Forgot password?</Text>
        </TouchableOpacity>

        <Text style={styles.footerText}>
          New here?{' '}
          <Link href={signupHref} style={styles.linkText}>
            Create account
          </Link>
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#ffffff',
    paddingHorizontal: 20,
    justifyContent: 'center',
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 18,
    padding: 22,
    alignItems: 'center',
    shadowColor: '#0b1220',
    shadowOpacity: 0.08,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 12 },
    elevation: 4,
  },
  logo: { width: 156, height: 156, marginBottom: 14 },
  title: { color: TEXT, fontSize: 26, fontWeight: '800', marginBottom: 6, textAlign: 'center' },
  subtitle: { color: SUBTLE, fontSize: 14, marginBottom: 18, textAlign: 'center' },
  errorText: {
    width: '100%',
    color: '#b3261e',
    backgroundColor: '#fdecec',
    borderColor: '#f7c8c8',
    borderWidth: 1,
    padding: 10,
    borderRadius: 10,
    marginBottom: 10,
  },

  inputWrap: { width: '100%', marginBottom: 12, position: 'relative' },
  input: {
    width: '100%',
    backgroundColor: SURFACE,
    color: TEXT,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: BORDER,
    fontSize: 16,
  },
  inputHasIcon: { paddingRight: 46 },

  eyeBtn: { position: 'absolute', right: 10, top: 0, bottom: 0, justifyContent: 'center' },

  // Single checkbox row (Remember me only)
  checksRowSingle: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'flex-start',
    marginTop: 2,
    marginBottom: 8,
  },
  checkItem: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: { borderColor: BRAND, backgroundColor: '#e9f2ff' },
  tick: { color: BRAND, fontWeight: '800', fontSize: 14, lineHeight: 14 },
  checkLabel: { color: SUBTLE, fontSize: 13 },

  primaryBtn: {
    width: '100%',
    backgroundColor: BRAND,
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
    marginTop: 10,
  },
  primaryBtnText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  linkBtn: { marginTop: 12 },
  linkText: { color: BRAND, fontWeight: '700' },
  footerText: { color: SUBTLE, marginTop: 16, textAlign: 'center' },
});