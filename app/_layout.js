// app/_layout.js
import "react-native-gesture-handler";
import "react-native-reanimated";

import React, { useEffect, useState } from "react";
import { ActivityIndicator, Platform, StatusBar, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { Stack } from "expo-router";
import OnboardingCarousel from "../components/OnboardingCarousel";
import AsyncStorage from "@react-native-async-storage/async-storage";

// Consistent, soft backgrounds
const BG_APP = "#EEF2F6";
const BG_AUTH = "#FFFFFF";
const TAB_BAR_COLOR = "#FFFFFF";

const ONBOARDING_KEY = 'onboarding_completed';

export default function RootLayout() {
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [initializing, setInitializing] = useState(true);

  useEffect(() => {
    const initializeApp = async () => {
      try {
        // Check if user has completed onboarding
        const onboardingCompleted = await AsyncStorage.getItem(ONBOARDING_KEY);
        
        // Show onboarding if not completed
        if (onboardingCompleted !== 'true') {
          setShowOnboarding(true);
        }
      } catch (error) {
        console.log('Onboarding check error:', error);
        // On error, don't show onboarding to avoid blocking the user
      } finally {
        setInitializing(false);
      }
    };
    
    initializeApp();
  }, []);

  // Tint Android navigation bar to match tab bar
  useEffect(() => {
    if (Platform.OS !== "android") return;
    (async () => {
      try {
        const NavigationBar = await import("expo-navigation-bar");
        await NavigationBar.setBackgroundColorAsync(TAB_BAR_COLOR);
        await NavigationBar.setButtonStyleAsync("dark");
        await NavigationBar.setDividerColorAsync("transparent");
        await NavigationBar.setBehaviorAsync("inset-swipe");
        await NavigationBar.setVisibilityAsync("visible");
      } catch {
        // Module may be unavailable on some devices — ignore
      }
    })();
  }, []);

  const handleOnboardingClose = async () => {
    try {
      await AsyncStorage.setItem(ONBOARDING_KEY, 'true');
      setShowOnboarding(false);
    } catch (error) {
      console.log('Failed to save onboarding completion:', error);
      // Still close the modal even if saving fails
      setShowOnboarding(false);
    }
  };

  if (initializing) {
    return (
      <SafeAreaProvider>
        <View style={{ flex: 1, backgroundColor: BG_APP, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color="#2a86ff" />
        </View>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar translucent={false} backgroundColor={BG_APP} barStyle="dark-content" />

      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: BG_APP },
          detachPreviousScreen: false,
        }}
      >
        <Stack.Screen
          name="(auth)"
          options={{ headerShown: false, contentStyle: { backgroundColor: BG_AUTH } }}
        />
        <Stack.Screen
          name="(app)"
          options={{ headerShown: false }}
        />
      </Stack>

      {/* Show onboarding only if not completed */}
      <OnboardingCarousel
        visible={showOnboarding}
        onClose={handleOnboardingClose}
      />
    </SafeAreaProvider>
  );
}