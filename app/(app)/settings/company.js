// app/(app)/settings/company.js
import React, { useEffect, useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  StatusBar,
  Platform,
  TextInput,
  TouchableOpacity,
  Alert,
  KeyboardAvoidingView,
  ScrollView,
  Switch,
  Modal,
} from "react-native";
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from "expo-router";
import * as NavigationBar from "expo-navigation-bar";
import * as SystemUI from "expo-system-ui";
import { Feather } from "@expo/vector-icons";
import { supabase } from "../../../lib/supabase";

/* ---------- THEME ---------- */
const CARD = "#ffffff";
const TEXT = "#0b1220";
const MUTED = "#6b7280";
const BORDER = "#e6e9ee";
const BRAND = "#2a86ff";
const BG = "#ffffff";

/* ---------- INFO BUTTON COMPONENT ---------- */
function InfoButton({ title, tips = [] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <TouchableOpacity onPress={() => setOpen(true)} style={styles.infoBtn}>
        <Text style={{ color: MUTED, fontWeight: "900" }}>i</Text>
      </TouchableOpacity>
      <Modal visible={open} animationType="fade" transparent onRequestClose={() => setOpen(false)}>
        <View style={styles.modalBackdrop} />
        <View style={styles.modalWrap}>
          <View style={styles.modalCard}>
            <View style={styles.modalHead}>
              <Text style={{ color: TEXT, fontWeight: "900", fontSize: 16 }}>{title}</Text>
              <TouchableOpacity onPress={() => setOpen(false)} style={styles.smallBtn}>
                <Text style={styles.smallBtnText}>Close</Text>
              </TouchableOpacity>
            </View>
            {tips.slice(0, 6).map((t, i) => (
              <View key={i} style={{ flexDirection: "row", gap: 8, marginBottom: 8 }}>
                <Text style={{ color: BRAND, fontWeight: "900" }}>•</Text>
                <Text style={{ color: TEXT, flex: 1 }}>{t}</Text>
              </View>
            ))}
          </View>
        </View>
      </Modal>
    </>
  );
}

