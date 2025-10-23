import React from "react";
import { View, Text, TextInput, TouchableOpacity } from "react-native";
import { styles, TEXT, MUTED } from "./ui";

export default function Step1ClientLocation({
  clientName, setClientName,
  clientEmail, setClientEmail,
  clientPhone, setClientPhone,
  clientAddress, setClientAddress,
  siteAddress, setSiteAddress,
  sameAsBilling, setSameAsBilling,
  setBillingOpen, setSiteOpen,
}) {
  return (
    <View>
      {/* Client details */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Client Details</Text>
        <Text style={styles.label}>Client name</Text>
        <TextInput
          style={styles.input}
          placeholder="Client name"
          placeholderTextColor={MUTED}
          value={clientName}
          onChangeText={setClientName}
          autoCapitalize="words"
        />

        <View style={{ flexDirection: "row", gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>Email (optional)</Text>
            <TextInput
              style={styles.input}
              placeholder="Email"
              placeholderTextColor={MUTED}
              value={clientEmail}
              onChangeText={setClientEmail}
              keyboardType="email-address"
              autoCapitalize="none"
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>Phone (optional)</Text>
            <TextInput
              style={styles.input}
              placeholder="Phone"
              placeholderTextColor={MUTED}
              value={clientPhone}
              onChangeText={setClientPhone}
              keyboardType="phone-pad"
            />
          </View>
        </View>
      </View>

      {/* Billing address */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Billing Address</Text>
        <TouchableOpacity onPress={() => setBillingOpen(true)} activeOpacity={0.8}>
          <View style={[styles.input, { justifyContent: "center" }]}>
            <Text style={{ color: clientAddress ? TEXT : MUTED }}>
              {clientAddress || "Tap to search or enter billing address"}
            </Text>
          </View>
        </TouchableOpacity>
      </View>

      {/* Site address & toggle */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Site Location & Travel</Text>

        <TouchableOpacity
          onPress={() => setSameAsBilling(!sameAsBilling)}
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            paddingVertical: 8,
            marginBottom: 8,
          }}
        >
          <Text style={styles.label}>Same as billing address</Text>
          <View style={{
            width: 22, height: 22, borderRadius: 6, borderWidth: 2,
            borderColor: sameAsBilling ? "#2a86ff" : "#cbd5e1",
            alignItems: "center", justifyContent: "center",
            backgroundColor: sameAsBilling ? "#2a86ff" : "#fff",
          }}>
            {sameAsBilling ? <Text style={{ color: "#fff", fontWeight: "900" }}>✓</Text> : null}
          </View>
        </TouchableOpacity>

        {!sameAsBilling && (
          <>
            <TouchableOpacity onPress={() => setSiteOpen(true)} activeOpacity={0.8}>
              <View style={[styles.input, { justifyContent: "center" }]}>
                <Text style={{ color: siteAddress ? TEXT : MUTED }}>
                  {siteAddress || "Tap to search or enter site address"}
                </Text>
              </View>
            </TouchableOpacity>
          </>
        )}
      </View>
    </View>
  );
}