import React from "react";
import { View, Text, StyleSheet, Platform } from "react-native";
import { Settings } from "lucide-react-native";
import { useRouter } from "expo-router";
import TopBar, { IconBtn } from "../../../../components/TopBar";

const BG = "#f5f7fb";
const MUTED = "#6b7280";

export default function InvoicesHome() {
  const router = useRouter();

  return (
    <View style={styles.screen}>
      <TopBar
        title="Invoices"
        right={
          <IconBtn onPress={() => router.push("/(app)/settings")}>
            <Settings size={20} color={MUTED} />
          </IconBtn>
        }
      />
      <Text style={styles.sub}>Convert accepted quotes to invoices and track payments.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG, paddingTop: Platform.OS === "android" ? 8 : 0 },
  sub: { color: MUTED, fontWeight: "700", marginHorizontal: 16 },
});