import React, { useCallback, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Dimensions,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import dayjs from "dayjs";
import "dayjs/locale/fr";

import { api } from "@/src/api";
import { usePreferences } from "@/src/context/PreferencesContext";
import StatusBadge, { tint } from "@/src/components/StatusBadge";
import { STATUS, StatusKey, colors, font, fontSize, radius, spacing } from "@/src/theme";

dayjs.locale("fr");

const SCREEN_W = Dimensions.get("window").width;
const DAY_W = 44;
const DAYHEAD_H = 46;
const ROW_H = 58;
const LEFT_W = 92;
const CELL_W = (SCREEN_W - spacing.lg * 2) / 7;
const WEEKDAYS = ["L", "M", "M", "J", "V", "S", "D"];

export default function Planning() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { statusColors } = usePreferences();
  const [props, setProps] = useState<any[]>([]);
  const [reservations, setReservations] = useState<any[]>([]);
  const [mode, setMode] = useState<"timeline" | "month">("timeline");
  const [selectedProp, setSelectedProp] = useState<string>("all");
  const [anchor, setAnchor] = useState(dayjs().startOf("month"));
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [pr, res] = await Promise.all([
        api.get("/properties"),
        api.get("/reservations"),
      ]);
      setProps(pr);
      setReservations(res.filter((r: any) => r.status !== "annulee"));
    } catch {}
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const propMap = useMemo(() => {
    const m: Record<string, any> = {};
    props.forEach((p) => (m[p.id] = p));
    return m;
  }, [props]);

  const rows = selectedProp === "all" ? props : props.filter((p) => p.id === selectedProp);
  const filtered =
    selectedProp === "all"
      ? reservations
      : reservations.filter((r) => r.property_id === selectedProp);

  const monthStart = anchor.startOf("month");
  const daysInMonth = anchor.daysInMonth();
  const days = Array.from({ length: daysInMonth }, (_, i) => monthStart.add(i, "day"));
  const todayStr = dayjs().format("YYYY-MM-DD");

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <View style={styles.headerTop}>
          <Text style={styles.title}>Planning</Text>
          <Pressable
            testID="open-color-settings"
            onPress={() => router.push("/settings/status-colors")}
            style={styles.gear}
          >
            <Ionicons name="color-palette-outline" size={20} color={colors.onSurface} />
          </Pressable>
        </View>

        <View style={styles.segment}>
          {(["timeline", "month"] as const).map((m) => (
            <Pressable
              key={m}
              testID={`planning-mode-${m}`}
              onPress={() => setMode(m)}
              style={[styles.segBtn, mode === m && styles.segBtnActive]}
            >
              <Ionicons
                name={m === "timeline" ? "reorder-four-outline" : "grid-outline"}
                size={15}
                color={mode === m ? colors.onSurface : colors.onSurfaceTertiary}
              />
              <Text style={[styles.segText, mode === m && styles.segTextActive]}>
                {m === "timeline" ? "Réglette" : "Mois"}
              </Text>
            </Pressable>
          ))}
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          <PropChip label="Tous" active={selectedProp === "all"} onPress={() => setSelectedProp("all")} testID="prop-chip-all" />
          {props.map((p) => (
            <PropChip
              key={p.id}
              label={p.name}
              active={selectedProp === p.id}
              onPress={() => setSelectedProp(p.id)}
              testID={`prop-chip-${p.id}`}
            />
          ))}
        </ScrollView>

        <View style={styles.monthNav}>
          <View style={styles.navGroup}>
            <Pressable testID="prev-year" onPress={() => setAnchor((a) => a.subtract(1, "year"))} style={styles.navBtn}>
              <Ionicons name="play-back" size={13} color={colors.onSurface} />
            </Pressable>
            <Pressable testID="prev-month" onPress={() => setAnchor((a) => a.subtract(1, "month"))} style={styles.navBtn}>
              <Ionicons name="chevron-back" size={18} color={colors.onSurface} />
            </Pressable>
          </View>
          <Pressable testID="today-button" onPress={() => setAnchor(dayjs().startOf("month"))}>
            <Text style={styles.monthLabel}>{anchor.format("MMMM YYYY")}</Text>
            <Text style={styles.todayHint}>Aujourd'hui</Text>
          </Pressable>
          <View style={styles.navGroup}>
            <Pressable testID="next-month" onPress={() => setAnchor((a) => a.add(1, "month"))} style={styles.navBtn}>
              <Ionicons name="chevron-forward" size={18} color={colors.onSurface} />
            </Pressable>
            <Pressable testID="next-year" onPress={() => setAnchor((a) => a.add(1, "year"))} style={styles.navBtn}>
              <Ionicons name="play-forward" size={13} color={colors.onSurface} />
            </Pressable>
          </View>
        </View>
      </View>

      {props.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="calendar-outline" size={40} color={colors.onSurfaceTertiary} />
          <Text style={styles.emptyText}>Ajoutez un logement</Text>
          <Text style={styles.emptySub}>Le planning affichera vos réservations ici.</Text>
        </View>
      ) : mode === "timeline" ? (
        <TimelineView
          rows={rows}
          days={days}
          monthStart={monthStart}
          daysInMonth={daysInMonth}
          filtered={filtered}
          statusColors={statusColors}
          todayStr={todayStr}
          onBar={(id: string) => router.push(`/reservation-form?id=${id}`)}
          bottomPad={insets.bottom + 90}
        />
      ) : (
        <MonthView
          anchor={anchor}
          daysInMonth={daysInMonth}
          monthStart={monthStart}
          filtered={filtered}
          propMap={propMap}
          statusColors={statusColors}
          single={selectedProp !== "all"}
          selectedDay={selectedDay}
          setSelectedDay={setSelectedDay}
          todayStr={todayStr}
          onRes={(id: string) => router.push(`/reservation-form?id=${id}`)}
          bottomPad={insets.bottom + 90}
        />
      )}
    </View>
  );
}

