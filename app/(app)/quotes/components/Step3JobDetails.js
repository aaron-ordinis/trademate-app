import React from "react";
import { View, Text, TextInput } from "react-native";
import { styles, BRAND, WARN, AMBER, MUTED } from "./ui";

const MAX_JOB_DETAILS = 250;
const COUNTER_AMBER_AT = 200;

export default function Step3JobDetails({
  jobSummary, setJobSummary,
  jobDetails, setJobDetails,
  remaining, jobLen,
}) {
  return (
    <View>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Job Summary</Text>
        <TextInput
          value={jobSummary}
          onChangeText={setJobSummary}
          placeholder="e.g. Kitchen renovation"
          placeholderTextColor={MUTED}
          style={styles.input}
          returnKeyType="next"
        />
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Job Details</Text>
        <View style={{ position: "relative" }}>
          <TextInput
            value={jobDetails}
            onChangeText={(t) => setJobDetails((t || "").slice(0, MAX_JOB_DETAILS))}
            placeholder="Describe the work to be done…"
            placeholderTextColor={MUTED}
            style={[styles.input, { minHeight: 120, textAlignVertical: "top" }]}
            multiline
          />
          <View style={styles.counterBadge}>
            <Text
              style={{
                fontWeight: "800",
                fontSize: 12,
                color:
                  jobLen >= MAX_JOB_DETAILS ? WARN
                    : jobLen >= COUNTER_AMBER_AT ? AMBER
                    : BRAND,
              }}
            >
              {remaining} left
            </Text>
          </View>
        </View>
        <Text style={styles.hint}>
          Be specific about materials, sizes, finishes and any special access requirements.
        </Text>
      </View>
    </View>
  );
}