// app/(app)/_layout.js
import { Stack } from "expo-router";
import { StatusBar } from "react-native";

export default function AppGroupLayout() {
  return (
    <>
      {/* Extra safety if user deep-links directly into the (app) group */}
      <StatusBar translucent={false} backgroundColor="#0b0b0c" barStyle="light-content" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: "#0b0b0c" },
        }}
      >
        {/* You don't have to list screens here, but it’s nice for control */}
        <Stack.Screen name="quotes/list" />
        <Stack.Screen name="quotes/create" />
        <Stack.Screen name="quotes/preview" />
        <Stack.Screen name="quotes/[id]" />
        <Stack.Screen name="settings/index" />
        <Stack.Screen name="settings/upgrade" />
        <Stack.Screen name="account/index" />
        <Stack.Screen name="profile/index" />
        <Stack.Screen name="about/index" />
        <Stack.Screen name="support/index" />
        <Stack.Screen name="onboarding" />
        {/* If you have an (app)/index you don’t want shown, you can hide it: */}
        {/* <Stack.Screen name="index" options={{ href: null }} /> */}
      </Stack>
    </>
  );
}