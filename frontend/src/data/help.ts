// Contenu du centre d'aide Casanéo.
// Ce contenu est modifiable librement : ajoutez / corrigez les questions-réponses
// et les guides ci-dessous. Les textes s'affichent tels quels dans l'app.

export type HelpArticle = { q: string; a: string };
export type HelpGuide = { title: string; steps: string[] };
export type HelpTopic = {
  id: string;
  icon: string; // nom d'icône Ionicons
  title: string;
  summary: string;
  articles?: HelpArticle[];
  guides?: HelpGuide[];
};

export const HELP_TOPICS: HelpTopic[] = [
  {
    id: "demarrage",
    icon: "rocket-outline",
    title: "Démarrage",
    summary: "Premiers pas pour configurer votre compte.",
    guides: [
      {
        title: "Configurer votre compte en 5 étapes",
        steps: [
          "Renseignez votre société dans Paramètres → Ma société (coordonnées affichées sur les relevés et emails).",
          "Ajoutez vos logements depuis l'onglet Logements (+).",
          "Définissez le prix de base et les saisons de chaque logement.",
          "Créez ou importez vos réservations (manuellement, ou via Lodgify / Channex / iCal).",
          "Invitez votre équipe dans Paramètres → Utilisateurs si besoin.",
        ],
      },
    ],
    articles: [
      {
        q: "Comment naviguer dans l'application ?",
        a: "Ouvrez le menu latéral avec l'icône ☰ en haut à gauche. Vous y trouverez l'Accueil, les Réservations, le Calendrier, les Logements, le Relevé propriétaires, l'Assistant IA et les Paramètres.",
      },
      {
        q: "Où trouver l'aide contextuelle ?",
        a: "Le bouton « ? » présent sur chaque écran affiche des conseils propres à cette page, et vous pouvez y poser une question à l'assistant d'aide.",
      },
    ],
  },
  {
    id: "logements",
    icon: "business-outline",
    title: "Logements & tarifs",
    summary: "Créer des logements, gérer photos, prix et saisons.",
    guides: [
      {
        title: "Ajouter un logement",
        steps: [
          "Onglet Logements → bouton + en bas à droite.",
          "Renseignez le nom, l'adresse, la capacité et le nombre de chambres.",
          "Ajoutez jusqu'à 30 photos dans la galerie.",
          "Définissez le prix de base par nuit.",
          "Enregistrez : le logement apparaît dans la liste.",
        ],
      },
      {
        title: "Créer un tarif par saison",
        steps: [
          "Ouvrez la fiche du logement.",
          "Section Saisons → Ajouter une saison.",
          "Indiquez un nom (ex. Haute saison), les dates de début/fin et le prix/nuit.",
          "Le prix saisonnier remplace le prix de base sur cette période.",
        ],
      },
    ],
    articles: [
      {
        q: "Comment fonctionne la tarification dynamique ?",
        a: "Dans le Calendrier (vue d'un logement, bouton « Tarifs dynamiques »), l'IA propose un prix suggéré en gris sous le prix de base, calculé selon l'occupation et les logements comparables. Tapez la suggestion pour l'appliquer.",
      },
      {
        q: "Où régler la taxe de séjour et les frais de ménage ?",
        a: "Par logement dans sa fiche, ou globalement dans Paramètres → Taxe de séjour et Paramètres → (frais de ménage par défaut sur la fiche du logement).",
      },
    ],
  },
  {
    id: "reservations",
    icon: "list-outline",
    title: "Réservations",
    summary: "Créer, modifier et suivre les réservations.",
    guides: [
      {
        title: "Créer une réservation manuelle",
        steps: [
          "Onglet Réservations → bouton +.",
          "Choisissez le logement, les dates d'arrivée et de départ.",
          "Renseignez le voyageur et le nombre de personnes.",
          "Vérifiez le montant (nuitées + ménage + taxe de séjour).",
          "Enregistrez : la réservation apparaît dans le calendrier.",
        ],
      },
    ],
    articles: [
      {
        q: "Que signifient les statuts ?",
        a: "Demande (à confirmer), Confirmée (validée), Arrivée (voyageur sur place), Départ (séjour terminé), Annulée. Vous pouvez changer le statut depuis la fiche de la réservation.",
      },
      {
        q: "Comment enregistrer un paiement ou une caution ?",
        a: "Ouvrez la réservation : vous pouvez ajouter des paiements, marquer la caution comme validée et envoyer les instructions de clés au voyageur.",
      },
    ],
  },
  {
    id: "calendrier",
    icon: "calendar-outline",
    title: "Calendrier & planning",
    summary: "Vue des disponibilités et des prix par nuit.",
    articles: [
      {
        q: "Comment voir les prix directement sur le calendrier ?",
        a: "Dans le Planning, activez « Afficher les tarifs » : chaque nuit affiche son prix. En vue d'un seul logement, vous pouvez modifier les prix depuis l'en-tête.",
      },
      {
        q: "Puis-je voir tous les logements en même temps ?",
        a: "Oui, choisissez « Tous les logements » pour une vue chronologique multi-logements avec les réservations et les prix.",
      },
    ],
  },
  {
    id: "releves",
    icon: "document-text-outline",
    title: "Relevés propriétaires",
    summary: "Revenus, commissions et envoi aux propriétaires.",
    guides: [
      {
        title: "Envoyer un relevé à un propriétaire",
        steps: [
          "Onglet Relevé propriétaires.",
          "Choisissez le mois (ou le trimestre).",
          "Vérifiez les revenus, frais de gestion et commissions.",
          "Utilisez « Envoyer » (email + PDF) pour un logement, ou « Tout envoyer ».",
        ],
      },
    ],
    articles: [
      {
        q: "Comment sont calculés les frais de gestion ?",
        a: "Ils utilisent le taux défini sur chaque logement (management_fee_pct). Vous pouvez ajuster une commission spécifique depuis le relevé.",
      },
      {
        q: "Un rappel automatique est-il envoyé ?",
        a: "Oui, en début de mois vous recevez un rappel (email + notification) listant les relevés du mois écoulé restant à envoyer.",
      },
    ],
  },
  {
    id: "site",
    icon: "globe-outline",
    title: "Site de réservation",
    summary: "Votre site public de réservation directe (sans commission).",
    guides: [
      {
        title: "Activer votre site public",
        steps: [
          "Menu → Site Web (ou Paramètres → Site de réservation).",
          "Activez le site et vérifiez votre lien public (/book/votre-slug).",
          "Choisissez les logements à publier.",
          "Configurez l'acompte à la réservation (paiement intégral ou selon une politique).",
          "Partagez le lien : les clients réservent et paient par carte (Stripe).",
        ],
      },
    ],
    articles: [
      {
        q: "Comment fonctionne l'acompte ?",
        a: "Selon la politique choisie, le client paie un acompte à la réservation ; le solde est réclamé automatiquement par email X jours avant l'arrivée.",
      },
      {
        q: "Les clients reçoivent-ils un email de confirmation ?",
        a: "Oui, un email de confirmation avec le récapitulatif du séjour, le montant payé et un lien d'enregistrement en ligne si activé.",
      },
    ],
  },
  {
    id: "checkin",
    icon: "clipboard-outline",
    title: "Enregistrement en ligne",
    summary: "Formulaire d'arrivée et rappels automatiques.",
    articles: [
      {
        q: "Comment activer l'enregistrement en ligne ?",
        a: "Paramètres → Enregistrement en ligne. Activez le formulaire, choisissez les questions (le nombre de voyageurs est obligatoire) et activez les rappels automatiques.",
      },
      {
        q: "Le voyageur reçoit-il un rappel ?",
        a: "Oui, si les rappels sont activés, un email est envoyé quelques jours avant l'arrivée tant que le formulaire n'est pas complété.",
      },
    ],
  },
  {
    id: "promotions",
    icon: "pricetags-outline",
    title: "Promotions",
    summary: "Codes promo et réductions par logement.",
    guides: [
      {
        title: "Créer une promotion",
        steps: [
          "Paramètres → Promotions → +.",
          "Nom, description et éventuelle photo.",
          "Activez un code promo si besoin.",
          "Choisissez le type de réduction (montant fixe ou pourcentage).",
          "Sélectionnez la période et les logements concernés.",
        ],
      },
    ],
  },
  {
    id: "assistant",
    icon: "sparkles-outline",
    title: "Assistant IA",
    summary: "Réponses aux voyageurs et suggestions de tarifs.",
    articles: [
      {
        q: "Comment répondre à un voyageur avec l'IA ?",
        a: "Onglet Assistant IA → Messages : collez le message du voyageur, choisissez le ton, l'IA rédige une réponse prête à copier.",
      },
      {
        q: "Comment obtenir des suggestions de prix ?",
        a: "Assistant IA → Tarifs : choisissez un logement et une période, l'IA propose des saisons que vous pouvez appliquer en un tap.",
      },
    ],
  },
  {
    id: "integrations",
    icon: "link-outline",
    title: "Intégrations & synchronisation",
    summary: "Lodgify, Channex et calendriers iCal.",
    articles: [
      {
        q: "Comment connecter Lodgify ?",
        a: "Paramètres → Clé API Lodgify : renseignez votre clé pour synchroniser automatiquement vos réservations.",
      },
      {
        q: "Comment connecter Channex ?",
        a: "Paramètres → Channex : saisissez votre clé (production sur app.channex.io → Profil → API Key) puis importez logements, chambres et plans tarifaires.",
      },
      {
        q: "Puis-je synchroniser Airbnb / Booking en iCal ?",
        a: "Oui, Paramètres → Import / Export iCal : ajoutez les liens .ics d'Airbnb/Booking pour bloquer les dates automatiquement, et exportez votre calendrier.",
      },
    ],
  },
  {
    id: "equipe",
    icon: "people-circle-outline",
    title: "Équipe & rôles",
    summary: "Inviter des membres et gérer les permissions.",
    articles: [
      {
        q: "Comment inviter un membre ?",
        a: "Paramètres → Utilisateurs → créez un membre avec son email et ses logements, puis envoyez l'invitation. Il définit son mot de passe via le lien reçu.",
      },
      {
        q: "Quelle différence entre les rôles ?",
        a: "L'administrateur peut tout modifier. Le personnel de terrain (ménage/technique) voit surtout ses tâches et peut les marquer comme faites, mais ne modifie pas les données sensibles.",
      },
    ],
  },
];

