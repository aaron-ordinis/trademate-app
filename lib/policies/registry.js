// app/lib/policies/registry.js
// Single JS registry (avoids Metro TS hiccups) + fixed acceptance helpers.

import AsyncStorage from "@react-native-async-storage/async-storage";
import { PRIVACY_POLICY_MD, PRIVACY_POLICY_VERSION } from "./privacy";
import { TERMS_MD, TERMS_VERSION } from "./terms";

// ---- Policy list ----
export const POLICIES = [
  {
    name: "privacy",
    title: "Privacy Policy",
    version: PRIVACY_POLICY_VERSION,
    content: PRIVACY_POLICY_MD,
    url: "https://tradematequotes.com/privacy",
  },
  {
    name: "terms",
    title: "Terms & Conditions",
    version: TERMS_VERSION,
    content: TERMS_MD,
    url: "https://tradematequotes.com/terms",
  },
];

// ---- Storage keys ----
const verKey = (name) => `policy.accepted.version.${name}`;
const atKey  = (name) => `policy.accepted.at.${name}`;

// Normalize version to string (AsyncStorage values must be strings)
const V = (v) => (v == null ? "" : String(v));

// ---- Public API ----
export async function getAcceptedVersion(name) {
  try {
    return (await AsyncStorage.getItem(verKey(name))) || null;
  } catch {
    return null;
  }
}

export async function recordAcceptance(name, version) {
  try {
    await AsyncStorage.multiSet([
      [verKey(name), V(version)],
      [atKey(name), new Date().toISOString()],
    ]);
  } catch {
    // swallow; acceptance will be re-requested next time
  }
}

export async function needsAcceptance(name, currentVersion) {
  try {
    const v = await getAcceptedVersion(name);
    return v !== V(currentVersion);
  } catch {
    return true; // if storage failed, err on the side of asking
  }
}

export async function getPendingPolicies() {
  const pending = [];
  for (const p of POLICIES) {
    if (await needsAcceptance(p.name, p.version)) pending.push(p);
  }
  return pending;
}

export async function acceptAllPending(pending) {
  await Promise.all(
    (pending || []).map((p) => recordAcceptance(p.name, p.version))
  );
}

/** Check if a specific policy is accepted for the given version */
export async function isPolicyAccepted(name, version) {
  const v = await getAcceptedVersion(name);
  return v === V(version);
}

/** Get a shallow copy of all policies */
export function getAllPolicies() {
  return [...POLICIES];
}

/** (Optional) Debug helper to clear all policy acceptances */
export async function _clearAllAcceptances() {
  try {
    const keys = [];
    for (const p of POLICIES) {
      keys.push(verKey(p.name), atKey(p.name));
    }
    await AsyncStorage.multiRemove(keys);
  } catch {}
}