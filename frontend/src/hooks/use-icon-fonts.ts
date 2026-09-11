// Icon fonts: depuis la migration vers @react-native-vector-icons (SDK 56+),
// les polices sont autolinkées en natif et fournies en web/Expo Go — plus
// aucun chargement CDN nécessaire. Le hook reste pour préserver l'API
// (splash masqué quand prêt) et résout immédiatement.
export const useIconFonts = (): readonly [boolean, Error | null] => [true, null] as const;
