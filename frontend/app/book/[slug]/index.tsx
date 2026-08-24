import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, useWindowDimensions } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";

import { api, fileUrl } from "@/src/api";
import { colors, font, fontSize, radius, spacing } from "@/src/theme";

export default function PublicSiteHome() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { width } = useWindowDimensions();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    try { setData(await api.get(`/public/site/${slug}`)); }
    catch { setError(true); }
    setLoading(false);
  }, [slug]);
  useEffect(() => { load(); }, [load]);

  const cols = width >= 900 ? 3 : width >= 620 ? 2 : 1;
  const gap = spacing.md;
  const cardW = (Math.min(width, 1100) - spacing.lg * 2 - gap * (cols - 1)) / cols;

  if (loading) return <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} size="large" /></View>;
  if (error || !data) return (
    <View style={styles.center}>
      <Ionicons name="alert-circle-outline" size={40} color={colors.onSurfaceTertiary} />
      <Text style={styles.errText}>Ce site de réservation est indisponible.</Text>
    </View>
  );

  const company = data.company || {};
  const sc = data.showcase || {};

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: insets.bottom + 40 }} showsVerticalScrollIndicator={false}>
      {sc.enabled && sc.hero_photo ? (
        <View style={styles.showcaseHero}>
          <Image source={{ uri: fileUrl(sc.hero_photo) }} style={styles.showcaseImg} contentFit="cover" />
          <View style={styles.showcaseOverlay} />
          <View style={[styles.showcaseContent, { paddingTop: insets.top + spacing.xl }]}>
            {company.logo_path ? <Image source={{ uri: fileUrl(company.logo_path) }} style={styles.logoLight} contentFit="contain" /> : null}
            <Text style={styles.showcaseTitle}>{sc.title || company.name || "Nos hébergements"}</Text>
            {!!sc.intro && <Text style={styles.showcaseIntro}>{sc.intro}</Text>}
          </View>
        </View>
      ) : (
        <View style={[styles.hero, { paddingTop: insets.top + spacing.xl }]}>
          {company.logo_path ? <Image source={{ uri: fileUrl(company.logo_path) }} style={styles.logo} contentFit="contain" /> : null}
          <Text style={styles.brand}>{sc.title || company.name || "Nos hébergements"}</Text>
          <Text style={styles.tagline}>{sc.intro || "Réservez en direct, sans intermédiaire"}</Text>
        </View>
      )}

      <View style={[styles.wrap, { maxWidth: 1100, alignSelf: "center", width: "100%" }]}>
        <Text style={styles.sectionTitle}>{data.count} hébergement{data.count > 1 ? "s" : ""} disponible{data.count > 1 ? "s" : ""}</Text>
        <View style={[styles.grid, { gap }]}>
          {data.properties.map((p: any) => {
            const cover = p.photos?.[0] ? fileUrl(p.photos[0]) : (p.image_url || null);
            return (
              <Pressable key={p.id} testID={`site-prop-${p.id}`} onPress={() => router.push(`/book/${slug}/${p.id}`)} style={[styles.card, { width: cardW }]}>
                <View style={styles.cover}>
                  {cover ? <Image source={{ uri: cover }} style={styles.coverImg} contentFit="cover" /> : (
                    <View style={styles.coverPlaceholder}><Ionicons name="home-outline" size={30} color={colors.onSurfaceTertiary} /></View>
                  )}
                </View>
                <View style={styles.cardBody}>
                  <Text style={styles.cardName} numberOfLines={1}>{p.name}</Text>
                  {!!p.city && <Text style={styles.cardCity} numberOfLines={1}><Ionicons name="location-outline" size={12} color={colors.onSurfaceTertiary} /> {p.city}</Text>}
                  <View style={styles.cardMeta}>
                    <Text style={styles.metaItem}>{p.capacity} pers.</Text>
                    <Text style={styles.metaDot}>·</Text>
                    <Text style={styles.metaItem}>{p.bedrooms} ch.</Text>
                  </View>
                  <Text style={styles.price}>dès {Math.round(p.base_price)}€ <Text style={styles.priceUnit}>/ nuit</Text></Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.sm, backgroundColor: colors.surface, padding: spacing.lg },
  errText: { fontFamily: font.medium, fontSize: fontSize.base, color: colors.onSurfaceTertiary, textAlign: "center" },
  hero: { alignItems: "center", paddingBottom: spacing.xl, paddingHorizontal: spacing.lg, backgroundColor: "#2A6F9E" },
  logo: { width: 120, height: 54, marginBottom: spacing.sm },
  brand: { fontFamily: font.bold, fontSize: 26, color: "#fff", textAlign: "center" },
  tagline: { fontFamily: font.regular, fontSize: fontSize.base, color: "#D6E7F3", marginTop: 4 },
  showcaseHero: { height: 340, position: "relative" },
  showcaseImg: { ...StyleSheet.absoluteFillObject },
  showcaseOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(20,40,60,0.45)" },
  showcaseContent: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.lg },
  logoLight: { width: 130, height: 56, marginBottom: spacing.md },
  showcaseTitle: { fontFamily: font.bold, fontSize: 30, color: "#fff", textAlign: "center" },
  showcaseIntro: { fontFamily: font.regular, fontSize: fontSize.lg, color: "#EAF3FA", textAlign: "center", marginTop: spacing.sm, maxWidth: 560, lineHeight: 24 },
  wrap: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg },
  sectionTitle: { fontFamily: font.bold, fontSize: fontSize.lg, color: colors.onSurface, marginBottom: spacing.md },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, overflow: "hidden", marginBottom: spacing.md },
  cover: { height: 160, backgroundColor: colors.surfaceSecondary },
  coverImg: { width: "100%", height: "100%" },
  coverPlaceholder: { flex: 1, alignItems: "center", justifyContent: "center" },
  cardBody: { padding: spacing.md },
  cardName: { fontFamily: font.bold, fontSize: fontSize.lg, color: colors.onSurface },
  cardCity: { fontFamily: font.regular, fontSize: fontSize.sm, color: colors.onSurfaceTertiary, marginTop: 2 },
  cardMeta: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6 },
  metaItem: { fontFamily: font.regular, fontSize: fontSize.sm, color: colors.onSurfaceSecondary },
  metaDot: { color: colors.onSurfaceTertiary },
  price: { fontFamily: font.bold, fontSize: fontSize.lg, color: colors.brandPrimary, marginTop: 8 },
  priceUnit: { fontFamily: font.regular, fontSize: fontSize.sm, color: colors.onSurfaceTertiary },
});
