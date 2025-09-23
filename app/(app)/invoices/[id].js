/* app/(app)/invoices/[id].js */
import React, { useEffect, useState, useMemo } from "react";
import { View, Text, TouchableOpacity, ActivityIndicator, Alert, Linking, ScrollView } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { supabase } from "../../../lib/supabase";

const BG = "#f7f9fc";
const CARD = "#ffffff";
const TEXT = "#0b1220";
const MUTED = "#6b7280";
const BORDER = "#e5e7eb";
const BRAND = "#2a86ff";
const OK = "#16a34a";
const WARN = "#f59e0b";

export default function InvoiceView() {
  const { id } = useLocalSearchParams();
  const invoiceId = useMemo(() => String(id || ""), [id]);
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [invoice, setInvoice] = useState(null);
  const [items, setItems] = useState([]);
  const [payments, setPayments] = useState([]);
  const [opening, setOpening] = useState(false);
  const [sendingReminder, setSendingReminder] = useState(false);

  useEffect(() => {
    let alive = true;
    if (!invoiceId) return;

    (async () => {
      try {
        setLoading(true);

        const iv = await supabase
          .from("invoices")
          .select(`
            id, invoice_number, status, issue_date, due_date, currency,
            subtotal, tax_total, total, deposit_applied, balance_due,
            notes, client_id, job_id, created_at, updated_at,
            sent_at, last_email_at, last_email_id,
            last_reminder_due_at, last_reminder_overdue_at,
            pdf_path, pdf_url
          `)
          .eq("id", invoiceId)
          .single();
        if (iv.error) throw iv.error;
        if (alive) setInvoice(iv.data);

        const it = await supabase
          .from("invoice_items")
          .select("id, kind, description, qty, unit_price, tax_rate, amount, created_at")
          .eq("invoice_id", invoiceId)
          .order("created_at", { ascending: true });
        if (!it.error && alive) setItems(it.data || []);

        const pay = await supabase
          .from("payments")
          .select("id, amount, method, reference, paid_at, voided_at, created_at")
          .eq("invoice_id", invoiceId)
          .order("created_at", { ascending: true });
        if (!pay.error && alive) setPayments(pay.data || []);
      } catch (e) {
        Alert.alert("Error", String(e?.message || e));
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => { alive = false; };
  }, [invoiceId]);

  async function reloadPaymentsAndInvoice() {
    if (!invoiceId) return;
    const iv = await supabase
      .from("invoices")
      .select(`
        id, invoice_number, status, issue_date, due_date, currency,
        subtotal, tax_total, total, deposit_applied, balance_due,
        notes, client_id, job_id, created_at, updated_at,
        sent_at, last_email_at, last_email_id,
        last_reminder_due_at, last_reminder_overdue_at,
        pdf_path, pdf_url
      `)
      .eq("id", invoiceId)
      .single();
    if (!iv.error) setInvoice(iv.data);

    const pay = await supabase
      .from("payments")
      .select("id, amount, method, reference, paid_at, voided_at, created_at")
      .eq("invoice_id", invoiceId)
      .order("created_at", { ascending: true });
    if (!pay.error) setPayments(pay.data || []);
  }

  function fmtAmount(n, cur) {
    const num = Number.isFinite(n) ? Number(n) : Number(n || 0);
    return (invoice?.currency || cur || "GBP") + " " + (Math.round(num * 100) / 100).toFixed(2);
  }
  function shortDT(x) { return x ? String(x).slice(0, 19).replace("T", " ") : null; }

  // Open in-app preview screen (viewer with Share/Save/Open)
  function openPreview() {
    try {
      if (opening) return;
      setOpening(true);
      const name = (invoice?.invoice_number ? String(invoice.invoice_number) : "invoice") + ".pdf";
      router.push({ pathname: "/(app)/invoices/preview", params: { id: invoiceId, name, merged: "0" } });
    } finally {
      setTimeout(() => setOpening(false), 250);
    }
  }

  async function sendReminder(kind) {
    try {
      if (sendingReminder) return;
      if (!invoice) return;
      if (invoice.status === "paid" || Number(invoice.balance_due || 0) <= 0) {
        Alert.alert("Already paid", "This invoice is fully paid.");
        return;
      }
      setSendingReminder(true);
      const { data, error } = await supabase.functions.invoke("send_invoice_reminder", {
        body: { invoice_id: invoiceId, kind }
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || "Failed to send reminder");
      Alert.alert("Reminder sent", "We’ve emailed the client.");
      await reloadPaymentsAndInvoice();
    } catch (e) {
      Alert.alert("Error", String(e?.message || e));
    } finally {
      setSendingReminder(false);
    }
  }

  function statusColor(s) {
    if (s === "paid") return OK;
    if (s === "partially_paid") return WARN;
    if (s === "sent") return BRAND;
    return MUTED;
  }

  const canMarkSent = !!invoice && invoice.status !== "sent" && invoice.status !== "paid";
  const canSendReminders = !!invoice && invoice.status !== "paid" && Number(invoice.balance_due || 0) > 0;

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
        Invoice {invoice.invoice_number}
      </Text>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 16 }}>
        <Card>
          <Row><Text style={{ color: MUTED }}>Status</Text><Text style={{ color: statusColor(invoice.status), fontWeight: "700" }}>{invoice.status}</Text></Row>
          {invoice.sent_at && <Row><Text style={{ color: MUTED }}>Sent at</Text><Text style={{ color: TEXT }}>{shortDT(invoice.sent_at)}</Text></Row>}
          {invoice.last_email_at && <Row><Text style={{ color: MUTED }}>Last email</Text><Text style={{ color: TEXT }}>{shortDT(invoice.last_email_at)}</Text></Row>}
          {invoice.last_reminder_due_at && <Row><Text style={{ color: MUTED }}>Last due reminder</Text><Text style={{ color: TEXT }}>{shortDT(invoice.last_reminder_due_at)}</Text></Row>}
          {invoice.last_reminder_overdue_at && <Row><Text style={{ color: MUTED }}>Last overdue reminder</Text><Text style={{ color: TEXT }}>{shortDT(invoice.last_reminder_overdue_at)}</Text></Row>}
          <Row><Text style={{ color: MUTED }}>Issue date</Text><Text style={{ color: TEXT }}>{invoice.issue_date}</Text></Row>
          <Row><Text style={{ color: MUTED }}>Due date</Text><Text style={{ color: TEXT }}>{invoice.due_date}</Text></Row>
          <Row><Text style={{ color: MUTED }}>Job ID</Text><Text style={{ color: TEXT }}>{invoice.job_id ? String(invoice.job_id) : "-"}</Text></Row>
          <Row><Text style={{ color: MUTED }}>Client ID</Text><Text style={{ color: TEXT }}>{invoice.client_id ? String(invoice.client_id) : "-"}</Text></Row>
        </Card>

        <Card>
          <Label>Line items</Label>
          {items.length === 0 && <Text style={{ color: MUTED }}>No items.</Text>}
          {items.map((it) => (
            <View key={it.id} style={{ paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: BORDER }}>
              <Text style={{ color: TEXT, fontWeight: "600" }}>{it.description}</Text>
              <Text style={{ color: MUTED }}>
                Kind: {it.kind} • Qty: {String(it.qty)} • Unit: {fmtAmount(it.unit_price)} • VAT: {String(it.tax_rate)}%
              </Text>
              <Text style={{ color: TEXT }}>Line total: {fmtAmount(it.amount)}</Text>
            </View>
          ))}
        </Card>

        <Totals
          currency={invoice.currency}
          subtotal={invoice.subtotal}
          tax_total={invoice.tax_total}
          total={invoice.total}
          deposit_applied={invoice.deposit_applied}
          balance_due={invoice.balance_due}
        />

        {payments.length > 0 && (
          <Card>
            <Label>Payments</Label>
            {payments.map((p) => {
              const isVoided = !!p.voided_at;
              const isNegative = Number(p.amount || 0) < 0;
              const when = (p.paid_at || p.created_at || "").slice(0, 10);
              return (
                <View key={p.id} style={{ paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: BORDER }}>
                  <Text style={{ color: TEXT, fontWeight: "600" }}>
                    {when} — {fmtAmount(p.amount)} {isNegative ? "(refund)" : ""}
                  </Text>
                  <Text style={{ color: MUTED }}>Method: {p.method || "other"} • Ref: {p.reference || "-"}</Text>
                  {isVoided && <Text style={{ color: MUTED, fontStyle: "italic" }}>Voided</Text>}
                </View>
              );
            })}
          </Card>
        )}

        {invoice.notes ? (
          <Card>
            <Label>Notes</Label>
            <Text style={{ color: TEXT }}>{invoice.notes}</Text>
          </Card>
        ) : null}
      </ScrollView>

      {/* -------- Buttons → open in-app preview, send -------- */}
      <View style={{ flexDirection: "row", gap: 10 }}>
        <Btn onPress={openPreview} disabled={opening} variant="primary">
          {opening ? "Opening…" : "Preview PDF"}
        </Btn>
        <Btn onPress={() => router.push({ pathname: "/invoices/send", params: { id: invoiceId } })}>
          Send
        </Btn>
      </View>

      <View style={{ height: 10 }} />

      {canSendReminders ? (
        <View style={{ flexDirection: "row", gap: 10 }}>
          <Btn onPress={() => sendReminder("due")} disabled={sendingReminder}>
            {sendingReminder ? "Sending…" : "Send reminder (due)"}
          </Btn>
          <Btn onPress={() => sendReminder("overdue")} variant="secondary" disabled={sendingReminder}>
            {sendingReminder ? "Sending…" : "Send reminder (overdue)"}
          </Btn>
        </View>
      ) : null}

      <View style={{ height: 10 }} />

      {canMarkSent ? (
        <View style={{ flexDirection: "row", gap: 10 }}>
          <Btn
            onPress={async () => {
              try {
                const { data, error } = await supabase.functions.invoke("mark_invoice_sent", { body: { invoice_id: invoiceId } });
                if (error) throw error;
                if (!data?.ok) throw new Error("Failed to mark as sent");
                Alert.alert("Marked as sent", "Status: " + (data.status || "sent"));
                await reloadPaymentsAndInvoice();
              } catch (e) {
                Alert.alert("Error", String(e?.message || e));
              }
            }}
            variant="secondary"
          >
            Mark as sent
          </Btn>
        </View>
      ) : null}
    </View>
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
function Row(props) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 6 }}>
      {props.children}
    </View>
  );
}
function Label(props) { return <Text style={{ color: TEXT, fontWeight: "700", marginBottom: 6 }}>{props.children}</Text>; }
function Btn(props) {
  const disabled = !!props.disabled;
  const variant = props.variant || "default";
  const bg = disabled ? "#9ca3af" : variant === "primary" ? OK : variant === "secondary" ? BORDER : BRAND;
  const color = variant === "secondary" ? TEXT : "#ffffff";
  return (
    <TouchableOpacity onPress={disabled ? () => {} : props.onPress} style={{ flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: "center", backgroundColor: bg }}>
      <Text style={{ color, fontWeight: "700" }}>{typeof props.children === "string" ? props.children : "Button"}</Text>
    </TouchableOpacity>
  );
}
function Totals(props) {
  const cur = props.currency || "GBP";
  const fmt = (n) => cur + " " + (Math.round(Number(n || 0) * 100) / 100).toFixed(2);
  return (
    <Card>
      <Label>Totals</Label>
      <Row><Text style={{ color: MUTED }}>Subtotal</Text><Text style={{ color: TEXT }}>{fmt(props.subtotal)}</Text></Row>
      <Row><Text style={{ color: MUTED }}>Tax</Text><Text style={{ color: TEXT }}>{fmt(props.tax_total)}</Text></Row>
      <Row><Text style={{ color: TEXT, fontWeight: "700" }}>Total</Text><Text style={{ color: TEXT, fontWeight: "700" }}>{fmt(props.total)}</Text></Row>
      {props.deposit_applied > 0 ? (<Row><Text style={{ color: MUTED }}>Deposit applied</Text><Text style={{ color: TEXT }}>- {fmt(props.deposit_applied)}</Text></Row>) : null}
      <Row><Text style={{ color: TEXT }}>Balance due</Text><Text style={{ color: TEXT }}>{fmt(props.balance_due)}</Text></Row>
    </Card>
  );
}