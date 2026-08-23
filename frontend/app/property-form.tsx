import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";

import { api, uploadFile, fileUrl } from "@/src/api";
import { useAuth } from "@/src/context/AuthContext";
import { canModify } from "@/src/permissions";
import { Field, PrimaryButton } from "@/src/components/ui";
import { PropertyPicker } from "@/src/components/PropertyPicker";
import { ROOM_OPTIONS, AMENITY_OPTIONS } from "@/src/propertyOptions";
import { colors, font, fontSize, radius, spacing } from "@/src/theme";

export default function PropertyForm() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
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
    welcome_book_url: "",
    deposit_link: "",
    management_fee_pct: "",
    default_cleaning_fee: "",
    tourist_tax_pct: "",
    regional_tax_pct: "",
  });
  const [rooms, setRooms] = useState<string[]>([]);
  const [amenities, setAmenities] = useState<string[]>([]);
  const [owners, setOwners] = useState<any[]>([]);
  const [ownerId, setOwnerId] = useState("");
  const [keyInstructions, setKeyInstructions] = useState("");
  const [keyPhotos, setKeyPhotos] = useState<string[]>([]);
  const [uploadingKeys, setUploadingKeys] = useState(false);

  useEffect(() => {
    api.get("/owners").then(setOwners).catch(() => {});
  }, []);

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
          welcome_book_url: p.welcome_book_url || "",
          deposit_link: p.deposit_link || "",
          management_fee_pct: p.management_fee_pct ? String(p.management_fee_pct) : "",
          default_cleaning_fee: p.default_cleaning_fee ? String(p.default_cleaning_fee) : "",
          tourist_tax_pct: p.tourist_tax_pct ? String(p.tourist_tax_pct) : "",
          regional_tax_pct: p.regional_tax_pct ? String(p.regional_tax_pct) : "",
        });
        setRooms(p.rooms || []);
        setAmenities(p.amenities || []);
        setOwnerId(p.owner_id || "");
        setKeyInstructions(p.key_instructions || "");
        setKeyPhotos(p.key_photos || []);
      } catch {}
      setLoading(false);
    })();
  }, []);

  async function pickKeyPhotos() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: true,
      quality: 0.6,
    });
    if (result.canceled) return;
    setUploadingKeys(true);
    for (const asset of result.assets) {
      try {
        const name = asset.fileName || `cle_${Date.now()}.jpg`;
        const path = await uploadFile(asset.uri, name, asset.mimeType || "image/jpeg");
        setKeyPhotos((p) => [...p, path]);
      } catch {}
    }
    setUploadingKeys(false);
  }


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
      owner_id: ownerId || "",
      surface: parseFloat(form.surface) || 0,
      address: form.address.trim(),
      postal_code: form.postal_code.trim(),
      city: form.city.trim(),
      address_complement: form.address_complement.trim(),
      description: form.description.trim(),
      welcome_book_url: form.welcome_book_url.trim(),
      deposit_link: form.deposit_link.trim(),
      management_fee_pct: parseFloat(form.management_fee_pct) || 0,
      default_cleaning_fee: parseFloat(form.default_cleaning_fee) || 0,
      tourist_tax_pct: parseFloat(form.tourist_tax_pct) || 0,
      regional_tax_pct: parseFloat(form.regional_tax_pct) || 0,
      key_instructions: keyInstructions.trim(),
      key_photos: keyPhotos,
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
        {owners.length > 0 && (
          <View style={{ marginBottom: spacing.lg }}>
            <Text style={styles.ownerLabel}>Propriétaire</Text>
            <PropertyPicker
              testID="owner-picker"
              value={ownerId || "all"}
              items={owners.map((o: any) => ({ id: o.id, name: o.name }))}
              allLabel="Aucun"
              onSelect={(v: string) => {
                if (v === "all") { setOwnerId(""); set("owner", ""); }
                else { setOwnerId(v); set("owner", owners.find((o: any) => o.id === v)?.name || ""); }
              }}
            />
          </View>
        )}
        <Field label={owners.length > 0 ? "Propriétaire (nom libre)" : "Propriétaire"} testID="prop-owner" value={form.owner} onChangeText={(v) => set("owner", v)} placeholder="Nom du propriétaire" />
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

        <SectionLabel text="Gestion / Conciergerie" />
        <Field label="Frais de gestion (%)" testID="prop-mgmt-fee" value={form.management_fee_pct} onChangeText={(v) => set("management_fee_pct", v)} keyboardType="decimal-pad" placeholder="20" />
        <Text style={styles.helper}>Appliqué sur le montant des nuitées pour le relevé propriétaire.</Text>
        <Field label="Frais de ménage par défaut (€)" testID="prop-default-cleaning" value={form.default_cleaning_fee} onChangeText={(v) => set("default_cleaning_fee", v)} keyboardType="decimal-pad" placeholder="50" />
        <Text style={styles.helper}>Pré-rempli automatiquement à la création d'une réservation.</Text>

        <SectionLabel text="Taxe de séjour" />
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Field label="Taxe de séjour (%)" testID="prop-tourist-tax-pct" value={form.tourist_tax_pct} onChangeText={(v) => set("tourist_tax_pct", v)} keyboardType="decimal-pad" placeholder="5" />
          </View>
          <View style={{ flex: 1 }}>
            <Field label="Taxe add. régionale (%)" testID="prop-regional-tax-pct" value={form.regional_tax_pct} onChangeText={(v) => set("regional_tax_pct", v)} keyboardType="decimal-pad" placeholder="10" />
          </View>
        </View>
        <Text style={styles.helper}>Calculées en % du prix des nuitées et pré-remplies automatiquement dans la réservation. Modifiable aussi dans Paramètres → Taxe de séjour.</Text>

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

        <SectionLabel text="Livret d'accueil" />
        <Field
          label="Lien du livret d'accueil (envoyé aux voyageurs)"
          testID="prop-welcome-book"
          value={form.welcome_book_url}
          onChangeText={(v) => set("welcome_book_url", v)}
          placeholder="https://..."
          autoCapitalize="none"
          keyboardType="url"
        />

        <SectionLabel text="Caution" />
        <Field
          label="Lien de paiement de la caution (envoyé aux voyageurs)"
          testID="prop-deposit-link"
          value={form.deposit_link}
          onChangeText={(v) => set("deposit_link", v)}
          placeholder="https://livretaccueil.com/..."
          autoCapitalize="none"
          keyboardType="url"
        />
        <Text style={styles.helper}>
          Le montant de caution étant propre à chaque logement, collez ici le lien préparé pour ce montant.
          Utilisable dans les messages automatiques via la variable {"{caution}"} et envoyable en 1 tap depuis la réservation.
        </Text>

        <SectionLabel text="Clés" />
        <Field
          label="Code boîte à clés / instructions de récupération"
          testID="prop-key-instructions"
          value={keyInstructions}
          onChangeText={setKeyInstructions}
          placeholder="Ex : Boîte à clés à gauche de la porte, code 4582. Les clés sont à l'intérieur."
          multiline
          style={styles.textarea}
        />
        <Text style={styles.helper}>
          Ces informations sont envoyées automatiquement au voyageur dans la messagerie
          {" "}uniquement lorsque vous validez la caution de sa réservation.
        </Text>
        <Text style={styles.keyPhotoLabel}>Photos (boîte à clés, emplacement)</Text>
        <View style={styles.photoGrid}>
          {keyPhotos.map((p, i) => (
            <View key={p} style={styles.photoWrap}>
              <Image source={{ uri: fileUrl(p) }} style={styles.photo} contentFit="cover" />
              <Pressable
                testID={`remove-key-photo-${i}`}
                onPress={() => setKeyPhotos((ph) => ph.filter((x) => x !== p))}
                style={styles.photoDel}
              >
                <Ionicons name="close-circle" size={20} color="#fff" />
              </Pressable>
            </View>
          ))}
          <Pressable testID="add-key-photo" onPress={pickKeyPhotos} style={styles.addPhoto} disabled={uploadingKeys}>
            {uploadingKeys ? <ActivityIndicator color={colors.brandPrimary} /> : <Ionicons name="camera-outline" size={26} color={colors.onSurfaceSecondary} />}
          </Pressable>
        </View>

        <SectionLabel text="Pièces de l'hébergement" />
        <ChipSelect options={ROOM_OPTIONS} selected={rooms} onToggle={(v: string) => toggle(rooms, setRooms, v)} prefix="room" />

        <SectionLabel text="Équipements" />
        <ChipSelect options={AMENITY_OPTIONS} selected={amenities} onToggle={(v: string) => toggle(amenities, setAmenities, v)} prefix="amenity" />

        {canModify(user) && (
          <PrimaryButton
            testID="save-property"
            label={editing ? "Enregistrer" : "Ajouter le logement"}
            onPress={save}
            loading={saving}
            disabled={!valid}
            style={{ marginTop: spacing.lg }}
          />
        )}
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
  ownerLabel: { fontFamily: font.medium, fontSize: fontSize.base, color: colors.onSurfaceSecondary, marginBottom: spacing.sm },
  ownerChips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  ownerChip: { paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.surfaceSecondary },
  ownerChipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  ownerChipText: { fontFamily: font.medium, fontSize: fontSize.base, color: colors.onSurfaceSecondary },
  ownerChipTextActive: { color: colors.onBrandPrimary },
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
  helper: { fontFamily: font.regular, fontSize: fontSize.sm, color: colors.onSurfaceTertiary, marginTop: -spacing.sm, marginBottom: spacing.md, lineHeight: 17 },
  keyPhotoLabel: { fontFamily: font.medium, fontSize: fontSize.base, color: colors.onSurfaceSecondary, marginBottom: spacing.sm },
  photoGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.md },
  photoWrap: { width: 84, height: 84, borderRadius: radius.md, overflow: "hidden", position: "relative" },
  photo: { width: "100%", height: "100%" },
  photoDel: { position: "absolute", top: 2, right: 2, backgroundColor: "rgba(0,0,0,0.4)", borderRadius: 12 },
  addPhoto: { width: 84, height: 84, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.border, borderStyle: "dashed", alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceSecondary },
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
