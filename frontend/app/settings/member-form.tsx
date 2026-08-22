import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator, Alert } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";

import { api } from "@/src/api";
import { Field, PrimaryButton } from "@/src/components/ui";
import { Picker } from "@/src/components/Picker";
import {
  ROLES, LANGUAGES, GENERAL_PERMISSIONS, PM_PERMISSIONS, ROLE_DEFAULTS, Role, Permission,
} from "@/src/permissions";
import { colors, font, fontSize, radius, spacing } from "@/src/theme";

type FormState = {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  language: string;
  role: Role;
  permissions: string[];
  active: boolean;
};

const EMPTY: FormState = {
  first_name: "", last_name: "", email: "", phone: "",
  language: "fr", role: "member", permissions: [], active: true,
};

export default function MemberForm() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const editing = !!id;

  const [form, setForm] = useState<FormState>(EMPTY);
  const [loading, setLoading] = useState(editing);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!editing) return;
    (async () => {
      try {
        const m = await api.get(`/members/${id}`);
        setForm({
          first_name: m.first_name || "", last_name: m.last_name || "",
          email: m.email || "", phone: m.phone || "",
          language: m.language || "fr", role: m.role || "member",
          permissions: m.permissions || [], active: m.active !== false,
        });
      } catch {}
      setLoading(false);
    })();
  }, [id]);

  const set = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));

  // Changer de rôle applique les autorisations par défaut du rôle.
  function onRole(role: string) {
    set({ role: role as Role, permissions: [...(ROLE_DEFAULTS[role as Role] || [])] });
  }

  const has = useCallback((key: string) => form.permissions.includes(key), [form.permissions]);
  function toggle(key: string) {
    setForm((f) => ({
      ...f,
      permissions: f.permissions.includes(key)
        ? f.permissions.filter((k) => k !== key)
        : [...f.permissions, key],
    }));
  }

  async function save() {
    if (saving) return;
    if (!form.first_name.trim() && !form.last_name.trim() && !form.email.trim()) {
      Alert.alert("Champ requis", "Renseignez au moins un nom ou un email.");
      return;
    }
    setSaving(true);
    try {
      if (editing) await api.put(`/members/${id}`, form);
      else await api.post("/members", form);
      router.back();
    } catch {
      Alert.alert("Erreur", "Enregistrement impossible.");
    }
    setSaving(false);
  }

  async function remove() {
    Alert.alert("Supprimer", "Supprimer cet utilisateur ?", [
      { text: "Annuler", style: "cancel" },
      { text: "Supprimer", style: "destructive", onPress: async () => { await api.del(`/members/${id}`); router.back(); } },
    ]);
  }

  if (loading) {
    return <View style={styles.container}><ActivityIndicator style={{ marginTop: 80 }} color={colors.brandPrimary} /></View>;
  }

  const renderPerm = (p: Permission) => (
    <Pressable key={p.key} testID={`perm-${p.key}`} onPress={() => toggle(p.key)} style={styles.perm}>
      <View style={[styles.checkbox, has(p.key) && styles.checkboxOn]}>
        {has(p.key) && <Ionicons name="checkmark" size={15} color={colors.onBrandPrimary} />}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.permTitle}>{p.title}</Text>
        <Text style={styles.permDesc}>{p.desc}</Text>
      </View>
    </Pressable>
  );

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="member-form-back" onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>{editing ? "Modifier l'utilisateur" : "Nouvel utilisateur"}</Text>
        {editing ? (
          <Pressable testID="member-delete" onPress={remove} style={styles.backBtn}>
            <Ionicons name="trash-outline" size={20} color={colors.error} />
          </Pressable>
        ) : <View style={{ width: 34 }} />}
      </View>

      <KeyboardAwareScrollView
        bottomOffset={20}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 120 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Coordonnées */}
        <Text style={styles.section}>Coordonnées</Text>
        <View style={styles.card}>
          <Field label="Nom" testID="member-last" value={form.last_name} onChangeText={(v) => set({ last_name: v })} placeholder="Dupont" />
          <Field label="Prénom" testID="member-first" value={form.first_name} onChangeText={(v) => set({ first_name: v })} placeholder="Marie" />
          <Field label="Mail" testID="member-email" value={form.email} onChangeText={(v) => set({ email: v })} placeholder="marie@email.com" keyboardType="email-address" autoCapitalize="none" />
          <Field label="Téléphone" testID="member-phone" value={form.phone} onChangeText={(v) => set({ phone: v })} placeholder="06 12 34 56 78" keyboardType="phone-pad" />
        </View>

        {/* Informations complémentaires */}
        <Text style={styles.section}>Informations complémentaires</Text>
        <View style={styles.card}>
          <Picker
            label="Langue préférée"
            testID="member-language"
            title="Choisir une langue"
            value={form.language}
            items={LANGUAGES}
            onSelect={(v) => set({ language: v })}
          />
        </View>

        {/* Rôle et autorisations */}
        <Text style={styles.section}>Rôle et autorisations</Text>
        <View style={styles.card}>
          <Picker
            label="Rôle"
            testID="member-role"
            title="Choisir un rôle"
            value={form.role}
            items={ROLES}
            onSelect={onRole}
          />
          <Pressable testID="member-active" onPress={() => set({ active: !form.active })} style={styles.perm}>
            <View style={[styles.checkbox, form.active && styles.checkboxOn]}>
              {form.active && <Ionicons name="checkmark" size={15} color={colors.onBrandPrimary} />}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.permTitle}>Utilisateur actif</Text>
              <Text style={styles.permDesc}>Désactivez pour suspendre l'accès sans supprimer le compte.</Text>
            </View>
          </Pressable>
        </View>

        <Text style={styles.groupTitle}>Autorisations générales</Text>
        <View style={styles.card}>{GENERAL_PERMISSIONS.map(renderPerm)}</View>

        <Text style={styles.groupTitle}>Autorisations des PM Modules</Text>
        <View style={styles.card}>{PM_PERMISSIONS.map(renderPerm)}</View>

        <PrimaryButton
          testID="save-member"
          label={editing ? "Enregistrer" : "Ajouter l'utilisateur"}
          onPress={save}
          loading={saving}
          style={{ marginTop: spacing.lg }}
        />
      </KeyboardAwareScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  backBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  title: { fontFamily: font.bold, fontSize: fontSize.lg, color: colors.onSurface },
  section: { fontFamily: font.bold, fontSize: fontSize.base, color: colors.onSurfaceTertiary, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: spacing.sm, marginTop: spacing.md },
  groupTitle: { fontFamily: font.bold, fontSize: fontSize.lg, color: colors.onSurface, marginBottom: spacing.sm, marginTop: spacing.lg },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.lg },
  perm: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md, paddingVertical: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider },
  checkbox: { width: 24, height: 24, borderRadius: radius.sm, borderWidth: 1.5, borderColor: colors.borderStrong, alignItems: "center", justifyContent: "center", marginTop: 1 },
  checkboxOn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  permTitle: { fontFamily: font.semibold, fontSize: fontSize.base, color: colors.onSurface },
  permDesc: { fontFamily: font.regular, fontSize: fontSize.sm, color: colors.onSurfaceTertiary, marginTop: 2, lineHeight: 18 },
});
