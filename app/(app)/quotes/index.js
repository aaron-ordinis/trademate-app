import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { useRouter } from "expo-router";

export default function QuotesIndex() {
  const router = useRouter();

  // Redirect to quotes list or handle as needed
  React.useEffect(() => {
    router.replace("/quotes/list");
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
