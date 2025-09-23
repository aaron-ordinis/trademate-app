// app/(app)/invoices/send.js
import React, { useEffect, useState, useMemo } from "react";
import {
  View, Text, TextInput, TouchableOpacity, Alert, ActivityIndicator,
  ScrollView, KeyboardAvoidingView, Platform
} from "react-native";
import * as Clipboard from "expo-clipboard";
import { useLocalSearchParams, useRouter } from "expo-router";
import { supabase } from "../../../lib/supabase";

const BG = "#f7f9fc";
const CARD = "#ffffff";
const TEXT = "#0b1220";
const MUTED = "#6b7280";
const BORDER = "#e5e7eb";
const BRAND = "#2a86ff";
const OK = "#16a34a";
const DISABLED = "#9ca3af";

export default function SendInvoice() {
  const { id } = useLocalSearchParams(); // invoice id only
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);

  const [invoice, setInvoice] = useState(null);
  const [profile, setProfile] = useState(null);

  // email fields
  const [toEmail, setToEmail] = useState("");
  const [cc, setCc] = useState("");
  const [bcc, setBcc] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);

        const { data: auth } = await supabase.auth.getUser();
        const user = auth?.user;
        if (!user) throw new Error("Not signed in");

        const pr = await supabase
          .from("profiles")
          .select("company_name, business_name")
          .eq("id", user.id)
          .maybeSingle();
        if (pr.error) throw pr.error;
        if (alive) setProfile(pr.data || null);

        // load invoice with snapshot first, fallback to clients
        const iv = await supabase
          .from("invoices")
          .select(`
            id, invoice_number, status,
            currency, total, balance_due, due_date,
            client_id, client_snapshot
          `)
          .eq("id", String(id || ""))
          .single();
        if (iv.error) throw iv.error;
        if (!iv.data) throw new Error("Invoice not found");
        if (alive) setInvoice(iv.data);

        // Prefill To from snapshot → clients
        let email = iv.data?.client_snapshot?.email || "";
        let name  = iv.data?.client_snapshot?.name  || "";
        if ((!email || !name) && iv.data.client_id) {
          const c = await supabase
            .from("clients")
            .select("name, email")
            .eq("id", iv.data.client_id)
            .maybeSingle();
          if (!c.error && c.data) {
            email ||= c.data.email || "";
            name  ||= c.data.name  || "";
          }
        }
        setToEmail(email);

        // Subject + Message defaults
        const amt = (iv.data.currency || "GBP") + " " + fmtMoney(iv.data.balance_due ?? iv.data.total ?? 0);
        const due = iv.data.due_date ? " (due " + iv.data.due_date + ")" : "";
        setSubject("Invoice " + iv.data.invoice_number + due);

        const company = pr.data?.company_name || pr.data?.business_name || "Your business";
        const body = [
          name ? "Hi " + name + "," : "Hi,",
          "",
          "Please find your invoice via the secure link below.",
          "",
          "Amount due: " + amt,
          iv.data.due_date ? "Due date: " + iv.data.due_date : "",
          "",
          "Thanks,",
          company
        ].filter(Boolean).join("\n");
        setMessage(body);
      } catch (e) {
        Alert.alert("Error", String(e?.message || e));
        router.back();
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [id]);

  const headerSummary = useMemo(() => {
    if (!invoice) return "";
    const amt = (invoice.currency || "GBP") + " " + fmtMoney(invoice.balance_due ?? invoice.total ?? 0);
    return "#" + invoice.invoice_number + " • " + amt + " • " + (invoice.due_date ? ("Due " + invoice.due_date) : "No due date");
  }, [invoice]);

  function validateEmailList(s) {
    const trimmed = String(s || "").trim();
    if (!trimmed) return [];
    const parts = trimmed.split(",").map(x => x.trim()).filter(Boolean);
    const bad = parts.find(x => !x.includes("@") || x.startsWith(",") || x.endsWith(","));
    if (bad) throw new Error("Invalid email in list: " + bad);
    return parts;
  }

  async function onSend() {
    try {
      if (sending) return;
      if (!toEmail || !toEmail.includes("@")) {
        Alert.alert("Invalid email", "Please enter a valid recipient (To) email.");
        return;
      }
      if (!subject.trim()) {
        Alert.alert("Missing subject", "Please enter a subject.");
        return;
      }

      // Validate cc/bcc (comma-separated allowed)
      try { validateEmailList(cc); } catch (e) { Alert.alert("CC error", e.message); return; }
      try { validateEmailList(bcc); } catch (e) { Alert.alert("BCC error", e.message); return; }

      setSending(true);

      const payload = {
        invoice_id: String(id || ""),
        to: toEmail.trim(),
        cc: cc.trim() || null,
        bcc: bcc.trim() || null,
        subject: subject.trim(),
        html: nl2brHtml(message || "")
      };

      // Edge function sends or returns a share link (provider-less)
      const { data, error } = await supabase.functions.invoke("send_invoice", { body: payload });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || "Failed to send");

      if (data.provider === "none" && data.signedUrl) {
        try {
          await Clipboard.setStringAsync(data.signedUrl);
          Alert.alert("No email provider", "Share link copied to clipboard.\n\nYou can paste into your email app.");
        } catch {
          Alert.alert("No email provider", "Copy failed, but link is ready:\n\n" + data.signedUrl);
        }
      } else {
        Alert.alert("Sent", "Invoice emailed to " + toEmail);
      }

      // Go back to invoice detail screen
      router.replace("/invoices/" + String(id || ""));
    } catch (e) {
      Alert.alert("Send failed", String(e?.message || e));
    } finally {
      setSending(false);
    }
  }

  async function getShareLink() {
    try {
      const payload = { invoice_id: String(id || "") };
      const { data, error } = await supabase.functions.invoke("get_invoice_signed_url", { body: payload });
      if (error) throw error;
      if (!data?.ok || !data?.url) throw new Error("Could not get link");
      await Clipboard.setStringAsync(data.url);
      Alert.alert("Share link", "Copied to clipboard.");
    } catch (e) {
      Alert.alert("Error", String(e?.message || e));
    }
  }

  if (loading || !invoice) {
    return (
      <View style={{ flex: 1, backgroundColor: BG, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator />
        <Text style={{ color: MUTED, marginTop: 8 }}>Preparing email…</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: BG }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 28 }}>
        <Text style={{ fontSize: 18, fontWeight: "800", color: TEXT, marginBottom: 4 }}>
          Send invoice
        </Text>
        <Text style={{ color: MUTED, marginBottom: 10 }}>{headerSummary}</Text>

        <Card>
          <Label>To</Label>
          <Input value={toEmail} onChangeText={setToEmail} keyboardType="email-address" placeholder="client@email.com" />

          <Label>CC</Label>
          <Input value={cc} onChangeText={setCc} keyboardType="email-address" placeholder="optional (comma-separated)" />

          <Label>BCC</Label>
          <Input value={bcc} onChangeText={setBcc} keyboardType="email-address" placeholder="optional (comma-separated)" />

          <Label>Subject</Label>
          <Input value={subject} onChangeText={setSubject} placeholder="Subject" />

          <Label>Message</Label>
          <TextInput
            multiline
            value={message}
            onChangeText={setMessage}
            placeholder="Message to client…"
            style={{
              backgroundColor: CARD, borderColor: BORDER, borderWidth: 1, borderRadius: 12,
              minHeight: 140, padding: 12, color: TEXT, textAlignVertical: "top"
            }}
            placeholderTextColor={MUTED}
          />
        </Card>

        <View style={{ flexDirection: "row", gap: 10 }}>
          <Btn onPress={onSend} disabled={sending} variant="primary">
            {sending ? "Sending…" : "Send invoice"}
          </Btn>
          <Btn onPress={getShareLink} disabled={sending} variant="secondary">
            Get share link
          </Btn>
        </View>

        <TouchableOpacity
          onPress={() => router.back()}
          style={{ backgroundColor: "#eef2f7", paddingVertical: 14, borderRadius: 12, alignItems: "center", marginTop: 10 }}
        >
          <Text style={{ color: TEXT, fontWeight: "800" }}>Cancel</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/* ---------- Tiny UI helpers ---------- */
function Card(props) {
  return (
    <View style={{ backgroundColor: CARD, borderRadius: 14, padding: 12, borderWidth: 1, borderColor: BORDER, marginBottom: 12 }}>
      {props.children}
    </View>
  );
}
function Label(props) {
  return <Text style={[{ color: TEXT, fontWeight: "700", marginBottom: 6 }, props.style]}>{props.children}</Text>;
}
function Input(props) {
  return (
    <TextInput
      {...props}
      style={[
        { backgroundColor: CARD, borderColor: BORDER, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, color: TEXT, marginBottom: 10 },
        props.style || {}
      ]}
      placeholderTextColor={MUTED}
      autoCapitalize="none"
      autoCorrect={false}
    />
  );
}

/* ---------- helpers ---------- */
function fmtMoney(n) {
  return (Math.round(Number(n || 0) * 100) / 100).toFixed(2);
}
function nl2brHtml(s) {
  const esc = String(s || "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return esc.split("\n").join("<br/>");
}
function Btn({ children, onPress, disabled, variant = "default" }) {
  const bg =
    disabled ? DISABLED :
    variant === "primary" ? OK :
    variant === "secondary" ? BORDER : BRAND;
  const color = variant === "secondary" ? TEXT : "#ffffff";
  return (
    <TouchableOpacity
      onPress={disabled ? () => {} : onPress}
      style={{ flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: "center", backgroundColor: bg }}
      activeOpacity={0.9}
    >
      <Text style={{ color, fontWeight: "800" }}>
        {typeof children === "string" ? children : "Button"}
      </Text>
    </TouchableOpacity>
  );
}