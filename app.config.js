import 'dotenv/config';

export default {
  expo: {
    name: 'TradeMate Quotes',
    slug: 'trademate-quotes',
    scheme: 'tradematequotes', // deep link scheme (e.g., tradematequotes://billing/success)
    version: '1.0.0',          // marketing version
    orientation: 'portrait',
    userInterfaceStyle: 'automatic',
    platforms: ['android', 'ios'],

    assetBundlePatterns: ['/*'],

    plugins: ['expo-router', 'expo-dev-client'],

    experiments: { typedRoutes: false },

    extra: {
      EXPO_PUBLIC_GOOGLE_MAPS_KEY: process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY,
      APP_SCHEME: 'tradematequotes',
      eas: { projectId: '57f55544-8d0b-4f50-b45e-57948ba02dfc' },
    },

    android: {
      package: 'com.trademate.quotes',
      versionCode: 1, // 🔁 bump to 2, 3, 4… for each Play Store upload
      softwareKeyboardLayoutMode: 'resize',

      // Allow Android to open deep links like tradematequotes://billing/success
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
      buildNumber: '1', // 🔁 bump '2', '3'… for each App Store upload
    },

    updates: {
      url: 'https://u.expo.dev/57f55544-8d0b-4f50-b45e-57948ba02dfc',
    },

    runtimeVersion: { policy: 'sdkVersion' },
  },
};