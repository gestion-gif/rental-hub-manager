# Plan commercial — Casanéo (SaaS)
### Vendre Casanéo comme logiciel aux conciergeries et gestionnaires de locations saisonnières
*Version 1.0 — Septembre 2026 — Zone : locale (Côte d'Azur) puis France entière*

---

## 1. Résumé exécutif

Casanéo est une **suite logicielle** de gestion de locations saisonnières (PMS + channel
manager) : une **version web complète (PC)** pour le bureau — réservations, tarifs,
comptabilité, relevés — et son application mobile compagnon **Casanéo Terrain** pour
tout piloter en déplacement (arrivées, ménages, messages, états des lieux photo).
Déjà utilisée en production sur un parc réel (24 logements, Booking.com + Airbnb via
Channex), la suite couvre tout le cycle : réservations, calendriers, tarifs, messagerie
voyageurs avec IA, avis, ménages, relevés propriétaires, comptabilité et encaissements Stripe.

**Objectif 12 mois : 40 comptes clients payants, ~3 500 € de revenu mensuel récurrent (MRR).**

Stratégie : démarrer en local par le réseau (conciergeries voisines, non concurrentes
directes ailleurs en France), prouver la valeur avec 5 à 10 clients pilotes, puis
étendre à la France entière via les communautés en ligne de conciergeries.

---

## 2. Le produit et ses forces (USP)

| Atout | Détail |
|---|---|
| **Duo web + mobile Terrain** | La version web (PC) pour la gestion au bureau, l'app mobile **Casanéo Terrain** en complément pour le terrain (arrivées, ménages, états des lieux photo, messages). Les concurrents n'ont souvent qu'une app mobile au rabais. |
| **IA intégrée** | Brouillons de réponses voyageurs, traduction automatique, réponses aux avis en un clic. |
| **100 % français** | Interface, support, taxe de séjour française, relevés propriétaires aux normes locales. |
| **Encaissement automatique** | Cartes Booking.com débitées automatiquement via Stripe (rare sur le marché). |
| **Tout-en-un réel** | Channel manager + messagerie + avis + ménages + compta + relevés : pas besoin de 3 abonnements. |
| **Éprouvé en conditions réelles** | Développé et utilisé quotidiennement par une conciergerie en activité. |

---

## 3. Le marché

- **France = 1er parc Airbnb d'Europe** (~1 million d'annonces actives) ; forte
  professionnalisation depuis la loi Le Meur (fiscalité 2025) qui pousse les
  propriétaires vers les gestionnaires professionnels.
- **Cible primaire : conciergeries de 5 à 50 logements** — assez grosses pour avoir
  besoin d'un outil, trop petites pour les solutions "enterprise" (Guesty, Avantio).
  Estimation : plusieurs milliers de structures en France, en croissance.
- **Cible secondaire : multipropriétaires (3-10 biens)** en gestion directe.
- Déclencheurs d'achat : perte de temps sur les messages, doubles réservations,
  relevés propriétaires faits sur Excel, encaissements Booking manuels.

---

## 4. Concurrence (tarifs réels 2026)

| Concurrent | Modèle | Prix pour 10 logements | Faiblesse exploitable |
|---|---|---:|---|
| **Superhote** | 57 €HT/mois (1-3 biens) + 7 €/bien | ~106 €HT/mois | Orienté loueurs individuels, app mobile limitée |
| **Smily** (ex-BookingSync) | Commission 1,2 % à 9 % + minimum mensuel | Variable (souvent > 200 €) | Commission = cher dès que le CA monte |
| **Hostaway** | ~20 €/bien/mois, sur devis | ~200 €/mois | Cher, anglophone, onboarding lourd |
| **Beds24** | 15,90 €/mois + options à la carte | 40-80 €/mois | Très technique, interface austère, pas de relevés FR |
| **Lodgify** | par bien/mois | ~100-150 €/mois | Orienté site de réservation, compta FR faible |
| **Guesty / Avantio** | Enterprise, sur devis | > 400 €/mois | Hors budget des petites conciergeries |

