import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, Alert, Modal, Linking } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import * as DocumentPicker from "expo-document-picker";
import dayjs from "dayjs";
import "dayjs/locale/fr";
dayjs.locale("fr");

import { api, uploadFile, fileUrl } from "@/src/api";
import { Field, PrimaryButton } from "@/src/components/ui";
import { colors, font, fontSize, radius, spacing } from "@/src/theme";

export default function OwnerDetail() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [editModal, setEditModal] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", phone: "", notes: "" });
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    try { setData(await api.get(`/owners/${id}/summary`)); } catch {}
    setLoading(false);
  }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  function openEdit() {
    const o = data.owner;
    setForm({ name: o.name || "", email: o.email || "", phone: o.phone || "", notes: o.notes || "" });
    setEditModal(true);
  }

  async function saveEdit() {
    if (!form.name.trim() || saving) return;
    setSaving(true);
    try { await api.put(`/owners/${id}`, form); setEditModal(false); await load(); } catch {}
    setSaving(false);
  }

  async function importDocument() {
    if (uploading) return;
    try {
      const res = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false });
      if (res.canceled || !res.assets?.length) return;
      const asset = res.assets[0];
      setUploading(true);
      const path = await uploadFile(asset.uri, asset.name || "document", asset.mimeType || "application/octet-stream");
      const updated = await api.post(`/owners/${id}/documents`, { name: asset.name || "Document", path });
      setData((d: any) => ({ ...d, owner: updated }));
    } catch (e: any) {
      Alert.alert("Import", e?.message || "Import du document échoué");
    } finally {
      setUploading(false);
    }
  }

  async function removeDocument(docId: string) {
    try {
      const updated = await api.del(`/owners/${id}/documents/${docId}`);
      setData((d: any) => ({ ...d, owner: updated }));
    } catch {}
  }

  async function remove() {
    Alert.alert("Supprimer", "Supprimer ce propriétaire ? Les logements associés seront déliés.", [
      { text: "Annuler", style: "cancel" },
      { text: "Supprimer", style: "destructive", onPress: async () => { await api.del(`/owners/${id}`); router.back(); } },
    ]);
  }

  if (loading) return <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>;
  if (!data) return <View style={styles.center}><Text>Introuvable</Text></View>;

  const { owner, properties, revenue_total, reservations_count, nights_total, per_month, per_property } = data;
  const documents = owner.documents || [];
  const maxRev = Math.max(1, ...per_month.map((m: any) => m.revenue));
  const recent = per_month.slice(-6);

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="owner-detail-back" onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>{owner.name}</Text>
        <View style={{ flexDirection: "row", gap: spacing.sm }}>
          <Pressable testID="edit-owner" onPress={openEdit} style={styles.backBtn}>
            <Ionicons name="create-outline" size={18} color={colors.onSurface} />
          </Pressable>
          <Pressable testID="delete-owner" onPress={remove} style={styles.backBtn}>
            <Ionicons name="trash-outline" size={18} color={colors.error} />
          </Pressable>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 40 }}>
        {!!(owner.email || owner.phone) && (
          <View style={styles.contactCard}>
            {!!owner.email && <View style={styles.contactRow}><Ionicons name="mail-outline" size={16} color={colors.onSurfaceSecondary} /><Text style={styles.contactText}>{owner.email}</Text></View>}
            {!!owner.phone && <View style={styles.contactRow}><Ionicons name="call-outline" size={16} color={colors.onSurfaceSecondary} /><Text style={styles.contactText}>{owner.phone}</Text></View>}
          </View>
        )}

        <View style={styles.statsRow}>
          <Stat label="Revenus" value={`${revenue_total} €`} />
          <Stat label="Réservations" value={`${reservations_count}`} />
          <Stat label="Nuitées" value={`${nights_total}`} />
        </View>

        <Text style={styles.sectionTitle}>Revenus par mois</Text>
        {recent.length === 0 ? (
          <Text style={styles.empty}>Aucun revenu enregistré.</Text>
        ) : (
          <View style={styles.chart}>
            {recent.map((m: any) => (
              <View key={m.month} style={styles.barCol}>
                <Text style={styles.barValue}>{m.revenue}</Text>
                <View style={styles.barTrack}>
                  <View style={[styles.barFill, { height: `${Math.round((m.revenue / maxRev) * 100)}%` }]} />
                </View>
                <Text style={styles.barLabel}>{dayjs(m.month + "-01").format("MMM")}</Text>
              </View>
            ))}
          </View>
        )}

        <Text style={styles.sectionTitle}>Revenus par logement</Text>
        {!per_property || per_property.length === 0 ? (
          <Text style={styles.empty}>Aucun logement associé.</Text>
        ) : (
          per_property.map((pp: any) => {
            const mx = Math.max(1, ...pp.per_month.map((m: any) => m.revenue));
            return (
              <View key={pp.id} style={styles.ppCard}>
                <View style={styles.ppHead}>
                  <Text style={styles.ppName} numberOfLines={1}>{pp.name}</Text>
                  <Text style={styles.ppRev}>{pp.revenue_total} €</Text>
                </View>
                <Text style={styles.ppSub}>{pp.nights_total} nuitées</Text>
                {pp.per_month.length === 0 ? (
                  <Text style={styles.ppSub}>Aucun revenu.</Text>
                ) : (
                  pp.per_month.slice(-6).map((m: any) => (
                    <View key={m.month} style={styles.ppMonthRow}>
                      <Text style={styles.ppMonthLabel}>{dayjs(m.month + "-01").format("MMM YY")}</Text>
                      <View style={styles.ppBarTrack}>
                        <View style={[styles.ppBarFill, { width: `${Math.round((m.revenue / mx) * 100)}%` }]} />
                      </View>
                      <Text style={styles.ppMonthVal}>{m.revenue} €</Text>
                    </View>
                  ))
                )}
              </View>
            );
          })
        )}

        <Text style={styles.sectionTitle}>Logements ({properties.length})</Text>
        {properties.length === 0 ? (
          <Text style={styles.empty}>Aucun logement associé. Liez un logement depuis sa fiche.</Text>
        ) : (
          properties.map((p: any) => (
            <Pressable key={p.id} testID={`owner-prop-${p.id}`} onPress={() => router.push(`/property/${p.id}`)} style={styles.propRow}>
              <Ionicons name="business-outline" size={18} color={colors.onSurfaceSecondary} />
              <Text style={styles.propName} numberOfLines={1}>{p.name}</Text>
              <Ionicons name="chevron-forward" size={18} color={colors.onSurfaceTertiary} />
            </Pressable>
          ))
        )}

        <View style={styles.docHead}>
          <Text style={[styles.sectionTitle, { marginTop: 0 }]}>Documents ({documents.length})</Text>
          <Pressable testID="import-document" onPress={importDocument} style={styles.importBtn} disabled={uploading}>
            {uploading ? (
              <ActivityIndicator size="small" color={colors.brandPrimary} />
            ) : (
              <>
                <Ionicons name="cloud-upload-outline" size={16} color={colors.brandPrimary} />
                <Text style={styles.importBtnText}>Importer</Text>
              </>
            )}
          </Pressable>
        </View>
        {documents.length === 0 ? (
          <Text style={styles.empty}>Aucun document. Importez baux, mandats, attestations...</Text>
        ) : (
          documents.map((doc: any) => (
            <View key={doc.id} style={styles.docRow}>
              <Ionicons name="document-text-outline" size={18} color={colors.onSurfaceSecondary} />
              <Pressable style={{ flex: 1 }} onPress={() => Linking.openURL(fileUrl(doc.path))}>
                <Text style={styles.docName} numberOfLines={1}>{doc.name}</Text>
                {!!doc.created_at && <Text style={styles.docDate}>{dayjs(doc.created_at).format("DD MMM YYYY")}</Text>}
              </Pressable>
              <Pressable testID={`del-doc-${doc.id}`} onPress={() => removeDocument(doc.id)} hitSlop={8}>
                <Ionicons name="trash-outline" size={18} color={colors.error} />
              </Pressable>
            </View>
          ))
        )}
      </ScrollView>

      <Modal visible={editModal} animationType="slide" transparent onRequestClose={() => setEditModal(false)}>
        <View style={styles.modalWrap}>
          <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
            <View style={styles.sheetHead}>
              <Text style={styles.sheetTitle}>Modifier le propriétaire</Text>
              <Pressable testID="close-owner-edit" onPress={() => setEditModal(false)}><Ionicons name="close" size={22} color={colors.onSurface} /></Pressable>
            </View>
            <KeyboardAwareScrollView bottomOffset={20}>
              <Field label="Nom" testID="edit-owner-name" value={form.name} onChangeText={(v) => setForm((f) => ({ ...f, name: v }))} placeholder="M. Dupont / SCI Azur" />
              <Field label="Email" testID="edit-owner-email" value={form.email} onChangeText={(v) => setForm((f) => ({ ...f, email: v }))} placeholder="contact@exemple.fr" autoCapitalize="none" keyboardType="email-address" />
              <Field label="Téléphone" testID="edit-owner-phone" value={form.phone} onChangeText={(v) => setForm((f) => ({ ...f, phone: v }))} placeholder="06 12 34 56 78" keyboardType="phone-pad" />
              <Field label="Notes" testID="edit-owner-notes" value={form.notes} onChangeText={(v) => setForm((f) => ({ ...f, notes: v }))} placeholder="Informations complémentaires" multiline style={styles.textarea} />
              <PrimaryButton testID="save-owner-edit" label="Enregistrer" onPress={saveEdit} loading={saving} disabled={!form.name.trim()} />
            </KeyboardAwareScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function Stat({ label, value }: any) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  backBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  title: { fontFamily: font.bold, fontSize: fontSize.xl, color: colors.onSurface, flex: 1 },
  contactCard: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.lg, gap: spacing.sm, marginBottom: spacing.lg },
  contactRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  contactText: { fontFamily: font.medium, fontSize: fontSize.base, color: colors.onSurfaceSecondary },
  statsRow: { flexDirection: "row", gap: spacing.md },
  stat: { flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.lg, alignItems: "center" },
  statValue: { fontFamily: font.bold, fontSize: fontSize.xl, color: colors.onSurface },
  statLabel: { fontFamily: font.regular, fontSize: fontSize.sm, color: colors.onSurfaceTertiary, marginTop: 2 },
  sectionTitle: { fontFamily: font.semibold, fontSize: fontSize.lg, color: colors.onSurface, marginTop: spacing.xl, marginBottom: spacing.md },
  empty: { fontFamily: font.regular, fontSize: fontSize.base, color: colors.onSurfaceTertiary },
  chart: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", height: 170, backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, padding: spacing.md },
  barCol: { flex: 1, alignItems: "center", height: "100%", justifyContent: "flex-end" },
  barValue: { fontFamily: font.medium, fontSize: 10, color: colors.onSurfaceSecondary, marginBottom: 4 },
  barTrack: { width: 22, flex: 1, justifyContent: "flex-end", borderRadius: radius.sm, overflow: "hidden" },
  barFill: { width: "100%", backgroundColor: colors.brandPrimary, borderRadius: radius.sm, minHeight: 3 },
  barLabel: { fontFamily: font.medium, fontSize: 11, color: colors.onSurfaceTertiary, marginTop: 6 },
  propRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.lg, marginBottom: spacing.sm },
  propName: { fontFamily: font.semibold, fontSize: fontSize.lg, color: colors.onSurface, flex: 1 },
  ppCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.sm },
  ppHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  ppName: { fontFamily: font.semibold, fontSize: fontSize.lg, color: colors.onSurface, flex: 1 },
  ppRev: { fontFamily: font.bold, fontSize: fontSize.lg, color: colors.brandPrimary },
  ppSub: { fontFamily: font.regular, fontSize: fontSize.sm, color: colors.onSurfaceTertiary, marginTop: 2, marginBottom: spacing.sm },
  ppMonthRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: 6 },
  ppMonthLabel: { fontFamily: font.medium, fontSize: fontSize.sm, color: colors.onSurfaceSecondary, width: 58 },
  ppBarTrack: { flex: 1, height: 8, backgroundColor: colors.surfaceSecondary, borderRadius: 4, overflow: "hidden" },
  ppBarFill: { height: "100%", backgroundColor: colors.brandPrimary, borderRadius: 4, minWidth: 2 },
  ppMonthVal: { fontFamily: font.semibold, fontSize: fontSize.sm, color: colors.onSurface, width: 62, textAlign: "right" },
  docHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.xl, marginBottom: spacing.md },
  importBtn: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: colors.surfaceSecondary, paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.pill },
  importBtnText: { fontFamily: font.semibold, fontSize: fontSize.sm, color: colors.brandPrimary },
  docRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.lg, marginBottom: spacing.sm },
  docName: { fontFamily: font.semibold, fontSize: fontSize.base, color: colors.onSurface },
  docDate: { fontFamily: font.regular, fontSize: fontSize.sm, color: colors.onSurfaceTertiary, marginTop: 2 },
  modalWrap: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg, maxHeight: "85%" },
  sheetHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.lg },
  sheetTitle: { fontFamily: font.bold, fontSize: fontSize.xl, color: colors.onSurface },
  textarea: { minHeight: 90, textAlignVertical: "top" },
});
