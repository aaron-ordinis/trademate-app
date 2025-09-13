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
  Image,
  ScrollView,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import * as ImagePicker from "expo-image-picker";
import { WebView } from "react-native-webview";

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
  ChevronLeft,
  FileText,
  Image as ImageIcon,
  ExternalLink,
  Trash2,
  Pencil,
  X,
} from "lucide-react-native";

/* ---------- theme ---------- */
const BG = "#f5f7fb";
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
  return <FileText size={18} color={MUTED} />;
};

/* ---------- In-app previewer for PDFs/Office/Text (stays inside modal) ---------- */
function DocPreview({ item, onFallbackExternal }) {
  const [useFallback, setUseFallback] = useState(false);
  const url = item?.url || "";
  const gview = `https://docs.google.com/gview?embedded=1&url=${encodeURIComponent(url)}`;

  // Use Google Docs Viewer for Office + (fallback) PDFs
  const shouldUseGView =
    useFallback || isOfficeLike(item.mime, item.name) || isPdfLike(item.mime, item.name);

  // Simple inline note for text-y files (we still display via WebView below)
  const showTextHint = isTextLike(item.mime, item.name);

  return (
    <View style={{ flex: 1, backgroundColor: "#fff" }}>
      {showTextHint ? (
        <View style={{ paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1, borderColor: BORDER }}>
          <Text style={{ color: MUTED, fontWeight: "700" }}>
            If this text file doesn't render due to CORS, tap the external icon.
          </Text>
        </View>
      ) : null}

      <WebView
        source={{ uri: shouldUseGView ? gview : url }}
        style={{ flex: 1 }}
        originWhitelist={["*"]}
        setSupportMultipleWindows={false}
        startInLoadingState
        onError={() => {
          if (!useFallback) setUseFallback(true);
          else onFallbackExternal && onFallbackExternal();
        }}
        onHttpError={() => {
          if (!useFallback) setUseFallback(true);
          else onFallbackExternal && onFallbackExternal();
        }}
        onShouldStartLoadWithRequest={(req) => {
          // Keep navigation inside WebView; block target=_blank attempts
          if (req.navigationType === "click" && req.url !== (shouldUseGView ? gview : url)) {
            return false;
          }
          return true;
        }}
      />
    </View>
  );
}

