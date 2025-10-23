// ui.js — Shared theme + base styles for TradeMate create flows (quotes, invoices, etc.)

import { StyleSheet, Platform } from "react-native";

/* ---------- Brand Tokens ---------- */
export const BRAND = "#2a86ff";
export const TEXT = "#0b1220";
export const MUTED = "#6b7280";
export const CARD = "#ffffff";
export const BG = "#ffffff";
export const BORDER = "#e6e9ee";
export const OK = "#16a34a";
export const DISABLED = "#9ca3af";
export const WARN = "#dc2626";
export const AMBER = "#b45309";

/* ---------- Shared Styles ---------- */
export const styles = StyleSheet.create({
  /* ---------- Header ---------- */
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

  /* ---------- Progress Bar ---------- */
  stepProgress: { marginBottom: 16 },
  stepRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  stepTitle: { color: TEXT, fontWeight: "800", fontSize: 16 },
  stepCounter: { color: MUTED, fontWeight: "600", fontSize: 12 },
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

  /* ---------- Card ---------- */
  card: {
    backgroundColor: CARD,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: BORDER,
    marginBottom: 16,
    ...Platform.select({
      ios: {
        shadowColor: "#0b1220",
        shadowOpacity: 0.06,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 4 },
      },
      android: { elevation: 3 },
    }),
  },
  cardTitle: { color: TEXT, fontWeight: "900", fontSize: 16, marginBottom: 8 },

  /* ---------- Inputs ---------- */
  label: { color: TEXT, fontWeight: "700", marginBottom: 6 },
  hint: { color: MUTED, fontSize: 12, marginTop: 4 },
  input: {
    backgroundColor: "#ffffff",
    borderColor: BORDER,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 10,
    color: TEXT,
    marginBottom: 10,
  },
  inputError: {
    borderColor: WARN,
    borderWidth: 2,
    backgroundColor: "#fef2f2",
  },
  errorText: {
    color: WARN,
    fontSize: 12,
    fontWeight: "600",
    marginTop: -4,
    marginBottom: 8,
    marginLeft: 4,
  },

  /* ---------- Action Bar ---------- */
  actionBar: {
    backgroundColor: CARD,
    borderTopWidth: 1,
    borderTopColor: BORDER,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
    ...Platform.select({
      ios: {
        shadowColor: "#0b1220",
        shadowOpacity: 0.08,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: -4 },
      },
      android: { elevation: 8 },
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
  },
  primaryActionBtn: { backgroundColor: BRAND, borderColor: BRAND },
  actionBtnText: { fontSize: 15, fontWeight: "900", color: TEXT },

  /* ---------- Template Carousel ---------- */
  carousel: {
    flexDirection: "row",
    flexWrap: "nowrap",
    gap: 16,
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 4,
  },
  carouselItem: {
    borderRadius: 18,
    overflow: "hidden",
    backgroundColor: "#fff",
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 6,
    elevation: 2,
    justifyContent: "center",
    alignItems: "center",
  },
});