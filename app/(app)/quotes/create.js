// app/(app)/quotes/create.js
// 3-step wizard modal — matches invoices/wizard: inner RN Modal + BlurView

import React, { useEffect, useState, useCallback, useMemo, useRef } from "react";
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, ActivityIndicator,
  Platform, StatusBar, Pressable, Dimensions, PlatformColor, Alert, StyleSheet, Modal, Animated, Easing
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { supabase } from "../../../lib/supabase";
import * as Haptics from "expo-haptics";
import { BlurView } from "expo-blur";
import * as NavigationBar from "expo-navigation-bar";
import { Feather } from "@expo/vector-icons";
import { loginHref, quotesListHref, quotePreviewHref } from "../../../lib/nav";
import { isPremiumUser, getPremiumStatus, isUserBlocked } from "../../../lib/premium";

/* -------------------------- THEME -------------------------- */
const sysBG =
  Platform.OS === "ios"
    ? PlatformColor?.("systemGray6") ?? "#EEF2F6"
    : PlatformColor?.("@android:color/system_neutral2_100") ?? "#EEF2F6";

const BG = sysBG;                // surfaces
const BG_HEX = "#EEF2F6";        // system bars
const CARD = "#ffffff";
const TEXT = "#0b1220";
const MUTED = "#6b7280";
const BRAND = "#2a86ff";
const OK = "#16a34a";
const DISABLED = "#9ca3af";
const BORDER = "#e5e7eb";
const WARN = "#b91c1c";
const AMBER = "#b45309";

/* -------------------------- LIMITS -------------------------- */
const MAX_JOB_DETAILS = 250;
const COUNTER_AMBER_AT = 200;

