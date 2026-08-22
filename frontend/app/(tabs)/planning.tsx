import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Dimensions,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { GestureDetector, Gesture } from "react-native-gesture-handler";
import { runOnJS } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import dayjs from "dayjs";
import "dayjs/locale/fr";

import { api } from "@/src/api";
import { MenuButton } from "@/src/components/MenuButton";
import { usePreferences } from "@/src/context/PreferencesContext";
import { useAuth } from "@/src/context/AuthContext";
import { guestLabel, canModify } from "@/src/permissions";
import StatusBadge, { tint } from "@/src/components/StatusBadge";
import { INTERVENTION_TYPES, getInterventionType } from "@/src/interventionTypes";
import { InterventionIcon } from "@/src/components/InterventionIcon";
import { PlatformLogo } from "@/src/components/PlatformLogo";
import { PropertyPicker } from "@/src/components/PropertyPicker";
import { Picker } from "@/src/components/Picker";
import { colors, font, fontSize, radius, spacing } from "@/src/theme";

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
  const { statusColors, statuses } = usePreferences();
  const { user } = useAuth();
  const isOwner = user?.role !== "member";
  const [props, setProps] = useState<any[]>([]);
  const [reservations, setReservations] = useState<any[]>([]);
  const [interventions, setInterventions] = useState<any[]>([]);
  const [members, setMembers] = useState<any[]>([]);
  const [mode, setMode] = useState<"timeline" | "month">("timeline");
  const [selectedProp, setSelectedProp] = useState<string>("all");
  const [selectedMember, setSelectedMember] = useState<string>("all");
  const [anchor, setAnchor] = useState(dayjs().startOf("month"));
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [pr, res, ivs] = await Promise.all([
        api.get("/properties"),
        api.get("/reservations"),
        api.get("/interventions"),
      ]);
      setProps(pr);
      setReservations(res.filter((r: any) => r.status !== "annulee"));
      setInterventions(ivs.filter((iv: any) => !iv.done));
      if (isOwner) {
        try {
          const ms = await api.get("/members");
          setMembers((ms || []).filter((m: any) => (m.property_ids || []).length > 0));
        } catch {}
      }
    } catch {}
  }, [isOwner]);

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

  const activeMember = members.find((m) => m.id === selectedMember);
  const memberPropIds: string[] | null = activeMember ? (activeMember.property_ids || []) : null;
  const inScope = (pid: string) =>
    (selectedProp === "all" || pid === selectedProp) && (!memberPropIds || memberPropIds.includes(pid));
  const rows = props.filter((p) => inScope(p.id));
  const filtered = reservations.filter((r) => inScope(r.property_id));
  const filteredIvs = interventions.filter((iv) => inScope(iv.property_id));

  const monthStart = anchor.startOf("month");
  const daysInMonth = anchor.daysInMonth();
  const days = Array.from({ length: daysInMonth }, (_, i) => monthStart.add(i, "day"));
  const todayStr = dayjs().format("YYYY-MM-DD");

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <View style={styles.headerTop}>
          <View style={styles.titleRow}>
            <MenuButton />
            <Text style={styles.title}>Calendrier</Text>
          </View>
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

        <View style={styles.pickerWrap}>
          <PropertyPicker value={selectedProp} items={props} onSelect={setSelectedProp} testID="planning-prop-picker" />
        </View>

        {isOwner && members.length > 0 && (
          <View style={styles.pickerWrap}>
            <Picker
              testID="planning-member-picker"
              title="Filtrer par intervenant"
              icon="person-outline"
              value={selectedMember}
              items={[
                { id: "all", name: "Tous les intervenants" },
                ...members.map((m) => ({
                  id: m.id,
                  name: `${[m.first_name, m.last_name].filter(Boolean).join(" ") || m.email} · ${(m.property_ids || []).length} logement${(m.property_ids || []).length > 1 ? "s" : ""}`,
                })),
              ]}
              onSelect={setSelectedMember}
            />
          </View>
        )}

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
          interventions={filteredIvs}
          statusColors={statusColors}
          statuses={statuses}
          todayStr={todayStr}
          onBar={(id: string) => router.push(`/reservation-form?id=${id}`)}
          onIv={(id: string) => router.push(`/intervention-form?id=${id}`)}
          onCreate={(pid: string, ci: string, co: string) =>
            router.push(`/reservation-form?property=${pid}&check_in=${ci}&check_out=${co}`)}
          bottomPad={insets.bottom + 90}
        />
      ) : (
        <MonthView
          anchor={anchor}
          daysInMonth={daysInMonth}
          monthStart={monthStart}
          filtered={filtered}
          interventions={filteredIvs}
          propMap={propMap}
          statusColors={statusColors}
          single={selectedProp !== "all"}
          selectedDay={selectedDay}
          setSelectedDay={setSelectedDay}
          todayStr={todayStr}
          onRes={(id: string) => router.push(`/reservation-form?id=${id}`)}
          onIv={(id: string) => router.push(`/intervention-form?id=${id}`)}
          bottomPad={insets.bottom + 90}
        />
      )}

      {props.length > 0 && canModify(user) && (
        <Pressable
          testID="add-intervention-fab"
          onPress={() => {
            const q = selectedProp !== "all" ? `?property=${selectedProp}` : "";
            router.push(`/intervention-form${q}` as any);
          }}
          style={[styles.fab, { bottom: insets.bottom + 76 }]}
        >
          <Ionicons name="construct" size={24} color={colors.onBrandPrimary} />
        </Pressable>
      )}
    </View>
  );
}

