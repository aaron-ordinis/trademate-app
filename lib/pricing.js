// lib/pricing.js

// Central place for pricing used by the Account screen (and checkout payloads).
// Keep values in GBP; UI formats them.

export const ACCOUNT_PRICE = {
  monthlyGBP: 4.99,
  yearlyGBP: 47.99,
};

// Back-compat for any legacy references that still read globalThis.ACCOUNT_PRICE
// (harmless for new code; avoids crashes on old screens).
if (typeof globalThis !== 'undefined') {
  globalThis.ACCOUNT_PRICE = globalThis.ACCOUNT_PRICE ?? ACCOUNT_PRICE;
}