import React from "react";
import { StatusBar } from "react-native";
import { Stack } from "expo-router";

const BG = "#f5f7fb"; // background for your auth screens

export default function AuthLayout() {
  return (
    <>
      {/* Transparent bar, dark icons */}
      <StatusBar translucent backgroundColor="transparent" barStyle="dark-content" />

      <Stack
        initialRouteName="login"
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: BG },
        }}
      >
        <Stack.Screen name="login" />
        <Stack.Screen name="register" />
        <Stack.Screen name="reset" />
      </Stack>
    </>
  );
}