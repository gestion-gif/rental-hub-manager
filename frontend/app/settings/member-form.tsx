import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator, Alert, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";

import { api } from "@/src/api";
import { Field, PrimaryButton } from "@/src/components/ui";
import { Picker } from "@/src/components/Picker";
import { MultiPicker } from "@/src/components/MultiPicker";
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
  property_ids: string[];
  active: boolean;
};

const EMPTY: FormState = {
  first_name: "", last_name: "", email: "", phone: "",
  language: "fr", role: "member", permissions: [], property_ids: [], active: true,
};

export default function MemberForm() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const editing = !!id;

  const [form, setForm] = useState<FormState>(EMPTY);
  const [loading, setLoading] = useState(editing);
  const [saving, setSaving] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [properties, setProperties] = useState<{ id: string; name: string }[]>([]);
  const [inviteStatus, setInviteStatus] = useState<string>("none");

  useEffect(() => {
    (async () => {
      try {
        const props = await api.get("/properties");
        setProperties(props.map((p: any) => ({ id: p.id, name: p.name })));
      } catch {}
    })();
  }, []);

  useEffect(() => {
    if (!editing) return;
    (async () => {
      try {
        const m = await api.get(`/members/${id}`);
        setForm({
          first_name: m.first_name || "", last_name: m.last_name || "",
          email: m.email || "", phone: m.phone || "",
          language: m.language || "fr", role: m.role || "member",
          permissions: m.permissions || [], property_ids: m.property_ids || [],
          active: m.active !== false,
        });
        setInviteStatus(m.invite_status || "none");
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

  async function sendInvite() {
    if (inviting) return;
    if (!form.email.trim()) {
      Alert.alert("Email requis", "Renseignez l'email de l'utilisateur puis enregistrez avant d'envoyer l'invitation.");
      return;
    }
    setInviting(true);
    try {
      const origin =
        Platform.OS === "web" && typeof window !== "undefined"
          ? window.location.origin
          : (process.env.EXPO_PUBLIC_BACKEND_URL as string);
      await api.post(`/members/${id}/invite`, { origin_url: origin });
      setInviteStatus("pending");
      Alert.alert("Invitation envoyée", `Un email de connexion a été envoyé à ${form.email}.`);
    } catch (e: any) {
      Alert.alert("Erreur", e?.message || "Envoi de l'invitation impossible.");
    }
    setInviting(false);
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

        {/* Accès aux logements */}
        <Text style={styles.section}>Accès aux logements</Text>
        <View style={styles.card}>
          <MultiPicker
            label="Logements accessibles"
            testID="member-properties"
            title="Logements accessibles"
            emptyLabel="Aucun logement"
            values={form.property_ids}
            items={properties}
            onChange={(ids) => set({ property_ids: ids })}
          />
          <Text style={styles.hint}>
            L'utilisateur ne verra que les logements cochés (réservations, calendrier, boîte de réception).
          </Text>
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

        {editing && (
          <View style={styles.inviteCard}>
            <View style={styles.inviteHead}>
              <Ionicons name="mail-outline" size={18} color={colors.onSurface} />
              <Text style={styles.inviteTitle}>Accès de l'utilisateur</Text>
              {inviteStatus === "active" && (
                <View style={styles.badgeOk}><Text style={styles.badgeOkTxt}>Compte actif</Text></View>
              )}
              {inviteStatus === "pending" && (
                <View style={styles.badgePending}><Text style={styles.badgePendingTxt}>Invitation envoyée</Text></View>
              )}
            </View>
            <Text style={styles.hint}>
              Envoyez un email de connexion : l'utilisateur créera son mot de passe puis pourra se connecter avec son email.
            </Text>
            <PrimaryButton
              testID="invite-member"
              label={inviteStatus === "none" ? "Envoyer l'invitation" : "Renvoyer l'invitation"}
              onPress={sendInvite}
              loading={inviting}
              variant="secondary"
              icon={<Ionicons name="paper-plane-outline" size={16} color={colors.onSurface} />}
              style={{ marginTop: spacing.md }}
            />
          </View>
        )}
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
  hint: { fontFamily: font.regular, fontSize: fontSize.sm, color: colors.onSurfaceTertiary, lineHeight: 18 },
  inviteCard: { marginTop: spacing.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.lg },
  inviteHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.sm },
  inviteTitle: { flex: 1, fontFamily: font.bold, fontSize: fontSize.lg, color: colors.onSurface },
  badgeOk: { backgroundColor: "#E7F8EC", borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 3 },
  badgeOkTxt: { fontFamily: font.semibold, fontSize: fontSize.sm, color: "#2FB350" },
  badgePending: { backgroundColor: "#FFF4E5", borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 3 },
  badgePendingTxt: { fontFamily: font.semibold, fontSize: fontSize.sm, color: "#FF9500" },
});
