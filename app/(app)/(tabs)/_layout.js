import React from "react";
import { Tabs } from "expo-router";
import { FileText, CalendarDays, ClipboardCheck } from "lucide-react-native";

const ICON_COLOR = "#6b7280";
const ACTIVE = "#2a86ff";
const BG = "#ffffff";
const BORDER = "#e6e9ee";

export default function TabsLayout() {
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
      }}
    >
      {/* Quotes left */}
      <Tabs.Screen
        name="quotes/index"
        options={{
          title: "Quotes", // ✅ clean label
          tabBarIcon: ({ color, size }) => <FileText size={size} color={color} />,
        }}
      />

      {/* Jobs middle */}
      <Tabs.Screen
        name="jobs/index"
        options={{
          title: "Jobs",
          tabBarIcon: ({ color, size }) => <CalendarDays size={size} color={color} />,
        }}
      />

      {/* Invoices right */}
      <Tabs.Screen
        name="invoices/index"
        options={{
          title: "Invoices",
          tabBarIcon: ({ color, size }) => <ClipboardCheck size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}