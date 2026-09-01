# ruff: noqa: F403, F405
from core import *  # noqa: F401


@api_router.post("/upload")
async def upload_file(file: UploadFile = File(...), user=Depends(get_current_user)):
    ext = (file.filename or "photo.jpg").rsplit(".", 1)[-1].lower()
    allowed = ("jpg", "jpeg", "png", "webp", "heic", "pdf", "doc", "docx", "xls", "xlsx", "txt", "csv")
    if ext not in allowed:
        ext = "bin"
    path = f"{_APP_NAME}/uploads/{user['user_id']}/{uuid.uuid4().hex}.{ext}"
    data = await file.read()
    ct = file.content_type or "application/octet-stream"
    try:
        result = await run_in_threadpool(_put_object, path, data, ct)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Upload échoué: {e}")
    await db.uploads.insert_one({
        "user_id": user["user_id"], "path": result["path"],
        "created_at": now_utc().isoformat(),
    })
    return {"path": result["path"]}


@api_router.get("/files/{path:path}")
async def get_file(path: str, token: Optional[str] = None, authorization: Optional[str] = Header(None)):
    tok = token
    if not tok and authorization and authorization.startswith("Bearer "):
        tok = authorization[7:]
    session = await db.user_sessions.find_one({"session_token": tok}) if tok else None
    if not session:
        raise HTTPException(status_code=401, detail="Non autorisé")
    owned = await db.uploads.find_one({"user_id": session["user_id"], "path": path})
    if not owned:
        raise HTTPException(status_code=404, detail="Fichier introuvable")
    try:
        content, ct = await run_in_threadpool(_get_object, path)
    except Exception:
        raise HTTPException(status_code=404, detail="Fichier introuvable")
    return Response(content=content, media_type=ct)


STORE_ASSETS_DIR = Path("/app/store_assets")


@api_router.get("/store-assets/{filename}")
async def get_store_asset(filename: str):
    """Téléchargement direct des visuels stores (captures iPhone/iPad) — fichiers PNG exacts,
    sans recompression, pour App Store Connect / Play Console."""
    if "/" in filename or ".." in filename or not filename.endswith(".png"):
        raise HTTPException(status_code=404, detail="Fichier introuvable")
    for sub in ("ipad", "ios", "android"):
        p = STORE_ASSETS_DIR / sub / filename
        if p.is_file():
            return Response(content=p.read_bytes(), media_type="image/png",
                            headers={"Content-Disposition": f'attachment; filename="{filename}"'})
    raise HTTPException(status_code=404, detail="Fichier introuvable")


@api_router.get("/assets/casaneo-logo.png")
async def get_casaneo_logo():
    """Logo Casanéo public (utilisé dans les emails de relevé)."""
    p = ROOT_DIR / "assets" / "casaneo-logo.png"
    try:
        return Response(content=p.read_bytes(), media_type="image/png")
    except Exception:
        raise HTTPException(status_code=404, detail="Logo introuvable")


@api_router.get("/company-logo/{path:path}")
async def get_company_logo(path: str):
    """Logo de la société de conciergerie (public, chemin non devinable) — utilisé dans les relevés/emails.
    Ne sert le fichier que s'il est enregistré comme logo dans les préférences d'un utilisateur."""
    pref = await db.preferences.find_one({"company.logo_path": path}, {"_id": 0, "user_id": 1})
    if not pref:
        raise HTTPException(status_code=404, detail="Logo introuvable")
    try:
        content, ct = await run_in_threadpool(_get_object, path)
    except Exception:
        raise HTTPException(status_code=404, detail="Logo introuvable")
    return Response(content=content, media_type=ct)


@api_router.get("/kp/{path:path}")
async def get_key_photo(path: str):
    """Accès public (lien non devinable) aux photos de clés envoyées aux voyageurs.
    Ne sert que les fichiers réellement enregistrés comme photos de clés d'un logement."""
    prop = await db.properties.find_one({"key_photos": path}, {"_id": 0, "id": 1})
    if not prop:
        raise HTTPException(status_code=404, detail="Fichier introuvable")
    try:
        content, ct = await run_in_threadpool(_get_object, path)
    except Exception:
        raise HTTPException(status_code=404, detail="Fichier introuvable")
    return Response(content=content, media_type=ct)

