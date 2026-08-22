// Catalogue des rôles, langues et autorisations pour le module Utilisateurs.

export type Role =
  | "admin"
  | "manager"
  | "owner"
  | "cleaning"
  | "reception"
  | "intervenant"
  | "member";

export const ROLES: { id: Role; name: string }[] = [
  { id: "admin", name: "Administrateur" },
  { id: "manager", name: "Gestionnaire de location" },
  { id: "owner", name: "Propriétaire" },
  { id: "cleaning", name: "Personnel de nettoyage" },
  { id: "reception", name: "Personnel accueil" },
  { id: "intervenant", name: "Intervenant" },
  { id: "member", name: "Membre" },
];

export const LANGUAGES: { id: string; name: string }[] = [
  { id: "fr", name: "Français" },
  { id: "en", name: "Anglais" },
  { id: "es", name: "Espagnol" },
  { id: "de", name: "Allemand" },
  { id: "it", name: "Italien" },
  { id: "pt", name: "Portugais" },
  { id: "nl", name: "Néerlandais" },
  { id: "ar", name: "Arabe" },
  { id: "zh", name: "Chinois (Mandarin)" },
  { id: "ru", name: "Russe" },
  { id: "ja", name: "Japonais" },
  { id: "hi", name: "Hindi" },
];

export type Permission = { key: string; title: string; desc: string };

export const GENERAL_PERMISSIONS: Permission[] = [
  { key: "edit_property", title: "Modifier l'hébergement", desc: "Autoriser la modification des informations des hébergements." },
  { key: "edit_property_contacts", title: "Modifier les coordonnées des hébergements", desc: "Permettre de modifier les informations de contact. Nécessite l'autorisation de modifier les hébergements." },
  { key: "manage_property_settings", title: "Gérer les paramètres des hébergements", desc: "Permettre d'attribuer des promotions et des suppléments. Nécessite l'autorisation de modifier les hébergements." },
  { key: "manage_property_policies", title: "Gérer les politiques des hébergements", desc: "Permettre de créer/modifier des politiques via les Paramètres." },
  { key: "edit_calendar_bookings", title: "Modifier le calendrier et les réservations", desc: "Permettre de modifier le calendrier et les réservations. Nécessite des autorisations pour les informations des invités, le nom et les rapports." },
  { key: "view_guest_name", title: "Voir le nom de l'invité", desc: "Permettre de voir le nom de l'invité dans la réservation. Nécessaire pour l'accès à la boîte de réception." },
  { key: "view_guest_contact", title: "Voir les coordonnées de l'invité", desc: "Permettre l'accès aux informations de l'invité. Nécessaire pour l'accès à la boîte de réception." },
  { key: "view_booking_source", title: "Afficher la source des réservations", desc: "Permettre de voir la source de réservation, ex. Airbnb, Booking.com." },
  { key: "sync_ical", title: "Synchroniser le calendrier via iCal", desc: "Donner accès aux Paramètres pour synchroniser le calendrier via iCal." },
  { key: "download_booking_report", title: "Télécharger le rapport des réservations", desc: "Autoriser le téléchargement du rapport des réservations de l'hébergement." },
  { key: "access_website_builder", title: "Accéder au Créateur de site web", desc: "Donner accès aux outils du site web sauf la permission de publication. Accès limité au tableau de bord, aux réservations, au calendrier et au paiement du propriétaire." },
  { key: "hide_booking_prices", title: "Masquer les prix des réservations et les détails du devis", desc: "Masque les détails de prix et de devis dans les réservations et le calendrier." },
  { key: "manage_unavailable_only", title: "Gérer les périodes indisponibles uniquement", desc: "Donne accès uniquement à la gestion des périodes indisponibles. Désactive alors les coordonnées/nom de l'invité, la modification du calendrier, la source de réservation et le rapport." },
  { key: "access_pm_modules", title: "Accéder aux fonctionnalités des PM Modules", desc: "Permet l'accès aux PM Modules depuis le menu principal. Attribuez les permissions correspondantes pour les fonctions spécifiques." },
  { key: "access_owner_statements", title: "Accéder aux relevés des propriétaires", desc: "Fournit l'accès aux relevés financiers pour les propriétaires d'hébergements." },
];

