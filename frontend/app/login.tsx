import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, Alert, Platform, Linking } from "react-native";
import { Image } from "expo-image";
import * as AppleAuthentication from "expo-apple-authentication";
import { LinearGradient } from "expo-linear-gradient";
import { AntDesign } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, usePathname } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";

import { useAuth } from "@/src/context/AuthContext";
import { PrimaryButton, Field } from "@/src/components/ui";
import { colors, font, fontSize, spacing, HERO_IMAGE } from "@/src/theme";

export default function Login() {
  const { signIn, signingIn, user, loginWithPassword, loginWithApple } = useAuth();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const pathname = usePathname();
  const [showEmail, setShowEmail] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);
  const [appleAvailable, setAppleAvailable] = useState(false);

  useEffect(() => {
    // Ne redirige que si l'écran login est réellement affiché (pas si /register est au-dessus)
    if (user && pathname === "/login") router.replace("/(tabs)");
  }, [user, pathname]);

  useEffect(() => {
    if (Platform.OS === "ios") {
      AppleAuthentication.isAvailableAsync().then(setAppleAvailable).catch(() => {});
    }
  }, []);

  async function onApple() {
    try {
      const cred = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });
      const name = [cred.fullName?.givenName, cred.fullName?.familyName].filter(Boolean).join(" ");
      await loginWithApple(cred.identityToken || "", name, cred.email || "");
    } catch (e: any) {
      if (e?.code === "ERR_REQUEST_CANCELED") return;
      Alert.alert("Connexion Apple", "Échec de la connexion avec Apple. Réessayez.");
    }
  }

  async function onEmailLogin() {
    if (loggingIn) return;
    if (!email.trim() || !password) {
      Alert.alert("Champs requis", "Saisissez votre email et votre mot de passe.");
      return;
    }
    setLoggingIn(true);
    try {
      await loginWithPassword(email.trim(), password);
    } catch {
      Alert.alert("Connexion échouée", "Email ou mot de passe incorrect.");
    }
    setLoggingIn(false);
  }

  return (
    <View style={styles.container} testID="login-screen">
      <StatusBar style="light" />
      <Image source={{ uri: HERO_IMAGE }} style={StyleSheet.absoluteFill} contentFit="cover" />
      <LinearGradient
        colors={["transparent", "rgba(28,28,30,0.4)", "rgba(28,28,30,0.96)"]}
        locations={[0, 0.45, 0.85]}
        style={StyleSheet.absoluteFill}
      />
      <KeyboardAwareScrollView
        bottomOffset={20}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xl, paddingTop: insets.top + 80 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.logoWrap}>
          <Image
            source={require("@/assets/images/casaneo-logo.png")}
            style={styles.logoImg}
            contentFit="contain"
          />
        </View>
        <Text style={styles.title}>Gérez vos locations{"\n"}saisonnières sans effort</Text>
        <Text style={styles.subtitle}>
          Réservations, calendrier, tarifs par saison et assistant IA — tout au même endroit.
        </Text>
        <PrimaryButton
          testID="google-signin-button"
          label="Continuer avec Google"
          onPress={signIn}
          loading={signingIn}
          variant="secondary"
          style={{ backgroundColor: colors.surface }}
          icon={<AntDesign name="google" size={18} color={colors.onSurface} />}
        />

        {appleAvailable && (
          <AppleAuthentication.AppleAuthenticationButton
            buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
            buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
            cornerRadius={999}
            style={styles.appleBtn}
            onPress={onApple}
          />
        )}

        {!showEmail ? (
          <>
            <Pressable testID="show-email-login" onPress={() => setShowEmail(true)} style={styles.linkBtn}>
              <Text style={styles.linkText}>Se connecter avec un email et un mot de passe</Text>
            </Pressable>
            <Pressable testID="go-register" onPress={() => router.push("/register")} style={styles.linkBtn}>
              <Text style={styles.linkText}>Nouveau ? Créer un compte — essai gratuit 14 jours</Text>
            </Pressable>
          </>
        ) : (
          <View style={styles.emailBox}>
            <Field
              label="Email"
              testID="login-email"
              value={email}
              onChangeText={setEmail}
              placeholder="vous@email.com"
              keyboardType="email-address"
              autoCapitalize="none"
            />
            <Field
              label="Mot de passe"
              testID="login-password"
              value={password}
              onChangeText={setPassword}
              placeholder="Votre mot de passe"
              secureTextEntry
            />
            <PrimaryButton testID="email-signin-button" label="Se connecter" onPress={onEmailLogin} loading={loggingIn} />
          </View>
        )}

        <Text style={styles.legal}>
          En continuant, vous acceptez nos conditions d’utilisation.{" "}
          <Text
            testID="privacy-link"
            style={styles.legalLink}
            onPress={() => Linking.openURL(`${process.env.EXPO_PUBLIC_BACKEND_URL}/api/privacy`)}
          >
            Politique de confidentialité
          </Text>
        </Text>
      </KeyboardAwareScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surfaceInverse },
  content: {
    flexGrow: 1,
    justifyContent: "flex-end",
    paddingHorizontal: spacing.xl,
  },
  brandRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.lg },
  logoWrap: { alignSelf: "flex-start", borderRadius: 16, marginBottom: spacing.lg, overflow: "hidden" },
  logoImg: { width: 232, height: 73 },
  appleBtn: { width: "100%", height: 52, marginTop: spacing.md },
  logoBox: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: colors.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
  },
  brandName: { color: colors.onSurfaceInverse, fontFamily: font.bold, fontSize: fontSize.xl },
  title: {
    color: colors.onSurfaceInverse,
    fontFamily: font.bold,
    fontSize: 30,
    lineHeight: 38,
    marginBottom: spacing.md,
  },
  subtitle: {
    color: "rgba(255,255,255,0.85)",
    fontFamily: font.regular,
    fontSize: fontSize.lg,
    lineHeight: 24,
    marginBottom: spacing.xl,
  },
  linkBtn: { paddingVertical: spacing.md, alignItems: "center" },
  linkText: { color: colors.onSurfaceInverse, fontFamily: font.semibold, fontSize: fontSize.base, textDecorationLine: "underline" },
  emailBox: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: spacing.lg,
    marginTop: spacing.lg,
  },
  legal: {
    color: "rgba(255,255,255,0.6)",
    fontFamily: font.regular,
    fontSize: fontSize.sm,
    textAlign: "center",
    marginTop: spacing.lg,
  },
  legalLink: {
    color: "rgba(255,255,255,0.9)",
    fontFamily: font.semibold,
    textDecorationLine: "underline",
  },
});
