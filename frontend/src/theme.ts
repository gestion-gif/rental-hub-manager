import { Appearance, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

export type ThemePref = "system" | "light" | "dark";
export const THEME_PREF_KEY = "themePref";

export const lightColors = {
  surface: "#FFFFFF",
  onSurface: "#1C1C1E",
  surfaceSecondary: "#F2F2F7",
  onSurfaceSecondary: "#3A3A3C",
  surfaceTertiary: "#E5E5EA",
  onSurfaceTertiary: "#8E8E93",
  surfaceInverse: "#020830",
  onSurfaceInverse: "#FFFFFF",
  brand: "#020830",
  brandPrimary: "#0E2364",
  onBrandPrimary: "#FFFFFF",
  success: "#34C759",
  warning: "#FF9500",
  error: "#FF3B30",
  info: "#1EB8E0",
  border: "#E5E5EA",
  borderStrong: "#C7C7CC",
  divider: "#E5E5EA",
};

// Palette sombre assortie au bleu nuit du logo Casanéo
export const darkColors: typeof lightColors = {
  surface: "#0B1330",
  onSurface: "#F0F3FB",
  surfaceSecondary: "#151F47",
  onSurfaceSecondary: "#C9D0E6",
  surfaceTertiary: "#202C5C",
  onSurfaceTertiary: "#8E99BF",
  surfaceInverse: "#F0F3FB",
  onSurfaceInverse: "#0B1330",
  brand: "#020830",
  brandPrimary: "#4468F0",
  onBrandPrimary: "#FFFFFF",
  success: "#3DDC64",
  warning: "#FFA426",
  error: "#FF6B61",
  info: "#2BC8F0",
  border: "#243056",
  borderStrong: "#39477D",
  divider: "#243056",
};

function _syncInitialScheme(): "light" | "dark" {
  let pref: ThemePref = "system";
  // Sur le web, localStorage est synchrone → la préférence s'applique dès l'évaluation du module
  if (Platform.OS === "web" && typeof localStorage !== "undefined") {
    const v = localStorage.getItem(THEME_PREF_KEY);
    if (v === "light" || v === "dark" || v === "system") pref = v;
  }
  if (pref === "system") return Appearance.getColorScheme() === "dark" ? "dark" : "light";
  return pref;
}

// Objet MUTABLE : les valeurs sont remplacées (Object.assign) avant le rendu des écrans
export const colors = { ..._syncInitialScheme() === "dark" ? darkColors : lightColors };

export function applyThemePref(pref: ThemePref): "light" | "dark" {
  const scheme = pref === "system"
    ? (Appearance.getColorScheme() === "dark" ? "dark" : "light")
    : pref;
  Object.assign(colors, scheme === "dark" ? darkColors : lightColors);
  try {
    Appearance.setColorScheme(pref === "system" ? null : scheme);
  } catch {}
  return scheme;
}

export async function initTheme(): Promise<ThemePref> {
  let pref: ThemePref = "system";
  try {
    const v = await AsyncStorage.getItem(THEME_PREF_KEY);
    if (v === "light" || v === "dark" || v === "system") pref = v;
  } catch {}
  applyThemePref(pref);
  return pref;
}

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
};

export const radius = {
  sm: 6,
  md: 12,
  lg: 20,
  pill: 999,
};

export const font = {
  regular: "Geist-Regular",
  medium: "Geist-Medium",
  semibold: "Geist-SemiBold",
  bold: "Geist-Bold",
};

export const fontSize = {
  sm: 12,
  base: 14,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 30,
};

export type StatusKey =
  | "demande"
  | "confirmee"
  | "arrivee"
  | "depart"
  | "annulee";

export const STATUS: Record<
  StatusKey,
  { label: string; color: string; bg: string }
> = {
  demande: { label: "Demande", color: "#FF9500", bg: "#FFF4E5" },
  confirmee: { label: "Confirmée", color: "#2FB350", bg: "#E7F8EC" },
  arrivee: { label: "Arrivée", color: "#1E9BD7", bg: "#E4F4FC" },
  depart: { label: "Départ", color: "#8E8E93", bg: "#F2F2F7" },
  annulee: { label: "Annulée", color: "#FF3B30", bg: "#FEECEB" },
};

export const STATUS_ORDER: StatusKey[] = [
  "demande",
  "confirmee",
  "arrivee",
  "depart",
  "annulee",
];

export const HERO_IMAGE =
  "https://images.unsplash.com/photo-1628744448839-a475cc0e90c3?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NDQ2Mzl8MHwxfHNlYXJjaHwyfHxtb2Rlcm4lMjBjb3p5JTIwdmFjYXRpb24lMjByZW50YWwlMjBob3VzZSUyMGV4dGVyaW9yfGVufDB8fHx8MTc4NzI5MDMzM3ww&ixlib=rb-4.1.0&q=85";
