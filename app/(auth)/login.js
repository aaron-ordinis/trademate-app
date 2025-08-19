// app/(auth)/login.js
import React, { useRef, useState } from 'react';
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
import { supabase } from '../../lib/supabase';

const BRAND = '#2a86ff';
const TEXT = '#0b1220';
const SUBTLE = '#6b7280';
const SURFACE = '#f6f7f9';
const BORDER = '#e6e9ee';

export default function Login() {
  const router = useRouter();
  const pwRef = useRef(null);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [authError, setAuthError] = useState('');

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

      const { data, error } = await supabase.auth.signInWithPassword({
        email: e,
        password,
      });
      if (error) throw error;

      const user = data.user;
      const { data: profile, error: pErr } = await supabase
        .from('profiles')
        .select('business_name, hourly_rate, materials_markup_pct')
        .eq('id', user.id)
        .maybeSingle();
      if (pErr) throw pErr;

      const needsOnboarding =
        !profile || !profile.business_name || profile.hourly_rate == null;

      router.replace(needsOnboarding ? '/(app)/onboarding' : '/(app)/quotes/list');
    } catch (e) {
      const nice = mapSupabaseError(e);
      setAuthError(nice);
      Alert.alert('Login failed', nice);
      console.error('[TMQ][LOGIN] Error', e);
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
        redirectTo: 'tradematequotes://reset', // deep link to your reset screen
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
        <Text style={styles.title}>TradeMate Quotes</Text>
        <Text style={styles.subtitle}>Sign in to start creating quotes</Text>

        {!!authError && <Text style={styles.errorText}>{authError}</Text>}

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

        <View>
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
            style={styles.input}
            returnKeyType="go"
            onSubmitEditing={handleLogin}
            editable={!loading}
          />
          <TouchableOpacity
            onPress={() => !loading && setShowPw((s) => !s)}
            style={styles.showBtn}
            disabled={loading}
          >
            <Text style={styles.showBtnText}>{showPw ? 'Hide' : 'Show'}</Text>
          </TouchableOpacity>
        </View>

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
          <Link href="/(auth)/register" style={styles.linkText}>
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
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    // subtle elevation
    shadowColor: '#0b1220',
    shadowOpacity: 0.06,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 3,
  },
  logo: {
    width: 112,
    height: 112,
    marginBottom: 12,
  },
  title: {
    color: TEXT,
    fontSize: 24,
    fontWeight: '800',
    marginBottom: 4,
    textAlign: 'center',
  },
  subtitle: {
    color: SUBTLE,
    fontSize: 14,
    marginBottom: 16,
    textAlign: 'center',
  },
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
  input: {
    width: '100%',
    backgroundColor: SURFACE,
    color: TEXT,
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: BORDER,
  },
  showBtn: {
    position: 'absolute',
    right: 12,
    top: 12,
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  showBtnText: {
    color: BRAND,
    fontWeight: '700',
  },
  primaryBtn: {
    width: '100%',
    backgroundColor: BRAND,
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
    marginTop: 6,
  },
  primaryBtnText: {
    color: '#ffffff',
    fontWeight: '800',
  },
  linkBtn: { marginTop: 12 },
  linkText: { color: BRAND, fontWeight: '700' },
  footerText: { color: SUBTLE, marginTop: 16, textAlign: 'center' },
});