import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  RefreshControl,
  ActivityIndicator,
} from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import dayjs from "dayjs";
import "dayjs/locale/fr";
dayjs.locale("fr");

import { useAuth } from "@/src/context/AuthContext";
import { api } from "@/src/api";
import StatusBadge from "@/src/components/StatusBadge";
import { getInterventionType } from "@/src/interventionTypes";
import { colors, font, fontSize, radius, spacing } from "@/src/theme";

type Dash = {
  occupancy_rate: number;
  revenue_month: number;
  total_properties: number;
  upcoming_count: number;
  current_stays: any[];
  arrivals_today: any[];
  departures_today: any[];
  interventions: any[];
};

export default function Dashboard() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, signOut } = useAuth();
  const [data, setData] = useState<Dash | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api.get("/dashboard");
      setData(d);
    } catch {}
    setLoading(false);
    setRefreshing(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const firstName = (user?.name || "").split(" ")[0] || "hôte";

  return (
    <View style={styles.container}>
      <ScrollView
        testID="dashboard-scroll"
        contentContainerStyle={{
          paddingTop: insets.top + spacing.md,
          paddingBottom: 110,
          paddingHorizontal: spacing.lg,
        }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              load();
            }}
          />
        }
      >
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.hello}>Bonjour,</Text>
            <Text style={styles.name}>{firstName} 👋</Text>
          </View>
          <Pressable testID="signout-button" onPress={signOut} style={styles.avatar}>
            {user?.picture ? (
              <Image source={{ uri: user.picture }} style={styles.avatarImg} />
            ) : (
              <Ionicons name="person" size={20} color={colors.onSurfaceSecondary} />
            )}
          </Pressable>
        </View>

        {loading ? (
          <ActivityIndicator style={{ marginTop: 60 }} color={colors.brandPrimary} />
        ) : (
          <>
            <View style={styles.statsGrid}>
              <StatCard
                label="Taux d'occupation"
                value={`${data?.occupancy_rate ?? 0}%`}
                icon="pie-chart"
                tint={colors.info}
              />
              <StatCard
                label="Revenus du mois"
                value={`${data?.revenue_month ?? 0} €`}
                icon="cash"
                tint={colors.success}
              />
              <StatCard
                label="Logements"
                value={`${data?.total_properties ?? 0}`}
                icon="business"
                tint={colors.warning}
              />
              <StatCard
                label="À venir"
                value={`${data?.upcoming_count ?? 0}`}
                icon="time"
                tint={colors.brandPrimary}
              />
            </View>

            <Section title="Arrivées du jour">
              {data?.arrivals_today?.length ? (
                data.arrivals_today.map((r) => (
                  <StayCard key={r.id} r={r} onPress={() => router.push(`/reservation-form?id=${r.id}`)} />
                ))
              ) : (
                <EmptyRow text="Aucune arrivée aujourd'hui" />
              )}
            </Section>

            <Section title="Interventions">
              {data?.interventions?.length ? (
                data.interventions.map((iv) => (
                  <InterventionCard key={iv.id} iv={iv} onPress={() => router.push(`/intervention-form?id=${iv.id}`)} />
                ))
              ) : (
                <EmptyRow text="Aucune intervention prévue" />
              )}
            </Section>

            <Section title="Séjours en cours">
              {data?.current_stays?.length ? (
                data.current_stays.map((r) => (
                  <StayCard key={r.id} r={r} onPress={() => router.push(`/reservation-form?id=${r.id}`)} />
                ))
              ) : (
                <EmptyRow text="Aucun séjour en cours" />
              )}
            </Section>

            <Section title="Départs du jour">
              {data?.departures_today?.length ? (
                data.departures_today.map((r) => (
                  <StayCard key={r.id} r={r} onPress={() => router.push(`/reservation-form?id=${r.id}`)} />
                ))
              ) : (
                <EmptyRow text="Aucun départ aujourd'hui" />
              )}
            </Section>

            <Pressable
              testID="ai-banner"
              onPress={() => router.push("/(tabs)/assistant")}
              style={styles.aiBanner}
            >
              <View style={styles.aiIcon}>
                <Ionicons name="sparkles" size={20} color={colors.onBrandPrimary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.aiTitle}>Assistant IA</Text>
                <Text style={styles.aiSub}>
                  Optimisez vos tarifs et répondez aux voyageurs en un clic
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.onSurfaceTertiary} />
            </Pressable>
          </>
        )}
      </ScrollView>
    </View>
  );
}

