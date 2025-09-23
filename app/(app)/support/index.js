/* app/(app)/support/index.js */
import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Linking,
  Platform,
  ScrollView,
  Modal,
  Pressable,
  ActivityIndicator,
} from 'react-native';
import Constants from 'expo-constants';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { supabase } from '../../../lib/supabase';
import { ChevronLeft } from 'lucide-react-native';

// NEW: in-app legal modals
import PolicyModal from '../../../components/PolicyModal';
import { POLICIES } from '../../../lib/policies/registry';

// ---- Brand tokens ----
const BRAND = '#2a86ff';
const TEXT = '#0b1220';
const MUTED = '#6b7280';
const CARD = '#ffffff';
const BG = '#f5f7fb';
const BORDER = '#e6e9ee';

// ---- Config ----
const DELETE_FN_URL = 'https://bvbjvxjtxfzipwvfkrrb.supabase.co/functions/v1/delete-account';

export default function SupportScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [working, setWorking] = useState(false);

  // Which policy modal is open: 'privacy' | 'terms' | null
  const [policyOpen, setPolicyOpen] = useState(null);

  const getPolicy = (name) => POLICIES.find((p) => p.name === name);

  const openURL = async (url) => {
    try {
      const can = await Linking.canOpenURL(url);
      if (!can) return;
      await Linking.openURL(url);
    } catch {}
  };

  // Route to in-app Support chat (replace with your actual route if different)
  const openSupportChat = () => {
    try {
      router.push('/(app)/support/chat');
    } catch {
      // fallback: website contact page if chat route not present yet
      openURL('https://www.tradematequotes.com/contact');
    }
  };

  const deleteAccount = async () => {
    try {
      setWorking(true);
      const {
        data: { session },
        error: sessErr,
      } = await supabase.auth.getSession();
      if (sessErr) throw sessErr;
      if (!session || !session.access_token)
        throw new Error('No session token available');

      const resp = await fetch(DELETE_FN_URL, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + session.access_token,
          'Content-Type': 'application/json',
        },
      });

      if (!resp.ok) {
        const txt = await resp.text();
        throw new Error(txt || 'Delete request failed');
      }

      await supabase.auth.signOut();
      setConfirmOpen(false);
      router.replace('/(auth)/login');
    } catch (e) {
      alert(e && e.message ? e.message : 'Could not delete account.');
    } finally {
      setWorking(false);
    }
  };

  const appName =
    (Constants.expoConfig && Constants.expoConfig.name) ||
    (Constants.manifest && Constants.manifest.name) ||
    'TradeMate';
  const appVersion =
    (Constants.expoConfig && Constants.expoConfig.version) ||
    (Constants.manifest && Constants.manifest.version) ||
    '0.0.0';

  return (
    <SafeAreaView edges={['top', 'left', 'right', 'bottom']} style={styles.wrap}>
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: 12,
          paddingBottom: Math.max(insets.bottom, 28),
        }}
      >
        {/* Back Button */}
        <TouchableOpacity 
          style={styles.backButton}
          onPress={() => router.back()}
          activeOpacity={0.7}
        >
          <ChevronLeft size={20} color={BRAND} />
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>

        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.h1}>Help & Support</Text>
          <Text style={styles.hint}>Message us in-app, browse resources, or manage your data.</Text>
        </View>

        {/* Visit Website */}
        <View style={styles.card}>
          <TouchableOpacity
            style={[styles.rowLink, { backgroundColor: BRAND }]}
            onPress={() => openURL('https://www.tradematequotes.com')}
            activeOpacity={0.9}
          >
            <Text style={[styles.linkText, { color: '#fff', textAlign: 'center' }]}>
              Visit Website
            </Text>
          </TouchableOpacity>
        </View>

        {/* Quick fixes */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Quick fixes</Text>
          <View style={styles.list}>
            {[
              'Force-close and reopen the app.',
              'Check your internet connection (Wi-Fi or mobile).',
              'Ensure you’re on the latest app version.',
              'Allow Files/Storage permissions if PDFs won’t save/share.',
              'Sign out and back in if your data seems out of date.',
            ].map((t, i) => (
              <View key={i} style={styles.li}>
                <Text style={styles.bullet}>•</Text>
                <Text style={styles.liText}>{t}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Contact us (in-app messaging) */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Contact us</Text>
          <TouchableOpacity
            style={styles.rowLink}
            onPress={openSupportChat}
            activeOpacity={0.9}
          >
            <Text style={styles.linkText}>Message support (in-app)</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.rowLink}
            onPress={() => openURL('https://www.tradematequotes.com/faqs')}
            activeOpacity={0.9}
          >
            <Text style={styles.linkText}>FAQs & How-tos</Text>
          </TouchableOpacity>
        </View>

        {/* Data & legal (open in-app modals) */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Data & legal</Text>

          <TouchableOpacity
            style={styles.rowLink}
            onPress={() => setPolicyOpen('privacy')}
            activeOpacity={0.9}
          >
            <Text style={styles.linkText}>Privacy Policy (in-app)</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.rowLink}
            onPress={() => setPolicyOpen('terms')}
            activeOpacity={0.9}
          >
            <Text style={styles.linkText}>Terms & Conditions (in-app)</Text>
          </TouchableOpacity>

          {/* Keep Cookies on website for now (unless you add a cookies policy markdown) */}
          <TouchableOpacity
            style={styles.rowLink}
            onPress={() => openURL('https://www.tradematequotes.com/cookies')}
            activeOpacity={0.9}
          >
            <Text style={styles.linkText}>Cookies Policy (website)</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.rowLink, { borderColor: '#dc2626' }]}
            onPress={() => setConfirmOpen(true)}
            activeOpacity={0.9}
          >
            <Text style={[styles.linkText, { color: '#dc2626' }]}>
              Delete account permanently
            </Text>
          </TouchableOpacity>
        </View>

        {/* About / build info */}
        <View style={styles.metaCard}>
          <Text style={styles.metaText}>
            {`${appName} • v${appVersion}`}
          </Text>
        </View>
      </ScrollView>

      {/* Confirm delete modal */}
      <Modal visible={confirmOpen} transparent animationType="fade">
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => (!working ? setConfirmOpen(false) : null)}
        />
        <View style={styles.modalSheet}>
          <Text style={styles.modalTitle}>Delete Account</Text>
          <Text style={styles.modalMsg}>
            This will permanently delete your account, logos, and ALL data.{' '}
            <Text style={{ fontWeight: 'bold' }}>This action cannot be undone.</Text>
          </Text>

          <TouchableOpacity
            style={[styles.dangerBtn, working && { opacity: 0.6 }]}
            disabled={working}
            onPress={deleteAccount}
            activeOpacity={0.9}
          >
            {working ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.dangerText}>Yes, delete my account</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.secondaryBtn}
            disabled={working}
            onPress={() => setConfirmOpen(false)}
            activeOpacity={0.9}
          >
            <Text style={styles.secondaryText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </Modal>

      {/* In-app legal modals */}
      {policyOpen && (
        <PolicyModal
          visible
          title={getPolicy(policyOpen)?.title || 'Policy'}
          content={getPolicy(policyOpen)?.content || ''}
          websiteUrl={getPolicy(policyOpen)?.url}
          showAccept={false} // read-only here; acceptance handled on app launch gate
          onClose={() => setPolicyOpen(null)}
        />
      )}
    </SafeAreaView>
  );
}

