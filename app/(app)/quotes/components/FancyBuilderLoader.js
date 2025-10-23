import React, { useEffect, useRef } from "react";
import { View, Text, Animated, Easing, Dimensions } from "react-native";
import { CARD, BORDER, TEXT, MUTED, BRAND } from "./ui";

function LoadingDot({ delay = 0 }) {
  const bounce = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(bounce, { toValue: 1, duration: 400, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(bounce, { toValue: 0, duration: 400, easing: Easing.in(Easing.quad), useNativeDriver: true }),
        Animated.delay(600),
      ])
    );
    animation.start();
    return () => animation.stop();
  }, [bounce, delay]);
  const translateY = bounce.interpolate({ inputRange: [0, 1], outputRange: [0, -8] });
  return <Animated.View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: BRAND, opacity: 0.6, transform: [{ translateY }] }} />;
}

export default function FancyBuilderLoader({ visible, message = "Preparing data…", progress = 0.1 }) {
  const scale = useRef(new Animated.Value(1)).current;
  const bounce = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) { opacity.setValue(0); return; }
    Animated.timing(opacity, { toValue: 1, duration: 300, useNativeDriver: true }).start();

    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(scale, { toValue: 1.08, duration: 1200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(scale, { toValue: 1.0, duration: 1200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])
    );

    const bounceAnim = Animated.sequence([
      Animated.timing(bounce, { toValue: 1, duration: 200, easing: Easing.out(Easing.back(1.5)), useNativeDriver: true }),
      Animated.timing(bounce, { toValue: 0, duration: 300, useNativeDriver: true }),
    ]);

    pulse.start(); bounceAnim.start();
    return () => { pulse.stop(); bounce.setValue(0); };
  }, [visible, scale, bounce, opacity]);

  const bounceScale = bounce.interpolate({ inputRange: [0, 1], outputRange: [1, 1.1] });

  if (!visible) return null;

  return (
    <Animated.View style={{
      position: "absolute",
      inset: 0,
      justifyContent: "center",
      alignItems: "center",
      padding: 24,
      opacity,
    }}>
      <View style={{ position: "absolute", inset: 0, backgroundColor: "#FFFFFF" }} />
      <Animated.View style={{
        width: Math.min(Dimensions.get("window").width - 40, 380),
        backgroundColor: CARD,
        borderRadius: 20,
        borderWidth: 1,
        borderColor: BORDER,
        padding: 28,
        alignItems: "center",
        shadowColor: "#0b1220",
        shadowOpacity: 0.15,
        shadowRadius: 24,
        shadowOffset: { width: 0, height: 12 },
        elevation: 16,
        transform: [{ scale: bounceScale }],
      }}>
        <Text style={{ color: TEXT, fontWeight: "900", fontSize: 20, marginBottom: 6 }}>Building your quote</Text>
        <Text style={{ color: MUTED, marginBottom: 20, textAlign: "center", fontSize: 15, lineHeight: 20 }}>{message}</Text>
        <Text style={{ color: MUTED, fontSize: 13, textAlign: "center", marginBottom: 16 }}>This usually takes a moment</Text>
        <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
          <LoadingDot delay={0} />
          <LoadingDot delay={200} />
          <LoadingDot delay={400} />
        </View>
      </Animated.View>
    </Animated.View>
  );
}