export const PM_PERMISSIONS: Permission[] = [
  { key: "booking_images_manage", title: "Ajouter et supprimer des images des réservations", desc: "Permet de télécharger et de supprimer des images liées aux réservations." },
  { key: "property_images_manage", title: "Ajouter et supprimer des images des hébergements", desc: "Permet d'ajouter ou de supprimer des images des hébergements." },
  { key: "alert_guest_leaving", title: "Voir les alertes indiquant quand les invités partent", desc: "Notifie l'utilisateur qu'un invité a quitté le logement." },
  { key: "alert_missing_deposit", title: "Voir les alertes lorsqu'une caution est manquante", desc: "Affiche des alertes pour les réservations sans caution." },
  { key: "alert_missing_payment", title: "Voir les alertes lorsqu'un paiement est manquant", desc: "Informe l'utilisateur des réservations impayées." },
  { key: "view_alert_icons", title: "Voir les icônes d'alerte", desc: "Accorde la visibilité des indicateurs d'alerte." },
  { key: "pm_chat", title: "Accéder au chat dans l'application des PM Modules", desc: "Permet à l'utilisateur de communiquer via la fonction de chat dans l'application PM Modules." },
  { key: "edit_delete_booking_comments", title: "Modifier et supprimer les commentaires des réservations", desc: "Accorde la permission de modifier ou de supprimer les commentaires de réservation." },
  { key: "edit_checkin_checkout_times", title: "Modifier les heures d'arrivée et de départ", desc: "Permet de modifier les heures d'arrivée et de départ des invités." },
  { key: "access_guest_module", title: "Accéder au Module des invités", desc: "Accorde l'autorisation d'accéder au Module invité." },
  { key: "edit_guest_portal_settings", title: "Modifier les Paramètres du portail voyageur", desc: "Accorde l'autorisation de configurer le portail voyageur." },
  { key: "view_revenue_charts", title: "Voir les graphiques liés aux revenus", desc: "Accorde l'accès aux graphiques affichant la performance financière." },
  { key: "view_nonrevenue_charts", title: "Voir des graphiques non liés aux revenus", desc: "Permet de visualiser les analyses sur les opérations et l'occupation." },
  { key: "view_photo_album", title: "Voir l'album photo", desc: "Permet d'accéder aux galeries de photos." },
  { key: "access_properties_section", title: "Accéder à la section des hébergements", desc: "Accorde l'autorisation de consulter les hébergements." },
  { key: "view_guest_details", title: "Voir les détails de l'invité", desc: "Permet d'accéder aux coordonnées de l'invité." },
  { key: "view_booking_amount", title: "Voir le détail du montant des réservations", desc: "Affiche la répartition totale des coûts des réservations." },
  { key: "view_owner_email", title: "Voir l'email du propriétaire de l'hébergement", desc: "Permet d'accéder à l'adresse e-mail du propriétaire de l'hébergement." },
  { key: "access_booking_payments", title: "Accéder aux paiements de réservation", desc: "Permet de visualiser les paiements sur les réservations." },
  { key: "share_alerts", title: "Partager des alertes", desc: "Permet de notifier les autres des alertes système." },
  { key: "share_images_mobile", title: "Partager des images dans l'application mobile", desc: "Permet le partage de photos via l'application mobile." },
  { key: "view_add_booking_comments", title: "Voir et ajouter des commentaires de réservation", desc: "Permet aux utilisateurs de voir et de laisser des commentaires sur les réservations." },
  { key: "view_booking_notes", title: "Voir les notes de réservation", desc: "Permet de consulter les notes ajoutées aux réservations." },
  { key: "view_booking_images", title: "Voir les images des réservations", desc: "Accorde l'accès aux photos associées aux réservations." },
  { key: "view_detailed_payment", title: "Voir des informations de paiement détaillées", desc: "Fournit une répartition détaillée des paiements de réservation." },
  { key: "view_owner_info", title: "Voir les informations du propriétaire de l'hébergement", desc: "Permet de voir les détails sur le propriétaire de l'hébergement." },
  { key: "view_property_images", title: "Voir les images de l'hébergement", desc: "Permet d'accéder aux photos des hébergements." },
  { key: "access_pm_website", title: "Accéder au site Web PM Modules", desc: "Permet l'accès au site Web PM Modules. Si désactivé, les utilisateurs peuvent uniquement accéder à l'application mobile." },
];

