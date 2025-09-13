// lib/nav.js
// Centralized, future-proof route helpers for Expo Router.
// If a param is required, helpers throw early to avoid silent bad links.

const _navReq = (v, name) => { if (!v) throw new Error(`Missing ${name}`); return v; };

// Root groups
export const appRootHref   = "/(app)";
export const authRootHref  = "/(auth)";
export const tabsRootHref  = "/(app)/(tabs)";

// ----- Tabs -----
export const jobsTabHref     = "/(app)/(tabs)/jobs";
export const quotesTabHref   = "/(app)/(tabs)/quotes";
export const invoicesTabHref = "/(app)/(tabs)/invoices";

// ----- Jobs -----
export const jobsHref        = "/(app)/jobs";
export const jobCreateHref   = () => "/(app)/jobs/create"; // ← function (was string)
export const jobHref         = (id) => `/(app)/jobs/${_navReq(id, "id")}`;
export const jobDocsHref     = (id) => `/(app)/jobs/${_navReq(id, "id")}/documents`;
export const jobExpensesHref = (id) => `/(app)/jobs/${_navReq(id, "id")}/expenses`;

// ----- Quotes -----
export const quotesHref       = "/(app)/quotes";
export const quotesListHref   = "/(app)/quotes/list";
export const quoteCreateHref  = () => "/(app)/quotes/create"; // ← function (for consistency)
export const quoteHref        = (id) => `/(app)/quotes/${_navReq(id, "id")}`;
export const quotePreviewHref = (id) => `/(app)/quotes/${_navReq(id, "id")}/preview`;

// ----- Invoices -----
export const invoicesHref       = "/(app)/invoices";
export const invoiceCreateHref  = () => "/(app)/invoices/create"; // ← function (for consistency)
export const invoiceHref        = (id) => `/(app)/invoices/${_navReq(id, "id")}`;

// ----- Account / Profile / Settings / Billing / Support -----
export const accountHref  = "/(app)/account";
export const profileHref  = "/(app)/profile";
export const settingsHref = "/(app)/settings";
export const billingHref  = "/(app)/billing";
export const supportHref  = "/(app)/support";

// ----- Onboarding -----
export const onboardingHref = "/(app)/onboarding";

// ----- Auth (if present) -----
export const loginHref  = "/(auth)/login";
export const signupHref = "/(auth)/signup";
export const forgotHref = "/(auth)/forgot";

// Utility: safe tab switching by key
export const tabByKey = (key) => {
  switch ((key || "").toLowerCase()) {
    case "jobs": return jobsTabHref;
    case "quotes": return quotesTabHref;
    case "invoices": return invoicesTabHref;
    default: throw new Error(`Unknown tab key: ${key}`);
  }
};