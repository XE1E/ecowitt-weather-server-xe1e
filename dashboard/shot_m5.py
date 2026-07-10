import asyncio
from playwright.async_api import async_playwright
OUT = r"C:\Users\xe1ee\AppData\Local\Temp\claude\C--Documents-GitHub-ecowitt-weather-server-xe1e\4fdfb48a-ef91-4a95-b676-dc9b7589f14f\scratchpad"
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await b.new_page(viewport={"width":1280,"height":1400})
        await pg.goto("http://127.0.0.1:8080/pro/historia", wait_until="domcontentloaded")
        await pg.wait_for_timeout(600)
        await pg.select_option("select", "6")
        await pg.get_by_role("button", name="Ver", exact=True).click()
        await pg.wait_for_timeout(2500)
        # recorte de la zona de gráficas
        el = await pg.query_selector("text=Temperatura")
        box = await el.bounding_box()
        await pg.screenshot(path=OUT + r"\month5.png", clip={"x":0,"y":box["y"]-10,"width":1280,"height":900})
        print("done")
        await b.close()
asyncio.run(main())
