// app/lib/supabase.js
// Safe, mobile-ready Supabase client for Expo (PKCE + AsyncStorage)

import 'react-native-url-polyfill/auto'; // required for Supabase on React Native
import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';

const extra = Constants.expoConfig?.extra ?? Constants.manifest?.extra ?? {};

// ---------- load env ----------
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
    '[TMQ] ❌ Missing Supabase env vars. ' +
      'Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY in .env or app.config.js'
  );
} else {
  console.log('[TMQ] ✅ Using Supabase URL:', SUPABASE_URL);
  console.log('[TMQ] ✅ Anon key loaded:', SUPABASE_ANON_KEY.slice(0, 8) + '…');
}

// ---------- AsyncStorage adapter ----------
const AsyncStorageAdapter = {
  getItem: (key) => AsyncStorage.getItem(key),
  setItem: (key, value) => AsyncStorage.setItem(key, value),
  removeItem: (key) => AsyncStorage.removeItem(key),
};

// ---------- client ----------
export const supabase = createClient(
  SUPABASE_URL || 'http://invalid',
  SUPABASE_ANON_KEY || 'invalid',
  {
    // Explicitly set the schema and ensure it's public
    db: {
      schema: 'public',
    },
    auth: {
      flowType: 'pkce',
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      storage: AsyncStorageAdapter,
    },
    global: {
      headers: { 'x-trademate-client': 'mobile-app' },
    },
  }
);

// ---------- helpers ----------
export async function waitForProfile(userId, ms = 5000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const { data, error } = await supabase
      .from('profiles') // ✅ no schema prefix needed
      .select('*')
      .eq('id', userId)
      .maybeSingle();
    if (!error && data) return data;
    await new Promise((r) => setTimeout(r, 250));
  }
  return null;
}

// Add the missing testTableAccess function
export async function testTableAccess() {
  console.log('[SUPABASE] Testing table access...');
  
  try {
    const { data: jobsTest, error: jobsError } = await supabase
      .from('jobs')
      .select('id')
      .limit(1);
    
    console.log('[SUPABASE] Jobs table test:', { data: jobsTest, error: jobsError });
    
    const { data: quotesTest, error: quotesError } = await supabase
      .from('quotes')
      .select('id')
      .limit(1);
      
    console.log('[SUPABASE] Quotes table test:', { data: quotesTest, error: quotesError });
    
    return {
      jobs: !jobsError,
      quotes: !quotesError,
      jobsError: jobsError?.message,
      quotesError: quotesError?.message
    };
  } catch (e) {
    console.error('[SUPABASE] testTableAccess error:', e);
    return {
      jobs: false,
      quotes: false,
      jobsError: e.message,
      quotesError: e.message
    };
  }
}