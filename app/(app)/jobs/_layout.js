// app/(app)/jobs/_layout.js
import React from "react";
import { Stack } from "expo-router";

export default function JobsLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      {/* list / create */}
      <Stack.Screen name="index" />
      <Stack.Screen name="create" />

      {/* job detail and nested tabs */}
      <Stack.Screen name="[id]/index" />
      <Stack.Screen name="[id]/documents/index" />
      <Stack.Screen name="[id]/expenses/index" />
    </Stack>
  );
}