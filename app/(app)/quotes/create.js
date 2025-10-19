// app/(app)/quotes/create.js
// 2-step wizard matching onboarding design

import React, { useEffect, useState, useCallback, useMemo, useRef } from "react";
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, ActivityIndicator,
  Platform, StatusBar, Pressable, Dimensions, Alert, StyleSheet, Modal, Animated, Easing, Keyboard
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from "../../../lib/supabase";
import * as Haptics from "expo-haptics";
import { Feather } from "@expo/vector-icons";
import { loginHref, quotesListHref } from "../../../lib/nav";
import { getPremiumStatus } from "../../../lib/premium";
import * as NavigationBar from 'expo-navigation-bar';
import * as SystemUI from 'expo-system-ui';

/* -------------------------- THEME -------------------------- */
const BRAND = '#2a86ff';
const TEXT = '#0b1220';
const MUTED = '#6b7280';
const CARD = '#ffffff';
const BG = '#ffffff';
const BORDER = '#e6e9ee';
const OK = '#16a34a';
const DISABLED = '#9ca3af';
const WARN = '#dc2626';
const AMBER = '#b45309';

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

const quoteRef = (n, createdAt) => {
  if (n == null) return "";
  const year = createdAt ? new Date(createdAt).getFullYear() : new Date().getFullYear();
  return "QUO-" + year + "-" + String(n).padStart(4, "0");
};

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

/* =================== Screen =================== */
const TOTAL_STEPS = 2;
const STEP_TITLES = ["Client & Location", "Job Details"];

