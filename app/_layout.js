// app/_layout.js
import '../polyfills/auth-session-shim'; // ✅ Fix for AuthSession.addRedirectListener error
import 'react-native-gesture-handler';
import 'react-native-reanimated';

import React, { useEffect, useState, useRef } from 'react';
import { ActivityIndicator, Platform, StatusBar, View, Animated, Text, Image, StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Stack, useRouter, useSegments } from 'expo-router';
import OnboardingCarousel from '../components/OnboardingCarousel';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';

// Consistent, soft backgrounds
const BG_APP = '#EEF2F6';
const BG_AUTH = '#FFFFFF';
const TAB_BAR_COLOR = '#FFFFFF';
const ONBOARDING_KEY = 'onboarding_completed';

// Theme colors for splash
const BRAND = '#2a86ff';
const TEXT = '#0b1220';
const BG = '#ffffff';

// Professional Splash Screen Component
function SplashScreen({ onComplete }) {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.8)).current;

  // Set status bar immediately on mount, outside of animation effects
  useEffect(() => {
    StatusBar.setBarStyle('dark-content', true);
    if (Platform.OS === 'android') {
      StatusBar.setBackgroundColor(BG, true);
    }
  }, []);

  useEffect(() => {
    // Start animation sequence
    const sequence = Animated.sequence([
      // Fade in + scale up
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 800,
          useNativeDriver: true,
        }),
        Animated.spring(scaleAnim, {
          toValue: 1,
          tension: 50,
          friction: 8,
          useNativeDriver: true,
        }),
      ]),
      // Hold for 2 seconds
      Animated.delay(2000),
      // Fade out
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 600,
        useNativeDriver: true,
      }),
    ]);

    sequence.start(() => {
      onComplete?.();
    });

    return () => {
      sequence.stop();
    };
  }, [fadeAnim, scaleAnim, onComplete]);

  return (
    <View style={splashStyles.container}>
      <StatusBar backgroundColor={BG} barStyle="dark-content" translucent={false} />
      
      <Animated.View
        style={[
          splashStyles.content,
          {
            opacity: fadeAnim,
            transform: [{ scale: scaleAnim }],
          },
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
            <LoadingDot delay={0} />
            <LoadingDot delay={200} />
            <LoadingDot delay={400} />
          </View>
        </View>
      </Animated.View>
    </View>
  );
}

function LoadingDot({ delay = 0 }) {
  const bounce = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(bounce, {
          toValue: 1,
          duration: 600,
          useNativeDriver: true,
        }),
        Animated.timing(bounce, {
          toValue: 0,
          duration: 600,
          useNativeDriver: true,
        }),
        Animated.delay(800),
      ])
    );

    animation.start();
    return () => animation.stop();
  }, [bounce, delay]);

  const translateY = bounce.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -8],
  });

  return (
    <Animated.View
      style={[
        splashStyles.dot,
        {
          transform: [{ translateY }],
        },
      ]}
    />
  );
}

export default function RootLayout() {
  const router = useRouter();
  const segments = useSegments();

  const [showSplash, setShowSplash] = useState(true);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [initOnboardingDone, setInitOnboardingDone] = useState(false);
  const [guardReady, setGuardReady] = useState(false);

  // --- Onboarding flag init
  useEffect(() => {
    const initializeApp = async () => {
      try {
        const onboardingCompleted = await AsyncStorage.getItem(ONBOARDING_KEY);
        if (onboardingCompleted !== 'true') setShowOnboarding(true);
      } catch (error) {
        console.log('Onboarding check error:', error);
      } finally {
        setInitOnboardingDone(true);
      }
    };
    initializeApp();
  }, []);

  // --- Android navigation bar tint (only after splash)
  useEffect(() => {
    if (Platform.OS !== 'android' || showSplash) return;
    
    const setupNavigationBar = async () => {
      try {
        const NavigationBar = await import('expo-navigation-bar');
        await NavigationBar.setBackgroundColorAsync(TAB_BAR_COLOR);
        await NavigationBar.setButtonStyleAsync('dark');
        await NavigationBar.setDividerColorAsync('transparent');
        await NavigationBar.setBehaviorAsync('inset-swipe');
        await NavigationBar.setVisibilityAsync('visible');
      } catch {
        // Ignore if unavailable
      }
    };
    
    setupNavigationBar();
  }, [showSplash]);

  // --- Auth guard: route users to (auth) or (app) based on Supabase session
  useEffect(() => {
    if (showSplash) return; // Don't run auth guard while splash is showing
    
    let mounted = true;

    const boot = async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        const inAuth = segments[0] === '(auth)';

        if (session && inAuth) {
          router.replace('/(app)/quotes');
        } else if (!session && !inAuth) {
          router.replace('/(auth)/login');
        }
      } catch (e) {
        console.log('[Guard] getSession error:', e);
      } finally {
        if (mounted) setGuardReady(true);
      }
    };

    boot();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      const inAuth = segments[0] === '(auth)';
      if (session && inAuth) router.replace('/(app)/quotes');
      if (!session && !inAuth) router.replace('/(auth)/login');
    });

    return () => {
      mounted = false;
      try {
        sub.subscription.unsubscribe();
      } catch {}
    };
  }, [router, segments, showSplash]);

  const handleOnboardingClose = async () => {
    try {
      await AsyncStorage.setItem(ONBOARDING_KEY, 'true');
      setShowOnboarding(false);
    } catch (error) {
      console.log('Failed to save onboarding completion:', error);
      setShowOnboarding(false);
    }
  };

  const handleSplashComplete = () => {
    setShowSplash(false);
  };

  // Show splash screen first
  if (showSplash) {
    return (
      <SafeAreaProvider>
        <SplashScreen onComplete={handleSplashComplete} />
      </SafeAreaProvider>
    );
  }

  // --- Initial blocking loader until guard + onboarding init are ready
  if (!initOnboardingDone || !guardReady) {
    return (
      <SafeAreaProvider>
        <View
          style={{
            flex: 1,
            backgroundColor: BG_APP,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <ActivityIndicator color="#2a86ff" />
        </View>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar
        translucent={false}
        backgroundColor={BG_APP}
        barStyle="dark-content"
      />

      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: BG_APP },
          detachPreviousScreen: false,
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

      {/* Onboarding overlay (shown only until completed once) */}
      <OnboardingCarousel
        visible={showOnboarding}
        onClose={handleOnboardingClose}
      />
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