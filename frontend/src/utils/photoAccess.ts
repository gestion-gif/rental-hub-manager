// Accès aux photos conforme aux règles Google Play & Apple.
// Android : le sélecteur de photos système (Photo Picker) ne requiert AUCUNE permission
// (les permissions READ_MEDIA_* sont bannies par Google Play pour un usage ponctuel).
// iOS : demande la permission photothèque, avec renvoi vers les Réglages si refus définitif.
import { Alert, Linking, Platform } from "react-native";
import * as ImagePicker from "expo-image-picker";

export async function ensurePhotoAccess(
  message = "Autorisez l'accès à vos photos pour continuer."
): Promise<boolean> {
  if (Platform.OS !== "ios") return true;
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (perm.granted) return true;
  if (!perm.canAskAgain) {
    Alert.alert("Accès aux photos refusé", message, [
      { text: "Annuler", style: "cancel" },
      { text: "Ouvrir les réglages", onPress: () => Linking.openSettings() },
    ]);
  } else {
    Alert.alert("Autorisation requise", message);
  }
  return false;
}
