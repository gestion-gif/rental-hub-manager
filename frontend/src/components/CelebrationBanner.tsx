import React, { useEffect, useMemo } from "react";
import { View, Text, StyleSheet, Pressable, Dimensions } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useAudioPlayer, setAudioModeAsync } from "expo-audio";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withSequence,
  withDelay,
  Easing,
  interpolate,
} from "react-native-reanimated";
import { font, fontSize, radius, spacing } from "@/src/theme";

const PHRASES = ["Félicitations", "Bravo", "Bien joué", "Youpi", "Génial"];

type Latest = {
  reservation_id: string;
  guest_name?: string;
  property_name?: string;
} | null;

export default function CelebrationBanner({
  count,
  latest,
  onPress,
  onDismiss,
}: {
  count: number;
  latest: Latest;
  onPress: () => void;
  onDismiss: () => void;
}) {
  const shimmer = useSharedValue(0);
  const iconWiggle = useSharedValue(0);
  const enter = useSharedValue(0);
  const width = Dimensions.get("window").width;

  const greeting = count === 0;
  const player = useAudioPlayer(require("@/assets/sounds/cash-register.mp3"));

  const phrase = useMemo(() => PHRASES[Math.floor(Math.random() * PHRASES.length)], []);

  useEffect(() => {
    // Son de caisse enregistreuse "cha-ching" uniquement pour une nouvelle réservation.
    if (!greeting) {
      setAudioModeAsync({ playsInSilentMode: true }).catch(() => {});
      try {
        player.seekTo(0);
        player.play();
      } catch {}
    }
    if (greeting) {
      // Mode "Bonjour !" : bandeau statique, aucune animation.
      enter.value = 1;
      return;
    }
    enter.value = withTiming(1, { duration: 420, easing: Easing.out(Easing.back(1.4)) });
    shimmer.value = withRepeat(
      withTiming(1, { duration: 1600, easing: Easing.inOut(Easing.ease) }),
      -1,
      false,
    );
    iconWiggle.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 260, easing: Easing.inOut(Easing.ease) }),
        withTiming(-1, { duration: 520, easing: Easing.inOut(Easing.ease) }),
        withTiming(0, { duration: 260, easing: Easing.inOut(Easing.ease) }),
        withDelay(900, withTiming(0, { duration: 1 })),
      ),
      -1,
      false,
    );
  }, [enter, shimmer, iconWiggle, greeting]);

  const shimmerStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: interpolate(shimmer.value, [0, 1], [-width * 0.7, width * 1.2]) }],
  }));

  const iconStyle = useAnimatedStyle(() => ({
    transform: [
      { rotate: `${interpolate(iconWiggle.value, [-1, 0, 1], [-14, 0, 14])}deg` },
      { scale: interpolate(iconWiggle.value, [-1, 0, 1], [1.08, 1, 1.12]) },
    ],
  }));

  const containerStyle = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [
      { translateY: interpolate(enter.value, [0, 1], [-14, 0]) },
      { scale: interpolate(enter.value, [0, 1], [0.96, 1]) },
    ],
  }));

  const multi = count > 1;
  const title = greeting
    ? "Bonjour !"
    : multi
      ? `${count} nouvelles réservations 🎉`
      : `${phrase} ! Nouvelle réservation 🎉`;
  const sub = greeting
    ? "Par quoi commençons-nous aujourd'hui ?"
    : multi
      ? "Confirmées depuis votre dernière visite"
      : latest?.property_name
        ? `${latest.guest_name ? latest.guest_name + " · " : ""}${latest.property_name}`
        : "Réservation confirmée";

  const gradientColors: [string, string, string] = greeting
    ? ["#3B82F6", "#4F8DF7", "#38BDF8"]
    : ["#0FA968", "#34C759", "#0EA5A5"];
  const iconName = greeting ? "sunny" : "trophy";

  const Wrapper: any = greeting ? View : Pressable;
  const wrapperProps = greeting ? {} : { onPress };

  return (
    <Animated.View style={[styles.wrap, containerStyle]} testID="celebration-banner">
      <Wrapper {...wrapperProps} style={styles.press}>
        <LinearGradient
          colors={gradientColors}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.gradient, greeting && styles.gradientGreeting]}
        >
          <Animated.View style={[styles.shimmer, shimmerStyle]} pointerEvents="none">
            <LinearGradient
              colors={["rgba(255,255,255,0)", "rgba(255,255,255,0.45)", "rgba(255,255,255,0)"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={StyleSheet.absoluteFill}
            />
          </Animated.View>

          <Animated.View style={[styles.iconWrap, iconStyle]}>
            <Ionicons name={iconName} size={22} color="#fff" />
          </Animated.View>

          <View style={{ flex: 1 }}>
            <Text style={styles.title} numberOfLines={1}>{title}</Text>
            <Text style={styles.sub} numberOfLines={1}>{sub}</Text>
          </View>

          {!greeting && (
            <>
              <Ionicons name="chevron-forward" size={18} color="rgba(255,255,255,0.85)" />
              <Pressable
                onPress={onDismiss}
                hitSlop={10}
                style={styles.close}
                testID="celebration-dismiss"
              >
                <Ionicons name="close" size={15} color="#fff" />
              </Pressable>
            </>
          )}
        </LinearGradient>
      </Wrapper>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: spacing.lg },
  press: { borderRadius: radius.lg, overflow: "hidden" },
  gradient: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingLeft: spacing.md,
    paddingRight: 40,
    borderRadius: radius.lg,
    overflow: "hidden",
  },
  gradientGreeting: { paddingRight: spacing.md },
  shimmer: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: 120,
    transform: [{ skewX: "-18deg" }],
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.22)",
    alignItems: "center",
    justifyContent: "center",
  },
  title: { fontFamily: font.bold, fontSize: fontSize.lg, color: "#fff" },
  sub: { fontFamily: font.regular, fontSize: fontSize.sm, color: "rgba(255,255,255,0.9)", marginTop: 2 },
  close: {
    position: "absolute",
    top: 6,
    right: 6,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "rgba(0,0,0,0.18)",
    alignItems: "center",
    justifyContent: "center",
  },
});
