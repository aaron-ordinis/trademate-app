// lib/nav.js
// Centralized, future-proof route helpers for Expo Router.
// If a param is required, helpers throw early to avoid silent bad links.

const requireNavRouteParam = (v, name) => {
  const s = String(v ?? "").trim();
  if (!s) throw new Error(`Missing ${name}`);
  return s;
};

// Reserved path segments that are implemented as file-based routes.
// Prevent IDs from colliding with these to avoid navigation bugs.
const RESERVED_SEGMENTS = new Set([
  "create",
  "preview",
  "send",
  "wizard",
  "payment",
  "documents",
  "expenses",
]);

// Use this for values that will appear in the PATH (not query).
// Ensures non-empty, not a reserved word, and returns an encoded segment.
const requireUniqueNavRouteParam = (v, name) => {
  const s = requireNavRouteParam(v, name);
  if (RESERVED_SEGMENTS.has(s.toLowerCase())) {
    throw new Error(`'${s}' is a reserved segment and cannot be used as a ${name}`);
  }
  return encodeURIComponent(s);
};
// Root groups
export const appRootHref  = "/(app)";
export const authRootHref = "/(auth)";
export const tabsRootHref = "/(app)/(tabs)";

// ----- Tabs -----
export const jobsTabHref     = "/(app)/(tabs)/jobs";
export const quotesTabHref   = "/(app)/(tabs)/quotes";
export const invoicesTabHref = "/(app)/(tabs)/invoices";

// ----- Jobs -----
export const jobsHref        = "/(app)/jobs";
export const jobCreateHref   = () => "/(app)/jobs/create";
export const jobHref         = (id) => `/(app)/jobs/${requireUniqueNavRouteParam(id, "id")}`;
export const jobDocsHref     = (id) => `/(app)/jobs/${requireUniqueNavRouteParam(id, "id")}/documents`;
export const jobExpensesHref = (id) => `/(app)/jobs/${requireUniqueNavRouteParam(id, "id")}/expenses`;

// ----- Quotes ----- (tab-first routing + transparent modal flow)
export const quotesHref      = "/(app)/(tabs)/quotes"; // tab route
export const quotesListHref  = "/(app)/(tabs)/quotes";
export const quoteCreateHref = () => "/(app)/quotes/create"; // transparent modal over list

// Path-based detail (ensure no collision with /quotes/preview)
export const quoteHref       = (id) => `/(app)/quotes/${requireUniqueNavRouteParam(id, "id")}`;

// Query-param preview (avoids preview-as-id issues). Supports optional name for filename.
export const quotePreviewHref = (id, name) => {
  const idParam = encodeURIComponent(requireNavRouteParam(id, "id"));
  const base = `/(app)/quotes/preview?id=${idParam}`;
  return name ? `${base}&name=${encodeURIComponent(String(name))}` : base;
};

// Helpers for transparent modal flow
export const openQuoteCreate = (router) => {
  router.push(quoteCreateHref());
};

export const closeModalOrBack = (router, fallbackHref = quotesListHref) => {
  try {
    if (router.canGoBack?.()) router.back();
    else router.replace(fallbackHref);
  } catch {
    router.replace(fallbackHref);
  }
};

// ----- Invoices ----- (tab-first routing + wizard modal)
export const invoicesHref        = "/(app)/(tabs)/invoices";

export const invoiceHref         = (id) =>
  `/(app)/invoices/${requireUniqueNavRouteParam(id, "id")}`;
export const invoiceViewHref     = (id) => invoiceHref(id);

// Create → wizard (optional job/client)
export const invoiceCreateHref   = ({ jobId = null, clientId = null } = {}) => {
  const qs = [];
  if (jobId) qs.push(`job_id=${encodeURIComponent(jobId)}`);
  if (clientId) qs.push(`client_id=${encodeURIComponent(clientId)}`);
  return `/(app)/invoices/wizard${qs.length ? "?" + qs.join("&") : ""}`;
};

// Single-file screens use query params
export const invoiceSendHref     = (id, merged = false) =>
  `/(app)/invoices/send?id=${encodeURIComponent(requireUniqueNavRouteParam(id, "id"))}&merged=${merged ? "true" : "false"}`;

export const invoicePaymentHref  = (id) =>
  `/(app)/invoices/payment?id=${encodeURIComponent(requireUniqueNavRouteParam(id, "id"))}`;

export const invoicePreviewHref  = (id) =>
  `/(app)/invoices/preview?id=${encodeURIComponent(requireUniqueNavRouteParam(id, "id"))}`;

// Wizard alias (back-compat)
export const invoiceWizardHref   = ({ jobId = null, clientId = null } = {}) =>
  invoiceCreateHref({ jobId, clientId });

// ----- Account / Profile / Settings / Billing / Support -----
export const accountHref   = "/(app)/account";
export const profileHref   = "/(app)/profile";
export const settingsHref  = "/(app)/settings";
export const billingHref   = "/(app)/billing";
export const supportHref   = "/(app)/support";

// NEW: Support Chat (in-app messaging)
export const supportChatHref = "/(app)/support/chat";

// NEW: Dedicated Legal screen (if using separate settings/legal screen)
export const legalHref = "/(app)/settings/legal";

// Settings → Reminders
export const remindersHref = "/(app)/settings/reminders";

// ----- Onboarding -----
export const onboardingHref = "/(app)/onboarding";

// ----- Auth -----
export const loginHref  = "/(auth)/login";
export const signupHref = "/(auth)/register";
export const forgotHref = "/(auth)/reset";

// ----- External Legal URLs -----
export const privacyWebUrl = "https://tradematequotes.com/privacy";
export const termsWebUrl   = "https://tradematequotes.com/terms";
export const cookiesWebUrl = "https://tradematequotes.com/cookies";

// Utility: safe tab switching by key
export const tabByKey = (key) => {
  switch ((key || "").toLowerCase()) {
    case "jobs":     return jobsTabHref;
    case "quotes":   return quotesTabHref;
    case "invoices": return invoicesTabHref;
    default: throw new Error(`Unknown tab key: ${key}`);
  }
};