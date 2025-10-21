import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { useRouter } from "expo-router";

export default function QuotesIndex() {
  const router = useRouter();

  React.useEffect(() => {
    router.replace("/(app)/(tabs)/quotes"); // ensure we stay under the tabs layout
  }, []);

  return (
    <View style={styles.container}>
      <Text>Loading quotes...</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
});
