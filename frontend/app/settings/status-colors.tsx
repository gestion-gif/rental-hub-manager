import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";

import {
  usePreferences,
  COLOR_PALETTE,
} from "@/src/context/PreferencesContext";
import { STATUS, STATUS_ORDER, StatusKey, colors, font, fontSize, radius, spacing } from "@/src/theme";
import { PrimaryButton } from "@/src/components/ui";
import { tint } from "@/src/components/StatusBadge";

export default function StatusColors() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { statusColors, save } = usePreferences();
  const [draft, setDraft] = useState<Record<StatusKey, string>>({ ...statusColors });
  const [saving, setSaving] = useState(false);

  function pick(status: StatusKey, color: string) {
    setDraft((d) => ({ ...d, [status]: color }));
  }

  async function onSave() {
    setSaving(true);
    await save(draft);
    setSaving(false);
    router.back();
  }

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Text style={styles.title}>Couleurs des statuts</Text>
        <Pressable testID="close-colors" onPress={() => router.back()} style={styles.closeBtn}>
          <Ionicons name="close" size={22} color={colors.onSurface} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 40 }}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.intro}>
          Choisissez une couleur pour chaque étape de réservation. Elle s'applique partout dans l'app.
        </Text>

        {STATUS_ORDER.map((status) => {
          const c = draft[status];
          return (
            <View key={status} style={styles.block} testID={`color-block-${status}`}>
              <View style={styles.blockHead}>
                <View style={[styles.preview, { backgroundColor: tint(c) }]}>
                  <View style={[styles.previewDot, { backgroundColor: c }]} />
                  <Text style={[styles.previewText, { color: c }]}>{STATUS[status].label}</Text>
                </View>
              </View>
              <View style={styles.swatchRow}>
                {COLOR_PALETTE.map((color) => {
                  const active = c === color;
                  return (
                    <Pressable
                      key={color}
                      testID={`swatch-${status}-${color}`}
                      onPress={() => pick(status, color)}
                      style={[
                        styles.swatch,
                        { backgroundColor: color },
                        active && styles.swatchActive,
                      ]}
                    >
                      {active && <Ionicons name="checkmark" size={16} color="#fff" />}
                    </Pressable>
                  );
                })}
              </View>
            </View>
          );
        })}

        <PrimaryButton
          testID="save-colors"
          label="Enregistrer les couleurs"
          onPress={onSave}
          loading={saving}
          style={{ marginTop: spacing.lg }}
        />
      </ScrollView>
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
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.surfaceSecondary,
    alignItems: "center",
    justifyContent: "center",
  },
  intro: { fontFamily: font.regular, fontSize: fontSize.base, color: colors.onSurfaceTertiary, marginBottom: spacing.lg },
  block: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  blockHead: { marginBottom: spacing.md },
  preview: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
  },
  previewDot: { width: 8, height: 8, borderRadius: 999 },
  previewText: { fontFamily: font.semibold, fontSize: fontSize.base },
  swatchRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  swatch: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "transparent",
  },
  swatchActive: { borderColor: colors.onSurface },
});
