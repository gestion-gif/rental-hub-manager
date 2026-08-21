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

import { useAuth } from "@/src/context/AuthContext";
import { api } from "@/src/api";
import StatusBadge from "@/src/components/StatusBadge";
import { colors, font, fontSize, radius, spacing } from "@/src/theme";

type Dash = {
  occupancy_rate: number;
  revenue_month: number;
  total_properties: number;
  upcoming_count: number;
  arrivals_today: any[];
  departures_today: any[];
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
                  <FlowCard key={r.id} r={r} kind="Arrivée" onPress={() => router.push(`/reservation-form?id=${r.id}`)} />
                ))
              ) : (
                <EmptyRow text="Aucune arrivée aujourd'hui" />
              )}
            </Section>

            <Section title="Départs du jour">
              {data?.departures_today?.length ? (
                data.departures_today.map((r) => (
                  <FlowCard key={r.id} r={r} kind="Départ" onPress={() => router.push(`/reservation-form?id=${r.id}`)} />
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

function FlowCard({ r, kind, onPress }: any) {
  return (
    <Pressable onPress={onPress} style={styles.flowCard}>
      <View style={{ flex: 1 }}>
        <Text style={styles.flowGuest}>{r.guest_name}</Text>
        <Text style={styles.flowProp}>{r.property_name}</Text>
      </View>
      <StatusBadge status={r.status} />
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
  flowCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    padding: spacing.lg,
    marginBottom: spacing.sm,
  },
  flowGuest: { fontFamily: font.semibold, fontSize: fontSize.lg, color: colors.onSurface },
  flowProp: { fontFamily: font.regular, fontSize: fontSize.base, color: colors.onSurfaceTertiary, marginTop: 2 },
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