export default function CompanySettings() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  // Profile state
  const [uid, setUid] = useState(null);

  const [businessName, setBusinessName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [companyRegNo, setCompanyRegNo] = useState("");

  const [vatRegistered, setVatRegistered] = useState(false);
  const [vatNumber, setVatNumber] = useState("");

  const [addressLine1, setAddressLine1] = useState("");
  const [city, setCity] = useState("");
  const [postcode, setPostcode] = useState("");

  const [email, setEmail] = useState(""); // Company contact email (editable here)
  const [phone, setPhone] = useState("");

  const [hoursPerDay, setHoursPerDay] = useState("");
  const [hourlyRate, setHourlyRate] = useState("");
  const [travelRatePerMile, setTravelRatePerMile] = useState("");

  const [saving, setSaving] = useState(false);

  /* ---------- system chrome (white header to status bar) ---------- */
  useEffect(() => {
    StatusBar.setBarStyle("dark-content", false);
    if (Platform.OS === "android") {
      StatusBar.setBackgroundColor("#ffffff", false);
      NavigationBar.setBackgroundColorAsync?.("#ffffff");
      NavigationBar.setButtonStyleAsync?.("dark");
      NavigationBar.setBorderColorAsync?.("#ffffff");
    }
    SystemUI.setBackgroundColorAsync?.("#ffffff");
  }, []);

  /* ---------- load profile (quietly, no spinners) ---------- */
  const load = useCallback(async () => {
    try {
      const { data: auth } = await supabase.auth.getUser();
      const user = auth?.user;
      if (!user) return;
      setUid(user.id);

      const { data: prof, error } = await supabase
        .from("profiles")
        .select(
          `
          business_name, company_name, company_reg_no,
          vat_registered, vat_number,
          address_line1, city, postcode,
          email, phone,
          hours_per_day, hourly_rate, travel_rate_per_mile
        `
        )
        .eq("id", user.id)
        .maybeSingle();

      if (error) throw error;

      setBusinessName(prof?.business_name || "");
      setCompanyName(prof?.company_name || "");
      setCompanyRegNo(prof?.company_reg_no || "");

      setVatRegistered(!!prof?.vat_registered);
      setVatNumber(prof?.vat_number || "");

      setAddressLine1(prof?.address_line1 || "");
      setCity(prof?.city || "");
      setPostcode(prof?.postcode || "");

      // prefer profile.email to auth email for company contact
      setEmail(prof?.email || user.email || "");
      setPhone(prof?.phone || "");

      // New fields
      setHoursPerDay(prof?.hours_per_day != null ? String(prof.hours_per_day) : "");
      setHourlyRate(prof?.hourly_rate != null ? String(prof.hourly_rate) : "");
      setTravelRatePerMile(prof?.travel_rate_per_mile != null ? String(prof.travel_rate_per_mile) : "");
    } catch (e) {
      console.warn("[company] load", e?.message || e);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /* ---------- save ---------- */
  const save = useCallback(async () => {
    if (!uid) return;

    const trim = (s) => String(s || "").trim();

    // Optional lightweight validation
    const emailVal = trim(email);
    if (emailVal && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailVal)) {
      Alert.alert("Check email", "Please enter a valid company email address.");
      return;
    }

    // Validate new fields (optional, basic)
    if (hoursPerDay && isNaN(Number(hoursPerDay))) {
      Alert.alert("Check hours per day", "Please enter a valid number for hours per day.");
      return;
    }
    if (hourlyRate && isNaN(Number(hourlyRate))) {
      Alert.alert("Check hourly rate", "Please enter a valid number for hourly rate.");
      return;
    }
    if (travelRatePerMile && isNaN(Number(travelRatePerMile))) {
      Alert.alert("Check mileage rate", "Please enter a valid number for mileage rate.");
      return;
    }

    try {
      setSaving(true);

      const updates = {
        business_name: trim(businessName) || null,
        company_name: trim(companyName) || null,
        company_reg_no: trim(companyRegNo) || null,
        vat_registered: !!vatRegistered,
        vat_number: trim(vatNumber) || null,
        address_line1: trim(addressLine1) || null,
        city: trim(city) || null,
        postcode: trim(postcode) || null,
        email: emailVal || null,
        phone: trim(phone) || null,
        updated_at: new Date().toISOString(),
        // New fields
        hours_per_day: hoursPerDay !== "" ? Number(hoursPerDay) : null,
        hourly_rate: hourlyRate !== "" ? Number(hourlyRate) : null,
        travel_rate_per_mile: travelRatePerMile !== "" ? Number(travelRatePerMile) : null,
      };

      const { error } = await supabase.from("profiles").update(updates).eq("id", uid);
      if (error) throw error;

      Alert.alert("Saved", "Your company details have been updated.");
    } catch (e) {
      Alert.alert("Save failed", e?.message || "Could not save changes.");
    } finally {
      setSaving(false);
    }
  }, [
    uid,
    businessName,
    companyName,
    companyRegNo,
    vatRegistered,
    vatNumber,
    addressLine1,
    city,
    postcode,
    email,
    phone,
    hoursPerDay,
    hourlyRate,
    travelRatePerMile,
  ]);

  return (
    <View style={styles.screen}>
      <View style={{ height: insets.top, backgroundColor: CARD }} />
      
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Feather name="arrow-left" size={20} color={TEXT} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Company Details</Text>
        <TouchableOpacity
          onPress={save}
          disabled={saving}
          style={[styles.saveBtn, saving && { opacity: 0.5 }]}
        >
          <Text style={styles.saveTxt}>{saving ? "Saving..." : "Save"}</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.content} contentContainerStyle={styles.contentContainer}>
        {/* Company Identity */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>Company Identity</Text>
            <InfoButton
              title="Company Information"
              tips={[
                "Business name is your trading name that appears on documents.",
                "Company name is your legal registered company name (if incorporated).",
                "Registration number is your Companies House number for UK limited companies.",
                "These details appear on invoices and quotes for legal compliance.",
              ]}
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Business Name</Text>
            <TextInput
              value={businessName}
              onChangeText={setBusinessName}
              placeholder="Your trading/business name"
              placeholderTextColor={MUTED}
              style={styles.input}
            />
            <Text style={styles.helpText}>
              The name you trade under and want to appear on documents.
            </Text>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Company Name (Legal)</Text>
            <TextInput
              value={companyName}
              onChangeText={setCompanyName}
              placeholder="Registered company name (optional)"
              placeholderTextColor={MUTED}
              style={styles.input}
            />
            <Text style={styles.helpText}>
              Official registered company name if different from business name.
            </Text>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Company Registration Number</Text>
            <TextInput
              value={companyRegNo}
              onChangeText={setCompanyRegNo}
              placeholder="12345678"
              placeholderTextColor={MUTED}
              style={styles.input}
              autoCapitalize="characters"
            />
            <Text style={styles.helpText}>
              Companies House registration number for UK limited companies.
            </Text>
          </View>
        </View>

        {/* VAT */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>VAT Registration</Text>
            <InfoButton
              title="VAT Information"
              tips={[
                "Enable if your business is registered for VAT with HMRC.",
                "VAT number format: GB followed by 9 digits (e.g. GB123456789).",
                "This information appears on invoices for VAT compliance.",
                "Only enable if you're legally required to charge VAT.",
              ]}
            />
          </View>

          <View style={styles.toggleRow}>
            <Text style={styles.toggleLabel}>VAT registered business</Text>
            <Switch
              value={vatRegistered}
              onValueChange={(v) => setVatRegistered(v)}
              trackColor={{ false: "#e2e8f0", true: BRAND + "40" }}
              thumbColor={vatRegistered ? BRAND : "#f1f5f9"}
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>VAT Registration Number</Text>
            <TextInput
              value={vatNumber}
              onChangeText={setVatNumber}
              placeholder="GB123456789"
              placeholderTextColor={MUTED}
              style={styles.input}
              autoCapitalize="characters"
            />
            <Text style={styles.helpText}>
              Your VAT registration number from HMRC (starts with GB).
            </Text>
          </View>
        </View>

        {/* Address */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>Business Address</Text>
            <InfoButton
              title="Address Information"
              tips={[
                "This is your business address that appears on documents.",
                "Use your registered office address for limited companies.",
                "For sole traders, this can be your home address if you work from home.",
                "Customers will see this address on invoices and quotes.",
              ]}
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Address Line 1</Text>
            <TextInput
              value={addressLine1}
              onChangeText={setAddressLine1}
              placeholder="123 Business Street"
              placeholderTextColor={MUTED}
              style={styles.input}
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>City</Text>
            <TextInput
              value={city}
              onChangeText={setCity}
              placeholder="London"
              placeholderTextColor={MUTED}
              style={styles.input}
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Postcode</Text>
            <TextInput
              value={postcode}
              onChangeText={setPostcode}
              placeholder="SW1A 1AA"
              placeholderTextColor={MUTED}
              style={styles.input}
              autoCapitalize="characters"
            />
            <Text style={styles.helpText}>
              Your business postcode (for invoices and quotes).
            </Text>
          </View>
        </View>

        {/* Contact */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>Contact Information</Text>
            <InfoButton
              title="Contact Details"
              tips={[
                "These contact details appear on your documents.",
                "Use a professional email address for business correspondence.",
                "Phone number helps customers reach you about invoices or quotes.",
                "Keep these details up to date for good customer service.",
              ]}
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Email Address</Text>
            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder="you@company.com"
              placeholderTextColor={MUTED}
              style={styles.input}
              keyboardType="email-address"
              autoCapitalize="none"
            />
            <Text style={styles.helpText}>
              Professional email address for business correspondence.
            </Text>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Phone Number</Text>
            <TextInput
              value={phone}
              onChangeText={setPhone}
              placeholder="0123 456 7890"
              placeholderTextColor={MUTED}
              style={styles.input}
              keyboardType="phone-pad"
            />
            <Text style={styles.helpText}>
              Business phone number for customer enquiries.
            </Text>
          </View>
        </View>

        {/* Work & Rates */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>Work & Rates</Text>
            <InfoButton
              title="Work & Rates"
              tips={[
                "Set your standard working hours per day for job calculations.",
                "Hourly rate is used for labour cost calculations and quotes.",
                "Mileage rate is used for travel cost calculations (per mile).",
                "These values can be used in your quotes and invoices.",
              ]}
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Hours per Day</Text>
            <TextInput
              value={hoursPerDay}
              onChangeText={setHoursPerDay}
              placeholder="e.g. 8"
              placeholderTextColor={MUTED}
              style={styles.input}
              keyboardType="numeric"
            />
            <Text style={styles.helpText}>
              Typical number of hours you work per day.
            </Text>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Hourly Rate (£)</Text>
            <TextInput
              value={hourlyRate}
              onChangeText={setHourlyRate}
              placeholder="e.g. 35"
              placeholderTextColor={MUTED}
              style={styles.input}
              keyboardType="numeric"
            />
            <Text style={styles.helpText}>
              Your standard labour charge per hour (before VAT).
            </Text>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Mileage Rate (£ per mile)</Text>
            <TextInput
              value={travelRatePerMile}
              onChangeText={setTravelRatePerMile}
              placeholder="e.g. 0.45"
              placeholderTextColor={MUTED}
              style={styles.input}
              keyboardType="numeric"
            />
            <Text style={styles.helpText}>
              Your charge per mile for travel (used in quotes/invoices).
            </Text>
          </View>
        </View>

        <View style={styles.footerNote}>
          <Text style={styles.footerText}>
            Company details are used across all documents and communications. Keep them accurate and up to date for professional appearance and legal compliance.
          </Text>
        </View>

        <View style={{ height: 20 }} />
      </ScrollView>
    </View>
  );
}

/* ---------- STYLES ---------- */
const styles = StyleSheet.create({
  screen: { 
    flex: 1, 
    backgroundColor: BG 
  },
  
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
  
  saveBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: BRAND,
    minWidth: 60,
    alignItems: "center",
  },
  
  saveTxt: { 
    color: "#fff", 
    fontWeight: "900",
    fontSize: 14,
  },
  
  content: {
    flex: 1,
  },
  
  contentContainer: {
    padding: 16,
  },

  card: {
    backgroundColor: CARD,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 16,
    marginBottom: 16,
    ...Platform.select({
      ios: { 
        shadowColor: "#0b1220", 
        shadowOpacity: 0.06, 
        shadowRadius: 8, 
        shadowOffset: { width: 0, height: 4 } 
      },
      android: { elevation: 3 },
    }),
  },
  
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  
  cardTitle: { 
    color: TEXT, 
    fontWeight: "900", 
    fontSize: 16 
  },

  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  
  toggleLabel: {
    fontSize: 14,
    fontWeight: "700",
    color: TEXT,
    flex: 1,
  },

  inputGroup: {
    marginBottom: 16,
  },

  inputLabel: { 
    color: TEXT, 
    fontWeight: "700", 
    marginBottom: 6,
    fontSize: 14,
  },

  input: {
    backgroundColor: CARD,
    color: TEXT,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: BORDER,
    fontSize: 14,
  },

  helpText: { 
    color: MUTED, 
    fontSize: 12, 
    marginTop: 6,
    lineHeight: 16,
  },

  footerNote: {
    backgroundColor: "#f8fafc",
    borderRadius: 12,
    padding: 12,
    marginTop: 8,
  },

  footerText: { 
    color: MUTED, 
    fontSize: 12, 
    textAlign: "center",
    lineHeight: 16,
  },

  infoBtn: {
    width: 26,
    height: 26,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f8fafc",
  },

  /* Modal */
  modalBackdrop: {
    position: "absolute",
    inset: 0,
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  modalWrap: { 
    flex: 1, 
    justifyContent: "center", 
    alignItems: "center", 
    padding: 16,
  },
  modalCard: {
    backgroundColor: CARD,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: BORDER,
    width: "92%",
    maxWidth: 480,
    ...Platform.select({
      ios: { 
        shadowColor: "#000", 
        shadowOpacity: 0.15, 
        shadowRadius: 16, 
        shadowOffset: { width: 0, height: 6 } 
      },
      android: { elevation: 10 },
    }),
  },
  modalHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  smallBtn: { 
    paddingVertical: 6, 
    paddingHorizontal: 12, 
    borderRadius: 8, 
    backgroundColor: "#f3f4f6" 
  },
  smallBtnText: { 
    color: TEXT, 
    fontWeight: "700", 
    fontSize: 12 
  },
});