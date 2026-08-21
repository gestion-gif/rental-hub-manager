import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
} from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";

import { api } from "@/src/api";
import { Field, PrimaryButton } from "@/src/components/ui";
import { colors, font, fontSize, radius, spacing } from "@/src/theme";

const FALLBACK =
  "https://images.unsplash.com/photo-1628744448839-a475cc0e90c3?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NDQ2Mzl8MHwxfHNlYXJjaHwyfHxtb2Rlcm4lMjBjb3p5JTIwdmFjYXRpb24lMjByZW50YWwlMjBob3VzZSUyMGV4dGVyaW9yfGVufDB8fHx8MTc4NzI5MDMzM3ww&ixlib=rb-4.1.0&q=85";

const ICAL_PLATFORMS = ["Airbnb", "Booking.com", "Vrbo", "Autre"];

export default function PropertyDetail() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [prop, setProp] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // season inputs
  const [sName, setSName] = useState("");
  const [sStart, setSStart] = useState("");
  const [sEnd, setSEnd] = useState("");
  const [sPrice, setSPrice] = useState("");
  // ical inputs
  const [icalPlatform, setIcalPlatform] = useState("Airbnb");
  const [icalUrl, setIcalUrl] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const p = await api.get(`/properties/${id}`);
      setProp(p);
    } catch {}
    setLoading(false);
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function persist(next: any) {
    setProp(next);
    const payload = {
      name: next.name,
      location: next.location,
      image_url: next.image_url,
      base_price: next.base_price,
      capacity: next.capacity,
      bedrooms: next.bedrooms,
      seasons: next.seasons || [],
      ical_links: next.ical_links || [],
    };
    await api.put(`/properties/${id}`, payload);
  }

  function addSeason() {
    if (!sName.trim() || !sPrice) return;
    const season = {
      id: `${Date.now()}`,
      name: sName.trim(),
      start_date: sStart,
      end_date: sEnd,
      price: parseFloat(sPrice) || 0,
    };
    persist({ ...prop, seasons: [...(prop.seasons || []), season] });
    setSName(""); setSStart(""); setSEnd(""); setSPrice("");
  }

  function removeSeason(sid: string) {
    persist({ ...prop, seasons: prop.seasons.filter((s: any) => s.id !== sid) });
  }

  function addIcal() {
    if (!icalUrl.trim()) return;
    const link = { platform: icalPlatform, url: icalUrl.trim() };
    persist({ ...prop, ical_links: [...(prop.ical_links || []), link] });
    setIcalUrl("");
  }

  function removeIcal(idx: number) {
    persist({ ...prop, ical_links: prop.ical_links.filter((_: any, i: number) => i !== idx) });
  }

  async function syncIcal() {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const r = await api.post(`/properties/${id}/sync`);
      let msg = `${r.imported} importée(s), ${r.updated} mise(s) à jour`;
      if (r.errors && r.errors.length) msg += ` · ${r.errors.join(" · ")}`;
      setSyncMsg(msg);
      await load();
    } catch {
      setSyncMsg("Échec de la synchronisation. Vérifiez le lien iCal.");
    }
    setSyncing(false);
  }

  async function deleteProperty() {
    await api.del(`/properties/${id}`);
    router.back();
  }

  if (loading || !prop) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.brandPrimary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <KeyboardAwareScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
        bottomOffset={20}
        showsVerticalScrollIndicator={false}
      >
        <View>
          <Image source={{ uri: prop.image_url || FALLBACK }} style={styles.hero} contentFit="cover" />
          <LinearGradient colors={["rgba(0,0,0,0.4)", "transparent", "rgba(28,28,30,0.7)"]} style={StyleSheet.absoluteFill} />
          <Pressable testID="back-btn" onPress={() => router.back()} style={[styles.backBtn, { top: insets.top + spacing.sm }]}>
            <Ionicons name="chevron-back" size={22} color="#fff" />
          </Pressable>
          <Pressable testID="edit-property" onPress={() => router.push(`/property-form?id=${id}`)} style={[styles.editBtn, { top: insets.top + spacing.sm }]}>
            <Ionicons name="create-outline" size={18} color="#fff" />
          </Pressable>
          <View style={styles.heroText}>
            <Text style={styles.heroName}>{prop.name}</Text>
            {!!prop.location && <Text style={styles.heroLoc}>{prop.location}</Text>}
          </View>
        </View>

        <View style={styles.body}>
          <View style={styles.statsRow}>
            <Stat icon="cash-outline" value={`${prop.base_price} €`} label="Prix de base" />
            <Stat icon="bed-outline" value={`${prop.bedrooms}`} label="Chambres" />
            <Stat icon="people-outline" value={`${prop.capacity}`} label="Capacité" />
          </View>

          {/* Seasonal pricing */}
          <Text style={styles.sectionTitle}>Tarifs par saison</Text>
          {(prop.seasons || []).map((s: any) => (
            <View key={s.id} style={styles.listItem} testID={`season-${s.id}`}>
              <View style={{ flex: 1 }}>
                <Text style={styles.itemTitle}>{s.name}</Text>
                <Text style={styles.itemSub}>
                  {s.start_date || "—"} → {s.end_date || "—"}
                </Text>
              </View>
              <Text style={styles.itemPrice}>{s.price} €</Text>
              <Pressable testID={`remove-season-${s.id}`} onPress={() => removeSeason(s.id)} style={styles.trash}>
                <Ionicons name="trash-outline" size={18} color={colors.error} />
              </Pressable>
            </View>
          ))}
          <View style={styles.addBox}>
            <Field label="Nom de la saison" testID="season-name" value={sName} onChangeText={setSName} placeholder="Haute saison" />
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Field label="Début" testID="season-start" value={sStart} onChangeText={setSStart} placeholder="AAAA-MM-JJ" />
              </View>
              <View style={{ flex: 1 }}>
                <Field label="Fin" testID="season-end" value={sEnd} onChangeText={setSEnd} placeholder="AAAA-MM-JJ" />
              </View>
            </View>
            <Field label="Prix (€/nuit)" testID="season-price" value={sPrice} onChangeText={setSPrice} keyboardType="decimal-pad" placeholder="180" />
            <PrimaryButton testID="add-season" label="Ajouter la saison" onPress={addSeason} variant="secondary" />
          </View>

          {/* iCal sync */}
          <Text style={styles.sectionTitle}>Synchronisation (iCal)</Text>
          <Text style={styles.sectionHint}>
            Collez le lien iCal exporté depuis Airbnb, Booking.com ou Vrbo pour synchroniser les disponibilités.
          </Text>
          {(prop.ical_links || []).map((l: any, i: number) => (
            <View key={i} style={styles.listItem} testID={`ical-${i}`}>
              <Ionicons name="link-outline" size={18} color={colors.info} />
              <View style={{ flex: 1, marginLeft: spacing.sm }}>
                <Text style={styles.itemTitle}>{l.platform}</Text>
                <Text style={styles.itemSub} numberOfLines={1}>{l.url}</Text>
              </View>
              <Pressable testID={`remove-ical-${i}`} onPress={() => removeIcal(i)} style={styles.trash}>
                <Ionicons name="trash-outline" size={18} color={colors.error} />
              </Pressable>
            </View>
          ))}
          <View style={styles.addBox}>
            <Text style={styles.label}>Plateforme</Text>
            <View style={styles.platformRow}>
              {ICAL_PLATFORMS.map((p) => (
                <Pressable
                  key={p}
                  testID={`ical-platform-${p}`}
                  onPress={() => setIcalPlatform(p)}
                  style={[styles.pill, icalPlatform === p && styles.pillActive]}
                >
                  <Text style={[styles.pillText, icalPlatform === p && styles.pillTextActive]}>{p}</Text>
                </Pressable>
              ))}
            </View>
            <Field label="Lien iCal" testID="ical-url" value={icalUrl} onChangeText={setIcalUrl} placeholder="https://...ics" autoCapitalize="none" />
            <PrimaryButton testID="add-ical" label="Ajouter le lien" onPress={addIcal} variant="secondary" />
          </View>

          {(prop.ical_links || []).length > 0 && (
            <View style={styles.syncBox}>
              <PrimaryButton
                testID="sync-ical"
                label="Synchroniser maintenant"
                onPress={syncIcal}
                loading={syncing}
                icon={<Ionicons name="sync" size={16} color={colors.onBrandPrimary} />}
              />
              {!!syncMsg && (
                <Text style={styles.syncMsg} testID="sync-result">{syncMsg}</Text>
              )}
            </View>
          )}

          <PrimaryButton
            testID="ai-pricing-link"
            label="Suggestions de prix par IA"
            onPress={() => router.push("/(tabs)/assistant")}
            style={{ marginTop: spacing.xl }}
            icon={<Ionicons name="sparkles" size={16} color={colors.onBrandPrimary} />}
          />
          <PrimaryButton
            testID="delete-property"
            label="Supprimer le logement"
            onPress={deleteProperty}
            variant="danger"
            style={{ marginTop: spacing.md, backgroundColor: colors.surfaceSecondary }}
          />
        </View>
      </KeyboardAwareScrollView>
    </View>
  );
}

