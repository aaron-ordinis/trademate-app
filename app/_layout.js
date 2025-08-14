// app/_layout.js
import React from 'react';
import { Stack } from 'expo-router';

export default function RootLayout() {
  console.log('[TMQ] RootLayout mounted');
  return (
    <Stack screenOptions={{ headerShown: false }}>
      {/* (auth) group */}
      <Stack.Screen name="(auth)/login" />

      {/* (app) group */}
      <Stack.Screen name="(app)/onboarding" />
      <Stack.Screen name="(app)/quotes/list" />
      <Stack.Screen name="(app)/quotes/create" />
      <Stack.Screen name="(app)/settings" />
    </Stack>
  );
}