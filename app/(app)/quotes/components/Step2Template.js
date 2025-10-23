import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  Image,
  ScrollView,
  ActivityIndicator,
  Dimensions,
} from "react-native";
import { WebView } from "react-native-webview";
import { styles, BRAND, MUTED, BORDER, CARD } from "./ui";
import { supabase } from "../../../../lib/supabase"; // ← adjust path if needed

export default function Step2Template({
  templateCode,
  setTemplateCode,
  templatePreviewUrl,   // backward-compat fallback
  templatePreviewHtml,  // inline HTML still supported
}) {
  /* ---------------- sizing (A4) ---------------- */
  const A4_RATIO = 1.41421356237;
  const screenW = Dimensions.get("window").width;
  const horizontalCardPadding = 32;
  const previewW = Math.max(280, screenW - horizontalCardPadding * 2);
  const previewH = Math.round(previewW * A4_RATIO);
  const TEMPLATE_PAGE_WIDTH_PX = 720;
  const scale = Math.min(1, previewW / TEMPLATE_PAGE_WIDTH_PX);

  const injectedCss = `
    (function(){
      if (!document.querySelector('meta[name="viewport"]')) {
        var m=document.createElement('meta'); m.name='viewport';
        m.content='width=${TEMPLATE_PAGE_WIDTH_PX},initial-scale=1,maximum-scale=1,user-scalable=no';
        document.head.appendChild(m);
      }
      var s=document.createElement('style');
      s.textContent = 'html{zoom:${scale};-webkit-text-size-adjust:100%}body{margin:0;background:#fff}';
      document.head.appendChild(s);
    })(); true;
  `;

  /* ---------------- data load ---------------- */
  const [items, setItems] = useState([]); // [{code,name,thumb,previewUrl}]
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState(null);

  // helper to compute public URLs via Supabase (no hardcoded origin)
  const urlFor = (path) =>
    supabase.storage.from("templates").getPublicUrl(path).data.publicUrl;

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setLoadErr(null);
      const { data, error } = await supabase
        .from("document_templates")
        .select("code,name,kind,is_public")
        .eq("kind", "quote")
        .eq("is_public", true)
        .order("name", { ascending: true });

      if (!alive) return;

      if (error) {
        setLoadErr(error.message || "Failed to load templates");
        setLoading(false);
        return;
      }

      const mapped = (data || []).map((t) => {
        const base = t.code.endsWith(".html")
          ? t.code.slice(0, -5)
          : t.code;
        return {
          code: base,                           // e.g. "modern-blackbar"
          name: t.name || base,
          thumb: urlFor(`thumbs/${base}.png`),  // templates/thumbs/<base>.png
          previewUrl: urlFor(`previews/${base}-preview.html`), // templates/previews/<base>-preview.html
          _rawCode: t.code,                     // e.g. modern-blackbar.html
        };
      });

      setItems(mapped);
      setLoading(false);

      // auto-select first if none selected yet
      if (!templateCode && mapped.length > 0) {
        setTemplateCode(mapped[0].code);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selected = useMemo(
    () => items.find((i) => i.code === templateCode),
    [items, templateCode]
  );

  const hasHtml = !!templatePreviewHtml?.html;
  const effectivePreviewUrl =
    (selected && selected.previewUrl) || templatePreviewUrl || null;

  return (
    <View>
      {/* ---------- Template selector ---------- */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Choose a Template</Text>

        {loading ? (
          <View style={{ paddingVertical: 16, alignItems: "center" }}>
            <ActivityIndicator size="large" color={BRAND} />
            <Text style={{ marginTop: 8, color: MUTED, fontSize: 12 }}>
              Loading templates…
            </Text>
          </View>
        ) : loadErr ? (
          <View style={{ paddingVertical: 16, alignItems: "center" }}>
            <Text style={{ color: "#b91c1c" }}>Error: {loadErr}</Text>
          </View>
        ) : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{
              flexDirection: "row",
              gap: 12,
              paddingVertical: 6,
            }}
          >
            {items.map((tpl) => {
              const selectedFlag = tpl.code === templateCode;
              return (
                <TouchableOpacity
                  key={tpl.code}
                  onPress={() => setTemplateCode(tpl.code)}
                  activeOpacity={0.85}
                  style={{
                    borderWidth: selectedFlag ? 2 : 1,
                    borderColor: selectedFlag ? BRAND : BORDER,
                    borderRadius: 10,
                    backgroundColor: CARD,
                    overflow: "hidden",
                    width: 180,
                    height: 110,
                    justifyContent: "center",
                    alignItems: "center",
                    shadowColor: "#000",
                    shadowOpacity: 0.05,
                    shadowOffset: { width: 0, height: 1 },
                    shadowRadius: 3,
                    elevation: 1,
                  }}
                >
                  <Image
                    source={{ uri: tpl.thumb }}
                    defaultSource={undefined}
                    style={{
                      width: "100%",
                      height: "100%",
                      resizeMode: "cover",
                      opacity: selectedFlag ? 1 : 0.85,
                    }}
                  />
                  <View
                    style={{
                      position: "absolute",
                      bottom: 0,
                      left: 0,
                      right: 0,
                      backgroundColor: selectedFlag ? BRAND : "rgba(0,0,0,0.5)",
                      paddingVertical: 4,
                    }}
                  >
                    <Text
                      style={{
                        textAlign: "center",
                        color: "#fff",
                        fontWeight: "600",
                        fontSize: 12,
                      }}
                    >
                      {tpl.name}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        )}
      </View>

      {/* ---------- Template preview ---------- */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Template Preview</Text>

        <View style={[styles.previewWrap, { height: previewH }]}>
          {hasHtml ? (
            <WebView
              originWhitelist={["*"]}
              source={{
                html: templatePreviewHtml.html,
                baseUrl: templatePreviewHtml.baseUrl || "https://localhost/",
              }}
              injectedJavaScript={injectedCss}
              style={{ width: "100%", height: "100%" }}
              javaScriptEnabled
              domStorageEnabled
              scrollEnabled={false}
              startInLoadingState
              renderLoading={() => (
                <View style={styles.previewLoading}>
                  <ActivityIndicator size="large" color={BRAND} />
                </View>
              )}
              renderError={() => (
                <View style={styles.previewFallback}>
                  <Text style={{ color: MUTED }}>Failed to load preview</Text>
                </View>
              )}
            />
          ) : effectivePreviewUrl ? (
            <WebView
              source={{ uri: effectivePreviewUrl }}
              injectedJavaScript={injectedCss}
              style={{ width: "100%", height: "100%" }}
              javaScriptEnabled
              domStorageEnabled
              scrollEnabled={false}
              startInLoadingState
              renderLoading={() => (
                <View style={styles.previewLoading}>
                  <ActivityIndicator size="large" color={BRAND} />
                </View>
              )}
              renderError={() => (
                <View style={styles.previewFallback}>
                  <Text style={{ color: MUTED }}>Failed to load preview</Text>
                </View>
              )}
            />
          ) : (
            <View style={styles.previewFallback}>
              <Text style={{ color: MUTED }}>
                Select a template to see the preview
              </Text>
            </View>
          )}
        </View>
      </View>
    </View>
  );
}