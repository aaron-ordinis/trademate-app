// app.config.js  (CommonJS, dynamic)

const profile = process.env.EAS_BUILD_PROFILE || process.env.NODE_ENV || "development";
require("dotenv").config({ path: profile === "production" ? ".env.production" : ".env" });

const must = function (k) {
  if (!process.env[k]) console.warn("[config] Missing env: " + String(k));
  return process.env[k] || "";
};

module.exports = function ({ config } = {}) {
  const base = config || {};

  return {
    // keep any top-level fields Expo may pass in
    ...base,

    expo: {
      ...(base.expo || {}),

      name: "TradeMate",
      slug: "trademate-quotes",
      scheme: "tradematequotes",
      version: "1.0.19",
      orientation: "portrait",
      userInterfaceStyle: "light",
      platforms: ["android", "ios"],
      assetBundlePatterns: ["/*"],

      icon: "./assets/images/app-icon.jpg",

      splash: {
        image: "./assets/images/trademate-login-logo.png",
        resizeMode: "contain",
        backgroundColor: "#ffffff",
        dark: {
          image: "./assets/images/trademate-login-logo.png",
          resizeMode: "contain",
          backgroundColor: "#0b0b0c"
        }
      },

      /* ------------------- PLUGINS ------------------- */
      plugins: [
        "expo-router",
        "react-native-iap",
        "expo-asset",
        "expo-font",
        "expo-web-browser",
        [
          "expo-notifications",
          {
            color: "#2a86ff",
            mode: "production"
          }
        ]
      ],

      experiments: {
        typedRoutes: false
      },

      /* ------------------- EXTRA ------------------- */
      extra: {
        ...(base.expo && base.expo.extra ? base.expo.extra : {}),
        SUPABASE_URL: must("EXPO_PUBLIC_SUPABASE_URL") || "https://bvbjvxjtxfzipwvfkrrb.supabase.co",
        SUPABASE_ANON_KEY: must("EXPO_PUBLIC_SUPABASE_ANON_KEY") || "",
        GOOGLE_MAPS_KEY: must("EXPO_PUBLIC_GOOGLE_MAPS_KEY") || "",
        eas: {
          projectId: "57f55544-8d0b-4f50-b45e-57948ba02dfc"
        }
      },

      /* ------------------- ANDROID ------------------- */
      android: {
        ...((base.expo && base.expo.android) ? base.expo.android : {}),
        package: "com.trademate.quotes",
        softwareKeyboardLayoutMode: "resize",
        versionCode: 19,

        adaptiveIcon: {
          foregroundImage: "./assets/images/app-icon.jpg",
          backgroundColor: "#0b0b0c"
        },

        // Advertising ID permission (only if you truly need it)
        permissions: [
          "com.google.android.gms.permission.AD_ID"
        ],

        splash: {
          image: "./assets/images/trademate-login-logo.png",
          resizeMode: "contain",
          backgroundColor: "#0a0a0b",
          dark: {
            image: "./assets/images/trademate-login-logo.png",
            resizeMode: "contain",
            backgroundColor: "#000000"
          }
        },

        googleServicesFile: "./google-services.json",

        intentFilters: [
          {
            action: "VIEW",
            category: ["BROWSABLE", "DEFAULT"],
            data: [{ scheme: "tradematequotes", host: "auth" }]
          },
          {
            action: "VIEW",
            category: ["BROWSABLE", "DEFAULT"],
            data: [{ scheme: "tradematequotes", pathPrefix: "/auth" }]
          }
        ]
      },

      /* ------------------- IOS ------------------- */
      ios: {
        ...((base.expo && base.expo.ios) ? base.expo.ios : {}),
        bundleIdentifier: "com.trademate.quotes",
        buildNumber: "19",
        splash: {
          image: "./assets/images/trademate-login-logo.png",
          resizeMode: "contain",
          backgroundColor: "#ffffff",
          dark: {
            image: "./assets/images/trademate-login-logo.png",
            resizeMode: "contain",
            backgroundColor: "#0b0b0c"
          }
        }
      },

      /* ------------------- OTA + RUNTIME ------------------- */
      updates: {
        url: "https://u.expo.dev/57f55544-8d0b-4f50-b45e-57948ba02dfc"
      },
      runtimeVersion: {
        policy: "appVersion"
      }
    }
  };
};