// --- styles ---
const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: BG },
  
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 8,
    paddingHorizontal: 8,
    marginLeft: -8,
    marginBottom: 8,
  },
  backText: {
    color: BRAND,
    fontSize: 16,
    fontWeight: '800',
  },
  
  header: { alignItems: 'center', marginBottom: 12 },
  h1: { color: TEXT, fontSize: 24, fontWeight: '800' },
  hint: { color: MUTED, marginTop: 4 },

  card: {
    width: '100%',
    maxWidth: 520,
    alignSelf: 'center',
    backgroundColor: CARD,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 14,
    marginTop: 14,
    shadowColor: '#0b1220',
    shadowOpacity: 0.05,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 2,
  },
  cardTitle: { color: TEXT, fontWeight: '900', marginBottom: 6 },

  rowLink: {
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: '#f9fafb',
    marginVertical: 4,
  },
  linkText: { color: TEXT, fontWeight: '800' },

  list: { marginTop: 2 },
  li: { flexDirection: 'row', alignItems: 'flex-start', marginVertical: 2 },
  bullet: { color: MUTED, width: 16, textAlign: 'center' },
  liText: { color: TEXT, flex: 1 },

  metaCard: {
    width: '100%',
    maxWidth: 520,
    alignSelf: 'center',
    backgroundColor: 'transparent',
    padding: 10,
    alignItems: 'center',
  },
  metaText: { color: MUTED, fontSize: 12 },

  modalBackdrop: { flex: 1, backgroundColor: '#0008' },
  modalSheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: CARD,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    padding: 20,
    borderTopWidth: 1,
    borderColor: BORDER,
  },
  modalTitle: {
    color: '#dc2626',
    fontSize: 20,
    fontWeight: '900',
    marginBottom: 10,
  },
  modalMsg: { color: TEXT, marginBottom: 16, lineHeight: 20 },
  dangerBtn: {
    backgroundColor: '#dc2626',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 10,
  },
  dangerText: { color: '#fff', fontWeight: '800' },
  secondaryBtn: {
    backgroundColor: '#f3f4f6',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  secondaryText: { color: TEXT, fontWeight: '800' },
});