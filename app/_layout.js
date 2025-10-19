// app/_layout.js
import '../polyfills/auth-session-shim';
import 'react-native-gesture-handler';
import 'react-native-reanimated';

import React, { useEffect, useState, useRef } from 'react';
import { StatusBar, View, Animated, Text, Image, StyleSheet, LogBox, Platform } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Stack, useRouter, useSegments } from 'expo-router';
import OnboardingCarousel from '../components/OnboardingCarousel';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import * as NavigationBar from 'expo-navigation-bar';
import * as SystemUI from 'expo-system-ui';

// Silence noisy RN dev warning triggered by animations in dev builds
LogBox.ignoreLogs(['useInsertionEffect must not schedule updates']);

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
      <Animated.View style={[splashStyles.content, { opacity: fadeAnim }]}>
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
  const [appFullyReady, setAppFullyReady] = useState(false);

  const inAuth = segments[0] === '(auth)';
  const inAdmin = segments[0] === '(admin)';

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

  // Simple auth guard (hardened against invalid/expired refresh tokens)
  useEffect(() => {
    if (showSplash) return;

    const checkAuth = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();

        // If there is no valid session (e.g. invalid refresh token in dev build), force a clean state.
        if (!session) {
          try { await supabase.auth.signOut(); } catch {}
        }

        // Allow admin routes without redirects from this guard (admin gating happens inside admin code)
        if (inAdmin) {
          setGuardReady(true);
          return;
        }

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

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      // Skip redirects while on admin routes to avoid flicker/loops
      if (inAdmin) return;

      if (!session || event === 'SIGNED_OUT') {
        if (!inAuth) router.replace('/(auth)/login');
        return;
      }

      if (inAuth) router.replace('/(app)/quotes');
    });

    return () => {
      try { sub.subscription.unsubscribe(); } catch {}
    };
  }, [router, inAuth, inAdmin, showSplash]);

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

  // Force white theme globally
  useEffect(() => {
    const setGlobalWhiteTheme = async () => {
      try {
        // Force status bar white immediately
        StatusBar.setBarStyle('dark-content', true);
        
        if (Platform.OS === 'android') {
          StatusBar.setBackgroundColor('#ffffff', true);
          
          // Force navigation bar white
          await NavigationBar.setBackgroundColorAsync('#ffffff');
          await NavigationBar.setButtonStyleAsync('dark');
          if (NavigationBar.setBorderColorAsync) {
            await NavigationBar.setBorderColorAsync('#ffffff');
          }
        }
        
        // Force system UI white
        await SystemUI.setBackgroundColorAsync('#ffffff');
      } catch (error) {
        console.log('Global white theme error:', error);
      }
    };

    setGlobalWhiteTheme();
  }, []);

  // Wait for everything to be ready before showing the app
  useEffect(() => {
    if (!showSplash && initOnboardingDone && guardReady) {
      // Increase delay to ensure tab structure is fully mounted
      const timer = setTimeout(() => {
        setAppFullyReady(true);
      }, 200);
      return () => clearTimeout(timer);
    }
  }, [showSplash, initOnboardingDone, guardReady]);

  // Show splash screen first
  if (showSplash) {
    return (
      <View style={{ flex: 1, backgroundColor: BG }}>
        <StatusBar backgroundColor={BG} barStyle="dark-content" translucent={false} />
        <SplashScreen onComplete={handleSplashComplete} />
      </View>
    );
  }

  // Show blank screen until everything is ready
  if (!appFullyReady) {
    return (
      <View style={{ flex: 1, backgroundColor: BG_APP }}>
        <StatusBar backgroundColor={BG_APP} barStyle="dark-content" translucent={false} />
      </View>
    );
  }

  // Main app - only shows when fully ready
  return (
    <SafeAreaProvider style={{ backgroundColor: '#ffffff' }}>
      <StatusBar barStyle="dark-content" backgroundColor="#ffffff" translucent={false} />
      <Stack
        screenOptions={{
          animation: 'none',
          headerShown: false,
          gestureEnabled: false,
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
        <Stack.Screen name="(admin)" options={{ headerShown: false }} />
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