// app/_layout.js
import 'react-native-gesture-handler';
import 'react-native-reanimated';
import { Stack } from 'expo-router';
import { StatusBar } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StatusBar translucent={false} backgroundColor="#0b0b0c" barStyle="light-content" />
      <Stack screenOptions={{ headerShown:false, contentStyle:{ backgroundColor:'#0b0b0c' } }}>
        <Stack.Screen name="(auth)" options={{ headerShown:false }} />
        <Stack.Screen name="(app)"  options={{ headerShown:false }} />
      </Stack>
    </SafeAreaProvider>
  );
}