export default function CreateQuote() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams();
  const paramsQuoteId = params?.quoteId ? String(params.quoteId) : null;

  // Force white colors like onboarding
  useEffect(() => {
    const forceWhiteColors = () => {
      StatusBar.setBarStyle('dark-content', false);
      if (Platform.OS === 'android') {
        StatusBar.setBackgroundColor('#ffffff', false);
      }
    };

    const forceWhiteAsync = async () => {
      try {
        if (Platform.OS === 'android') {
          await NavigationBar.setBackgroundColorAsync('#ffffff');
          await NavigationBar.setButtonStyleAsync('dark');
          if (NavigationBar.setBorderColorAsync) {
            await NavigationBar.setBorderColorAsync('#ffffff');
          }
        }
        await SystemUI.setBackgroundColorAsync('#ffffff');
      } catch (error) {
        console.log('Force white error:', error);
      }
    };

    forceWhiteColors();
    forceWhiteAsync();

    const intervals = [];
    for (let i = 0; i < 20; i++) {
      intervals.push(setTimeout(() => {
        forceWhiteColors();
        if (i === 0) forceWhiteAsync();
      }, i * 100));
    }

    return () => intervals.forEach(clearTimeout);
  }, []);

  // Steps
  const [step, setStep] = useState(1);
  const next = () => setStep((s) => { 
    const n = Math.min(s + 1, TOTAL_STEPS); 
    if (n !== s) Haptics.selectionAsync(); 
    return n; 
  });
  const back = () => setStep((s) => { 
    const n = Math.max(s - 1, 1); 
    if (n !== s) Haptics.selectionAsync(); 
    return n; 
  });

  // Form state
  const [clientName, setClientName] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [clientAddress, setClientAddress] = useState("");
  const [siteAddress, setSiteAddress] = useState("");
  const [sameAsBilling, setSameAsBilling] = useState(false);

  const [jobSummary, setJobSummary] = useState("");
  const [jobDetails, _setJobDetails] = useState("");
  const jobLen = jobDetails.length;
  const remaining = Math.max(0, MAX_JOB_DETAILS - jobLen);
  const setJobDetails = (t) => _setJobDetails((t || "").slice(0, MAX_JOB_DETAILS));

  // Validation state like onboarding
  const [fieldErrors, setFieldErrors] = useState({});

  // Address modals
  const [billingOpen, setBillingOpen] = useState(false);
  const [siteOpen, setSiteOpen] = useState(false);

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
  const [saving, setSaving] = useState(false);
  const [genLoading, setGenLoading] = useState(false);

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
      return data;
    } catch (e) {
      setProfileError(e?.message || "Could not load your profile.");
      setPremiumStatus({ isPremium: false, status: 'error', isBlocked: false });
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
  useEffect(() => {
    (async () => {
      if (!paramsQuoteId) return;
      const { data, error } = await supabase.from("quotes").select("*").eq("id", paramsQuoteId).maybeSingle();
      if (error) return;
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
        router.replace(quotesListHref);
        return;
      }

      // no quote number at draft time
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
      };
      const { error: insErr } = await supabase.from("quotes").insert(draftRow);
      if (insErr) throw insErr;

      showAlert("Saved", "Draft created.");
      router.replace(quotesListHref);
    } catch (e) {
      showAlert("Error", e.message || "Could not create draft.");
    } finally { setSaving(false); }
  };

  /* --------------- AI -> PDF flow --------------- */
  const bump = (msg, pct) => { setLoaderMsg(msg); setLoaderPct(pct); };

  const generateAIAndPDF = async () => {
    let triedFreshQuoteNumber = false;
    try {
      if (isFinalized) { showAlert("Locked", "Already generated."); return; }
      if (isBlank(jobSummary) || isBlank(jobDetails)) { showAlert("Add job info", "Summary + details required."); return; }
      Keyboard.dismiss();
      setGenLoading(true);

      bump("Preparing data…", 0.12);
      await sleep(300);

      const prof = await getProfileOrThrow();
      const { data: userData } = await supabase.auth.getUser();
      const user = userData?.user;
      if (!user) throw new Error("Not signed in");

      bump("Calculating travel costs…", 0.22);
      await sleep(200);
      if (!distanceMiles) await autoCalcDistance();

      // Prepare quote payload
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
      };

      // Only add quote_number if an existing row already has it
      if (existing?.quote_number) {
        quotePayload.quote_number = existing.quote_number;
      }

      let pdfPayload = {
        user_id: user.id,
        web_search: true, // research always on
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
        pdfErr  = resp?.error || null;

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

      // classify research failures only
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

      let signedUrl   = pdfData?.signedUrl || pdfData?.signed_url || null;
      let storagePath = pdfData?.path || pdfData?.key || pdfData?.objectPath || null;
      let bucket      = "quotes";

      const parsed = storagePath
        ? { bucket, path: storagePath }
        : (pdfData?.publicUrl || signedUrl ? parseStorageUrl(pdfData.publicUrl || signedUrl) : null);
      if (parsed) { bucket = parsed.bucket || "quotes"; storagePath = parsed.path; }

      // Resolve the quote id now so Preview can receive it
      let effectiveQuoteId = pdfData?.quote_id || pdfData?.quoteId || existing?.id || null;

      // We’ll only proceed to preview *after* we can reach the file.
      let previewUrl = null;

      // 1) public URL if reachable
      if (storagePath) {
        const { data: pub } = supabase.storage.from(bucket).getPublicUrl(storagePath);
        const pubUrl = pub?.publicUrl || null;
        if (pubUrl && await probeUrl(pubUrl)) previewUrl = pubUrl;
      }

      // 2) signed URL poll
      if (!previewUrl && storagePath) {
        bump("Finalizing…", 0.86);
        signedUrl = await pollSignedUrlReady(storagePath, { tries: 20, baseDelay: 250, step: 250, maxDelay: 900 });
        if (signedUrl) previewUrl = signedUrl;
      }

      // 3) lookup quotes table by id / number
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
          if (qRow?.pdf_url && await probeUrl(qRow.pdf_url)) previewUrl = qRow.pdf_url;
        }

        if (!previewUrl && effectiveQuoteId) {
          const { data: q1 } = await supabase
            .from("quotes")
            .select("pdf_url")
            .eq("id", effectiveQuoteId)
            .maybeSingle();
          if (q1?.pdf_url && await probeUrl(q1.pdf_url)) previewUrl = q1.pdf_url;
        }
      }

      // 4) last-chance short poll
      if (!previewUrl && storagePath) {
        bump("Wrapping up…", 0.95);
        const extraSigned = await pollSignedUrlReady(storagePath, { tries: 16, baseDelay: 300, step: 300, maxDelay: 1000 });
        if (extraSigned) previewUrl = extraSigned;
      }

      if (!previewUrl) {
        if (pdfErr && isResearchFailure(pdfErr.message || pdfErr)) {
          showAlert(
            "Please be more specific",
            "I need a bit more detail to research this job.\n\nTip: mention the room, quantities/sizes, materials or finishes, access limits, and anything unusual."
          );
          return;
        }
        showAlert(
          "Almost ready",
          "The quote has been generated, but the file link isn’t ready yet. Please try again in a few seconds."
        );
        return;
      }

      // ensure we have an id for Preview (fallback by matching storage path)
      if (!effectiveQuoteId && storagePath) {
        const { data: matchRow } = await supabase
          .from("quotes")
          .select("id")
          .ilike("pdf_url", `%${storagePath}`)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (matchRow?.id) effectiveQuoteId = matchRow.id;
      }

      // ✅ navigate only when URL is reachable
      const fileName =
        (pdfData?.quote_number
          ? ("QUO-" + (new Date().getFullYear()) + "-" + String(pdfData.quote_number).padStart(4, "0"))
          : "quote") + ".pdf";

      router.replace({
        pathname: "/(app)/quotes/preview",
        params: {
          url: encodeURIComponent(previewUrl),
          name: fileName,
          id: effectiveQuoteId ? String(effectiveQuoteId) : "",
        },
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
      setTimeout(() => {
        setLoaderMsg("Preparing data…");
        setLoaderPct(0.1);
      }, 400);
    }
  };

  // Step validations like onboarding
  const validateStep1 = () => {
    const errors = {};
    if (!clientName.trim()) errors.clientName = 'Client name is required';
    if (!clientAddress.trim()) errors.clientAddress = 'Billing address is required';
    if (!sameAsBilling && !siteAddress.trim()) errors.siteAddress = 'Site address is required';
    return errors;
  };

  const validateStep2 = () => {
    const errors = {};
    if (!jobSummary.trim()) errors.jobSummary = 'Job title is required';
    if (!jobDetails.trim()) errors.jobDetails = 'Job description is required';
    return errors;
  };

  const getCurrentStepErrors = () => {
    switch (step) {
      case 1: return validateStep1();
      case 2: return validateStep2();
      default: return {};
    }
  };

  const canProceed = () => {
    const errors = getCurrentStepErrors();
    return Object.keys(errors).length === 0;
  };

  const goNext = () => {
    const errors = getCurrentStepErrors();
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});
    next();
  };

  const goBack = () => {
    setFieldErrors({});
    back();
  };

  // ---------- Derived: disable actions ----------
  const actionsDisabled = saving || genLoading || profileLoading;

  // ---------- UI sizing like onboarding ----------
  const { width, height } = Dimensions.get("window");
  const maxCardW = Math.min(width - 24, 640);
  const chromePad = 12 * 2 + 48 + 68 + 24;
  const scrollMax = Math.max(240, Math.min(height - chromePad, 560));

  return (
    <View style={{ flex: 1, backgroundColor: BG }}>
      <StatusBar barStyle="dark-content" backgroundColor="#ffffff" translucent={false} />
      
      {/* Safe area top */}
      <View style={{ height: insets.top, backgroundColor: CARD }} />
      
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => {
          if (step > 1) {
            goBack();
          } else {
            router.back();
          }
        }}>
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
            <View style={[styles.progressFill, { width: `${(step / TOTAL_STEPS) * 100}%` }]} />
          </View>
        </View>

        {/* Warning cards */}
        {isFinalized && (
          <View style={styles.card}>
            <Text style={{ color: BRAND, fontWeight: "800" }}>
              This quote has been generated.
            </Text>
            <Text style={styles.hint}>You can't generate it again.</Text>
          </View>
        )}

        {/* Step 1: Client & Job Meta */}
        {step === 1 && (
          <>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Client Details</Text>
              
              <Label required>Client Name</Label>
              <Input
                placeholder="Client name"
                value={clientName}
                onChangeText={(text) => {
                  setClientName(text);
                  if (fieldErrors.clientName) {
                    setFieldErrors(prev => ({ ...prev, clientName: null }));
                  }
                }}
                style={fieldErrors.clientName ? styles.inputError : {}}
              />
              {fieldErrors.clientName && <ErrorText>{fieldErrors.clientName}</ErrorText>}

              <View style={{ flexDirection: "row", gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <Label>Email (optional)</Label>
                  <Input
                    placeholder="Email"
                    keyboardType="email-address"
                    autoCapitalize="none"
                    value={clientEmail}
                    onChangeText={setClientEmail}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Label>Phone (optional)</Label>
                  <Input
                    placeholder="Phone"
                    keyboardType="phone-pad"
                    value={clientPhone}
                    onChangeText={setClientPhone}
                  />
                </View>
              </View>

              <Label required>Billing Address</Label>
              <TouchableOpacity onPress={() => setBillingOpen(true)}>
                <Input
                  value={clientAddress}
                  editable={false}
                  placeholder="Tap to search or enter billing address"
                  style={[
                    { color: clientAddress ? TEXT : MUTED },
                    fieldErrors.clientAddress ? styles.inputError : {}
                  ]}
                />
              </TouchableOpacity>
              {fieldErrors.clientAddress && <ErrorText>{fieldErrors.clientAddress}</ErrorText>}
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Site Location & Travel</Text>
              
              <View style={styles.switchRow}>
                <Text style={styles.label}>Same as billing address</Text>
                <Checkbox
                  checked={sameAsBilling}
                  onPress={() => {
                    Haptics.selectionAsync();
                    setSameAsBilling((v) => !v);
                  }}
                />
              </View>

              {!sameAsBilling && (
                <>
                  <Label required>Site Address</Label>
                  <TouchableOpacity onPress={() => setSiteOpen(true)}>
                    <Input
                      editable={false}
                      value={siteAddress}
                      placeholder="Tap to search or enter site address"
                      style={[
                        { color: siteAddress ? TEXT : MUTED },
                        fieldErrors.siteAddress ? styles.inputError : {}
                      ]}
                    />
                  </TouchableOpacity>
                  {fieldErrors.siteAddress && <ErrorText>{fieldErrors.siteAddress}</ErrorText>}
                </>
              )}

              <View style={{ flexDirection: "row", gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <Label>Distance (miles)</Label>
                  <Input
                    placeholder="Distance"
                    keyboardType="decimal-pad"
                    value={distanceMiles}
                    onChangeText={setDistanceMiles}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Label>Travel Charge</Label>
                  <View style={styles.calcRow}>
                    {autoDistLoading ? (
                      <ActivityIndicator size="small" />
                    ) : (
                      <Text style={styles.calcValue}>
                        £{(travelCharge || 0).toFixed(2)}
                      </Text>
                    )}
                  </View>
                </View>
              </View>
            </View>
          </>
        )}

        {/* Step 2: Job Details */}
        {step === 2 && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Job Information</Text>
            
            <Label required>Job Title</Label>
            <Input
              placeholder="Brief job title"
              value={jobSummary}
              onChangeText={(text) => {
                setJobSummary(text);
                if (fieldErrors.jobSummary) {
                  setFieldErrors(prev => ({ ...prev, jobSummary: null }));
                }
              }}
              style={fieldErrors.jobSummary ? styles.inputError : {}}
            />
            {fieldErrors.jobSummary && <ErrorText>{fieldErrors.jobSummary}</ErrorText>}

            <Label required>Job Description</Label>
            <View style={{ position: "relative" }}>
              <Input
                placeholder="Describe the work to be done in detail..."
                value={jobDetails}
                onChangeText={(text) => {
                  setJobDetails(text);
                  if (fieldErrors.jobDetails) {
                    setFieldErrors(prev => ({ ...prev, jobDetails: null }));
                  }
                }}
                multiline
                numberOfLines={6}
                style={[
                  { 
                    minHeight: 120, 
                    textAlignVertical: "top", 
                    paddingRight: 60 
                  },
                  fieldErrors.jobDetails ? styles.inputError : {}
                ]}
              />
              <View style={styles.counterBadge}>
                <Text
                  style={{
                    color:
                      jobLen >= MAX_JOB_DETAILS
                        ? WARN
                        : jobLen >= COUNTER_AMBER_AT
                        ? AMBER
                        : BRAND,
                    fontWeight: "800",
                    fontSize: 12,
                  }}
                >
                  {remaining} left
                </Text>
              </View>
            </View>
            {fieldErrors.jobDetails && <ErrorText>{fieldErrors.jobDetails}</ErrorText>}
            <Text style={styles.hint}>Be specific about materials, sizes, finishes, and any special requirements.</Text>
          </View>
        )}
      </ScrollView>

      {/* Sticky Bottom Action Bar */}
      {!isFinalized && (
        <View style={[styles.actionBar, { paddingBottom: insets.bottom }]}>
          <TouchableOpacity
            style={[styles.actionBtn, styles.primaryActionBtn]}
            onPress={step < TOTAL_STEPS ? goNext : generateAIAndPDF}
            disabled={actionsDisabled}
          >
            <Text style={[styles.actionBtnText, { color: "#ffffff" }]}>
              {step < TOTAL_STEPS ? "Next" : (genLoading ? "Creating…" : "Create")}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* White safe area bottom */}
      <View style={{ height: insets.bottom, backgroundColor: '#ffffff' }} />

      {/* Address modals - use simple backdrop instead of BlurView */}
      <CenteredEditor visible={billingOpen} onClose={() => setBillingOpen(false)}>
        <AddressEditor
          title="Billing address"
          GOOGLE={GOOGLE}
          initialText={clientAddress}
          onUse={(addr) => {
            setClientAddress(addr);
            if (sameAsBilling) setSiteAddress(addr);
          }}
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

/* ---------------- Reusable centered editor ---------------- */
function CenteredEditor({ visible, onClose, children }) {
  const { width } = Dimensions.get("window");
  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      presentationStyle="overFullScreen"
      onRequestClose={onClose}
    >
      <View style={{ position: "absolute", inset: 0, backgroundColor: 'rgba(0,0,0,0.5)' }} />
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
    setSuggestions([]);
    setBusy(false);
    setError("");
  }, [initialText]);

  const debounceRef = useRef();
  useEffect(() => {
    if (mode !== "search") return;
    const q = (query || "").trim();
    if (q.length < 3) { setSuggestions([]); setError(""); return; }
    if (!GOOGLE) { setError("Google key missing. Set EXPO_PUBLIC_GOOGLE_MAPS_KEY."); return; }
    setError("");
    clearTimeout(debounceRef?.current);
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
        if (status !== "OK") {
          setSuggestions([]);
          setError(status !== "ZERO_RESULTS" ? "Search error: " + status : "");
          return;
        }
        setSuggestions(Array.isArray(j?.predictions) ? j.predictions : []);
      } catch {
        setSuggestions([]);
        setError("Network error. Try again.");
      } finally {
        setBusy(false);
      }
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
      } catch {
        return null;
      }
    },
    [GOOGLE, sessionToken]
  );

  const normaliseFormatted = (s) =>
    String(s || "").replace(/,\s*UK$/i, "").replace(/,\s*United Kingdom$/i, "");

  const pickSuggestion = useCallback(async (item) => {
    setBusy(true);
    Haptics.selectionAsync();
    try {
      const details = await fetchDetails(item.place_id);
      const formatted =
        normaliseFormatted(details?.formatted_address || item?.description || "");
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
          <Input
            value={query}
            onChangeText={setQuery}
            placeholder="Start typing address…"
            autoCapitalize="none"
            autoCorrect={false}
          />
          {busy && (
            <Text style={{ color: MUTED, fontSize: 12, marginBottom: 6 }}>
              Searching…
            </Text>
          )}
          {!!error && (
            <Text style={{ color: WARN, fontWeight: "700", marginBottom: 6 }}>
              {error}
            </Text>
          )}

          {Array.isArray(suggestions) && suggestions.length > 0 && (
            <View
              style={{
                borderWidth: 1,
                borderColor: BORDER,
                borderRadius: 10,
                overflow: "hidden",
              }}
            >
              <ScrollView style={{ maxHeight: 240 }}>
                {suggestions.map((it) => (
                  <Pressable
                    key={String(it.place_id)}
                    onPress={() => pickSuggestion(it)}
                    style={{
                      paddingVertical: 10,
                      paddingHorizontal: 10,
                      borderBottomWidth: 1,
                      borderBottomColor: BORDER,
                    }}
                  >
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
          <Input
            value={editValue}
            onChangeText={setEditValue}
            placeholder="You can add flat number, corrections, etc."
            multiline
            numberOfLines={4}
            style={{ minHeight: 100, textAlignVertical: "top" }}
          />
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Btn variant="secondary" onPress={() => setMode("search")}>
              Back to search
            </Btn>
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
  const bounce = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) { opacity.setValue(0); return; }
    Animated.timing(opacity, { toValue: 1, duration: 300, useNativeDriver: true }).start();

    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(scale, { toValue: 1.08, duration: 1200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(scale, { toValue: 1.0, duration: 1200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])
    );

    const bounceAnim = Animated.sequence([
      Animated.timing(bounce, { toValue: 1, duration: 200, easing: Easing.out(Easing.back(1.5)), useNativeDriver: true }),
      Animated.timing(bounce, { toValue: 0, duration: 300, useNativeDriver: true }),
    ]);

    pulse.start(); bounceAnim.start();
    return () => { pulse.stop(); bounce.setValue(0); };
  }, [visible, scale, bounce, opacity]);

  const bounceScale = bounce.interpolate({ inputRange: [0, 1], outputRange: [1, 1.1] });

  if (!visible) return null;

  return (
    <Animated.View style={[styles.loaderBackdrop, { opacity }]}>
      <View style={styles.loaderBackground} />
      <Animated.View style={[styles.loaderCard, { transform: [{ scale: bounceScale }] }]}>
        <Text style={styles.loaderTitle}>Building your quote</Text>
        <Text style={styles.loaderSub}>{message}</Text>
        <Text style={styles.loaderHint}>This usually takes a moment</Text>
        <View style={styles.dotsContainer}>
          <LoadingDot delay={0} />
          <LoadingDot delay={200} />
          <LoadingDot delay={400} />
        </View>
      </Animated.View>
    </Animated.View>
  );
}

function LoadingDot({ delay = 0 }) {
  const bounce = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(bounce, { toValue: 1, duration: 400, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(bounce, { toValue: 0, duration: 400, easing: Easing.in(Easing.quad), useNativeDriver: true }),
        Animated.delay(600),
      ])
    );
    animation.start();
    return () => animation.stop();
  }, [bounce, delay]);
  const translateY = bounce.interpolate({ inputRange: [0, 1], outputRange: [0, -8] });
  return <Animated.View style={[styles.loadingDot, { transform: [{ translateY }] }]} />;
}

/* ---------------- Styles & UI helpers ---------------- */
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
  backgroundColor: '#ffffff',
  borderBottomLeftRadius: 18,
  borderBottomRightRadius: 18,
  // Shadow applied inline above
};

function Card({ children }) {
  return (
    <View style={{
      backgroundColor: '#ffffff',
      borderRadius: 12,
      padding: 10,
      borderWidth: 1,
      borderColor: BORDER,
      marginBottom: 8,
      // Reduced card shadows too
      ...Platform.select({
        ios: {
          shadowColor: '#0b1220',
          shadowOpacity: 0.06,
          shadowRadius: 8,
          shadowOffset: { width: 0, height: 4 },
        },
        android: { elevation: 3 },
      }),
    }}>
      {children}
    </View>
  );
}

function Label({ children, required = false }) {
  return (
    <Text style={{ color: TEXT, fontWeight: "800", marginBottom: 6 }}>
      {children}
      {required && <Text style={{ color: '#dc2626' }}> *</Text>}
    </Text>
  );
}

function Input(props) {
  return (
    <TextInput
      {...props}
      style={[
        {
          backgroundColor: '#ffffff',
          borderColor: BORDER,
          borderWidth: 1,
          borderRadius: 10,
          paddingHorizontal: 10,
          paddingVertical: 10,
          color: TEXT,
          marginBottom: 8,
        },
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
    <TouchableOpacity
      onPress={() => {
        Haptics.selectionAsync();
        onPress && onPress();
      }}
      style={{
        width: 22,
        height: 22,
        borderRadius: 6,
        borderWidth: 2,
        borderColor: checked ? BRAND : "#cbd5e1",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: checked ? BRAND : "#fff",
      }}
    >
      {checked ? <Feather name="check" size={14} color="#fff" /> : null}
    </TouchableOpacity>
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
        <View style={{ width: pct * 100 + '%', height: 6, backgroundColor: BRAND, borderRadius: 999 }} />
      </View>
    </View>
  );
}

function ErrorText({ children }) {
  return <Text style={styles.errorText}>{children}</Text>;
}

const styles = StyleSheet.create({
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
  },

  actionBar: {
    backgroundColor: CARD,
    borderTopWidth: 1,
    borderTopColor: BORDER,
    paddingHorizontal: 16,
    paddingTop: 12,
    flexDirection: "row",
    gap: 12,
    justifyContent: "center",
    alignItems: "center",
    ...Platform.select({
      ios: {
        shadowColor: "#0b1220",
        shadowOpacity: 0.08,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: -4 },
      },
      android: {
        elevation: 8,
      },
    }),
  },
  
  actionBtn: {
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: "center",
    justifyContent: "center",
    flex: 1,
    marginHorizontal: 24,
  },
  
  primaryActionBtn: {
    backgroundColor: BRAND,
    borderColor: BRAND,
  },
  
  secondaryActionBtn: {
    backgroundColor: "#f8fafc",
  },
  
  actionBtnText: {
    fontSize: 15,
    fontWeight: "900",
    color: TEXT,
  },

  fullWidthActionBtn: {
    flex: 1,
    minWidth: '100%',
  },

  stepProgress: {
    marginBottom: 16,
  },
  
  stepRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  
  stepTitle: {
    color: TEXT,
    fontWeight: "800",
    fontSize: 16,
  },
  
  stepCounter: {
    color: MUTED,
    fontWeight: "600",
    fontSize: 12,
  },
  
  progressTrack: {
    height: 6,
    backgroundColor: "#dde3ea",
    borderRadius: 999,
  },
  
  progressFill: {
    height: 6,
    backgroundColor: BRAND,
    borderRadius: 999,
  },
  
  card: {
    backgroundColor: CARD,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: BORDER,
    marginBottom: 16,
    ...Platform.select({
      ios: {
        shadowColor: '#0b1220',
        shadowOpacity: 0.06,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 4 },
      },
      android: { elevation: 3 },
    }),
  },

  label: { color: TEXT, fontWeight: '700' },
  hint: { color: MUTED, fontSize: 12, marginTop: 4 },
  switchRow: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    justifyContent: 'space-between', 
    marginBottom: 10,
    paddingVertical: 4 // Add some padding for better touch area
  },
  
  calcRow: {
    backgroundColor: '#eef2f7',
    borderWidth: 1, 
    borderColor: BORDER,
    paddingVertical: 12, 
    paddingHorizontal: 14,
    borderRadius: 10, 
    marginBottom: 8,
    alignItems: 'center',
    justifyContent: 'center'
  },
  calcValue: { color: TEXT, fontWeight: '900' },
  
  counterBadge: {
    position: "absolute",
    right: 10,
    bottom: 18,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  
  inputError: { borderColor: '#dc2626', borderWidth: 2, backgroundColor: '#fef2f2' },
  errorText: { color: '#dc2626', fontSize: 12, fontWeight: '600', marginTop: -4, marginBottom: 8, marginLeft: 4 },
  
  /* --- Loader styles --- */
  loaderBackdrop: {
    position: "absolute",
    inset: 0,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  loaderBackground: {
    position: "absolute",
    inset: 0,
    backgroundColor: "#FFFFFF",
  },
  loaderCard: {
    width: Math.min(Dimensions.get("window").width - 40, 380),
    backgroundColor: CARD,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 28,
    alignItems: "center",
    shadowColor: "#0b1220",
    shadowOpacity: 0.15,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 16,
  },
  loaderTitle: { color: TEXT, fontWeight: "900", fontSize: 20, marginBottom: 6 },
  loaderSub: { color: MUTED, marginBottom: 20, textAlign: "center", fontSize: 15, lineHeight: 20 },
  loaderHint: { color: MUTED, fontSize: 13, textAlign: "center", marginBottom: 16 },
  dotsContainer: { flexDirection: "row", gap: 8, alignItems: "center" },
  loadingDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: BRAND, opacity: 0.6 },
});

// UI primitives matching onboarding
const modalCard = {
  backgroundColor: '#ffffff',
  borderRadius: 18,
  paddingTop: 12,
  borderWidth: 1,
  borderColor: BORDER,
  ...Platform.select({
    ios: {
      shadowColor: '#0b1220',
      shadowOpacity: 0.18,
      shadowRadius: 24,
      shadowOffset: { width: 0, height: 12 },
    },
    android: { elevation: 18 },
  }),
};