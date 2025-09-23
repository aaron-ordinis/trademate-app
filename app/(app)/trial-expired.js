import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  Image,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Crown, CreditCard, LogOut } from 'lucide-react-native';
import { supabase } from '../../lib/supabase';
import * as Haptics from 'expo-haptics';

const BRAND = '#2a86ff';
const TEXT = '#0b1220';
const MUTED = '#6b7280';
const CARD = '#ffffff';
const BG = '#f5f7fb';
const DANGER = '#dc2626';

export default function TrialExpired() {
  const router = useRouter();

  const handleSubscribe = () => {
    Haptics.selectionAsync();
    router.push('/(app)/billing');
  };

  const handleLogout = async () => {
    try {
      Haptics.selectionAsync();
      await supabase.auth.signOut();
      router.replace('/(auth)/login');
    } catch (error) {
      console.error('Logout error:', error);
      // Force navigation even if logout fails
      router.replace('/(auth)/login');
    }
  };

  return (
    <View style={styles.screen}>
      <StatusBar barStyle="dark-content" backgroundColor={BG} />
      
      <View style={styles.container}>
        <View style={styles.iconContainer}>
          <Crown size={64} color="#f59e0b" />
        </View>
        
        <Text style={styles.title}>Your Trial Has Ended</Text>
        <Text style={styles.message}>
          Your 7-day free trial of TradeMate Pro has expired. 
          Subscribe now to continue creating professional quotes and managing your trade business.
        </Text>
        
        <View style={styles.features}>
          <FeatureItem text="Unlimited quotes & invoices" />
          <FeatureItem text="Professional PDF generation" />
          <FeatureItem text="Job management & scheduling" />
          <FeatureItem text="Remove 'Powered by TradeMate'" />
          <FeatureItem text="Custom logo & branding" />
          <FeatureItem text="Advanced AI features" />
        </View>

        <TouchableOpacity
          style={styles.subscribeButton}
          onPress={handleSubscribe}
          activeOpacity={0.9}
        >
          <CreditCard size={20} color="#ffffff" />
          <Text style={styles.subscribeButtonText}>Subscribe Now</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.logoutButton}
          onPress={handleLogout}
          activeOpacity={0.7}
        >
          <LogOut size={18} color={DANGER} />
          <Text style={styles.logoutButtonText}>Sign Out</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function FeatureItem({ text }) {
  return (
    <View style={styles.featureItem}>
      <View style={styles.checkmark}>
        <Text style={styles.checkmarkText}>✓</Text>
      </View>
      <Text style={styles.featureText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: BG,
  },
  container: {
    flex: 1,
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconContainer: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: TEXT,
    textAlign: 'center',
    marginBottom: 16,
  },
  message: {
    fontSize: 16,
    color: MUTED,
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 32,
    paddingHorizontal: 8,
  },
  features: {
    width: '100%',
    marginBottom: 32,
  },
  featureItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  checkmark: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#16a34a',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  checkmarkText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
  featureText: {
    fontSize: 16,
    color: TEXT,
    fontWeight: '600',
  },
  subscribeButton: {
    backgroundColor: BRAND,
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 32,
    width: '100%',
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 16,
    shadowColor: BRAND,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  subscribeButtonText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '800',
  },
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 24,
  },
  logoutButtonText: {
    color: DANGER,
    fontSize: 16,
    fontWeight: '600',
  },
});
