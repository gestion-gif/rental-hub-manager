import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  RefreshControl,
  Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import dayjs from "dayjs";
import "dayjs/locale/fr";
dayjs.locale("fr");

import { api } from "@/src/api";
import { PropertyPicker } from "@/src/components/PropertyPicker";
import { colors, font, fontSize, radius, spacing } from "@/src/theme";

type Tab = "apercu" | "journal" | "recurrent";

export default function Accounting() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [month, setMonth] = useState(dayjs().format("YYYY-MM"));
  const [tab, setTab] = useState<Tab>("apercu");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [summary, setSummary] = useState<any>(null);
  const [txs, setTxs] = useState<any[]>([]);
  const [recurring, setRecurring] = useState<any[]>([]);
  const [properties, setProperties] = useState<any[]>([]);
  const [typeFilter, setTypeFilter] = useState<"all" | "recette" | "depense">("all");
  const [propFilter, setPropFilter] = useState("all");
  const [importing, setImporting] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, t, r, p] = await Promise.all([
        api.get(`/accounting/summary?month=${month}`),
        api.get(`/accounting/transactions?month=${month}`),
        api.get(`/accounting/recurring`),
        api.get(`/properties`),
      ]);
      setSummary(s);
      setTxs(t || []);
      setRecurring(r || []);
      setProperties((p || []).map((x: any) => ({ id: x.id, name: x.name })));
    } catch {}
    setLoading(false);
    setRefreshing(false);
  }, [month]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  function shiftMonth(delta: number) {
    setMonth((m) => dayjs(m + "-01").add(delta, "month").format("YYYY-MM"));
  }

  async function importRevenues() {
    if (importing) return;
    setImporting(true);
    try {
      const res = await api.post("/accounting/import-revenues", { month });
      Alert.alert(
        "Import terminé",
        `${res.created} revenu(s) importé(s)${res.skipped ? ` · ${res.skipped} déjà présent(s)` : ""}.`,
      );
      await load();
    } catch {
      Alert.alert("Erreur", "Import impossible.");
    }
    setImporting(false);
  }

  const filteredTxs = txs.filter((t) => {
    if (typeFilter !== "all" && t.type !== typeFilter) return false;
    if (propFilter !== "all" && t.property_id !== propFilter) return false;
    return true;
  });

  const monthLabel = dayjs(month + "-01").format("MMMM YYYY");

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="accounting-back" onPress={() => router.back()} style={styles.iconBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Comptabilité</Text>
        <Pressable testID="accounting-recurring-add" onPress={() => router.push("/accounting-recurring-form")} style={styles.iconBtn}>
          <Ionicons name="repeat" size={20} color={colors.onSurface} />
        </Pressable>
      </View>

      {/* Sélecteur de période */}
      <View style={styles.monthRow}>
        <Pressable testID="month-prev" onPress={() => shiftMonth(-1)} style={styles.monthArrow}>
          <Ionicons name="chevron-back" size={18} color={colors.onSurfaceSecondary} />
        </Pressable>
        <Text style={styles.monthLabel}>{monthLabel}</Text>
        <Pressable testID="month-next" onPress={() => shiftMonth(1)} style={styles.monthArrow}>
          <Ionicons name="chevron-forward" size={18} color={colors.onSurfaceSecondary} />
        </Pressable>
      </View>

      {/* Onglets */}
      <View style={styles.tabs}>
        {([["apercu", "Aperçu"], ["journal", "Journal"], ["recurrent", "Récurrent"]] as [Tab, string][]).map(([k, lbl]) => (
          <Pressable key={k} testID={`tab-${k}`} onPress={() => setTab(k)} style={[styles.tab, tab === k && styles.tabActive]}>
            <Text style={[styles.tabText, tab === k && styles.tabTextActive]}>{lbl}</Text>
          </Pressable>
        ))}
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 60 }} color={colors.brandPrimary} />
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120 }}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
        >
          {tab === "apercu" && summary && (
            <ApercuTab summary={summary} onImport={importRevenues} importing={importing} />
          )}

          {tab === "journal" && (
            <>
              <View style={styles.filterRow}>
                {(["all", "recette", "depense"] as const).map((k) => (
                  <Pressable key={k} testID={`filter-${k}`} onPress={() => setTypeFilter(k)} style={[styles.chip, typeFilter === k && styles.chipActive]}>
                    <Text style={[styles.chipText, typeFilter === k && styles.chipTextActive]}>
                      {k === "all" ? "Tout" : k === "recette" ? "Recettes" : "Dépenses"}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <View style={{ marginBottom: spacing.md }}>
                <PropertyPicker value={propFilter} items={properties} onSelect={setPropFilter} />
              </View>
              {filteredTxs.length === 0 ? (
                <EmptyRow text="Aucune écriture sur cette période" />
              ) : (
                filteredTxs.map((t) => (
                  <Pressable key={t.id} testID={`tx-${t.id}`} onPress={() => router.push(`/accounting-form?id=${t.id}`)} style={styles.txRow}>
                    <View style={[styles.txIcon, { backgroundColor: (t.type === "recette" ? colors.success : colors.error) + "1A" }]}>
                      <Ionicons name={t.type === "recette" ? "arrow-down" : "arrow-up"} size={16} color={t.type === "recette" ? colors.success : colors.error} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.txCat} numberOfLines={1}>{t.category || (t.type === "recette" ? "Recette" : "Dépense")}</Text>
                      <Text style={styles.txMeta} numberOfLines={1}>
                        {dayjs(t.date).format("DD MMM")}{t.supplier ? ` · ${t.supplier}` : t.property_name ? ` · ${t.property_name}` : t.description ? ` · ${t.description}` : ""}
                      </Text>
                    </View>
                    <View style={{ alignItems: "flex-end" }}>
                      <Text style={[styles.txAmount, { color: t.type === "recette" ? colors.success : colors.onSurface }]}>
                        {t.type === "recette" ? "+" : "−"}{t.amount_ttc.toFixed(2)} €
                      </Text>
                      {t.vat_rate > 0 && <Text style={styles.txVat}>TVA {t.vat_rate}%</Text>}
                    </View>
                  </Pressable>
                ))
              )}
            </>
          )}

          {tab === "recurrent" && (
            <>
              <Pressable testID="add-recurring" onPress={() => router.push("/accounting-recurring-form")} style={styles.addRecurring}>
                <Ionicons name="add-circle" size={20} color={colors.brandPrimary} />
                <Text style={styles.addRecurringText}>Ajouter une dépense récurrente</Text>
              </Pressable>
              {recurring.length === 0 ? (
                <EmptyRow text="Aucune dépense récurrente" />
              ) : (
                recurring.map((r) => (
                  <Pressable key={r.id} testID={`recurring-${r.id}`} onPress={() => router.push(`/accounting-recurring-form?id=${r.id}`)} style={styles.txRow}>
                    <View style={[styles.txIcon, { backgroundColor: colors.warning + "1A" }]}>
                      <Ionicons name="repeat" size={16} color={colors.warning} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.txCat} numberOfLines={1}>{r.label}</Text>
                      <Text style={styles.txMeta} numberOfLines={1}>
                        {FREQ_LABEL[r.frequency] || r.frequency}{r.property_name ? ` · ${r.property_name}` : ""}{r.active ? "" : " · inactif"}
                      </Text>
                    </View>
                    <Text style={styles.txAmount}>{Number(r.amount_ttc).toFixed(2)} €</Text>
                  </Pressable>
                ))
              )}
            </>
          )}
        </ScrollView>
      )}

      {tab !== "recurrent" && (
        <Pressable testID="accounting-fab" onPress={() => router.push(`/accounting-form?month=${month}`)} style={[styles.fab, { bottom: insets.bottom + spacing.lg }]}>
          <Ionicons name="add" size={28} color={colors.onBrandPrimary} />
        </Pressable>
      )}
    </View>
  );
}

