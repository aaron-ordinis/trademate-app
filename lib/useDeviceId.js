// app/lib/useDeviceId.js
import { useEffect, useState } from 'react';
import * as Application from 'expo-application';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const KEY = 'tm_device_id_v2';

async function ensureDeviceId() {
  // Try a cached value first (works for both iOS & Android)
  const cached = await SecureStore.getItemAsync(KEY);
  if (cached) return cached;

  let id = null;

  // Android: try the stable Android ID
  if (Platform.OS === 'android') {
    try {
      id = await Application.getAndroidIdAsync(); // may return null on some devices
    } catch {}
  }

  // Fallback (or iOS): generate a UUID-like token and persist
  if (!id) {
    const rnd = Math.random().toString(36).slice(2);
    id = `${Date.now().toString(36)}-${rnd}`;
  }

  await SecureStore.setItemAsync(KEY, id, { keychainService: KEY });
  return id;
}

export function useDeviceId() {
  const [deviceId, setDeviceId] = useState(null);
  useEffect(() => {
    ensureDeviceId()
      .then(setDeviceId)
      .catch(() => setDeviceId(null));
  }, []);
  return deviceId;
}