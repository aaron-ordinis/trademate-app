// app.config.js  (CommonJS)

const profile = process.env.EAS_BUILD_PROFILE || process.env.NODE_ENV || "development";
require("dotenv").config({ path: profile === "production" ? ".env.production" : ".env" });

const must = (k) => {
  if (!process.env[k]) console.warn(`[config] Missing env: ${k}`);
  return process.env[k] || "";
};

module.exports = {
  expo: {
    name: "TradeMate",
    slug: "trademate-quotes",
    scheme: "tradematequotes",
    version: "1.0.0",
    orientation: "portrait",
    userInterfaceStyle: "light",
    platforms: ["android", "ios"],
    assetBundlePatterns: ["/*"], // changed to match all subfolders

    icon: "./assets/images/app-icon.jpg",

    splash: {
      image: "./assets/images/trademate-login-logo.png",
      resizeMode: "contain",
      backgroundColor: "#ffffff",
      dark: {
        image: "./assets/images/trademate-login-logo.png",
        resizeMode: "contain",
        backgroundColor: "#0b0b0c",
      },
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
          mode: "production",
          // optional debug mode: set to "development" if testing push tokens
        },
      ],
    ],

    experiments: {
      typedRoutes: false,
    },

    /* ------------------- EXTRA ------------------- */
    extra: {
      SUPABASE_URL: must("EXPO_PUBLIC_SUPABASE_URL") || "https://bvbjvxjtxfzipwvfkrrb.supabase.co",
      SUPABASE_ANON_KEY:
        must("EXPO_PUBLIC_SUPABASE_ANON_KEY") ||
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ2Ymp2eGp0eGZ6aXB3dmZrcnJiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTUxNzI2MzIsImV4cCI6MjA3MDc0ODYzMn0.z-3LXXtk8z5HnGdQiUbpdT9gzZC3afVp1QzKkN0FpKg",
      GOOGLE_MAPS_KEY: must("EXPO_PUBLIC_GOOGLE_MAPS_KEY") || "AIzaSyADhmwSfBX5ccKijq6OW1SlrSDfaHAH3ec",
      FACEBOOK_APP_ID: process.env.EXPO_PUBLIC_FACEBOOK_APP_ID || "1310948953849614",
      eas: {
        projectId: "57f55544-8d0b-4f50-b45e-57948ba02dfc", // ✅ must match Expo Dashboard ID
      },
    },

    /* ------------------- ANDROID ------------------- */
    android: {
      package: "com.trademate.quotes",
      softwareKeyboardLayoutMode: "resize",
      versionCode: 1,

      adaptiveIcon: {
        foregroundImage: "./assets/images/app-icon.jpg",
        backgroundColor: "#0b0b0c",
      },

      splash: {
        image: "./assets/images/trademate-login-logo.png",
        resizeMode: "contain",
        backgroundColor: "#0a0a0b",
        dark: {
          image: "./assets/images/trademate-login-logo.png",
          resizeMode: "contain",
          backgroundColor: "#000000",
        },
      },

      // ✅ Make sure google-services.json is placed in project root
      googleServicesFile: "./google-services.json",

      intentFilters: [
        {
          action: "VIEW",
          category: ["BROWSABLE", "DEFAULT"],
          data: [{ scheme: "tradematequotes", host: "auth" }],
        },
        {
          action: "VIEW",
          category: ["BROWSABLE", "DEFAULT"],
          data: [{ scheme: "tradematequotes", pathPrefix: "/auth" }],
        },
      ],
    },

    /* ------------------- IOS ------------------- */
    ios: {
      bundleIdentifier: "com.trademate.quotes",
      buildNumber: "1.0.0",
      splash: {
        image: "./assets/images/trademate-login-logo.png",
        resizeMode: "contain",
        backgroundColor: "#ffffff",
        dark: {
          image: "./assets/images/trademate-login-logo.png",
          resizeMode: "contain",
          backgroundColor: "#0b0b0c",
        },
      },
    },

    /* ------------------- OTA + RUNTIME ------------------- */
    updates: {
      url: "https://u.expo.dev/57f55544-8d0b-4f50-b45e-57948ba02dfc",
    },
    runtimeVersion: {
      policy: "appVersion",
    },
  },
};