const ALL_KEYS = [...GENERAL_PERMISSIONS, ...PM_PERMISSIONS].map((p) => p.key);

// Autorisations par défaut selon le rôle. L'utilisateur peut ensuite les ajuster.
export const ROLE_DEFAULTS: Record<Role, string[]> = {
  admin: ALL_KEYS,
  manager: [
    "edit_property", "edit_property_contacts", "manage_property_settings", "manage_property_policies",
    "edit_calendar_bookings", "view_guest_name", "view_guest_contact", "view_booking_source",
    "sync_ical", "download_booking_report", "access_pm_modules", "access_owner_statements",
    "view_revenue_charts", "view_nonrevenue_charts", "access_properties_section", "view_guest_details",
    "view_booking_amount", "access_booking_payments", "view_booking_notes", "view_alert_icons",
    "alert_missing_deposit", "alert_missing_payment", "edit_checkin_checkout_times",
  ],
  owner: [
    "access_owner_statements", "view_revenue_charts", "view_nonrevenue_charts",
    "access_properties_section", "view_property_images", "view_photo_album", "view_booking_amount",
    "view_booking_source",
  ],
  cleaning: [
    "access_pm_modules", "alert_guest_leaving", "view_alert_icons", "access_properties_section",
    "view_property_images", "view_photo_album", "property_images_manage", "share_images_mobile",
  ],
  reception: [
    "view_guest_name", "view_guest_contact", "view_booking_source", "access_pm_modules",
    "access_guest_module", "view_guest_details", "edit_checkin_checkout_times", "view_alert_icons",
    "alert_guest_leaving", "view_add_booking_comments", "view_booking_notes",
  ],
  intervenant: [
    "access_pm_modules", "view_alert_icons", "alert_guest_leaving", "access_properties_section",
    "view_property_images", "share_images_mobile",
  ],
  member: [],
};

export function roleName(role: string): string {
  return ROLES.find((r) => r.id === role)?.name || role;
}

export function languageName(lang: string): string {
  return LANGUAGES.find((l) => l.id === lang)?.name || lang;
}

// --- Enforcement helpers (owner sees everything; members are gated by permissions) ---
export function userCan(user: any, perm: string): boolean {
  if (!user || user.role !== "member") return true;
  return (user.permissions || []).includes(perm);
}

export function canSeeRevenue(user: any): boolean {
  return userCan(user, "view_revenue_charts");
}

export function canSeeGuestName(user: any): boolean {
  return userCan(user, "view_guest_name");
}

export function canSeePrices(user: any): boolean {
  if (!user || user.role !== "member") return true;
  const p = user.permissions || [];
  return p.includes("view_booking_amount") && !p.includes("hide_booking_prices");
}

export function guestLabel(user: any, name?: string): string {
  return canSeeGuestName(user) ? (name || "") : "Voyageur";
}

// --- Access par rôle (le compte Google propriétaire voit tout) ---
export function memberRole(user: any): string {
  return user?.role === "member" ? (user.member_role || "member") : "account_owner";
}

function memberRoleIn(user: any, roles: string[]): boolean {
  return user?.role === "member" && roles.includes(memberRole(user));
}

// Intervenant + Personnel de nettoyage : pas de boîte de réception ni paramètres.
// Propriétaire (membre) : pas de boîte de réception ni paramètres non plus.
export function canSeeInbox(user: any): boolean {
  return !memberRoleIn(user, ["cleaning", "intervenant", "owner"]);
}
export function canSeeSettings(user: any): boolean {
  // Paramètres = modifications : réservé au compte principal et aux administrateurs.
  return canModify(user);
}
// Seuls le compte principal (Google) et les membres Administrateur peuvent modifier.
export function canModify(user: any): boolean {
  if (!user || user.role !== "member") return true; // compte principal
  return memberRole(user) === "admin";
}
export function isFieldStaff(user: any): boolean {
  return user?.role === "member" && ["cleaning", "intervenant"].includes(memberRole(user));
}
// Intervenant + Personnel de nettoyage : pas de taux d'occupation ni séjours en cours.
export function canSeeOccupancy(user: any): boolean {
  return !memberRoleIn(user, ["cleaning", "intervenant"]);
}
export function canSeeCurrentStays(user: any): boolean {
  return !memberRoleIn(user, ["cleaning", "intervenant"]);
}
