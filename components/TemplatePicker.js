// components/TemplatePicker.js
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  ActivityIndicator,
  Dimensions,
  PixelRatio,
  ScrollView,
  TouchableOpacity,
  Image,
  Animated,
  StyleSheet,
} from "react-native";
import { WebView } from "react-native-webview";
import { supabase } from "../lib/supabase";

/* ---------- UI theme ---------- */
const BRAND = "#2a86ff";
const TEXT = "#0b1220";
const MUTED = "#6b7280";
const CARD = "#ffffff";
const BORDER = "#e5e9ee";
const SELECT_GREEN = "#22c55e";

/* ---------- constants ---------- */
const A4_RATIO = 1.41421356237;
const TEMPLATE_PAGE_WIDTH_PX = 720;
const TEMPLATE_PAGE_HEIGHT_PX = Math.round(TEMPLATE_PAGE_WIDTH_PX * A4_RATIO);
const VISIBLE_TARGET = 4.5;
const COMPACT_FACTOR = 0.72;
const PREVIEW_HEIGHT_BOOST = 1.06;
const GAP = 14;
const MIN_THUMB_W = 90;

/* ---------- helpers ---------- */
const normalizeTemplateCode = (code) => {
  if (!code) return "clean-classic.html";
  let c = String(code).trim().replace(/\s+/g, "");
  if (!/\.html$/i.test(c)) c += ".html";
  c = c.replace(/[^A-Za-z0-9._-]/g, "");
  return c.toLowerCase();
};
const previewKeyFromCode = (code) => {
  const c = String(code || "");
  return c.endsWith(".html") ? c.slice(0, -5) : c;
};