// Aide contextuelle par écran (bouton « ? »).
export type ScreenHelp = { title: string; intro: string; tips: string[]; topicId?: string };

export const SCREEN_HELP: Record<string, ScreenHelp> = {
  index: {
    title: "Accueil",
    intro: "Votre tableau de bord du jour : arrivées, départs et tâches à faire.",
    tips: [
      "Consultez les arrivées et départs du jour en un coup d'œil.",
      "L'encart « Relevés à envoyer » peut être replié avec le chevron.",
      "Ouvrez le menu ☰ pour accéder à toutes les sections.",
    ],
    topicId: "demarrage",
  },
  calendar: {
    title: "Réservations",
    intro: "La liste de vos réservations, filtrable par statut et logement.",
    tips: [
      "Appuyez sur + pour créer une réservation manuelle.",
      "Tapez une réservation pour voir le détail, les paiements et la caution.",
    ],
    topicId: "reservations",
  },
  planning: {
    title: "Calendrier",
    intro: "Vue calendrier des disponibilités et des prix par nuit.",
    tips: [
      "Activez « Afficher les tarifs » pour voir le prix de chaque nuit.",
      "Passez en « Tous les logements » pour une vue multi-logements.",
      "En vue d'un logement, activez « Tarifs dynamiques » pour les suggestions IA.",
    ],
    topicId: "calendrier",
  },
  properties: {
    title: "Logements",
    intro: "Gérez vos logements, photos, tarifs et saisons.",
    tips: [
      "Bouton + pour ajouter un logement.",
      "Ouvrez une fiche pour gérer photos (jusqu'à 30), prix et saisons.",
      "L'icône réseau en haut ouvre le channel manager.",
    ],
    topicId: "logements",
  },
  statement: {
    title: "Relevé propriétaires",
    intro: "Revenus, frais de gestion et envoi des relevés aux propriétaires.",
    tips: [
      "Changez de mois ou passez en vue trimestrielle.",
      "Envoyez un relevé (email + PDF) par logement ou tous d'un coup.",
    ],
    topicId: "releves",
  },
  assistant: {
    title: "Assistant IA",
    intro: "Rédigez des réponses aux voyageurs et obtenez des idées de tarifs.",
    tips: [
      "Onglet Messages : collez un message voyageur, choisissez le ton.",
      "Onglet Tarifs : générez des saisons et appliquez-les en un tap.",
    ],
    topicId: "assistant",
  },
  integrations: {
    title: "Intégrations",
    intro: "Connectez Lodgify, Channex et vos calendriers iCal.",
    tips: [
      "Renseignez vos clés API pour synchroniser vos réservations.",
      "Ajoutez les liens iCal d'Airbnb/Booking pour bloquer les dates.",
    ],
    topicId: "integrations",
  },
  settings: {
    title: "Paramètres",
    intro: "Tous les réglages de votre compte et de votre société.",
    tips: [
      "Commencez par « Ma société » pour vos coordonnées sur les relevés.",
      "Configurez politique de réservation, site public, promotions et équipe ici.",
    ],
    topicId: "demarrage",
  },
  "booking-site": {
    title: "Site de réservation",
    intro: "Votre site public de réservation directe, sans commission OTA.",
    tips: [
      "Activez le site et copiez votre lien public.",
      "Choisissez les logements publiés et l'acompte à la réservation.",
    ],
    topicId: "site",
  },
};
