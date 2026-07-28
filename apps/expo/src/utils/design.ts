import { Platform } from "react-native";

export const C = {
  bg: "#0A0C10",
  surface: "#161B22",
  fg: "#C9D1D9",
  muted: "#8B949E",
  border: "#30363D",
  input: "#161B22",

  info: "#58A6FF",
  infoBg: "rgba(88,166,255,0.15)",
  success: "#3FB950",
  successBg: "rgba(63,185,80,0.15)",
  warning: "#D29922",
  warningBg: "rgba(210,153,34,0.15)",
  critical: "#F85149",
  criticalBg: "rgba(248,81,73,0.15)",

  orange: "#D29922",
  orangeBg: "rgba(210,153,34,0.15)",

  /** Accent for anchor/event/overnight-zone markers (GitHub-dark purple). */
  accentPurple: "#A371F7",

  placeholder: "#484f58",
  white: "#fff",

  chipBg: "#30363D",
  chipText: "#C9D1D9",
} as const;

/** Cold-tone avatar palette for members and segments. */
export const PALETTE = [
  "#58A6FF", // info blue
  "#3FB950", // success green
  "#A78BFA", // violet
  "#79C0FF", // light blue
  "#56D4DD", // cyan
  "#7EE787", // mint
  "#BC8CFF", // lavender
  "#39D2C0", // teal
  "#6CB6FF", // sky
  "#8B8FFF", // indigo
] as const;

export const R = {
  sm: 2,
  md: 4,
} as const;

export const mono = Platform.OS === "ios" ? "Menlo" : "monospace";