function PropChip({ label, active, onPress, testID }: any) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      style={[styles.chip, active && styles.chipActive]}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

function TimelineView({ rows, days, monthStart, daysInMonth, filtered, statusColors, todayStr, onBar, bottomPad }: any) {
  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: bottomPad }} showsVerticalScrollIndicator={false}>
      <View style={{ flexDirection: "row" }}>
        {/* Left fixed column */}
        <View style={{ width: LEFT_W }}>
          <View style={[styles.corner]} />
          {rows.map((p: any) => (
            <View key={p.id} style={styles.nameCell}>
              <Text style={styles.nameText} numberOfLines={2}>{p.name}</Text>
            </View>
          ))}
        </View>
        {/* Right horizontal scroll */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View>
            {/* Day header */}
            <View style={{ flexDirection: "row", height: DAYHEAD_H }}>
              {days.map((d: any) => {
                const isToday = d.format("YYYY-MM-DD") === todayStr;
                const weekend = d.day() === 0 || d.day() === 6;
                return (
                  <View key={d.valueOf()} style={[styles.dayHead, weekend && styles.weekendBg, isToday && styles.todayHead]}>
                    <Text style={[styles.dowText, isToday && styles.todayText]}>{d.format("dd")[0]}</Text>
                    <Text style={[styles.domText, isToday && styles.todayText]}>{d.date()}</Text>
                  </View>
                );
              })}
            </View>
            {/* Rows */}
            {rows.map((p: any) => {
              const rowRes = filtered.filter((r: any) => r.property_id === p.id);
              return (
                <View key={p.id} style={{ width: daysInMonth * DAY_W, height: ROW_H }}>
                  {/* background cells */}
                  <View style={{ flexDirection: "row" }}>
                    {days.map((d: any) => {
                      const weekend = d.day() === 0 || d.day() === 6;
                      const isToday = d.format("YYYY-MM-DD") === todayStr;
                      return (
                        <View
                          key={d.valueOf()}
                          style={[styles.gridCell, weekend && styles.weekendBg, isToday && styles.todayCol]}
                        />
                      );
                    })}
                  </View>
                  {/* bars */}
                  {rowRes.map((r: any) => {
                    const ci = dayjs(r.check_in);
                    const co = dayjs(r.check_out);
                    const startOffset = Math.max(0, ci.diff(monthStart, "day"));
                    const endOffset = Math.min(daysInMonth, co.diff(monthStart, "day"));
                    const nights = endOffset - startOffset;
                    if (nights <= 0) return null;
                    const color = statusColors[r.status as StatusKey] || STATUS[r.status as StatusKey]?.color;
                    return (
                      <Pressable
                        key={r.id}
                        testID={`timeline-bar-${r.id}`}
                        onPress={() => onBar(r.id)}
                        style={[
                          styles.bar,
                          {
                            left: startOffset * DAY_W + 2,
                            width: Math.max(nights * DAY_W - 4, 22),
                            backgroundColor: color,
                          },
                        ]}
                      >
                        <Text style={styles.barText} numberOfLines={1}>{r.guest_name}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              );
            })}
          </View>
        </ScrollView>
      </View>
      <View style={styles.legend}>
        {(Object.keys(STATUS) as StatusKey[]).map((s) => (
          <View key={s} style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: statusColors[s] }]} />
            <Text style={styles.legendText}>{STATUS[s].label}</Text>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

function MonthView({ anchor, daysInMonth, monthStart, filtered, propMap, statusColors, single, selectedDay, setSelectedDay, todayStr, onRes, bottomPad }: any) {
  const offset = (monthStart.day() + 6) % 7; // Monday start
  const cells: (any | null)[] = [
    ...Array(offset).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => monthStart.add(i, "day")),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  function resForDay(dayStr: string) {
    return filtered.filter((r: any) => dayStr >= r.check_in && dayStr < r.check_out);
  }

  const selRes = selectedDay ? resForDay(selectedDay) : [];

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: spacing.lg, paddingBottom: bottomPad }} showsVerticalScrollIndicator={false}>
      <View style={styles.weekRow}>
        {WEEKDAYS.map((w, i) => (
          <View key={i} style={{ width: CELL_W, alignItems: "center" }}>
            <Text style={styles.weekday}>{w}</Text>
          </View>
        ))}
      </View>
      <View style={styles.grid}>
        {cells.map((d, i) => {
          if (!d) return <View key={`e${i}`} style={{ width: CELL_W, height: CELL_W }} />;
          const dayStr = d.format("YYYY-MM-DD");
          const res = resForDay(dayStr);
          const isToday = dayStr === todayStr;
          const isSel = dayStr === selectedDay;
          const firstColor = res.length ? statusColors[res[0].status as StatusKey] : null;
          const uniqueStatuses = Array.from(new Set(res.map((r: any) => r.status))) as StatusKey[];
          return (
            <Pressable
              key={dayStr}
              testID={`day-${dayStr}`}
              onPress={() => setSelectedDay(dayStr)}
              style={[
                styles.dayCell,
                single && res.length > 0 && { backgroundColor: tint(firstColor, "33") },
                isSel && styles.daySel,
              ]}
            >
              <Text style={[styles.dayNum, isToday && styles.dayNumToday, single && res.length > 0 && { color: firstColor }]}>
                {d.date()}
              </Text>
              {!single && (
                <View style={styles.dotsRow}>
                  {uniqueStatuses.slice(0, 4).map((s) => (
                    <View key={s} style={[styles.miniDot, { backgroundColor: statusColors[s] }]} />
                  ))}
                </View>
              )}
              {single && res.length > 0 && (
                <View style={[styles.occBar, { backgroundColor: firstColor }]} />
              )}
            </Pressable>
          );
        })}
      </View>

      {selectedDay && (
        <View style={styles.dayDetail}>
          <Text style={styles.detailTitle}>{dayjs(selectedDay).format("dddd D MMMM")}</Text>
          {selRes.length === 0 ? (
            <Text style={styles.detailEmpty}>Journée libre ✓</Text>
          ) : (
            selRes.map((r: any) => (
              <Pressable key={r.id} testID={`day-res-${r.id}`} onPress={() => onRes(r.id)} style={styles.detailCard}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.detailGuest}>{r.guest_name}</Text>
                  <Text style={styles.detailProp}>{propMap[r.property_id]?.name || "Logement"}</Text>
                </View>
                <StatusBadge status={r.status} />
              </Pressable>
            ))
          )}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  headerTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.md },
  title: { fontFamily: font.bold, fontSize: fontSize.xxl, color: colors.onSurface },
  gear: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center",
  },
  segment: { flexDirection: "row", backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: 3, marginBottom: spacing.md },
  segBtn: { flex: 1, flexDirection: "row", gap: 5, paddingVertical: 8, alignItems: "center", justifyContent: "center", borderRadius: radius.sm },
  segBtnActive: { backgroundColor: colors.surface, shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 3, elevation: 1 },
  segText: { fontFamily: font.medium, fontSize: fontSize.base, color: colors.onSurfaceTertiary },
  segTextActive: { color: colors.onSurface, fontFamily: font.semibold },
  chipRow: { gap: spacing.sm, paddingRight: spacing.lg, alignItems: "center", height: 44 },
  chip: {
    height: 34, flexShrink: 0, maxWidth: 160, paddingHorizontal: spacing.md, borderRadius: radius.pill,
    backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center",
  },
  chipActive: { backgroundColor: colors.brandPrimary },
  chipText: { fontFamily: font.medium, fontSize: fontSize.base, color: colors.onSurfaceSecondary },
  chipTextActive: { color: colors.onBrandPrimary },
  monthNav: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.xs },
  navGroup: { flexDirection: "row", gap: spacing.xs },
  navBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  monthLabel: { fontFamily: font.semibold, fontSize: fontSize.lg, color: colors.onSurface, textTransform: "capitalize", textAlign: "center" },
  todayHint: { fontFamily: font.regular, fontSize: 11, color: colors.onSurfaceTertiary, textAlign: "center" },

  // timeline
  corner: { height: DAYHEAD_H, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  nameCell: {
    height: ROW_H, justifyContent: "center", paddingHorizontal: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
    borderRightWidth: StyleSheet.hairlineWidth,
  },
  nameText: { fontFamily: font.semibold, fontSize: 13, color: colors.onSurface },
  dayHead: { width: DAY_W, height: DAYHEAD_H, alignItems: "center", justifyContent: "center", borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  dowText: { fontFamily: font.regular, fontSize: 11, color: colors.onSurfaceTertiary, textTransform: "uppercase" },
  domText: { fontFamily: font.semibold, fontSize: 14, color: colors.onSurface },
  todayHead: { backgroundColor: colors.brandPrimary },
  todayText: { color: colors.onBrandPrimary },
  weekendBg: { backgroundColor: colors.surfaceSecondary },
  todayCol: { backgroundColor: "rgba(28,28,30,0.06)" },
  gridCell: { width: DAY_W, height: ROW_H, borderRightWidth: StyleSheet.hairlineWidth, borderColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth },
  bar: {
    position: "absolute", top: 10, height: ROW_H - 20, borderRadius: 7,
    paddingHorizontal: 6, justifyContent: "center",
  },
  barText: { fontFamily: font.semibold, fontSize: 12, color: "#fff" },
  legend: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md, padding: spacing.lg },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  legendDot: { width: 10, height: 10, borderRadius: 999 },
  legendText: { fontFamily: font.regular, fontSize: fontSize.sm, color: colors.onSurfaceSecondary },

  // month
  weekRow: { flexDirection: "row", marginBottom: spacing.sm },
  weekday: { fontFamily: font.semibold, fontSize: fontSize.sm, color: colors.onSurfaceTertiary },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  dayCell: {
    width: CELL_W, height: CELL_W, alignItems: "center", paddingTop: 6, borderRadius: radius.sm,
  },
  daySel: { borderWidth: 2, borderColor: colors.brandPrimary },
  dayNum: { fontFamily: font.medium, fontSize: fontSize.base, color: colors.onSurface },
  dayNumToday: {
    color: colors.onBrandPrimary, backgroundColor: colors.brandPrimary,
    width: 24, height: 24, borderRadius: 12, textAlign: "center", lineHeight: 24, overflow: "hidden",
  },
  dotsRow: { flexDirection: "row", gap: 3, marginTop: 4 },
  miniDot: { width: 6, height: 6, borderRadius: 999 },
  occBar: { position: "absolute", bottom: 6, height: 4, left: 8, right: 8, borderRadius: 2 },
  dayDetail: { marginTop: spacing.xl },
  detailTitle: { fontFamily: font.semibold, fontSize: fontSize.lg, color: colors.onSurface, marginBottom: spacing.md, textTransform: "capitalize" },
  detailEmpty: { fontFamily: font.regular, fontSize: fontSize.base, color: colors.onSurfaceTertiary },
  detailCard: {
    flexDirection: "row", alignItems: "center", backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md, padding: spacing.lg, marginBottom: spacing.sm,
  },
  detailGuest: { fontFamily: font.semibold, fontSize: fontSize.lg, color: colors.onSurface },
  detailProp: { fontFamily: font.regular, fontSize: fontSize.base, color: colors.onSurfaceTertiary, marginTop: 2 },

  empty: { alignItems: "center", marginTop: 80, gap: spacing.sm },
  emptyText: { fontFamily: font.semibold, fontSize: fontSize.lg, color: colors.onSurface },
  emptySub: { fontFamily: font.regular, fontSize: fontSize.base, color: colors.onSurfaceTertiary },
});
