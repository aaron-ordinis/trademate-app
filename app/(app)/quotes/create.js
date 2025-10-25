// 3-step wizard (Step 2 = Template chooser & preview) – using global TemplatePicker

import React, { useEffect, useState, useCallback, useMemo } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Alert,
  Dimensions,
  Platform,
  StatusBar,
  StyleSheet,
  Keyboard,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { Feather } from "@expo/vector-icons";
import * as NavigationBar from "expo-navigation-bar";
import * as SystemUI from "expo-system-ui";

import { supabase } from "../../../lib/supabase";
import { loginHref, quotesListHref } from "../../../lib/nav";
import { getPremiumStatus } from "../../../lib/premium";

import Step1ClientLocation from "./components/Step1ClientLocation";
import Step3JobDetails from "./components/Step3JobDetails";
import AddressEditor from "./components/AddressEditor";
import CenteredEditor from "./components/CenteredEditor";
import FancyBuilderLoader from "./components/FancyBuilderLoader";
import { BRAND, CARD, BORDER, BG, TEXT, MUTED, styles as baseStyles } from "./components/ui";

// NEW: app-wide template picker
import TemplatePicker from "../../../components/TemplatePicker";

/* ------------------ small utils ------------------ */
const MAX_JOB_DETAILS = 250;
const COUNTER_AMBER_AT = 200;