function Stat({ icon, value, label }: any) {
  return (
    <View style={styles.stat}>
      <Ionicons name={icon} size={18} color={colors.onSurfaceSecondary} />
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  hero: { width: "100%", height: 260 },
  backBtn: {
    position: "absolute",
    left: spacing.lg,
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "rgba(0,0,0,0.35)",
    alignItems: "center",
    justifyContent: "center",
  },
  editBtn: {
    position: "absolute",
    right: spacing.lg,
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "rgba(0,0,0,0.35)",
    alignItems: "center",
    justifyContent: "center",
  },
  heroText: { position: "absolute", bottom: spacing.lg, left: spacing.lg, right: spacing.lg },
  heroName: { fontFamily: font.bold, fontSize: 26, color: "#fff" },
  heroLoc: { fontFamily: font.regular, fontSize: fontSize.lg, color: "rgba(255,255,255,0.9)", marginTop: 2 },
  body: { padding: spacing.lg },
  statsRow: { flexDirection: "row", gap: spacing.md, marginBottom: spacing.md },
  stat: {
    flex: 1,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: "center",
    gap: 4,
  },
  statValue: { fontFamily: font.bold, fontSize: fontSize.lg, color: colors.onSurface },
  statLabel: { fontFamily: font.regular, fontSize: 11, color: colors.onSurfaceTertiary },
  sectionTitle: { fontFamily: font.semibold, fontSize: fontSize.lg, color: colors.onSurface, marginTop: spacing.xl, marginBottom: spacing.md },
  sectionHint: { fontFamily: font.regular, fontSize: fontSize.base, color: colors.onSurfaceTertiary, marginBottom: spacing.md, marginTop: -spacing.sm },
  listItem: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  itemTitle: { fontFamily: font.semibold, fontSize: fontSize.base, color: colors.onSurface },
  itemSub: { fontFamily: font.regular, fontSize: fontSize.sm, color: colors.onSurfaceTertiary, marginTop: 2 },
  itemPrice: { fontFamily: font.bold, fontSize: fontSize.lg, color: colors.onSurface, marginRight: spacing.sm },
  trash: { padding: 6 },
  addBox: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginTop: spacing.sm,
  },
  row: { flexDirection: "row", gap: spacing.md },
  label: { fontFamily: font.medium, fontSize: fontSize.base, color: colors.onSurfaceSecondary, marginBottom: spacing.sm },
  platformRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.lg },
  pill: {
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pillActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  pillText: { fontFamily: font.medium, fontSize: fontSize.base, color: colors.onSurfaceSecondary },
  pillTextActive: { color: colors.onBrandPrimary },
  syncBox: { marginTop: spacing.md },
  syncMsg: {
    fontFamily: font.medium,
    fontSize: fontSize.base,
    color: colors.onSurfaceSecondary,
    marginTop: spacing.md,
    textAlign: "center",
  },
});
