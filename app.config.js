// app.config.js (CommonJS)
require('dotenv').config();

module.exports = {
  expo: {
    // ✅ Change the visible app name
    name: 'TradeMate',
    slug: 'trademate-quotes', // also safe to simplify the slug

    // Scheme can stay as-is (only matters for deep linking)
    scheme: 'tradematequotes',

    version: '1.0.0',
    orientation: 'portrait',
    userInterfaceStyle: 'automatic',
    platforms: ['android', 'ios'],

    assetBundlePatterns: ['/*'],

    icon: './assets/images/app-icon.jpg',

    splash: {
      image: './assets/images/trademate-login-logo.png',
      resizeMode: 'contain',
      backgroundColor: '#ffffff',
      dark: {
        image: './assets/images/trademate-login-logo.png',
        resizeMode: 'contain',
        backgroundColor: '#0b0b0c',
      },
    },

    plugins: ['expo-router', 'react-native-iap', 'expo-asset', 'expo-font'],
    experiments: { typedRoutes: false },

    extra: {
      SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL,
      SUPABASE_ANON_KEY: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
      GOOGLE_API_KEY: process.env.EXPO_PUBLIC_GOOGLE_API_KEY,
      VERIFY_URL: process.env.EXPO_PUBLIC_VERIFY_URL,
      eas: { projectId: '57f55544-8d0b-4f50-b45e-57948ba02dfc' },
    },

    android: {
      // ❌ DO NOT CHANGE — must stay permanent once published
      package: 'com.trademate.quotes',
      softwareKeyboardLayoutMode: 'resize',
      versionCode: 1,

      adaptiveIcon: {
        foregroundImage: './assets/images/app-icon.jpg',
        backgroundColor: '#0b0b0c',
      },

      splash: {
        image: './assets/images/trademate-login-logo.png',
        resizeMode: 'contain',
        backgroundColor: '#0a0a0b',
        dark: {
          image: './assets/images/trademate-login-logo.png',
          resizeMode: 'contain',
          backgroundColor: '#000000',
        },
      },

      intentFilters: [
        {
          action: 'VIEW',
          category: ['BROWSABLE', 'DEFAULT'],
          data: [{ scheme: 'tradematequotes' }],
        },
      ],
    },

    ios: {
      // ❌ DO NOT CHANGE — must stay permanent once published
      bundleIdentifier: 'com.trademate.quotes',
      buildNumber: '1',

      splash: {
        image: './assets/images/trademate-login-logo.png',
        resizeMode: 'contain',
        backgroundColor: '#ffffff',
        dark: {
          image: './assets/images/trademate-login-logo.png',
          resizeMode: 'contain',
          backgroundColor: '#0b0b0c',
        },
      },
    },

    updates: {
      url: 'https://u.expo.dev/57f55544-8d0b-4f50-b45e-57948ba02dfc',
    },

    runtimeVersion: { policy: 'appVersion' },
  },
};