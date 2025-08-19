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

    // ✅ App icon (JPG)
    icon: './assets/images/app-icon.jpg',

    // ✅ Splash (dark + light modes)
    splash: {
      image: './assets/images/trademate-login-logo.png',
      resizeMode: 'contain',
      backgroundColor: '#ffffff', // Light mode fallback
      dark: {
        image: './assets/images/login-logo.png',
        resizeMode: 'contain',
        backgroundColor: '#0b0b0c', // Dark mode fallback
      },
    },

    plugins: ['expo-router'],
    experiments: { typedRoutes: false },

    extra: {
      SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL,
      SUPABASE_ANON_KEY: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
      EXPO_PUBLIC_GOOGLE_MAPS_KEY: process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY,
      eas: { projectId: '57f55544-8d0b-4f50-b45e-57948ba02dfc' },
    },

    android: {
      package: 'com.trademate.quotes',
      softwareKeyboardLayoutMode: 'resize',

      // ✅ Adaptive icon (foreground must match main icon, background color required)
      adaptiveIcon: {
        foregroundImage: './assets/images/app-icon.jpg',
        backgroundColor: '#0b0b0c',
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
      bundleIdentifier: 'com.trademate.quotes',
    },

    updates: {
      url: 'https://u.expo.dev/57f55544-8d0b-4f50-b45e-57948ba02dfc',
    },

    runtimeVersion: { policy: 'sdkVersion' },
  },
};