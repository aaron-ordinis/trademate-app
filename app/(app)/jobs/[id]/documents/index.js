// app/(app)/jobs/[id]/documents/index.js
import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Platform,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Pressable,
  TextInput,
  StatusBar,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as NavigationBar from "expo-navigation-bar";
import * as SystemUI from "expo-system-ui";
import * as ImagePicker from "expo-image-picker";
import { Feather } from "@expo/vector-icons";

import { supabase } from "../../../../../lib/supabase";
import { jobHref } from "../../../../../lib/nav";
import {
  pickAnyFile,
  uploadJobFile,
  listJobDocs,
  deleteJobDoc,
} from "../../../../../lib/files";

import {
  Plus,
  FileText,
  Image as ImageIcon,
  ExternalLink,
  Trash2,
  Pencil,
} from "lucide-react-native";

/* ---------- theme (match create.js / expenses) ---------- */
const BG = "#ffffff";
const CARD = "#ffffff";
const TEXT = "#0b1220";
const MUTED = "#6b7280";
const BORDER = "#e6e9ee";
const BRAND = "#2a86ff";
const DANGER = "#e11d48";

/* ---------- helpers ---------- */
const isImageLike = (mime = "", name = "") => {
  const lower = (mime || name || "").toLowerCase();
  return (
    lower.startsWith("image/") ||
    /\.(png|jpe?g|gif|webp|heic|heif)$/i.test(lower)
  );
};
const isPdfLike = (mime = "", name = "") => {
  const lower = (mime || name || "").toLowerCase();
  return lower.includes("pdf") || /\.pdf$/.test(lower);
};
const isOfficeLike = (mime = "", name = "") => {
  const s = (mime || name || "").toLowerCase();
  return (
    s.includes("ms-excel") ||
    s.includes("spreadsheet") ||
    /\.(xlsx?|csv)$/i.test(s) ||
    s.includes("msword") ||
    s.includes("word") ||
    /\.docx?$/i.test(s) ||
    s.includes("powerpoint") ||
    /\.pptx?$/i.test(s)
  );
};
const isTextLike = (mime = "", name = "") => {
  const s = (mime || name || "").toLowerCase();
  return s.startsWith("text/") || /\.(txt|log|md|json)$/i.test(s);
};
const iconFor = (mime = "", name = "") => {
  if (isPdfLike(mime, name)) return <FileText size={18} color={BRAND} />;
  if (isImageLike(mime, name)) return <ImageIcon size={18} color={"#0891b2"} />;
  if (isOfficeLike(mime, name)) return <FileText size={18} color={"#7c3aed"} />;
  if (isTextLike(mime, name)) return <FileText size={18} color={"#22c55e"} />;
  return <FileText size={18} color={MUTED} />;
};

