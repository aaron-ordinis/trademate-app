import React from "react";
import { StatusBar } from "react-native";
import { Stack } from "expo-router";

const BG = "#f5f7fb"; // keep in one place or import your theme

export default function AppGroupLayout() {
  return (
    <>
      <StatusBar translucent={false} backgroundColor={BG} barStyle="dark-content" />
      <Stack screenOptions={{ headerShown: false }} />
    </>
  );
}