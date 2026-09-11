import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Dimensions,
  Modal,
  TextInput,
  ActivityIndicator,
} from "react-native";
import Ionicons from "@react-native-vector-icons/ionicons";
import { GestureDetector, Gesture } from "react-native-gesture-handler";
import { runOnJS } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import dayjs from "dayjs";
import "dayjs/locale/fr";

import { api } from "@/src/api";
import { MenuButton } from "@/src/components/MenuButton";
import { HelpButton } from "@/src/components/HelpButton";
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



function priceForDay(prop: any, dayStr: string): number | null {
  if (!prop) return null;
  for (const s of (prop.seasons || [])) {
    if (s.start_date && s.end_date && dayStr >= s.start_date && dayStr <= s.end_date) {
      return s.price;
    }
  }
  return prop.base_price ?? null;
}

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
  const [showPrices, setShowPrices] = useState(true);
  const [priceMode, setPriceMode] = useState(false);
  const [editPrice, setEditPrice] = useState<any>(null);
  const [priceInput, setPriceInput] = useState("");
  const [savingPrice, setSavingPrice] = useState(false);
  const [special, setSpecial] = useState<any>(null);
  const [specialName, setSpecialName] = useState("Promo");
  const [specialPrice, setSpecialPrice] = useState("");
  const [savingSpecial, setSavingSpecial] = useState(false);
  const [blockedByProp, setBlockedByProp] = useState<Record<string, string[]>>({});
  const [blockMode, setBlockMode] = useState(false);
  const [blockConfirm, setBlockConfirm] = useState<
    | { kind: "create"; propId: string; ci: string; co: string }
    | { kind: "delete"; res: any }
    | null
  >(null);
  const [blockNote, setBlockNote] = useState("");
  const [savingBlock, setSavingBlock] = useState(false);
  const [blockError, setBlockError] = useState("");
  const [dynOn, setDynOn] = useState(false);
  const [dynMap, setDynMap] = useState<Record<string, { suggested: number; delta: number }>>({});
  const [dynInfo, setDynInfo] = useState<{ occupancy_rate: number; comps_count: number } | null>(null);

  const load = useCallback(async () => {
    try {
      const [pr, res, ivs] = await Promise.all([
        api.get("/properties"),
        api.get("/reservations"),
        api.get("/interventions"),
      ]);
      setProps((pr || []).slice().sort((a: any, b: any) => (a.name || "").localeCompare(b.name || "", "fr", { sensitivity: "base" })));
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

  const loadBlocked = useCallback(() => {
    const s = anchor.startOf("month").format("YYYY-MM-DD");
    const e = anchor.endOf("month").format("YYYY-MM-DD");
    api.get(`/availability/blocked?start=${s}&end=${e}`)
      .then((r) => setBlockedByProp(r.blocks || {}))
      .catch(() => setBlockedByProp({}));
  }, [anchor]);

  useEffect(() => { loadBlocked(); }, [loadBlocked]);

  const openQuickBlock = (pid: string, ci: string, co: string) => {
    setBlockNote("");
    setBlockError("");
    setBlockConfirm({ kind: "create", propId: pid, ci, co });
  };

  const confirmQuickBlock = async () => {
    if (!blockConfirm || blockConfirm.kind !== "create" || savingBlock) return;
    setSavingBlock(true);
    setBlockError("");
    try {
      const note = blockNote.trim();
      await api.post("/reservations", {
        property_id: blockConfirm.propId,
        guest_name: note || "Blocage",
        platform: "Direct",
        check_in: blockConfirm.ci,
        check_out: blockConfirm.co,
        status: "bloque",
        notes: note,
      });
      setBlockConfirm(null);
      load();
      loadBlocked();
    } catch (e: any) {
      setBlockError(e?.message || "Impossible de bloquer ces dates.");
    } finally {
      setSavingBlock(false);
    }
  };

  const confirmUnblock = async () => {
    if (!blockConfirm || blockConfirm.kind !== "delete" || savingBlock) return;
    setSavingBlock(true);
    setBlockError("");
    try {
      await api.del(`/reservations/${blockConfirm.res.id}`);
      setBlockConfirm(null);
      load();
      loadBlocked();
    } catch (e: any) {
      setBlockError(e?.message || "Impossible de débloquer ces dates.");
    } finally {
      setSavingBlock(false);
    }
  };

  const blockedSets = useMemo(() => {
    const m: Record<string, Set<string>> = {};
    Object.entries(blockedByProp).forEach(([pid, dates]) => { m[pid] = new Set(dates as string[]); });
    return m;
  }, [blockedByProp]);

  const propMap = useMemo(() => {
    const m: Record<string, any> = {};
    props.forEach((p) => (m[p.id] = p));
    return m;
  }, [props]);

  const activeMember = members.find((m) => m.id === selectedMember);
  const memberPropIds: string[] | null = activeMember ? (activeMember.property_ids || []) : null;
  const inScope = (pid: string) =>
    (selectedProp === "all" || pid === selectedProp) && (!memberPropIds || memberPropIds.includes(pid));
  const rows = props
    .filter((p) => inScope(p.id))
    .slice()
    .sort((a, b) => (a.name || "").localeCompare(b.name || "", "fr", { sensitivity: "base" }));
  const singleProp = rows.length === 1 ? rows[0] : null;
  const filtered = reservations.filter((r) => inScope(r.property_id));
  const filteredIvs = interventions.filter((iv) => inScope(iv.property_id));

  const monthStart = anchor.startOf("month");
  const daysInMonth = anchor.daysInMonth();
  const days = Array.from({ length: daysInMonth }, (_, i) => monthStart.add(i, "day"));
  const todayStr = dayjs().format("YYYY-MM-DD");

  useEffect(() => {
    if (!dynOn || !singleProp) { setDynMap({}); setDynInfo(null); return; }
    const s = monthStart.format("YYYY-MM-DD");
    const e = anchor.endOf("month").format("YYYY-MM-DD");
    api.get(`/properties/${singleProp.id}/dynamic-pricing?start=${s}&end=${e}`)
      .then((r) => {
        const m: Record<string, { suggested: number; delta: number }> = {};
        (r.days || []).forEach((d: any) => { m[d.date] = { suggested: d.suggested, delta: d.delta }; });
        setDynMap(m);
        setDynInfo({ occupancy_rate: r.occupancy_rate, comps_count: r.comps_count });
      })
      .catch(() => { setDynMap({}); setDynInfo(null); });
  }, [dynOn, singleProp?.id, anchor]);

  async function applyDynamic(dayStr: string, price: number) {
    if (!singleProp) return;
    const season = { id: `dyn_${Date.now()}`, name: "Tarif dynamique", start_date: dayStr, end_date: dayStr, price };
    const body: any = { ...singleProp, seasons: [season, ...(singleProp.seasons || [])] };
    try {
      const updated = await api.put(`/properties/${singleProp.id}`, body);
      setProps((list) => list.map((p) => (p.id === singleProp.id ? updated : p)));
    } catch {}
  }

  function openEditPrice(dayStr: string) {
    if (!singleProp || !canModify(user)) return;
    const season = (singleProp.seasons || []).find(
      (s: any) => s.start_date && s.end_date && dayStr >= s.start_date && dayStr <= s.end_date,
    );
    setEditPrice({
      dayStr,
      seasonId: season?.id || null,
      seasonName: season?.name || "Prix de base (hors saison)",
      range: season ? `${season.start_date} → ${season.end_date}` : "S'applique à toutes les dates sans saison",
    });
    setPriceInput(String(season?.price ?? singleProp.base_price ?? ""));
  }

  async function savePrice() {
    if (!singleProp || savingPrice) return;
    const val = parseFloat((priceInput || "0").replace(",", ".")) || 0;
    setSavingPrice(true);
    try {
      const body: any = { ...singleProp };
      if (editPrice.seasonId) {
        body.seasons = (singleProp.seasons || []).map((s: any) =>
          s.id === editPrice.seasonId ? { ...s, price: val } : s,
        );
      } else {
        body.base_price = val;
      }
      const updated = await api.put(`/properties/${singleProp.id}`, body);
      setProps((list) => list.map((p) => (p.id === singleProp.id ? updated : p)));
      setEditPrice(null);
    } catch {}
    setSavingPrice(false);
  }

  function openSpecial(ci: string, coInclusive: string) {
    if (!singleProp || !canModify(user)) return;
    setSpecial({ start: ci, end: coInclusive });
    setSpecialName("Promo");
    setSpecialPrice(String(singleProp.base_price ?? ""));
  }

  async function saveSpecial() {
    if (!singleProp || savingSpecial || !special) return;
    const val = parseFloat((specialPrice || "0").replace(",", ".")) || 0;
    setSavingSpecial(true);
    try {
      const season = {
        id: `promo_${Date.now()}`,
        name: (specialName || "Promo").trim() || "Promo",
        start_date: special.start,
        end_date: special.end,
        price: val,
      };
      // On place le tarif spécial en tête pour qu'il prime sur les autres saisons
      const body: any = { ...singleProp, seasons: [season, ...(singleProp.seasons || [])] };
      const updated = await api.put(`/properties/${singleProp.id}`, body);
      setProps((list) => list.map((p) => (p.id === singleProp.id ? updated : p)));
      setSpecial(null);
      setPriceMode(false);
    } catch {}
    setSavingSpecial(false);
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <View style={styles.headerTop}>
          <View style={styles.titleRow}>
            <MenuButton />
            <Text style={styles.title}>Calendrier</Text>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}>
            <HelpButton screen="planning" />
            <Pressable
              testID="open-color-settings"
              onPress={() => router.push("/settings/status-colors")}
              style={styles.gear}
            >
              <Ionicons name="color-palette-outline" size={20} color={colors.onSurface} />
            </Pressable>
          </View>
        </View>

        <View style={styles.priceControls}>
          <Pressable
            testID="toggle-prices"
            onPress={() => { setShowPrices((s) => !s); if (priceMode) setPriceMode(false); }}
            style={[styles.priceToggle, showPrices && styles.priceToggleOn]}
          >
            <Ionicons name="pricetags-outline" size={14} color={showPrices ? colors.onBrandPrimary : colors.brandPrimary} />
            <Text style={[styles.priceToggleText, showPrices && { color: colors.onBrandPrimary }]}>
              {showPrices ? "Masquer les tarifs" : "Afficher les tarifs"}
            </Text>
          </Pressable>
          {showPrices && singleProp && canModify(user) && mode === "timeline" && (
            <Pressable
              testID="toggle-price-mode"
              onPress={() => setPriceMode((s) => !s)}
              style={[styles.priceToggle, priceMode && styles.priceToggleOn]}
            >
              <Ionicons name="flash-outline" size={14} color={priceMode ? colors.onBrandPrimary : colors.brandPrimary} />
              <Text style={[styles.priceToggleText, priceMode && { color: colors.onBrandPrimary }]}>
                {priceMode ? "Annuler" : "Tarif spécial (promo)"}
              </Text>
            </Pressable>
          )}
          {showPrices && singleProp && canModify(user) && mode === "timeline" && (
            <Pressable
              testID="toggle-dynamic"
              onPress={() => setDynOn((s) => !s)}
              style={[styles.priceToggle, dynOn && styles.priceToggleOn]}
            >
              <Ionicons name="trending-up-outline" size={14} color={dynOn ? colors.onBrandPrimary : colors.brandPrimary} />
              <Text style={[styles.priceToggleText, dynOn && { color: colors.onBrandPrimary }]}>
                {dynOn ? "Masquer suggestions" : "Tarifs dynamiques"}
              </Text>
            </Pressable>
          )}
        </View>
        {dynOn && singleProp && dynInfo && (
          <View style={styles.priceHint}>
            <Ionicons name="trending-up" size={14} color={colors.brandPrimary} />
            <Text style={styles.priceHintText}>
              Suggestions (gris) basées sur {dynInfo.comps_count} logement(s) comparable(s) · occupation {dynInfo.occupancy_rate}%. Touchez un prix suggéré pour l'appliquer.
            </Text>
          </View>
        )}
        {showPrices && !singleProp && (
          <View style={styles.priceHint}>
            <Ionicons name="information-circle-outline" size={14} color={colors.onSurfaceTertiary} />
            <Text style={styles.priceHintText}>Tarif/nuit affiché sur chaque ligne. Sélectionnez un logement pour modifier les tarifs.</Text>
          </View>
        )}

        {mode === "timeline" && canModify(user) && (
          <View style={styles.priceControls}>
            <Pressable
              testID="toggle-block-mode"
              onPress={() => { setBlockMode((s) => !s); if (!blockMode && priceMode) setPriceMode(false); }}
              style={[styles.priceToggle, blockMode && styles.blockToggleOn]}
            >
              <Ionicons name="lock-closed-outline" size={14} color={blockMode ? "#fff" : colors.brandPrimary} />
              <Text style={[styles.priceToggleText, blockMode && { color: "#fff" }]}>
                {blockMode ? "Annuler le blocage" : "Bloquer des dates"}
              </Text>
            </Pressable>
          </View>
        )}

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
          showPrices={showPrices}
          priceProp={singleProp}
          onEditPrice={openEditPrice}
          dynMap={dynMap}
          onApplyDyn={applyDynamic}
          priceMode={priceMode && !!singleProp}
          onPriceRange={openSpecial}
          blockMode={blockMode}
          onBlock={openQuickBlock}
          onBar={(id: string) => {
            const r = reservations.find((x) => x.id === id);
            if (blockMode && r && r.status === "bloque") {
              setBlockError("");
              setBlockConfirm({ kind: "delete", res: r });
              return;
            }
            router.push(`/reservation-form?id=${id}`);
          }}
          onIv={(id: string) => router.push(`/intervention-form?id=${id}`)}
          onCreate={(pid: string, ci: string, co: string) =>
            router.push(`/reservation-form?property=${pid}&check_in=${ci}&check_out=${co}`)}
          blockedSets={blockedSets}
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
          showPrices={showPrices && !!singleProp}
          priceProp={singleProp}
          onEditPrice={openEditPrice}
          selectedDay={selectedDay}
          setSelectedDay={setSelectedDay}
          todayStr={todayStr}
          onRes={(id: string) => router.push(`/reservation-form?id=${id}`)}
          onIv={(id: string) => router.push(`/intervention-form?id=${id}`)}
          blockedSets={blockedSets}
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

      <Modal visible={!!editPrice} transparent animationType="fade" onRequestClose={() => setEditPrice(null)}>
        <Pressable style={styles.priceBackdrop} onPress={() => setEditPrice(null)}>
          <Pressable style={styles.priceSheet} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.priceSheetTitle}>Modifier le tarif</Text>
            {!!editPrice && (
              <>
                <Text style={styles.priceSheetSeason}>{editPrice.seasonName}</Text>
                <Text style={styles.priceSheetRange}>{editPrice.range}</Text>
                <View style={styles.priceInputWrap}>
                  <TextInput
                    testID="edit-price-input"
                    value={priceInput}
                    onChangeText={setPriceInput}
                    keyboardType="decimal-pad"
                    placeholder="0"
                    placeholderTextColor={colors.onSurfaceTertiary}
                    style={styles.priceInput}
                    autoFocus
                  />
                  <Text style={styles.priceInputUnit}>€ / nuit</Text>
                </View>
                <Pressable testID="edit-price-save" onPress={savePrice} disabled={savingPrice} style={[styles.priceSaveBtn, savingPrice && { opacity: 0.6 }]}>
                  {savingPrice ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.priceSaveText}>Enregistrer</Text>}
                </Pressable>
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={!!special} transparent animationType="fade" onRequestClose={() => setSpecial(null)}>
        <Pressable style={styles.priceBackdrop} onPress={() => setSpecial(null)}>
          <Pressable style={styles.priceSheet} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.priceSheetTitle}>Tarif spécial</Text>
            {!!special && (
              <>
                <Text style={styles.priceSheetSeason}>{singleProp?.name}</Text>
                <Text style={styles.priceSheetRange}>
                  Du {dayjs(special.start).format("DD MMM")} au {dayjs(special.end).format("DD MMM YYYY")}
                </Text>
                <Text style={styles.specialLabel}>Nom (promo, événement…)</Text>
                <TextInput
                  testID="special-name-input"
                  value={specialName}
                  onChangeText={setSpecialName}
                  placeholder="Promo"
                  placeholderTextColor={colors.onSurfaceTertiary}
                  style={styles.specialNameInput}
                />
                <View style={styles.priceInputWrap}>
                  <TextInput
                    testID="special-price-input"
                    value={specialPrice}
                    onChangeText={setSpecialPrice}
                    keyboardType="decimal-pad"
                    placeholder="0"
                    placeholderTextColor={colors.onSurfaceTertiary}
                    style={styles.priceInput}
                    autoFocus
                  />
                  <Text style={styles.priceInputUnit}>€ / nuit</Text>
                </View>
                <Pressable testID="special-price-save" onPress={saveSpecial} disabled={savingSpecial} style={[styles.priceSaveBtn, savingSpecial && { opacity: 0.6 }]}>
                  {savingSpecial ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.priceSaveText}>Appliquer le tarif spécial</Text>}
                </Pressable>
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={!!blockConfirm} transparent animationType="fade" onRequestClose={() => setBlockConfirm(null)}>
        <Pressable style={styles.priceBackdrop} onPress={() => setBlockConfirm(null)}>
          <Pressable style={styles.priceSheet} onPress={(e) => e.stopPropagation()}>
            {blockConfirm?.kind === "create" && (
              <>
                <Text style={styles.priceSheetTitle}>Bloquer ces dates ?</Text>
                <Text style={styles.priceSheetSeason}>{propMap[blockConfirm.propId]?.name}</Text>
                <Text style={styles.priceSheetRange}>
                  {(() => {
                    const n = dayjs(blockConfirm.co).diff(dayjs(blockConfirm.ci), "day");
                    return `Du ${dayjs(blockConfirm.ci).format("DD MMM")} au ${dayjs(blockConfirm.co).format("DD MMM YYYY")} · ${n} nuit${n > 1 ? "s" : ""}`;
                  })()}
                </Text>
                <Text style={styles.specialLabel}>Motif (optionnel)</Text>
                <TextInput
                  testID="quick-block-note"
                  value={blockNote}
                  onChangeText={setBlockNote}
                  placeholder="Travaux, perso, entretien…"
                  placeholderTextColor={colors.onSurfaceTertiary}
                  style={styles.specialNameInput}
                />
                {!!blockError && <Text style={styles.blockErrorText}>{blockError}</Text>}
                <Pressable testID="quick-block-save" onPress={confirmQuickBlock} disabled={savingBlock} style={[styles.blockSaveBtn, savingBlock && { opacity: 0.6 }]}>
                  {savingBlock ? <ActivityIndicator color="#fff" /> : (
                    <>
                      <Ionicons name="lock-closed" size={15} color="#fff" />
                      <Text style={styles.priceSaveText}>Bloquer immédiatement</Text>
                    </>
                  )}
                </Pressable>
              </>
            )}
            {blockConfirm?.kind === "delete" && (
              <>
                <Text style={styles.priceSheetTitle}>Débloquer ces dates ?</Text>
                <Text style={styles.priceSheetSeason}>{propMap[blockConfirm.res.property_id]?.name}</Text>
                <Text style={styles.priceSheetRange}>
                  {`Du ${dayjs(blockConfirm.res.check_in).format("DD MMM")} au ${dayjs(blockConfirm.res.check_out).format("DD MMM YYYY")}`}
                </Text>
                {!!blockConfirm.res.guest_name && blockConfirm.res.guest_name !== "Blocage" && (
                  <Text style={styles.priceSheetRange}>{`Motif : ${blockConfirm.res.guest_name}`}</Text>
                )}
                {!!blockError && <Text style={styles.blockErrorText}>{blockError}</Text>}
                <Pressable testID="quick-unblock-confirm" onPress={confirmUnblock} disabled={savingBlock} style={[styles.unblockBtn, savingBlock && { opacity: 0.6 }]}>
                  {savingBlock ? <ActivityIndicator color="#fff" /> : (
                    <>
                      <Ionicons name="lock-open" size={15} color="#fff" />
                      <Text style={styles.priceSaveText}>Débloquer ces dates</Text>
                    </>
                  )}
                </Pressable>
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function TimelineView({ rows, days, monthStart, daysInMonth, filtered, interventions, statusColors, statuses, todayStr, showPrices, priceProp, onEditPrice, priceMode, onPriceRange, blockMode, onBlock, onBar, onIv, onCreate, blockedSets, bottomPad, dynMap, onApplyDyn }: any) {
  const { user } = useAuth();
  const headH = (showPrices && priceProp) ? DAYHEAD_H + (dynMap && Object.keys(dynMap).length ? 30 : 16) : DAYHEAD_H;
  const [sel, setSel] = useState<{ propId: string; a: number; b: number } | null>(null);
  const [tapSel, setTapSel] = useState<{ propId: string; a: number } | null>(null);
  const dragRef = useRef<{ propId: string; a: number; b: number } | null>(null);

  const emitRange = (propId: string, lo: number, hi: number) => {
    if (priceMode) {
      // Tarif spécial : plage inclusive (les deux jours reçoivent le prix)
      const start = days[lo].format("YYYY-MM-DD");
      const end = days[hi].format("YYYY-MM-DD");
      onPriceRange(start, end);
    } else if (blockMode) {
      const ci = days[lo].format("YYYY-MM-DD");
      const co = days[hi].add(1, "day").format("YYYY-MM-DD");
      onBlock(propId, ci, co);
    } else {
      const ci = days[lo].format("YYYY-MM-DD");
      const co = days[hi].add(1, "day").format("YYYY-MM-DD");
      onCreate(propId, ci, co);
    }
  };

  const jsTap = (propId: string, idx: number) => {
    if (!canModify(user)) return;
    setTapSel((prev) => {
      if (!prev || prev.propId !== propId) return { propId, a: idx };
      const lo = Math.min(prev.a, idx);
      const hi = Math.max(prev.a, idx);
      emitRange(propId, lo, hi);
      return null;
    });
  };

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
    emitRange(d.propId, lo, hi);
  };

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: bottomPad }} showsVerticalScrollIndicator={false}>
      <View style={[styles.dragHint, (priceMode || blockMode) && styles.dragHintPromo]}>
        <Ionicons name={blockMode ? "lock-closed" : priceMode ? "flash" : "hand-left-outline"} size={13} color={(priceMode || blockMode) ? colors.brandPrimary : colors.onSurfaceTertiary} />
        <Text style={[styles.dragHintText, (priceMode || blockMode) && { color: colors.brandPrimary, fontFamily: font.semibold }]}>
          {blockMode
            ? "Mode blocage : touchez la date de début puis la date de fin — le blocage est créé en un geste. Touchez un blocage existant pour le débloquer."
            : priceMode
            ? "Mode tarif spécial : touchez la date de début puis la date de fin de la promo."
            : "Touchez la date de début puis la date de fin pour créer une réservation (ou maintenez et glissez)"}
        </Text>
      </View>
      <View style={{ flexDirection: "row" }}>
        {/* Left fixed column */}
        <View style={{ width: LEFT_W }}>
          <View style={[styles.corner, { height: headH }]} />
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
            <View style={{ flexDirection: "row", height: headH }}>
              {days.map((d: any) => {
                const dStr = d.format("YYYY-MM-DD");
                const isToday = dStr === todayStr;
                const weekend = d.day() === 0 || d.day() === 6;
                const price = (showPrices && priceProp) ? priceForDay(priceProp, dStr) : null;
                return (
                  <View key={d.valueOf()} style={[styles.dayHead, { height: headH }, weekend && styles.weekendBg, isToday && styles.todayHead]}>
                    <Text style={[styles.dowText, isToday && styles.todayText]}>{d.format("dd")[0]}</Text>
                    <Text style={[styles.domText, isToday && styles.todayText]}>{d.date()}</Text>
                    {showPrices && priceProp && (
                      <Pressable testID={`price-${dStr}`} onPress={() => onEditPrice && onEditPrice(dStr)} hitSlop={4}>
                        <Text style={[styles.priceText, isToday && styles.todayText]} numberOfLines={1}>
                          {price != null ? `${Math.round(price)}€` : "—"}
                        </Text>
                      </Pressable>
                    )}
                    {showPrices && priceProp && dynMap && dynMap[dStr] && (
                      <Pressable testID={`dyn-${dStr}`} onPress={() => onApplyDyn && onApplyDyn(dStr, dynMap[dStr].suggested)} hitSlop={4}>
                        <Text style={styles.dynText} numberOfLines={1}>{Math.round(dynMap[dStr].suggested)}€</Text>
                      </Pressable>
                    )}
                  </View>
                );
              })}
            </View>
            {/* Rows */}
            {rows.map((p: any) => {
              const rowRes = filtered.filter((r: any) => r.property_id === p.id);
              const rowIvs = interventions.filter((iv: any) => iv.property_id === p.id);
              const occ = new Set<string>();
              if (showPrices) {
                for (const r of rowRes) {
                  let cur = dayjs(r.check_in);
                  const end = dayjs(r.check_out);
                  while (cur.isBefore(end)) { occ.add(cur.format("YYYY-MM-DD")); cur = cur.add(1, "day"); }
                }
              }
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
              const tap = Gesture.Tap()
                .maxDuration(250)
                .onEnd((e) => {
                  const idx = Math.max(0, Math.min(daysInMonth - 1, Math.floor(e.x / DAY_W)));
                  runOnJS(jsTap)(p.id, idx);
                });
              const composed = Gesture.Exclusive(pan, tap);
              return (
                <GestureDetector key={p.id} gesture={composed}>
                  <View style={{ width: daysInMonth * DAY_W, height: ROW_H }}>
                  {/* background cells */}
                  <View style={{ flexDirection: "row" }}>
                    {days.map((d: any) => {
                      const weekend = d.day() === 0 || d.day() === 6;
                      const dStr = d.format("YYYY-MM-DD");
                      const isToday = dStr === todayStr;
                      const blocked = blockedSets?.[p.id]?.has(dStr);
                      const cellPrice = (showPrices && !blocked && !occ.has(dStr)) ? priceForDay(p, dStr) : null;
                      return (
                        <View
                          key={d.valueOf()}
                          style={[styles.gridCell, weekend && styles.weekendBg, isToday && styles.todayCol, blocked && styles.blockedCell]}
                        >
                          {blocked && <Ionicons name="lock-closed" size={9} color="#9AA0A6" style={styles.blockedIcon} />}
                          {cellPrice != null && (
                            <Text style={styles.cellPrice} numberOfLines={1}>{Math.round(cellPrice)}€</Text>
                          )}
                        </View>
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
                  {/* tap start marker (tap start then end to create) */}
                  {tapSel && tapSel.propId === p.id && (
                    <View pointerEvents="none" style={[styles.tapStart, { left: tapSel.a * DAY_W }]}>
                      <Text style={styles.tapStartText}>Début</Text>
                    </View>
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

function ChecklistDots({ checklist }: { checklist?: any }) {
  const items = [
    { key: "caution", icon: "shield-checkmark" },
    { key: "keys", icon: "key" },
    { key: "welcome_book", icon: "book" },
    { key: "cleaning", icon: "sparkles" },
  ];
  const done = items.filter((it) => checklist && checklist[it.key]).length;
  if (done === 0 && !checklist) return null;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 5, marginTop: 4 }}>
      {items.map((it) => {
        const on = !!(checklist && checklist[it.key]);
        return <Ionicons key={it.key} name={(on ? it.icon : `${it.icon}-outline`) as any} size={12} color={on ? "#17B0A6" : "#C7C7CC"} />;
      })}
      <Text style={{ fontSize: 10, color: "#8E8E93", marginLeft: 2 }}>{done}/4</Text>
    </View>
  );
}


function MonthView({ anchor, daysInMonth, monthStart, filtered, interventions, propMap, statusColors, single, showPrices, priceProp, onEditPrice, selectedDay, setSelectedDay, todayStr, onRes, onIv, blockedSets, bottomPad }: any) {
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
          const isBlocked = single && priceProp && res.length === 0 && blockedSets?.[priceProp.id]?.has(dayStr);
          return (
            <Pressable
              key={dayStr}
              testID={`day-${dayStr}`}
              onPress={() => setSelectedDay(dayStr)}
              style={[
                styles.dayCell,
                single && res.length > 0 && { backgroundColor: tint(firstColor, "33") },
                isBlocked && styles.blockedCell,
                isSel && styles.daySel,
              ]}
            >
              {isBlocked && <Ionicons name="lock-closed" size={10} color="#9AA0A6" style={styles.blockedBadge} />}
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
              {showPrices && priceProp && (() => {
                const pr = priceForDay(priceProp, dayStr);
                return (
                  <Text
                    testID={`month-price-${dayStr}`}
                    onPress={() => onEditPrice && onEditPrice(dayStr)}
                    style={styles.monthPrice}
                    numberOfLines={1}
                  >
                    {pr != null ? `${Math.round(pr)}€` : "—"}
                  </Text>
                );
              })()}
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
          <View style={styles.dayDetailBody}>
          {selRes.length === 0 && selIvs.length === 0 ? (
            <Text style={styles.detailEmpty}>Journée libre ✓</Text>
          ) : (
            <>
              {selRes.map((r: any) => (
                <Pressable key={r.id} testID={`day-res-${r.id}`} onPress={() => onRes(r.id)} style={styles.detailCard}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.detailGuest}>{guestLabel(user, r.guest_name)}</Text>
                    <Text style={styles.detailProp}>{propMap[r.property_id]?.name || "Logement"}</Text>
                    <ChecklistDots checklist={r.checklist} />
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
  priceToggle: { flexDirection: "row", alignItems: "center", gap: 5, alignSelf: "flex-start", paddingVertical: 6, paddingHorizontal: spacing.md, borderRadius: radius.pill, backgroundColor: colors.brandPrimary + "12", borderWidth: 1, borderColor: colors.brandPrimary + "33" },
  priceControls: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.md },
  priceHint: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.surfaceSecondary, paddingVertical: 8, paddingHorizontal: spacing.md, borderRadius: radius.md, marginBottom: spacing.md },
  priceHintText: { flex: 1, fontFamily: font.regular, fontSize: fontSize.sm, color: colors.onSurfaceSecondary },
  dragHintPromo: { backgroundColor: colors.brandPrimary + "12", marginHorizontal: spacing.lg, borderRadius: radius.md, paddingVertical: 6 },
  specialLabel: { fontFamily: font.medium, fontSize: fontSize.sm, color: colors.onSurfaceSecondary, marginTop: spacing.lg, marginBottom: 6 },
  specialNameInput: { fontFamily: font.medium, fontSize: fontSize.lg, color: colors.onSurface, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: 12 },
  priceToggleOn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  blockToggleOn: { backgroundColor: "#6E6E73", borderColor: "#6E6E73" },
  priceToggleText: { fontFamily: font.semibold, fontSize: fontSize.sm, color: colors.brandPrimary },
  priceText: { fontFamily: font.semibold, fontSize: 10, color: colors.brandPrimary, marginTop: 1 },
  dynText: { fontFamily: font.semibold, fontSize: 10, color: "#9AA0A6", marginTop: 1, textDecorationLine: "underline" },
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
  cellPrice: { position: "absolute", bottom: 3, alignSelf: "center", fontFamily: font.medium, fontSize: 9, color: colors.onSurfaceTertiary },
  blockedCell: { backgroundColor: "#EDEEF0" },
  blockedIcon: { position: "absolute", top: 3, alignSelf: "center", opacity: 0.7 },
  blockedBadge: { position: "absolute", top: 3, right: 3, opacity: 0.8 },
  bar: {
    position: "absolute", top: 10, height: ROW_H - 20, borderRadius: 7,
    paddingHorizontal: 5, flexDirection: "row", alignItems: "center", gap: 4,
  },
  barText: { fontFamily: font.semibold, fontSize: 12, color: "#fff", flexShrink: 1 },
  dragHint: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: 2 },
  dragHintText: { fontFamily: font.regular, fontSize: 11, color: colors.onSurfaceTertiary },
  selBar: { position: "absolute", top: 6, bottom: 6, borderRadius: 7, backgroundColor: "rgba(10,132,255,0.22)", borderWidth: 1.5, borderColor: "#0A84FF" },
  tapStart: { position: "absolute", top: 6, bottom: 6, width: DAY_W, borderRadius: 7, backgroundColor: "rgba(10,132,255,0.28)", borderWidth: 1.5, borderColor: "#0A84FF", alignItems: "center", justifyContent: "center" },
  tapStartText: { fontFamily: font.semibold, fontSize: 9, color: "#0A84FF" },
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
  monthPrice: { position: "absolute", bottom: 3, alignSelf: "center", fontFamily: font.semibold, fontSize: 9, color: colors.brandPrimary },
  dayDetail: { marginTop: spacing.xl, backgroundColor: colors.surface, borderRadius: 20, overflow: "hidden", borderWidth: 1, borderColor: colors.border, shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 4 },
  detailTitle: { fontFamily: font.bold, fontSize: fontSize.lg, color: "#fff", backgroundColor: "#2A6F9E", paddingVertical: spacing.md, paddingHorizontal: spacing.lg, textTransform: "capitalize" },
  detailEmpty: { fontFamily: font.regular, fontSize: fontSize.base, color: colors.onSurfaceTertiary, padding: spacing.lg },
  dayDetailBody: { padding: spacing.md },
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
  priceBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center", padding: spacing.xl },
  priceSheet: { backgroundColor: colors.surface, borderRadius: 20, padding: spacing.xl, shadowColor: "#000", shadowOpacity: 0.18, shadowRadius: 24, shadowOffset: { width: 0, height: 8 }, elevation: 10 },
  priceSheetTitle: { fontFamily: font.bold, fontSize: fontSize.xl, color: "#2A6F9E" },
  priceSheetSeason: { fontFamily: font.semibold, fontSize: fontSize.lg, color: colors.brandPrimary, marginTop: spacing.md },
  priceSheetRange: { fontFamily: font.regular, fontSize: fontSize.sm, color: colors.onSurfaceTertiary, marginTop: 2 },
  priceInputWrap: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, paddingHorizontal: spacing.lg, marginTop: spacing.lg },
  priceInput: { flex: 1, fontFamily: font.bold, fontSize: fontSize.xxl, color: colors.onSurface, paddingVertical: 12 },
  priceInputUnit: { fontFamily: font.medium, fontSize: fontSize.base, color: colors.onSurfaceTertiary },
  priceSaveBtn: { marginTop: spacing.lg, backgroundColor: "#17B0A6", borderRadius: radius.pill, paddingVertical: 14, alignItems: "center" },
  blockSaveBtn: { marginTop: spacing.lg, backgroundColor: "#6E6E73", borderRadius: radius.pill, paddingVertical: 14, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 8 },
  unblockBtn: { marginTop: spacing.lg, backgroundColor: colors.error, borderRadius: radius.pill, paddingVertical: 14, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 8 },
  blockErrorText: { fontFamily: font.medium, fontSize: fontSize.sm, color: colors.error, marginTop: spacing.md },
  priceSaveText: { fontFamily: font.semibold, fontSize: fontSize.lg, color: colors.onBrandPrimary },
});
