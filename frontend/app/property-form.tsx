import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";

import { api } from "@/src/api";
import { Field, PrimaryButton } from "@/src/components/ui";
import { colors, font, fontSize, spacing } from "@/src/theme";

export default function PropertyForm() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const editing = !!id;

  const [loading, setLoading] = useState(editing);
  const [saving, setSaving] = useState(false);
  const existing = React.useRef<any>({ seasons: [], ical_links: [] });

  const [form, setForm] = useState({
    name: "",
    location: "",
    image_url: "",
    base_price: "",
    capacity: "2",
    bedrooms: "1",
  });

  useEffect(() => {
    if (!editing) return;
    (async () => {
      try {
        const p = await api.get(`/properties/${id}`);
        existing.current = p;
        setForm({
          name: p.name,
          location: p.location || "",
          image_url: p.image_url || "",
          base_price: String(p.base_price),
          capacity: String(p.capacity),
          bedrooms: String(p.bedrooms),
        });
      } catch {}
      setLoading(false);
    })();
  }, []);

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const valid = form.name.trim().length > 0;

  async function save() {
    if (!valid || saving) return;
    setSaving(true);
    const payload = {
      name: form.name.trim(),
      location: form.location.trim(),
      image_url: form.image_url.trim(),
      base_price: parseFloat(form.base_price) || 0,
      capacity: parseInt(form.capacity) || 1,
      bedrooms: parseInt(form.bedrooms) || 1,
      seasons: existing.current.seasons || [],
      ical_links: existing.current.ical_links || [],
    };
    try {
      if (editing) await api.put(`/properties/${id}`, payload);
      else await api.post("/properties", payload);
      router.back();
    } catch {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.brandPrimary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Text style={styles.title}>{editing ? "Modifier le logement" : "Nouveau logement"}</Text>
        <Pressable testID="close-property-form" onPress={() => router.back()} style={styles.closeBtn}>
          <Ionicons name="close" size={22} color={colors.onSurface} />
        </Pressable>
      </View>
      <KeyboardAwareScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: 40 }}
        bottomOffset={20}
        showsVerticalScrollIndicator={false}
      >
        <Field label="Nom" testID="prop-name" value={form.name} onChangeText={(v) => set("name", v)} placeholder="Villa Azur" />
        <Field label="Localisation" testID="prop-location" value={form.location} onChangeText={(v) => set("location", v)} placeholder="Nice, France" />
        <Field label="URL de la photo" testID="prop-image" value={form.image_url} onChangeText={(v) => set("image_url", v)} placeholder="https://..." autoCapitalize="none" />
        <Field label="Prix de base (€/nuit)" testID="prop-price" value={form.base_price} onChangeText={(v) => set("base_price", v)} keyboardType="decimal-pad" placeholder="120" />
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Field label="Chambres" testID="prop-bedrooms" value={form.bedrooms} onChangeText={(v) => set("bedrooms", v)} keyboardType="number-pad" />
          </View>
          <View style={{ flex: 1 }}>
            <Field label="Capacité" testID="prop-capacity" value={form.capacity} onChangeText={(v) => set("capacity", v)} keyboardType="number-pad" />
          </View>
        </View>
        <PrimaryButton
          testID="save-property"
          label={editing ? "Enregistrer" : "Ajouter le logement"}
          onPress={save}
          loading={saving}
          disabled={!valid}
        />
      </KeyboardAwareScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  title: { fontFamily: font.bold, fontSize: fontSize.xl, color: colors.onSurface, flex: 1 },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.surfaceSecondary,
    alignItems: "center",
    justifyContent: "center",
  },
  row: { flexDirection: "row", gap: spacing.md },
});