function TimelineView({ rows, days, monthStart, daysInMonth, filtered, interventions, statusColors, statuses, todayStr, onBar, onIv, onCreate, bottomPad }: any) {
  const { user } = useAuth();
  const [sel, setSel] = useState<{ propId: string; a: number; b: number } | null>(null);
  const dragRef = useRef<{ propId: string; a: number; b: number } | null>(null);

  const jsBegin = (propId: string, idx: number) => {
    dragRef.current = { propId, a: idx, b: idx };
    setSel(dragRef.current);
  };
  const jsUpdate = (idx: number) => {
    if (!dragRef.current) return;
    dragRef.current = { ...dragRef.current, b: idx };
    setSel({ ...dragRef.current });
  };
  const jsEnd = () => {
    const d = dragRef.current;
    dragRef.current = null;
    setSel(null);
    if (!d) return;
    const lo = Math.min(d.a, d.b);
    const hi = Math.max(d.a, d.b);
    const ci = days[lo].format("YYYY-MM-DD");
    const co = days[hi].add(1, "day").format("YYYY-MM-DD");
    onCreate(d.propId, ci, co);
  };

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: bottomPad }} showsVerticalScrollIndicator={false}>
      <View style={styles.dragHint}>
        <Ionicons name="hand-left-outline" size={13} color={colors.onSurfaceTertiary} />
        <Text style={styles.dragHintText}>Maintenez puis glissez sur une ligne pour créer une réservation</Text>
      </View>
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
              const rowIvs = interventions.filter((iv: any) => iv.property_id === p.id);
              const pan = Gesture.Pan()
                .activateAfterLongPress(220)
                .onBegin((e) => {
                  const idx = Math.max(0, Math.min(daysInMonth - 1, Math.floor(e.x / DAY_W)));
                  runOnJS(jsBegin)(p.id, idx);
                })
                .onUpdate((e) => {
                  const idx = Math.max(0, Math.min(daysInMonth - 1, Math.floor(e.x / DAY_W)));
                  runOnJS(jsUpdate)(idx);
                })
                .onEnd(() => {
                  runOnJS(jsEnd)();
                });
              return (
                <GestureDetector key={p.id} gesture={pan}>
                  <View style={{ width: daysInMonth * DAY_W, height: ROW_H }}>
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
                  {/* drag selection overlay */}
                  {sel && sel.propId === p.id && (
                    <View
                      pointerEvents="none"
                      style={[
                        styles.selBar,
                        {
                          left: Math.min(sel.a, sel.b) * DAY_W,
                          width: (Math.abs(sel.b - sel.a) + 1) * DAY_W,
                        },
                      ]}
                    />
                  )}
                  {/* bars */}
                  {rowRes.map((r: any) => {
                    const ci = dayjs(r.check_in);
                    const co = dayjs(r.check_out);
                    const rawStart = ci.diff(monthStart, "day");
                    const rawEnd = co.diff(monthStart, "day");
                    // Barre du milieu de la case d'arrivée au milieu de la case de départ
                    const leftPos = rawStart < 0 ? 0 : rawStart * DAY_W + DAY_W / 2;
                    const rightPos = rawEnd >= daysInMonth ? daysInMonth * DAY_W : rawEnd * DAY_W + DAY_W / 2;
                    const w = rightPos - leftPos;
                    if (w <= 0) return null;
                    const color = r.display_color || r.marker_color || statusColors[r.status] || "#8E8E93";
                    return (
                      <Pressable
                        key={r.id}
                        testID={`timeline-bar-${r.id}`}
                        onPress={() => onBar(r.id)}
                        style={[
                          styles.bar,
                          {
                            left: leftPos + 1,
                            width: Math.max(w - 2, 18),
                            backgroundColor: color,
                          },
                        ]}
                      >
                        <PlatformLogo platform={r.platform} size={14} />
                        <Text style={styles.barText} numberOfLines={1}>{guestLabel(user, r.guest_name)}</Text>
                      </Pressable>
                    );
                  })}
                  {/* intervention markers (single day, bottom strip) */}
                  {rowIvs.map((iv: any) => {
                    const off = dayjs(iv.date).diff(monthStart, "day");
                    if (off < 0 || off >= daysInMonth) return null;
                    const t = getInterventionType(iv.kind);
                    return (
                      <Pressable
                        key={iv.id}
                        testID={`timeline-iv-${iv.id}`}
                        onPress={() => onIv(iv.id)}
                        style={[styles.ivMarker, { left: off * DAY_W + 3, backgroundColor: t.color }]}
                      >
                        <InterventionIcon kind={iv.kind} size={9} color="#fff" />
                      </Pressable>
                    );
                  })}
                  </View>
                </GestureDetector>
              );
            })}
          </View>
        </ScrollView>
      </View>
      <View style={styles.legend}>
        {statuses.map((s: any) => (
          <View key={s.key} style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: s.color }]} />
            <Text style={styles.legendText}>{s.label}</Text>
          </View>
        ))}
        {INTERVENTION_TYPES.map((t) => (
          <View key={t.key} style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: t.color }]} />
            <Text style={styles.legendText}>{t.label}</Text>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