**Positionnement Casanéo : le tout-en-un français mobile-first, au prix forfaitaire
prévisible, entre Beds24 (pas cher mais austère) et Hostaway (complet mais cher).**

---

## 5. Tarification proposée (forfait par compte)

Abonnement mensuel HT, sans engagement, **essai gratuit 14 jours** (sans carte bancaire).
**-20 % si paiement annuel.**

| Formule | Prix/mois HT | Logements inclus | Contenu |
|---|---:|---:|---|
| **Starter** | **39 €** | jusqu'à 3 | Tout Casanéo, 1 utilisateur + 1 membre |
| **Essentiel** ⭐ | **79 €** | jusqu'à 10 | + équipe illimitée, relevés propriétaires, IA |
| **Pro** | **149 €** | jusqu'à 25 | + encaissement auto Stripe, comptabilité, exports |
| **Scale** | **249 €** | jusqu'à 50 | + support prioritaire, accompagnement migration |
| Au-delà | +4 €/logement | 50+ | Sur devis |

Comparatif frappant pour l'argumentaire : *à 10 logements, Casanéo Essentiel (79 €)
coûte 25 % de moins que Superhote (~106 €) et 60 % de moins que Hostaway (~200 €).*

**Coûts variables à provisionner par client** (marge brute visée > 75 %) :
- Channex : ~1-2 €/logement/mois (négocier un tarif partenaire volume)
- Hébergement + IA (Emergent/LLM) : ~5-15 €/compte/mois selon usage
- Stripe : payé par le client sur son propre compte Stripe (aucun coût pour vous)

---

## 6. Prévisionnel 12 mois (hypothèse prudente)

| Période | Clients payants (cumul) | Panier moyen | MRR | Notes |
|---|---:|---:|---:|---|
| M1-M2 | 3 | 0 € | 0 € | Pilotes locaux gratuits (retours produit + témoignages) |
| M3 | 5 | 60 € | 300 € | Bascule des pilotes en payant (remise fondateur -50 % à vie) |
| M4-M6 | 12 | 70 € | 840 € | Bouche-à-oreille local + groupes Facebook |
| M7-M9 | 25 | 80 € | 2 000 € | Contenu SEO + webinaires + parrainage |
| M10-M12 | 40 | 85 € | **3 400 €** | France entière, partenariats |

Hypothèses : taux de conversion essai→payant 25 %, churn mensuel < 3 %,
coût d'acquisition quasi nul au début (réseau), puis ~100 €/client (pub ciblée).

---

## 7. Acquisition : canaux et tunnel de vente

### Canaux (par ordre chronologique)
1. **Réseau local (M1-M3)** : conciergeries de votre région non concurrentes,
   groupes WhatsApp/associations de gestionnaires, offices de tourisme.
2. **Communautés en ligne (M3+)** : groupes Facebook ("Conciergeries de France",
   "Superhôtes France", "Investisseurs LCD"), forums, Discord immobilier.
3. **Contenu / SEO (M4+)** : articles comparatifs ("Superhote vs Casanéo",
   "meilleur logiciel conciergerie 2026"), tutos YouTube, guide de la taxe de séjour.
4. **Parrainage (M5+)** : 1 mois offert au parrain et au filleul.
5. **Partenariats (M6+)** : Pricelabs, photographes immobiliers, formateurs LCD
   (les formateurs "conciergerie" vendent des outils à leurs élèves : commission 20 %).
6. **Salons (M9+)** : Salon de l'immobilier, événements courte durée.

### Tunnel de vente
```
Découverte → Démo vidéo 3 min → Essai 14 j → Onboarding guidé (30 min visio)
→ Import des logements (Lodgify/Channex/iCal) → Conversion → Parrainage
```
Point clé : **l'onboarding visio de 30 min** est votre arme (les concurrents facturent
l'onboarding 200-500 €, vous l'offrez).

