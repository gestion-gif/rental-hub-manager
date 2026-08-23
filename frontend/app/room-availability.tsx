import React, { useCallback, useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import dayjs from "dayjs";
import "dayjs/locale/fr";

import { api } from "@/src/api";
import { useAuth } from "@/src/context/AuthContext";
import { canModify } from "@/src/permissions";
import { colors, font, fontSize, radius, spacing } from "@/src/theme";

dayjs.locale("fr");

export default function RoomAvailability() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { room, name } = useLocalSearchParams<{ room: string; name: string }>();
  const { user } = useAuth();
  const editable = canModify(user);
  const [anchor, setAnchor] = useState(dayjs().startOf("month"));
  const [avail, setAvail] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [rangeStart, setRangeStart] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const start = anchor.startOf("month").format("YYYY-MM-DD");
      const end = anchor.endOf("month").format("YYYY-MM-DD");
      const r = await api.get(`/rooms/${room}/availability?start=${start}&end=${end}`);
      const map: Record<string, any> = {};
      (r.availability || []).forEach((a: any) => { map[a.date] = a; });
      setAvail(map);
    } catch {}
    setLoading(false);
  }, [room, anchor]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const days = useMemo(() => {
    const first = anchor.startOf("month");
    const daysInMonth = anchor.daysInMonth();
    const lead = (first.day() + 6) % 7; // Monday-first
    const cells: (dayjs.Dayjs | null)[] = [];
    for (let i = 0; i < lead; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(first.date(d));
    return cells;
  }, [anchor]);

  function isClosed(ds: string) {
    const a = avail[ds];
    return a ? (a.closed || a.is_available === false) : false;
  }

  async function setRange(from: string, to: string, closed: boolean) {
    if (busy) return;
    setBusy(true);
    try {
      await api.post(`/rooms/${room}/availability`, { date_from: from, date_to: to, is_available: !closed, closed });
      await load();
    } catch {}
    setBusy(false);
    setRangeStart("");
  }

  function onDayPress(ds: string) {
    if (!editable) return;
    if (!rangeStart) {
      setRangeStart(ds);
      return;
    }
    // second tap: apply on the range, toggling based on the start day's current state
    const from = rangeStart <= ds ? rangeStart : ds;
    const to = rangeStart <= ds ? ds : rangeStart;
    const willClose = !isClosed(rangeStart); // if start open -> close range, else open range
    setRange(from, to, willClose);
  }

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="avail-back" onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>{name || "Disponibilités"}</Text>
        <View style={{ width: 34 }} />
      </View>

      <View style={styles.monthNav}>
        <Pressable testID="avail-prev" onPress={() => setAnchor((a) => a.subtract(1, "month"))} style={styles.navBtn}><Ionicons name="chevron-back" size={20} color={colors.onSurface} /></Pressable>
        <Text style={styles.monthLabel}>{anchor.format("MMMM YYYY")}</Text>
        <Pressable testID="avail-next" onPress={() => setAnchor((a) => a.add(1, "month"))} style={styles.navBtn}><Ionicons name="chevron-forward" size={20} color={colors.onSurface} /></Pressable>
      </View>

      {editable && (
        <Text style={styles.hint}>
          {rangeStart ? `Début : ${dayjs(rangeStart).format("DD/MM")} — touchez un 2ᵉ jour pour appliquer` : "Touchez un jour (début) puis un 2ᵉ jour (fin) pour ouvrir/fermer la plage."}
        </Text>
      )}

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={colors.brandPrimary} />
      ) : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 40 }}>
          <View style={styles.weekRow}>
            {["L", "M", "M", "J", "V", "S", "D"].map((d, i) => <Text key={i} style={styles.weekDay}>{d}</Text>)}
          </View>
          <View style={styles.grid}>
            {days.map((d, i) => {
              if (!d) return <View key={i} style={styles.cell} />;
              const ds = d.format("YYYY-MM-DD");
              const closed = isClosed(ds);
              const a = avail[ds];
              const selected = rangeStart === ds;
              return (
                <Pressable key={i} testID={`avail-day-${ds}`} onPress={() => onDayPress(ds)} style={[styles.cell, styles.dayCell, closed ? styles.dayClosed : styles.dayOpen, selected && styles.daySelected]}>
                  <Text style={[styles.dayNum, closed && { color: "#fff" }]}>{d.date()}</Text>
                  {a?.min_stay ? <Text style={[styles.minStay, closed && { color: "#fff" }]}>{a.min_stay}n</Text> : null}
                </Pressable>
              );
            })}
          </View>
          <View style={styles.legend}>
            <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: "#E6F7F1", borderColor: "#17B0A6", borderWidth: 1 }]} /><Text style={styles.legendText}>Ouvert</Text></View>
            <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: "#E5484D" }]} /><Text style={styles.legendText}>Fermé / bloqué</Text></View>
          </View>
          {busy && <ActivityIndicator style={{ marginTop: 12 }} color={colors.brandPrimary} />}
        </ScrollView>
      )}
    </View>
  );
}

const CELL = `${100 / 7}%`;
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  backBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  title: { fontFamily: font.bold, fontSize: fontSize.lg, color: colors.onSurface, flex: 1, textAlign: "center" },
  monthNav: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  navBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  monthLabel: { fontFamily: font.semibold, fontSize: fontSize.lg, color: colors.onSurface, textTransform: "capitalize" },
  hint: { fontFamily: font.regular, fontSize: fontSize.sm, color: colors.onSurfaceTertiary, paddingHorizontal: spacing.lg, marginBottom: spacing.sm },
  weekRow: { flexDirection: "row" },
  weekDay: { width: CELL as any, textAlign: "center", fontFamily: font.medium, fontSize: fontSize.xs, color: colors.onSurfaceTertiary, marginBottom: 6 },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  cell: { width: CELL as any, aspectRatio: 1, padding: 3 },
  dayCell: { alignItems: "center", justifyContent: "center", borderRadius: 10 },
  dayOpen: { backgroundColor: "#E6F7F1", borderWidth: 1, borderColor: "#B9E8DC" },
  dayClosed: { backgroundColor: "#E5484D" },
  daySelected: { borderWidth: 2, borderColor: colors.brandPrimary },
  dayNum: { fontFamily: font.semibold, fontSize: fontSize.sm, color: colors.onSurface },
  minStay: { fontFamily: font.regular, fontSize: 9, color: colors.onSurfaceTertiary },
  legend: { flexDirection: "row", gap: spacing.lg, marginTop: spacing.lg, justifyContent: "center" },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  legendDot: { width: 14, height: 14, borderRadius: 4 },
  legendText: { fontFamily: font.regular, fontSize: fontSize.sm, color: colors.onSurfaceSecondary },
});
