# ruff: noqa: F403, F405
from core import *  # noqa: F401


@api_router.post("/automations/run")
async def automations_run(user=Depends(get_current_user)):
    sent = await run_automations_for_user(user["user_id"])
    return {"sent": sent}