export default function JobDocuments() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams();
  const jobId = String(id || "");

  const [busy, setBusy] = useState(false);
  const [docs, setDocs] = useState([]);
  const [sheetOpen, setSheetOpen] = useState(false);

  // rename modal
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [renameItem, setRenameItem] = useState(null);

  /* ---------- Force white system chrome like create.js/expenses ---------- */
  useEffect(() => {
    const forceWhite = async () => {
      try {
        StatusBar.setBarStyle("dark-content", false);
        if (Platform.OS === "android") {
          StatusBar.setBackgroundColor("#ffffff", false);
          await NavigationBar.setBackgroundColorAsync("#ffffff");
          await NavigationBar.setButtonStyleAsync("dark");
          if (NavigationBar.setBorderColorAsync) {
            await NavigationBar.setBorderColorAsync("#ffffff");
          }
        }
        await SystemUI.setBackgroundColorAsync("#ffffff");
      } catch {}
    };
    forceWhite();
  }, []);

  const load = useCallback(async () => {
    if (!jobId) return;
    setBusy(true);
    try {
      const rows = await listJobDocs(jobId);
      setDocs(rows);
    } catch (e) {
      console.error("[docs] load", e);
      Alert.alert("Error", e?.message || "Failed to load documents.");
    } finally {
      setBusy(false);
    }
  }, [jobId]);

  useEffect(() => {
    load();
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  /* ---------- add from file picker ---------- */
  const addFromPicker = async () => {
    try {
      const auth = await supabase.auth.getUser();
      const user = auth?.data?.user;
      if (!user) return;

      const file = await pickAnyFile();
      if (!file) return;

      setBusy(true);
      await uploadJobFile({ userId: user.id, jobId, kind: "other", file });
      await load();
    } catch (e) {
      console.error("[docs] upload picker", e);
      Alert.alert("Upload failed", e?.message || "Could not upload file.");
    } finally {
      setBusy(false);
      setSheetOpen(false);
    }
  };

  /* ---------- add from camera ---------- */
  const addFromCamera = async () => {
    try {
      const auth = await supabase.auth.getUser();
      const user = auth?.data?.user;
      if (!user) return;

      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Permission needed", "Camera access is required to take a photo.");
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        quality: 0.9,
        base64: false,
        allowsEditing: false,
      });
      if (result.canceled || !result.assets?.[0]) return;

      const a = result.assets[0];
      const photoFile = {
        uri: a.uri,
        name: a.fileName || "photo.jpg",
        size: a.fileSize ?? null,
        mimeType: a.type || "image/jpeg",
      };

      setBusy(true);
      await uploadJobFile({ userId: user.id, jobId, kind: "photo", file: photoFile });
      await load();
    } catch (e) {
      console.error("[docs] upload camera", e);
      Alert.alert("Upload failed", e?.message || "Could not upload photo.");
    } finally {
      setBusy(false);
      setSheetOpen(false);
    }
  };

  /* ---------- open / preview (navigate to dedicated Preview screen) ---------- */
  const openRow = (row) => {
    if (!row?.url) return;
    router.push({
      pathname: "/(app)/documents/preview",
      params: {
        url: row.url,
        name: row.name || row.kind || "document",
        mime: row.mime || "",
        jobId, // for Back to return to this job
      },
    });
  };

  const externalOpen = (row) => {
    if (!row?.url) return;
    Linking.openURL(row.url).catch(() => {
      Alert.alert("Can't open", "This URL can't be opened on your device.");
    });
  };

  /* ---------- delete ---------- */
  const removeRow = async (row) => {
    try {
      setBusy(true);
      await deleteJobDoc(row);
      await load();
    } catch (e) {
      console.error("[docs] delete", e);
      Alert.alert("Delete failed", e?.message || "Could not delete file.");
    } finally {
      setBusy(false);
    }
  };

  /* ---------- rename ---------- */
  const startRename = (row) => {
    setRenameItem(row);
    setRenameValue(row?.name || "");
    setRenameOpen(true);
  };

  const saveRename = async () => {
    if (!renameItem) return;
    const name = renameValue.trim();
    if (!name) {
      Alert.alert("Name required", "Please enter a file name.");
      return;
    }
    try {
      setBusy(true);
      const { error } = await supabase
        .from("documents")
        .update({ name })
        .eq("id", renameItem.id);
      if (error) throw error;
      setRenameOpen(false);
      setRenameItem(null);
      setRenameValue("");
      await load();
    } catch (e) {
      console.error("[docs] rename", e);
      Alert.alert("Rename failed", e?.message || "Could not rename.");
    } finally {
      setBusy(false);
    }
  };

  /* ---------- UI ---------- */
  const countLabel = `${docs.length} ${docs.length === 1 ? "file" : "files"}`;

  return (
    <View style={s.screen}>
      <StatusBar barStyle="dark-content" backgroundColor="#ffffff" translucent={false} />
      {/* Safe top like create.js / expenses */}
      <View style={{ height: insets.top, backgroundColor: CARD }} />

      {/* Header: back, centered title, spacer */}
      <View style={s.header}>
        <TouchableOpacity
          style={s.backBtn}
          onPress={() => router.back()}
        >
          <Feather name="arrow-left" size={20} color={TEXT} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Documents</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Info row (identical concept to Expenses' total pill) */}
      <View style={s.infoRow}>
        <View style={s.totalPill}>
          <Text style={s.totalPillTxt}>{countLabel}</Text>
        </View>
        {busy ? <ActivityIndicator size="small" color={BRAND} /> : null}
      </View>

      <FlatList
        data={docs}
        keyExtractor={(it) => String(it.id)}
        refreshing={busy}
        onRefresh={load}
        contentContainerStyle={{ padding: 12, paddingBottom: 96 + insets.bottom }}
        renderItem={({ item }) => (
          <TouchableOpacity
            activeOpacity={0.88}
            onPress={() => openRow(item)}
            style={s.card}
          >
            <View style={{ marginRight: 10 }}>{iconFor(item.mime, item.name)}</View>
            <View style={{ flex: 1 }}>
              <Text style={s.name} numberOfLines={1}>
                {item.name || item.kind}
              </Text>
              <Text style={s.meta} numberOfLines={1}>
                {(item.mime || "file")} • {new Date(item.created_at).toLocaleString()}
              </Text>
            </View>

            <TouchableOpacity
              style={[s.iconBtn, { marginRight: 6 }]}
              onPress={() => externalOpen(item)}
            >
              <ExternalLink size={18} color={BRAND} />
            </TouchableOpacity>

            <TouchableOpacity
              style={[s.iconBtn, { marginRight: 6 }]}
              onPress={() => startRename(item)}
            >
              <Pencil size={18} color={TEXT} />
            </TouchableOpacity>

            <TouchableOpacity
              style={[s.iconBtn, s.iconBtnDanger]}
              onPress={() => removeRow(item)}
            >
              <Trash2 size={18} color={DANGER} />
            </TouchableOpacity>
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          !busy ? (
            <View style={{ alignItems: "center", marginTop: 24 }}>
              <Text style={{ color: MUTED, fontWeight: "800", fontSize: 13 }}>
                No documents yet.
              </Text>
            </View>
          ) : null
        }
      />

      {/* FAB (match Expenses sizing/feel) */}
      <TouchableOpacity
        style={[s.fab, { bottom: 24 + insets.bottom }]}
        onPress={() => setSheetOpen(true)}
        activeOpacity={0.92}
      >
        <Plus size={20} color="#fff" />
      </TouchableOpacity>

      {/* Add options sheet */}
      <Modal visible={sheetOpen} animationType="fade" transparent>
        <Pressable style={s.backdrop} onPress={() => setSheetOpen(false)} />
        <View style={s.sheet}>
          <View style={s.handle} />
          <View style={s.sheetHead}>
            <Text style={s.sheetTitle}>Add document</Text>
          </View>

          <TouchableOpacity style={s.sheetBtn} onPress={addFromPicker}>
            <FileText size={18} color={TEXT} />
            <Text style={s.sheetBtnTxt}>Upload file</Text>
          </TouchableOpacity>

          <TouchableOpacity style={s.sheetBtn} onPress={addFromCamera}>
            <ImageIcon size={18} color={TEXT} />
            <Text style={s.sheetBtnTxt}>Take photo</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[s.sheetBtn, { marginTop: 8 }]}
            onPress={() => setSheetOpen(false)}
          >
            <Text style={[s.sheetBtnTxt, { fontWeight: "900", color: MUTED }]}>
              Cancel
            </Text>
          </TouchableOpacity>
        </View>
      </Modal>

      {/* Rename modal */}
      <Modal visible={renameOpen} animationType="fade" transparent>
        <Pressable style={s.backdrop} onPress={() => setRenameOpen(false)} />
        <View style={s.renameBox}>
          <View style={s.renameHeader}>
            <Text style={s.renameTitle}>Rename file</Text>
            <TouchableOpacity onPress={() => setRenameOpen(false)} style={s.iconBtn}>
              <Feather name="x" size={18} color={MUTED} />
            </TouchableOpacity>
          </View>

          <TextInput
            value={renameValue}
            onChangeText={setRenameValue}
            placeholder="New file name"
            placeholderTextColor={MUTED}
            style={s.renameInput}
          />
          <View style={{ flexDirection: "row", gap: 10 }}>
            <TouchableOpacity
              style={[s.sheetBtn, { flex: 1, backgroundColor: "#eef2f7" }]}
              onPress={() => setRenameOpen(false)}
            >
              <Text style={[s.sheetBtnTxt, { color: TEXT }]}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.primaryAction, { flex: 1 }]}
              onPress={saveRename}
              activeOpacity={0.9}
            >
              <Text style={s.primaryActionTxt}>Save</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Safe bottom */}
      <View style={{ height: insets.bottom, backgroundColor: "#ffffff" }} />
    </View>
  );
}

