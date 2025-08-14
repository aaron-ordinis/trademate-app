// app.config.js
import 'dotenv/config';

export default {
  expo: {
    name: 'TradeMate Quotes',
    slug: 'trademate-quotes',
    scheme: 'tradematequotes',
    version: '1.0.0',
    orientation: 'portrait',
    userInterfaceStyle: 'automatic',
    platforms: ['android', 'ios'],
    assetBundlePatterns: ['/*'],
    plugins: ['expo-router', 'expo-dev-client'], // 👈 add this
    experiments: { typedRoutes: false },
    extra: {
      EXPO_PUBLIC_GOOGLE_MAPS_KEY: process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY,
    },
    android: {
      package: 'com.trademate.quotes',
      softwareKeyboardLayoutMode: 'resize',
    },
    ios: {
      bundleIdentifier: 'com.trademate.quotes',
    },
    // (optional) disable OTA for now:
    updates: { enabled: true },
  },
};