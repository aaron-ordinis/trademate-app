// app/(app)/invoices/[id].js
import React, { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, ActivityIndicator, Alert, Linking, ScrollView } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { supabase } from "../../../../lib/supabase";

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
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [invoice, setInvoice] = useState(null);
  const [items, setItems] = useState([]);
  const [payments, setPayments] = useState([]);
  const [opening, setOpening] = useState(false);
  const [sendingReminder, setSendingReminder] = useState(false);

  // ---------- initial load ----------
  useEffect(function load() {
    let alive = true;
    (async function run() {
      try {
        setLoading(true);

        // include pdf_path & merged_pdf_path so we can sign directly from Storage
        const iv = await supabase
          .from("invoices")
          .select(`
            id, invoice_number, status, issue_date, due_date, currency,
            subtotal, tax_total, total, deposit_applied, balance_due,
            notes, client_id, job_id, created_at, updated_at,
            sent_at, last_email_at, last_email_id,
            last_reminder_due_at, last_reminder_overdue_at,
            pdf_path, merged_pdf_path
          `)
          .eq("id", String(id || ""))
          .single();
        if (iv.error) throw iv.error;
        if (alive) setInvoice(iv.data);

        const it = await supabase
          .from("invoice_items")
          .select("id, kind, description, qty, unit_price, tax_rate, amount, created_at")
          .eq("invoice_id", String(id || ""))
          .order("created_at", { ascending: true });
        if (!it.error && alive) setItems(it.data || []);

        const pay = await supabase
          .from("payments")
          .select("id, amount, method, reference, paid_at, voided_at, created_at")
          .eq("invoice_id", String(id || ""))
          .order("created_at", { ascending: true });
        if (!pay.error && alive) setPayments(pay.data || []);
      } catch (e) {
        Alert.alert("Error", String(e?.message || e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [id]);

  // ---------- small helpers ----------
  async function reloadPaymentsAndInvoice() {
    try {
      const iv = await supabase
        .from("invoices")
        .select(`
          id, invoice_number, status, issue_date, due_date, currency,
          subtotal, tax_total, total, deposit_applied, balance_due,
          notes, client_id, job_id, created_at, updated_at,
          sent_at, last_email_at, last_email_id,
          last_reminder_due_at, last_reminder_overdue_at,
          pdf_path, merged_pdf_path
        `)
        .eq("id", String(id || ""))
        .single();
      if (!iv.error) setInvoice(iv.data);

      const pay = await supabase
        .from("payments")
        .select("id, amount, method, reference, paid_at, voided_at, created_at")
        .eq("invoice_id", String(id || ""))
        .order("created_at", { ascending: true });
      if (!pay.error) setPayments(pay.data || []);
    } catch (e) {
      Alert.alert("Error", String(e?.message || e));
    }
  }

  function fmtAmount(n, cur) {
    if (typeof n !== "number") n = Number(n || 0);
    const s = (Math.round(n * 100) / 100).toFixed(2);
    return (cur || "GBP") + " " + s;
  }
  function fmt(n, cur) {
    if (typeof n !== "number") n = Number(n || 0);
    const s = (Math.round(n * 100) / 100).toFixed(2);
    return (cur || "GBP") + " " + s;
  }
  function shortDT(x) {
    return x ? String(x).slice(0, 19).replace("T", " ") : null;
  }

  // ---------- open PDF (storage first, then function fallback) ----------
  async function openPdf(merged) {
    try {
      if (opening) return;
      setOpening(true);

      const path = merged ? (invoice?.merged_pdf_path || invoice?.pdf_path) : invoice?.pdf_path;

      if (!path) {
        // no stored path; try the Edge function as a fallback
        const { data, error } = await supabase.functions.invoke("get_invoice_signed_url", {
          body: { invoice_id: String(id || ""), merged: !!merged },
        });
        if (error || !data?.ok || !data?.url) throw new Error("No PDF available to open.");
        const supported = await Linking.canOpenURL(data.url);
        if (supported) await Linking.openURL(data.url);
        else Alert.alert("Cannot open URL", data.url);
        return;
      }

      // Sign the object in "secured" bucket
      const { data: signed, error: signErr } = await supabase
        .storage
        .from("secured")
        .createSignedUrl(path, 60 * 10);

      if (signErr || !signed?.signedUrl) {
        // If object is missing in Storage, tell the user & fall back
        if (String(signErr?.message || "").toLowerCase().includes("not found")) {
          Alert.alert("PDF file missing", `We couldn't find ${path} in Storage.\nTrying a fallback…`);
          const { data, error } = await supabase.functions.invoke("get_invoice_signed_url", {
            body: { invoice_id: String(id || ""), merged: !!merged },
          });
          if (error || !data?.ok || !data?.url) throw new Error("Object not found.");
          const supported = await Linking.canOpenURL(data.url);
          if (supported) await Linking.openURL(data.url);
          else Alert.alert("Cannot open URL", data.url);
          return;
        }
        throw new Error(signErr?.message || "Could not sign URL");
      }

      const url = signed.signedUrl;
      const supported = await Linking.canOpenURL(url);
      if (supported) await Linking.openURL(url);
      else Alert.alert("Cannot open URL", url);
    } catch (e) {
      Alert.alert("Error", String(e?.message || e));
    } finally {
      setOpening(false);
    }
  }

  // ---------- other actions ----------
  async function regenerateMerged() {
    try {
      const { data, error } = await supabase.functions.invoke("regenerate_invoice_pdf", { body: { invoice_id: String(id || "") } });
      if (error) throw error;
      if (!data || !data.ok || !data.url) throw new Error("Failed to regenerate merged PDF");
      await reloadPaymentsAndInvoice(); // pick up merged_pdf_path if we store it
      Alert.alert("Merged PDF ready", "Opening merged invoice…");
      const supported = await Linking.canOpenURL(data.url);
      if (supported) { await Linking.openURL(data.url); }
    } catch (e) {
      Alert.alert("Error", String(e?.message || e));
    }
  }

  async function voidPayment(paymentId) {
    try {
      Alert.alert(
        "Void payment?",
        "This will void the payment and update the invoice totals.",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Void", style: "destructive", onPress: async () => {
              const { data, error } = await supabase.functions.invoke("void_payment", { body: { payment_id: paymentId } });
              if (error) throw error;
              if (!data || !data.ok) throw new Error("Failed to void");
              Alert.alert("Voided", "Payment voided. Totals updated.");
              await reloadPaymentsAndInvoice();
            }
          }
        ]
      );
    } catch (e) {
      Alert.alert("Error", String(e?.message || e));
    }
  }

  async function refundPaymentFull(p) {
    try {
      const amt = Math.abs(Number(p.amount || 0));
      if (!(amt > 0)) { Alert.alert("Invalid", "Nothing to refund."); return; }
      Alert.alert(
        "Refund full amount?",
        "This will record a refund for the full payment amount.",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Refund", style: "destructive", onPress: async () => {
              const ref = "refund of " + String(p.reference || p.id);
              const { data, error } = await supabase.functions.invoke("refund_payment", {
                body: { payment_id: p.id, amount: amt, reference: ref }
              });
              if (error) throw error;
              if (!data || !data.ok) throw new Error("Failed to refund");
              Alert.alert("Refunded", "Refund recorded. Totals updated.");
              await reloadPaymentsAndInvoice();
            }
          }
        ]
      );
    } catch (e) {
      Alert.alert("Error", String(e?.message || e));
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
        body: { invoice_id: String(id || ""), kind }
      });
      if (error) throw error;
      if (!data || !data.ok) throw new Error(data?.error || "Failed to send reminder");
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

  const canMarkSent = invoice && invoice.status !== "sent" && invoice.status !== "paid";
  const canSendReminders = invoice && invoice.status !== "paid" && Number(invoice.balance_due || 0) > 0;
  const hasMerged = !!invoice?.merged_pdf_path;

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
          <Row>
            <Text style={{ color: MUTED }}>Status</Text>
            <Text style={{ color: statusColor(invoice.status), fontWeight: "700" }}>{invoice.status}</Text>
          </Row>

          {invoice.sent_at ? (
            <Row>
              <Text style={{ color: MUTED }}>Sent at</Text>
              <Text style={{ color: TEXT }}>{shortDT(invoice.sent_at)}</Text>
            </Row>
          ) : null}

          {invoice.last_email_at ? (
            <Row>
              <Text style={{ color: MUTED }}>Last email</Text>
              <Text style={{ color: TEXT }}>{shortDT(invoice.last_email_at)}</Text>
            </Row>
          ) : null}

          {invoice.last_reminder_due_at ? (
            <Row>
              <Text style={{ color: MUTED }}>Last due reminder</Text>
              <Text style={{ color: TEXT }}>{shortDT(invoice.last_reminder_due_at)}</Text>
            </Row>
          ) : null}

          {invoice.last_reminder_overdue_at ? (
            <Row>
              <Text style={{ color: MUTED }}>Last overdue reminder</Text>
              <Text style={{ color: TEXT }}>{shortDT(invoice.last_reminder_overdue_at)}</Text>
            </Row>
          ) : null}

          <Row><Text style={{ color: MUTED }}>Issue date</Text><Text style={{ color: TEXT }}>{invoice.issue_date}</Text></Row>
          <Row><Text style={{ color: MUTED }}>Due date</Text><Text style={{ color: TEXT }}>{invoice.due_date}</Text></Row>
          <Row><Text style={{ color: MUTED }}>Job ID</Text><Text style={{ color: TEXT }}>{invoice.job_id ? String(invoice.job_id) : "-"}</Text></Row>
          <Row><Text style={{ color: MUTED }}>Client ID</Text><Text style={{ color: TEXT }}>{invoice.client_id ? String(invoice.client_id) : "-"}</Text></Row>
        </Card>

        <Card>
          <Label>Line items</Label>
          {items.length === 0 && <Text style={{ color: MUTED }}>No items.</Text>}
          {items.map(function(it) {
            return (
              <View key={it.id} style={{ paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: BORDER }}>
                <Text style={{ color: TEXT, fontWeight: "600" }}>{it.description}</Text>
                <Text style={{ color: MUTED }}>
                  Kind: {it.kind} • Qty: {String(it.qty)} • Unit: {fmt(it.unit_price, invoice.currency)} • VAT: {String(it.tax_rate)}%
                </Text>
                <Text style={{ color: TEXT }}>Line total: {fmt(it.amount, invoice.currency)}</Text>
              </View>
            );
          })}
        </Card>

        <Totals
          currency={invoice.currency}
          subtotal={invoice.subtotal}
          tax_total={invoice.tax_total}
          total={invoice.total}
          deposit_applied={invoice.deposit_applied}
          balance_due={invoice.balance_due}
        />

        {payments && payments.length > 0 ? (
          <Card>
            <Label>Payments</Label>
            {payments.map(function(p) {
              const isVoided = !!p.voided_at;
              const isNegative = Number(p.amount || 0) < 0;
              const when = (p.paid_at || p.created_at || "").slice(0, 10);
              return (
                <View key={p.id} style={{ paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: BORDER }}>
                  <Text style={{ color: TEXT, fontWeight: "600" }}>
                    {when} — {fmtAmount(p.amount, invoice.currency)} {isNegative ? "(refund)" : ""}
                  </Text>
                  <Text style={{ color: MUTED }}>Method: {p.method || "other"} • Ref: {p.reference || "-"}</Text>
                  <View style={{ flexDirection: "row", gap: 10, marginTop: 6, alignItems: "center" }}>
                    {!isVoided ? (
                      <>
                        {!isNegative && (
                          <Btn onPress={function(){ refundPaymentFull(p); }}>
                            Refund
                          </Btn>
                        )}
                        <Btn onPress={function(){ voidPayment(p.id); }} variant="secondary">
                          Void
                        </Btn>
                      </>
                    ) : (
                      <Text style={{ color: MUTED, fontStyle: "italic" }}>Voided</Text>
                    )}
                  </View>
                </View>
              );
            })}
          </Card>
        ) : null}

        {invoice.notes ? (
          <Card>
            <Label>Notes</Label>
            <Text style={{ color: TEXT }}>{invoice.notes}</Text>
          </Card>
        ) : null}
      </ScrollView>

      {/* PDF actions */}
      <View style={{ flexDirection: "row", gap: 10 }}>
        <Btn onPress={function(){ openPdf(false); }} disabled={opening} variant="primary">
          {opening ? "Opening…" : "Open PDF"}
        </Btn>
        {hasMerged ? (
          <Btn onPress={function(){ openPdf(true); }} disabled={opening}>
            {opening ? "Opening…" : "Open merged"}
          </Btn>
        ) : (
          <Btn onPress={function(){ regenerateMerged(); }} variant="secondary">
            Regenerate merged
          </Btn>
        )}
      </View>

      <View style={{ height: 10 }} />

      {/* Send actions */}
      <View style={{ flexDirection: "row", gap: 10 }}>
        <Btn onPress={function(){
          router.push({ pathname: "/invoices/send", params: { id: String(id || ""), merged: "false" } });
        }}>
          Send base
        </Btn>
        <Btn onPress={function(){
          router.push({ pathname: "/invoices/send", params: { id: String(id || ""), merged: "true" } });
        }}>
          Send merged
        </Btn>
      </View>

      <View style={{ height: 10 }} />

      {/* Quick reminders (due / overdue) */}
      {canSendReminders ? (
        <View style={{ flexDirection: "row", gap: 10 }}>
          <Btn onPress={function(){ sendReminder("due"); }} disabled={sendingReminder}>
            {sendingReminder ? "Sending…" : "Send reminder (due)"}
          </Btn>
          <Btn onPress={function(){ sendReminder("overdue"); }} variant="secondary" disabled={sendingReminder}>
            {sendingReminder ? "Sending…" : "Send reminder (overdue)"}
          </Btn>
        </View>
      ) : null}

      <View style={{ height: 10 }} />

      {/* Mark as sent (only if not already sent/paid) */}
      {canMarkSent ? (
        <View style={{ flexDirection: "row", gap: 10 }}>
          <Btn onPress={async function(){
            try {
              const { data, error } = await supabase.functions.invoke("mark_invoice_sent", { body: { invoice_id: String(id || "") } });
              if (error) throw error;
              if (!data || !data.ok) throw new Error("Failed to mark as sent");
              Alert.alert("Marked as sent", "Status: " + (data.status || "sent"));
              await reloadPaymentsAndInvoice();
            } catch (e) {
              Alert.alert("Error", String(e && e.message ? e.message : e));
            }
          }} variant="secondary">
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

function Label(props) {
  return <Text style={{ color: TEXT, fontWeight: "700", marginBottom: 6 }}>{props.children}</Text>;
}

function Btn(props) {
  const disabled = !!props.disabled;
  const variant = props.variant || "default";
  const bg =
    disabled ? "#9ca3af" :
    variant === "primary" ? OK :
    variant === "secondary" ? BORDER : BRAND;
  const color = variant === "secondary" ? TEXT : "#ffffff";
  return (
    <TouchableOpacity onPress={disabled ? function(){} : props.onPress} style={{ flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: "center", backgroundColor: bg }}>
      <Text style={{ color: color, fontWeight: "700" }}>{typeof props.children === "string" ? props.children : "Button"}</Text>
    </TouchableOpacity>
  );
}

function Totals(props) {
  const cur = props.currency || "GBP";
  function fmt(n) {
    if (typeof n !== "number") n = Number(n || 0);
    return cur + " " + (Math.round(n * 100) / 100).toFixed(2);
    }
  return (
    <Card>
      <Label>Totals</Label>
      <Row><Text style={{ color: MUTED }}>Subtotal</Text><Text style={{ color: TEXT }}>{fmt(props.subtotal)}</Text></Row>
      <Row><Text style={{ color: MUTED }}>Tax</Text><Text style={{ color: TEXT }}>{fmt(props.tax_total)}</Text></Row>
      <Row><Text style={{ color: TEXT, fontWeight: "700" }}>Total</Text><Text style={{ color: TEXT, fontWeight: "700" }}>{fmt(props.total)}</Text></Row>
      {props.deposit_applied > 0 ? (
        <Row><Text style={{ color: MUTED }}>Deposit applied</Text><Text style={{ color: TEXT }}>- {fmt(props.deposit_applied)}</Text></Row>
      ) : null}
      <Row><Text style={{ color: TEXT }}>Balance due</Text><Text style={{ color: TEXT }}>{fmt(props.balance_due)}</Text></Row>
    </Card>
  );
}