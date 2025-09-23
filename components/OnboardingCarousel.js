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
} from 'react-native';
// Remove PanGestureHandler import - we'll use TouchableOpacity instead
import { BlurView } from 'expo-blur';
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
  const [showCloseButton, setShowCloseButton] = useState(false);
  
  const { width, height } = Dimensions.get('window');
  const translateX = useRef(new Animated.Value(0)).current;
  const slideWidth = width - 32; // Reduced margin from 48 to 32

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
      // Continue anyway - user can still proceed
    }
  };

  const goToSlide = (index) => {
    if (index < 0 || index >= ONBOARDING_IMAGES.length) return;
    
    setCurrentSlide(index);
    Animated.spring(translateX, {
      toValue: -index * slideWidth,
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
    setShowCloseButton(!dontShowAgain);
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
      animationType="fade"
      transparent
      onRequestClose={handleClose}
      presentationStyle="overFullScreen"
      statusBarTranslucent={Platform.OS === 'android'}
    >
      {/* Ensure background is always rendered */}
      <View style={{ 
        position: "absolute", 
        top: 0, 
        left: 0, 
        right: 0, 
        bottom: 0, 
        backgroundColor: 'rgba(245, 247, 251, 0.95)'
      }} />
      
      <StatusBar backgroundColor="rgba(245,247,251,0.95)" barStyle="dark-content" translucent />

      {/* Rest of component with error boundaries */}
      <View style={{ 
        flex: 1, 
        justifyContent: 'center', 
        alignItems: 'center', 
        padding: 16,
        paddingTop: Platform.OS === 'ios' ? 80 : 60,
        paddingBottom: 40
      }}>
        <View style={[modalCard, { 
          width: slideWidth, 
          maxHeight: height * 0.85, // Increased max height
          backgroundColor: CARD, 
          overflow: "hidden" 
        }]}
        >
          
          {/* Fixed slides container - remove PanGestureHandler and use simple swipe with TouchableOpacity */}
          <View style={{ position: 'relative' }}>
            <Animated.View
              style={{
                flexDirection: 'row',
                width: slideWidth * ONBOARDING_IMAGES.length,
                transform: [{ translateX }],
              }}
            >
              {ONBOARDING_IMAGES.map((image, index) => (
                <View key={index} style={{ 
                  width: slideWidth, 
                  alignItems: 'center', 
                  justifyContent: 'center', 
                  padding: 12 // Reduced padding from 20 to 12
                }}>
                
                  {/* Professional Title */}
                  <View style={{
                    marginBottom: 16,
                    alignItems: 'center',
                    paddingHorizontal: 20,
                  }}>
                    <Text style={{
                      fontSize: 24,
                      fontWeight: '900',
                      color: TEXT,
                      textAlign: 'center',
                      marginBottom: 4,
                      letterSpacing: -0.5,
                    }}>
                      Why TradeMate?
                    </Text>
                    <View style={{
                      width: 40,
                      height: 3,
                      backgroundColor: BRAND,
                      borderRadius: 2,
                    }} />
                  </View>

                  {/* Bigger centered image */}
                  <View style={{ 
                    width: slideWidth - 24, // Reduced margin 
                    height: 400, // Reduced from 450 to 400 to make room for title
                    borderRadius: 16, 
                    overflow: 'hidden',
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: '#ffffff' // White card background for your transparent PNGs
                  }}>
                    <Image 
                      source={image} 
                      style={{ width: '95%', height: '95%' }} // Increased from 90% to 95%
                      resizeMode="contain"
                    />
                  </View>

                  {/* Don't show again checkbox (only on last slide) */}
                  {index === ONBOARDING_IMAGES.length - 1 && (
                    <TouchableOpacity
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        marginTop: 16, // Reduced margin
                        paddingVertical: 8,
                        paddingHorizontal: 12,
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
                        fontSize: 16,
                        fontWeight: '600',
                      }}>
                        Don't show this again
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
              ))}
            </Animated.View>

            {/* Navigation arrows for swiping */}
            {currentSlide > 0 && (
              <TouchableOpacity
                style={{
                  position: 'absolute',
                  left: 10,
                  top: '50%',
                  transform: [{ translateY: -20 }],
                  width: 40,
                  height: 40,
                  borderRadius: 20,
                  backgroundColor: 'rgba(255,255,255,0.9)',
                  alignItems: 'center',
                  justifyContent: 'center',
                  shadowColor: '#000',
                  shadowOpacity: 0.1,
                  shadowRadius: 4,
                  shadowOffset: { width: 0, height: 2 },
                  elevation: 3,
                }}
                onPress={prevSlide}
                activeOpacity={0.8}
              >
                <Feather name="chevron-left" size={24} color={TEXT} />
              </TouchableOpacity>
            )}

            {currentSlide < ONBOARDING_IMAGES.length - 1 && (
              <TouchableOpacity
                style={{
                  position: 'absolute',
                  right: 10,
                  top: '50%',
                  transform: [{ translateY: -20 }],
                  width: 40,
                  height: 40,
                  borderRadius: 20,
                  backgroundColor: 'rgba(255,255,255,0.9)',
                  alignItems: 'center',
                  justifyContent: 'center',
                  shadowColor: '#000',
                  shadowOpacity: 0.1,
                  shadowRadius: 4,
                  shadowOffset: { width: 0, height: 2 },
                  elevation: 3,
                }}
                onPress={nextSlide}
                activeOpacity={0.8}
              >
                <Feather name="chevron-right" size={24} color={TEXT} />
              </TouchableOpacity>
            )}
          </View>

          {/* Dot Indicators */}
          <View style={{
            flexDirection: 'row',
            justifyContent: 'center',
            alignItems: 'center',
            paddingHorizontal: 20,
            paddingBottom: 16, // Reduced padding
            paddingTop: 8,
          }}>
            {ONBOARDING_IMAGES.map((_, index) => (
              <TouchableOpacity
                key={index}
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 5,
                  backgroundColor: currentSlide === index ? BRAND : BORDER,
                  marginHorizontal: 4,
                }}
                onPress={() => goToSlide(index)}
                activeOpacity={0.7}
              />
            ))}
          </View>

          {/* Get Started Button - Always visible but only enabled on last slide */}
          <View style={{ paddingHorizontal: 20, paddingBottom: 20 }}>
            <TouchableOpacity
              style={{
                backgroundColor: currentSlide === ONBOARDING_IMAGES.length - 1 ? BRAND : MUTED,
                borderRadius: 12,
                paddingVertical: 14,
                alignItems: 'center',
                shadowColor: BRAND,
                shadowOpacity: currentSlide === ONBOARDING_IMAGES.length - 1 ? 0.3 : 0.1,
                shadowRadius: 8,
                shadowOffset: { width: 0, height: 4 },
                elevation: 4,
                opacity: currentSlide === ONBOARDING_IMAGES.length - 1 ? 1 : 0.6,
              }}
              onPress={currentSlide === ONBOARDING_IMAGES.length - 1 ? handleClose : undefined}
              activeOpacity={currentSlide === ONBOARDING_IMAGES.length - 1 ? 0.9 : 1}
              disabled={currentSlide !== ONBOARDING_IMAGES.length - 1}
            >
              <Text style={{
                color: '#fff',
                fontSize: 16,
                fontWeight: '800',
              }}>
                Get Started
              </Text>
            </TouchableOpacity>
          </View>

        </View>
      </View>
    </Modal>
  );
}

const modalCard = {
  backgroundColor: CARD,
  borderRadius: 20,
  borderWidth: 1,
  borderColor: BORDER,
  overflow: 'hidden',
  ...Platform.select({
    ios: {
      shadowColor: '#000',
      shadowOpacity: 0.15,
      shadowRadius: 20,
      shadowOffset: { width: 0, height: 8 },
    },
    android: {
      elevation: 16,
    },
  }),
};
