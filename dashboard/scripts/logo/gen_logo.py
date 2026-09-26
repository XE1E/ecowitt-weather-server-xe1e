"""Genera el logo vectorial de la estación (redibujo del PNG original de 187x200).

Uso (desde dashboard/):
    pip install fonttools
    curl -LO https://github.com/JulietaUla/Montserrat/raw/master/fonts/ttf/Montserrat-BlackItalic.ttf
    python scripts/logo/gen_logo.py <carpeta_salida> Montserrat-BlackItalic.ttf
Escribe logo-xe1e-dark.svg, -light.svg (letras azules sin contorno) y -light2.svg
(igual al dark; es el que se usa como logo-xe1e-light.svg). Después copiar a
src/assets/ y regenerar los íconos con scripts/logo/render-icons.mjs.
La fuente (OFL) se convierte a trazos: el SVG no depende de ella.
"""
import math
import sys

OUT = sys.argv[1]

# Letras: Montserrat Black Italic (OFL) convertida a trazos, repartidas en arco
# por su ancho real para que el espaciado sea parejo.
FUENTE = sys.argv[2] if len(sys.argv) > 2 else "Montserrat-BlackItalic.ttf"
TEXTO = "XE1E"
ALTO = 58                      # altura de mayúscula en px
ARCO_C, ARCO_R = (188, 272), 208
ESPACIO = 5                    # px extra entre letras


def word_group():
    from fontTools.ttLib import TTFont
    from fontTools.pens.svgPathPen import SVGPathPen
    from fontTools.pens.transformPen import TransformPen
    f = TTFont(FUENTE)
    gs, cmap = f.getGlyphSet(), f.getBestCmap()
    cap = f["OS/2"].sCapHeight
    k = ALTO / cap
    anchos = [gs[cmap[ord(c)]].width * k for c in TEXTO]
    total = sum(anchos) + ESPACIO * (len(TEXTO) - 1)
    parts, x = [], -total / 2
    for c, w in zip(TEXTO, anchos):
        centro = x + w / 2
        ang = centro / ARCO_R                         # radianes desde las 12
        px = ARCO_C[0] + ARCO_R * math.sin(ang)
        py = ARCO_C[1] - ARCO_R * math.cos(ang)
        pen = SVGPathPen(gs)
        # Origen del glifo a (-w/2, +ALTO/2) y eje y hacia abajo.
        gs[cmap[ord(c)]].draw(TransformPen(pen, (k, 0, 0, -k, -w / 2, ALTO / 2)))
        parts.append(f'<path transform="translate({px:.1f} {py:.1f}) rotate({math.degrees(ang):.1f})" d="{pen.getCommands()}"/>')
        x += w + ESPACIO
    return "".join(parts)


def arc(r, a0, a1):
    """Arco del anillo (ángulos en grados desde las 12, sentido horario)."""
    cx, cy = 190, 214
    p = lambda a: (cx + r * math.sin(math.radians(a)), cy - r * math.cos(math.radians(a)))
    x0, y0 = p(a0)
    x1, y1 = p(a1)
    large = 1 if (a1 - a0) % 360 > 180 else 0
    return f"M{x0:.1f} {y0:.1f} A{r} {r} 0 {large} 1 {x1:.1f} {y1:.1f}"


