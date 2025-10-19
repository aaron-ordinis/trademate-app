// app/components/ReviewAppModal.tsx
import React, { useState } from "react";
import { Modal, View, Text, Pressable, StyleSheet, Platform } from "react-native";
import { Star, Heart } from "lucide-react-native";

const BRAND = "#2a86ff";
const TEXT = "#0b1220";
const MUTED = "#6b7280";
const CARD = "#ffffff";
const BORDER = "#e6e9ee";

/**
 * @param {{ visible: boolean, onRateNow: () => void, onLater: () => void }} props
 */
export default function ReviewAppModal({ visible, onRateNow, onLater }) {
  if (!visible) return null;

  return (
    <Modal visible={visible} animationType="fade" transparent>
      <View style={styles.overlay}>
        <View style={styles.container}>
          <View style={styles.iconContainer}>
            <Heart size={24} color="#2a86ff" fill="#2a86ff" />
          </View>
          
          <Text style={styles.title}>Enjoying TradeMate?</Text>
          <Text style={styles.message}>
            Your feedback helps us improve and reach more professionals like you.
          </Text>
          
          <View style={styles.buttonContainer}>
            <Pressable
              style={[styles.button, styles.primaryButton]}
              onPress={onRateNow}
              android_ripple={{ color: 'rgba(255,255,255,0.2)' }}
            >
              <Star size={16} color="#ffffff" />
              <Text style={styles.primaryButtonText}>Rate App</Text>
            </Pressable>
            
            <Pressable
              style={[styles.button, styles.secondaryButton]}
              onPress={onLater}
              android_ripple={{ color: 'rgba(0,0,0,0.05)' }}
            >
              <Text style={styles.secondaryButtonText}>Maybe Later</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  container: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 320,
    alignItems: 'center',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.25,
        shadowRadius: 20,
      },
      android: {
        elevation: 12,
      },
    }),
  },
  iconContainer: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#f0f7ff',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#0b1220',
    textAlign: 'center',
    marginBottom: 8,
  },
  message: {
    fontSize: 15,
    color: '#6b7280',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24,
  },
  buttonContainer: {
    width: '100%',
    gap: 12,
  },
  button: {
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  primaryButton: {
    backgroundColor: '#2a86ff',
    ...Platform.select({
      ios: {
        shadowColor: '#2a86ff',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.3,
        shadowRadius: 4,
      },
      android: {
        elevation: 3,
      },
    }),
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  secondaryButton: {
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e6e9ee',
  },
  secondaryButtonText: {
    color: '#6b7280',
    fontSize: 16,
    fontWeight: '600',
  },
});