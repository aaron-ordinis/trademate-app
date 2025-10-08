/* app/(auth)/login.js */
import { onboardingHref, signupHref } from "../../lib/nav";
import React, { useRef, useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  Alert, ActivityIndicator, Image, StatusBar,
} from 'react-native';
import { useRouter, Link } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import * as AuthSession from 'expo-auth-session';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Eye, EyeOff } from 'lucide-react-native';
import { AntDesign, FontAwesome } from '@expo/vector-icons';
import { supabase } from '../../lib/supabase';

WebBrowser.maybeCompleteAuthSession();

const BRAND = '#2a86ff';
const TEXT = '#0b1220';
const SUBTLE = '#6b7280';
const SURFACE = '#f6f7f9';
const BORDER = '#e6e9ee';
const GOOGLE_BORDER = '#dadce0';
const GOOGLE_TEXT = '#3c4043';
const FB_BLUE = '#1877F2';

const STORAGE_KEYS = {
  rememberMe: 'tmq.rememberMe',
  rememberedEmail: 'tmq.rememberedEmail',
};

// 👉 Use Expo proxy to avoid PKCE state loss (works great in prod too)
const USE_EXPO_PROXY = true;

// Build redirect
const makeRedirectUri = () =>
  USE_EXPO_PROXY
    ? AuthSession.makeRedirectUri({ useProxy: true })
    : 'tradematequotes://auth';

