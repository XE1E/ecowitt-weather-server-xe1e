// Genera los íconos PNG/ICO y la vista previa al compartir a partir del logo SVG.
// Uso (desde dashboard/):  node scripts/logo/render-icons.mjs
// Cada imagen se pinta a 4x en Chromium y se reduce con Lanczos (Pillow) para
// bordes nítidos incluso a 16 px. Requiere `playwright` (ya en devDependencies)
// y Python con Pillow en el PATH.
import { chromium } from 'playwright'
import { execFileSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'

const FONDO = '#0b1120'                      // mismo que theme_color del manifest
const LOGO = fs.readFileSync('src/assets/logo-xe1e-dark.svg').toString('base64')
const ESCALA = 4
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'logo-'))

// nombre, ancho, alto, alto del logo (fracción del alto), radio de esquinas (fracción)
const SALIDAS = [
  ['icon-512.png', 512, 512, 0.9, 0],
  ['icon-192.png', 192, 192, 0.9, 0],
  // maskable: Android recorta a círculo/squircle; el logo va dentro de la zona segura (80 %)
  ['icon-maskable-512.png', 512, 512, 0.66, 0],
  ['apple-touch-icon.png', 180, 180, 0.88, 0],
  ['favicon.png', 256, 256, 0.9, 0.22],
  ['og-image.png', 1200, 630, 0.74, 0],
  ['ico-64.png', 64, 64, 0.94, 0.22],
  ['ico-48.png', 48, 48, 0.94, 0.22],
  ['ico-32.png', 32, 32, 0.96, 0.22],
  ['ico-16.png', 16, 16, 0.98, 0.22],
]

const browser = await chromium.launch()
const page = await browser.newPage({ deviceScaleFactor: 1 })
for (const [nombre, w, h, frac, radio] of SALIDAS) {
  const W = w * ESCALA, H = h * ESCALA
  await page.setViewportSize({ width: W, height: H })
  await page.setContent(`<body style="margin:0;background:transparent">
    <div style="width:${W}px;height:${H}px;background:${FONDO};border-radius:${radio * W}px;
      display:flex;align-items:center;justify-content:center">
      <img src="data:image/svg+xml;base64,${LOGO}" style="height:${frac * H}px;width:auto">
    </div></body>`)
  await page.screenshot({ path: path.join(tmp, nombre), omitBackground: true })
}
await browser.close()

const py = `
import sys, os
from PIL import Image
tmp, pub = sys.argv[1], sys.argv[2]
def red(n, w, h):
    return Image.open(os.path.join(tmp, n)).convert('RGBA').resize((w, h), Image.LANCZOS)
for n, w, h in ${JSON.stringify(SALIDAS.filter((s) => !s[0].startsWith('ico-')).map((s) => [s[0], s[1], s[2]]))}:
    im = red(n, w, h)
    if n != 'favicon.png':            # sólo el favicon lleva esquinas transparentes
        im = im.convert('RGB')
    im.save(os.path.join(pub, n), optimize=True)
icos = [red(f'ico-{s}.png', s, s) for s in (64, 48, 32, 16)]
icos[0].save(os.path.join(pub, 'favicon.ico'), sizes=[(s, s) for s in (64, 48, 32, 16)], append_images=icos[1:])
`
execFileSync(process.platform === 'win32' ? 'python' : 'python3', ['-c', py, tmp, 'public'], { stdio: 'inherit' })
fs.rmSync(tmp, { recursive: true, force: true })
console.log('Íconos generados en public/')
