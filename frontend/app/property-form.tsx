import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";

import { api } from "@/src/api";
import { Field, PrimaryButton } from "@/src/components/ui";
import { ROOM_OPTIONS, AMENITY_OPTIONS } from "@/src/propertyOptions";
import { colors, font, fontSize, radius, spacing } from "@/src/theme";

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
    owner: "",
    surface: "",
    address: "",
    postal_code: "",
    city: "",
    address_complement: "",
    description: "",
  });
  const [rooms, setRooms] = useState<string[]>([]);
  const [amenities, setAmenities] = useState<string[]>([]);

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
          owner: p.owner || "",
          surface: p.surface ? String(p.surface) : "",
          address: p.address || "",
          postal_code: p.postal_code || "",
          city: p.city || "",
          address_complement: p.address_complement || "",
          description: p.description || "",
        });
        setRooms(p.rooms || []);
        setAmenities(p.amenities || []);
      } catch {}
      setLoading(false);
    })();
  }, []);

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const toggle = (arr: string[], setArr: (v: string[]) => void, val: string) =>
    setArr(arr.includes(val) ? arr.filter((x) => x !== val) : [...arr, val]);
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
      owner: form.owner.trim(),
      surface: parseFloat(form.surface) || 0,
      address: form.address.trim(),
      postal_code: form.postal_code.trim(),
      city: form.city.trim(),
      address_complement: form.address_complement.trim(),
      description: form.description.trim(),
      rooms,
      amenities,
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
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 40 }}
        bottomOffset={20}
        showsVerticalScrollIndicator={false}
      >
        <SectionLabel text="Général" />
        <Field label="Nom du logement" testID="prop-name" value={form.name} onChangeText={(v) => set("name", v)} placeholder="Villa Azur" />
        <Field label="Propriétaire" testID="prop-owner" value={form.owner} onChangeText={(v) => set("owner", v)} placeholder="Nom du propriétaire" />
        <Field label="Localisation (résumé)" testID="prop-location" value={form.location} onChangeText={(v) => set("location", v)} placeholder="Nice, France" />
        <Field label="URL de la photo" testID="prop-image" value={form.image_url} onChangeText={(v) => set("image_url", v)} placeholder="https://..." autoCapitalize="none" />

        <SectionLabel text="Adresse" />
        <Field label="Adresse" testID="prop-address" value={form.address} onChangeText={(v) => set("address", v)} placeholder="12 rue des Oliviers" />
        <Field label="Complément d'adresse" testID="prop-address-complement" value={form.address_complement} onChangeText={(v) => set("address_complement", v)} placeholder="Bâtiment B, 3e étage, digicode..." />
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Field label="Code postal" testID="prop-postal" value={form.postal_code} onChangeText={(v) => set("postal_code", v)} keyboardType="number-pad" placeholder="06000" />
          </View>
          <View style={{ flex: 2 }}>
            <Field label="Ville" testID="prop-city" value={form.city} onChangeText={(v) => set("city", v)} placeholder="Nice" />
          </View>
        </View>

        <SectionLabel text="Caractéristiques" />
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Field label="Surface (m²)" testID="prop-surface" value={form.surface} onChangeText={(v) => set("surface", v)} keyboardType="decimal-pad" placeholder="65" />
          </View>
          <View style={{ flex: 1 }}>
            <Field label="Prix (€/nuit)" testID="prop-price" value={form.base_price} onChangeText={(v) => set("base_price", v)} keyboardType="decimal-pad" placeholder="120" />
          </View>
        </View>
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Field label="Chambres" testID="prop-bedrooms" value={form.bedrooms} onChangeText={(v) => set("bedrooms", v)} keyboardType="number-pad" />
          </View>
          <View style={{ flex: 1 }}>
            <Field label="Capacité" testID="prop-capacity" value={form.capacity} onChangeText={(v) => set("capacity", v)} keyboardType="number-pad" />
          </View>
        </View>

        <SectionLabel text="Descriptif" />
        <Field
          label="Description"
          testID="prop-description"
          value={form.description}
          onChangeText={(v) => set("description", v)}
          placeholder="Décrivez le logement, l'ambiance, les points forts..."
          multiline
          style={styles.textarea}
        />

        <SectionLabel text="Pièces de l'hébergement" />
        <ChipSelect options={ROOM_OPTIONS} selected={rooms} onToggle={(v: string) => toggle(rooms, setRooms, v)} prefix="room" />

        <SectionLabel text="Équipements" />
        <ChipSelect options={AMENITY_OPTIONS} selected={amenities} onToggle={(v: string) => toggle(amenities, setAmenities, v)} prefix="amenity" />

        <PrimaryButton
          testID="save-property"
          label={editing ? "Enregistrer" : "Ajouter le logement"}
          onPress={save}
          loading={saving}
          disabled={!valid}
          style={{ marginTop: spacing.lg }}
        />
      </KeyboardAwareScrollView>
    </View>
  );
}

function SectionLabel({ text }: { text: string }) {
  return <Text style={styles.sectionLabel}>{text}</Text>;
}

function ChipSelect({ options, selected, onToggle, prefix }: any) {
  return (
    <View style={styles.chipWrap}>
      {options.map((opt: string) => {
        const active = selected.includes(opt);
        return (
          <Pressable
            key={opt}
            testID={`${prefix}-${opt}`}
            onPress={() => onToggle(opt)}
            style={[styles.selChip, active && styles.selChipActive]}
          >
            {active && <Ionicons name="checkmark" size={14} color={colors.onBrandPrimary} />}
            <Text style={[styles.selChipText, active && styles.selChipTextActive]}>{opt}</Text>
          </Pressable>
        );
      })}
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
  sectionLabel: {
    fontFamily: font.bold,
    fontSize: fontSize.lg,
    color: colors.onSurface,
    marginTop: spacing.md,
    marginBottom: spacing.md,
  },
  textarea: { minHeight: 96, textAlignVertical: "top", paddingTop: 12 },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  selChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: spacing.md,
    paddingVertical: 9,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.surfaceSecondary,
  },
  selChipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  selChipText: { fontFamily: font.medium, fontSize: fontSize.base, color: colors.onSurfaceSecondary },
  selChipTextActive: { color: colors.onBrandPrimary },
});