/* -------------------------- UTILS -------------------------- */
const num = (v, d = 0) => {
  const n = Number(String(v).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : d;
};
const isBlank = (s) => !String(s || "").trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const uuid4 = () =>
  "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });

// FORMATTER: fallback reference like QUO-2025-0007
const quoteRef = (n, createdAt) => {
  if (n == null) return "";
  const year = createdAt ? new Date(createdAt).getFullYear() : new Date().getFullYear();
  return `QUO-${year}-${String(n).padStart(4, "0")}`;
};

// Haversine (miles)
const haversineMiles = (lat1, lon1, lat2, lon2) => {
  const toRad = (x) => (x * Math.PI) / 180;
  const R_km = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = ((lon1 - lon2) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R_km * c * 0.621371;
};

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
  } catch {
    return false;
  }
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
function buildFallbackPhases(summary, details) {
  const s = (summary || "").trim();
  const d = (details || "").trim();
  const tasks = [];
  if (d)
    d.split(/\r?\n|[.;] /).map((t) => t.trim()).filter(Boolean).slice(0, 8).forEach((t) => tasks.push(t));
  else if (s) tasks.push(s);
  if (!tasks.length) tasks.push("Attend site and complete works as described.");
  return [{ name: "Scope of Work", tasks }];
}
const tryInsertWithUniqueQuoteNumber = async (row, userId) => {
  for (let i = 0; i < 2; i++) {
    const { data, error } = await supabase.from("quotes").insert(row).select("id").single();
    if (!error) return data;
    const msg = error?.message || "";
    if (error?.code === "23505" || msg.includes("quotes_user_quoteno_uidx")) {
      const { data: fresh } = await supabase.rpc("next_quote_number", { p_user_id: userId });
      row.quote_number = fresh;
      continue;
    }
    throw error;
  }
  throw new Error("Could not allocate a unique quote number");
};
const checkDailyQuota = async (userId) => {
  try {
    const { data, error } = await supabase.rpc("can_create_quote", { p_user_id: userId });
    if (error) {
      console.warn("[TMQ][CREATE] quota RPC error:", error.message);
      return true;
    }
    return !!data;
  } catch (e) {
    console.warn("[TMQ][CREATE] quota threw:", e?.message || e);
    return true;
  }
};

/* =================== Screen =================== */
const TOTAL_STEPS = 3;
const STEP_TITLES = ["Client", "Travel", "Job"];

export default function CreateQuote() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const quoteIdParam = params?.quoteId ? String(paramsQuoteId) : null;

  // inner Modal visibility (match invoices/wizard)
  const [visible, setVisible] = useState(true);

  // Status/nav bar to light
  useEffect(() => {
    StatusBar.setBarStyle("dark-content");
    if (Platform.OS === "android") {
      StatusBar.setBackgroundColor(BG_HEX, true);
      (async () => {
        try {
          await NavigationBar.setBackgroundColorAsync("#FFFFFF"); // ✅ Ensure white
          await NavigationBar.setButtonStyleAsync("dark");
          await NavigationBar.setDividerColorAsync("transparent");
        } catch {}
      })();
    }
  }, []);

  // Steps
  const [step, setStep] = useState(1);
  const next = () => setStep((s) => { const n = Math.min(s + 1, TOTAL_STEPS); if (n !== s) Haptics.selectionAsync(); return n; });
  const back = () => setStep((s) => { const n = Math.max(s - 1, 1); if (n !== s) Haptics.selectionAsync(); return n; });

  // Form state
  const [clientName, setClientName] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [clientAddress, setClientAddress] = useState("");
  const [siteAddress, setSiteAddress] = useState("");

  const [jobSummary, setJobSummary] = useState("");
  const [jobDetails, _setJobDetails] = useState("");
  const jobLen = jobDetails.length;
  const remaining = Math.max(0, MAX_JOB_DETAILS - jobLen);
  const setJobDetails = (t) => _setJobDetails((t || "").slice(0, MAX_JOB_DETAILS));

  // Address modals
  const [billingOpen, setBillingOpen] = useState(false);
  const [siteOpen, setSiteOpen] = useState(false);

  // Profile, travel, quotas
  const [sameAsBilling, setSameAsBilling] = useState(false);
  useEffect(() => { if (sameAsBilling) setSiteAddress(clientAddress); }, [sameAsBilling, clientAddress]);

  const [profile, setProfile] = useState(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileError, setProfileError] = useState(null);
  const [premiumStatus, setPremiumStatus] = useState({ isPremium: false, status: 'no_profile' });
  const isPremium = premiumStatus.isPremium;

  const [distanceMiles, setDistanceMiles] = useState("");
  const [travelCharge, setTravelCharge] = useState(0);
  const [autoDistLoading, setAutoDistLoading] = useState(false);

  const [existing, setExisting] = useState(null);
  const [blockedToday, setBlockedToday] = useState(false);

  const [saving, setSaving] = useState(false);
  const [genLoading, setGenLoading] = useState(false);

  // 🔥 loader step text + progress
  const [loaderMsg, setLoaderMsg] = useState("Preparing data…");
  const [loaderPct, setLoaderPct] = useState(0.1);

  const isFinalized = useMemo(
    () => !!existing && String(existing.status || "").toLowerCase() !== "draft",
    [existing]
  );

  /* ---------------- load profile ---------------- */
  const loadProfile = useCallback(async () => {
    setProfileLoading(true);
    setProfileError(null);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const user = userData?.user;
      if (!user) {
        router.replace(loginHref);
        return null;
      }

      const { data, error } = await supabase
        .from("profiles")
        .select(
          "id, business_name, trade_type, hourly_rate, materials_markup_pct, vat_registered, payment_terms, warranty_text, travel_rate_per_mile, custom_logo_url, address_line1, city, postcode, hours_per_day, trial_ends_at, plan_tier, plan_status"
        )
        .eq("id", user.id)
        .maybeSingle();

      if (error) throw error;
      setProfile(data);

      const status = getPremiumStatus(data);
      setPremiumStatus(status);

      if (status.isBlocked) {
        router.replace("/(app)/trial-expired");
        return null;
      }

      setBlockedToday(!status.isPremium ? !(await checkDailyQuota(user.id)) : false);
      return data;
    } catch (e) {
      console.error("[TMQ][CREATE] loadProfile", e);
      setProfileError(e?.message || "Could not load your profile.");
      setPremiumStatus({ isPremium: false, status: 'error', isBlocked: false });
      setBlockedToday(false);
      return null;
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

  /* --------------- existing quote prefill --------------- */
  const paramsQuoteId = params?.quoteId ? String(params.quoteId) : null;
  useEffect(() => {
    (async () => {
      if (!paramsQuoteId) return;
      const { data, error } = await supabase.from("quotes").select("*").eq("id", paramsQuoteId).maybeSingle();
      if (error) { console.error("[TMQ][CREATE] existing", error); return; }
      if (data) {
        setExisting(data);
        setClientName(data.client_name || "");
        setClientEmail(data.client_email || "");
        setClientPhone(data.client_phone || "");
        setClientAddress(data.client_address || "");
        setSiteAddress(data.site_address || "");
        setJobSummary(data.job_summary || "");
        try {
          const blob = typeof data.job_details === "string" ? JSON.parse(data.job_details) : data.job_details || {};
          if (blob?.travel?.distance_miles != null) setDistanceMiles(String(blob.travel.distance_miles));
          if (blob?.details != null) _setJobDetails(String(blob.details).slice(0, MAX_JOB_DETAILS));
        } catch {}
      }
    })();
  }, [paramsQuoteId]);

  /* --------------- travel charge recompute --------------- */
  useEffect(() => {
    const oneWay = num(distanceMiles, 0);
    const rate = num(profile?.travel_rate_per_mile, 0);
    const roundTripCharge = oneWay * 2 * rate;
    setTravelCharge(Math.round(roundTripCharge * 100) / 100);
  }, [distanceMiles, profile]);

  /* --------------- Google helpers --------------- */
  const GOOGLE =
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY ||
    globalThis?.expo?.env?.EXPO_PUBLIC_GOOGLE_MAPS_KEY;
  const HAS_PLACES_KEY = !!GOOGLE;

  const geocodeAddress = async (address) => {
    if (!GOOGLE) return null;
    const clean = String(address || "").replace(/\s*\n+\s*/g, ", ");
    const url =
      "https://maps.googleapis.com/maps/api/geocode/json?address=" +
      encodeURIComponent(clean) +
      "&language=en&region=GB&key=" +
      GOOGLE;
    try {
      const j = await tryJson(url, {}, 2);
      if (String(j?.status || "OK") !== "OK") return null;
      const loc = j?.results?.[0]?.geometry?.location;
      return loc ? { lat: loc.lat, lng: loc.lng } : null;
    } catch {
      return null;
    }
  };
  const getDrivingDistanceMiles = async (origLat, origLng, destLat, destLng) => {
    if (!GOOGLE) return null;
    const url =
      "https://maps.googleapis.com/maps/api/distancematrix/json?origins=" +
      origLat +
      "," +
      origLng +
      "&destinations=" +
      destLat +
      "," +
      destLng +
      "&units=imperial&language=en&region=GB&key=" +
      GOOGLE;
    try {
      const j = await tryJson(url, {}, 2);
      const meters = j?.rows?.[0]?.elements?.[0]?.distance?.value;
      if (!meters && meters !== 0) return null;
      return meters * 0.000621371;
    } catch {
      return null;
    }
  };
  const buildBusinessAddress = (p) => [p?.address_line1, p?.city, p?.postcode].filter(Boolean).join(", ").trim();

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
    } finally {
      setAutoDistLoading(false);
    }
  }, [clientAddress, siteAddress, sameAsBilling, getProfileOrThrow]);
  useEffect(() => {
    if (!(siteAddress || (sameAsBilling && clientAddress))) return;
    const t = setTimeout(() => { autoCalcDistance(); }, 400);
    return () => clearTimeout(t);
  }, [siteAddress, clientAddress, sameAsBilling, autoCalcDistance]);

  /* ---------------- Alerts ---------------- */
  function showAlert(title, message) { Haptics.selectionAsync(); Alert.alert(title, message); }

  /* ---------------- save draft ---------------- */
  const saveDraftOnly = async () => {
    try {
      if (isFinalized) { showAlert("Locked", "This quote has already been generated."); return; }
      setSaving(true);
      const prof = await getProfileOrThrow();
      const { data: userData } = await supabase.auth.getUser();
      const user = userData?.user;
      if (!user) throw new Error("Not signed in");

      if (!existing && !isPremium) {
        const allowed = await checkDailyQuota(user.id);
        if (!allowed) { setBlockedToday(true); showAlert("Daily limit reached", "Free plan is 1 per day."); return; }
      }

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
          })
          .eq("id", existing.id);
        if (upErr) throw upErr;
        showAlert("Saved", "Draft updated.");
        setVisible(false); router.replace(quotesListHref);
        return;
      }

      const { data: nextNo, error: nErr } = await supabase.rpc("next_quote_number", { p_user_id: user.id });
      if (nErr) throw nErr;

      const draftRow = {
        user_id: user.id,
        quote_number: nextNo,
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
      };
      await tryInsertWithUniqueQuoteNumber(draftRow, user.id);
      showAlert("Saved", "Draft created.");
      setVisible(false); router.replace(quotesListHref);
    } catch (e) {
      console.error("[TMQ][CREATE] saveDraft", e);
      showAlert("Error", e.message || "Could not create draft.");
    } finally { setSaving(false); }
  };

  /* --------------- AI -> PDF flow (merged) + step loader --------------- */
  const bump = (msg, pct) => { setLoaderMsg(msg); setLoaderPct(pct); };

  const generateAIAndPDF = async () => {
    try {
      if (isFinalized) { showAlert("Locked", "Already generated."); return; }
      if (isBlank(jobSummary) || isBlank(jobDetails)) { showAlert("Add job info", "Summary + details required."); return; }
      setGenLoading(true);

      bump("Preparing data…", 0.12);

      const prof = await getProfileOrThrow();

      const { data: userData } = await supabase.auth.getUser();
      const user = userData?.user;
      if (!user) throw new Error("Not signed in");

      if (!existing && !isPremium) {
        const allowed = await checkDailyQuota(user.id);
        if (!allowed) { setBlockedToday(true); showAlert("Daily limit reached", "Free plan is 1 per day."); return; }
      }

      bump("Estimating travel…", 0.22);
      if (!distanceMiles) await autoCalcDistance();

      let quoteNumber = existing?.quote_number;
      if (!quoteNumber) {
        const { data: nextNo, error: nErr } = await supabase.rpc("next_quote_number", { p_user_id: user.id });
        if (nErr) throw nErr;
        quoteNumber = nextNo;
      }

      const pdfPayload = {
        user_id: user.id,
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
          currency: "GBP"
        },
        quote: {
          is_estimate: true,
          quote_number: quoteNumber,
          client_name: clientName || "Client",
          client_address: clientAddress || null,
          site_address: sameAsBilling ? clientAddress : siteAddress || null,
          job_summary: jobSummary || "New job",
          totals: {
            vat_rate: (prof?.vat_registered ? num(prof?.invoice_tax_rate, 20) / 100 : 0)
          },
          meta: {
            travel: {
              distance_miles: num(distanceMiles, 0),
              round_trip_miles: num(distanceMiles, 0) * 2,
              travel_charge: num(travelCharge, 0)
            }
          }
        }
      };

      bump("Generating items & costs…", 0.48);
      const { data: pdfData, error: pdfErr } = await supabase.functions.invoke("pdf-builder", { body: pdfPayload });
      if (pdfErr) throw new Error(pdfErr.message || "pdf-builder failed");

      bump("Rendering PDF…", 0.7);

      let signedUrl = pdfData?.signedUrl || pdfData?.signed_url || null;
      let storagePath = pdfData?.path || pdfData?.key || pdfData?.objectPath || null;
      let bucket = "quotes";

      const parsed = storagePath ? { bucket, path: storagePath } : (pdfData?.publicUrl || signedUrl ? parseStorageUrl(pdfData.publicUrl || signedUrl) : null);
      if (parsed) { bucket = parsed.bucket || "quotes"; storagePath = parsed.path; }

      let publicUrl = null;
      if (storagePath) {
        const { data: pub } = supabase.storage.from(bucket).getPublicUrl(storagePath);
        publicUrl = pub?.publicUrl || null;
      }

      bump("Finalising links…", 0.82);
      if (!signedUrl && storagePath) {
        signedUrl = await pollSignedUrlReady(storagePath, { tries: 120, baseDelay: 500, step: 500, maxDelay: 2000 });
      }
      const pdfUrlForRow = publicUrl || signedUrl || null;

      const totals = pdfData?.totals || { subtotal: null, vat_amount: null, total: null, vat_rate: null };
      const persistedItems = Array.isArray(pdfData?.quote?.lines) ? pdfData.quote.lines : null;

      bump("Saving to account…", 0.9);
      let finalQuoteId = existing?.id || null;

      if (existing) {
        const { error: upErr } = await supabase.from("quotes").update({
          status: "generated",
          client_name: clientName || "Client",
          client_email: clientEmail || null,
          client_phone: clientPhone || null,
          client_address: clientAddress || null,
          site_address: sameAsBilling ? clientAddress : siteAddress || null,
          job_summary: jobSummary || "New job",
          job_details: JSON.stringify({ summary: jobSummary, details: jobDetails }, null, 2),
          line_items: persistedItems,
          totals: totals,
          subtotal: totals.subtotal,
          vat_amount: totals.vat_amount,
          total: totals.total,
          pdf_url: pdfUrlForRow,
        }).eq("id", existing.id);
        if (upErr) throw upErr;
        finalQuoteId = existing.id;
      } else {
        const { data: inserted, error: insErr } = await supabase.from("quotes").insert({
          user_id: user.id,
          quote_number: quoteNumber,
          status: "generated",
          client_name: clientName || "Client",
          client_email: clientEmail || null,
          client_phone: clientPhone || null,
          client_address: clientAddress || null,
          site_address: sameAsBilling ? clientAddress : siteAddress || null,
          job_summary: jobSummary || "New job",
          job_details: JSON.stringify({ summary: jobSummary, details: jobDetails }, null, 2),
          line_items: persistedItems,
          totals: totals,
          subtotal: totals.subtotal,
          vat_amount: totals.vat_amount,
          total: totals.total,
          pdf_url: pdfUrlForRow,
        }).select("id").single();
        if (insErr) throw insErr;
        finalQuoteId = inserted?.id || null;
      }

      bump("Opening preview…", 1);
      const refForName =
        existing?.reference ||
        quoteRef(quoteNumber, existing?.created_at);

      const previewUrl = signedUrl || publicUrl;
      if (previewUrl && finalQuoteId) {
        setVisible(false);
        router.replace(quotePreviewHref(finalQuoteId, (refForName || quoteNumber) + ".pdf"));
      } else {
        showAlert("Quote saved", "Your quote has been saved.");
        setVisible(false); router.replace(quotesListHref);
      }
    } catch (e) {
      console.error("[TMQ][CREATE] generateAIAndPDF (merged)", e);
      showAlert("Error", e.message || "Generation failed. Please check function logs.");
    } finally {
      setGenLoading(false);
      setTimeout(() => { setLoaderMsg("Preparing data…"); setLoaderPct(0.1); }, 400); // reset after a moment
    }
  };

  // ---------- UI sizing ----------
  const { width, height } = Dimensions.get("window");
  const maxCardW = Math.min(width - 24, 640);
  const chromePad = 12 * 2 + 48 + 68 + 24;
  const scrollMax = Math.max(240, Math.min(height - chromePad, 560));
  const actionsDisabled = saving || genLoading || profileLoading || (blockedToday && !existing && !isPremium);

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      onRequestClose={() => { setVisible(false); router.back(); }}
    >
      {/* identical to invoices/wizard: light blur above underlying page */}
      <BlurView intensity={10} tint="systemThinMaterialLight" style={{ position: "absolute", inset: 0 }} />

      <StatusBar backgroundColor={BG_HEX} barStyle="dark-content" />

      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: 12 }}>
        <View style={[modalCard, { width: maxCardW, maxWidth: maxCardW, backgroundColor: CARD, overflow: "hidden" }]}>
          {/* Header */}
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12, paddingTop: 10, marginBottom: 6 }}>
            <Text style={{ color: TEXT, fontSize: 18, fontWeight: "900" }}>
              {
                existing
                  ? (isFinalized
                      ? (existing.reference || quoteRef(existing.quote_number, existing.created_at))
                      : "Create Quote")
                  : "Create Quote"
              }
            </Text>
            <SmallBtn variant="light" onPress={() => { Haptics.selectionAsync(); setVisible(false); router.back(); }}>Close</SmallBtn>
          </View>

          {/* Step header */}
          <View style={{ paddingHorizontal: 12 }}>
            <StepHeader step={step} total={TOTAL_STEPS} title={STEP_TITLES[step - 1]} />
          </View>

          {/* CONTENT */}
          <View style={{ maxHeight: scrollMax, paddingHorizontal: 12 }}>
            <ScrollView contentContainerStyle={{ paddingBottom: 12, paddingTop: 2 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" showsVerticalScrollIndicator={false}>
              {!HAS_PLACES_KEY && (
                <Card>
                  <Text style={{ color: AMBER, fontWeight: "800" }}>Address search requires a Google Maps key.</Text>
                  <Hint>Set EXPO_PUBLIC_GOOGLE_MAPS_KEY in your app config.</Hint>
                </Card>
              )}
              {blockedToday && !isPremium && !existing && (
                <Card>
                  <Text style={{ color: AMBER, fontWeight: "800" }}>Daily limit reached</Text>
                  <Hint>
                    {premiumStatus.status === 'expired' 
                      ? "Your trial has expired. Subscribe to create unlimited quotes."
                      : "You've reached today's limit. Upgrade for unlimited quotes."
                    }
                  </Hint>
                </Card>
              )}
              {isFinalized && (
                <Card>
                  <Text style={{ color: BRAND, fontWeight: "800" }}>This quote has been generated.</Text>
                  <Hint>You can’t generate it again.</Hint>
                </Card>
              )}
              {profileLoading && (
                <Card>
                  <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
                    <ActivityIndicator />
                    <Text style={{ color: MUTED }}>Loading your profile…</Text>
                  </View>
                </Card>
              )}
              {!!profileError && !profileLoading && (
                <Pressable onPress={loadProfile}>
                  <Card>
                    <Text style={{ color: WARN, fontWeight: "800" }}>{profileError}</Text>
                    <Hint>(Tap to retry)</Hint>
                  </Card>
                </Pressable>
              )}

              {/* STEP 1 — Client */}
              {step === 1 && (
                <View style={{ gap: 6 }}>
                  <Card>
                    <Label>Client</Label>
                    <Input placeholder="Client name" value={clientName} onChangeText={setClientName} />
                    <View style={{ flexDirection: "row", gap: 8 }}>
                      <Input style={{ flex: 1 }} placeholder="Email (optional)" keyboardType="email-address" autoCapitalize="none" value={clientEmail} onChangeText={setClientEmail} />
                      <Input style={{ flex: 1 }} placeholder="Phone (optional)" keyboardType="phone-pad" value={clientPhone} onChangeText={setClientPhone} />
                    </View>
                    <Pressable onPress={() => setBillingOpen(true)} style={{ marginTop: 4 }}>
                      <Input value={clientAddress} editable={false} placeholder="Billing address (tap to search or edit)" style={{ color: clientAddress ? TEXT : MUTED }} />
                    </Pressable>
                  </Card>
                </View>
              )}

              {/* STEP 2 — Travel */}
              {step === 2 && (
                <View style={{ gap: 6 }}>
                  <Card>
                    <Label>Travel</Label>
                    <Pressable
                      onPress={() => { Haptics.selectionAsync(); setSameAsBilling((v) => !v); }}
                      style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 }}
                    >
                      <Checkbox checked={sameAsBilling} onPress={() => { Haptics.selectionAsync(); setSameAsBilling((v) => !v); }} />
                      <Text style={{ color: TEXT }}>Site address is the same as billing address</Text>
                    </Pressable>

                    <Pressable onPress={() => !sameAsBilling && setSiteOpen(true)}>
                      <Input
                        editable={false}
                        value={sameAsBilling ? clientAddress : siteAddress}
                        placeholder="Site address (tap to search or edit)"
                        style={sameAsBilling ? { backgroundColor: BG, color: MUTED } : {}}
                      />
                    </Pressable>

                    <View style={{ flexDirection: "row", gap: 8 }}>
                      <Input style={{ flex: 1 }} placeholder="Distance (miles)" keyboardType="decimal-pad" value={distanceMiles} onChangeText={setDistanceMiles} />
                      <View style={{ flex: 1, borderRadius: 10, borderWidth: 1, borderColor: BORDER, alignItems: "center", justifyContent: "center", paddingHorizontal: 8 }}>
                        {autoDistLoading ? (
                          <ActivityIndicator style={{ paddingVertical: 12 }} />
                        ) : (
                          <Text style={{ color: TEXT, fontWeight: "700", paddingVertical: 10, textAlign: "center" }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>
                            Travel (round trip): £{(travelCharge || 0).toFixed(2)}
                          </Text>
                        )}
                      </View>
                    </View>
                  </Card>
                </View>
              )}

              {/* STEP 3 — Job */}
              {step === 3 && (
                <View style={{ gap: 6 }}>
                  <Card>
                    <Label>Job</Label>
                    <Hint>Add as much detail as possible — access, materials, constraints, timing. (max {MAX_JOB_DETAILS})</Hint>
                    <Input placeholder="Job summary (short title)" value={jobSummary} onChangeText={setJobSummary} />
                    <View style={{ position: "relative" }}>
                      <Input
                        placeholder="Describe the work to be done…"
                        value={jobDetails}
                        onChangeText={setJobDetails}
                        multiline
                        numberOfLines={6}
                        style={{ minHeight: 140, textAlignVertical: "top", paddingRight: 60 }}
                      />
                      <View style={{ position: "absolute", right: 10, bottom: 10, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 4 }}>
                        <Text
                          style={{
                            color: jobLen >= MAX_JOB_DETAILS ? WARN : jobLen >= COUNTER_AMBER_AT ? AMBER : BRAND,
                            fontWeight: "800", fontSize: 12,
                          }}
                        >
                          {remaining} left
                        </Text>
                      </View>
                    </View>
                  </Card>
                </View>
              )}
            </ScrollView>
          </View>

          {/* FOOTER */}
          {!isFinalized && (
            <View style={footerWrap}>
              <View style={{ flexDirection: "row", gap: 8, paddingHorizontal: 12, paddingVertical: 10 }}>
                {/* Change Back to Close on first step */}
                {step === 1 ? (
                  <Btn variant="secondary" onPress={() => { setVisible(false); router.back(); }} disabled={saving || genLoading || profileLoading}>Close</Btn>
                ) : (
                  <Btn variant="secondary" onPress={back} disabled={saving || genLoading || profileLoading}>Back</Btn>
                )}
                {step < TOTAL_STEPS && <Btn onPress={next} disabled={saving || genLoading || profileLoading}>Next</Btn>}
                {step === TOTAL_STEPS && (
                  <>
                    <Btn variant="secondary" onPress={saveDraftOnly} disabled={actionsDisabled}>{saving ? "Saving…" : "Save Draft"}</Btn>
                    <Btn onPress={generateAIAndPDF} disabled={actionsDisabled}>{genLoading ? "Generating…" : "Generate Quote"}</Btn>
                  </>
                )}
              </View>
            </View>
          )}

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
        </View>
      </View>

      {/* 🔥 Fancy full-screen loader while generating */}
      <FancyBuilderLoader visible={genLoading} message={loaderMsg} progress={loaderPct} />
    </Modal>
  );
}