/* ---------- styles (mirrors Expenses) ---------- */
const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },

  /* header (match create.js / expenses) */
  header: {
    backgroundColor: CARD,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "900",
    color: TEXT,
  },

  /* info row under header */
  infoRow: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  totalPill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "#eef2ff",
    borderWidth: 1,
    borderColor: "#c7d2fe",
  },
  totalPillTxt: { color: BRAND, fontWeight: "900", fontSize: 13 },

  /* card list (compact like expenses) */
  card: {
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
    padding: 10,
    marginBottom: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    ...Platform.select({
      ios: {
        shadowColor: "#0b1220",
        shadowOpacity: 0.04,
        shadowRadius: 6,
        shadowOffset: { width: 0, height: 2 },
      },
      android: { elevation: 2 },
    }),
  },
  name: { color: TEXT, fontWeight: "900", fontSize: 14 },
  meta: { color: MUTED, marginTop: 2, fontWeight: "700", fontSize: 12 },

  iconBtn: {
    height: 28,
    width: 28,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f3f4f6",
    borderWidth: 1,
    borderColor: BORDER,
  },
  iconBtnDanger: { backgroundColor: "#fee2e2", borderColor: "#fecaca" },

  /* FAB */
  fab: {
    position: "absolute",
    right: 16,
    height: 52,
    width: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: BRAND,
    shadowColor: "#1e293b",
    shadowOpacity: 0.22,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },

  /* bottom sheet (match expenses) */
  backdrop: { flex: 1, backgroundColor: "#0008" },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: CARD,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    padding: 16,
    borderTopWidth: 1,
    borderColor: BORDER,
  },
  handle: {
    alignSelf: "center",
    width: 44,
    height: 5,
    borderRadius: 999,
    backgroundColor: BORDER,
    marginBottom: 8,
  },
  sheetHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  sheetTitle: { color: TEXT, fontWeight: "900", fontSize: 16 },
  sheetBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: "#f8fafc",
    marginTop: 8,
  },
  sheetBtnTxt: { color: TEXT, fontWeight: "800" },

  /* rename modal (match compact styles) */
  renameBox: {
    position: "absolute",
    left: 14,
    right: 14,
    bottom: "25%",
    backgroundColor: CARD,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: BORDER,
    ...Platform.select({
      ios: {
        shadowColor: "#0b1220",
        shadowOpacity: 0.1,
        shadowRadius: 18,
        shadowOffset: { width: 0, height: 8 },
      },
      android: { elevation: 4 },
    }),
  },
  renameHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  renameTitle: { color: TEXT, fontWeight: "900", fontSize: 16 },
  renameInput: {
    backgroundColor: "#fff",
    color: TEXT,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: BORDER,
    marginBottom: 12,
    fontSize: 14,
    fontWeight: "600",
  },

  /* primary action (reuse from expenses look) */
  primaryAction: {
    backgroundColor: BRAND,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: BRAND,
  },
  primaryActionTxt: { color: "#fff", fontWeight: "900" },
});