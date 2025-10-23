import React, { useEffect, useRef, useState, useCallback } from "react";
import { View, Text, TextInput, ScrollView, Pressable } from "react-native";
import * as Haptics from "expo-haptics";
import { styles, TEXT, MUTED, WARN, BORDER } from "./ui";

const uuid4 = () =>
  "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function tryJson(url, opts = {}, tries = 2) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, opts);
      return await res.json();
    } catch (e) {
      lastErr = e;
      await sleep(150 + i * 200);
    }
  }
  throw lastErr;
}

export default function AddressEditor({ title = "Address", GOOGLE, initialText, onUse, onClose }) {
  const [mode, setMode] = useState((initialText || "").trim() ? "edit" : "search");
  const [query, setQuery] = useState(initialText || "");
  const [suggestions, setSuggestions] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sessionToken, setSessionToken] = useState(uuid4());
  const [editValue, setEditValue] = useState(initialText || "");

  useEffect(() => {
    setSessionToken(uuid4());
    setMode((initialText || "").trim() ? "edit" : "search");
    setQuery(initialText || "");
    setEditValue(initialText || "");
    setSuggestions([]);
    setBusy(false);
    setError("");
  }, [initialText]);

  const debounceRef = useRef();
  useEffect(() => {
    if (mode !== "search") return;
    const q = (query || "").trim();
    if (q.length < 3) { setSuggestions([]); setError(""); return; }
    if (!GOOGLE) { setError("Google key missing. Set EXPO_PUBLIC_GOOGLE_MAPS_KEY."); return; }
    setError("");
    clearTimeout(debounceRef?.current);
    debounceRef.current = setTimeout(async () => {
      try {
        setBusy(true);
        const url =
          "https://maps.googleapis.com/maps/api/place/autocomplete/json" +
          "?input=" + encodeURIComponent(q) +
          "&types=address&components=country:gb&language=en&region=GB" +
          "&sessiontoken=" + sessionToken + "&key=" + GOOGLE;
        const j = await tryJson(url, {}, 2);
        const status = String(j?.status || "OK");
        if (status !== "OK") {
          setSuggestions([]);
          setError(status !== "ZERO_RESULTS" ? "Search error: " + status : "");
          return;
        }
        setSuggestions(Array.isArray(j?.predictions) ? j.predictions : []);
      } catch {
        setSuggestions([]);
        setError("Network error. Try again.");
      } finally {
        setBusy(false);
      }
    }, 180);
    return () => clearTimeout(debounceRef.current);
  }, [query, GOOGLE, sessionToken, mode]);

  const fetchDetails = useCallback(
    async (placeId) => {
      if (!GOOGLE || !placeId) return null;
      const url =
        "https://maps.googleapis.com/maps/api/place/details/json" +
        "?place_id=" + encodeURIComponent(placeId) +
        "&fields=formatted_address&language=en&region=GB" +
        "&sessiontoken=" + sessionToken + "&key=" + GOOGLE;
      try {
        const j = await tryJson(url, {}, 2);
        if (String(j?.status || "OK") !== "OK") return null;
        return j?.result || null;
      } catch {
        return null;
      }
    },
    [GOOGLE, sessionToken]
  );

  const normaliseFormatted = (s) =>
    String(s || "").replace(/,\s*UK$/i, "").replace(/,\s*United Kingdom$/i, "");

  const pickSuggestion = useCallback(async (item) => {
    setBusy(true);
    Haptics.selectionAsync();
    try {
      const details = await fetchDetails(item.place_id);
      const formatted =
        normaliseFormatted(details?.formatted_address || item?.description || "");
      setEditValue(formatted);
      setMode("edit");
    } finally {
      setBusy(false);
    }
  }, [fetchDetails]);

  const canUse = (editValue || "").trim().length >= 6;

  return (
    <View>
      <Text style={{ color: TEXT, fontWeight: "800", marginBottom: 6 }}>
        {mode === "search" ? `${title}: Search (GB)` : `${title}: Edit`}
      </Text>

      {mode === "search" ? (
        <View>
          <Text style={styles.label}>Search</Text>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Start typing address…"
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.input}
            placeholderTextColor={MUTED}
          />
          {busy ? (
            <Text style={{ color: MUTED, fontSize: 12, marginBottom: 6 }}>
              Searching…
            </Text>
          ) : null}
          {!!error && (
            <Text style={{ color: WARN, fontWeight: "700", marginBottom: 6 }}>
              {error}
            </Text>
          )}

          {Array.isArray(suggestions) && suggestions.length > 0 && (
            <View
              style={{
                borderWidth: 1,
                borderColor: BORDER,
                borderRadius: 10,
                overflow: "hidden",
              }}
            >
              <ScrollView style={{ maxHeight: 240 }}>
                {suggestions.map((it) => (
                  <Pressable
                    key={String(it.place_id)}
                    onPress={() => pickSuggestion(it)}
                    style={{
                      paddingVertical: 10,
                      paddingHorizontal: 10,
                      borderBottomWidth: 1,
                      borderBottomColor: BORDER,
                    }}
                  >
                    <Text style={{ color: TEXT }}>{it.description}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          )}
        </View>
      ) : (
        <View>
          <Text style={styles.label}>Full address</Text>
          <TextInput
            value={editValue}
            onChangeText={setEditValue}
            placeholder="You can add flat number, corrections, etc."
            multiline
            numberOfLines={4}
            style={[styles.input, { minHeight: 100, textAlignVertical: "top" }]}
            placeholderTextColor={MUTED}
          />
          <View style={{ flexDirection: "row", gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Pressable
                onPress={() => setMode("search")}
                style={{
                  paddingVertical: 12,
                  borderRadius: 10,
                  alignItems: "center",
                  backgroundColor: BORDER,
                }}
              >
                <Text style={{ color: TEXT, fontWeight: "800" }}>Back to search</Text>
              </Pressable>
            </View>
            <View style={{ flex: 1 }}>
              <Pressable
                onPress={() => {
                  if (!canUse) return;
                  Haptics.selectionAsync();
                  onUse?.(editValue.trim());
                  onClose?.();
                }}
                style={{
                  paddingVertical: 12,
                  borderRadius: 10,
                  alignItems: "center",
                  backgroundColor: canUse ? "#16a34a" : "#9ca3af",
                }}
              >
                <Text style={{ color: "#fff", fontWeight: "800" }}>Use Address</Text>
              </Pressable>
            </View>
          </View>
        </View>
      )}
    </View>
  );
}