/* ---------------- Reusable centered editor (matches invoices/wizard) ---------------- */
function CenteredEditor({ visible, onClose, children }) {
  const { width } = Dimensions.get("window");
  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <BlurView intensity={20} tint="systemMaterialLight" style={{ position: "absolute", inset: 0 }} />
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: 12 }}>
        <View style={[editorCard, { width: Math.min(width - 32, 560) }]}>
          <View style={{ flexDirection: "row", justifyContent: "flex-end" }}>
            <SmallBtn variant="light" onPress={onClose}>Close</SmallBtn>
          </View>
          {children}
        </View>
      </View>
    </Modal>
  );
}

/* ---------------- Address editor content ---------------- */
function AddressEditor({ title = "Address", GOOGLE, initialText, onUse, onClose }) {
  const [mode, setMode] = useState((initialText || "").trim() ? "edit" : "search");
  const [query, setQuery] = useState(initialText || "");
  const [suggestions, setSuggestions] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sessionToken, setSessionToken] = useState(uuid4());
  const [editValue, setEditValue] = useState(initialText || "");

  useEffect(() => {
    setSessionToken(uuid4());
    setMode((initialText || "").trim() ? "edit" : "search");
    setQuery(initialText || "");
    setEditValue(initialText || "");
    setSuggestions([]); setBusy(false); setError("");
  }, [initialText]);

  const debounceRef = useRef();
  useEffect(() => {
    if (mode !== "search") return;
    const q = (query || "").trim();
    if (q.length < 3) { setSuggestions([]); setError(""); return; }
    if (!GOOGLE) { setError("Google key missing. Set EXPO_PUBLIC_GOOGLE_MAPS_KEY."); return; }
    setError("");
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        setBusy(true);
        const url =
          "https://maps.googleapis.com/maps/api/place/autocomplete/json" +
          "?input=" + encodeURIComponent(q) +
          "&types=address&components=country:gb&language=en&region=GB" +
          "&sessiontoken=" + sessionToken + "&key=" + GOOGLE;
        const j = await tryJson(url, {}, 2);
        const status = String(j?.status || "OK");
        if (status !== "OK") { setSuggestions([]); setError(status !== "ZERO_RESULTS" ? "Search error: " + status : ""); return; }
        setSuggestions(Array.isArray(j?.predictions) ? j.predictions : []);
      } catch { setSuggestions([]); setError("Network error. Try again."); }
      finally { setBusy(false); }
    }, 160);
    return () => clearTimeout(debounceRef.current);
  }, [query, GOOGLE, sessionToken, mode]);

  const fetchDetails = useCallback(
    async (placeId) => {
      if (!GOOGLE || !placeId) return null;
      const url =
        "https://maps.googleapis.com/maps/api/place/details/json" +
        "?place_id=" + encodeURIComponent(placeId) +
        "&fields=formatted_address&language=en&region=GB" +
        "&sessiontoken=" + sessionToken + "&key=" + GOOGLE;
      try {
        const j = await tryJson(url, {}, 2);
        if (String(j?.status || "OK") !== "OK") return null;
        return j?.result || null;
      } catch { return null; }
    },
    [GOOGLE, sessionToken]
  );

  const normaliseFormatted = (s) => String(s || "").replace(/,\s*UK$/i, "").replace(/,\s*United Kingdom$/i, "");
  const pickSuggestion = useCallback(async (item) => {
    setBusy(true);
    Haptics.selectionAsync();
    try {
      const details = await fetchDetails(item.place_id);
      const formatted = normaliseFormatted(details?.formatted_address || item?.description || "");
      setEditValue(formatted);
      setMode("edit");
    } finally {
      setBusy(false);
    }
  }, [fetchDetails]);

  const canUse = (editValue || "").trim().length >= 6;

  return (
    <View>
      <Text style={{ color: TEXT, fontWeight: "800", marginBottom: 6 }}>
        {mode === "search" ? `${title}: Search (GB)` : `${title}: Edit`}
      </Text>

      {mode === "search" ? (
        <View>
          <Label>Search</Label>
          <Input value={query} onChangeText={setQuery} placeholder="Start typing address…" autoCapitalize="none" autoCorrect={false} />
          {busy && <Text style={{ color: MUTED, fontSize: 12, marginBottom: 6 }}>Searching…</Text>}
          {!!error && <Text style={{ color: WARN, fontWeight: "700", marginBottom: 6 }}>{error}</Text>}

          {Array.isArray(suggestions) && suggestions.length > 0 && (
            <View style={{ borderWidth: 1, borderColor: BORDER, borderRadius: 10, overflow: "hidden" }}>
              <ScrollView style={{ maxHeight: 240 }}>
                {suggestions.map((it) => (
                  <Pressable key={String(it.place_id)} onPress={() => pickSuggestion(it)} style={{ paddingVertical: 10, paddingHorizontal: 10, borderBottomWidth: 1, borderBottomColor: BORDER }}>
                    <Text style={{ color: TEXT }}>{it.description}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          )}
        </View>
      ) : (
        <View>
          <Label>Full address</Label>
          <Input value={editValue} onChangeText={setEditValue} placeholder="You can add flat number, corrections, etc." multiline numberOfLines={4} style={{ minHeight: 100, textAlignVertical: "top" }} />
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Btn variant="secondary" onPress={() => setMode("search")}>Back to search</Btn>
            <Btn
              onPress={() => {
                if (!canUse) return;
                Haptics.selectionAsync();
                onUse?.(editValue.trim());
                onClose?.();
              }}
              disabled={!canUse}
            >
              Use Address
            </Btn>
          </View>
        </View>
      )}
    </View>
  );
}

/* ---------------- Fancy Builder Loader ---------------- */
function FancyBuilderLoader({ visible, message = "Preparing data…", progress = 0.1 }) {
  const scale = useRef(new Animated.Value(1)).current;
  const rotate = useRef(new Animated.Value(0)).current;
  const bar = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) return;
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(scale, { toValue: 1.06, duration: 500, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(scale, { toValue: 1.0, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ])
    );
    const spin = Animated.loop(
      Animated.timing(rotate, { toValue: 1, duration: 1800, easing: Easing.linear, useNativeDriver: true })
    );
    pulse.start();
    spin.start();
    return () => { pulse.stop(); spin.stop(); rotate.setValue(0); };
  }, [visible, scale, rotate]);

  useEffect(() => {
    Animated.timing(bar, { toValue: Math.max(0, Math.min(1, progress)), duration: 350, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  }, [progress, bar]);

  const spinZ = rotate.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });
  const barWidth = bar.interpolate({ inputRange: [0, 1], outputRange: ["6%", "100%"] });

  if (!visible) return null;
  return (
    <View style={styles.loaderBackdrop}>
      <BlurView intensity={30} tint="systemThinMaterialDark" style={StyleSheet.absoluteFill} />
      <View style={styles.loaderCard}>
        <Animated.View style={{ transform: [{ scale }, { rotate: spinZ }], marginBottom: 16 }}>
          <View style={styles.loaderRingOuter}>
            <View style={styles.loaderRingInner}/>
          </View>
        </Animated.View>
        <Text style={styles.loaderTitle}>Building your quote</Text>
        <Text style={styles.loaderSub}>{message}</Text>
        <View style={styles.progressWrap}>
          <Animated.View style={[styles.progressBar, { width: barWidth }]} />
        </View>
        <Text style={styles.loaderHint}>This can take a few seconds</Text>
      </View>
    </View>
  );
}

