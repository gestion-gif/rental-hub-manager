import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";

import {
  usePreferences,
  COLOR_PALETTE,
  CORE_STATUS_KEYS,
  StatusDef,
} from "@/src/context/PreferencesContext";
import { colors, font, fontSize, radius, spacing } from "@/src/theme";
import { PrimaryButton } from "@/src/components/ui";
import { tint } from "@/src/components/StatusBadge";

export default function StatusColors() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { statuses, save } = usePreferences();
  const [draft, setDraft] = useState<StatusDef[]>(statuses.map((s) => ({ ...s })));
  const [newLabel, setNewLabel] = useState("");
  const [newColor, setNewColor] = useState(COLOR_PALETTE[5]);
  const [saving, setSaving] = useState(false);

  function updateColor(key: string, color: string) {
    setDraft((d) => d.map((s) => (s.key === key ? { ...s, color } : s)));
  }
  function updateLabel(key: string, label: string) {
    setDraft((d) => d.map((s) => (s.key === key ? { ...s, label } : s)));
  }
  function removeStatus(key: string) {
    setDraft((d) => d.filter((s) => s.key !== key));
  }
  function addStatus() {
    const label = newLabel.trim();
    if (!label) return;
    const key = `custom_${Date.now().toString(36)}`;
    setDraft((d) => [...d, { key, label, color: newColor }]);
    setNewLabel("");
    setNewColor(COLOR_PALETTE[(draft.length + 5) % COLOR_PALETTE.length]);
  }

  async function onSave() {
    setSaving(true);
    await save(draft.map((s) => ({ ...s, label: s.label.trim() || s.key })));
    setSaving(false);
    router.back();
  }

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Text style={styles.title}>Statuts & couleurs</Text>
        <Pressable testID="close-colors" onPress={() => router.back()} style={styles.closeBtn}>
          <Ionicons name="close" size={22} color={colors.onSurface} />
        </Pressable>
      </View>

      <KeyboardAwareScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 40 }}
        bottomOffset={20}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.intro}>
          Renommez, recolorez ou ajoutez vos propres statuts. Ils s'appliquent partout (réservations, planning).
        </Text>

        {draft.map((status) => {
          const isCore = CORE_STATUS_KEYS.includes(status.key);
          return (
            <View key={status.key} style={styles.block} testID={`color-block-${status.key}`}>
              <View style={styles.blockHead}>
                <View style={[styles.previewDot, { backgroundColor: status.color }]} />
                <TextInput
                  testID={`label-input-${status.key}`}
                  value={status.label}
                  onChangeText={(v) => updateLabel(status.key, v)}
                  placeholder="Nom du statut"
                  placeholderTextColor={colors.onSurfaceTertiary}
                  style={[styles.labelInput, { color: status.color }]}
                />
                {!isCore && (
                  <Pressable testID={`remove-status-${status.key}`} onPress={() => removeStatus(status.key)} style={styles.del}>
                    <Ionicons name="trash-outline" size={18} color={colors.error} />
                  </Pressable>
                )}
              </View>
              <View style={styles.swatchRow}>
                {COLOR_PALETTE.map((color) => {
                  const active = status.color === color;
                  return (
                    <Pressable
                      key={color}
                      testID={`swatch-${status.key}-${color}`}
                      onPress={() => updateColor(status.key, color)}
                      style={[styles.swatch, { backgroundColor: color }, active && styles.swatchActive]}
                    >
                      {active && <Ionicons name="checkmark" size={15} color="#fff" />}
                    </Pressable>
                  );
                })}
              </View>
            </View>
          );
        })}

        {/* Add custom status */}
        <View style={styles.addBox}>
          <Text style={styles.addTitle}>Ajouter un statut</Text>
          <View style={[styles.blockHead, { marginBottom: spacing.md }]}>
            <View style={[styles.previewDot, { backgroundColor: newColor }]} />
            <TextInput
              testID="new-status-label"
              value={newLabel}
              onChangeText={setNewLabel}
              placeholder="Ex: Ménage, Bloqué, Acompte reçu..."
              placeholderTextColor={colors.onSurfaceTertiary}
              style={[styles.labelInput, { color: colors.onSurface }]}
            />
          </View>
          <View style={styles.swatchRow}>
            {COLOR_PALETTE.map((color) => {
              const active = newColor === color;
              return (
                <Pressable
                  key={color}
                  testID={`new-swatch-${color}`}
                  onPress={() => setNewColor(color)}
                  style={[styles.swatch, { backgroundColor: color }, active && styles.swatchActive]}
                >
                  {active && <Ionicons name="checkmark" size={15} color="#fff" />}
                </Pressable>
              );
            })}
          </View>
          <PrimaryButton
            testID="add-status"
            label="Ajouter ce statut"
            onPress={addStatus}
            variant="secondary"
            disabled={!newLabel.trim()}
            style={{ marginTop: spacing.md }}
          />
        </View>

        <PrimaryButton
          testID="save-colors"
          label="Enregistrer"
          onPress={onSave}
          loading={saving}
          style={{ marginTop: spacing.lg }}
        />
      </KeyboardAwareScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  title: { fontFamily: font.bold, fontSize: fontSize.xl, color: colors.onSurface },
  closeBtn: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center",
  },
  intro: { fontFamily: font.regular, fontSize: fontSize.base, color: colors.onSurfaceTertiary, marginBottom: spacing.lg },
  block: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.md },
  blockHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.md },
  previewDot: { width: 14, height: 14, borderRadius: 999 },
  labelInput: { flex: 1, fontFamily: font.semibold, fontSize: fontSize.lg, paddingVertical: 4 },
  del: { padding: 4 },
  swatchRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  swatch: {
    width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center",
    borderWidth: 2, borderColor: "transparent",
  },
  swatchActive: { borderColor: colors.onSurface },
  addBox: {
    borderWidth: 1, borderColor: colors.border, borderStyle: "dashed",
    borderRadius: radius.lg, padding: spacing.lg, marginTop: spacing.sm,
  },
  addTitle: { fontFamily: font.bold, fontSize: fontSize.lg, color: colors.onSurface, marginBottom: spacing.md },
});