export default function JobDocuments() {
  const router = useRouter();
  const { id } = useLocalSearchParams();
  const jobId = String(id || "");

  const [busy, setBusy] = useState(false);
  const [items, setItems] = useState([]);
  const [sheetOpen, setSheetOpen] = useState(false);

  // rename modal
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [renameItem, setRenameItem] = useState(null);

  // preview modal
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewItem, setPreviewItem] = useState(null);

  const load = useCallback(async () => {
    if (!jobId) return;
    setBusy(true);
    try {
      const rows = await listJobDocs(jobId);
      setItems(rows);
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

  /* ---------- open / preview ---------- */
  const openRow = (row) => {
    if (!row?.url) return;
    setPreviewItem(row);
    setPreviewOpen(true);
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
      const { error } = await supabase.from("documents").update({ name }).eq("id", renameItem.id);
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

  return (
    <View style={s.screen}>
      {/* header */}
      <View style={s.top}>
        <TouchableOpacity style={s.back} onPress={() => router.replace(jobHref(jobId))}>
          <ChevronLeft color={TEXT} size={20} />
        </TouchableOpacity>
        <Text style={s.title}>Documents</Text>
        <View style={{ width: 34 }} />
      </View>

      {busy ? <ActivityIndicator style={{ marginTop: 8 }} color={BRAND} /> : null}

      <FlatList
        data={items}
        keyExtractor={(it) => String(it.id)}
        refreshing={busy}
        onRefresh={load}
        contentContainerStyle={{ padding: 12, paddingBottom: 96 }}
        renderItem={({ item }) => (
          <TouchableOpacity activeOpacity={0.85} onPress={() => openRow(item)} style={s.card}>
            <View style={{ marginRight: 10 }}>{iconFor(item.mime, item.name)}</View>
            <View style={{ flex: 1 }}>
              <Text style={s.name} numberOfLines={1}>
                {item.name || item.kind}
              </Text>
              <Text style={s.meta}>
                {(item.mime || "file")} • {new Date(item.created_at).toLocaleString()}
              </Text>
            </View>

            <TouchableOpacity style={[s.iconBtn, { marginRight: 6 }]} onPress={() => externalOpen(item)}>
              <ExternalLink size={18} color={BRAND} />
            </TouchableOpacity>

            <TouchableOpacity style={[s.iconBtn, { marginRight: 6 }]} onPress={() => startRename(item)}>
              <Pencil size={18} color={TEXT} />
            </TouchableOpacity>

            <TouchableOpacity
              style={[s.iconBtn, { backgroundColor: "#fee2e2", borderColor: "#fecaca" }]}
              onPress={() => removeRow(item)}
            >
              <Trash2 size={18} color={DANGER} />
            </TouchableOpacity>
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          !busy ? (
            <View style={{ alignItems: "center", marginTop: 28 }}>
              <Text style={{ color: MUTED, fontWeight: "800" }}>No documents yet.</Text>
            </View>
          ) : null
        }
      />

      {/* Floating Add Button */}
      <TouchableOpacity style={s.fab} onPress={() => setSheetOpen(true)} activeOpacity={0.9}>
        <Plus size={22} color="#fff" />
      </TouchableOpacity>

      {/* Add options sheet */}
      <Modal visible={sheetOpen} animationType="fade" transparent>
        <Pressable style={s.backdrop} onPress={() => setSheetOpen(false)} />
        <View style={s.sheet}>
          <View style={s.sheetHandle} />
          <Text style={s.sheetTitle}>Add document</Text>

          <TouchableOpacity style={s.sheetBtn} onPress={addFromPicker}>
            <FileText size={18} color={TEXT} />
            <Text style={s.sheetBtnTxt}>Upload file</Text>
          </TouchableOpacity>

          <TouchableOpacity style={s.sheetBtn} onPress={addFromCamera}>
            <ImageIcon size={18} color={TEXT} />
            <Text style={s.sheetBtnTxt}>Take photo</Text>
          </TouchableOpacity>

          <TouchableOpacity style={[s.sheetBtn, { marginTop: 8 }]} onPress={() => setSheetOpen(false)}>
            <Text style={[s.sheetBtnTxt, { fontWeight: "900", color: MUTED }]}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </Modal>

      {/* Rename modal */}
      <Modal visible={renameOpen} animationType="fade" transparent>
        <Pressable style={s.backdrop} onPress={() => setRenameOpen(false)} />
        <View style={s.renameBox}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <Text style={s.renameTitle}>Rename file</Text>
            <TouchableOpacity onPress={() => setRenameOpen(false)} style={s.iconBtn}>
              <X size={18} color={MUTED} />
            </TouchableOpacity>
          </View>
          <TextInput value={renameValue} onChangeText={setRenameValue} placeholder="New file name" style={s.renameInput} />
          <View style={{ flexDirection: "row", gap: 10 }}>
            <TouchableOpacity style={[s.sheetBtn, { flex: 1, backgroundColor: "#eef2f7" }]} onPress={() => setRenameOpen(false)}>
              <Text style={[s.sheetBtnTxt, { color: TEXT }]}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.sheetBtn, { flex: 1, backgroundColor: BRAND, borderColor: BRAND }]} onPress={saveRename}>
              <Text style={[s.sheetBtnTxt, { color: "#fff" }]}>Save</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Preview modal (image zoom or in-app WebView for pdf/office/text) */}
      <Modal visible={previewOpen} animationType="slide" transparent>
        <View style={s.previewWrap}>
          <View style={s.previewBar}>
            <TouchableOpacity style={s.back} onPress={() => setPreviewOpen(false)}>
              <ChevronLeft color={TEXT} size={20} />
            </TouchableOpacity>
            <Text style={s.previewTitle} numberOfLines={1}>
              {previewItem?.name || "Preview"}
            </Text>
            <TouchableOpacity style={s.iconBtn} onPress={() => externalOpen(previewItem)}>
              <ExternalLink size={18} color={BRAND} />
            </TouchableOpacity>
          </View>

          {previewItem && isImageLike(previewItem.mime, previewItem.name) ? (
            <ScrollView
              style={{ flex: 1, backgroundColor: "#000" }}
              maximumZoomScale={4}
              minimumZoomScale={1}
              contentContainerStyle={{ justifyContent: "center", alignItems: "center" }}
            >
              <Image source={{ uri: previewItem.url }} resizeMode="contain" style={{ width: "100%", height: "100%" }} />
            </ScrollView>
          ) : previewItem ? (
            <DocPreview item={previewItem} onFallbackExternal={() => externalOpen(previewItem)} />
          ) : null}
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG, paddingTop: Platform.OS === "android" ? 8 : 0 },

  top: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 10 },
  back: {
    height: 34,
    width: 34,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: CARD,
  },
  title: { flex: 1, textAlign: "center", fontSize: 18, fontWeight: "900", color: TEXT },

  card: {
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 14,
    padding: 12,
    marginBottom: 10,
    flexDirection: "row",
    alignItems: "center",
    shadowColor: "#0b1220",
    shadowOpacity: 0.03,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 1,
  },
  name: { color: TEXT, fontWeight: "900" },
  meta: { color: MUTED, marginTop: 2, fontWeight: "700" },

  iconBtn: {
    height: 32,
    width: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f3f4f6",
    borderWidth: 1,
    borderColor: BORDER,
  },

  /* FAB */
  fab: {
    position: "absolute",
    right: 16,
    bottom: 24 + (Platform.OS === "ios" ? 12 : 0),
    height: 56,
    width: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: BRAND,
    shadowColor: "#1e293b",
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },

  /* Sheet */
  backdrop: { flex: 1, backgroundColor: "#0008" },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    padding: 16,
    backgroundColor: CARD,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderTopWidth: 1,
    borderColor: BORDER,
  },
  sheetHandle: { alignSelf: "center", width: 44, height: 5, borderRadius: 999, backgroundColor: BORDER, marginBottom: 10 },
  sheetTitle: { color: TEXT, fontWeight: "900", fontSize: 16, marginBottom: 6 },
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

  /* Rename modal */
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
    shadowColor: "#0b1220",
    shadowOpacity: 0.1,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  renameTitle: { color: TEXT, fontWeight: "900", fontSize: 18, marginBottom: 10 },
  renameInput: {
    backgroundColor: "#fff",
    color: TEXT,
    borderRadius: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: BORDER,
    marginBottom: 12,
  },

  /* Preview modal */
  previewWrap: { flex: 1, backgroundColor: "#fff" },
  previewBar: {
    height: 48,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderBottomWidth: 1,
    borderColor: BORDER,
    backgroundColor: CARD,
  },
  previewTitle: { flex: 1, textAlign: "center", color: TEXT, fontWeight: "900" },
});