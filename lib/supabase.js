// lib/supabase.js
import { createClient } from '@supabase/supabase-js';
import Constants from 'expo-constants';

// Works in both dev and production
const extra = Constants.expoConfig?.extra ?? Constants.manifest?.extra ?? {};

const url =
  process.env.EXPO_PUBLIC_SUPABASE_URL ||
  extra.SUPABASE_URL ||
  '';
const anon =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
  extra.SUPABASE_ANON_KEY ||
  '';

// Loud log but no hard crash
if (!url || !anon) {
  console.error(
    '[TMQ] Missing Supabase env vars. ' +
    'Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY in your EAS env ' +
    '(or extra.SUPABASE_URL / extra.SUPABASE_ANON_KEY in app.config).'
  );
}

// Create the client even if values are empty so the app can render;
// network calls will fail gracefully until a correct build is installed.
export const supabase = createClient(url || 'http://invalid', anon || 'invalid', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});