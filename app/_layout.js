// app/_layout.js
import { Stack } from "expo-router";
import { StatusBar } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      {/* Global status bar; content won't go underneath */}
      <StatusBar translucent={false} backgroundColor="#0b0b0c" barStyle="light-content" />
      <Stack
        screenOptions={{
          headerShown: false,
          // keep screens dark by default (no extra padding here;
          // each screen handles safe-area with SafeAreaView)
          contentStyle: { backgroundColor: "#0b0b0c" },
        }}
      >
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        <Stack.Screen name="(app)"  options={{ headerShown: false }} />
      </Stack>
    </SafeAreaProvider>
  );
}