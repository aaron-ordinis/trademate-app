// app.config.js  (CommonJS)

const profile = process.env.EAS_BUILD_PROFILE || process.env.NODE_ENV || 'development';
require('dotenv').config({ path: profile === 'production' ? '.env.production' : '.env' });

const must = (k) => {
  if (!process.env[k]) console.warn(`[config] Missing env: ${k}`);
return process.env[k] || '';
};

module.exports = {
  expo: {
    name: 'TradeMate',
    slug: 'trademate-quotes',

    // Deep link scheme
    scheme: 'tradematequotes',

    version: '1.0.0',
    orientation: 'portrait',
    userInterfaceStyle: 'automatic',
    platforms: ['android', 'ios'],

    // ✅ include all nested assets
    assetBundlePatterns: ['**/*'],

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

    plugins: [
      'expo-router',
      'react-native-iap',
      'expo-asset',
      'expo-font',
      'expo-web-browser',
    ],

    experiments: { 
      typedRoutes: false,
    },

    extra: {
      SUPABASE_URL: must('EXPO_PUBLIC_SUPABASE_URL'),
      SUPABASE_ANON_KEY: must('EXPO_PUBLIC_SUPABASE_ANON_KEY'),
      GOOGLE_MAPS_KEY: must('EXPO_PUBLIC_GOOGLE_MAPS_KEY'),
      FACEBOOK_APP_ID: process.env.EXPO_PUBLIC_FACEBOOK_APP_ID || '',
      eas: { projectId: '57f55544-8d0b-4f50-b45e-57948ba02dfc' },
    },

    android: {
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

      // ✅ accept both host-form and path-form deep links
      intentFilters: [
        // tradematequotes://auth
        {
          action: 'VIEW',
          category: ['BROWSABLE', 'DEFAULT'],
          data: [{ scheme: 'tradematequotes', host: 'auth' }],
        },
        // tradematequotes:///auth
        {
          action: 'VIEW',
          category: ['BROWSABLE', 'DEFAULT'],
          data: [{ scheme: 'tradematequotes', pathPrefix: '/auth' }],
        },
      ],
    },

    ios: {
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