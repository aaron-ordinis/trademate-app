import { Stack } from 'expo-router';

export default function AuthLayout() {
  return (
    <Stack screenOptions={{ headerShown:false, contentStyle:{ backgroundColor:'#0b0b0c' } }} initialRouteName="login">
      <Stack.Screen name="login" />
      <Stack.Screen name="register" />
      <Stack.Screen name="reset" />
    </Stack>
  );
}