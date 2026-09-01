"""Génère les captures iPad 13" (2048x2732) pour App Store Connect."""
import asyncio
from playwright.async_api import async_playwright

BASE = "https://rental-hub-manager.preview.emergentagent.com"
OUT = "/app/store_assets/ipad"


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page(viewport={"width": 1024, "height": 1366}, device_scale_factor=2)
        await page.goto(BASE, timeout=60000)
        await page.wait_for_selector("#root", timeout=60000)
        await page.wait_for_timeout(6000)
        # Login demo
        await page.get_by_test_id("show-email-login").click(timeout=10000)
        await page.get_by_test_id("login-email").fill("demo.stores@casaneo.app")
        await page.get_by_test_id("login-password").fill("CasaneoDemo2026!")
        await page.get_by_test_id("email-signin-button").click()
        await page.wait_for_timeout(7000)
        await page.screenshot(path=f"{OUT}/ipad_01_accueil.png")
        print("01 accueil OK")
        await page.goto(f"{BASE}/calendar", timeout=60000)
        await page.wait_for_timeout(7000)
        await page.screenshot(path=f"{OUT}/ipad_02_calendrier.png")
        print("02 calendrier OK")
        await page.goto(f"{BASE}/planning", timeout=60000)
        await page.wait_for_timeout(7000)
        await page.screenshot(path=f"{OUT}/ipad_03_reservations.png")
        print("03 reservations OK")
        await browser.close()

asyncio.run(main())