export default function TemplatePicker({ selected, onSelect }) {
  const { width: screenW, height: screenH } = Dimensions.get("window");
  const pixelRatio = PixelRatio.get();

  const sidePad = 16;
  const railOuterPad = 10;

  // exact PDF dp width so 720px template fits crisply
  const pdfExactWidthDp = TEMPLATE_PAGE_WIDTH_PX / pixelRatio;
  const previewW = Math.min(pdfExactWidthDp, screenW - sidePad * 2);

  // carousel sizing
  const railInnerW = screenW - sidePad * 2 - railOuterPad * 2;
  const gapsInView = 4;
  let thumbW = Math.floor((railInnerW - GAP * gapsInView) / VISIBLE_TARGET);
  if (thumbW < MIN_THUMB_W) thumbW = MIN_THUMB_W;
  const thumbH = Math.round(thumbW * A4_RATIO);
  const ITEM_STRIDE = thumbW + GAP;

  // preview height
  const labelHeight = 16;
  const railEstimatedH = railOuterPad * 2 + thumbH + 4 + 8 + labelHeight;
  const availableForPreview = screenH - 36 - railEstimatedH - 20;
  const idealPreviewH = Math.round((screenW - sidePad * 2) * A4_RATIO);
  const previewHRaw = Math.max(
    200,
    Math.min(Math.round(idealPreviewH * COMPACT_FACTOR), Math.floor(availableForPreview))
  );
  const previewH = Math.min(
    Math.round(previewHRaw * PREVIEW_HEIGHT_BOOST),
    Math.floor(availableForPreview)
  );

  // zoom scale for html previews sized at 720px wide
  const scale = Math.min(
    previewW / TEMPLATE_PAGE_WIDTH_PX,
    previewH / TEMPLATE_PAGE_HEIGHT_PX
  );

  const injectedCss = `
    (function(){
      if (!document.querySelector('meta[name="viewport"]')) {
        var m=document.createElement('meta'); m.name='viewport';
        m.content='width=${TEMPLATE_PAGE_WIDTH_PX},initial-scale=1,maximum-scale=1,user-scalable=no';
        document.head.appendChild(m);
      }
      var s=document.createElement('style');
      s.textContent='html{zoom:${scale};-webkit-text-size-adjust:100%}body{margin:0;background:#fff}';
      document.head.appendChild(s);
    })(); true;
  `;

  /* ---------- Load templates (global list) ---------- */
  const [items, setItems] = useState([]); // { codeFull, codeBase, name, thumb, previewUrl }
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState(null);

  const urlFor = (path) =>
    supabase.storage.from("templates").getPublicUrl(path).data.publicUrl;

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setLoadErr(null);

      const { data, error } = await supabase
        .from("document_templates")
        .select("code,name,is_public")
        .eq("is_public", true)
        .order("name", { ascending: true });

      if (!alive) return;
      if (error) {
        setLoadErr(error.message || "Failed to load templates");
        setLoading(false);
        return;
      }

      const mapped = (data || []).map((t) => {
        const codeFull = normalizeTemplateCode(t.code);
        const codeBase = previewKeyFromCode(codeFull);
        return {
          codeFull,
          codeBase,
          name: t.name || codeBase,
          thumb: urlFor(`thumbs/${codeBase}.png`),
          previewUrl: urlFor(`previews/${codeBase}.html`),
        };
      });

      setItems(mapped);
      setLoading(false);

      // ensure we always have a valid selection
      const normSel = normalizeTemplateCode(selected || "");
      const exists = mapped.some((m) => m.codeFull === normSel);
      if (!exists && mapped.length && typeof onSelect === "function") {
        onSelect(mapped[0].codeFull);
      }
    })();
    return () => { alive = false; };
  }, []); // load once

  /* ---------- Preview HTML (fetch + inline to avoid wrong content-type) ---------- */
  const [previewHtml, setPreviewHtml] = useState(null);
  const [previewBaseUrl, setPreviewBaseUrl] = useState("https://localhost/");
  const [previewBusy, setPreviewBusy] = useState(false);

  const loadPreviewHtml = async (url) => {
    if (!url) { setPreviewHtml(null); return; }
    try {
      setPreviewBusy(true);
      const res = await fetch(url);
      const html = await res.text();
      setPreviewHtml(html);
      try {
        const u = new URL(url);
        setPreviewBaseUrl(`${u.protocol}//${u.host}/`);
      } catch { setPreviewBaseUrl("https://localhost/"); }
    } catch (e) {
      console.warn("Preview fetch failed:", e?.message || e);
      setPreviewHtml("<html><body><p style='font-family:sans-serif;color:#6b7280'>Preview unavailable.</p></body></html>");
      setPreviewBaseUrl("https://localhost/");
    } finally {
      setPreviewBusy(false);
    }
  };

  /* ---------- Preview switch animation ---------- */
  const [previewCode, setPreviewCode] = useState(selected);
  const fade = useRef(new Animated.Value(1)).current;
  const tickScale = useRef(new Animated.Value(0)).current;

  // when parent changes selected, crossfade preview and reload HTML
  useEffect(() => {
    const nextCode = normalizeTemplateCode(selected || "");
    if (!nextCode || nextCode === previewCode) return;
    Animated.timing(fade, { toValue: 0, duration: 120, useNativeDriver: true }).start(() => {
      setPreviewCode(nextCode);
    });
  }, [selected]);

  // when previewCode changes, fetch the HTML
  const previewItem = useMemo(
    () => items.find((i) => i.codeFull === normalizeTemplateCode(previewCode)) ||
          items.find((i) => i.codeFull === normalizeTemplateCode(selected)) ||
          null,
    [items, previewCode, selected]
  );

  useEffect(() => {
    if (previewItem?.previewUrl) loadPreviewHtml(previewItem.previewUrl);
    else setPreviewHtml(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewItem?.previewUrl]);

  const handleLoadEnd = () => {
    Animated.timing(fade, { toValue: 1, duration: 160, useNativeDriver: true }).start();
  };

  useEffect(() => {
    Animated.sequence([
      Animated.timing(tickScale, { toValue: 0, duration: 0, useNativeDriver: true }),
      Animated.spring(tickScale, { toValue: 1, friction: 6, tension: 140, useNativeDriver: true }),
    ]).start();
  }, [selected]);

  const selectedItem = useMemo(
    () => items.find((i) => i.codeFull === normalizeTemplateCode(selected)),
    [items, selected]
  );

  return (
    <View style={{ paddingHorizontal: sidePad }}>
      {/* ---------- Preview ---------- */}
      <View style={{ marginBottom: 10, alignItems: "center" }}>
        <Animated.View
          style={{
            height: previewH,
            width: previewW,
            opacity: fade,
            shadowColor: "#000",
            shadowOpacity: 0.1,
            shadowOffset: { width: 0, height: 16 },
            shadowRadius: 32,
            elevation: 18,
            backgroundColor: "transparent",
          }}
        >
          <View
            style={{
              flex: 1,
              borderWidth: 1,
              borderColor: BORDER,
              borderRadius: 0,
              overflow: "hidden",
              backgroundColor: "#fff",
            }}
          >
            {previewHtml ? (
              <WebView
                originWhitelist={["*"]}
                source={{ html: previewHtml, baseUrl: previewBaseUrl }}
                injectedJavaScript={injectedCss}
                style={{ flex: 1, backgroundColor: "transparent" }}
                javaScriptEnabled
                domStorageEnabled
                scrollEnabled={false}
                startInLoadingState
                onLoadEnd={handleLoadEnd}
                renderLoading={() => (
                  <View style={s.previewLoading}>
                    <ActivityIndicator size="large" color={BRAND} />
                  </View>
                )}
              />
            ) : (
              <View style={s.previewFallback}>
                {(loading || previewBusy) ? (
                  <ActivityIndicator size="large" color={BRAND} />
                ) : (
                  <Text style={{ color: MUTED }}>Select a layout below to preview</Text>
                )}
              </View>
            )}
          </View>
        </Animated.View>
      </View>

      {/* ---------- Carousel ---------- */}
      <View>
        <Text style={s.railTitle}>Select Layout</Text>
        {loadErr ? (
          <Text style={{ color: "#b91c1c", marginTop: 6 }}>Error: {loadErr}</Text>
        ) : loading ? (
          <View style={{ alignItems: "center", paddingVertical: 8 }}>
            <ActivityIndicator size="small" color={TEXT} />
            <Text style={{ marginTop: 6, color: MUTED, fontSize: 12 }}>Loading templates…</Text>
          </View>
        ) : (
          <ScrollView
            horizontal
            snapToInterval={ITEM_STRIDE}
            decelerationRate="fast"
            bounces={false}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 8 }}
          >
            {items.map((tpl, idx) => {
              const isSelected = tpl.codeFull === normalizeTemplateCode(selected || "");
              return (
                <View
                  key={tpl.codeFull + "-" + idx}
                  style={{
                    width: thumbW,
                    alignItems: "center",
                    marginRight: idx === items.length - 1 ? 0 : GAP,
                  }}
                >
                  <View
                    style={{
                      width: thumbW,
                      height: thumbH,
                      borderRadius: 0,
                      overflow: "hidden",
                      backgroundColor: "#0b1220",
                      borderWidth: isSelected ? 2 : 1,
                      borderColor: isSelected ? SELECT_GREEN : "#d1d5db",
                      alignItems: "center",
                      justifyContent: "center",
                      shadowColor: "#000",
                      shadowOpacity: 0.16,
                      shadowOffset: { width: 0, height: 6 },
                      shadowRadius: 12,
                      elevation: 6,
                    }}
                  >
                    <TouchableOpacity
                      onPress={() => onSelect && onSelect(tpl.codeFull)}
                      activeOpacity={0.9}
                      style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
                    >
                      <Image
                        source={{ uri: tpl.thumb }}
                        style={{ width: "100%", height: "100%" }}
                        resizeMode="contain"
                        backgroundColor="#ffffff"
                      />
                    </TouchableOpacity>

                    {isSelected && (
                      <Animated.View
                        pointerEvents="none"
                        style={{
                          position: "absolute",
                          left: "50%",
                          top: "50%",
                          transform: [
                            { translateX: -20 },
                            { translateY: -20 },
                            { scale: tickScale },
                          ],
                          width: 40,
                          height: 40,
                          borderRadius: 20,
                          backgroundColor: SELECT_GREEN,
                          alignItems: "center",
                          justifyContent: "center",
                          borderWidth: 2,
                          borderColor: "#ffffff",
                        }}
                      >
                        <Text style={{ color: "#fff", fontSize: 22, fontWeight: "800", lineHeight: 24 }}>
                          ✓
                        </Text>
                      </Animated.View>
                    )}
                  </View>

                  <Text
                    numberOfLines={1}
                    style={{
                      marginTop: 6,
                      color: TEXT,
                      fontWeight: isSelected ? "800" : "600",
                      fontSize: 12,
                    }}
                  >
                    {tpl.name}
                  </Text>
                </View>
              );
            })}
          </ScrollView>
        )}
      </View>
    </View>
  );
}

/* ---------- local styles ---------- */
const s = StyleSheet.create({
  previewLoading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fff",
  },
  previewFallback: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fff",
  },
  railTitle: {
    color: TEXT,
    fontWeight: "700",
    fontSize: 14,
    marginBottom: 6,
    letterSpacing: 0.2,
  },
});