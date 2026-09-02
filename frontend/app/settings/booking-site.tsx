import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, Switch, ActivityIndicator, TextInput, Platform, Linking, Alert } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { ensurePhotoAccess } from "@/src/utils/photoAccess";
import * as Clipboard from "expo-clipboard";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";

import { api, uploadFile, fileUrl } from "@/src/api";
import { HelpButton } from "@/src/components/HelpButton";
import { colors, font, fontSize, radius, spacing } from "@/src/theme";

export default function BookingSiteSettings() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [enabled, setEnabled] = useState(false);
  const [slug, setSlug] = useState("");
  const [depositPolicyId, setDepositPolicyId] = useState("");
  const [balanceAuto, setBalanceAuto] = useState(true);
  const [balanceDays, setBalanceDays] = useState(7);
  const [scEnabled, setScEnabled] = useState(false);
  const [scTitle, setScTitle] = useState("");
  const [scIntro, setScIntro] = useState("");
  const [scHero, setScHero] = useState("");
  const [uploadingHero, setUploadingHero] = useState(false);
  const [policies, setPolicies] = useState<any[]>([]);
  const [props, setProps] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [p, pr, pol] = await Promise.all([api.get("/preferences"), api.get("/properties"), api.get("/booking-policies")]);
      setEnabled(!!p.public_site?.enabled);
      setSlug(p.public_site?.slug || "");
      setDepositPolicyId(p.public_site?.deposit_policy_id || "");
      setBalanceAuto(p.public_site?.balance_auto ?? true);
      setBalanceDays(p.public_site?.balance_days ?? 7);
      const s = p.public_site?.showcase || {};
      setScEnabled(!!s.enabled); setScTitle(s.title || ""); setScIntro(s.intro || ""); setScHero(s.hero_photo || "");
      setProps(pr);
      setPolicies(pol.policies || []);
    } catch {}
    setLoading(false);
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const publicUrl = slug
    ? `${Platform.OS === "web" ? window.location.origin : "https://votre-app"}/book/${slug}`
    : "";

  async function save() {
    setSaving(true);
    try {
      const p = await api.put("/preferences", { public_site: {
        enabled, slug: slug.trim(), deposit_policy_id: depositPolicyId,
        balance_auto: balanceAuto, balance_days: balanceDays,
        showcase: { enabled: scEnabled, title: scTitle, intro: scIntro, hero_photo: scHero },
      } });
      setSlug(p.public_site?.slug || "");
      setEnabled(!!p.public_site?.enabled);
      setDepositPolicyId(p.public_site?.deposit_policy_id || "");
      Alert.alert("Enregistré", "Les réglages du site ont été mis à jour.");
    } catch { Alert.alert("Erreur", "Impossible d'enregistrer."); }
    setSaving(false);
  }

  async function togglePublished(id: string, val: boolean) {
    setProps((list) => list.map((p) => (p.id === id ? { ...p, published: val } : p)));
    try { await api.patch(`/properties/${id}/published`, { published: val }); }
    catch { setProps((list) => list.map((p) => (p.id === id ? { ...p, published: !val } : p))); }
  }

  async function copyLink() {
    await Clipboard.setStringAsync(publicUrl);
    Alert.alert("Copié", "Le lien du site a été copié.");
  }

  async function pickHero() {
    if (!(await ensurePhotoAccess())) return;
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.8 });
    if (result.canceled) return;
    const asset = result.assets[0];
    setUploadingHero(true);
    try {
      const path = await uploadFile(asset.uri, asset.fileName || `hero_${Date.now()}.jpg`, asset.mimeType || "image/jpeg");
      setScHero(path);
    } catch { Alert.alert("Erreur", "Téléversement impossible."); }
    setUploadingHero(false);
  }

  if (loading) {
    return (
      <View style={styles.container}>
        <Header insets={insets} onBack={() => router.back()} />
        <ActivityIndicator style={{ marginTop: 60 }} color={colors.brandPrimary} />
      </View>
    );
  }

  const publishedCount = props.filter((p) => p.published !== false).length;

  return (
    <View style={styles.container}>
      <Header insets={insets} onBack={() => router.back()} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 40 }} showsVerticalScrollIndicator={false}>
        <Text style={styles.intro}>Site de réservation</Text>
        <Text style={styles.introSub}>Publiez un site public où vos clients réservent en direct (paiement par carte), sans commission d'intermédiaire.</Text>

        <View style={styles.card}>
          <View style={styles.optRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.optTitle}>Activer le site public</Text>
              <Text style={styles.optSub}>Rendez votre site accessible via un lien à partager.</Text>
            </View>
            <Switch testID="site-enabled" value={enabled} onValueChange={setEnabled}
              trackColor={{ false: colors.border, true: colors.brandPrimary }} thumbColor="#fff" />
          </View>
        </View>

        <Text style={styles.group}>Adresse du site</Text>
        <View style={styles.slugRow}>
          <Text style={styles.slugPrefix}>/book/</Text>
          <TextInput testID="site-slug" value={slug} onChangeText={(t) => setSlug(t.toLowerCase().replace(/[^a-z0-9-]/g, "-"))}
            placeholder="mhpimmo" placeholderTextColor={colors.onSurfaceTertiary} autoCapitalize="none" style={styles.slugInput} />
        </View>

        {!!publicUrl && enabled && (
          <View style={styles.linkCard}>
            <Text style={styles.linkText} numberOfLines={1}>{publicUrl}</Text>
            <View style={styles.linkActions}>
              <Pressable testID="site-copy" onPress={copyLink} style={styles.linkBtn}><Ionicons name="copy-outline" size={16} color={colors.brandPrimary} /><Text style={styles.linkBtnText}>Copier</Text></Pressable>
              <Pressable testID="site-open" onPress={() => Platform.OS === "web" ? window.open(publicUrl, "_blank") : Linking.openURL(publicUrl)} style={styles.linkBtn}><Ionicons name="open-outline" size={16} color={colors.brandPrimary} /><Text style={styles.linkBtnText}>Ouvrir</Text></Pressable>
            </View>
          </View>
        )}
        <Text style={styles.note}>Pour utiliser votre nom de domaine (ex. mhpimmo.fr), connectez-le après publication de l'app depuis le bouton Publish. Le site sera aussi accessible sur /book.</Text>

        <Text style={styles.group}>Paiement à la réservation</Text>
        <Text style={styles.introSub}>Choisissez si le client paie l'intégralité ou seulement un acompte (selon une politique de réservation).</Text>
        <View style={styles.chips}>
          <Pressable testID="dep-none" onPress={() => setDepositPolicyId("")} style={[styles.chip, !depositPolicyId && styles.chipOn]}>
            <Text style={[styles.chipText, !depositPolicyId && styles.chipTextOn]}>Paiement intégral</Text>
          </Pressable>
          {policies.map((pol) => (
            <Pressable key={pol.id} testID={`dep-${pol.id}`} onPress={() => setDepositPolicyId(pol.id)} style={[styles.chip, depositPolicyId === pol.id && styles.chipOn]}>
              <Text style={[styles.chipText, depositPolicyId === pol.id && styles.chipTextOn]}>
                {pol.name}{pol.payment_count > 1 && pol.payments?.[0] ? ` (${pol.payments[0].percent}%)` : ""}
              </Text>
            </Pressable>
          ))}
        </View>
        {policies.length === 0 && <Text style={styles.note}>Créez d'abord une politique de réservation (Paramètres → Politique de réservation) pour proposer un acompte.</Text>}

        <Text style={styles.group}>Solde automatique</Text>
        <View style={styles.card}>
          <View style={styles.optRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.optTitle}>Envoyer un lien de paiement du solde</Text>
              <Text style={styles.optSub}>Le client reçoit automatiquement un email pour régler le solde avant l'arrivée.</Text>
            </View>
            <Switch testID="balance-auto" value={balanceAuto} onValueChange={setBalanceAuto}
              trackColor={{ false: colors.border, true: colors.brandPrimary }} thumbColor="#fff" />
          </View>
          {balanceAuto && (
            <View style={{ marginTop: spacing.md }}>
              <Text style={styles.optSub}>Combien de jours avant l'arrivée ?</Text>
              <View style={styles.chips}>
                {[3, 5, 7, 14].map((d) => (
                  <Pressable key={d} testID={`balance-days-${d}`} onPress={() => setBalanceDays(d)} style={[styles.chip, balanceDays === d && styles.chipOn]}>
                    <Text style={[styles.chipText, balanceDays === d && styles.chipTextOn]}>J-{d}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          )}
        </View>

        <Text style={styles.group}>Page vitrine (accueil)</Text>
        <View style={styles.card}>
          <View style={styles.optRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.optTitle}>Afficher une page d'accueil</Text>
              <Text style={styles.optSub}>Photo, titre et texte d'intro affichés avant la liste des logements.</Text>
            </View>
            <Switch testID="showcase-enabled" value={scEnabled} onValueChange={setScEnabled}
              trackColor={{ false: colors.border, true: colors.brandPrimary }} thumbColor="#fff" />
          </View>
          {scEnabled && (
            <View style={{ marginTop: spacing.md, gap: spacing.sm }}>
              <Pressable testID="showcase-hero" onPress={pickHero} disabled={uploadingHero} style={styles.heroBox}>
                {scHero ? <Image source={{ uri: fileUrl(scHero) }} style={styles.heroImg} contentFit="cover" /> :
                  uploadingHero ? <ActivityIndicator color={colors.brandPrimary} /> :
                  <View style={{ alignItems: "center", gap: 4 }}><Ionicons name="image-outline" size={26} color={colors.onSurfaceTertiary} /><Text style={styles.optSub}>Ajouter une photo de couverture</Text></View>}
              </Pressable>
              <TextInput testID="showcase-title" value={scTitle} onChangeText={setScTitle} placeholder="Titre (ex. MHP Immobilier)" placeholderTextColor={colors.onSurfaceTertiary} style={styles.scInput} />
              <TextInput testID="showcase-intro" value={scIntro} onChangeText={setScIntro} placeholder="Texte d'introduction (à propos)…" placeholderTextColor={colors.onSurfaceTertiary} style={[styles.scInput, { minHeight: 80, textAlignVertical: "top" }]} multiline />
            </View>
          )}
        </View>

        <Pressable testID="site-save" onPress={save} disabled={saving} style={[styles.saveBtn, saving && { opacity: 0.6 }]}>
          {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveText}>Enregistrer</Text>}
        </Pressable>

        <Text style={styles.group}>Hébergements affichés ({publishedCount}/{props.length})</Text>
        <View style={styles.card}>
          {props.map((p, i) => (
            <View key={p.id} style={[styles.propRow, i > 0 && styles.propBorder]}>
              <Text style={styles.propName} numberOfLines={1}>{p.name}</Text>
              <Switch testID={`site-pub-${p.id}`} value={p.published !== false} onValueChange={(v) => togglePublished(p.id, v)}
                trackColor={{ false: colors.border, true: colors.brandPrimary }} thumbColor="#fff" />
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

function Header({ insets, onBack }: any) {
  return (
    <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
      <Pressable testID="booking-site-back" onPress={onBack} style={styles.backBtn}>
        <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
      </Pressable>
      <Text style={styles.title}>Site de réservation</Text>
      <HelpButton screen="booking-site" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  backBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  title: { fontFamily: font.bold, fontSize: fontSize.lg, color: colors.onSurface },
  intro: { fontFamily: font.bold, fontSize: fontSize.xxl, color: colors.onSurface },
  introSub: { fontFamily: font.regular, fontSize: fontSize.base, color: colors.onSurfaceTertiary, marginTop: 4, marginBottom: spacing.md, lineHeight: 20 },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.lg },
  optRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  optTitle: { fontFamily: font.semibold, fontSize: fontSize.base, color: colors.onSurface },
  optSub: { fontFamily: font.regular, fontSize: fontSize.sm, color: colors.onSurfaceTertiary, marginTop: 2, lineHeight: 18 },
  group: { fontFamily: font.bold, fontSize: fontSize.base, color: colors.onSurfaceTertiary, textTransform: "uppercase", letterSpacing: 0.5, marginTop: spacing.lg, marginBottom: spacing.sm },
  slugRow: { flexDirection: "row", alignItems: "center", backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, paddingHorizontal: spacing.lg },
  slugPrefix: { fontFamily: font.medium, fontSize: fontSize.base, color: colors.onSurfaceTertiary },
  slugInput: { flex: 1, paddingVertical: 12, fontFamily: font.semibold, fontSize: fontSize.base, color: colors.onSurface },
  linkCard: { backgroundColor: "#EAF3FA", borderRadius: radius.md, padding: spacing.md, marginTop: spacing.sm },
  linkText: { fontFamily: font.medium, fontSize: fontSize.sm, color: colors.brandPrimary },
  linkActions: { flexDirection: "row", gap: spacing.lg, marginTop: spacing.sm },
  linkBtn: { flexDirection: "row", alignItems: "center", gap: 4 },
  linkBtnText: { fontFamily: font.semibold, fontSize: fontSize.sm, color: colors.brandPrimary },
  note: { fontFamily: font.regular, fontSize: fontSize.sm, color: colors.onSurfaceTertiary, marginTop: spacing.sm, lineHeight: 18 },
  saveBtn: { backgroundColor: "#17B0A6", borderRadius: radius.lg, paddingVertical: 15, alignItems: "center", marginTop: spacing.lg },
  saveText: { fontFamily: font.bold, fontSize: fontSize.lg, color: "#fff" },
  propRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md, paddingVertical: 10 },
  propBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  propName: { flex: 1, fontFamily: font.medium, fontSize: fontSize.base, color: colors.onSurface },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.sm },
  chip: { paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary },
  chipOn: { backgroundColor: colors.brandPrimary },
  chipText: { fontFamily: font.semibold, fontSize: fontSize.sm, color: colors.onSurfaceSecondary },
  chipTextOn: { color: colors.onBrandPrimary },
  heroBox: { height: 130, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, borderStyle: "dashed", alignItems: "center", justifyContent: "center", overflow: "hidden" },
  heroImg: { width: "100%", height: "100%" },
  scInput: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: 12, fontFamily: font.regular, fontSize: fontSize.base, color: colors.onSurface },
});
