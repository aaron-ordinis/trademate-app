// app/components/ReviewAppModal.tsx
import React, { useState } from "react";
import { Modal, View, Text, TouchableOpacity, StyleSheet, Platform } from "react-native";
import { Star } from "lucide-react-native";

const BRAND = "#2a86ff";
const TEXT = "#0b1220";
const MUTED = "#6b7280";
const CARD = "#ffffff";
const BORDER = "#e6e9ee";
const GOLD = "#fbbf24";

/**
 * @param {{ visible: boolean, onRateNow: () => void, onLater: () => void }} props
 */
export default function ReviewAppModal({ visible, onRateNow, onLater }) {
  const [rating, setRating] = useState(5); // Default to 5 stars

  if (!visible) return null;

  return (
    <Modal visible={visible} animationType="fade" transparent>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.title}>Enjoying TradeMate?</Text>
          <Text style={styles.subtitle}>
            If TradeMate saves you time, a quick review on {Platform.OS === "android" ? "Google Play" : "the App Store"} helps a lot!
          </Text>

          {/* 5-Star Rating */}
          <View style={styles.starsContainer}>
            {[1, 2, 3, 4, 5].map((star) => (
              <TouchableOpacity
                key={star}
                onPress={() => setRating(star)}
                style={styles.starButton}
                activeOpacity={0.7}
              >
                <Star
                  size={32}
                  color={star <= rating ? GOLD : "#e5e7eb"}
                  fill={star <= rating ? GOLD : "transparent"}
                  strokeWidth={1.5}
                />
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.ratingText}>
            {rating === 5 ? "Perfect! ⭐" : 
             rating === 4 ? "Great! 👍" : 
             rating === 3 ? "Good 👌" : 
             rating === 2 ? "Okay 🤔" : "Needs work 😔"}
          </Text>

          <View style={styles.actions}>
            <TouchableOpacity style={[styles.btn, styles.secondary]} onPress={onLater} activeOpacity={0.85}>
              <Text style={styles.secondaryText}>Maybe Later</Text>
            </TouchableOpacity>
            <TouchableOpacity 
              style={[styles.btn, styles.primary, rating < 4 && styles.primaryDisabled]} 
              onPress={rating >= 4 ? onRateNow : onLater} 
              activeOpacity={0.85}
            >
              <Text style={styles.primaryText}>
                {rating >= 4 ? "Rate TradeMate" : "Send Feedback"}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(12,18,32,0.5)", alignItems: "center", justifyContent: "center", padding: 16 },
  sheet: {
    width: "100%",
    maxWidth: 420,
    backgroundColor: CARD,
    borderRadius: 18,
    padding: 18,
    borderWidth: 1,
    borderColor: BORDER,
  },
  title: { fontSize: 18, fontWeight: "800", color: TEXT, marginBottom: 6, textAlign: "center" },
  subtitle: { fontSize: 14, color: MUTED, lineHeight: 20, marginBottom: 20, textAlign: "center" },
  
  starsContainer: { 
    flexDirection: "row", 
    justifyContent: "center", 
    alignItems: "center", 
    marginBottom: 12,
    gap: 4
  },
  starButton: { 
    padding: 4,
    borderRadius: 6
  },
  ratingText: { 
    fontSize: 16, 
    fontWeight: "700", 
    color: TEXT, 
    textAlign: "center", 
    marginBottom: 20,
    minHeight: 20
  },
  
  actions: { flexDirection: "row", gap: 10 },
  btn: { flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  primary: { backgroundColor: BRAND },
  primaryDisabled: { backgroundColor: MUTED },
  primaryText: { color: "#fff", fontWeight: "800", fontSize: 15 },
  secondary: { backgroundColor: "#fff", borderWidth: 1, borderColor: BORDER },
  secondaryText: { color: TEXT, fontWeight: "800", fontSize: 15 },
});