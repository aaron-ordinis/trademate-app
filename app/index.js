// app/index.js
import { quotesListHref, loginHref } from "../lib/nav";
// MUST be first for Android stability
import 'react-native-gesture-handler';
import 'react-native-reanimated';

// Polyfill crypto.getRandomValues for libraries that expect it (uuid, supabase helpers, etc.).
try {
  require('react-native-get-random-values');
  if (typeof globalThis?.crypto?.getRandomValues !== 'function') {
    console.warn('react-native-get-random-values was required but did not set crypto.getRandomValues.');
  }
} catch (e) {
  console.warn('react-native-get-random-values not installed. Install it for a secure crypto.getRandomValues implementation.');
}

import React, { useEffect, useState, useRef } from 'react';
import { View, Text, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '../lib/supabase';
import { useAdminGate } from '../lib/useAdminGate';

export default function Index() {
  const router = useRouter();
  const [booting, setBooting] = useState(true);

  // Admin gate (only you + this device). We don't show UI, just allow secret jump.
  const { allowed } = useAdminGate();

  // redirect coordination (lets us cancel if user triggers secret admin jump)
  const redirectTimerRef = useRef(null);
  const didJumpRef = useRef(false);

  // No logo/tag animations — splash should be quick and then redirect

  useEffect(() => {
    let unsub;

    (async () => {
      // Read current session
      const { data: { session } } = await supabase.auth.getSession();

      // If the dev build has an invalid/missing session, clear any stale tokens now.
      if (!session) {
        try { await supabase.auth.signOut(); } catch {}
      }

      // Delay redirect slightly so you can long-press the logo if you want Admin.
      // greatly shortened so we go straight to login after splash
      redirectTimerRef.current = setTimeout(() => {
        if (!didJumpRef.current) {
          const to = session ? `${quotesListHref}?t=${Date.now()}` : `${loginHref}?t=${Date.now()}`;
          router.replace(to); // add cache-busting ts
          setBooting(false);
        }
      }, 200); // short window before redirect

      // Keep routing in sync with auth changes
      const sub = supabase.auth.onAuthStateChange((event, sess) => {
        if (didJumpRef.current) return; // don't fight a manual admin jump
        if (!sess || event === 'SIGNED_OUT') {
          router.replace(`${loginHref}?t=${Date.now()}`); // add ts
          return;
        }
        router.replace(`${quotesListHref}?t=${Date.now()}`); // add ts
      });
      unsub = sub?.data?.subscription;
    })();

    return () => {
      try { unsub?.unsubscribe?.(); } catch {}
      if (redirectTimerRef.current) clearTimeout(redirectTimerRef.current);
    };
  }, [router]);

  const openAdminIfAllowed = () => {
    if (!allowed) return;
    didJumpRef.current = true;
    if (redirectTimerRef.current) clearTimeout(redirectTimerRef.current);
    setBooting(false);
    router.replace('/(admin)/');
  };

  if (booting) {
    return (
      <View
        style={{
          flex: 1,
          justifyContent: 'center',
          alignItems: 'center',
          backgroundColor: '#fff',
        }}
      >
        {/* Secret long-press target (no icon/loader) */}
        <Pressable onLongPress={openAdminIfAllowed} delayLongPress={450} style={{ width: 100, height: 100 }} />
        {/* Minimal splash — no icon or loader so we redirect quickly */}
      </View>
    );
  }

  return null;
}