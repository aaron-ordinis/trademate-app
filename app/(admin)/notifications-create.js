import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Platform,
  Alert,
  ActivityIndicator,
} from "react-native";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { supabase } from "../../lib/supabase";

const BRAND = "#2a86ff";
const CARD = "#fff";
const TEXT = "#0b1220";
const BORDER = "#e6e9ee";
const BG = "#f5f7fb";

export default function AdminNotificationCreate() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);

  const sendToAll = async () => {
    if (!title.trim()) {
      Alert.alert("Title required", "Please enter a notification title.");
      return;
    }
    setSending(true);
    try {
      const { data: users, error } = await supabase
        .from("profiles")
        .select("id");
      if (error) throw error;
      if (!users || users.length === 0) {
        Alert.alert("No users found");
        setSending(false);
        return;
      }
      const batchSize = 1000;
      for (let i = 0; i < users.length; i += batchSize) {
        const batch = users.slice(i, i + batchSize);
        const rows = batch.map((u) => ({
          user_id: u.id,
          title,
          body,
        }));
        const { error: insError } = await supabase
          .from("notifications")
          .insert(rows);
        if (insError) throw insError;
      }
      Alert.alert("Success", "Notification sent to all users.");
      setTitle("");
      setBody("");
    } catch (e) {
      Alert.alert("Error", e.message || "Failed to send notification.");
    } finally {
      setSending(false);
    }
  };

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => router.back()}
        >
          <Feather name="arrow-left" size={22} color={TEXT} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Send Notification</Text>
        <View style={{ width: 40 }} />
      </View>
      <View style={styles.card}>
        <Text style={styles.label}>Title</Text>
        <TextInput
          style={styles.input}
          value={title}
          onChangeText={setTitle}
          placeholder="Notification title"
          placeholderTextColor="#b0b4bb"
        />
        <Text style={styles.label}>Body</Text>
        <TextInput
          style={[styles.input, { height: 90, textAlignVertical: "top" }]}
          value={body}
          onChangeText={setBody}
          placeholder="Notification body (optional)"
          placeholderTextColor="#b0b4bb"
          multiline
        />
        <TouchableOpacity
          style={[styles.sendBtn, sending && { opacity: 0.6 }]}
          onPress={sendToAll}
          disabled={sending}
          activeOpacity={0.85}
        >
          {sending ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Feather name="send" size={18} color="#fff" style={{ marginRight: 8 }} />
          )}
          <Text style={styles.sendBtnText}>
            {sending ? "Sending..." : "Send to All Users"}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG, paddingTop: Platform.OS === "ios" ? 44 : 0 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 12,
    backgroundColor: CARD,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    flex: 1,
    textAlign: "center",
    fontSize: 20,
    fontWeight: "900",
    color: TEXT,
  },
  card: {
    margin: 18,
    backgroundColor: CARD,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 18,
    ...Platform.select({
      ios: {
        shadowColor: "#0b1220",
        shadowOpacity: 0.08,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 4 },
      },
      android: { elevation: 2 },
    }),
  },
  label: {
    fontWeight: "700",
    color: TEXT,
    marginBottom: 6,
    marginTop: 10,
  },
  input: {
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 8,
    padding: 10,
    fontSize: 16,
    color: TEXT,
    backgroundColor: "#f8fafc",
    marginBottom: 8,
  },
  sendBtn: {
    marginTop: 18,
    backgroundColor: BRAND,
    borderRadius: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
  },
  sendBtnText: {
    color: "#fff",
    fontWeight: "bold",
    fontSize: 16,
    marginLeft: 4,
  },
});
