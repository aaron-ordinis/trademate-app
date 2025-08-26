// app.config.js (CommonJS)
require('dotenv').config();

module.exports = {
  expo: {
    name: 'TradeMate Quotes',
    slug: 'trademate-quotes',
    scheme: 'tradematequotes',
    version: '1.0.0',
    orientation: 'portrait',
    userInterfaceStyle: 'automatic',
    platforms: ['android', 'ios'],

    // Bundle all assets
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

    plugins: ['expo-router'],
    experiments: { typedRoutes: false },

    extra: {
      // Supabase
      SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL,
      SUPABASE_ANON_KEY: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,

      // ✅ Single Google key used for Places, Geocoding, Distance Matrix, etc.
      GOOGLE_API_KEY: process.env.EXPO_PUBLIC_GOOGLE_API_KEY,

      eas: { projectId: '57f55544-8d0b-4f50-b45e-57948ba02dfc' },
    },

    android: {
      package: 'com.trademate.quotes',
      softwareKeyboardLayoutMode: 'resize',

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

      // If you later use the native Google Maps SDK, uncomment:
      // config: { googleMaps: { apiKey: process.env.EXPO_PUBLIC_GOOGLE_API_KEY } },

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
      // If you later use the native Google Maps SDK, uncomment:
      // config: { googleMapsApiKey: process.env.EXPO_PUBLIC_GOOGLE_API_KEY },
    },

    updates: {
      url: 'https://u.expo.dev/57f55544-8d0b-4f50-b45e-57948ba02dfc',
    },

    runtimeVersion: { policy: 'sdkVersion' },
  },
};