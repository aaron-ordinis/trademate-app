// components/AssistantFab.js
import React, { useEffect, useRef, useState } from "react";
import {
  View,
  TouchableOpacity,
  StyleSheet,
  Platform,
  Image,
  Animated,
  Easing,
  Text,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

// Add back the image import
const fabPng = require("../assets/images/fab.png");

const BORDER = "#e6e9ee";
const SIZE = 56; // Match main FAB size (was 64)

export default function AssistantFab({ onPress }) {
  const insets = useSafeAreaInsets();
  const bottomPad = Math.max(insets.bottom, 12);

  const [imgOk, setImgOk] = useState(true);

  const lastPressRef = useRef(0);

  // Idle pulse (outer ring)
  const idleScale = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(idleScale, { toValue: 1.06, duration: 1200, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(idleScale, { toValue: 1, duration: 1200, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [idleScale]);

  // Press pop (inner)
  const pressScale = useRef(new Animated.Value(1)).current;
  const onPressIn  = () => Animated.spring(pressScale, { toValue: 0.94, friction: 5, useNativeDriver: true }).start();
  const onPressOut = () => Animated.spring(pressScale, { toValue: 1,    friction: 4, tension: 120, useNativeDriver: true }).start();

  const handlePress = () => {
    const now = Date.now();
    if (now - lastPressRef.current < 600) return;
    lastPressRef.current = now;
    onPress?.();
  };

  const handleImageError = (error) => {
    console.log("FAB Image error:", error.nativeEvent?.error || error);
    setImgOk(false);
  };

  console.log("FAB rendering, imgOk:", imgOk); // Add this debug log

  return (
    <View pointerEvents="box-none" style={[styles.wrap, { bottom: bottomPad }]}>
      <Animated.View style={{ transform: [{ scale: idleScale }] }}>
        <TouchableOpacity
          onPressIn={onPressIn}
          onPressOut={onPressOut}
          onPress={handlePress}
          activeOpacity={0.9}
          style={styles.fab}
          accessibilityLabel="Open AI Assistant"
          accessibilityRole="button"
        >
          <Animated.View style={{ transform: [{ scale: pressScale }] }}>
            {imgOk ? (
              <Image
                source={fabPng}
                style={styles.icon}
                resizeMode="cover"
                onError={handleImageError}
                onLoad={() => console.log("FAB Image loaded successfully")}
              />
            ) : (
              <Text style={styles.textIcon}>🤖</Text>
            )}
          </Animated.View>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { 
    position: "absolute", 
    left: 18, // Match main FAB's right: 18 for equal spacing
    zIndex: 9999,
  },
  fab: {
    width: SIZE, height: SIZE, borderRadius: SIZE / 2,
    backgroundColor: "#ffffff",
    alignItems: "center", justifyContent: "center",
    borderWidth: 1, 
    borderColor: "#e6e9ee",
    overflow: "visible",
    zIndex: 10000,
    // Match main FAB shadow exactly
    ...Platform.select({
      ios: {
        shadowColor: "#2a86ff", // Use brand color like main FAB
        shadowOpacity: 0.35,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 6 },
      },
      android: { elevation: 6 },
    }),
  },
  icon: { 
    width: SIZE - 8, 
    height: SIZE - 8,
    borderRadius: (SIZE - 8) / 2,
  },
  textIcon: { fontSize: 28, color: "#3b82f6" },
});