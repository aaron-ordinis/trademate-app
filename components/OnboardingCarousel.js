import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  Modal,
  Image,
  TouchableOpacity,
  Animated,
  Dimensions,
  Platform,
  StatusBar,
  Pressable,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Feather } from '@expo/vector-icons';

// Theme
const BRAND = '#2a86ff';
const TEXT = '#0b1220';
const MUTED = '#6b7280';
const CARD = '#ffffff';
const BG_HEX = '#f5f7fb';
const BORDER = '#e6e9ee';

const STORAGE_KEY = 'onboarding_completed';

// Your actual PNG images
const ONBOARDING_IMAGES = [
  require('../assets/onboarding/slide1.png'),
  require('../assets/onboarding/slide2.png'),
  require('../assets/onboarding/slide3.png'),
  require('../assets/onboarding/slide4.png'),
];

export default function OnboardingCarousel({ visible, onClose }) {
  const [currentSlide, setCurrentSlide] = useState(0);
  const [dontShowAgain, setDontShowAgain] = useState(false);
  
  const { width, height } = Dimensions.get('window');
  const translateX = useRef(new Animated.Value(0)).current;

  // Check if user has already seen onboarding
  useEffect(() => {
    checkOnboardingStatus();
  }, []);

  const checkOnboardingStatus = async () => {
    try {
      const completed = await AsyncStorage.getItem(STORAGE_KEY);
      if (completed === 'true') {
        onClose?.();
      }
    } catch (error) {
      // Don't close on error - let user see onboarding
    }
  };

  const markOnboardingComplete = async () => {
    try {
      await AsyncStorage.setItem(STORAGE_KEY, 'true');
    } catch (error) {
      // Continue anyway
    }
  };

  const goToSlide = (index) => {
    if (index < 0 || index >= ONBOARDING_IMAGES.length) return;
    
    setCurrentSlide(index);
    Animated.spring(translateX, {
      toValue: -index * width,
      useNativeDriver: true,
      tension: 100,
      friction: 8,
    }).start();
    
    Haptics.selectionAsync();
  };

  const nextSlide = () => {
    if (currentSlide < ONBOARDING_IMAGES.length - 1) {
      goToSlide(currentSlide + 1);
    }
  };

  const prevSlide = () => {
    if (currentSlide > 0) {
      goToSlide(currentSlide - 1);
    }
  };

  const handleDontShowAgain = () => {
    setDontShowAgain(!dontShowAgain);
    Haptics.selectionAsync();
  };

  const handleClose = async () => {
    if (dontShowAgain) {
      await markOnboardingComplete();
    }
    onClose?.();
  };

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={false}
      onRequestClose={handleClose}
      presentationStyle="fullScreen"
      statusBarTranslucent={Platform.OS === 'android'}
    >
      <StatusBar backgroundColor={BG_HEX} barStyle="dark-content" translucent={false} />

      {/* Full screen container */}
      <View style={{ 
        flex: 1, 
        backgroundColor: BG_HEX,
        paddingTop: Platform.OS === 'ios' ? 50 : 30,
        paddingBottom: Platform.OS === 'ios' ? 40 : 20,
      }}>
        
        {/* Professional Header */}
        <View style={{
          paddingHorizontal: 24,
          paddingBottom: 20,
          alignItems: 'center',
        }}>
          <Text style={{
            fontSize: 28,
            fontWeight: '900',
            color: TEXT,
            textAlign: 'center',
            marginBottom: 8,
            letterSpacing: -0.5,
          }}>
            Why TradeMate?
          </Text>
          <View style={{
            width: 50,
            height: 4,
            backgroundColor: BRAND,
            borderRadius: 2,
          }} />
        </View>

        {/* Full width slides container */}
        <View style={{ flex: 1, position: 'relative' }}>
          <Animated.View
            style={{
              flexDirection: 'row',
              width: width * ONBOARDING_IMAGES.length,
              height: '100%',
              transform: [{ translateX }],
            }}
          >
            {ONBOARDING_IMAGES.map((image, index) => (
              <View key={index} style={{ 
                width: width, 
                flex: 1,
                alignItems: 'center', 
                justifyContent: 'center', 
                paddingHorizontal: 20,
              }}>
                
                {/* Full screen image container */}
                <View style={{ 
                  width: width - 40,
                  flex: 1,
                  borderRadius: 20, 
                  overflow: 'hidden',
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: CARD,
                  marginBottom: 20,
                  ...Platform.select({
                    ios: {
                      shadowColor: '#0b1220',
                      shadowOpacity: 0.1,
                      shadowRadius: 20,
                      shadowOffset: { width: 0, height: 10 },
                    },
                    android: {
                      elevation: 8,
                    },
                  }),
                }}>
                  <Image 
                    source={image} 
                    style={{ width: '90%', height: '90%' }}
                    resizeMode="contain"
                  />
                </View>
              </View>
            ))}
          </Animated.View>

          {/* Navigation arrows for swiping */}
          {currentSlide > 0 && (
            <TouchableOpacity
              style={{
                position: 'absolute',
                left: 20,
                top: '50%',
                transform: [{ translateY: -25 }],
                width: 50,
                height: 50,
                borderRadius: 25,
                backgroundColor: 'rgba(255,255,255,0.95)',
                alignItems: 'center',
                justifyContent: 'center',
                ...Platform.select({
                  ios: {
                    shadowColor: '#000',
                    shadowOpacity: 0.15,
                    shadowRadius: 8,
                    shadowOffset: { width: 0, height: 4 },
                  },
                  android: {
                    elevation: 6,
                  },
                }),
              }}
              onPress={prevSlide}
              activeOpacity={0.8}
            >
              <Feather name="chevron-left" size={28} color={TEXT} />
            </TouchableOpacity>
          )}

          {currentSlide < ONBOARDING_IMAGES.length - 1 && (
            <TouchableOpacity
              style={{
                position: 'absolute',
                right: 20,
                top: '50%',
                transform: [{ translateY: -25 }],
                width: 50,
                height: 50,
                borderRadius: 25,
                backgroundColor: 'rgba(255,255,255,0.95)',
                alignItems: 'center',
                justifyContent: 'center',
                ...Platform.select({
                  ios: {
                    shadowColor: '#000',
                    shadowOpacity: 0.15,
                    shadowRadius: 8,
                    shadowOffset: { width: 0, height: 4 },
                  },
                  android: {
                    elevation: 6,
                  },
                }),
              }}
              onPress={nextSlide}
              activeOpacity={0.8}
            >
              <Feather name="chevron-right" size={28} color={TEXT} />
            </TouchableOpacity>
          )}
        </View>

        {/* Bottom Card with Dots and Buttons */}
        <View style={{
          backgroundColor: CARD,
          marginHorizontal: 20,
          borderRadius: 16,
          padding: 20,
          marginTop: 20,
          borderWidth: 1,
          borderColor: BORDER,
          ...Platform.select({
            ios: {
              shadowColor: '#0b1220',
              shadowOpacity: 0.1,
              shadowRadius: 12,
              shadowOffset: { width: 0, height: 6 },
            },
            android: {
              elevation: 6,
            },
          }),
        }}>
          
          {/* Dot Indicators */}
          <View style={{
            flexDirection: 'row',
            justifyContent: 'center',
            alignItems: 'center',
            marginBottom: 20,
          }}>
            {ONBOARDING_IMAGES.map((_, index) => (
              <TouchableOpacity
                key={index}
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: 6,
                  backgroundColor: currentSlide === index ? BRAND : BORDER,
                  marginHorizontal: 6,
                }}
                onPress={() => goToSlide(index)}
                activeOpacity={0.7}
              />
            ))}
          </View>

          {/* Don't show again checkbox (only on last slide) */}
          {currentSlide === ONBOARDING_IMAGES.length - 1 && (
            <TouchableOpacity
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                marginBottom: 16,
                paddingVertical: 12,
                paddingHorizontal: 16,
                backgroundColor: BG_HEX,
                borderRadius: 10,
                borderWidth: 1,
                borderColor: BORDER,
              }}
              onPress={handleDontShowAgain}
              activeOpacity={0.7}
            >
              <View style={{
                width: 22,
                height: 22,
                borderRadius: 6,
                borderWidth: 2,
                borderColor: dontShowAgain ? BRAND : MUTED,
                backgroundColor: dontShowAgain ? BRAND : 'transparent',
                alignItems: 'center',
                justifyContent: 'center',
                marginRight: 12,
              }}>
                {dontShowAgain && (
                  <Feather name="check" size={14} color="#fff" />
                )}
              </View>
              <Text style={{
                color: TEXT,
                fontSize: 15,
                fontWeight: '600',
              }}>
                Don't show this again
              </Text>
            </TouchableOpacity>
          )}

          {/* Get Started Button */}
          <TouchableOpacity
            style={{
              backgroundColor: currentSlide === ONBOARDING_IMAGES.length - 1 ? BRAND : MUTED,
              borderRadius: 12,
              paddingVertical: 16,
              alignItems: 'center',
              ...Platform.select({
                ios: {
                  shadowColor: BRAND,
                  shadowOpacity: currentSlide === ONBOARDING_IMAGES.length - 1 ? 0.3 : 0.1,
                  shadowRadius: 8,
                  shadowOffset: { width: 0, height: 4 },
                },
                android: {
                  elevation: currentSlide === ONBOARDING_IMAGES.length - 1 ? 4 : 2,
                },
              }),
              opacity: currentSlide === ONBOARDING_IMAGES.length - 1 ? 1 : 0.7,
            }}
            onPress={currentSlide === ONBOARDING_IMAGES.length - 1 ? handleClose : undefined}
            activeOpacity={currentSlide === ONBOARDING_IMAGES.length - 1 ? 0.9 : 1}
            disabled={currentSlide !== ONBOARDING_IMAGES.length - 1}
          >
            <Text style={{
              color: '#fff',
              fontSize: 18,
              fontWeight: '800',
            }}>
              Get Started
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}
