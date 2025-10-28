import React, { useEffect, useState, useCallback } from "react";
import {
View,
Text,
StyleSheet,
ScrollView,
TouchableOpacity,
ActivityIndicator,
Alert,
Platform,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { supabase } from "../../lib/supabase";

const CARD = "#ffffff";
const TEXT = "#0b1220";
const MUTED = "#6b7280";
const BORDER = "#e6e9ee";
const BRAND = "#2a86ff";
const DANGER = "#dc2626";

export default function NotificationIdScreen() {
const router = useRouter();
const params = useLocalSearchParams();
const id = params && params.id ? String(params.id) : "";
const [notification, setNotification] = useState(null);
const [loading, setLoading] = useState(true);

const fetchNotification = useCallback(async function () {
if (!id) return;
setLoading(true);
try {
const { data, error } = await supabase
.from("notifications")
.select("id, title, body, type, created_at, read, quote_id, ticket_id")
.eq("id", id)
.single();
if (error) throw error;
setNotification(data);
} catch (e) {
Alert.alert("Error", "Failed to load notification");
setNotification(null);
} finally {
setLoading(false);
}
}, [id]);

const markAsRead = useCallback(async function () {
try {
if (notification && !notification.read) {
const { error } = await supabase
.from("notifications")
.update({ read: true })
.eq("id", id);
if (!error) {
setNotification(function (prev) {
return prev ? Object.assign({}, prev, { read: true }) : prev;
});
}
}
} catch (e) {
// silent
}
}, [id, notification]);

useEffect(function () {
fetchNotification();
}, [fetchNotification]);

useEffect(function () {
if (notification && !notification.read) {
markAsRead();
}
}, [notification, markAsRead]);

async function markAsUnread() {
try {
const { error } = await supabase
.from("notifications")
.update({ read: false })
.eq("id", id);
if (error) throw error;
router.back();
} catch (e) {
Alert.alert("Error", "Failed to mark as unread");
}
}

async function deleteNotification() {
try {
const { error } = await supabase.from("notifications").delete().eq("id", id);
if (error) throw error;
router.back();
} catch (e) {
Alert.alert("Error", "Failed to delete notification");
}
}

function openTarget() {
if (!notification) return;
if (notification.type === "support_message" && notification.ticket_id) {
router.replace("/support/ticket?id=" + String(notification.ticket_id));
return;
}
if (notification.type === "quote_created" && notification.quote_id) {
router.replace("/quotes/preview?id=" + String(notification.quote_id));
return;
}
router.replace("/notifications");
}

if (loading) {
return (
<View style={styles.centered}>
<ActivityIndicator size="large" color={BRAND} />
</View>
);
}

if (!notification) {
return (
<View style={styles.centered}>
<Text style={{ color: DANGER, fontWeight: "700" }}>Notification not found</Text>
<TouchableOpacity style={styles.backBtn} onPress={function () { router.back(); }}>
<Text style={{ color: BRAND, fontWeight: "700" }}>Go Back</Text>
</TouchableOpacity>
</View>
);
}

return (
<View style={styles.screen}>
<View style={styles.header}>
<TouchableOpacity style={styles.backBtn} onPress={function () { router.back(); }}>
<Feather name="arrow-left" size={20} color={TEXT} />
</TouchableOpacity>
<Text style={styles.headerTitle}>Notification</Text>
<View style={{ width: 40 }} />
</View>

<ScrollView style={styles.content} contentContainerStyle={styles.contentContainer}>  
    <Text style={styles.label}>ID</Text>  
    <Text style={styles.value}>{notification.id}</Text>  

    <Text style={styles.label}>Title</Text>  
    <Text style={styles.value}>{notification.title ? notification.title : "No title"}</Text>  

    {notification.body ? (  
      <>  
        <Text style={styles.label}>Body</Text>  
        <Text style={styles.value}>{notification.body}</Text>  
      </>  
    ) : null}  

    <Text style={styles.label}>Type</Text>  
    <Text style={styles.value}>{notification.type ? notification.type : "info"}</Text>  

    <Text style={styles.label}>Created</Text>  
    <Text style={styles.value}>  
      {notification.created_at ? new Date(notification.created_at).toLocaleString() : ""}  
    </Text>  

    {notification.quote_id ? (  
      <>  
        <Text style={styles.label}>Quote ID</Text>  
        <Text style={styles.code}>{String(notification.quote_id)}</Text>  
      </>  
    ) : null}  

    {notification.ticket_id ? (  
      <>  
        <Text style={styles.label}>Ticket ID</Text>  
        <Text style={styles.code}>{String(notification.ticket_id)}</Text>  
      </>  
    ) : null}  
  </ScrollView>  

  <View style={styles.actions}>  
    <TouchableOpacity style={styles.openBtn} onPress={openTarget}>  
      <Text style={styles.openBtnText}>Open</Text>  
    </TouchableOpacity>  

    {!notification.read ? null : (  
      <TouchableOpacity style={styles.actionBtn} onPress={markAsUnread}>  
        <Text style={styles.actionBtnText}>Mark as Unread</Text>  
      </TouchableOpacity>  
    )}  

    <TouchableOpacity style={styles.deleteBtn} onPress={deleteNotification}>  
      <Text style={styles.deleteBtnText}>Delete</Text>  
    </TouchableOpacity>  
  </View>  
</View>

);
}

const styles = StyleSheet.create({
screen: { flex: 1, backgroundColor: CARD },
header: {
backgroundColor: CARD,
borderBottomWidth: 1,
borderBottomColor: BORDER,
paddingHorizontal: 16,
paddingVertical: 12,
flexDirection: "row",
alignItems: "center",
justifyContent: "space-between",
},
backBtn: {
width: 40,
height: 40,
borderRadius: 20,
alignItems: "center",
justifyContent: "center",
},
headerTitle: {
fontSize: 18,
fontWeight: "900",
color: TEXT,
flex: 1,
textAlign: "center",
marginHorizontal: 16,
},
content: { flex: 1 },
contentContainer: { padding: 18 },
label: {
color: MUTED,
fontWeight: "700",
fontSize: 12,
marginBottom: 2,
marginTop: 12,
textTransform: "uppercase",
},
value: { color: TEXT, fontSize: 15, lineHeight: 22, marginBottom: 2 },
code: {
color: TEXT,
fontSize: 12,
fontFamily: Platform.OS === "ios" ? "Courier" : "monospace",
backgroundColor: "#f8fafc",
padding: 8,
borderRadius: 6,
borderWidth: 1,
borderColor: BORDER,
marginTop: 4,
},
actions: {
flexDirection: "row",
padding: 16,
borderTopWidth: 1,
borderTopColor: BORDER,
gap: 12,
backgroundColor: "#f8fafc",
},
openBtn: {
flex: 1,
backgroundColor: "#111827",
paddingVertical: 12,
borderRadius: 8,
alignItems: "center",
marginRight: 8,
},
openBtnText: { color: "#fff", fontWeight: "700", fontSize: 14 },
actionBtn: {
flex: 1,
backgroundColor: BRAND,
paddingVertical: 12,
borderRadius: 8,
alignItems: "center",
marginRight: 8,
},
actionBtnText: { color: "#fff", fontWeight: "700", fontSize: 14 },
deleteBtn: {
flex: 1,
backgroundColor: DANGER,
paddingVertical: 12,
borderRadius: 8,
alignItems: "center",
},
deleteBtnText: { color: "#fff", fontWeight: "700", fontSize: 14 },
centered: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: CARD },
});