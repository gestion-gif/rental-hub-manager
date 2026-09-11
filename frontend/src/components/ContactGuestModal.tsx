import React, { useCallback, useEffect, useState } from "react";
import {
  Modal,
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  KeyboardAvoidingView,
} from "react-native";
import Ionicons from "@react-native-vector-icons/ionicons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api } from "@/src/api";
import { colors, font, fontSize, radius, spacing } from "@/src/theme";

type Channel = "whatsapp" | "email" | "platform";

const CHANNEL_META: Record<Channel, { label: string; icon: any; color: string }> = {
  whatsapp: { label: "WhatsApp", icon: "logo-whatsapp", color: "#25D366" },
  email: { label: "Email", icon: "mail", color: "#2A6F9E" },
  platform: { label: "Plateforme", icon: "chatbubbles", color: "#FF5A5F" },
};

export function ContactGuestModal({
  visible,
  reservationId,
  onClose,
}: {
  visible: boolean;
  reservationId: string;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [ctx, setCtx] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [channel, setChannel] = useState<Channel | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const c = await api.get(`/messaging/context?reservation_id=${reservationId}`);
      setCtx(c);
      const first: Channel | null = c.channels.whatsapp
        ? "whatsapp"
        : c.channels.email
        ? "email"
        : c.channels.platform.available
        ? "platform"
        : null;
      setChannel(first);
    } catch {
      setCtx(null);
    }
    setLoading(false);
  }, [reservationId]);

  useEffect(() => {
    if (visible) {
      setBody("");
      setSubject("");
      load();
    }
  }, [visible, load]);

  async function send() {
    if (!body.trim()) {
      Alert.alert("Message vide", "Écrivez un message avant d'envoyer.");
      return;
    }
    if (channel === "whatsapp") {
      const phone = ctx?.guest_phone || "";
      const url = `https://wa.me/${phone}?text=${encodeURIComponent(body.trim())}`;
      const ok = await Linking.canOpenURL(url).catch(() => false);
      if (ok) {
        await Linking.openURL(url);
        api.post("/messaging/log-whatsapp", { reservation_id: reservationId, body: body.trim() }).catch(() => {});
        onClose();
      } else {
        Alert.alert("WhatsApp indisponible", "Impossible d'ouvrir WhatsApp sur cet appareil.");
      }
      return;
    }
    setSending(true);
    try {
      const res = await api.post("/messaging/send", {
        reservation_id: reservationId,
        channel,
        subject: subject.trim(),
        body: body.trim(),
      });
      if (res.sent) {
        Alert.alert("Envoyé ✅", channel === "email" ? `Email envoyé à ${res.to}.` : "Message envoyé sur la plateforme.");
        onClose();
      } else {
        const reasons: Record<string, string> = {
          no_email: "Aucune adresse email pour ce voyageur.",
          no_platform_thread: "Cette réservation n'a pas de fil de messagerie plateforme (Channex).",
          no_channex: "Channex n'est pas connecté.",
        };
        Alert.alert("Impossible", reasons[res.reason] || "Envoi impossible.");
      }
    } catch {
      Alert.alert("Erreur", "Envoi impossible. Réessayez.");
    }
    setSending(false);
  }

  const snippets: any[] = ctx ? [...(ctx.templates || []), ...(ctx.quick_replies || [])] : [];
  const platformReason = ctx && !ctx.channels.platform.available;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.sheet}
        >
          <View style={styles.grabber} />
          <View style={styles.headRow}>
            <Text style={styles.title}>Contacter le voyageur</Text>
            <Pressable testID="contact-close" onPress={onClose} hitSlop={10}>
              <Ionicons name="close" size={24} color={colors.onSurface} />
            </Pressable>
          </View>

          {loading ? (
            <ActivityIndicator style={{ marginVertical: 40 }} color={colors.brandPrimary} />
          ) : !ctx ? (
            <Text style={styles.empty}>Impossible de charger les informations du voyageur.</Text>
          ) : (
            <ScrollView
              contentContainerStyle={{ paddingBottom: insets.bottom + spacing.lg }}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              {!!ctx.guest_name && <Text style={styles.guest}>{ctx.guest_name}</Text>}

              {/* Canal */}
              <Text style={styles.section}>Canal d'envoi</Text>
              <View style={styles.channelRow}>
                {(Object.keys(CHANNEL_META) as Channel[]).map((ch) => {
                  const enabled =
                    ch === "platform" ? ctx.channels.platform.available : ctx.channels[ch];
                  const active = channel === ch;
                  return (
                    <Pressable
                      key={ch}
                      testID={`contact-channel-${ch}`}
                      disabled={!enabled}
                      onPress={() => setChannel(ch)}
                      style={[
                        styles.channelChip,
                        active && { borderColor: CHANNEL_META[ch].color, backgroundColor: CHANNEL_META[ch].color + "15" },
                        !enabled && styles.channelDisabled,
                      ]}
                    >
                      <Ionicons
                        name={CHANNEL_META[ch].icon}
                        size={18}
                        color={enabled ? CHANNEL_META[ch].color : colors.onSurfaceTertiary}
                      />
                      <Text style={[styles.channelText, !enabled && { color: colors.onSurfaceTertiary }]}>
                        {CHANNEL_META[ch].label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              {platformReason && (
                <Text style={styles.hint}>
                  La messagerie plateforme (Channex) sera disponible dès qu'une réservation OTA sera reliée.
                </Text>
              )}

              {/* Modèles */}
              {snippets.length > 0 && (
                <>
                  <Text style={styles.section}>Modèles</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
                    {snippets.map((s, i) => (
                      <Pressable
                        key={s.id || i}
                        testID={`contact-tpl-${i}`}
                        onPress={() => setBody(s.body)}
                        style={styles.tplChip}
                      >
                        <Ionicons name="document-text-outline" size={14} color={colors.brandPrimary} />
                        <Text style={styles.tplText} numberOfLines={1}>{s.name}</Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                </>
              )}

              {/* Sujet (email) */}
              {channel === "email" && (
                <>
                  <Text style={styles.section}>Objet</Text>
                  <TextInput
                    testID="contact-subject"
                    value={subject}
                    onChangeText={setSubject}
                    placeholder="Objet de l'email"
                    placeholderTextColor={colors.onSurfaceTertiary}
                    style={styles.subjectInput}
                  />
                </>
              )}

              {/* Message */}
              <Text style={styles.section}>Message</Text>
              <TextInput
                testID="contact-body"
                value={body}
                onChangeText={setBody}
                placeholder="Écrivez votre message…"
                placeholderTextColor={colors.onSurfaceTertiary}
                multiline
                style={styles.bodyInput}
              />

              <Pressable
                testID="contact-send"
                onPress={send}
                disabled={sending || !channel}
                style={[styles.sendBtn, (sending || !channel) && { opacity: 0.5 }]}
              >
                {sending ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <>
                    <Ionicons name={channel === "whatsapp" ? "logo-whatsapp" : "send"} size={18} color="#fff" />
                    <Text style={styles.sendText}>
                      {channel === "whatsapp" ? "Ouvrir WhatsApp" : "Envoyer"}
                    </Text>
                  </>
                )}
              </Pressable>
            </ScrollView>
          )}
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    maxHeight: "88%",
  },
  grabber: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, marginBottom: spacing.sm },
  headRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.sm },
  title: { fontFamily: font.bold, fontSize: fontSize.xl, color: colors.onSurface },
  guest: { fontFamily: font.semibold, fontSize: fontSize.base, color: colors.onSurfaceSecondary, marginBottom: spacing.sm },
  section: { fontFamily: font.bold, fontSize: fontSize.sm, color: colors.onSurfaceTertiary, textTransform: "uppercase", letterSpacing: 0.5, marginTop: spacing.md, marginBottom: spacing.sm },
  channelRow: { flexDirection: "row", gap: spacing.sm },
  channelChip: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 12, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface },
  channelDisabled: { opacity: 0.45 },
  channelText: { fontFamily: font.semibold, fontSize: fontSize.sm, color: colors.onSurface },
  hint: { fontFamily: font.regular, fontSize: fontSize.xs, color: colors.onSurfaceTertiary, marginTop: 6, lineHeight: 16 },
  tplChip: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, maxWidth: 200 },
  tplText: { fontFamily: font.semibold, fontSize: fontSize.sm, color: colors.brandPrimary },
  subjectInput: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 10, fontFamily: font.regular, fontSize: fontSize.base, color: colors.onSurface, backgroundColor: colors.surface },
  bodyInput: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 12, minHeight: 120, fontFamily: font.regular, fontSize: fontSize.base, color: colors.onSurface, textAlignVertical: "top", backgroundColor: colors.surface },
  sendBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 15, marginTop: spacing.lg },
  sendText: { fontFamily: font.bold, fontSize: fontSize.lg, color: "#fff" },
  empty: { fontFamily: font.regular, fontSize: fontSize.base, color: colors.onSurfaceTertiary, textAlign: "center", marginVertical: 40 },
});
