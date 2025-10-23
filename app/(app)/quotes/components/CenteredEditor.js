import React from "react";
import { Modal, View, Text, TouchableOpacity, Platform, Dimensions } from "react-native";
import { CARD, BORDER, TEXT } from "./ui";

export default function CenteredEditor({ visible, onClose, children }) {
  const { width } = Dimensions.get("window");
  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      presentationStyle="overFullScreen"
      onRequestClose={onClose}
    >
      <View style={{ position: "absolute", inset: 0, backgroundColor: "rgba(0,0,0,0.5)" }} />
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: 12 }}>
        <View style={{
          backgroundColor: CARD,
          borderRadius: 16,
          padding: 12,
          borderWidth: 1,
          borderColor: BORDER,
          width: Math.min(width - 32, 560),
          ...Platform.select({
            ios: { shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 16, shadowOffset: { width: 0, height: 6 } },
            android: { elevation: 14 },
          }),
        }}>
          <View style={{ flexDirection: "row", justifyContent: "flex-end", marginBottom: 8 }}>
            <TouchableOpacity
              onPress={onClose}
              style={{ paddingVertical: 6, paddingHorizontal: 10, borderRadius: 10, backgroundColor: "#f3f4f6" }}
            >
              <Text style={{ color: TEXT, fontWeight: "700" }}>Close</Text>
            </TouchableOpacity>
          </View>
          {children}
        </View>
      </View>
    </Modal>
  );
}