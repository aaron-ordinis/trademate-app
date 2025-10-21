import React, { useEffect, useState } from "react";
import { View } from "react-native";
import { Tabs, useRouter } from "expo-router";
import { FileText, CalendarDays, ClipboardCheck } from "lucide-react-native";
import { supabase } from "../../../lib/supabase";
import { getPremiumStatus } from "../../../lib/premium";

const ICON_COLOR = "#6b7280";
const ACTIVE = "#2a86ff";
const BG = "#ffffff";
const BORDER = "#e6e9ee";

export default function TabsLayout() {
  const [isReady, setIsReady] = useState(false);
  const [tabsFullyMounted, setTabsFullyMounted] = useState(false);
  const router = useRouter();

  // Check if user should be in onboarding before showing tabs
  useEffect(() => {
    const checkOnboardingStatus = async () => {
      try {
        const { data } = await supabase.auth.getUser();
        const user = data?.user;

        if (!user) {
          router.replace("/(auth)/login");
          return;
        }

        // Check if profile is complete
        const { data: profile } = await supabase
          .from("profiles")
          .select("business_name, hourly_rate, phone, address_line1, trial_ends_at, plan_tier, plan_status")
          .eq("id", user.id)
          .maybeSingle();

        // Check if user is blocked due to expired trial
        const premiumStatus = getPremiumStatus(profile);

        const needsOnboarding =
          !profile ||
          !profile.business_name ||
          profile.business_name.trim() === "" ||
          profile.hourly_rate == null ||
          profile.hourly_rate <= 0 ||
          !profile.phone ||
          profile.phone.trim() === "" ||
          !profile.address_line1 ||
          profile.address_line1.trim() === "";

        if (needsOnboarding) {
          router.replace("/(app)/onboarding");
          return;
        }

        setIsReady(true);
        // Add delay to ensure all tab content is ready
        setTimeout(() => {
          setTabsFullyMounted(true);
        }, 100);
      } catch (error) {
        console.error("Onboarding check error:", error);
        router.replace("/(app)/onboarding");
      }
    };

    checkOnboardingStatus();
  }, [router]);

  // Don't render anything until fully ready
  if (!isReady || !tabsFullyMounted) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: "#ffffff",
        }}
      >
        {/* Removed ActivityIndicator - just show blank white screen */}
      </View>
    );
  }

  return (
    <Tabs
      initialRouteName="quotes/index"
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: true,
        tabBarActiveTintColor: ACTIVE,
        tabBarInactiveTintColor: ICON_COLOR,
        tabBarStyle: {
          backgroundColor: BG,
          borderTopColor: BORDER,
          height: 60,
          paddingBottom: 8,
        },
        tabBarLabelStyle: { fontWeight: "700", marginBottom: 4 },
        animation: 'none',
      }}
    >
      {/* Quotes left */}
      <Tabs.Screen
        name="quotes/index"
        options={{
          title: "Quotes",
          tabBarIcon: ({ color, size }) => (
            <FileText size={size} color={color} />
          ),
        }}
      />

      {/* Jobs middle */}
      <Tabs.Screen
        name="jobs/index"
        options={{
          title: "Jobs",
          tabBarIcon: ({ color, size }) => (
            <CalendarDays size={size} color={color} />
          ),
        }}
      />

      {/* Invoices right */}
      <Tabs.Screen
        name="invoices/index"
        options={{
          title: "Invoices",
          tabBarIcon: ({ color, size }) => (
            <ClipboardCheck size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}