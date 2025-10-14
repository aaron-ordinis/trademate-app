// app/_layout.js
import '../polyfills/auth-session-shim';
import 'react-native-gesture-handler';
import 'react-native-reanimated';

import React, { useEffect, useState, useRef } from 'react';
import { ActivityIndicator, StatusBar, View, Animated, Text, Image, StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Stack, useRouter, useSegments } from 'expo-router';
import OnboardingCarousel from '../components/OnboardingCarousel';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';

// Consistent, soft backgrounds
const BG_APP = '#EEF2F6';
const BG_AUTH = '#FFFFFF';
const ONBOARDING_KEY = 'onboarding_completed';

// Theme colors for splash
const BRAND = '#2a86ff';
const TEXT = '#0b1220';
const BG = '#ffffff';

// Simplified Splash Screen - no effects that could cause scheduling issues
function SplashScreen({ onComplete }) {
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const timer = setTimeout(() => {
      Animated.sequence([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 800,
          useNativeDriver: true,
        }),
        Animated.delay(2000),
        Animated.timing(fadeAnim, {
          toValue: 0,
          duration: 600,
          useNativeDriver: true,
        }),
      ]).start(onComplete);
    }, 100);

    return () => clearTimeout(timer);
  }, [fadeAnim, onComplete]);

  return (
    <View style={splashStyles.container}>
      <Animated.View
        style={[
          splashStyles.content,
          { opacity: fadeAnim },
        ]}
      >
        <View style={splashStyles.logoContainer}>
          <Image
            source={require('../assets/images/trademate-login-logo.png')}
            style={splashStyles.logo}
            resizeMode="contain"
          />
        </View>
        
        <View style={splashStyles.textContainer}>
          <Text style={splashStyles.title}>TradeMate</Text>
          <Text style={splashStyles.subtitle}>Professional Trade Quotes</Text>
        </View>

        <View style={splashStyles.loadingContainer}>
          <View style={splashStyles.loadingDots}>
            <View style={splashStyles.dot} />
            <View style={splashStyles.dot} />
            <View style={splashStyles.dot} />
          </View>
        </View>
      </Animated.View>
    </View>
  );
}

export default function RootLayout() {
  const router = useRouter();
  const segments = useSegments();

  const [showSplash, setShowSplash] = useState(true);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [initOnboardingDone, setInitOnboardingDone] = useState(false);
  const [guardReady, setGuardReady] = useState(false);

  // Simple onboarding check
  useEffect(() => {
    const init = async () => {
      try {
        const completed = await AsyncStorage.getItem(ONBOARDING_KEY);
        if (completed !== 'true') setShowOnboarding(true);
      } catch (error) {
        console.log('Onboarding check error:', error);
      } finally {
        setInitOnboardingDone(true);
      }
    };
    init();
  }, []);

  // Simple auth guard
  useEffect(() => {
    if (showSplash) return;
    
    const checkAuth = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const inAuth = segments[0] === '(auth)';

        if (session && inAuth) {
          router.replace('/(app)/quotes');
        } else if (!session && !inAuth) {
          router.replace('/(auth)/login');
        }
      } catch (e) {
        console.log('[Guard] error:', e);
      } finally {
        setGuardReady(true);
      }
    };

    checkAuth();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      const inAuth = segments[0] === '(auth)';
      if (session && inAuth) router.replace('/(app)/quotes');
      if (!session && !inAuth) router.replace('/(auth)/login');
    });

    return () => {
      try {
        sub.subscription.unsubscribe();
      } catch {}
    };
  }, [router, segments, showSplash]);

  const handleOnboardingClose = async () => {
    try {
      await AsyncStorage.setItem(ONBOARDING_KEY, 'true');
    } catch (error) {
      console.log('Failed to save onboarding:', error);
    }
    setShowOnboarding(false);
  };

  const handleSplashComplete = () => {
    setShowSplash(false);
  };

  // Show splash screen first
  if (showSplash) {
    return (
      <View style={{ flex: 1, backgroundColor: BG }}>
        <StatusBar backgroundColor={BG} barStyle="dark-content" translucent={false} />
        <SplashScreen onComplete={handleSplashComplete} />
      </View>
    );
  }

  // Show loading
  if (!initOnboardingDone || !guardReady) {
    return (
      <View style={{ flex: 1, backgroundColor: BG_APP, alignItems: 'center', justifyContent: 'center' }}>
        <StatusBar backgroundColor={BG_APP} barStyle="dark-content" translucent={false} />
        <ActivityIndicator color="#2a86ff" />
      </View>
    );
  }

  // Main app
  return (
    <SafeAreaProvider>
      <StatusBar backgroundColor={BG_APP} barStyle="dark-content" translucent={false} />

      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: BG_APP },
        }}
      >
        <Stack.Screen
          name="(auth)"
          options={{
            headerShown: false,
            contentStyle: { backgroundColor: BG_AUTH },
          }}
        />
        <Stack.Screen name="(app)" options={{ headerShown: false }} />
      </Stack>

      <OnboardingCarousel visible={showOnboarding} onClose={handleOnboardingClose} />
    </SafeAreaProvider>
  );
}

const splashStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BG,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoContainer: {
    marginBottom: 24,
  },
  logo: {
    width: 120,
    height: 120,
  },
  textContainer: {
    alignItems: 'center',
    marginBottom: 40,
  },
  title: {
    fontSize: 32,
    fontWeight: '900',
    color: TEXT,
    marginBottom: 8,
    letterSpacing: -1,
  },
  subtitle: {
    fontSize: 16,
    fontWeight: '600',
    color: BRAND,
    letterSpacing: 0.5,
  },
  loadingContainer: {
    alignItems: 'center',
  },
  loadingDots: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: BRAND,
    opacity: 0.6,
  },
});