const num = (v, d = 0) => {
  const n = Number(String(v).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : d;
};
const isBlank = (s) => !String(s || "").trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function tryJson(url, opts = {}, tries = 2) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, opts);
      return await res.json();
    } catch (e) {
      lastErr = e;
      await sleep(150 + i * 200);
    }
  }
  throw lastErr;
}
async function probeUrl(url) {
  const bust = "cb=" + Date.now() + "&r=" + Math.random().toString(36).slice(2);
  const u = url && url.indexOf("?") >= 0 ? url + "&" + bust : url + "?" + bust;
  try {
    let res = await fetch(u, { method: "HEAD" });
    if (res.ok || res.status === 206 || res.status === 304) return true;
    res = await fetch(u, { method: "GET", headers: { Range: "bytes=0-1" } });
    if (res.status === 200 || res.status === 206 || res.status === 304) return true;
    res = await fetch(u, { method: "GET" });
    return res.ok;
  } catch { return false; }
}
async function pollSignedUrlReady(
  path,
  { tries = 60, baseDelay = 300, step = 300, maxDelay = 1200, signedUrlTtl = 60 * 60 * 24 * 7 } = {}
) {
  if (!path) return null;
  const storage = supabase.storage.from("quotes");
  for (let i = 0; i < tries; i++) {
    const { data } = await storage.createSignedUrl(path, signedUrlTtl);
    const url = data?.signedUrl;
    if (url && (await probeUrl(url))) return url;
    await sleep(Math.min(baseDelay + i * step, maxDelay));
  }
  return null;
}
function parseStorageUrl(url) {
  if (!url) return null;
  const m = url.match(/\/storage\/v1\/object\/(sign|public)\/([^/]+)\/(.+?)(?:\?|$)/);
  return m ? { bucket: m[2], path: decodeURIComponent(m[3]) } : null;
}
const haversineMiles = (lat1, lon1, lat2, lon2) => {
  const toRad = (x) => (x * Math.PI) / 180;
  const R_km = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = ((lon1 - lon2) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R_km * c * 0.621371;
};

/* ------------------ TEMPLATE HELPERS ------------------ */
// Always persist/send the full template code with ".html"
const normalizeTemplateCode = (code) => {
  if (!code) return "clean-classic.html";
  let c = String(code).trim();
  c = c.replace(/\s+/g, "");
  if (!/\.html$/i.test(c)) c += ".html";
  c = c.replace(/[^A-Za-z0-9._-]/g, "");
  return c.toLowerCase();
};

/* ------------------ screen ------------------ */
const TOTAL_STEPS = 3;
const STEP_TITLES = ["Client & Location", "Choose Template", "Job Details"];

export default function CreateQuote() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams();

  // Force white chrome
  useEffect(() => {
    const forceWhite = async () => {
      try {
        StatusBar.setBarStyle("dark-content", false);
        if (Platform.OS === "android") {
          StatusBar.setBackgroundColor("#ffffff", false);
          await NavigationBar.setBackgroundColorAsync("#ffffff");
          await NavigationBar.setButtonStyleAsync("dark");
          if (NavigationBar.setBorderColorAsync) await NavigationBar.setBorderColorAsync("#ffffff");
        }
        await SystemUI.setBackgroundColorAsync("#ffffff");
      } catch (err) { console.log("Force white error:", err); }
    };
    forceWhite();
  }, []);

  // Steps
  const [step, setStep] = useState(1);
  const next = () => setStep((s) => { const n = Math.min(s + 1, TOTAL_STEPS); if (n !== s) Haptics.selectionAsync(); return n; });
  const back = () => setStep((s) => { const n = Math.max(s - 1, 1); if (n !== s) Haptics.selectionAsync(); return n; });

  // Form state (lifted)
  const [clientName, setClientName] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [clientAddress, setClientAddress] = useState("");
  const [siteAddress, setSiteAddress] = useState("");
  const [sameAsBilling, setSameAsBilling] = useState(false);

  const [jobSummary, setJobSummary] = useState("");
  const [jobDetails, _setJobDetails] = useState("");
  const setJobDetails = (t) => _setJobDetails((t || "").slice(0, MAX_JOB_DETAILS));
  const jobLen = jobDetails.length;
  const remaining = Math.max(0, MAX_JOB_DETAILS - jobLen);

  // Template (single source of truth)
  const [templateCode, setTemplateCode] = useState("clean-classic");

  // Validation
  const [fieldErrors, setFieldErrors] = useState({});

  // Address modals
  const [billingOpen, setBillingOpen] = useState(false);
  const [siteOpen, setSiteOpen] = useState(false);

  useEffect(() => { if (sameAsBilling) setSiteAddress(clientAddress); }, [sameAsBilling, clientAddress]);

  // Profile / pricing
  const [profile, setProfile] = useState(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [premiumStatus, setPremiumStatus] = useState({ isPremium: false, status: "no_profile" });
  const isPremium = premiumStatus.isPremium;

  const [distanceMiles, setDistanceMiles] = useState("");
  const [travelCharge, setTravelCharge] = useState(0);
  const [autoDistLoading, setAutoDistLoading] = useState(false);

  const [existing, setExisting] = useState(null);
  const [saving, setSaving] = useState(false);
  const [genLoading, setGenLoading] = useState(false);

  const [loaderMsg, setLoaderMsg] = useState("Preparing data…");
  const [loaderPct, setLoaderPct] = useState(0.1);

  const isFinalized = useMemo(() => !!existing && String(existing.status || "").toLowerCase() !== "draft", [existing]);

  /* profile */
  const loadProfile = useCallback(async () => {
    setProfileLoading(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const user = userData?.user;
      if (!user) { router.replace(loginHref); return null; }
      const { data, error } = await supabase
        .from("profiles")
        .select("id, business_name, trade_type, hourly_rate, materials_markup_pct, vat_registered, payment_terms, warranty_text, travel_rate_per_mile, custom_logo_url, address_line1, city, postcode, hours_per_day, trial_ends_at, plan_tier, plan_status, invoice_tax_rate")
        .eq("id", user.id)
        .maybeSingle();
      if (error) throw error;
      setProfile(data);
      setPremiumStatus(getPremiumStatus(data));
      return data;
    } finally {
      setProfileLoading(false);
    }
  }, [router]);
  useEffect(() => { loadProfile(); }, [loadProfile]);

  const getProfileOrThrow = useCallback(async () => {
    if (profile) return profile;
    if (profileLoading) {
      let tries = 12;
      while (tries-- > 0 && profileLoading && !profile) await sleep(150);
      if (profile) return profile;
    }
    const fresh = await loadProfile();
    if (fresh) return fresh;
    throw new Error("Profile not loaded. Try again.");
  }, [profile, profileLoading, loadProfile]);

  /* existing prefill */
  const paramsQuoteId = params?.quoteId ? String(params.quoteId) : null;
  useEffect(() => {
    (async () => {
      if (!paramsQuoteId) return;
      const { data } = await supabase.from("quotes").select("").eq("id", paramsQuoteId).maybeSingle();
      if (data) {
        setExisting(data);
        setClientName(data.client_name || "");
        setClientEmail(data.client_email || "");
        setClientPhone(data.client_phone || "");
        setClientAddress(data.client_address || "");
        setSiteAddress(data.site_address || "");
        setJobSummary(data.job_summary || "");
        if (data.template_code) setTemplateCode(String(data.template_code));
        try {
          const blob = typeof data.job_details === "string" ? JSON.parse(data.job_details) : data.job_details || {};
          if (blob?.travel?.distance_miles != null) setDistanceMiles(String(blob.travel.distance_miles));
          if (blob?.details != null) _setJobDetails(String(blob.details).slice(0, MAX_JOB_DETAILS));
        } catch {}
      }
    })();
  }, [paramsQuoteId]);

  /* travel charge */
  useEffect(() => {
    const oneWay = num(distanceMiles, 0);
    const rate = num(profile?.travel_rate_per_mile, 0);
    setTravelCharge(Math.round(oneWay * 2 * rate * 100) / 100);
  }, [distanceMiles, profile]);

  /* google helpers */
  const GOOGLE = process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY || globalThis?.expo?.env?.EXPO_PUBLIC_GOOGLE_MAPS_KEY;
  const buildBusinessAddress = (p) => [p?.address_line1, p?.city, p?.postcode].filter(Boolean).join(", ").trim();

  const geocodeAddress = async (address) => {
    if (!GOOGLE) return null;
    const clean = String(address || "").replace(/\s*\n+\s*/g, ", ");
    const url = "https://maps.googleapis.com/maps/api/geocode/json?address=" + encodeURIComponent(clean) + "&language=en&region=GB&key=" + GOOGLE;
    try {
      const j = await tryJson(url, {}, 2);
      if (String(j?.status || "OK") !== "OK") return null;
      const loc = j?.results?.[0]?.geometry?.location;
      return loc ? { lat: loc.lat, lng: loc.lng } : null;
    } catch { return null; }
  };
  const getDrivingDistanceMiles = async (origLat, origLng, destLat, destLng) => {
    if (!GOOGLE) return null;
    const url = "https://maps.googleapis.com/maps/api/distancematrix/json?origins=" + origLat + "," + origLng + "&destinations=" + destLat + "," + destLng + "&units=imperial&language=en&region=GB&key=" + GOOGLE;
    try {
      const j = await tryJson(url, {}, 2);
      const meters = j?.rows?.[0]?.elements?.[0]?.distance?.value;
      if (!meters && meters !== 0) return null;
      return meters * 0.000621371;
    } catch { return null; }
  };
  const autoCalcDistance = useCallback(async () => {
    try {
      const prof = await getProfileOrThrow();
      const addr = (sameAsBilling ? clientAddress : siteAddress) || "";
      if (!addr.trim()) return;
      const originText = buildBusinessAddress(prof);
      if (!originText) return;
      setAutoDistLoading(true);
      const origin = await geocodeAddress(originText);
      const dest = await geocodeAddress(addr.trim());
      if (!origin || !dest) return;
      let miles = await getDrivingDistanceMiles(origin.lat, origin.lng, dest.lat, dest.lng);
      if (!miles) miles = haversineMiles(origin.lat, origin.lng, dest.lat, dest.lng);
      const rounded = Math.round(Number(miles) * 100) / 100;
      if (Number.isFinite(rounded)) setDistanceMiles(String(rounded));
    } finally { setAutoDistLoading(false); }
  }, [clientAddress, siteAddress, sameAsBilling, getProfileOrThrow]);
  useEffect(() => {
    if (!(siteAddress || (sameAsBilling && clientAddress))) return;
    const t = setTimeout(() => { autoCalcDistance(); }, 400);
    return () => clearTimeout(t);
  }, [siteAddress, clientAddress, sameAsBilling, autoCalcDistance]);

  /* alerts */
  const showAlert = (title, message) => { Haptics.selectionAsync(); Alert.alert(title, message); };

  /* save draft */
  const saveDraftOnly = async () => {
    try {
      if (isFinalized) { showAlert("Locked", "This quote has already been generated."); return; }
      setSaving(true);
      const prof = await getProfileOrThrow();
      const { data: userData } = await supabase.auth.getUser();
      const user = userData?.user;
      if (!user) throw new Error("Not signed in");

      const blob = {
        summary: jobSummary || "",
        details: jobDetails || "",
        travel: {
          distance_miles: num(distanceMiles, 0),
          round_trip_miles: num(distanceMiles, 0) * 2,
          rate_per_mile: num(prof?.travel_rate_per_mile, 0),
          travel_charge: travelCharge,
        },
      };

      const tplCode = normalizeTemplateCode(templateCode);

      if (existing) {
        const { error: upErr } = await supabase
          .from("quotes")
          .update({
            status: "draft",
            client_name: clientName || "Client",
            client_email: clientEmail || null,
            client_phone: clientPhone || null,
            client_address: clientAddress || null,
            site_address: sameAsBilling ? clientAddress : siteAddress || null,
            job_summary: jobSummary || "New job",
            job_details: JSON.stringify(blob, null, 2),
            line_items: null,
            totals: null,
            subtotal: travelCharge || null,
            vat_amount: null,
            total: travelCharge || null,
            template_code: tplCode,
          })
          .eq("id", existing.id);
        if (upErr) throw upErr;
        showAlert("Saved", "Draft updated.");
        router.replace(quotesListHref);
        return;
      }

      const draftRow = {
        user_id: user.id,
        quote_number: null,
        status: "draft",
        client_name: clientName || "Client",
        client_email: clientEmail || null,
        client_phone: clientPhone || null,
        client_address: clientAddress || null,
        site_address: sameAsBilling ? clientAddress : siteAddress || null,
        job_summary: jobSummary || "New job",
        job_details: JSON.stringify(blob, null, 2),
        line_items: null,
        totals: null,
        subtotal: travelCharge || null,
        vat_amount: null,
        total: travelCharge || null,
        template_code: tplCode,
      };
      const { error: insErr } = await supabase.from("quotes").insert(draftRow);
      if (insErr) throw insErr;
      showAlert("Saved", "Draft created.");
      router.replace(quotesListHref);
    } catch (e) {
      showAlert("Error", e.message || "Could not create draft.");
    } finally {
      setSaving(false);
    }
  };

  /* generate */
  const bump = (msg, pct) => { setLoaderMsg(msg); setLoaderPct(pct); };

  const parseStorageFromUrl = (url) => {
    if (!url) return null;
    const m = String(url).match(/\/storage\/v1\/object\/(sign|public)\/([^/]+)\/(.+?)(?:\?|$)/);
    return m ? { bucket: m[2], path: decodeURIComponent(m[3]) } : null;
  };

  const generateAIAndPDF = async () => {
    let triedFreshQuoteNumber = false;
    try {
      if (isFinalized) { showAlert("Locked", "Already generated."); return; }
      if (isBlank(jobSummary) || isBlank(jobDetails)) {
        showAlert("Add job info", "Summary + details required.");
        return;
      }
      Keyboard.dismiss();
      setGenLoading(true);

      bump("Preparing data…", 0.12); await sleep(300);

      const prof = await getProfileOrThrow();
      const { data: userData } = await supabase.auth.getUser();
      const user = userData?.user;
      if (!user) throw new Error("Not signed in");

      bump("Calculating travel costs…", 0.22); await sleep(200);
      if (!distanceMiles) await autoCalcDistance();

      const tplCode = normalizeTemplateCode(templateCode);

      let quotePayload = {
        is_estimate: true,
        client_name: clientName || "Client",
        client_address: clientAddress || null,
        site_address: sameAsBilling ? clientAddress : siteAddress || null,
        job_summary: jobSummary || "New job",
        totals: { vat_rate: (prof?.vat_registered ? num(prof?.invoice_tax_rate, 20) / 100 : 0) },
        meta: {
          travel: {
            distance_miles: num(distanceMiles, 0),
            round_trip_miles: num(distanceMiles, 0) * 2,
            travel_charge: num(travelCharge, 0),
          },
        },
        template_code: tplCode,
      };
      if (existing?.quote_number) quotePayload.quote_number = existing.quote_number;

      let pdfPayload = {
        user_id: user.id,
        web_search: true,
        templateCode: tplCode,
        branding: {
          tier: isPremium ? "premium" : "free",
          business_name: prof?.business_name || "Trade Business",
          custom_logo_url: prof?.custom_logo_url || null,
          powered_by_footer: !isPremium,
          address_line1: prof?.address_line1 || "",
          city: prof?.city || "",
          postcode: prof?.postcode || "",
        },
        description: (jobSummary + ". " + jobDetails).trim(),
        profile: {
          business_name: prof?.business_name || "",
          trade_type: prof?.trade_type || "",
          hourly_rate: num(prof?.hourly_rate, 0),
          materials_markup_pct: num(prof?.materials_markup_pct, 0),
          vat_registered: !!prof?.vat_registered,
          invoice_tax_rate: num(prof?.invoice_tax_rate, 20),
          payment_terms: prof?.payment_terms || "",
          warranty_text: prof?.warranty_text || "",
          travel_rate_per_mile: num(prof?.travel_rate_per_mile, 0),
          hours_per_day: num(prof?.hours_per_day, 8),
          city: prof?.city || "",
          postcode: prof?.postcode || "",
          currency: "GBP",
        },
        quote: quotePayload,
      };

      let resp, pdfData, pdfErr;
      let duplicateKeyError = false;
      do {
        bump("AI researching and building your quote…", 0.4);
        resp = await supabase.functions.invoke("pdf-builder", { body: pdfPayload });
        pdfData = resp?.data || {};
        pdfErr = resp?.error || null;
        duplicateKeyError = pdfErr && String(pdfErr.message || pdfErr).includes("duplicate key value violates unique constraint");
        if (duplicateKeyError && !triedFreshQuoteNumber) {
          const { data: nextNo, error: nErr } = await supabase.rpc("next_quote_number", { p_user_id: user.id });
          if (nErr) throw nErr;
          pdfPayload.quote.quote_number = nextNo;
          triedFreshQuoteNumber = true;
          continue;
        }
        break;
      } while (duplicateKeyError && !triedFreshQuoteNumber);

      const isResearchFailure = (err) => {
        const s = String(err || "").toLowerCase();
        return (
          s.includes("insufficient_quota") ||
          s.includes("web_search") ||
          s.includes("research") ||
          s.includes("responses api") ||
          s.includes("o4-mini") ||
          s.includes("429") ||
          (s.includes("could not fetch") && s.includes("search"))
        );
      };

      let signedUrl = pdfData?.signedUrl || pdfData?.signed_url || null;
      let storagePath = pdfData?.path || pdfData?.key || pdfData?.objectPath || null;
      let bucket = "quotes";
      const parsed = storagePath
        ? { bucket, path: storagePath }
        : (pdfData?.publicUrl || signedUrl ? parseStorageFromUrl(pdfData.publicUrl || signedUrl) : null);
      if (parsed) { bucket = parsed.bucket || "quotes"; storagePath = parsed.path; }

      let effectiveQuoteId = pdfData?.quote_id || pdfData?.quoteId || existing?.id || null;
      let previewUrl = null;

      if (storagePath) {
        const { data: pub } = supabase.storage.from(bucket).getPublicUrl(storagePath);
        const pubUrl = pub?.publicUrl || null;
        if (pubUrl && await probeUrl(pubUrl)) previewUrl = pubUrl;
      }
      if (!previewUrl && storagePath) {
        bump("Finalizing…", 0.86);
        signedUrl = await pollSignedUrlReady(storagePath, { tries: 20, baseDelay: 250, step: 250, maxDelay: 900 });
        if (signedUrl) previewUrl = signedUrl;
      }
      if (!previewUrl) {
        bump("Finalizing…", 0.9);
        if (!effectiveQuoteId && pdfData?.quote_number) {
          const { data: qRow } = await supabase
            .from("quotes")
            .select("id, pdf_url")
            .eq("user_id", user.id)
            .eq("quote_number", pdfData.quote_number)
            .maybeSingle();
          if (qRow?.id) effectiveQuoteId = qRow.id;
          if (qRow?.pdf_url && await probeUrl(qRow.pdf_url)) previewUrl = qRow?.pdf_url;
        }
        if (!previewUrl && effectiveQuoteId) {
          const { data: q1 } = await supabase
            .from("quotes")
            .select("pdf_url")
            .eq("id", effectiveQuoteId)
            .maybeSingle();
          if (q1?.pdf_url && await probeUrl(q1.pdf_url)) previewUrl = q1?.pdf_url;
        }
      }
      if (!previewUrl && storagePath) {
        bump("Wrapping up…", 0.95);
        const extraSigned = await pollSignedUrlReady(storagePath, { tries: 16, baseDelay: 300, step: 300, maxDelay: 1000 });
        if (extraSigned) previewUrl = extraSigned;
      }

      if (!previewUrl) {
        if (pdfErr && isResearchFailure(pdfErr.message || pdfErr)) {
          showAlert("Please be more specific", "I need a bit more detail to research this job.\n\nTip: mention the room, quantities/sizes, materials or finishes, access limits, and anything unusual.");
          return;
        }
        showAlert("Almost ready", "The quote has been generated, but the file link isn’t ready yet. Please try again in a few seconds.");
        return;
      }

      if (!effectiveQuoteId && storagePath) {
        const { data: matchRow } = await supabase
          .from("quotes")
          .select("id")
          .ilike("pdf_url", "%" + storagePath)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (matchRow?.id) effectiveQuoteId = matchRow.id;
      }

      const fileName =
        (pdfData?.quote_number
          ? ("QUO-" + (new Date().getFullYear()) + "-" + String(pdfData.quote_number).padStart(4, "0"))
          : "quote") + ".pdf";

      router.replace({
        pathname: "/(app)/quotes/preview",
        params: {
          url: encodeURIComponent(previewUrl),
          name: fileName,
          id: effectiveQuoteId ? String(effectiveQuoteId) : ""
        }
      });
    } catch (e) {
      console.log("[create] error:", e?.message || e);
      if (String(e?.message || e).includes("duplicate key value violates unique constraint")) {
        showAlert("Quote Error", "This quote number is already in use. Please try again.");
      } else {
        showAlert("Error", e.message || "Generation failed. Please check function logs.");
      }
    } finally {
      setGenLoading(false);
      setTimeout(() => { setLoaderMsg("Preparing data…"); setLoaderPct(0.1); }, 400);
    }
  };

  /* validation */
  const validateStep1 = () => {
    const e = {};
    if (!clientName.trim()) e.clientName = "Client name is required";
    if (!clientAddress.trim()) e.clientAddress = "Billing address is required";
    if (!sameAsBilling && !siteAddress.trim()) e.siteAddress = "Site address is required";
    return e;
  };
  const validateStep3 = () => {
    const e = {};
    if (!jobSummary.trim()) e.jobSummary = "Job title is required";
    if (!jobDetails.trim()) e.jobDetails = "Job description is required";
    return e;
  };
  const getCurrentStepErrors = () => (step === 1 ? validateStep1() : step === 3 ? validateStep3() : {});
  const goNext = () => {
    const errors = getCurrentStepErrors();
    if (Object.keys(errors).length) { setFieldErrors(errors); return; }
    setFieldErrors({});
    next();
  };

  // ---------- UI sizing ----------
  const { width, height } = Dimensions.get("window");

  return (
    <View style={{ flex: 1, backgroundColor: BG }}>
      <StatusBar barStyle="dark-content" backgroundColor="#ffffff" translucent={false} />
      <View style={{ height: insets.top, backgroundColor: CARD }} />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => { if (step > 1) back(); else router.back(); }}>
          <Feather name="arrow-left" size={20} color={TEXT} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>
          {existing ? (isFinalized ? "View Quote" : "Edit Quote") : "Create Quote"}
        </Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Content */}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 100 }}>
        {/* Step progress */}
        <View style={styles.stepProgress}>
          <View style={styles.stepRow}>
            <Text style={styles.stepTitle}>{STEP_TITLES[step - 1]}</Text>
            <Text style={styles.stepCounter}>Step {step} of {TOTAL_STEPS}</Text>
          </View>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: String((step / TOTAL_STEPS) * 100) + "%" }]} />
          </View>
        </View>

        {step === 1 && (
          <Step1ClientLocation
            clientName={clientName} setClientName={setClientName}
            clientEmail={clientEmail} setClientEmail={setClientEmail}
            clientPhone={clientPhone} setClientPhone={setClientPhone}
            clientAddress={clientAddress} setClientAddress={setClientAddress}
            siteAddress={siteAddress} setSiteAddress={setSiteAddress}
            sameAsBilling={sameAsBilling} setSameAsBilling={setSameAsBilling}
            setBillingOpen={setBillingOpen} setSiteOpen={setSiteOpen}
          />
        )}

        {step === 2 && (
          <TemplatePicker
            kind="quote"
            selected={templateCode}
            onSelect={setTemplateCode}
          />
        )}

        {step === 3 && (
          <Step3JobDetails
            jobSummary={jobSummary} setJobSummary={setJobSummary}
            jobDetails={jobDetails} setJobDetails={setJobDetails}
            remaining={remaining} jobLen={jobLen}
          />
        )}
      </ScrollView>

      {/* Action bar */}
      <View style={styles.actionBar}>
        {step < TOTAL_STEPS ? (
          <TouchableOpacity onPress={goNext} style={[styles.actionBtn, styles.primaryActionBtn]}>
            <Text style={[styles.actionBtnText, { color: "#fff" }]}>
              {step === 1 ? "Next: Choose Template" : "Next: Job Details"}
            </Text>
          </TouchableOpacity>
        ) : (
          <View style={{ flexDirection: "row", gap: 12 }}>
            <TouchableOpacity
              onPress={saveDraftOnly}
              style={[styles.actionBtn, { flex: 1, borderWidth: 1, borderColor: BORDER, backgroundColor: "#f8fafc" }]}
            >
              <Text style={styles.actionBtnText}>{saving ? "Saving…" : "Save Draft"}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={generateAIAndPDF} style={[styles.actionBtn, styles.primaryActionBtn, { flex: 1 }]}>
              <Text style={[styles.actionBtnText, { color: "#fff" }]}>{genLoading ? "Creating…" : "Create Quote"}</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* Address modals */}
      <CenteredEditor visible={billingOpen} onClose={() => setBillingOpen(false)}>
        <AddressEditor
          title="Billing address"
          GOOGLE={GOOGLE}
          initialText={clientAddress}
          onUse={(addr) => { setClientAddress(addr); if (sameAsBilling) setSiteAddress(addr); }}
          onClose={() => setBillingOpen(false)}
        />
      </CenteredEditor>

      <CenteredEditor visible={siteOpen} onClose={() => setSiteOpen(false)}>
        <AddressEditor
          title="Site address"
          GOOGLE={GOOGLE}
          initialText={siteAddress || clientAddress}
          onUse={(addr) => setSiteAddress(addr)}
          onClose={() => setSiteOpen(false)}
        />
      </CenteredEditor>

      <FancyBuilderLoader visible={genLoading} message={loaderMsg} progress={loaderPct} />
    </View>
  );
}

const styles = StyleSheet.create({
  ...baseStyles,
});