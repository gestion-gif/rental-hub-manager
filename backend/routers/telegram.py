# ruff: noqa: F403, F405
from core import *  # noqa: F401
from telegram_notify import tg_detect_chats, tg_send_raw, build_daily_digest


@api_router.get("/telegram/chats")
async def telegram_chats(token: str = "", user=Depends(get_current_user)):
    """Détecte les chats connus du bot. Le token peut être passé en query
    (avant enregistrement) ou lu depuis les réglages sauvegardés."""
    tok = token.strip()
    if not tok:
        doc = await db.preferences.find_one({"user_id": user["user_id"]}, {"_id": 0, "telegram": 1}) or {}
        tok = ((doc.get("telegram") or {}).get("bot_token") or "").strip()
    if not tok:
        raise HTTPException(status_code=400, detail="Renseignez d'abord le token du bot")
    try:
        chats = await tg_detect_chats(tok)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"Telegram : {e}")
    except Exception:
        raise HTTPException(status_code=502, detail="Telegram injoignable, réessayez")
    return {"chats": chats}


class TelegramTestIn(BaseModel):
    target: str = "admin"  # admin | ops
    token: str = ""
    chat_id: str = ""


@api_router.post("/telegram/test")
async def telegram_test(payload: TelegramTestIn, user=Depends(get_current_user)):
    """Envoie un message de test dans le chat choisi (réglages sauvegardés ou fournis)."""
    doc = await db.preferences.find_one({"user_id": user["user_id"]}, {"_id": 0, "telegram": 1}) or {}
    tg = doc.get("telegram") or {}
    tok = payload.token.strip() or (tg.get("bot_token") or "")
    chat = payload.chat_id.strip() or (
        tg.get("chat_ops") if payload.target == "ops" else tg.get("chat_admin")) or ""
    if not tok or not chat:
        raise HTTPException(status_code=400, detail="Token ou chat manquant")
    if payload.target == "ops":
        text = ("✅ <b>Casanéo — test réussi !</b>\nCe chat recevra le programme du jour "
                "(ménages, arrivées, départs) et les tâches décalées.")
    else:
        text = ("✅ <b>Casanéo — test réussi !</b>\nCe chat recevra les nouvelles réservations, "
                "annulations et paiements.")
    try:
        await tg_send_raw(tok, chat, text)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"Telegram : {e}")
    except Exception:
        raise HTTPException(status_code=502, detail="Telegram injoignable, réessayez")
    return {"sent": True}


@api_router.post("/telegram/send-digest")
async def telegram_send_digest_now(user=Depends(get_current_user)):
    """Envoie immédiatement le récapitulatif du jour (bouton de la page réglages)."""
    uid = user["user_id"]
    doc = await db.preferences.find_one({"user_id": uid}, {"_id": 0, "telegram": 1}) or {}
    tg = doc.get("telegram") or {}
    chat = tg.get("chat_ops") or tg.get("chat_admin")
    if not tg.get("bot_token") or not chat:
        raise HTTPException(status_code=400, detail="Configurez d'abord le bot et un chat")
    text = await build_daily_digest(uid, date.today().isoformat())
    if not text:
        return {"sent": False, "empty": True}
    try:
        await tg_send_raw(tg["bot_token"], chat, text)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"Telegram : {e}")
    return {"sent": True}
