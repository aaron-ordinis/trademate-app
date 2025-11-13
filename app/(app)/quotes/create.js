// app/(app)/quotes/create.js
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
import { CARD, BORDER, BG, TEXT, styles as baseStyles } from "./components/ui";
import TemplatePicker from "../../../components/TemplatePicker";

/* ---------------- small utils ---------------- */
const MAX_JOB_DETAILS = 250;

const num = (v, d = 0) => {
  const n = Number(String(v).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : d;
};
const isBlank = (s) => !String(s || "").trim();
const sleep = (ms) => new Promise(function (r) { setTimeout(r, ms); });

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

// kept for future use if needed, not used in new flow
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

// kept for future use if needed, not used in new flow
async function pollSignedUrlReady(path, opts) {
  const options = opts || {};
  const tries = options.tries != null ? options.tries : 60;
  const baseDelay = options.baseDelay != null ? options.baseDelay : 300;
  const step = options.step != null ? options.step : 300;
  const maxDelay = options.maxDelay != null ? options.maxDelay : 1200;
  const signedUrlTtl = options.signedUrlTtl != null ? options.signedUrlTtl : 60 * 60 * 24 * 7;

  if (!path) return null;
  const storage = supabase.storage.from("quotes");
  for (let i = 0; i < tries; i++) {
    const res = await storage.createSignedUrl(path, signedUrlTtl);
    const data = res && res.data ? res.data : null;
    const url = data && data.signedUrl ? data.signedUrl : null;
    if (url && (await probeUrl(url))) return url;
    await sleep(Math.min(baseDelay + i * step, maxDelay));
  }
  return null;
}

// kept for future use if needed, not used in new flow
function parseStorageUrl(url) {
  if (!url) return null;
  const m = String(url).match(/\/storage\/v1\/object\/(sign|public)\/([^/]+)\/(.+?)(?:\?|$)/);
  return m ? { bucket: m[2], path: decodeURIComponent(m[3]) } : null;
}

// kept for future use if needed, not used in new flow
const haversineMiles = (lat1, lon1, lat2, lon2) => {
  const toRad = function (x) { return (x * Math.PI) / 180; };
  const R_km = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = ((lon1 - lon2) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R_km * c * 0.621371;
};

/* ---------------- template helpers ---------------- */
const normalizeTemplateCode = (code) => {
  if (!code) return "clean-classic.html";
  let c = String(code).trim();
  c = c.replace(/\s+/g, "");
  if (!/\.html$/i.test(c)) c += ".html";
  c = c.replace(/[^A-Za-z0-9._-]/g, "");
  return c.toLowerCase();
};

/* ---------------- screen ---------------- */
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
          if (NavigationBar.setBorderColorAsync) {
            await NavigationBar.setBorderColorAsync("#ffffff");
          }
        }
        await SystemUI.setBackgroundColorAsync("#ffffff");
      } catch (err) {
        console.log("Force white error:", err);
      }
    };
    forceWhite();
  }, []);

  // Steps
  const [step, setStep] = useState(1);
  const next = () =>
    setStep(function (s) {
      const n = Math.min(s + 1, TOTAL_STEPS);
      if (n !== s) Haptics.selectionAsync();
      return n;
    });
  const back = () =>
    setStep(function (s) {
      const n = Math.max(s - 1, 1);
      if (n !== s) Haptics.selectionAsync();
      return n;
    });

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

  useEffect(() => {
    if (sameAsBilling) setSiteAddress(clientAddress);
  }, [sameAsBilling, clientAddress]);

  // Profile / pricing
  const [profile, setProfile] = useState(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [premiumStatus, setPremiumStatus] = useState({
    isPremium: false,
    status: "no_profile",
  });
  const isPremium = premiumStatus.isPremium;

  const [distanceMiles, setDistanceMiles] = useState("");
  const [travelCharge, setTravelCharge] = useState(0);
  const [autoDistLoading, setAutoDistLoading] = useState(false);

  const [existing, setExisting] = useState(null);
  const [saving, setSaving] = useState(false);
  const [genLoading, setGenLoading] = useState(false);
  const [manualLoading, setManualLoading] = useState(false);

  const isFinalized = useMemo(
    () =>
      !!existing &&
      String(existing.status || "").toLowerCase() !== "draft",
    [existing]
  );

  /* profile */
  const loadProfile = useCallback(async () => {
    setProfileLoading(true);
    try {
      const userRes = await supabase.auth.getUser();
      const userData = userRes && userRes.data ? userRes.data : null;
      const user = userData && userData.user ? userData.user : null;
      if (!user) {
        router.replace(loginHref);
        return null;
      }
      const res = await supabase
        .from("profiles")
        .select(
          "id, business_name, trade_type, hourly_rate, materials_markup_pct, vat_registered, payment_terms, warranty_text, travel_rate_per_mile, custom_logo_url, address_line1, city, postcode, hours_per_day, trial_ends_at, plan_tier, plan_status, invoice_tax_rate"
        )
        .eq("id", user.id)
        .maybeSingle();
      if (res.error) {
        throw res.error;
      }
      setProfile(res.data);
      setPremiumStatus(getPremiumStatus(res.data));
      return res.data;
    } finally {
      setProfileLoading(false);
    }
  }, [router]);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  const getProfileOrThrow = useCallback(
    async () => {
      if (profile) return profile;
      if (profileLoading) {
        let tries = 12;
        while (tries > 0 && profileLoading && !profile) {
          tries -= 1;
          await sleep(150);
        }
        if (profile) return profile;
      }
      const fresh = await loadProfile();
      if (fresh) return fresh;
      throw new Error("Profile not loaded. Try again.");
    },
    [profile, profileLoading, loadProfile]
  );

  /* existing prefill */
  const paramsQuoteId = params && params.quoteId ? String(params.quoteId) : null;
  useEffect(() => {
    (async function () {
      if (!paramsQuoteId) return;
      const res = await supabase
        .from("quotes")
        .select("")
        .eq("id", paramsQuoteId)
        .maybeSingle();
      if (res && res.data) {
        const data = res.data;
        setExisting(data);
        setClientName(data.client_name || "");
        setClientEmail(data.client_email || "");
        setClientPhone(data.client_phone || "");
        setClientAddress(data.client_address || "");
        setSiteAddress(data.site_address || "");
        setJobSummary(data.job_summary || "");
        if (data.template_code) {
          setTemplateCode(String(data.template_code));
        }
        try {
          const blob =
            typeof data.job_details === "string"
              ? JSON.parse(data.job_details)
              : data.job_details || {};
          if (blob && blob.travel && blob.travel.distance_miles != null) {
            setDistanceMiles(String(blob.travel.distance_miles));
          }
          if (blob && blob.details != null) {
            _setJobDetails(String(blob.details).slice(0, MAX_JOB_DETAILS));
          }
        } catch (e) {
          // ignore parse error
        }
      }
    })();
  }, [paramsQuoteId]);

  /* travel charge */
  useEffect(() => {
    const oneWay = num(distanceMiles, 0);
    const rate = num(profile && profile.travel_rate_per_mile, 0);
    setTravelCharge(Math.round(oneWay * 2 * rate * 100) / 100);
  }, [distanceMiles, profile]);

  /* google helpers */
  const GOOGLE =
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY ||
    (globalThis &&
      globalThis.expo &&
      globalThis.expo.env &&
      globalThis.expo.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY) ||
    null;

  const buildBusinessAddress = (p) =>
    [p && p.address_line1, p && p.city, p && p.postcode]
      .filter(Boolean)
      .join(", ")
      .trim();

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
      const status = String(j && j.status ? j.status : "OK");
      if (status !== "OK") return null;
      const loc =
        j &&
        j.results &&
        j.results[0] &&
        j.results[0].geometry &&
        j.results[0].geometry.location
          ? j.results[0].geometry.location
          : null;
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
      const meters =
        j &&
        j.rows &&
        j.rows[0] &&
        j.rows[0].elements &&
        j.rows[0].elements[0] &&
        j.rows[0].elements[0].distance
          ? j.rows[0].elements[0].distance.value
          : null;
      if (meters == null) return null;
      return meters * 0.000621371;
    } catch {
      return null;
    }
  };

  const autoCalcDistance = useCallback(
    async () => {
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
        let miles = await getDrivingDistanceMiles(
          origin.lat,
          origin.lng,
          dest.lat,
          dest.lng
        );
        if (!miles) {
          miles = haversineMiles(origin.lat, origin.lng, dest.lat, dest.lng);
        }
        const rounded = Math.round(Number(miles) * 100) / 100;
        if (Number.isFinite(rounded)) {
          setDistanceMiles(String(rounded));
        }
      } finally {
        setAutoDistLoading(false);
      }
    },
    [clientAddress, siteAddress, sameAsBilling, getProfileOrThrow]
  );

  useEffect(() => {
    if (!(siteAddress || (sameAsBilling && clientAddress))) return;
    const t = setTimeout(function () {
      autoCalcDistance();
    }, 400);
    return function () {
      clearTimeout(t);
    };
  }, [siteAddress, clientAddress, sameAsBilling, autoCalcDistance]);

  /* alerts */
  const showAlert = (title, message) => {
    Haptics.selectionAsync();
    Alert.alert(title, message);
  };

  /* save draft */
  const saveDraftOnly = async () => {
    try {
      if (isFinalized) {
        showAlert("Locked", "This quote has already been generated.");
        return;
      }
      setSaving(true);
      const prof = await getProfileOrThrow();
      const userRes = await supabase.auth.getUser();
      const userData = userRes && userRes.data ? userRes.data : null;
      const user = userData && userData.user ? userData.user : null;
      if (!user) throw new Error("Not signed in");

      const blob = {
        summary: jobSummary || "",
        details: jobDetails || "",
        travel: {
          distance_miles: num(distanceMiles, 0),
          round_trip_miles: num(distanceMiles, 0) * 2,
          rate_per_mile: num(prof && prof.travel_rate_per_mile, 0),
          travel_charge: travelCharge,
        },
      };

      const tplCode = normalizeTemplateCode(templateCode);

      if (existing) {
        const upRes = await supabase
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
        if (upRes.error) throw upRes.error;

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

      const insRes = await supabase
        .from("quotes")
        .insert(draftRow)
        .select("id")
        .maybeSingle();
      if (insRes.error) throw insRes.error;

      if (insRes.data && insRes.data.id) {
        await supabase.functions.invoke("notify_user", {
          body: {
            user_id: user.id,
            type: "quote_created",
            title: "Quote created",
            body: "A new quote has been created.",
            quote_id: insRes.data.id,
          },
        });
      }

      showAlert("Saved", "Draft created.");
      router.replace(quotesListHref);
    } catch (e) {
      const msg = e && e.message ? e.message : "Could not create draft.";
      showAlert("Error", msg);
    } finally {
      setSaving(false);
    }
  };

  /* helper: upsert draft and return quote_id (no navigation, no notify) */
  const upsertDraftAndGetQuoteId = async () => {
    const prof = await getProfileOrThrow();
    const userRes = await supabase.auth.getUser();
    const userData = userRes && userRes.data ? userRes.data : null;
    const user = userData && userData.user ? userData.user : null;
    if (!user) {
      throw new Error("Not signed in");
    }

    const blob = {
      summary: jobSummary || "",
      details: jobDetails || "",
      travel: {
        distance_miles: num(distanceMiles, 0),
        round_trip_miles: num(distanceMiles, 0) * 2,
        rate_per_mile: num(prof && prof.travel_rate_per_mile, 0),
        travel_charge: travelCharge,
      },
    };

    const tplCode = normalizeTemplateCode(templateCode);

    if (existing) {
      const updateRes = await supabase
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

      if (updateRes.error) {
        throw updateRes.error;
      }
      return existing.id;
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

    const insertRes = await supabase
      .from("quotes")
      .insert(draftRow)
      .select("id")
      .maybeSingle();

    if (insertRes.error) {
      throw insertRes.error;
    }
    if (!insertRes.data || !insertRes.data.id) {
      throw new Error("Could not create quote draft");
    }

    return insertRes.data.id;
  };

  /* manual path: go to line-item editor screen */
  const openManualEditor = async () => {
    try {
      if (isFinalized) {
        showAlert("Locked", "This quote has already been generated.");
        return;
      }

      if (isBlank(jobSummary)) {
        showAlert("Job summary required", "Add a short job summary before editing items.");
        return;
      }

      Keyboard.dismiss();
      setManualLoading(true);

      if (!distanceMiles) {
        try {
          await autoCalcDistance();
        } catch (e) {
          // best-effort only
        }
      }

      const quoteId = await upsertDraftAndGetQuoteId();
      router.replace("/(app)/quotes/" + String(quoteId));
    } catch (e) {
      const msg = e && e.message ? e.message : "Could not open manual editor.";
      showAlert("Error", msg);
    } finally {
      setManualLoading(false);
    }
  };

  /* generate via start_quote_generation (queue + back to list) */
  const generateAIAndPDF = async () => {
    try {
      if (isFinalized) {
        showAlert("Locked", "Already generated.");
        return;
      }

      if (isBlank(jobSummary) || isBlank(jobDetails)) {
        showAlert(
          "Add job info",
          "Summary and details are required before generating a quote."
        );
        return;
      }

      Keyboard.dismiss();
      setGenLoading(true);

      if (!distanceMiles) {
        try {
          await autoCalcDistance();
        } catch (e) {
          // ignore, best-effort only
        }
      }

      const quoteId = await upsertDraftAndGetQuoteId();

      const userRes = await supabase.auth.getUser();
      const userData = userRes && userRes.data ? userRes.data : null;
      const user = userData && userData.user ? userData.user : null;
      if (!user) {
        throw new Error("Not signed in");
      }

      const tplCode = normalizeTemplateCode(templateCode);

      const jobDetailsPayload = {
        summary: jobSummary || "",
        details: jobDetails || "",
        travel: {
          distance_miles: num(distanceMiles, 0),
          round_trip_miles: num(distanceMiles, 0) * 2,
          travel_charge: num(travelCharge, 0),
        },
      };

      const body = {
        user_id: user.id,
        quote_id: quoteId,
        client_name: clientName || "Client",
        client_email: clientEmail || null,
        client_phone: clientPhone || null,
        client_address: clientAddress || null,
        site_address: sameAsBilling ? clientAddress : siteAddress || null,
        job_summary: jobSummary || "New job",
        job_details: jobDetailsPayload,
        distance_miles: num(distanceMiles, 0),
        travel_charge: num(travelCharge, 0),
        template_code: tplCode,
      };

      const resp = await supabase.functions.invoke("start_quote_generation", {
        body: body,
      });

      if (resp.error) {
        throw resp.error;
      }

      const data = resp.data || {};
      if (!data.ok) {
        throw new Error(
          data.error ||
          "Could not start quote generation. Please try again."
        );
      }

      Alert.alert(
        "Generating quote",
        "Your quote is being generated.\nWe will notify you when it is ready."
      );

      router.replace(quotesListHref);
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      if (msg.indexOf("duplicate key value violates unique constraint") >= 0) {
        showAlert(
          "Quote Error",
          "This quote number is already in use. Please try again."
        );
      } else {
        showAlert(
          "Error",
          msg || "Generation failed. Please check function logs."
        );
      }
    } finally {
      setGenLoading(false);
    }
  };

  /* validation */
  const validateStep1 = () => {
    const e = {};
    if (!clientName.trim()) e.clientName = "Client name is required";
    if (!clientAddress.trim()) e.clientAddress = "Billing address is required";
    if (!sameAsBilling && !siteAddress.trim()) {
      e.siteAddress = "Site address is required";
    }
    return e;
  };

  const validateStep3 = () => {
    const e = {};
    if (!jobSummary.trim()) e.jobSummary = "Job title is required";
    if (!jobDetails.trim()) e.jobDetails = "Job description is required";
    return e;
  };

  const getCurrentStepErrors = () =>
    step === 1 ? validateStep1() : step === 3 ? validateStep3() : {};

  const goNext = () => {
    const errors = getCurrentStepErrors();
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});
    next();
  };

  // ---------- UI sizing ----------
  const win = Dimensions.get("window");
  const width = win.width;
  const height = win.height;

  return (
    <View style={{ flex: 1, backgroundColor: BG }}>
      <StatusBar
        barStyle="dark-content"
        backgroundColor="#ffffff"
        translucent={false}
      />
      <View style={{ height: insets.top, backgroundColor: CARD }} />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => {
            if (step > 1) back();
            else router.back();
          }}
        >
          <Feather name="arrow-left" size={20} color={TEXT} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>
          {existing
            ? isFinalized
              ? "View Quote"
              : "Edit Quote"
            : "Create Quote"}
        </Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Content */}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
      >
        {/* Step progress */}
        <View style={styles.stepProgress}>
          <View style={styles.stepRow}>
            <Text style={styles.stepTitle}>{STEP_TITLES[step - 1]}</Text>
            <Text style={styles.stepCounter}>
              {"Step " + step + " of " + TOTAL_STEPS}
            </Text>
          </View>
          <View style={styles.progressTrack}>
            <View
              style={[
                styles.progressFill,
                {
                  width: String((step / TOTAL_STEPS) * 100) + "%",
                },
              ]}
            />
          </View>
        </View>

        {step === 1 && (
          <Step1ClientLocation
            clientName={clientName}
            setClientName={setClientName}
            clientEmail={clientEmail}
            setClientEmail={setClientEmail}
            clientPhone={clientPhone}
            setClientPhone={setClientPhone}
            clientAddress={clientAddress}
            setClientAddress={setClientAddress}
            siteAddress={siteAddress}
            setSiteAddress={setSiteAddress}
            sameAsBilling={sameAsBilling}
            setSameAsBilling={setSameAsBilling}
            setBillingOpen={setBillingOpen}
            setSiteOpen={setSiteOpen}
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
            jobSummary={jobSummary}
            setJobSummary={setJobSummary}
            jobDetails={jobDetails}
            setJobDetails={setJobDetails}
            remaining={remaining}
            jobLen={jobLen}
          />
        )}
      </ScrollView>

      {/* Action bar */}
      <View style={styles.actionBar}>
        {step < TOTAL_STEPS ? (
          <TouchableOpacity
            onPress={goNext}
            style={[styles.actionBtn, styles.primaryActionBtn]}
          >
            <Text style={[styles.actionBtnText, { color: "#fff" }]}>
              {step === 1
                ? "Next: Choose Template"
                : "Next: Job Details"}
            </Text>
          </TouchableOpacity>
        ) : (
          // Final step: show Manual vs AI side-by-side (Save Draft removed)
          <View style={{ flexDirection: "row", gap: 12 }}>
            <TouchableOpacity
              onPress={openManualEditor}
              style={[
                styles.actionBtn,
                {
                  flex: 1,
                  borderWidth: 1,
                  borderColor: BORDER,
                  backgroundColor: "#ffffff",
                },
              ]}
              disabled={manualLoading}
            >
              <Text style={styles.actionBtnText}>
                {manualLoading ? "Opening…" : "Manual quote"}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={generateAIAndPDF}
              style={[
                styles.actionBtn,
                styles.primaryActionBtn,
                { flex: 1 },
              ]}
              disabled={genLoading}
            >
              <Text
                style={[styles.actionBtnText, { color: "#fff" }]}
              >
                {genLoading ? "Creating…" : "AI quote"}
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* Address modals */}
      <CenteredEditor
        visible={billingOpen}
        onClose={() => setBillingOpen(false)}
      >
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

      <CenteredEditor
        visible={siteOpen}
        onClose={() => setSiteOpen(false)}
      >
        <AddressEditor
          title="Site address"
          GOOGLE={GOOGLE}
          initialText={siteAddress || clientAddress}
          onUse={(addr) => setSiteAddress(addr)}
          onClose={() => setSiteOpen(false)}
        />
      </CenteredEditor>
    </View>
  );
}

const styles = StyleSheet.create({
  ...baseStyles,
});