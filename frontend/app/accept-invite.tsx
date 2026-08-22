import React, { useState } from "react";
import { View, Text, StyleSheet, Alert } from "react-native";
import { AntDesign } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";

import { useAuth } from "@/src/context/AuthContext";
import { PrimaryButton, Field } from "@/src/components/ui";
import { colors, font, fontSize, spacing } from "@/src/theme";

export default function AcceptInvite() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { token } = useLocalSearchParams<{ token?: string }>();
  const { acceptInvite } = useAuth();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);

  async function onSubmit() {
    if (saving) return;
    if (!token) {
      Alert.alert("Lien invalide", "Cette invitation est invalide ou a expiré.");
      return;
    }
    if (password.length < 8) {
      Alert.alert("Mot de passe trop court", "Utilisez au moins 8 caractères.");
      return;
    }
    if (password !== confirm) {
      Alert.alert("Confirmation", "Les mots de passe ne correspondent pas.");
      return;
    }
    setSaving(true);
    try {
      await acceptInvite(String(token), password);
      router.replace("/(tabs)");
    } catch (e: any) {
      Alert.alert("Échec", e?.message || "Invitation invalide ou expirée.");
    }
    setSaving(false);
  }

  return (
    <View style={styles.container} testID="accept-invite-screen">
      <StatusBar style="dark" />
      <KeyboardAwareScrollView
        bottomOffset={20}
        contentContainerStyle={{ padding: spacing.xl, paddingTop: insets.top + 60, flexGrow: 1, justifyContent: "center" }}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.logoBox}>
          <AntDesign name="home" size={24} color={colors.onBrandPrimary} />
        </View>
        <Text style={styles.title}>Créer votre compte</Text>
        <Text style={styles.subtitle}>
          Choisissez un mot de passe pour accéder à votre espace Casanéo.
        </Text>

        {!token && (
          <Text style={styles.error}>Lien d'invitation manquant ou invalide.</Text>
        )}

        <View style={styles.card}>
          <Field
            label="Mot de passe"
            testID="invite-password"
            value={password}
            onChangeText={setPassword}
            placeholder="Au moins 8 caractères"
            secureTextEntry
          />
          <Field
            label="Confirmer le mot de passe"
            testID="invite-password-confirm"
            value={confirm}
            onChangeText={setConfirm}
            placeholder="Ressaisissez le mot de passe"
            secureTextEntry
          />
          <PrimaryButton testID="accept-invite-submit" label="Créer mon compte" onPress={onSubmit} loading={saving} disabled={!token} />
        </View>
      </KeyboardAwareScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  logoBox: { width: 48, height: 48, borderRadius: 14, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center", marginBottom: spacing.lg },
  title: { fontFamily: font.bold, fontSize: fontSize.xxl, color: colors.onSurface, marginBottom: spacing.sm },
  subtitle: { fontFamily: font.regular, fontSize: fontSize.lg, color: colors.onSurfaceSecondary, lineHeight: 24, marginBottom: spacing.xl },
  error: { fontFamily: font.medium, fontSize: fontSize.base, color: colors.error, marginBottom: spacing.md },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 16, padding: spacing.lg },
});
