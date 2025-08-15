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
    plugins: ['expo-router', 'expo-dev-client'],
    experiments: { typedRoutes: false },
    extra: {
      EXPO_PUBLIC_GOOGLE_MAPS_KEY: process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY,
      eas: {
        projectId: '57f55544-8d0b-4f50-b45e-57948ba02dfc'
      }
    },
    android: {
      package: 'com.trademate.quotes',
      softwareKeyboardLayoutMode: 'resize'
    },
    ios: {
      bundleIdentifier: 'com.trademate.quotes'
    },
    updates: {
      enabled: false
    },
    runtimeVersion: {
      policy: 'sdkVersion'
    },
  }
};