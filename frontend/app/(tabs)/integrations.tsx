import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Alert,
  TextInput,
  Linking,
} from "react-native";
import Ionicons from "@react-native-vector-icons/ionicons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import * as Clipboard from "expo-clipboard";

import { api } from "@/src/api";
import { MenuButton } from "@/src/components/MenuButton";
import { HelpButton } from "@/src/components/HelpButton";
import { Picker } from "@/src/components/Picker";
import { colors, font, fontSize, radius, spacing } from "@/src/theme";

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL as string;
const TURNO_URL = "https://turno.com/fr-fr";
const LIVRET_URL = "https://livretaccueil.com/";
const LIVRET_CAUTION_URL = "https://livretaccueil.com/account/caution";
const GYG_URL = "https://partner.getyourguide.com";

export default function Integrations() {
  const insets = useSafeAreaInsets();
  const [properties, setProperties] = useState<any[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [exportUrl, setExportUrl] = useState("");
  const [welcomeUrl, setWelcomeUrl] = useState("");
  const [savingWelcome, setSavingWelcome] = useState(false);
  const [gygUrl, setGygUrl] = useState("");
  const [savingGyg, setSavingGyg] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const props = await api.get("/properties");
      setProperties(props);
      if (props.length) {
        const cur = props.find((p: any) => p.id === selected) || props[0];
        selectProperty(cur);
      }
    } catch {}
    try {
      const p = await api.get("/preferences");
      setGygUrl(p.getyourguide_url || "");
    } catch {}
    setLoading(false);
  }, [selected]);
  useFocusEffect(useCallback(() => { load(); }, []));

  async function selectProperty(prop: any) {
    setSelected(prop.id);
    setWelcomeUrl(prop.welcome_book_url || "");
    try {
      const ex = await api.get(`/properties/${prop.id}/ical-export`);
      setExportUrl(`${BASE}${ex.path}`);
    } catch {
      setExportUrl("");
    }
  }

  async function copyExport() {
    if (!exportUrl) return;
    await Clipboard.setStringAsync(exportUrl);
    Alert.alert("Lien copié", "Collez ce lien iCal dans Turno (Ajouter une propriété → Synchroniser via iCal) pour planifier les ménages à chaque départ.");
  }

  async function saveWelcome() {
    if (savingWelcome || !selected) return;
    const prop = properties.find((p) => p.id === selected);
    if (!prop) return;
    setSavingWelcome(true);
    try {
      const body = { ...prop, welcome_book_url: welcomeUrl.trim() };
      const updated = await api.put(`/properties/${selected}`, body);
      setProperties((ps) => ps.map((p) => (p.id === selected ? updated : p)));
      Alert.alert("Enregistré", "Le lien du livret d'accueil a été enregistré. Il sera envoyé automatiquement aux voyageurs via la variable {welcome_book} dans vos messages automatiques.");
    } catch {
      Alert.alert("Erreur", "Enregistrement impossible.");
    }
    setSavingWelcome(false);
  }

  async function saveGyg() {
    if (savingGyg) return;
    setSavingGyg(true);
    try {
      await api.put("/preferences", { getyourguide_url: gygUrl.trim() });
      Alert.alert("Enregistré", "Votre lien GetYourGuide est enregistré. Insérez-le dans vos messages avec la variable {activites}.");
    } catch {
      Alert.alert("Erreur", "Enregistrement impossible.");
    }
    setSavingGyg(false);
  }

  const selectedProp = properties.find((p) => p.id === selected);

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <View style={[styles.titleRow, { justifyContent: "space-between" }]}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}>
            <MenuButton />
            <Text style={styles.title}>Intégrations</Text>
          </View>
          <HelpButton screen="integrations" />
        </View>
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 60 }} color={colors.brandPrimary} />
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 100 }}
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.intro}>Connectez Casanéo à vos outils</Text>
          <Text style={styles.introSub}>
            Reliez vos services de ménage et vos livrets d'accueil à chacun de vos logements.
          </Text>

          {properties.length === 0 ? (
            <Text style={styles.empty}>Ajoutez d'abord un logement pour configurer vos intégrations.</Text>
          ) : (
            <>
              <View style={{ marginTop: spacing.lg }}>
                <Picker
                  label="Logement"
                  testID="integrations-property-picker"
                  title="Choisir un logement"
                  value={selected}
                  items={properties.map((p) => ({ id: p.id, name: p.name }))}
                  onSelect={(id) => { const p = properties.find((x) => x.id === id); if (p) selectProperty(p); }}
                />
              </View>

              {/* ---------------- TURNO ---------------- */}
              <View style={styles.serviceCard}>
                <View style={styles.serviceHead}>
                  <View style={[styles.serviceIcon, { backgroundColor: "#00C2A8" }]}>
                    <Ionicons name="sparkles" size={20} color="#fff" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.serviceName}>Turno · Ménages</Text>
                    <Text style={styles.serviceDesc}>Planification automatique des ménages à chaque départ</Text>
                  </View>
                </View>

                <Text style={styles.step}>
                  <Text style={styles.stepNum}>1. </Text>Copiez le lien iCal de ce logement.
                </Text>
                <View style={styles.urlBox}>
                  <Text style={styles.urlText} numberOfLines={2} selectable>{exportUrl || "…"}</Text>
                </View>
                <Pressable testID="turno-copy-ical" onPress={copyExport} style={styles.primaryBtn}>
                  <Ionicons name="copy-outline" size={16} color={colors.onBrandPrimary} />
                  <Text style={styles.primaryText}>Copier le lien iCal</Text>
                </Pressable>

                <Text style={[styles.step, { marginTop: spacing.lg }]}>
                  <Text style={styles.stepNum}>2. </Text>Dans Turno, ajoutez ce logement et collez le lien iCal pour synchroniser les départs.
                </Text>
                <Pressable testID="turno-open" onPress={() => Linking.openURL(TURNO_URL)} style={styles.secondaryBtn}>
                  <Ionicons name="open-outline" size={16} color={colors.brandPrimary} />
                  <Text style={styles.secondaryText}>Ouvrir Turno</Text>
                </Pressable>
              </View>

              {/* ---------------- LIVRET D'ACCUEIL ---------------- */}
              <View style={styles.serviceCard}>
                <View style={styles.serviceHead}>
                  <View style={[styles.serviceIcon, { backgroundColor: "#1E6F8C" }]}>
                    <Ionicons name="book" size={20} color="#fff" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.serviceName}>Livret d'accueil / Caution</Text>
                    <Text style={styles.serviceDesc}>Envoyez le livret et gérez la caution par logement</Text>
                  </View>
                </View>

                <Text style={styles.step}>
                  <Text style={styles.stepNum}>1. </Text>Créez le livret d'accueil (et la caution) de ce logement sur livretaccueil.com.
                </Text>
                <Pressable testID="livret-open" onPress={() => Linking.openURL(LIVRET_URL)} style={styles.secondaryBtn}>
                  <Ionicons name="open-outline" size={16} color={colors.brandPrimary} />
                  <Text style={styles.secondaryText}>Ouvrir livretaccueil.com</Text>
                </Pressable>
                <Pressable testID="livret-caution" onPress={() => Linking.openURL(LIVRET_CAUTION_URL)} style={[styles.secondaryBtn, { marginTop: spacing.sm }]}>
                  <Ionicons name="shield-checkmark-outline" size={16} color={colors.brandPrimary} />
                  <Text style={styles.secondaryText}>Gérer les cautions</Text>
                </Pressable>

                <Text style={[styles.step, { marginTop: spacing.lg }]}>
                  <Text style={styles.stepNum}>2. </Text>Collez le lien du livret ci-dessous. Il sera envoyé automatiquement aux voyageurs via <Text style={styles.code}>{"{welcome_book}"}</Text>.
                </Text>
                <TextInput
                  testID="livret-url-input"
                  value={welcomeUrl}
                  onChangeText={setWelcomeUrl}
                  placeholder="https://livretaccueil.com/..."
                  placeholderTextColor={colors.onSurfaceTertiary}
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={styles.input}
                />
                <Pressable testID="livret-save" onPress={saveWelcome} disabled={savingWelcome} style={[styles.primaryBtn, savingWelcome && { opacity: 0.6 }]}>
                  {savingWelcome ? <ActivityIndicator color={colors.onBrandPrimary} /> : (
                    <>
                      <Ionicons name="save-outline" size={16} color={colors.onBrandPrimary} />
                      <Text style={styles.primaryText}>Enregistrer le lien</Text>
                    </>
                  )}
                </Pressable>
                {!!selectedProp?.welcome_book_url && (
                  <View style={styles.linkedBadge}>
                    <Ionicons name="checkmark-circle" size={14} color={colors.success} />
                    <Text style={styles.linkedText}>Livret relié à ce logement</Text>
                  </View>
                )}
              </View>

              <Text style={styles.footNote}>
                Turno et Livret d'accueil sont des services tiers. Casanéo se connecte via un lien iCal (Turno) et via le lien du livret (Livret d'accueil).
              </Text>
            </>
          )}

          {/* ---------------- GETYOURGUIDE ---------------- */}
          <View style={styles.serviceCard}>
            <View style={styles.serviceHead}>
              <View style={[styles.serviceIcon, { backgroundColor: "#FF5533" }]}>
                <Ionicons name="ticket" size={20} color="#fff" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.serviceName}>GetYourGuide · Activités</Text>
                <Text style={styles.serviceDesc}>Recommandez des activités locales à vos voyageurs et touchez une commission</Text>
              </View>
            </View>
            <Text style={styles.step}>
              Rejoignez le programme partenaire GetYourGuide pour proposer excursions et activités à vos voyageurs, et générer des revenus complémentaires.
            </Text>
            <Pressable testID="gyg-open" onPress={() => Linking.openURL(GYG_URL)} style={styles.secondaryBtn}>
              <Ionicons name="open-outline" size={16} color={colors.brandPrimary} />
              <Text style={styles.secondaryText}>Ouvrir GetYourGuide Partner</Text>
            </Pressable>
            <Text style={[styles.step, { marginTop: spacing.lg }]}>
              Collez votre lien affilié GetYourGuide. Il sera inséré dans vos messages via la variable <Text style={styles.code}>{"{activites}"}</Text>.
            </Text>
            <TextInput
              testID="gyg-url-input"
              value={gygUrl}
              onChangeText={setGygUrl}
              placeholder="https://www.getyourguide.com/?partner_id=..."
              placeholderTextColor={colors.onSurfaceTertiary}
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.input}
            />
            <Pressable testID="gyg-save" onPress={saveGyg} disabled={savingGyg} style={[styles.primaryBtn, savingGyg && { opacity: 0.6 }]}>
              {savingGyg ? <ActivityIndicator color={colors.onBrandPrimary} /> : (
                <>
                  <Ionicons name="save-outline" size={16} color={colors.onBrandPrimary} />
                  <Text style={styles.primaryText}>Enregistrer le lien</Text>
                </>
              )}
            </Pressable>
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  titleRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  title: { fontFamily: font.bold, fontSize: fontSize.xxl, color: colors.onSurface },
  intro: { fontFamily: font.bold, fontSize: fontSize.xxl, color: colors.onSurface },
  introSub: { fontFamily: font.regular, fontSize: fontSize.base, color: colors.onSurfaceTertiary, marginTop: 4, lineHeight: 20 },
  empty: { fontFamily: font.regular, fontSize: fontSize.base, color: colors.onSurfaceTertiary, textAlign: "center", marginTop: 40 },
  serviceCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginTop: spacing.lg,
  },
  serviceHead: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginBottom: spacing.lg },
  serviceIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  serviceName: { fontFamily: font.bold, fontSize: fontSize.lg, color: colors.onSurface },
  serviceDesc: { fontFamily: font.regular, fontSize: fontSize.sm, color: colors.onSurfaceTertiary, marginTop: 2 },
  step: { fontFamily: font.regular, fontSize: fontSize.base, color: colors.onSurfaceSecondary, lineHeight: 20, marginBottom: spacing.sm },
  stepNum: { fontFamily: font.bold, color: colors.onSurface },
  code: { fontFamily: font.semibold, color: colors.brandPrimary },
  urlBox: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md },
  urlText: { fontFamily: font.regular, fontSize: fontSize.sm, color: colors.onSurface },
  input: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: 12, fontFamily: font.regular, fontSize: fontSize.base, color: colors.onSurface, marginBottom: spacing.md },
  primaryBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 12 },
  primaryText: { fontFamily: font.semibold, fontSize: fontSize.base, color: colors.onBrandPrimary },
  secondaryBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, backgroundColor: colors.brandPrimary + "12", borderWidth: 1, borderColor: colors.brandPrimary + "33", borderRadius: radius.md, paddingVertical: 12 },
  secondaryText: { fontFamily: font.semibold, fontSize: fontSize.base, color: colors.brandPrimary },
  linkedBadge: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: spacing.md },
  linkedText: { fontFamily: font.medium, fontSize: fontSize.sm, color: colors.success },
  footNote: { fontFamily: font.regular, fontSize: fontSize.sm, color: colors.onSurfaceTertiary, marginTop: spacing.xl, lineHeight: 18, textAlign: "center" },
});
