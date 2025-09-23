import React from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { Lock, Crown } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';

const BRAND = '#2a86ff';
const TEXT = '#0b1220';
const MUTED = '#6b7280';
const CARD = '#ffffff';
const BORDER = '#e6e9ee';

export default function PaywallModal({ 
  visible, 
  onClose, 
  onSubscribe, 
  title = "Premium Feature",
  message = "Your trial has ended. Subscribe to keep using TradeMate Pro features."
}) {
  const handleSubscribe = () => {
    Haptics.selectionAsync();
    onSubscribe?.();
  };

  const handleClose = () => {
    Haptics.selectionAsync();
    onClose?.();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleClose}
    >
      <BlurView 
        intensity={10} 
        tint="systemThinMaterialLight" 
        style={{ flex: 1 }} 
      />
      
      <View style={styles.overlay}>
        <View style={styles.modal}>
          <View style={styles.iconContainer}>
            <Crown size={48} color="#f59e0b" />
          </View>
          
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.message}>{message}</Text>
          
          <View style={styles.features}>
            <FeatureItem text="Unlimited quotes & invoices" />
            <FeatureItem text="Remove 'Powered by TradeMate'" />
            <FeatureItem text="Custom logo & branding" />
            <FeatureItem text="Advanced AI features" />
          </View>

          <TouchableOpacity
            style={styles.subscribeButton}
            onPress={handleSubscribe}
            activeOpacity={0.9}
          >
            <Text style={styles.subscribeButtonText}>Subscribe Now</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.closeButton}
            onPress={handleClose}
            activeOpacity={0.7}
          >
            <Text style={styles.closeButtonText}>Maybe Later</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
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
  overlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  modal: {
    backgroundColor: CARD,
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    maxWidth: 340,
    width: '100%',
    shadowColor: '#0b1220',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
    elevation: 16,
    borderWidth: 1,
    borderColor: BORDER,
  },
  iconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    color: TEXT,
    textAlign: 'center',
    marginBottom: 8,
  },
  message: {
    fontSize: 16,
    color: MUTED,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 20,
  },
  features: {
    width: '100%',
    marginBottom: 24,
  },
  featureItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
  },
  checkmark: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#16a34a',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  checkmarkText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  featureText: {
    fontSize: 14,
    color: TEXT,
    fontWeight: '600',
  },
  subscribeButton: {
    backgroundColor: BRAND,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 32,
    width: '100%',
    alignItems: 'center',
    marginBottom: 12,
    shadowColor: BRAND,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  subscribeButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '800',
  },
  closeButton: {
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  closeButtonText: {
    color: MUTED,
    fontSize: 14,
    fontWeight: '600',
  },
});
