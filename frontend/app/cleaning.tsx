import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, RefreshControl } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import dayjs from "dayjs";
import "dayjs/locale/fr";
dayjs.locale("fr");

import { api } from "@/src/api";
import { useAuth } from "@/src/context/AuthContext";
import { guestLabel } from "@/src/permissions";
import { colors, font, fontSize, radius, spacing } from "@/src/theme";

export default function CleaningSchedule() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const [anchor, setAnchor] = useState(dayjs());
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api.get(`/cleaning-schedule?day=${anchor.format("YYYY-MM-DD")}`);
      setData(d);
    } catch {}
    setLoading(false);
    setRefreshing(false);
  }, [anchor]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const isToday = anchor.isSame(dayjs(), "day");

  const SectionHead = ({ icon, title, count, top }: any) => (
    <View style={[styles.sectionHead, top && { marginTop: spacing.xl }]}>
      <Ionicons name={icon} size={18} color={colors.onSurface} />
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.count}><Text style={styles.countTxt}>{count}</Text></View>
    </View>
  );

  const TaskCard = ({ item, kind }: any) => (
    <Pressable testID={`${kind}-${item.id}`} onPress={() => router.push(`/intervention-form?id=${item.id}`)} style={[styles.card, item.done && styles.cardDone]}>
      <View style={styles.cardRow}>
        <Ionicons name={item.done ? "checkmark-circle" : "ellipse-outline"} size={20} color={item.done ? colors.success : colors.onSurfaceTertiary} />
        <Text style={[styles.prop, item.done && styles.propDone]} numberOfLines={1}>{item.property_name}</Text>
        <Ionicons name="chevron-forward" size={16} color={colors.onSurfaceTertiary} />
      </View>
      <Text style={styles.sub} numberOfLines={2}>
        {item.done ? "Terminé" : "À faire"}{item.description ? ` · ${item.description}` : ""}{item.intervenant ? ` · ${item.intervenant}` : ""}
      </Text>
    </Pressable>
  );

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="cleaning-back" onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Ménage du jour</Text>
        <View style={{ width: 34 }} />
      </View>

      {/* Date nav */}
      <View style={styles.dateNav}>
        <Pressable testID="cleaning-prev" onPress={() => setAnchor((a) => a.subtract(1, "day"))} style={styles.navBtn}>
          <Ionicons name="chevron-back" size={18} color={colors.onSurface} />
        </Pressable>
        <View style={{ alignItems: "center" }}>
          <Text style={styles.dateLabel}>{anchor.format("dddd D MMMM")}</Text>
          {!isToday && (
            <Pressable testID="cleaning-today" onPress={() => setAnchor(dayjs())}>
              <Text style={styles.todayLink}>Revenir à aujourd'hui</Text>
            </Pressable>
          )}
        </View>
        <Pressable testID="cleaning-next" onPress={() => setAnchor((a) => a.add(1, "day"))} style={styles.navBtn}>
          <Ionicons name="chevron-forward" size={18} color={colors.onSurface} />
        </Pressable>
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 60 }} color={colors.brandPrimary} />
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 40 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
        >
          {/* Départs */}
          <SectionHead icon="log-out-outline" title="Départs" count={data?.departures?.length || 0} />
          {data?.departures?.length ? data.departures.map((d: any) => (
            <View key={d.id} style={styles.card} testID={`departure-${d.id}`}>
              <View style={styles.cardRow}>
                <Ionicons name="business-outline" size={16} color={colors.onSurfaceSecondary} />
                <Text style={styles.prop} numberOfLines={1}>{d.property_name}</Text>
                {!!d.checkout_time && <View style={styles.timeTag}><Text style={styles.timeTxt}>{d.checkout_time}</Text></View>}
              </View>
              <Text style={styles.sub}>Départ · {guestLabel(user, d.guest_name)}</Text>
            </View>
          )) : <Text style={styles.empty}>Aucun départ ce jour.</Text>}

          {/* Arrivées – caution à vérifier */}
          <SectionHead icon="log-in-outline" title="Arrivées · caution à vérifier" count={data?.arrivals?.length || 0} top />
          {data?.arrivals?.length ? data.arrivals.map((a: any) => (
            <Pressable key={a.id} style={styles.card} testID={`arrival-${a.id}`} onPress={() => router.push(`/reservation-form?id=${a.id}`)}>
              <View style={styles.cardRow}>
                <Ionicons name="business-outline" size={16} color={colors.onSurfaceSecondary} />
                <Text style={styles.prop} numberOfLines={1}>{a.property_name}</Text>
                {!!a.checkin_time && <View style={styles.timeTag}><Text style={styles.timeTxt}>{a.checkin_time}</Text></View>}
              </View>
              <Text style={styles.sub}>Arrivée · {guestLabel(user, a.guest_name)}</Text>
              <View style={[styles.depBadge, a.deposit_collected ? styles.depOk : styles.depWarn]}>
                <Ionicons name={a.deposit_collected ? "shield-checkmark" : "shield-outline"} size={13} color={a.deposit_collected ? "#2FB350" : "#FF9500"} />
                <Text style={[styles.depText, { color: a.deposit_collected ? "#2FB350" : "#FF9500" }]}>
                  {a.deposit_collected
                    ? `Caution reçue${a.deposit_amount ? ` · ${a.deposit_amount} €` : ""}`
                    : "Caution à vérifier (lien envoyé 2 j avant)"}
                </Text>
              </View>
            </Pressable>
          )) : <Text style={styles.empty}>Aucune arrivée ce jour.</Text>}

          {/* Ménages */}
          <SectionHead icon="sparkles-outline" title="Ménages à faire" count={data?.cleanings?.length || 0} top />
          {data?.cleanings?.length ? data.cleanings.map((c: any) => <TaskCard key={c.id} item={c} kind="cleaning" />)
            : <Text style={styles.empty}>Aucun ménage prévu ce jour.</Text>}

          {/* Interventions */}
          <SectionHead icon="construct-outline" title="Interventions" count={data?.interventions?.length || 0} top />
          {data?.interventions?.length ? data.interventions.map((c: any) => <TaskCard key={c.id} item={c} kind="intervention" />)
            : <Text style={styles.empty}>Aucune intervention ce jour.</Text>}

          {/* Remises de clés */}
          <SectionHead icon="key-outline" title="Remises de clés" count={data?.key_handovers?.length || 0} top />
          {data?.key_handovers?.length ? data.key_handovers.map((c: any) => <TaskCard key={c.id} item={c} kind="key" />)
            : <Text style={styles.empty}>Aucune remise de clés ce jour.</Text>}

          {/* Cautions à encaisser */}
          <SectionHead icon="cash-outline" title="Cautions à encaisser" count={data?.cautions?.length || 0} top />
          {data?.cautions?.length ? data.cautions.map((c: any) => (
            <Pressable key={c.id} testID={`caution-${c.id}`} onPress={() => router.push(`/intervention-form?id=${c.id}`)} style={[styles.card, c.caution_debited && styles.cardDone]}>
              <View style={styles.cardRow}>
                <Ionicons name={c.caution_debited ? "checkmark-circle" : "ellipse-outline"} size={20} color={c.caution_debited ? colors.success : colors.onSurfaceTertiary} />
                <Text style={[styles.prop, c.caution_debited && styles.propDone]} numberOfLines={1}>{c.property_name}</Text>
                {!!c.caution_amount && <View style={styles.timeTag}><Text style={styles.timeTxt}>{c.caution_amount} €</Text></View>}
                <Ionicons name="chevron-forward" size={16} color={colors.onSurfaceTertiary} />
              </View>
              <Text style={styles.sub}>{c.caution_debited ? "Encaissée / vérifiée" : "À vérifier"}{c.intervenant ? ` · ${c.intervenant}` : ""}</Text>
            </Pressable>
          )) : <Text style={styles.empty}>Aucune caution à encaisser ce jour.</Text>}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  backBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  title: { fontFamily: font.bold, fontSize: fontSize.xl, color: colors.onSurface },
  dateNav: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  navBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  dateLabel: { fontFamily: font.bold, fontSize: fontSize.lg, color: colors.onSurface, textTransform: "capitalize" },
  todayLink: { fontFamily: font.medium, fontSize: fontSize.sm, color: colors.brandPrimary, marginTop: 2 },
  sectionHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.md },
  sectionTitle: { fontFamily: font.bold, fontSize: fontSize.lg, color: colors.onSurface },
  count: { backgroundColor: colors.brandPrimary, borderRadius: radius.pill, minWidth: 22, height: 22, paddingHorizontal: 6, alignItems: "center", justifyContent: "center" },
  countTxt: { fontFamily: font.semibold, fontSize: fontSize.sm, color: colors.onBrandPrimary },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.sm },
  cardDone: { backgroundColor: colors.surfaceSecondary, borderColor: colors.surfaceSecondary },
  cardRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  prop: { flex: 1, fontFamily: font.semibold, fontSize: fontSize.lg, color: colors.onSurface },
  propDone: { textDecorationLine: "line-through", color: colors.onSurfaceTertiary },
  sub: { fontFamily: font.regular, fontSize: fontSize.base, color: colors.onSurfaceTertiary, marginTop: 4, marginLeft: 28 },
  timeTag: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 3 },
  timeTxt: { fontFamily: font.semibold, fontSize: fontSize.sm, color: colors.onSurfaceSecondary },
  depBadge: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8, marginLeft: 28, alignSelf: "flex-start", borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 4 },
  depOk: { backgroundColor: "#E7F8EC" },
  depWarn: { backgroundColor: "#FFF4E5" },
  depText: { fontFamily: font.semibold, fontSize: fontSize.sm },
  empty: { fontFamily: font.regular, fontSize: fontSize.base, color: colors.onSurfaceTertiary, paddingVertical: spacing.md },
});