function StatCard({ label, value, icon, tint }: any) {
  return (
    <View style={styles.statCard} testID={`stat-${label}`}>
      <View style={[styles.statIcon, { backgroundColor: tint + "1A" }]}>
        <Ionicons name={icon} size={18} color={tint} />
      </View>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function Section({ title, children }: any) {
  return (
    <View style={{ marginTop: spacing.xl }}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function StayCard({ r, onPress }: any) {
  return (
    <Pressable onPress={onPress} style={styles.stayCard} testID={`stay-card-${r.id}`}>
      <View style={styles.stayTop}>
        <View style={styles.stayPropRow}>
          <Ionicons name="business-outline" size={15} color={colors.onSurfaceSecondary} />
          <Text style={styles.stayProp} numberOfLines={1}>{r.property_name}</Text>
        </View>
        <StatusBadge status={r.status} />
      </View>
      <Text style={styles.stayGuest}>{r.guest_name}</Text>
      <View style={styles.stayMetaRow}>
        <View style={styles.stayMeta}>
          <Ionicons name="calendar-outline" size={14} color={colors.onSurfaceTertiary} />
          <Text style={styles.stayMetaText}>
            {dayjs(r.check_in).format("DD MMM")} → {dayjs(r.check_out).format("DD MMM")}
          </Text>
        </View>
        <View style={styles.stayMeta}>
          <Ionicons name="people-outline" size={14} color={colors.onSurfaceTertiary} />
          <Text style={styles.stayMetaText}>{r.guests} voy.</Text>
        </View>
        <View style={styles.otaTag}>
          <Text style={styles.otaText}>{r.platform || "Direct"}</Text>
        </View>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.onSurfaceTertiary} style={styles.stayChevron} />
    </Pressable>
  );
}

function InterventionCard({ iv, onPress }: any) {
  const t = getInterventionType(iv.kind);
  return (
    <Pressable onPress={onPress} style={[styles.stayCard, { borderLeftWidth: 4, borderLeftColor: t.color }]} testID={`intervention-card-${iv.id}`}>
      <View style={styles.stayTop}>
        <View style={styles.stayPropRow}>
          <Ionicons name="business-outline" size={15} color={colors.onSurfaceSecondary} />
          <Text style={styles.stayProp} numberOfLines={1}>{iv.property_name}</Text>
        </View>
        <View style={[styles.ivBadge, { backgroundColor: t.color + "22" }]}>
          <View style={[styles.ivDot, { backgroundColor: t.color }]} />
          <Text style={[styles.ivBadgeText, { color: t.color }]}>{t.label}</Text>
        </View>
      </View>
      {!!iv.description && <Text style={styles.stayGuest}>{iv.description}</Text>}
      <View style={styles.stayMetaRow}>
        <View style={styles.stayMeta}>
          <Ionicons name="calendar-outline" size={14} color={colors.onSurfaceTertiary} />
          <Text style={styles.stayMetaText}>{dayjs(iv.date).format("ddd DD MMM")}</Text>
        </View>
        {!!iv.intervenant && (
          <View style={styles.stayMeta}>
            <Ionicons name="person-outline" size={14} color={colors.onSurfaceTertiary} />
            <Text style={styles.stayMetaText}>{iv.intervenant}</Text>
          </View>
        )}
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.onSurfaceTertiary} style={styles.stayChevron} />
    </Pressable>
  );
}

function EmptyRow({ text }: { text: string }) {
  return (
    <View style={styles.emptyRow}>
      <Text style={styles.emptyText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.lg,
  },
  hello: { fontFamily: font.regular, fontSize: fontSize.lg, color: colors.onSurfaceTertiary },
  name: { fontFamily: font.bold, fontSize: fontSize.xxl, color: colors.onSurface },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.surfaceSecondary,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  avatarImg: { width: 42, height: 42 },
  statsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  statCard: {
    width: "47.5%",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  statIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.md,
  },
  statValue: { fontFamily: font.bold, fontSize: fontSize.xxl, color: colors.onSurface },
  statLabel: { fontFamily: font.regular, fontSize: fontSize.sm, color: colors.onSurfaceTertiary, marginTop: 2 },
  sectionTitle: {
    fontFamily: font.semibold,
    fontSize: fontSize.lg,
    color: colors.onSurface,
    marginBottom: spacing.md,
  },
  stayCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  stayTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 },
  stayPropRow: { flexDirection: "row", alignItems: "center", gap: 5, flex: 1, marginRight: spacing.sm },
  stayProp: { fontFamily: font.medium, fontSize: fontSize.base, color: colors.onSurfaceSecondary, flex: 1 },
  stayGuest: { fontFamily: font.bold, fontSize: fontSize.lg, color: colors.onSurface, marginBottom: spacing.sm },
  stayMetaRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, flexWrap: "wrap" },
  stayMeta: { flexDirection: "row", alignItems: "center", gap: 4 },
  stayMetaText: { fontFamily: font.medium, fontSize: fontSize.base, color: colors.onSurfaceSecondary },
  otaTag: {
    backgroundColor: colors.surfaceSecondary,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.sm,
  },
  otaText: { fontFamily: font.semibold, fontSize: fontSize.sm, color: colors.onSurfaceSecondary },
  ivBadge: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: spacing.sm, paddingVertical: 5, borderRadius: radius.pill },
  ivDot: { width: 7, height: 7, borderRadius: 999 },
  ivBadgeText: { fontFamily: font.semibold, fontSize: 12 },
  stayChevron: { position: "absolute", right: spacing.md, top: spacing.lg },
  emptyRow: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    padding: spacing.lg,
    alignItems: "center",
  },
  emptyText: { fontFamily: font.regular, fontSize: fontSize.base, color: colors.onSurfaceTertiary },
  aiBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surfaceInverse,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginTop: spacing.xl,
  },
  aiIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  aiTitle: { fontFamily: font.semibold, fontSize: fontSize.lg, color: colors.onSurfaceInverse },
  aiSub: { fontFamily: font.regular, fontSize: fontSize.sm, color: "rgba(255,255,255,0.7)", marginTop: 2 },
});
