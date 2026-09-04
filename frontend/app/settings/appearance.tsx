import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, Platform, DevSettings, Alert } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { colors, font, fontSize, radius, spacing, THEME_PREF_KEY, applyThemePref, ThemePref } from "@/src/theme";
import { LANG_PREF_KEY, setLangPref, LangPref } from "@/src/i18n";

const OPTIONS: { key: ThemePref; icon: any; title: string; sub: string }[] = [
  { key: "system", icon: "phone-portrait-outline", title: "Automatique", sub: "Suit le réglage clair/sombre de votre téléphone" },
  { key: "light", icon: "sunny-outline", title: "Clair", sub: "Fond blanc, toujours" },
  { key: "dark", icon: "moon-outline", title: "Sombre", sub: "Bleu nuit Casanéo, toujours" },
];

const LANGS: { key: LangPref; icon: any; title: string; sub: string }[] = [
  { key: "auto", icon: "phone-portrait-outline", title: "Automatique", sub: "Suit la langue de votre téléphone" },
  { key: "fr", icon: "flag-outline", title: "Français", sub: "Interface en français" },
  { key: "en", icon: "globe-outline", title: "English", sub: "Interface in English" },
];

async function reloadApp() {
  if (Platform.OS === "web") {
    if (typeof window !== "undefined") window.location.reload();
    return;
  }
  try {
    DevSettings.reload();
  } catch {
    Alert.alert("Thème enregistré", "Fermez puis rouvrez l’app pour appliquer le nouveau thème partout.");
  }
}

export default function AppearanceScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [pref, setPref] = useState<ThemePref>("system");
  const [langP, setLangP] = useState<LangPref>("auto");

  useEffect(() => {
    AsyncStorage.getItem(THEME_PREF_KEY).then((v) => {
      if (v === "light" || v === "dark" || v === "system") setPref(v);
    });
    AsyncStorage.getItem(LANG_PREF_KEY).then((v) => {
      if (v === "fr" || v === "en" || v === "auto") setLangP(v);
    });
  }, []);

  async function selectLang(p: LangPref) {
    if (p === langP) return;
    setLangP(p);
    await setLangPref(p);
    setTimeout(reloadApp, 250);
  }

  async function select(p: ThemePref) {
    if (p === pref) return;
    setPref(p);
    await AsyncStorage.setItem(THEME_PREF_KEY, p);
    applyThemePref(p);
    setTimeout(reloadApp, 250);
  }

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="appearance-back" onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Apparence</Text>
        <View style={{ width: 34 }} />
      </View>

      <View style={{ padding: spacing.lg }}>
        <Text style={styles.group}>Thème</Text>
        {OPTIONS.map((o) => {
          const active = pref === o.key;
          return (
            <Pressable
              key={o.key}
              testID={`theme-${o.key}`}
              onPress={() => select(o.key)}
              style={[styles.option, active && styles.optionActive]}
            >
              <View style={[styles.iconWrap, active && { backgroundColor: colors.brandPrimary }]}>
                <Ionicons name={o.icon} size={20} color={active ? colors.onBrandPrimary : colors.onSurfaceSecondary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.optTitle}>{o.title}</Text>
                <Text style={styles.optSub}>{o.sub}</Text>
              </View>
              <Ionicons
                name={active ? "radio-button-on" : "radio-button-off"}
                size={22}
                color={active ? colors.brandPrimary : colors.onSurfaceTertiary}
              />
            </Pressable>
          );
        })}
        <Text style={[styles.group, { marginTop: spacing.lg }]}>Langue / Language</Text>
        {LANGS.map((o) => {
          const active = langP === o.key;
          return (
            <Pressable
              key={o.key}
              testID={`lang-${o.key}`}
              onPress={() => selectLang(o.key)}
              style={[styles.option, active && styles.optionActive]}
            >
              <View style={[styles.iconWrap, active && { backgroundColor: colors.brandPrimary }]}>
                <Ionicons name={o.icon} size={20} color={active ? colors.onBrandPrimary : colors.onSurfaceSecondary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.optTitle}>{o.title}</Text>
                <Text style={styles.optSub}>{o.sub}</Text>
              </View>
              <Ionicons
                name={active ? "radio-button-on" : "radio-button-off"}
                size={22}
                color={active ? colors.brandPrimary : colors.onSurfaceTertiary}
              />
            </Pressable>
          );
        })}
        <Text style={styles.hint}>L’app se recharge automatiquement pour appliquer le thème ou la langue.</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  backBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  title: { fontFamily: font.bold, fontSize: fontSize.xl, color: colors.onSurface },
  group: { fontFamily: font.bold, fontSize: fontSize.base, color: colors.onSurfaceTertiary, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: spacing.sm },
  option: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.sm },
  optionActive: { borderColor: colors.brandPrimary, backgroundColor: colors.brandPrimary + "0A" },
  iconWrap: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  optTitle: { fontFamily: font.semibold, fontSize: fontSize.lg, color: colors.onSurface },
  optSub: { fontFamily: font.regular, fontSize: fontSize.sm, color: colors.onSurfaceTertiary, marginTop: 2 },
  hint: { fontFamily: font.regular, fontSize: fontSize.sm, color: colors.onSurfaceTertiary, marginTop: spacing.md, textAlign: "center" },
});