/* ---------------- Styles & UI helpers ---------------- */
const modalShadow = Platform.select({
  ios: { shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 18, shadowOffset: { width: 0, height: 6 } },
  android: { elevation: 18 },
});
const modalCard = {
  backgroundColor: BG,
  borderRadius: 18,
  paddingTop: 12,
  borderWidth: 1,
  borderColor: BORDER,
  ...modalShadow,
};
const editorCard = {
  backgroundColor: CARD,
  borderRadius: 16,
  padding: 12,
  borderWidth: 1,
  borderColor: BORDER,
  ...Platform.select({
    ios: { shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 16, shadowOffset: { width: 0, height: 6 } },
    android: { elevation: 14 },
  }),
};
const footerWrap = {
  borderTopWidth: 1,
  borderTopColor: BORDER,
  backgroundColor: CARD,
  borderBottomLeftRadius: 18,
  borderBottomRightRadius: 18,
};

function Card({ children }) {
  return (
    <View
      style={{
        backgroundColor: CARD,
        borderRadius: 12,
        padding: 10,
        borderWidth: 1,
        borderColor: BORDER,
        marginBottom: 8,
        ...Platform.select({
          ios: { shadowColor: "#000", shadowOpacity: 0.07, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
          android: { elevation: 4 },
        }),
      }}
    >
      {children}
    </View>
  );
}
function Label({ children }) { return <Text style={{ color: TEXT, fontWeight: "800", marginBottom: 6 }}>{children}</Text>; }
function Hint({ children }) { return <Text style={{ color: MUTED, fontSize: 12, marginTop: 2 }}>{children}</Text>; }
function Input(props) {
  return (
    <TextInput
      {...props}
      style={[
        { backgroundColor: CARD, borderColor: BORDER, borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 10, color: TEXT, marginBottom: 8 },
        props.style || {},
      ]}
      placeholderTextColor={MUTED}
    />
  );
}
function Btn(props) {
  const disabled = !!props.disabled;
  const variant = props.variant || "primary";
  const bg = disabled ? DISABLED : variant === "secondary" ? BORDER : variant === "primary" ? OK : BRAND;
  const color = variant === "secondary" ? TEXT : "#ffffff";
  return (
    <TouchableOpacity
      onPress={disabled ? () => {} : () => { Haptics.selectionAsync(); props.onPress && props.onPress(); }}
      style={{ flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: "center", backgroundColor: bg }}
    >
      <Text style={{ color, fontWeight: "800" }}>{typeof props.children === "string" ? props.children : "Button"}</Text>
    </TouchableOpacity>
  );
}
function SmallBtn({ children, onPress, variant = "default" }) {
  const bg = variant === "danger" ? "#ef4444" : variant === "light" ? "#f3f4f6" : BORDER;
  const color = variant === "danger" ? "#fff" : TEXT;
  return (
    <TouchableOpacity onPress={() => { Haptics.selectionAsync(); onPress && onPress(); }} style={{ paddingVertical: 6, paddingHorizontal: 10, borderRadius: 10, backgroundColor: bg }}>
      <Text style={{ color, fontWeight: "700" }}>{typeof children === "string" ? children : "Action"}</Text>
    </TouchableOpacity>
  );
}
function Checkbox({ checked, onPress }) {
  return (
    <Pressable
      onPress={() => { Haptics.selectionAsync(); onPress && onPress(); }}
      style={{ width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: checked ? BRAND : "#cbd5e1", alignItems: "center", justifyContent: "center", backgroundColor: checked ? BRAND : "#fff" }}
    >
      {checked ? <Feather name="check" size={14} color="#fff" /> : null}
    </Pressable>
  );
}
function StepHeader({ step, total, title }) {
  const pct = Math.max(0, Math.min(1, step / total));
  return (
    <View style={{ marginBottom: 8 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
        <Text style={{ color: TEXT, fontWeight: "800" }}>{title}</Text>
        <Text style={{ color: MUTED, fontWeight: "600", fontSize: 12 }}>Step {step} of {total}</Text>
      </View>
      <View style={{ height: 6, backgroundColor: "#dde3ea", borderRadius: 999 }}>
        <View style={{ width: `${pct * 100}%`, height: 6, backgroundColor: BRAND, borderRadius: 999 }} />
      </View>
    </View>
  );
}

/* --- Loader styles --- */
const styles = StyleSheet.create({
  loaderBackdrop: {
    position: "absolute",
    inset: 0,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  loaderCard: {
    width: Math.min(Dimensions.get("window").width - 40, 360),
    backgroundColor: "#0b1220",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    padding: 20,
    alignItems: "center",
  },
  loaderRingOuter: {
    width: 74,
    height: 74,
    borderRadius: 74,
    borderWidth: 4,
    borderColor: "rgba(255,255,255,0.25)",
    alignItems: "center",
    justifyContent: "center",
  },
  loaderRingInner: {
    width: 46,
    height: 46,
    borderRadius: 46,
    borderWidth: 4,
    borderColor: "#2a86ff",
    borderLeftColor: "transparent",
    borderBottomColor: "transparent",
  },
  loaderTitle: { color: "#fff", fontWeight: "900", fontSize: 16 },
  loaderSub: { color: "rgba(255,255,255,0.9)", marginTop: 6, textAlign: "center" },
  progressWrap: {
    width: "100%",
    height: 8,
    backgroundColor: "rgba(255,255,255,0.1)",
    borderRadius: 999,
    marginTop: 14,
    overflow: "hidden",
  },
  progressBar: {
    height: "100%",
    backgroundColor: "#2a86ff",
    borderRadius: 999,
  },
  loaderHint: { color: "rgba(255,255,255,0.7)", marginTop: 10, fontSize: 12 },
});