const FREQ_LABEL: Record<string, string> = { monthly: "Mensuel", quarterly: "Trimestriel", yearly: "Annuel" };

function ApercuTab({ summary, onImport, importing }: any) {
  const s = summary;
  const depCats = Object.entries(s.by_category?.depense || {}).sort((a: any, b: any) => b[1] - a[1]);
  const maxDep = depCats.length ? Math.max(...depCats.map((c: any) => c[1])) : 0;
  return (
    <>
      <Pressable testID="import-revenues" onPress={onImport} disabled={importing} style={styles.importBtn}>
        {importing ? <ActivityIndicator size="small" color={colors.brandPrimary} /> : <Ionicons name="download-outline" size={18} color={colors.brandPrimary} />}
        <Text style={styles.importText}>Importer les revenus de la période</Text>
      </Pressable>

      <View style={styles.summaryGrid}>
        <SummaryCard label="Recettes" value={s.recettes.ttc} tint={colors.success} icon="trending-up" />
        <SummaryCard label="Dépenses" value={s.depenses.ttc} tint={colors.error} icon="trending-down" />
      </View>
      <View style={[styles.resultCard, { borderColor: (s.resultat.ttc >= 0 ? colors.success : colors.error) + "55" }]}>
        <Text style={styles.resultLabel}>Résultat de la période</Text>
        <Text style={[styles.resultValue, { color: s.resultat.ttc >= 0 ? colors.success : colors.error }]}>
          {s.resultat.ttc >= 0 ? "+" : ""}{s.resultat.ttc.toFixed(2)} €
        </Text>
        <Text style={styles.resultSub}>HT : {s.resultat.ht.toFixed(2)} €</Text>
      </View>

      <Text style={styles.sectionTitle}>TVA</Text>
      <View style={styles.tvaCard}>
        <TvaRow label="Collectée (sur recettes)" value={s.tva.collectee} />
        <TvaRow label="Déductible (sur dépenses)" value={s.tva.deductible} />
        <View style={styles.tvaSep} />
        <View style={styles.tvaRow}>
          <Text style={styles.tvaNetLabel}>TVA nette {s.tva.nette >= 0 ? "à reverser" : "crédit"}</Text>
          <Text style={[styles.tvaNetValue, { color: s.tva.nette >= 0 ? colors.onSurface : colors.success }]}>
            {Math.abs(s.tva.nette).toFixed(2)} €
          </Text>
        </View>
      </View>

      {depCats.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>Dépenses par catégorie</Text>
          <View style={styles.card}>
            {depCats.map(([cat, amt]: any) => (
              <View key={cat} style={styles.catRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.catName} numberOfLines={1}>{cat}</Text>
                  <View style={styles.barBg}>
                    <View style={[styles.barFill, { width: `${maxDep ? (amt / maxDep) * 100 : 0}%` }]} />
                  </View>
                </View>
                <Text style={styles.catAmount}>{amt.toFixed(0)} €</Text>
              </View>
            ))}
          </View>
        </>
      )}

      {(s.by_owner || []).length > 0 && (
        <>
          <Text style={styles.sectionTitle}>Par propriétaire</Text>
          <View style={styles.card}>
            {s.by_owner.map((o: any, i: number) => (
              <View key={i} style={styles.ownerRow}>
                <Text style={styles.ownerName} numberOfLines={1}>{o.name}</Text>
                <View style={styles.ownerNums}>
                  <Text style={[styles.ownerNum, { color: colors.success }]}>+{o.recettes.toFixed(0)}</Text>
                  <Text style={[styles.ownerNum, { color: colors.error }]}>−{o.depenses.toFixed(0)}</Text>
                  <Text style={[styles.ownerResult, { color: o.resultat >= 0 ? colors.onSurface : colors.error }]}>
                    {o.resultat.toFixed(0)} €
                  </Text>
                </View>
              </View>
            ))}
          </View>
        </>
      )}
    </>
  );
}

