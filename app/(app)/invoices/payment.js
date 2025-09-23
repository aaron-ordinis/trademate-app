// app/(app)/invoices/payment.js
import React, { useEffect, useMemo, useState } from "react";
import { View, Text, TextInput, TouchableOpacity, Alert, ActivityIndicator } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { supabase } from "../../../lib/supabase";

const BG = "#f7f9fc";
const CARD = "#ffffff";
const TEXT = "#0b1220";
const MUTED = "#6b7280";
const BORDER = "#e5e7eb";
const OK = "#16a34a";
const DISABLED = "#9ca3af";
const CHIP_BG = "#eef2f7";
const CHIP_ACTIVE = "#dbeafe";
const WARN = "#f59e0b";
const DANGER = "#dc2626";

export default function RecordPayment() {
  const { id } = useLocalSearchParams(); // invoice id
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [invoice, setInvoice] = useState(null);

  const [amountStr, setAmountStr] = useState(""); // keep raw input to avoid cursor jumps
  const [method, setMethod] = useState("bank_transfer");
  const [reference, setReference] = useState("");
  const [date, setDate] = useState(""); // "YYYY-MM-DD"
  const [submitting, setSubmitting] = useState(false);

  useEffect(function load() {
    let alive = true;
    (async function run() {
      try {
        setLoading(true);
        const iv = await supabase
          .from("invoices")
          .select("id, invoice_number, currency, balance_due, total, status")
          .eq("id", String(id || ""))
          .single();
        if (iv.error) throw iv.error;
        if (!alive) return;

        const data = iv.data;
        setInvoice(data);

        // Defaults
        const today = new Date();
        const y = String(today.getFullYear());
        const m = String(today.getMonth() + 1).padStart(2, "0");
        const d = String(today.getDate()).padStart(2, "0");
        setDate(y + "-" + m + "-" + d);

        // Prefill amount with current balance (>= 0)
        const initialAmt = Math.max(0, Number(data.balance_due || 0));
        setAmountStr(initialAmt > 0 ? String(initialAmt.toFixed(2)) : "");

        // Suggest a reference
        const sugg = (data.invoice_number ? String(data.invoice_number) : "INV") + " " + y + m + d;
        setReference(sugg);
      } catch (e) {
        Alert.alert("Error", String(e?.message || e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return function cleanup() { alive = false; };
  }, [id]);

  const amount = useMemo(() => {
    // accept "12", "12.", "12.3", "12.34" etc; strip invalid chars
    const cleaned = String(amountStr || "").replace(/[^0-9.]/g, "");
    const parts = cleaned.split(".");
    if (parts.length > 2) return NaN;
    // prevent many decimals in parsing preview
    const safe = parts.length === 2 ? parts[0] + "." + parts[1].slice(0, 2) : cleaned;
    const num = Number(safe);
    return Number.isFinite(num) ? num : NaN;
  }, [amountStr]);

  const newBalance = useMemo(() => {
    if (!invoice) return null;
    if (!Number.isFinite(amount)) return null;
    const balance = Number(invoice.balance_due ?? 0);
    return round2(balance - amount);
  }, [invoice, amount]);

  const overpay = useMemo(() => {
    if (newBalance == null) return false;
    return newBalance < 0;
  }, [newBalance]);

  function round2(n) {
    return Math.round(Number(n || 0) * 100) / 100;
  }
  function fmt(n, cur) {
    if (!Number.isFinite(Number(n))) n = 0;
    return (cur || "GBP") + " " + round2(n).toFixed(2);
  }

  async function submit() {
    try {
      if (submitting) return;
      if (!invoice) return;

      if (!Number.isFinite(amount) || amount <= 0) {
        Alert.alert("Invalid amount", "Enter a payment amount greater than zero.");
        return;
      }

      setSubmitting(true);
      const payload = {
        invoice_id: String(id || ""),
        amount: round2(amount),
        method: method,
        reference: reference || null,
        paid_at: date || null,
        idempotency_key: reference && reference.length > 0 ? reference : null
      };

      const { data, error } = await supabase.functions.invoke("record_payment", { body: payload });
      if (error) throw error;
      if (!data || !data.ok) throw new Error(String(data?.error || "Unknown error"));

      Alert.alert("Payment recorded", "Balance due: " + fmt(data.balance_due, invoice.currency));
      // ✅ route to dynamic detail screen
      router.replace("/invoices/" + String(id || ""));
    } catch (e) {
      Alert.alert("Error", String(e?.message || e));
    } finally {
      setSubmitting(false);
    }
  }

  if (loading || !invoice) {
    return (
      <View style={{ flex: 1, backgroundColor: BG, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator />
        <Text style={{ color: MUTED, marginTop: 8 }}>Loading invoice…</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: BG, padding: 16 }}>
      <Text style={{ fontSize: 18, fontWeight: "700", color: TEXT, marginBottom: 8 }}>
        Record payment — {invoice.invoice_number}
      </Text>

      <Card>
        <Row label="Amount">
          <TextInput
            value={amountStr}
            onChangeText={setAmountStr}
            keyboardType="decimal-pad"
            placeholder="0.00"
            placeholderTextColor={MUTED}
            style={inputStyle}
            autoCapitalize="none"
            autoCorrect={false}
            inputMode="decimal"
          />
          {!!overpay && (
            <Text style={{ color: WARN, marginTop: 6 }}>
              This exceeds the current balance. You can still save it, then refund the excess.
            </Text>
          )}
        </Row>

        <Row label="Method">
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
            {["bank_transfer", "cash", "card", "other"].map((m) => {
              const active = method === m;
              return (
                <TouchableOpacity
                  key={m}
                  onPress={() => setMethod(m)}
                  style={{
                    paddingVertical: 8,
                    paddingHorizontal: 12,
                    borderRadius: 999,
                    backgroundColor: active ? CHIP_ACTIVE : CHIP_BG,
                    borderWidth: 1,
                    borderColor: active ? "#bfdbfe" : BORDER
                  }}
                >
                  <Text style={{ color: TEXT, fontWeight: active ? "800" : "600" }}>{m.replace("_", " ")}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <TextInput
            value={method}
            onChangeText={setMethod}
            placeholder="bank_transfer / cash / card / other"
            placeholderTextColor={MUTED}
            style={inputStyle}
          />
        </Row>

        <Row label="Reference (recommended)">
          <TextInput
            value={reference}
            onChangeText={setReference}
            placeholder="e.g. INV-0001 BT ref"
            placeholderTextColor={MUTED}
            style={inputStyle}
            autoCapitalize="characters"
          />
        </Row>

        <Row label="Paid at (YYYY-MM-DD)">
          <TextInput
            value={date}
            onChangeText={setDate}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={MUTED}
            style={inputStyle}
          />
        </Row>
      </Card>

      <Card>
        <Text style={{ color: MUTED, marginBottom: 6 }}>Current balance</Text>
        <Text style={{ color: TEXT, fontWeight: "700" }}>{fmt(invoice.balance_due, invoice.currency)}</Text>

        <View style={{ height: 10 }} />

        <Text style={{ color: MUTED, marginBottom: 6 }}>New balance (after save)</Text>
        <Text
          style={{
            color: overpay ? DANGER : TEXT,
            fontWeight: "800"
          }}
        >
          {newBalance == null ? "—" : fmt(newBalance, invoice.currency)}
        </Text>
      </Card>

      <TouchableOpacity
        onPress={submit}
        disabled={submitting || !Number.isFinite(amount) || amount <= 0}
        style={{
          backgroundColor: submitting || !Number.isFinite(amount) || amount <= 0 ? DISABLED : OK,
          paddingVertical: 14,
          borderRadius: 12,
          alignItems: "center"
        }}
      >
        <Text style={{ color: "#ffffff", fontWeight: "700" }}>
          {submitting ? "Saving…" : "Save payment"}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

function Card(props) {
  return (
    <View style={{ backgroundColor: CARD, borderRadius: 14, padding: 12, borderWidth: 1, borderColor: BORDER, marginBottom: 12 }}>
      {props.children}
    </View>
  );
}

function Row(props) {
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={{ color: TEXT, fontWeight: "700", marginBottom: 6 }}>{props.label}</Text>
      {props.children}
    </View>
  );
}

const inputStyle = {
  backgroundColor: CARD,
  borderColor: BORDER,
  borderWidth: 1,
  borderRadius: 12,
  paddingHorizontal: 12,
  paddingVertical: 10,
  color: TEXT
};