export default function Login() {
  const router = useRouter();
  const pwRef = useRef(null);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [facebookLoading, setFacebookLoading] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [authError, setAuthError] = useState('');
  const [rememberMe, setRememberMe] = useState(true);

  const anySocialBusy = googleLoading || facebookLoading;
  const normEmail = () => email.trim().toLowerCase();

  const validate = () => {
    setAuthError('');
    const e = normEmail();
    if (!e || !password.trim()) { setAuthError('Please enter both email and password.'); return false; }
    if (!/^\S+@\S+\.\S+$/.test(e)) { setAuthError('Please enter a valid email address.'); return false; }
    return true;
  };

  const mapSupabaseError = (err) => {
    const msg = String(err?.message || '').toLowerCase();
    const code = String(err?.code || '').toLowerCase();
    if (code === 'invalid_credentials' || msg.includes('invalid login credentials')) return 'Email or password is incorrect.';
    if (msg.includes('email not confirmed')) return 'Please confirm your email before signing in.';
    return err?.message || 'Something went wrong. Please try again.';
  };

  // 🔄 OAuth redirect listener (works for proxy or direct links)
  useEffect(() => {
    const sub = AuthSession.addRedirectListener(async ({ url }) => {
      console.log('[OAUTH] Redirect listener fired url =', url?.slice(0, 200));
      try {
        const { data: exData, error: exErr } = await supabase.auth.exchangeCodeForSession(url);
        console.log('[OAUTH] exchange (listener) → session?', !!exData?.session, 'error?', exErr?.message);
        if (exErr) throw exErr;

        // Verify token persisted
        try {
          const token = await SecureStore.getItemAsync('supabase.auth.token');
          console.log('[DEBUG] Supabase token exists?', !!token, token ? '(length ' + token.length + ')' : '');
        } catch (e) {
          console.log('[DEBUG] SecureStore read failed:', e?.message);
        }

        router.replace('/(app)/onboarding');
      } catch (e) {
        console.log('[OAUTH] exchange (listener) failed:', e?.message);
        Alert.alert('Sign-in error', e?.message || 'Could not complete sign-in.');
      } finally {
        // no-op
      }
    });
    return () => { try { sub.remove(); } catch {} };
  }, [router]);

  const handleLogin = async () => {
    if (loading || anySocialBusy) return;
    if (!validate()) return;

    try {
      setLoading(true);
      const e = normEmail();

      await Promise.all([
        AsyncStorage.setItem(STORAGE_KEYS.rememberMe, rememberMe ? '1' : '0'),
        rememberMe
          ? AsyncStorage.setItem(STORAGE_KEYS.rememberedEmail, e)
          : AsyncStorage.removeItem(STORAGE_KEYS.rememberedEmail),
      ]);

      const { data, error } = await supabase.auth.signInWithPassword({ email: e, password });
      console.log('[LOGIN] signInWithPassword → session?', !!data?.session, 'error?', error?.message);
      if (error) throw error;

      router.replace('/(app)/onboarding');
    } catch (e) {
      const nice = mapSupabaseError(e);
      setAuthError(nice);
      Alert.alert('Login failed', nice);
      console.log('[LOGIN] Email/password login error:', e?.message);
    } finally { setLoading(false); }
  };

  const handleForgotPw = async () => {
    if (loading || anySocialBusy) return;
    const e = normEmail();
    if (!e) { setAuthError('Enter your email above to receive a reset link.'); return; }
    if (!/^\S+@\S+\.\S+$/.test(e)) { setAuthError('Please enter a valid email address.'); return; }

    try {
      setLoading(true);
      setAuthError('');
      const { error } = await supabase.auth.resetPasswordForEmail(e, { redirectTo: 'tradematequotes://reset' });
      if (error) throw error;
      Alert.alert('Check your email', 'We sent a password reset link.');
    } catch (e) {
      const nice = mapSupabaseError(e);
      setAuthError(nice);
      Alert.alert('Reset failed', nice);
      console.error('[TMQ][RESET] Error', e);
    } finally { setLoading(false); }
  };

  // ---- OAuth helpers (Google & Facebook) ----
  const makeRedirectUri = () => {
    const isDev = __DEV__ || process.env.NODE_ENV === 'development';
    const baseUri = AuthSession.makeRedirectUri({ 
      scheme: 'tradematequotes', 
      path: 'auth', 
      preferLocalhost: isDev 
    });
    
    console.log('[OAUTH] Environment:', isDev ? 'development' : 'production');
    console.log('[OAUTH] Redirect URI:', baseUri);
    
    return baseUri;
  };

  const openOAuth = async (provider, opts = {}) => {
    const redirectTo = makeRedirectUri();
    const isDev = __DEV__ || process.env.NODE_ENV === 'development';
    
    console.log('[OAUTH]', provider, 'Starting OAuth flow');
    console.log('[OAUTH]', provider, 'Environment:', isDev ? 'EAS Development' : 'Production');
    console.log('[OAUTH]', provider, 'Redirect URI:', redirectTo);

    try {
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider,
        options: { 
          redirectTo, 
          skipBrowserRedirect: true,
          ...opts 
        },
      });

      console.log('[OAUTH]', provider, 'Supabase response - error?', error?.message, 'data.url?', !!data?.url);
      
      if (error) {
        console.log('[OAUTH]', provider, 'Supabase OAuth error details:', error);
        
        // Check for common development environment issues
        if (error.message?.includes('redirect_uri') || error.message?.includes('client_id')) {
          throw new Error(`OAuth configuration issue for ${isDev ? 'development' : 'production'} environment. Please check your Supabase OAuth settings.`);
        }
        
        throw new Error(`OAuth setup error: ${error.message}`);
      }
      
      if (!data?.url) {
        console.log('[OAUTH]', provider, 'No auth URL returned from Supabase');
        console.log('[OAUTH]', provider, 'This often happens when:');
        console.log('[OAUTH]', provider, '1. OAuth provider is not enabled in Supabase');
        console.log('[OAUTH]', provider, '2. Client ID/Secret not configured');
        console.log('[OAUTH]', provider, '3. Redirect URLs don\'t match');
        console.log('[OAUTH]', provider, '4. Different config needed for EAS dev vs production');
        
        throw new Error(`${provider} OAuth is not properly configured for ${isDev ? 'development' : 'production'} builds. Please check your Supabase dashboard.`);
      }

      console.log('[OAUTH]', provider, 'Opening browser with URL:', data.url.slice(0, 100) + '...');
      
      const res = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
      console.log('[OAUTH]', provider, 'WebBrowser result:', res.type);
      
      if (res.type !== 'success' || !res.url) {
        if (res.type === 'cancel') {
          throw new Error('Sign-in was cancelled');
        }
        throw new Error('Authentication failed or was cancelled');
      }

      console.log('[OAUTH]', provider, 'Exchanging code for session...');
      const { data: exData, error: exErr } = await supabase.auth.exchangeCodeForSession(res.url);
      
      if (exErr) {
        console.log('[OAUTH]', provider, 'Exchange code error:', exErr);
        throw new Error(`Authentication failed: ${exErr.message}`);
      }

      if (!exData?.session) {
        throw new Error('No session returned after authentication');
      }

      console.log('[OAUTH]', provider, 'Successfully authenticated!');
      router.replace('/(app)/onboarding');
      
    } catch (error) {
      throw error;
    }
  };

  const handleGoogle = async () => {
    if (loading || anySocialBusy) return;
    try {
      setGoogleLoading(true);
      setAuthError('');
      await openOAuth('google', { 
        queryParams: { 
          access_type: 'offline', 
          prompt: 'consent' 
        } 
      });
    } catch (e) {
      console.log('[OAUTH][Google] Failed:', e?.message);
      
      let userMessage = e?.message || 'Google sign-in failed. Please try again.';
      
      // Provide specific guidance for EAS development
      if (userMessage.includes('not properly configured')) {
        userMessage = __DEV__ 
          ? 'Google sign-in is not configured for development builds. This is normal for EAS development - use email/password or configure OAuth for dev.'
          : 'Google sign-in is not configured. Please contact support.';
      } else if (userMessage.includes('configuration issue')) {
        userMessage = 'OAuth configuration mismatch. Please check redirect URLs in Supabase.';
      } else if (userMessage.includes('cancelled')) {
        userMessage = 'Google sign-in was cancelled.';
      }
      
      setAuthError(userMessage);
      
      // Don't show alert for expected dev environment issues
      if (!__DEV__ || !userMessage.includes('development builds')) {
        Alert.alert('Google Sign-in Error', userMessage);
      }
    } finally { 
      setGoogleLoading(false); 
    }
  };

  const handleFacebook = async () => {
    if (loading || anySocialBusy) return;
    try {
      setFacebookLoading(true);
      setAuthError('');
      await openOAuth('facebook', { 
        queryParams: { 
          display: 'popup' 
        } 
      });
    } catch (e) {
      console.log('[OAUTH][Facebook] Failed:', e?.message);
      
      let userMessage = e?.message || 'Facebook sign-in failed. Please try again.';
      
      // Provide specific guidance for EAS development
      if (userMessage.includes('not properly configured')) {
        userMessage = __DEV__ 
          ? 'Facebook sign-in is not configured for development builds. This is normal for EAS development - use email/password or configure OAuth for dev.'
          : 'Facebook sign-in is not configured. Please contact support.';
      } else if (userMessage.includes('configuration issue')) {
        userMessage = 'OAuth configuration mismatch. Please check redirect URLs in Supabase.';
      } else if (userMessage.includes('cancelled')) {
        userMessage = 'Facebook sign-in was cancelled.';
      }
      
      setAuthError(userMessage);
      
      // Don't show alert for expected dev environment issues
      if (!__DEV__ || !userMessage.includes('development builds')) {
        Alert.alert('Facebook Sign-in Error', userMessage);
      }
    } finally { 
      setFacebookLoading(false); 
    }
  };

  const onSubmitEmail = () => pwRef.current?.focus?.();

  return (
    <View style={styles.screen}>
      <StatusBar barStyle="dark-content" />
      <View style={styles.card}>
        <Image source={require('../../assets/images/trademate-login-logo.png')} style={styles.logo} resizeMode="contain" />
        <Text style={styles.title}>TradeMate</Text>
        <Text style={styles.subtitle}>Sign in to start managing your trade business</Text>

        {!!authError && <Text style={styles.errorText}>{authError}</Text>}

        <View style={styles.inputWrap}>
          <TextInput
            placeholder="Email"
            placeholderTextColor={SUBTLE}
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
            textContentType="username"
            value={email}
            onChangeText={(t) => { setEmail(t); if (authError) setAuthError(''); }}
            style={styles.input}
            returnKeyType="next"
            onSubmitEditing={onSubmitEmail}
            editable={!loading && !anySocialBusy}
          />
        </View>

        <View style={styles.inputWrap}>
          <TextInput
            ref={pwRef}
            placeholder="Password"
            placeholderTextColor={SUBTLE}
            secureTextEntry={!showPw}
            autoComplete="password"
            textContentType="password"
            value={password}
            onChangeText={(t) => { setPassword(t); if (authError) setAuthError(''); }}
            style={[styles.input, styles.inputHasIcon]}
            returnKeyType="go"
            onSubmitEditing={handleLogin}
            editable={!loading && !anySocialBusy}
          />
          <TouchableOpacity onPress={() => !loading && !anySocialBusy && setShowPw((s) => !s)} style={styles.eyeBtn} disabled={loading || anySocialBusy}>
            {showPw ? <Eye color="#9aa0a6" size={20} /> : <EyeOff color="#9aa0a6" size={20} />}
          </TouchableOpacity>
        </View>

        <View style={styles.checksRowSingle}>
          <TouchableOpacity onPress={() => setRememberMe((v) => !v)} style={styles.checkItem}>
            <View style={[styles.checkbox, rememberMe && styles.checkboxOn]}>
              {rememberMe ? <Text style={styles.tick}>✓</Text> : null}
            </View>
            <Text style={styles.checkLabel}>Remember me</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={[styles.primaryBtn, (loading || anySocialBusy) && { opacity: 0.7 }]} onPress={handleLogin} disabled={loading || anySocialBusy}>
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Sign In</Text>}
        </TouchableOpacity>

        <View style={styles.dividerWrap}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>or</Text>
          <View style={styles.dividerLine} />
        </View>

        <TouchableOpacity style={[styles.socialBtnGoogle, (loading || anySocialBusy) && { opacity: 0.7 }]} onPress={handleGoogle} disabled={loading || anySocialBusy}>
          {googleLoading ? <ActivityIndicator /> : (<><AntDesign name="google" size={18} color="#4285F4" style={{ marginRight: 8 }} /><Text style={styles.googleText}>Continue with Google</Text></>)}
        </TouchableOpacity>

        <TouchableOpacity style={[styles.socialBtnFacebook, (loading || anySocialBusy) && { opacity: 0.7 }]} onPress={handleFacebook} disabled={loading || anySocialBusy}>
          {facebookLoading ? <ActivityIndicator color="#fff" /> : (<><FontAwesome name="facebook" size={18} color="#fff" style={{ marginRight: 8 }} /><Text style={styles.fbText}>Continue with Facebook</Text></>)}
        </TouchableOpacity>

        <TouchableOpacity style={styles.linkBtn} onPress={handleForgotPw} disabled={loading || anySocialBusy}>
          <Text style={styles.linkText}>Forgot password?</Text>
        </TouchableOpacity>

        <Text style={styles.footerText}>New here? <Link href={signupHref} style={styles.linkText}>Create account</Link></Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#ffffff', paddingHorizontal: 20, justifyContent: 'center' },
  card: { backgroundColor: '#ffffff', borderRadius: 18, padding: 22, alignItems: 'center', elevation: 4 },
  logo: { width: 156, height: 156, marginBottom: 14 },
  title: { color: TEXT, fontSize: 26, fontWeight: '800', marginBottom: 6, textAlign: 'center' },
  subtitle: { color: SUBTLE, fontSize: 14, marginBottom: 18, textAlign: 'center' },
  errorText: { width: '100%', color: '#b3261e', backgroundColor: '#fdecec', borderColor: '#f7c8c8', borderWidth: 1, padding: 10, borderRadius: 10, marginBottom: 10 },
  inputWrap: { width: '100%', marginBottom: 12, position: 'relative' },
  input: { width: '100%', backgroundColor: SURFACE, color: TEXT, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 14, borderWidth: 1, borderColor: BORDER, fontSize: 16 },
  inputHasIcon: { paddingRight: 46 },
  eyeBtn: { position: 'absolute', right: 10, top: 0, bottom: 0, justifyContent: 'center' },
  checksRowSingle: { width: '100%', flexDirection: 'row', justifyContent: 'flex-start', marginTop: 2, marginBottom: 8 },
  checkItem: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  checkbox: { width: 20, height: 20, borderRadius: 6, borderWidth: 1, borderColor: BORDER, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  checkboxOn: { borderColor: BRAND, backgroundColor: '#e9f2ff' },
  tick: { color: BRAND, fontWeight: '800', fontSize: 14, lineHeight: 14 },
  checkLabel: { color: SUBTLE, fontSize: 13 },
  primaryBtn: { width: '100%', backgroundColor: BRAND, borderRadius: 12, padding: 14, alignItems: 'center', marginTop: 10 },
  primaryBtnText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  dividerWrap: { width: '100%', marginVertical: 12, flexDirection: 'row', alignItems: 'center' },
  dividerLine: { flex: 1, height: 1, backgroundColor: BORDER },
  dividerText: { marginHorizontal: 10, color: SUBTLE, fontWeight: '700', fontSize: 12 },
  socialBtnGoogle: { width: '100%', backgroundColor: '#fff', borderRadius: 12, paddingVertical: 12, alignItems: 'center', marginTop: 2, borderWidth: 1, borderColor: GOOGLE_BORDER, flexDirection: 'row', justifyContent: 'center' },
  googleText: { color: GOOGLE_TEXT, fontWeight: '800', fontSize: 16 },
  socialBtnFacebook: { width: '100%', backgroundColor: FB_BLUE, borderRadius: 12, paddingVertical: 12, alignItems: 'center', marginTop: 10, flexDirection: 'row', justifyContent: 'center' },
  fbText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  linkBtn: { marginTop: 12 },
  linkText: { color: BRAND, fontWeight: '700' },
  footerText: { color: SUBTLE, marginTop: 16, textAlign: 'center' },
});