function SummaryCard({ label, value, tint, icon }: any) {
  return (
    <View style={styles.summaryCard}>
      <View style={[styles.summaryIcon, { backgroundColor: tint + "1A" }]}>
        <Ionicons name={icon} size={16} color={tint} />
      </View>
      <Text style={styles.summaryValue}>{value.toFixed(2)} €</Text>
      <Text style={styles.summaryLabel}>{label}</Text>
    </View>
  );
}

function TvaRow({ label, value }: any) {
  return (
    <View style={styles.tvaRow}>
      <Text style={styles.tvaLabel}>{label}</Text>
      <Text style={styles.tvaValue}>{value.toFixed(2)} €</Text>
    </View>
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
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  iconBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  title: { fontFamily: font.bold, fontSize: fontSize.xl, color: colors.onSurface },
  monthRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.lg, paddingVertical: spacing.sm },
  monthArrow: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  monthLabel: { fontFamily: font.semibold, fontSize: fontSize.lg, color: colors.onSurface, minWidth: 140, textAlign: "center", textTransform: "capitalize" },
  tabs: { flexDirection: "row", backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, margin: spacing.lg, marginBottom: 0, padding: 3 },
  tab: { flex: 1, paddingVertical: 9, borderRadius: radius.sm, alignItems: "center" },
  tabActive: { backgroundColor: colors.surface },
  tabText: { fontFamily: font.medium, fontSize: fontSize.base, color: colors.onSurfaceTertiary },
  tabTextActive: { fontFamily: font.semibold, color: colors.onSurface },
  importBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, backgroundColor: colors.brandPrimary + "12", borderWidth: 1, borderColor: colors.brandPrimary + "40", borderRadius: radius.md, paddingVertical: 12, marginBottom: spacing.lg },
  importText: { fontFamily: font.semibold, fontSize: fontSize.base, color: colors.brandPrimary },
  summaryGrid: { flexDirection: "row", gap: spacing.md },
  summaryCard: { flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.lg },
  summaryIcon: { width: 32, height: 32, borderRadius: 9, alignItems: "center", justifyContent: "center", marginBottom: spacing.sm },
  summaryValue: { fontFamily: font.bold, fontSize: fontSize.xl, color: colors.onSurface },
  summaryLabel: { fontFamily: font.regular, fontSize: fontSize.sm, color: colors.onSurfaceTertiary, marginTop: 2 },
  resultCard: { borderWidth: 1.5, borderRadius: radius.lg, padding: spacing.lg, marginTop: spacing.md, alignItems: "center" },
  resultLabel: { fontFamily: font.medium, fontSize: fontSize.base, color: colors.onSurfaceSecondary },
  resultValue: { fontFamily: font.bold, fontSize: fontSize.xxl, marginTop: 4 },
  resultSub: { fontFamily: font.regular, fontSize: fontSize.sm, color: colors.onSurfaceTertiary, marginTop: 2 },
  sectionTitle: { fontFamily: font.semibold, fontSize: fontSize.lg, color: colors.onSurface, marginTop: spacing.xl, marginBottom: spacing.md },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.lg },
  tvaCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.lg },
  tvaRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 6 },
  tvaLabel: { fontFamily: font.regular, fontSize: fontSize.base, color: colors.onSurfaceSecondary },
  tvaValue: { fontFamily: font.medium, fontSize: fontSize.base, color: colors.onSurface },
  tvaSep: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: 6 },
  tvaNetLabel: { fontFamily: font.semibold, fontSize: fontSize.base, color: colors.onSurface },
  tvaNetValue: { fontFamily: font.bold, fontSize: fontSize.lg },
  catRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: 7 },
  catName: { fontFamily: font.medium, fontSize: fontSize.base, color: colors.onSurface, marginBottom: 5 },
  barBg: { height: 6, borderRadius: 3, backgroundColor: colors.surfaceSecondary, overflow: "hidden" },
  barFill: { height: 6, borderRadius: 3, backgroundColor: colors.error },
  catAmount: { fontFamily: font.semibold, fontSize: fontSize.base, color: colors.onSurface },
  ownerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  ownerName: { flex: 1, fontFamily: font.medium, fontSize: fontSize.base, color: colors.onSurface, marginRight: spacing.md },
  ownerNums: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  ownerNum: { fontFamily: font.medium, fontSize: fontSize.sm },
  ownerResult: { fontFamily: font.bold, fontSize: fontSize.base, minWidth: 60, textAlign: "right" },
  filterRow: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.md },
  chip: { paddingHorizontal: spacing.lg, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: colors.surfaceSecondary },
  chipActive: { backgroundColor: colors.brandPrimary },
  chipText: { fontFamily: font.medium, fontSize: fontSize.base, color: colors.onSurfaceSecondary },
  chipTextActive: { color: colors.onBrandPrimary, fontFamily: font.semibold },
  txRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  txIcon: { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  txCat: { fontFamily: font.semibold, fontSize: fontSize.base, color: colors.onSurface },
  txMeta: { fontFamily: font.regular, fontSize: fontSize.sm, color: colors.onSurfaceTertiary, marginTop: 1 },
  txAmount: { fontFamily: font.bold, fontSize: fontSize.base, color: colors.onSurface },
  txVat: { fontFamily: font.regular, fontSize: 11, color: colors.onSurfaceTertiary, marginTop: 1 },
  addRecurring: { flexDirection: "row", alignItems: "center", gap: spacing.sm, justifyContent: "center", paddingVertical: 12, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, marginBottom: spacing.md, borderStyle: "dashed" },
  addRecurringText: { fontFamily: font.semibold, fontSize: fontSize.base, color: colors.brandPrimary },
  emptyRow: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.xl, alignItems: "center", marginTop: spacing.sm },
  emptyText: { fontFamily: font.regular, fontSize: fontSize.base, color: colors.onSurfaceTertiary },
  fab: { position: "absolute", right: spacing.lg, width: 58, height: 58, borderRadius: 29, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center", elevation: 4, shadowColor: "#000", shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
});