### Argumentaire éclair (pitch)
> « Casanéo, c'est la suite complète des conciergeries : la version web pour gérer
> votre activité au bureau — réservations Booking et Airbnb, tarifs, compta, relevés
> propriétaires — et l'app mobile Terrain pour tout suivre en déplacement : arrivées,
> ménages, messages voyageurs traduits avec réponses IA. Créée par une conciergerie,
> pour les conciergeries. 79 €/mois pour 10 logements, tout compris, 14 jours gratuits. »

---

## 8. Plan d'action 90 jours

**Jours 1-30 — Préparer**
- [ ] Finaliser l'onboarding self-service (inscription autonome + facturation Stripe)
- [ ] Page de vente simple (tarifs, démo vidéo, essai gratuit)
- [ ] Recruter 3 conciergeries pilotes locales (gratuit 2 mois contre témoignage)
- [ ] Négocier tarif partenaire Channex (volume)

**Jours 31-60 — Prouver**
- [ ] Accompagner les pilotes, corriger les frictions d'onboarding
- [ ] Recueillir 3 témoignages écrits + 1 vidéo
- [ ] Publier 2 articles comparatifs + 1 vidéo démo YouTube
- [ ] Lancer l'offre fondateur (-50 % à vie pour les 10 premiers)

**Jours 61-90 — Vendre**
- [ ] Basculer les pilotes en payant
- [ ] Poster études de cas dans 5 groupes Facebook ciblés
- [ ] Mettre en place le parrainage
- [ ] Objectif : 10 comptes payants, MRR 600 €

---

## 9. Prérequis produit avant commercialisation (roadmap technique)

| Priorité | Chantier | Statut |
|---|---|---|
| P0 | Multi-tenant (isolation par compte) | ✅ Déjà en place (user_id partout) |
| P0 | Inscription autonome + facturation Stripe (abonnements, essai 14 j, limites par formule) | 🔲 À développer |
| P0 | Onboarding guidé (connexion Channex, import logements) | 🔶 Partiel (import Lodgify/Channex existant) |
| P1 | Clé Channex par client (chaque client connecte SON compte Channex) | ✅ Architecture prête |
| P1 | Page de vente publique + démo | 🔲 À créer |
| P2 | Espace support (FAQ, tutos) | 🔲 À créer |
| P2 | Suivi d'usage par compte (limites logements, consommation IA) | 🔲 À développer |

---

## 10. Indicateurs à suivre (KPIs)

- MRR et nombre de comptes payants (hebdo)
- Taux de conversion essai → payant (cible ≥ 25 %)
- Churn mensuel (cible < 3 %)
- Délai d'onboarding (cible < 24 h entre inscription et 1re synchro)
- NPS / avis clients (cible ≥ 50)
- CAC (coût d'acquisition, cible < 3 mois de panier moyen)

---

## 11. Risques et parades

| Risque | Parade |
|---|---|
| Guerre des prix (Superhote, Beds24) | Ne pas se battre sur le prix seul : mobile + IA + accompagnement FR |
| Dépendance à Channex | Contrat partenaire ; architecture adaptateur déjà multi-fournisseurs (Lodgify) |
| Support chronophage | FAQ + vidéos + onboarding standardisé ; limiter le support téléphonique aux formules Pro+ |
| Churn saisonnier (basse saison) | Paiement annuel -20 % ; fonctionnalités hors-saison (compta, relevés, bilans) |
| Conformité (RGPD, facturation) | Politique de confidentialité ✅ ; CGV/CGU à rédiger avant lancement ; mentions facturation françaises |

---

## 12. Prochaine étape recommandée

1. Valider la grille tarifaire ci-dessus (ou l'ajuster ensemble)
2. Développer le chantier P0 « Inscription + facturation Stripe » dans Casanéo
3. Identifier vos 3 premières conciergeries pilotes cette semaine
