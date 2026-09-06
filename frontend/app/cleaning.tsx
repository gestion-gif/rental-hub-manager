import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, RefreshControl, Alert, Modal } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import dayjs from "dayjs";
import "dayjs/locale/fr";


import { api } from "@/src/api";
import { useAuth } from "@/src/context/AuthContext";
import { guestLabel, canModify } from "@/src/permissions";
import { colors, font, fontSize, radius, spacing } from "@/src/theme";

export default function CleaningSchedule() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const [anchor, setAnchor] = useState(dayjs());
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<string>("");
  const [rescheduleItem, setRescheduleItem] = useState<any>(null);

  async function rescheduleTo(dateStr: string) {
    const item = rescheduleItem;
    if (!item) return;
    setRescheduleItem(null);
    setBusy(item.id);
    try {
      await api.patch(`/interventions/${item.id}/reschedule`, { date: dateStr });
      Alert.alert(item.kind === "cleaning" ? "Ménage décalé" : "Tâche décalée", `${item.property_name} → ${dayjs(dateStr).format("dddd D MMMM")}`);
      load();
    } catch (e: any) {
      Alert.alert("Impossible de décaler", String(e?.message || "Erreur"));
    }
    setBusy("");
  }

  const load = useCallback(async () => {
    try {
      const d = await api.get(`/cleaning-schedule?day=${anchor.format("YYYY-MM-DD")}`);
      setData(d);
    } catch {}
    setLoading(false);
    setRefreshing(false);
  }, [anchor]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function setCaution(id: string, debited: boolean) {
    if (busy) return;
    setBusy(id);
    try {
      await api.patch(`/interventions/${id}/caution`, { debited, done: true });
      setData((d: any) => ({
        ...d,
        cautions: (d.cautions || []).map((c: any) => c.id === id ? { ...c, caution_debited: debited, done: true } : c),
      }));
    } catch {
      Alert.alert("Erreur", "Action impossible.");
    }
    setBusy("");
  }

  async function toggleDone(item: any, listKey: string) {
    if (busy) return;
    setBusy(item.id);
    try {
      await api.patch(`/interventions/${item.id}/done`, { done: !item.done });
      setData((d: any) => ({
        ...d,
        [listKey]: (d[listKey] || []).map((x: any) => x.id === item.id ? { ...x, done: !item.done } : x),
      }));
    } catch {
      Alert.alert("Erreur", "Action impossible.");
    }
    setBusy("");
  }

  const TaskCard = ({ item, kind, listKey }: any) => (
    <Pressable testID={`${kind}-${item.id}`} onPress={() => toggleDone(item, listKey)} disabled={busy === item.id} style={[styles.card, item.done && styles.cardDone]}>
      <View style={styles.cardRow}>
        <Ionicons name={item.done ? "checkmark-circle" : "ellipse-outline"} size={22} color={item.done ? colors.success : colors.onSurfaceTertiary} />
        <Text style={[styles.prop, item.done && styles.propDone]} numberOfLines={1}>{item.property_name}</Text>
        {!item.done && (
          <Pressable
            testID={`reschedule-${item.id}`}
            onPress={(e: any) => { e?.stopPropagation?.(); setRescheduleItem({ ...item, kind }); }}
            hitSlop={8}
            style={styles.shiftBtn}
          >
            <Ionicons name="calendar-outline" size={14} color={colors.brandPrimary} />
            <Text style={styles.shiftBtnText}>Décaler</Text>
          </Pressable>
        )}
      </View>
      <Text style={styles.sub} numberOfLines={2}>
        {item.done ? "Terminé — appuyez pour rouvrir" : "À faire — appuyez pour valider"}{item.description ? ` · ${item.description}` : ""}{item.intervenant ? ` · ${item.intervenant}` : ""}
      </Text>
      {!!item.internal_note && (
        <View style={styles.noteBox}>
          <Ionicons name="document-text-outline" size={13} color="#B8860B" />
          <Text style={styles.noteText}>{item.internal_note}</Text>
        </View>
      )}
    </Pressable>
  );

  const isToday = anchor.isSame(dayjs(), "day");

  const SectionHead = ({ icon, title, count, top }: any) => (
    <View style={[styles.sectionHead, top && { marginTop: spacing.xl }]}>
      <Ionicons name={icon} size={18} color={colors.onSurface} />
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.count}><Text style={styles.countTxt}>{count}</Text></View>
    </View>
  );

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="cleaning-back" onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>À faire aujourd'hui</Text>
        <Pressable testID="cleaning-history-btn" onPress={() => router.push("/cleaning-history")} style={styles.backBtn}>
          <Ionicons name="time-outline" size={20} color={colors.onSurface} />
        </Pressable>
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
              {!!d.internal_note && (
                <View style={styles.noteBox}>
                  <Ionicons name="document-text-outline" size={13} color="#B8860B" />
                  <Text style={styles.noteText}>{d.internal_note}</Text>
                </View>
              )}
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
              <Text style={styles.sub}>Arrivée · {guestLabel(user, a.guest_name)}{a.guest_lang ? (a.guest_lang === "en" ? " 🇬🇧" : " 🇫🇷") : ""}</Text>
              <View style={[styles.depBadge, a.deposit_collected ? styles.depOk : styles.depWarn]}>
                <Ionicons name={a.deposit_collected ? "shield-checkmark" : "shield-outline"} size={13} color={a.deposit_collected ? "#2FB350" : "#FF9500"} />
                <Text style={[styles.depText, { color: a.deposit_collected ? "#2FB350" : "#FF9500" }]}>
                  {a.deposit_collected
                    ? `Caution reçue${a.deposit_amount ? ` · ${a.deposit_amount} €` : ""}`
                    : "Caution à vérifier (lien envoyé 2 j avant)"}
                </Text>
              </View>
              {!!a.internal_note && (
                <View style={styles.noteBox}>
                  <Ionicons name="document-text-outline" size={13} color="#B8860B" />
                  <Text style={styles.noteText}>{a.internal_note}</Text>
                </View>
              )}
            </Pressable>
          )) : <Text style={styles.empty}>Aucune arrivée ce jour.</Text>}

          {/* Ménages */}
          <SectionHead icon="sparkles-outline" title="Ménages à faire" count={data?.cleanings?.length || 0} top />
          {data?.cleanings?.length ? data.cleanings.map((c: any) => <TaskCard key={c.id} item={c} kind="cleaning" listKey="cleanings" />)
            : <Text style={styles.empty}>Aucun ménage prévu ce jour.</Text>}

          {/* Interventions */}
          <SectionHead icon="construct-outline" title="Interventions" count={data?.interventions?.length || 0} top />
          {data?.interventions?.length ? data.interventions.map((c: any) => <TaskCard key={c.id} item={c} kind="intervention" listKey="interventions" />)
            : <Text style={styles.empty}>Aucune intervention ce jour.</Text>}

          {/* Remises de clés */}
          <SectionHead icon="key-outline" title="Remises de clés" count={data?.key_handovers?.length || 0} top />
          {data?.key_handovers?.length ? data.key_handovers.map((c: any) => <TaskCard key={c.id} item={c} kind="key" listKey="key_handovers" />)
            : <Text style={styles.empty}>Aucune remise de clés ce jour.</Text>}

          {/* Cautions à encaisser */}
          <SectionHead icon="cash-outline" title="Cautions à encaisser" count={data?.cautions?.length || 0} top />
          {data?.cautions?.length ? data.cautions.map((c: any) => (
            <View key={c.id} testID={`caution-${c.id}`} style={[styles.card, c.done && styles.cardDone]}>
              <Pressable style={styles.cardRow} onPress={() => router.push(`/intervention-form?id=${c.id}`)}>
                <Ionicons name={c.done ? "checkmark-circle" : "ellipse-outline"} size={20} color={c.done ? colors.success : colors.onSurfaceTertiary} />
                <Text style={[styles.prop, c.done && styles.propDone]} numberOfLines={1}>{c.property_name}</Text>
                {!!c.caution_amount && <View style={styles.timeTag}><Text style={styles.timeTxt}>{c.caution_amount} €</Text></View>}
                <Ionicons name="chevron-forward" size={16} color={colors.onSurfaceTertiary} />
              </Pressable>
              <Text style={styles.sub}>
                {c.done ? (c.caution_debited ? "Encaissée" : "Rendue") : "À vérifier"}{c.intervenant ? ` · ${c.intervenant}` : ""}
              </Text>
              {canModify(user) && (
              <View style={styles.cautionActions}>
                <Pressable
                  testID={`caution-debit-${c.id}`}
                  disabled={busy === c.id}
                  onPress={() => setCaution(c.id, true)}
                  style={[styles.cautionBtn, c.done && c.caution_debited ? styles.cautionBtnActive : styles.cautionBtnDebit]}
                >
                  <Ionicons name="download-outline" size={15} color={c.done && c.caution_debited ? colors.onBrandPrimary : "#FF9500"} />
                  <Text style={[styles.cautionBtnText, { color: c.done && c.caution_debited ? colors.onBrandPrimary : "#FF9500" }]}>Encaisser</Text>
                </Pressable>
                <Pressable
                  testID={`caution-return-${c.id}`}
                  disabled={busy === c.id}
                  onPress={() => setCaution(c.id, false)}
                  style={[styles.cautionBtn, c.done && !c.caution_debited ? styles.cautionBtnActive : styles.cautionBtnReturn]}
                >
                  <Ionicons name="checkmark-done-outline" size={15} color={c.done && !c.caution_debited ? colors.onBrandPrimary : colors.success} />
                  <Text style={[styles.cautionBtnText, { color: c.done && !c.caution_debited ? colors.onBrandPrimary : colors.success }]}>Rendre</Text>
                </Pressable>
              </View>
              )}
            </View>
          )) : <Text style={styles.empty}>Aucune caution à encaisser ce jour.</Text>}
        </ScrollView>
      )}

      {/* Choix de la nouvelle date de ménage */}
      <Modal visible={!!rescheduleItem} transparent animationType="fade" onRequestClose={() => setRescheduleItem(null)}>
        <Pressable style={styles.modalBg} onPress={() => setRescheduleItem(null)}>
          <Pressable style={styles.modalCard} onPress={() => {}}>
            <Text style={styles.modalTitle}>{rescheduleItem?.kind === "cleaning" ? "Décaler le ménage" : "Décaler la tâche"}</Text>
            <Text style={styles.modalSub}>{rescheduleItem?.property_name} — choisissez la nouvelle date. Le décalage est possible jusqu'au jour de la prochaine arrivée du voyageur.</Text>
            {Array.from({ length: 7 }).map((_, i) => {
              const d = anchor.add(i + 1, "day");
              return (
                <Pressable
                  key={i}
                  testID={`reschedule-date-${d.format("YYYY-MM-DD")}`}
                  onPress={() => rescheduleTo(d.format("YYYY-MM-DD"))}
                  style={styles.dateOption}
                >
                  <Ionicons name="calendar-outline" size={16} color={colors.brandPrimary} />
                  <Text style={styles.dateOptionText}>{d.format("dddd D MMMM")}{i === 0 ? " (demain)" : ""}</Text>
                </Pressable>
              );
            })}
            <Pressable testID="reschedule-cancel" onPress={() => setRescheduleItem(null)} style={styles.modalCancel}>
              <Text style={styles.modalCancelText}>Annuler</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  shiftBtn: {
    flexDirection: "row", alignItems: "center", gap: 4, marginLeft: "auto",
    paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.pill,
    borderWidth: 1, borderColor: colors.brandPrimary + "55", backgroundColor: colors.brandPrimary + "12",
  },
  shiftBtnText: { fontFamily: font.semibold, fontSize: fontSize.xs, color: colors.brandPrimary },
  modalBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "center", padding: spacing.xl },
  modalCard: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg },
  modalTitle: { fontFamily: font.bold, fontSize: fontSize.lg, color: colors.onSurface },
  modalSub: { fontFamily: font.regular, fontSize: fontSize.sm, color: colors.onSurfaceSecondary, marginTop: 4, marginBottom: spacing.md },
  dateOption: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
  },
  dateOptionText: { fontFamily: font.medium, fontSize: fontSize.base, color: colors.onSurface, textTransform: "capitalize" },
  modalCancel: { alignItems: "center", paddingVertical: 12, marginTop: spacing.sm },
  modalCancelText: { fontFamily: font.semibold, fontSize: fontSize.base, color: colors.onSurfaceTertiary },
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
  noteBox: { flexDirection: "row", alignItems: "flex-start", gap: 6, marginTop: 8, marginLeft: 28, backgroundColor: "#FFF8E1", borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 6 },
  noteText: { flex: 1, fontFamily: font.medium, fontSize: fontSize.sm, color: "#8A6D1A", lineHeight: 17 },
  timeTag: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 3 },
  timeTxt: { fontFamily: font.semibold, fontSize: fontSize.sm, color: colors.onSurfaceSecondary },
  depBadge: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8, marginLeft: 28, alignSelf: "flex-start", borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 4 },
  depOk: { backgroundColor: "#E7F8EC" },
  depWarn: { backgroundColor: "#FFF4E5" },
  depText: { fontFamily: font.semibold, fontSize: fontSize.sm },
  cautionActions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md, marginLeft: 28 },
  cautionBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderRadius: radius.md, paddingVertical: 10, borderWidth: 1 },
  cautionBtnDebit: { backgroundColor: "#FFF4E5", borderColor: "#FFE0B2" },
  cautionBtnReturn: { backgroundColor: "#E7F8EC", borderColor: "#C8EED2" },
  cautionBtnActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  cautionBtnText: { fontFamily: font.semibold, fontSize: fontSize.sm },
  empty: { fontFamily: font.regular, fontSize: fontSize.base, color: colors.onSurfaceTertiary, paddingVertical: spacing.md },
});
