// app/(app)/(tabs)/quotes/_layout.js
import React from "react";
import { Stack } from "expo-router";

export default function QuotesStack() {
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: "#0b0b0c" } }}>
      {/* /quotes/list */}
      <Stack.Screen name="list" />
      {/* /quotes/create */}
      <Stack.Screen name="create" />
      {/* /quotes/[id]/index.js → /quotes/:id */}
      <Stack.Screen name="[id]" />
      {/* Don't declare [id]/preview, it's auto-picked from quotes/[id]/preview.js */}
    </Stack>
  );
}