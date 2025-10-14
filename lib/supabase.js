// lib/supabase.js
// Safe, mobile-ready Supabase client for Expo (PKCE + SecureStore)

import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';

const extra = Constants.expoConfig?.extra ?? Constants.manifest?.extra ?? {};

const SUPABASE_URL =
  process.env.EXPO_PUBLIC_SUPABASE_URL ||
  extra.SUPABASE_URL ||
  '';

const SUPABASE_ANON_KEY =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
  extra.SUPABASE_ANON_KEY ||
  '';

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error(
    '[TMQ] Missing Supabase env vars. ' +
      'Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY in your build env ' +
      '(or extra.SUPABASE_URL / extra.SUPABASE_ANON_KEY in app.config).'
  );
}

/** Secure session storage for native apps (Expo) */
const AsyncStorageAdapter = {
  getItem: (key) => AsyncStorage.getItem(key),
  setItem: (key, value) => AsyncStorage.setItem(key, value),
  removeItem: (key) => AsyncStorage.removeItem(key),
};

export const supabase = createClient(SUPABASE_URL || 'http://invalid', SUPABASE_ANON_KEY || 'invalid', {
  auth: {
    flowType: 'pkce',
    persistSession: true,
    autoRefreshToken: true,
    // We’ll handle deep links and call auth.exchangeCodeForSession(url) ourselves
    detectSessionInUrl: false,
    storage: AsyncStorageAdapter,
  },
});

/**
 * Wait for the DB trigger-created profile (useful right after first sign-in).
 * Usage: const profile = await waitForProfile(user.id, 6000)
 */
export async function waitForProfile(userId, ms = 5000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();
    if (!error && data) return data;
    await new Promise((r) => setTimeout(r, 250));
  }
  return null;
}