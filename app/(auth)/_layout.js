import React, { useEffect } from "react";
import { StatusBar, Platform } from "react-native";
import { Stack } from "expo-router";
import { SafeAreaProvider } from "react-native-safe-area-context";
import * as NavigationBar from "expo-navigation-bar";
import * as SystemUI from "expo-system-ui";

const BG = "#f5f7fb"; // background for your auth screens

export default function AuthLayout() {
  useEffect(() => {
    const setAuthColors = async () => {
      try {
        await SystemUI.setBackgroundColorAsync("#ffffff");
        StatusBar.setBarStyle("dark-content", true);

        if (Platform.OS === "android") {
          StatusBar.setBackgroundColor("#ffffff", true);
          await NavigationBar.setBackgroundColorAsync("#ffffff");
          await NavigationBar.setButtonStyleAsync("dark");
          if (NavigationBar.setBorderColorAsync) {
            await NavigationBar.setBorderColorAsync("#ffffff");
          }
        }
      } catch (error) {
        console.log("Auth layout color setting error:", error);
      }
    };

    setAuthColors();
  }, []);

  return (
    <SafeAreaProvider style={{ backgroundColor: "#ffffff" }}>
      <StatusBar translucent backgroundColor="transparent" barStyle="dark-content" />

      <Stack
        initialRouteName="login"
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: BG },
          animation: "slide_from_right",
        }}
      >
        <Stack.Screen name="login" />
        <Stack.Screen name="register" />
        <Stack.Screen name="reset" />
      </Stack>
    </SafeAreaProvider>
  );
}