function MonthView({ anchor, daysInMonth, monthStart, filtered, interventions, propMap, statusColors, single, selectedDay, setSelectedDay, todayStr, onRes, onIv, bottomPad }: any) {
  const { user } = useAuth();
  const offset = (monthStart.day() + 6) % 7; // Monday start
  const cells: (any | null)[] = [
    ...Array(offset).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => monthStart.add(i, "day")),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  function resForDay(dayStr: string) {
    return filtered.filter((r: any) => dayStr >= r.check_in && dayStr < r.check_out);
  }
  function ivsForDay(dayStr: string) {
    return interventions.filter((iv: any) => iv.date === dayStr);
  }

  const selRes = selectedDay ? resForDay(selectedDay) : [];
  const selIvs = selectedDay ? ivsForDay(selectedDay) : [];

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
          const dayIvs = ivsForDay(dayStr);
          const isToday = dayStr === todayStr;
          const isSel = dayStr === selectedDay;
          const firstColor = res.length ? (res[0].display_color || res[0].marker_color || statusColors[res[0].status]) : null;
          const uniqueStatuses = Array.from(new Set(res.map((r: any) => r.status))) as string[];
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
                  {uniqueStatuses.slice(0, 3).map((s) => (
                    <View key={s} style={[styles.miniDot, { backgroundColor: statusColors[s] || "#8E8E93" }]} />
                  ))}
                </View>
              )}
              {single && res.length > 0 && (
                <View style={[styles.occBar, { backgroundColor: firstColor }]} />
              )}
              {dayIvs.length > 0 && (
                <View style={styles.ivDotsRow}>
                  {dayIvs.slice(0, 3).map((iv: any) => (
                    <View key={iv.id} style={[styles.ivDot, { backgroundColor: getInterventionType(iv.kind).color }]} />
                  ))}
                </View>
              )}
            </Pressable>
          );
        })}
      </View>

      {selectedDay && (
        <View style={styles.dayDetail}>
          <Text style={styles.detailTitle}>{dayjs(selectedDay).format("dddd D MMMM")}</Text>
          {selRes.length === 0 && selIvs.length === 0 ? (
            <Text style={styles.detailEmpty}>Journée libre ✓</Text>
          ) : (
            <>
              {selRes.map((r: any) => (
                <Pressable key={r.id} testID={`day-res-${r.id}`} onPress={() => onRes(r.id)} style={styles.detailCard}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.detailGuest}>{guestLabel(user, r.guest_name)}</Text>
                    <Text style={styles.detailProp}>{propMap[r.property_id]?.name || "Logement"}</Text>
                  </View>
                  <StatusBadge status={r.status} />
                </Pressable>
              ))}
              {selIvs.map((iv: any) => {
                const t = getInterventionType(iv.kind);
                return (
                  <Pressable key={iv.id} testID={`day-iv-${iv.id}`} onPress={() => onIv(iv.id)} style={[styles.detailCard, { borderLeftWidth: 4, borderLeftColor: t.color }]}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.detailGuest}>{iv.description || t.label}</Text>
                      <Text style={styles.detailProp}>
                        {propMap[iv.property_id]?.name || "Logement"}{iv.intervenant ? ` · ${iv.intervenant}` : ""}
                      </Text>
                    </View>
                    <View style={[styles.ivBadge, { backgroundColor: t.color + "22" }]}>
                      <InterventionIcon kind={iv.kind} size={12} color={t.color} />
                      <Text style={[styles.ivBadgeText, { color: t.color }]}>{t.label}</Text>
                    </View>
                  </Pressable>
                );
              })}
            </>
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
  titleRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
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
  pickerWrap: { marginBottom: spacing.sm },
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
    paddingHorizontal: 5, flexDirection: "row", alignItems: "center", gap: 4,
  },
  barText: { fontFamily: font.semibold, fontSize: 12, color: "#fff", flexShrink: 1 },
  dragHint: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: 2 },
  dragHintText: { fontFamily: font.regular, fontSize: 11, color: colors.onSurfaceTertiary },
  selBar: { position: "absolute", top: 6, bottom: 6, borderRadius: 7, backgroundColor: "rgba(10,132,255,0.22)", borderWidth: 1.5, borderColor: "#0A84FF" },
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
  ivMarker: {
    position: "absolute",
    bottom: 4,
    width: DAY_W - 6,
    height: 14,
    borderRadius: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  ivDotsRow: { flexDirection: "row", gap: 3, marginTop: 3 },
  ivDot: { width: 6, height: 6, borderRadius: 2 },
  ivBadge: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: spacing.sm, paddingVertical: 5, borderRadius: radius.pill },
  ivDotSm: { width: 7, height: 7, borderRadius: 999 },
  ivBadgeText: { fontFamily: font.semibold, fontSize: 12 },
  fab: {
    position: "absolute",
    right: spacing.lg,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
});