def svg(tema):
    oscuro = tema in ("dark", "light2")
    claro = tema != "dark"
    # Anillos: se abren arriba para dejar pasar el texto.
    anillos = f'''
  <g fill="none" stroke-linecap="round">
    <path d="{arc(158, 44, 316)}" stroke="url(#azulAro)" stroke-width="6"/>
    <path d="{arc(147, 47, 313)}" stroke="url(#naranja)" stroke-width="6"/>
    <path d="{arc(140, 50, 310)}" stroke="#ffffff" stroke-width="2.5"/>
  </g>'''
    texto_contorno = (
        '<use href="#palabra" fill="#0b1220" stroke="#0b1220" stroke-width="10" transform="translate(2.5 3)"/>'
        '<use href="#palabra" fill="#ffffff" stroke="#ffffff" stroke-width="7"/>'
    ) if oscuro else '<use href="#palabra" fill="#0b2a6b" stroke="#0b2a6b" stroke-width="3" opacity=".3" transform="translate(1.5 2.5)"/>'

    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 374 400" width="374" height="400" role="img" aria-label="XE1E">
  <title>XE1E</title>
  <defs>
    <linearGradient id="azulTexto" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#2a7bff"/><stop offset="1" stop-color="#0a3fd6"/>
    </linearGradient>
    <linearGradient id="azulAro" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#00c8ff"/><stop offset="1" stop-color="#0057ff"/>
    </linearGradient>
    <linearGradient id="naranja" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ffa51f"/><stop offset="1" stop-color="#ff5500"/>
    </linearGradient>
    <radialGradient id="sol" cx=".4" cy=".35" r=".7">
      <stop offset="0" stop-color="#fff176"/><stop offset=".55" stop-color="#ffc400"/><stop offset="1" stop-color="#ff7a00"/>
    </radialGradient>
    <linearGradient id="gota" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#1fd2ff"/><stop offset="1" stop-color="#0a5cff"/>
    </linearGradient>
    <linearGradient id="termo" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#d6f6ff"/><stop offset="1" stop-color="#4fd4ff"/>
    </linearGradient>
    <linearGradient id="mercurio" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffa51f"/><stop offset="1" stop-color="#ff5500"/>
    </linearGradient>
    <radialGradient id="mercurioBulbo" cx=".38" cy=".35" r=".75">
      <stop offset="0" stop-color="#ffc04d"/><stop offset="1" stop-color="#ff5500"/>
    </radialGradient>
    <g id="palabra" stroke-linejoin="round">{word_group()}</g>
    <g id="nube">
      <circle cx="190" cy="181" r="40"/><circle cx="136" cy="199" r="27"/><circle cx="226" cy="205" r="22"/>
      <rect x="106" y="196" width="124" height="31" rx="15.5"/>
    </g>
  </defs>
{anillos}

  <!-- XE1E -->
  {texto_contorno}
  <use href="#palabra" fill="url(#azulTexto)" stroke="url(#azulTexto)" stroke-width="2.5"/>

  <!-- Sol -->
  <g stroke="#ffab00" stroke-width="5" stroke-linecap="round">
    <line x1="132" y1="120" x2="132" y2="130"/><line x1="105" y1="131" x2="111" y2="138"/>
    <line x1="159" y1="131" x2="153" y2="138"/><line x1="93" y1="158" x2="102" y2="158"/>
  </g>
  <circle cx="132" cy="162" r="25" fill="url(#sol)"/>

  <!-- Nube: contorno azul oscuro, borde celeste y relleno blanco -->
  <use href="#nube" fill="#0a47e0" stroke="#0a47e0" stroke-width="16" stroke-linejoin="round"/>
  <use href="#nube" fill="#1ec8ff" stroke="#1ec8ff" stroke-width="9" stroke-linejoin="round"/>
  <use href="#nube" fill="#ffffff"/>
  <path d="M188 150 A32 32 0 0 1 218 170" fill="none" stroke="#6fdcff" stroke-width="5" stroke-linecap="round"/>

  <!-- Lluvia: dos niveles intercalados -->
  <g stroke="url(#gota)" stroke-width="6" stroke-linecap="round">
    <line x1="116" y1="245" x2="109" y2="263"/><line x1="139" y1="245" x2="132" y2="263"/><line x1="162" y1="245" x2="155" y2="263"/><line x1="185" y1="245" x2="178" y2="263"/><line x1="208" y1="245" x2="201" y2="263"/>
    <line x1="118.6" y1="268" x2="111.6" y2="286"/><line x1="141.6" y1="268" x2="134.6" y2="286"/><line x1="164.6" y1="268" x2="157.6" y2="286"/><line x1="187.6" y1="268" x2="180.6" y2="286"/>
  </g>

  <!-- Termómetro -->
  <g stroke="#0a5cff" stroke-width="5">
    <path d="M265 237 V166 a11 11 0 0 1 22 0 V237 a20 20 0 1 1 -22 0 Z" fill="url(#termo)" stroke-linejoin="round"/>
  </g>
  <rect x="272.5" y="179" width="7" height="72" rx="3.5" fill="url(#mercurio)"/>
  <circle cx="276" cy="253" r="12" fill="url(#mercurioBulbo)"/>
  <g stroke="#0a5cff" stroke-width="2.5" stroke-linecap="round">
    <line x1="268" y1="176" x2="272" y2="176"/><line x1="268" y1="188" x2="272" y2="188"/>
    <line x1="268" y1="200" x2="272" y2="200"/><line x1="268" y1="212" x2="272" y2="212"/>
  </g>

  <!-- Viento -->
  <g fill="none" stroke="url(#azulAro)" stroke-width="4.5" stroke-linecap="round" transform="translate(-18 2) translate(205 315) scale(.85) translate(-205 -315)">
    <path d="M168 314 H250 a13 13 0 1 0 -13 -13"/>
    <path d="M196 301 H222 a9 9 0 1 0 -9 -9"/>
    <path d="M148 330 H222 a10 10 0 1 1 -10 10"/>
  </g>
</svg>
'''


for t in ("dark", "light", "light2"):
    with open(f"{OUT}/logo-xe1e-{t}.svg", "w", encoding="utf-8") as f:
        f.write(svg(t))
