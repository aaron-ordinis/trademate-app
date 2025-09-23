// app/(app)/_layout.tsx
// App group layout with system-aware background + transparent modal routes
// Policy acceptance now handled in registration flow

import React, { useEffect } from "react";
import { Platform, StatusBar, PlatformColor } from "react-native";
import { Stack } from "expo-router";
import * as NavigationBar from "expo-navigation-bar";

const sysBG =
  Platform.OS === "ios"
    ? PlatformColor?.("systemGray6") ?? "#EEF2F6"
    : PlatformColor?.("@android:color/system_neutral2_100") ?? "#EEF2F6";

const BG = sysBG;         // default for non-modal screens
const BG_HEX = "#EEF2F6"; // literal for Android system bars
const TAB_BAR_COLOR = "#FFFFFF"; // Match your tab bar background

export default function AppGroupLayout() {
  useEffect(() => {
    StatusBar.setBarStyle("dark-content");
    if (Platform.OS === "android") {
      StatusBar.setBackgroundColor(BG_HEX, true);
      (async () => {
        try {
          await NavigationBar.setBackgroundColorAsync(TAB_BAR_COLOR);
          await NavigationBar.setButtonStyleAsync("dark");
          await NavigationBar.setDividerColorAsync("transparent");
          await NavigationBar.setBehaviorAsync("inset-swipe");
          await NavigationBar.setVisibilityAsync("visible");
        } catch {}
      })();
    }
  }, []);

  return (
    <>
      <StatusBar translucent={false} backgroundColor={BG_HEX} barStyle="dark-content" />

      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: BG },
          detachPreviousScreen: false,
        }}
      >
        {/* Quotes → Create: transparent modal OVER the list */}
        <Stack.Screen
          name="quotes/create"
          options={{
            presentation: "transparentModal",
            animation: "fade",
            headerShown: false,
            contentStyle: { backgroundColor: "transparent" },
            gestureEnabled: true,
          }}
        />

        {/* Invoices → Wizard: same transparent modal treatment */}
        <Stack.Screen
          name="invoices/wizard"
          options={{
            presentation: "transparentModal",
            animation: "fade",
            headerShown: false,
            contentStyle: { backgroundColor: "transparent" },
            gestureEnabled: true,
          }}
        />
      </Stack>
    </>
  );
}