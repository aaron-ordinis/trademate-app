export default function TestNotificationScreen() {
  const sendTest = async () => {
    try {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: "Foreground Test",
          body: "If you see this banner while the app is open — notifications work 🎉",
          data: { type: "system" },
        },
        trigger: null, // null = immediate
      });
      Alert.alert("Sent!", "A local notification should appear now.");
    } catch (e) {
      Alert.alert("Error", e.message);
    }
  };

  return (
    <View
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
    >
      <Text style={{ fontSize: 18, marginBottom: 20 }}>
        Tap the button to test a foreground notification.
      </Text>
      <Button title="Send Test Notification" onPress={sendTest} />
    </View>
  );
}