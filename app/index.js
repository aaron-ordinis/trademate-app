import { quotesListHref, loginHref } from "../lib/nav";
// MUST be first for Android stability
import 'react-native-gesture-handler';
import 'react-native-reanimated';

// Polyfill crypto.getRandomValues for libraries that expect it (uuid, supabase helpers, etc.).
// Prefer the secure native package if available. Keep a defensive guard to avoid blocking startup
// if the package isn't installed (but installing it is recommended for production).
try {
  // The package patches global.crypto synchronously when required.
  require('react-native-get-random-values');
  if (typeof globalThis?.crypto?.getRandomValues !== 'function') {
    console.warn('react-native-get-random-values was required but did not set crypto.getRandomValues.');
  }
} catch (e) {
  // If the package is not installed, warn and continue — do not provide an insecure fallback silently.
  console.warn('react-native-get-random-values not installed. Install it for a secure crypto.getRandomValues implementation.');
}

import React, { useEffect, useState, useRef } from 'react';
import {
  ActivityIndicator,
  View,
  Text,
  Animated,
  Easing,
} from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '../lib/supabase';

export default function Index() {
  const router = useRouter();
  const [booting, setBooting] = useState(true);

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
      const { data: { session } } = await supabase.auth.getSession();
  router.replace(session ? quotesListHref : loginHref);
      setBooting(false);

      const sub = supabase.auth.onAuthStateChange((_event, sess) => {
  router.replace(sess ? quotesListHref : loginHref);
      });
      unsub = sub?.data?.subscription;
    })();

    return () => {
      try { unsub?.unsubscribe?.(); } catch {}
    };
  }, [router]);

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