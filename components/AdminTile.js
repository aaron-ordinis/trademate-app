// app/components/AdminTile.js
import { View, Text, Pressable, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useAdminGate } from '../lib/useAdminGate';

export default function AdminTile() {
  const router = useRouter();
  const { allowed, loading } = useAdminGate();

  if (loading) return null; // or <ActivityIndicator size="small" />

  if (!allowed) return null;

  return (
    <Pressable
      onPress={() => router.push('/(admin)/')}
      style={{ padding: 16, borderRadius: 16, backgroundColor: '#111', marginTop: 8 }}
      accessibilityRole="button"
      accessibilityLabel="Open admin dashboard"
    >
      <Text style={{ color: 'white', fontSize: 18, fontWeight: '600' }}>Admin</Text>
      <Text style={{ color: 'white', opacity: 0.8 }}>Open admin dashboard</Text>
    </Pressable>
  );
}