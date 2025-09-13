// app/_layout.js
import 'react-native-gesture-handler';
import 'react-native-reanimated';
import React, { useEffect } from 'react';
import { StatusBar, Platform } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';

// ⬇ Keep these in one place so every screen matches
const BG_APP = '#ffffffff';      // your Quotes screen BG
const BG_AUTH = '#ffffff';     // auth stack BG

export default function RootLayout() {
  useEffect(() => {
    async function tintNavBar() {
      if (Platform.OS !== 'android') return;

      try {
        const NavigationBar = await import('expo-navigation-bar');

        // Best “seamless” option: match nav bar to app background
        await NavigationBar.setBackgroundColorAsync(BG_APP);
        await NavigationBar.setButtonStyleAsync('dark');       // dark icons on light bg
        await NavigationBar.setDividerColorAsync('transparent'); // no top hairline
        await NavigationBar.setBehaviorAsync('inset-swipe');   // don’t overlap content
        await NavigationBar.setVisibilityAsync('visible');
      } catch (e) {
        // If the native module isn't in this build, just ignore
        console.log('[nav-bar] not available in this build');
      }
    }
    tintNavBar();
  }, []);

  return (
    <SafeAreaProvider>
      {/* Status bar to match your light screens */}
      <StatusBar translucent={false} backgroundColor={BG_APP} barStyle="dark-content" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: BG_APP } }}>
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        <Stack.Screen name="(app)"  options={{ headerShown: false }} />
      </Stack>
    </SafeAreaProvider>
  );
}