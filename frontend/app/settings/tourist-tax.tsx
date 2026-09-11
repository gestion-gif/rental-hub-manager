import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator, TextInput, Alert } from "react-native";
import Ionicons from "@react-native-vector-icons/ionicons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";

import { api } from "@/src/api";
import { colors, font, fontSize, radius, spacing } from "@/src/theme";

export default function TouristTaxSettings() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [properties, setProperties] = useState<any[]>([]);
  const [edits, setEdits] = useState<Record<string, any>>({});
  const [savingId, setSavingId] = useState<string>("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const props = await api.get("/properties");
      setProperties(props);
      const e: Record<string, any> = {};
      props.forEach((p: any) => {
        e[p.id] = {
          mode: p.tax_mode === "real" ? "real" : "percent",
          tourist: p.tourist_tax_pct ? String(p.tourist_tax_pct) : "",
          regional: p.regional_tax_pct ? String(p.regional_tax_pct) : "",
          cap: p.tax_cap ? String(p.tax_cap) : "",
          dept: p.tax_dept_pct ? String(p.tax_dept_pct) : "",
        };
      });
      setEdits(e);
    } catch {}
    setLoading(false);
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  function setField(id: string, k: string, v: string) {
    setEdits((e) => ({ ...e, [id]: { ...e[id], [k]: v } }));
  }

  async function save(prop: any) {
    if (savingId) return;
    setSavingId(prop.id);
    const ed = edits[prop.id] || {};
    const num = (s: string) => parseFloat((s || "0").replace(",", ".")) || 0;
    const body = {
      ...prop,
      tax_mode: ed.mode === "real" ? "real" : "percent",
      tourist_tax_pct: num(ed.tourist),
      regional_tax_pct: num(ed.regional),
      tax_cap: num(ed.cap),
      tax_dept_pct: num(ed.dept),
    };
    try {
      const updated = await api.put(`/properties/${prop.id}`, body);
      setProperties((ps) => ps.map((p) => (p.id === prop.id ? updated : p)));
      Alert.alert("Enregistré", `Taxes de séjour mises à jour pour ${prop.name}.`);
    } catch {
      Alert.alert("Erreur", "Enregistrement impossible.");
    }
    setSavingId("");
  }

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="tax-back" onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Taxe de séjour</Text>
        <View style={{ width: 34 }} />
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 60 }} color={colors.brandPrimary} />
      ) : (
        <KeyboardAwareScrollView
          bottomOffset={20}
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 60 }}
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.intro}>Taux par logement</Text>
          <Text style={styles.introSub}>
            Définissez la taxe de séjour et la taxe additionnelle régionale en % du prix des nuitées.
            Elles sont calculées automatiquement dans chaque réservation.
          </Text>

          {properties.length === 0 ? (
            <Text style={styles.empty}>Aucun logement.</Text>
          ) : (
            properties.map((p) => {
              const ed = edits[p.id] || { mode: "percent", tourist: "", regional: "", cap: "", dept: "" };
              const isReal = ed.mode === "real";
              return (
                <View key={p.id} style={styles.card} testID={`tax-card-${p.id}`}>
                  <Text style={styles.propName}>{p.name}</Text>
                  <View style={styles.modeRow}>
                    <Pressable testID={`tax-mode-percent-${p.id}`} onPress={() => setField(p.id, "mode", "percent")} style={[styles.modeChip, !isReal && styles.modeChipOn]}>
                      <Text style={[styles.modeText, !isReal && styles.modeTextOn]}>% des nuitées</Text>
                    </Pressable>
                    <Pressable testID={`tax-mode-real-${p.id}`} onPress={() => setField(p.id, "mode", "real")} style={[styles.modeChip, isReal && styles.modeChipOn]}>
                      <Text style={[styles.modeText, isReal && styles.modeTextOn]}>Barème réel (par pers.)</Text>
                    </Pressable>
                  </View>
                  {isReal && (
                    <Text style={styles.modeHint}>
                      Taxe = taux % × (prix de la nuit ÷ occupants), plafonnée par pers./nuit, + taxes
                      additionnelles (% de la taxe), × nuits × personnes assujetties.
                    </Text>
                  )}
                  <View style={styles.row}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.fieldLabel}>{isReal ? "Taux (%)" : "Taxe de séjour (%)"}</Text>
                      <TextInput
                        testID={`tax-tourist-${p.id}`}
                        value={ed.tourist}
                        onChangeText={(v) => setField(p.id, "tourist", v)}
                        keyboardType="decimal-pad"
                        placeholder="5"
                        placeholderTextColor={colors.onSurfaceTertiary}
                        style={styles.input}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.fieldLabel}>{isReal ? "Taxe régionale (% de la taxe)" : "Taxe add. régionale (%)"}</Text>
                      <TextInput
                        testID={`tax-regional-${p.id}`}
                        value={ed.regional}
                        onChangeText={(v) => setField(p.id, "regional", v)}
                        keyboardType="decimal-pad"
                        placeholder={isReal ? "34" : "10"}
                        placeholderTextColor={colors.onSurfaceTertiary}
                        style={styles.input}
                      />
                    </View>
                  </View>
                  {isReal && (
                    <View style={[styles.row, { marginTop: spacing.md }]}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.fieldLabel}>Plafond (€ / pers / nuit)</Text>
                        <TextInput
                          testID={`tax-cap-${p.id}`}
                          value={ed.cap}
                          onChangeText={(v) => setField(p.id, "cap", v)}
                          keyboardType="decimal-pad"
                          placeholder="4.00"
                          placeholderTextColor={colors.onSurfaceTertiary}
                          style={styles.input}
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.fieldLabel}>Taxe départementale (% de la taxe)</Text>
                        <TextInput
                          testID={`tax-dept-${p.id}`}
                          value={ed.dept}
                          onChangeText={(v) => setField(p.id, "dept", v)}
                          keyboardType="decimal-pad"
                          placeholder="10"
                          placeholderTextColor={colors.onSurfaceTertiary}
                          style={styles.input}
                        />
                      </View>
                    </View>
                  )}
                  <Pressable
                    testID={`tax-save-${p.id}`}
                    onPress={() => save(p)}
                    disabled={savingId === p.id}
                    style={[styles.saveBtn, savingId === p.id && { opacity: 0.6 }]}
                  >
                    {savingId === p.id ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.saveText}>Enregistrer</Text>}
                  </Pressable>
                </View>
              );
            })
          )}
        </KeyboardAwareScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  backBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  title: { fontFamily: font.bold, fontSize: fontSize.xl, color: colors.onSurface },
  intro: { fontFamily: font.bold, fontSize: fontSize.xxl, color: colors.onSurface },
  introSub: { fontFamily: font.regular, fontSize: fontSize.base, color: colors.onSurfaceTertiary, marginTop: 4, marginBottom: spacing.lg, lineHeight: 20 },
  empty: { fontFamily: font.regular, fontSize: fontSize.base, color: colors.onSurfaceTertiary, textAlign: "center", marginTop: 40 },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.md },
  propName: { fontFamily: font.semibold, fontSize: fontSize.lg, color: colors.onSurface, marginBottom: spacing.md },
  row: { flexDirection: "row", gap: spacing.md },
  modeRow: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.md },
  modeChip: { flex: 1, alignItems: "center", paddingVertical: 9, borderRadius: 18, borderWidth: 1.5, borderColor: colors.border },
  modeChipOn: { borderColor: colors.brandPrimary, backgroundColor: colors.brandPrimary + "12" },
  modeText: { fontFamily: font.semibold, fontSize: fontSize.sm, color: colors.onSurfaceSecondary },
  modeTextOn: { color: colors.brandPrimary },
  modeHint: { fontFamily: font.regular, fontSize: fontSize.xs, color: colors.onSurfaceTertiary, lineHeight: 16, marginBottom: spacing.md },
  fieldLabel: { fontFamily: font.medium, fontSize: fontSize.sm, color: colors.onSurfaceSecondary, marginBottom: 6 },
  input: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: 12, fontFamily: font.regular, fontSize: fontSize.base, color: colors.onSurface },
  saveBtn: { marginTop: spacing.md, backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 12, alignItems: "center" },
  saveText: { fontFamily: font.semibold, fontSize: fontSize.base, color: colors.onBrandPrimary },
});
