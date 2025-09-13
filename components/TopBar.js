import React from "react";
import { View, Text, TouchableOpacity, StyleSheet, Platform } from "react-native";

const TEXT = "#0b1220";
const CARD = "#ffffff";
const BORDER = "#e6e9ee";

export default function TopBar({ title, right }) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.h1}>{title}</Text>
      <View style={{ flexDirection: "row", gap: 8 }}>
        {right}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  h1: { color: TEXT, fontSize: 24, fontWeight: "800" },
});

export const IconBtn = ({ children, onPress, size = 38 }) => (
  <TouchableOpacity
    onPress={onPress}
    style={{
      height: size, width: size, borderRadius: 10, borderWidth: 1, borderColor: BORDER,
      alignItems: "center", justifyContent: "center", backgroundColor: CARD,
    }}
    activeOpacity={0.9}
  >
    {children}
  </TouchableOpacity>
);