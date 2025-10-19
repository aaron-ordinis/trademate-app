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
import {
  ActivityIndicator,
  View,
  Text,
  Animated,
  Easing,
  Pressable,
} from 'react-native';
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

  // Logo animations
  const logoOpacity = useRef(new Animated.Value(0)).current;
  const logoScale = useRef(new Animated.Value(0.9)).current;

  // Tagline animations (staggered)
  const tagOpacity = useRef(new Animated.Value(0)).current;
  const tagTranslate = useRef(new Animated.Value(6)).current; // subtle lift-up

  useEffect(() => {
    // Stage 1: fade in + start gentle pulse on logo
    Animated.parallel([
      Animated.timing(logoOpacity, {
        toValue: 1,
        duration: 800,
        useNativeDriver: true,
      }),
      Animated.loop(
        Animated.sequence([
          Animated.timing(logoScale, {
            toValue: 1.05,
            duration: 900,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(logoScale, {
            toValue: 0.95,
            duration: 900,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ])
      ),
    ]).start();

    // Stage 2 (staggered): tagline fades in & lifts
    const taglineTimer = setTimeout(() => {
      Animated.parallel([
        Animated.timing(tagOpacity, {
          toValue: 1,
          duration: 500,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(tagTranslate, {
          toValue: 0,
          duration: 500,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
      ]).start();
    }, 300); // ~300ms after logo begins

    return () => clearTimeout(taglineTimer);
  }, [logoOpacity, logoScale, tagOpacity, tagTranslate]);

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
      redirectTimerRef.current = setTimeout(() => {
        if (!didJumpRef.current) {
          router.replace(session ? quotesListHref : loginHref);
          setBooting(false);
        }
      }, 900); // ~1s window to long-press

      // Keep routing in sync with auth changes
      const sub = supabase.auth.onAuthStateChange((event, sess) => {
        if (didJumpRef.current) return; // don't fight a manual admin jump
        if (!sess || event === 'SIGNED_OUT') {
          router.replace(loginHref);
          return;
        }
        router.replace(quotesListHref);
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
        {/* Secret long-press target around the logo */}
        <Pressable onLongPress={openAdminIfAllowed} delayLongPress={450}>
          {/* Animated logo */}
          <Animated.Image
            source={require('../assets/icon.png')} // 👈 your helmet logo file
            style={{
              width: 100,
              height: 100,
              marginBottom: 12,
              opacity: logoOpacity,
              transform: [{ scale: logoScale }],
            }}
            resizeMode="contain"
          />
        </Pressable>

        {/* Staggered tagline */}
        <Animated.Text
          style={{
            color: '#6f7076',
            fontSize: 14,
            marginBottom: 20,
            opacity: tagOpacity,
            transform: [{ translateY: tagTranslate }],
          }}
        >
          Powered by AI
        </Animated.Text>

        {/* Blue spinner */}
        <ActivityIndicator color="#2a86ff" size="large" />
      </View>
    );
  }

  return null;
}