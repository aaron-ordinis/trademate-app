// app/(auth)/register.js
import { loginHref } from "../../lib/nav";
import React, { useRef, useState, useMemo, useEffect, useCallback } from 'react';
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
  Modal,
  Animated,
  ScrollView,
} from 'react-native';
import { useRouter, Link } from 'expo-router';
import { Eye, EyeOff, CheckCircle2, XCircle, CheckCircle } from 'lucide-react-native';
import { supabase } from '../../lib/supabase';

// Policy system
import PolicyModal from '../../components/PolicyModal';
import { getPendingPolicies, acceptAllPending } from '../../lib/policies/registry';

/* --- Brand tokens --- */
const BRAND = '#2a86ff';
const TEXT = '#0b1220';
const SUBTLE = '#6b7280';
const SURFACE = '#f6f7f9';
const BORDER = '#e6e9ee';
const DANGER = '#b3261e';
const OK = '#3ecf8e';
const WARN = '#f59e0b';

export default function Register() {
  const router = useRouter();

  const pwRef = useRef(null);
  const confirmRef = useRef(null);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [authError, setAuthError] = useState('');

  // Success modal state
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [successTitle, setSuccessTitle] = useState('');
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.8)).current;

  // ✅ Policy modal state (this was missing)
  const [pendingPolicies, setPendingPolicies] = useState([]);   // array of { id/title/content/url } or alike
  const [showPolicyModal, setShowPolicyModal] = useState(false);
  const [currentPolicyIndex, setCurrentPolicyIndex] = useState(0);
  const currentPolicy = pendingPolicies[currentPolicyIndex];

  // Requirements
  const reqs = useMemo(() => {
    const pw = password || '';
    return {
      length: pw.length >= 8,
      upper: /[A-Z]/.test(pw),
      lower: /[a-z]/.test(pw),
      digit: /\d/.test(pw),
      special: /[^A-Za-z0-9]/.test(pw),
    };
  }, [password]);

  const metCount = Object.values(reqs).filter(Boolean).length;

  const strength = useMemo(() => {
    if (metCount <= 2) return { label: 'Weak', color: DANGER, level: 1 };
    if (metCount === 3) return { label: 'Fair', color: WARN, level: 2 };
    if (metCount === 4) return { label: 'Good', color: BRAND, level: 3 };
    return { label: 'Strong', color: OK, level: 4 };
  }, [metCount]);

  const validate = () => {
    setAuthError('');
    const e = email.trim().toLowerCase();

    if (!e || !password.trim() || !confirm.trim()) {
      setAuthError('Please fill in all fields.');
      Alert.alert('Missing info', 'Please fill in all fields.');
      return false;
    }
    if (!/^\S+@\S+\.\S+$/.test(e)) {
      setAuthError('Please enter a valid email address.');
      Alert.alert('Invalid email', 'Please enter a valid email address.');
      return false;
    }
    if (!(reqs.length && reqs.upper && reqs.lower && reqs.digit && reqs.special)) {
      setAuthError('Password does not meet the requirements.');
      Alert.alert('Weak password', 'Please meet all password requirements.');
      return false;
    }
    if (password !== confirm) {
      setAuthError('Passwords do not match.');
      Alert.alert('Passwords do not match', 'Please re-enter your password.');
      return false;
    }
    return true;
  };

  const showProfessionalSuccess = (title, message, onDismiss) => {
    setSuccessTitle(title);
    setSuccessMessage(message);
    setShowSuccessModal(true);

    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 300, useNativeDriver: true }),
      Animated.spring(scaleAnim, { toValue: 1, tension: 50, friction: 7, useNativeDriver: true }),
    ]).start();

    setTimeout(() => {
      Animated.parallel([
        Animated.timing(fadeAnim, { toValue: 0, duration: 250, useNativeDriver: true }),
        Animated.timing(scaleAnim, { toValue: 0.8, duration: 250, useNativeDriver: true }),
      ]).start(() => {
        setShowSuccessModal(false);
        onDismiss?.();
      });
    }, 2500);
  };

  const handleRegister = async () => {
    if (loading) return;
    if (!validate()) return;

    // Check for pending policies first (safe default to [])
    try {
      const policies = (await getPendingPolicies()) || [];
      if (policies.length > 0) {
        setPendingPolicies(policies);
        setCurrentPolicyIndex(0);
        setShowPolicyModal(true);
        return; // wait for user to accept
      }
    } catch (e) {
      console.warn('Policy check failed, continuing with registration:', e);
    }

    await performRegistration();
  };

  const performRegistration = async () => {
    try {
      setLoading(true);

      const { data, error } = await supabase.auth.signUp({
        email: email.trim().toLowerCase(),
        password,
        options: {
          emailRedirectTo: 'tradematequotes://auth/login',
          data: { plan_tier: 'free' },
        },
      });
      if (error) throw error;

      if (data.user && data.session) {
        await supabase.auth.signOut();
        showProfessionalSuccess(
          'Account Created Successfully',
          'Welcome to TradeMate! Your account has been created and is ready to use. Please sign in with your credentials to get started.',
          () => router.replace(loginHref)
        );
        return;
      }

      if (data.user && !data.session) {
        showProfessionalSuccess(
          'Check Your Email',
          "We've sent you a confirmation link. Please check your email and click the link to verify your account, then return to sign in.",
          () => router.replace(loginHref)
        );
        return;
      }

      showProfessionalSuccess(
        'Account Created',
        'Your account has been created successfully. Please check your email for confirmation instructions, then sign in.',
        () => router.replace(loginHref)
      );
    } catch (e) {
      console.error('[TMQ][REGISTER] Error', e);
      let nice = e?.message ?? 'Please try again.';
      if (e?.message?.includes('User already registered')) {
        nice = 'This email is already registered. Try signing in instead.';
      } else if (e?.message?.includes('Database error')) {
        nice = 'Registration failed due to a database error. Please try again.';
      } else if (e?.message?.includes('Invalid email')) {
        nice = 'Please enter a valid email address.';
      }
      setAuthError(nice);
      Alert.alert('Register failed', nice);
    } finally {
      setLoading(false);
    }
  };

  // Policy modal handlers
  const handlePolicyAccept = async () => {
    const current = pendingPolicies[currentPolicyIndex];
    try {
      if (current) {
        // acceptAllPending can take a list; pass single current item
        await acceptAllPending([current]);
      }
    } catch (e) {
      console.warn('Accept policy failed:', e);
    }

    if (currentPolicyIndex + 1 < pendingPolicies.length) {
      setCurrentPolicyIndex((i) => i + 1);
    } else {
      // All accepted → continue
      setShowPolicyModal(false);
      setPendingPolicies([]);
      setCurrentPolicyIndex(0);
      await performRegistration();
    }
  };

  const handlePolicyClose = () => {
    setShowPolicyModal(false);
    setPendingPolicies([]);
    setCurrentPolicyIndex(0);
  };

  const onSubmitEmail = () => pwRef.current?.focus?.();
  const onSubmitPw = () => confirmRef.current?.focus?.();

  return (
    <View style={styles.screen}>
      <StatusBar barStyle="dark-content" />
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }}>
        <View style={styles.card}>
          <Image
            source={require('../../assets/images/trademate-login-logo.png')}
            style={styles.logo}
            resizeMode="contain"
          />
          <Text style={styles.title}>TradeMate Quotes</Text>
          <Text style={styles.subtitle}>Create your account to start sending quotes</Text>

          {!!authError && <Text style={styles.errorText}>{authError}</Text>}

          {/* Email */}
          <View style={styles.inputWrap}>
            <TextInput
              placeholder="Email"
              placeholderTextColor={SUBTLE}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              value={email}
              onChangeText={(t) => { setEmail(t); if (authError) setAuthError(''); }}
              style={styles.input}
              returnKeyType="next"
              onSubmitEditing={onSubmitEmail}
              editable={!loading}
            />
          </View>

          {/* Password */}
          <View style={styles.inputWrap}>
            <TextInput
              ref={pwRef}
              placeholder="Password"
              placeholderTextColor={SUBTLE}
              secureTextEntry={!showPw}
              autoComplete="password-new"
              textContentType="newPassword"
              value={password}
              onChangeText={(t) => { setPassword(t); if (authError) setAuthError(''); }}
              style={[styles.input, styles.inputHasIcon]}
              returnKeyType="next"
              onSubmitEditing={onSubmitPw}
              editable={!loading}
            />
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={showPw ? 'Hide passwords' : 'Show passwords'}
              onPress={() => !loading && setShowPw((s) => !s)}
              style={styles.eyeBtn}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              disabled={loading}
            >
              {showPw ? <Eye color="#9aa0a6" size={20} /> : <EyeOff color="#9aa0a6" size={20} />}
            </TouchableOpacity>
          </View>

          {/* Strength bar + requirements */}
          <View style={styles.strengthWrap}>
            <View style={styles.strengthBar}>
              {[1, 2, 3, 4].map((i) => (
                <View
                  key={i}
                  style={[
                    styles.segment,
                    i <= strength.level ? { backgroundColor: strength.color, borderColor: strength.color } : {},
                  ]}
                />
              ))}
            </View>
            <Text style={[styles.strengthLabel, { color: strength.color }]}>
              Password strength: {strength.label}
            </Text>

            <View style={styles.reqsWrap}>
              <Req ok={reqs.length} label="At least 8 characters" />
              <Req ok={reqs.upper} label="At least one uppercase letter" />
              <Req ok={reqs.lower} label="At least one lowercase letter" />
              <Req ok={reqs.digit} label="At least one number" />
              <Req ok={reqs.special} label="At least one special character" />
            </View>
          </View>

          {/* Confirm Password */}
          <View style={styles.inputWrap}>
            <TextInput
              ref={confirmRef}
              placeholder="Confirm password"
              placeholderTextColor={SUBTLE}
              secureTextEntry={!showPw}
              autoComplete="password-new"
              textContentType="newPassword"
              value={confirm}
              onChangeText={(t) => { setConfirm(t); if (authError) setAuthError(''); }}
              style={[styles.input, styles.inputHasIcon]}
              returnKeyType="done"
              onSubmitEditing={handleRegister}
              editable={!loading}
            />
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={showPw ? 'Hide passwords' : 'Show passwords'}
              onPress={() => !loading && setShowPw((s) => !s)}
              style={styles.eyeBtn}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              disabled={loading}
            >
              {showPw ? <Eye color="#9aa0a6" size={20} /> : <EyeOff color="#9aa0a6" size={20} />}
            </TouchableOpacity>
          </View>

          {/* Create account */}
          <TouchableOpacity
            style={[styles.primaryBtn, loading && { opacity: 0.7 }]}
            onPress={handleRegister}
            disabled={loading}
          >
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Create account</Text>}
          </TouchableOpacity>

          <Text style={styles.footerText}>
            Already have an account?{' '}
            <Link href={loginHref} style={styles.linkText}>
              Sign in
            </Link>
          </Text>
        </View>
      </ScrollView>

      {/* Success Modal */}
      <Modal visible={showSuccessModal} transparent animationType="none" onRequestClose={() => {}}>
        <View style={styles.successOverlay}>
          <Animated.View
            style={[styles.successModal, { opacity: fadeAnim, transform: [{ scale: scaleAnim }] }]}
          >
            <View style={styles.successIconContainer}>
              <CheckCircle size={56} color={OK} strokeWidth={2} />
            </View>

            <Text style={styles.successTitle}>{successTitle}</Text>
            <Text style={styles.successMessage}>{successMessage}</Text>

            <View style={styles.successIndicator}>
              <View style={styles.successDots}>
                <View style={[styles.successDot, styles.successDotActive]} />
                <View style={[styles.successDot, styles.successDotActive]} />
                <View style={[styles.successDot]} />
              </View>
            </View>
          </Animated.View>
        </View>
      </Modal>

      {/* Policy Modal */}
      {currentPolicy && (
        <PolicyModal
          visible={showPolicyModal}
          title={currentPolicy.title}
          content={currentPolicy.content}
          websiteUrl={currentPolicy.url}
          showAccept
          onAccept={handlePolicyAccept}
          onClose={handlePolicyClose}
        />
      )}
    </View>
  );
}

