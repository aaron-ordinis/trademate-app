// lib/supabase.js
import { createClient } from '@supabase/supabase-js';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

console.log('[TMQ] Supabase env present:', { url: !!url, anon: !!anon });

if (!url || !anon) throw new Error('[TMQ] Missing Supabase env vars. Check .env.local');

export const supabase = createClient(url, anon, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});