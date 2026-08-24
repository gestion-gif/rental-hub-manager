# ruff: noqa: F403, F405
from core import *  # noqa: F401


_HELP_KNOWLEDGE = (
    "Casanéo est une application de gestion de locations saisonnières (channel manager). "
    "Fonctions principales : "
    "Accueil (tableau de bord du jour, arrivées/départs, tâches) ; "
    "Réservations (créer/modifier, statuts demande/confirmée/arrivée/départ/annulée, paiements, caution, remise des clés) ; "
    "Calendrier/Planning (vue multi-logements, prix par nuit, disponibilités) ; "
    "Logements (fiche, photos jusqu'à 30, tarifs de base et par saison, équipements, taxe de séjour, frais de ménage) ; "
    "Relevé propriétaires (revenus, frais de gestion, commissions, envoi par email/PDF, vue mensuelle/trimestrielle) ; "
    "Assistant IA (réponses aux voyageurs, suggestions de tarifs) ; "
    "Site de réservation directe public (vitrine, paiement Stripe, acompte, emails de confirmation, enregistrement en ligne) ; "
    "Promotions (codes promo, réductions par logement) ; "
    "Enregistrement en ligne (formulaire d'arrivée + rappels automatiques) ; "
    "Rapports & avis (rapport mensuel automatique, demandes d'avis) ; "
    "Intégrations (Lodgify, Channex, import/export iCal Airbnb & Booking) ; "
    "Équipe & rôles (membres administrateurs, personnel ménage/technique avec permissions) ; "
    "Paramètres société (coordonnées sur les relevés), politique de réservation, commissions, taxe de séjour, paiement."
)


class HelpAskRequest(BaseModel):
    question: str
    screen: str = ""


@api_router.post("/ai/help-ask")
async def ai_help_ask(payload: HelpAskRequest, user=Depends(get_current_user)):
    q = (payload.question or "").strip()
    if not q:
        raise HTTPException(status_code=400, detail="Question vide")
    ctx = f"\nL'utilisateur consulte actuellement l'écran : « {payload.screen} »." if payload.screen else ""
    system = (
        "Tu es l'assistant d'aide de l'application Casanéo. Tu aides l'utilisateur (un gestionnaire de "
        "locations saisonnières) à utiliser le logiciel. Réponds UNIQUEMENT en français, de façon claire, "
        "concise et pratique (étapes numérotées si utile). Base-toi sur les fonctionnalités décrites ci-dessous. "
        "Si une question sort du périmètre du logiciel, invite poliment à contacter leur support interne. "
        f"\n\nFONCTIONNALITÉS DE CASANÉO :\n{_HELP_KNOWLEDGE}"
    )
    chat = make_chat(system, f"help_{user['user_id']}")
    answer = await chat.send_message(UserMessage(text=f"{q}{ctx}"))
    return {"answer": answer}


@api_router.post("/ai/guest-reply")
async def ai_guest_reply(payload: GuestReplyRequest, user=Depends(get_current_user)):
    context = ""
    if payload.property_id:
        prop = await db.properties.find_one({"id": payload.property_id, "user_id": user["user_id"]}, {"_id": 0})
        if prop:
            context = f"Logement: {prop.get('name')} à {prop.get('location')}, {prop.get('bedrooms')} chambres, capacité {prop.get('capacity')} personnes."
    system = (
        "Tu es l'assistant d'un hôte de location saisonnière. "
        "Tu rédiges des réponses courtes, professionnelles et chaleureuses aux voyageurs, en français. "
        "Réponds uniquement avec le message prêt à envoyer, sans préambule."
    )
    chat = make_chat(system, f"reply_{user['user_id']}")
    prompt = f"Ton souhaité: {payload.tone}. {context}\nMessage du voyageur: \"{payload.guest_message}\"\nRédige une réponse."
    reply = await chat.send_message(UserMessage(text=prompt))
    return {"reply": reply}


@api_router.post("/ai/pricing-suggestion")
async def ai_pricing(payload: PricingRequest, user=Depends(get_current_user)):
    prop = await db.properties.find_one({"id": payload.property_id, "user_id": user["user_id"]}, {"_id": 0})
    if not prop:
        raise HTTPException(status_code=404, detail="Property not found")
    system = (
        "Tu es un expert en tarification (revenue management) de locations saisonnières. "
        "Tu réponds STRICTEMENT en JSON valide (aucun texte hors JSON), au format : "
        '{"advice": "conseils en français, 3-4 puces max", '
        '"seasons": [{"name": "Basse saison", "start_date": "YYYY-MM-DD", "end_date": "YYYY-MM-DD", "price": nombre}, '
        '{"name": "Moyenne saison", ...}, {"name": "Haute saison", ...}]}. '
        "Propose exactement 3 saisons cohérentes (basse, moyenne, haute) couvrant la période demandée, "
        "avec des prix/nuit concrets et croissants."
    )
    chat = make_chat(system, f"pricing_{user['user_id']}")
    period = payload.period or "les prochaines semaines"
    seasons = prop.get("seasons") or []
    seasons_txt = ""
    if seasons:
        seasons_txt = "Saisons déjà configurées: " + "; ".join(
            f"{s.get('name')} ({s.get('start_date')}→{s.get('end_date')}): {s.get('price')}€/nuit" for s in seasons
        ) + ".\n"
    prompt = (
        f"Logement: {prop.get('name')} à {prop.get('location')}, {prop.get('bedrooms')} chambres, "
        f"capacité {prop.get('capacity')}. Prix de base actuel: {prop.get('base_price')}€/nuit.\n"
        f"{seasons_txt}"
        f"Donne une recommandation de tarification pour {period} (année {date.today().year} ou suivante)."
    )
    raw = await chat.send_message(UserMessage(text=prompt))
    advice, seasons_out = _parse_pricing_json(raw)
    return {"suggestion": advice, "seasons": seasons_out,
            "season": seasons_out[0] if seasons_out else None}