/* ---- small requirement row ---- */
function Req({ ok, label }) {
  return (
    <View style={reqStyles.row}>
      {ok ? <CheckCircle2 color={OK} size={16} /> : <XCircle color={DANGER} size={16} />}
      <Text style={[reqStyles.text, ok && { color: '#374151' }]}>{label}</Text>
    </View>
  );
}

const reqStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  text: { color: SUBTLE, fontSize: 12 },
});

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
    color: DANGER,
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

  strengthWrap: { width: '100%', marginBottom: 8 },
  strengthBar: { flexDirection: 'row', gap: 6, marginTop: 2, marginBottom: 6 },
  segment: {
    flex: 1,
    height: 6,
    borderRadius: 999,
    backgroundColor: '#e5e7eb',
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  strengthLabel: { fontSize: 12, color: SUBTLE },

  primaryBtn: {
    width: '100%',
    backgroundColor: BRAND,
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
    marginTop: 6,
  },
  primaryBtnText: { color: '#fff', fontWeight: '800', fontSize: 16 },

  linkText: { color: BRAND, fontWeight: '700' },
  footerText: { color: SUBTLE, marginTop: 16, textAlign: 'center' },

  // Success Modal styles
  successOverlay: {
    flex: 1,
    backgroundColor: 'rgba(11, 18, 32, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  successModal: {
    backgroundColor: '#ffffff',
    borderRadius: 20,
    padding: 32,
    alignItems: 'center',
    maxWidth: 340,
    width: '100%',
    shadowColor: '#0b1220',
    shadowOpacity: 0.15,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 16,
    borderWidth: 1,
    borderColor: 'rgba(230, 233, 238, 0.8)',
  },
  successIconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(62, 207, 142, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  successTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: TEXT,
    textAlign: 'center',
    marginBottom: 12,
    letterSpacing: -0.5,
  },
  successMessage: {
    fontSize: 16,
    color: SUBTLE,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24,
    letterSpacing: -0.2,
  },
  successIndicator: { alignItems: 'center' },
  successDots: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  successDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(107, 114, 128, 0.3)',
  },
  successDotActive: { backgroundColor: BRAND },
});