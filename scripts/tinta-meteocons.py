# -*- coding: utf-8 -*-
"""
Mide la caja de tinta de un icono de Meteocons, como haria `svg.getBBox()`.

Para que existe
---------------
`dashboard/src/components/MeteoGlyph.tsx` recorta el lienzo de 128x128 de cada icono a
la caja real de su dibujo, porque los archivos traen mucho relleno vacio y sin recortar
el glifo sale pequeno y descentrado. Esas cajas (su tabla `TINTA`) se midieron a mano
con `getBBox()` en el navegador, y su cabecera remite a un `scratchpad/tinta.py` que
nunca estuvo en el repo. Esto es esa herramienta, para que anadir un icono no obligue a
abrir el navegador.

Como se validó
--------------
Reproduce las cajas que ya estaban medidas a mano:

    icono          en TINTA (getBBox)     calculado aqui
    thermometer    (50, 31, 28, 66)       (50.0, 31.0, 28.0, 66.0)   exacto
    barometer      (24, 24, 80, 80)       (24.0, 24.0, 80.0, 80.0)   exacto
    humidity       (44, 32, 42, 65)       (43.0, 31.0, 42.9, 66.0)   +-1, mas holgada
    windsock       (41.5, 29.5, 47, 67)   (42.0, 30.0, 46.0, 66.0)   la cruda

Las dos diferencias estan entendidas, no son error:

- `humidity` LATE: lleva un `animateTransform type="scale"` que llega a 1.1x, y la caja
  tiene que cubrir el maximo del latido o el icono se recorta en el pico. Aqui se aplica
  ese factor (de ahi que salga un pelo mas holgada que la medida a ojo).
- `windsock` no tiene contorno visible --su unico `stroke="black"` vive dentro de un
  `clipPath`, que no se pinta--, asi que la caja cruda ES su getBBox; el medio pixel de
  su fila en TINTA es aire que se le anadio a mano.

Que hace y que no
-----------------
- Aplana curvas por muestreo (24 puntos), une lo que se RENDERIZA e ignora `defs`,
  `mask` y `clipPath`, igual que getBBox.
- Suma la mitad del grosor del trazo, que getBBox no cuenta y desborda el dibujo.
- Cubre el maximo de las animaciones de escala.
- NO interpreta `transform` de traslacion/rotacion sobre la geometria (los iconos del
  paquete no los usan salvo el par translate/-translate del latido, que se anula), ni
  arcos `A` (ningun icono usado los trae; se aproximan por su punto final).

Uso
---
    python scripts/tinta-meteocons.py                    # valida contra lo ya medido
    python scripts/tinta-meteocons.py wind-beaufort-5    # mide los que se le pasen

Se ejecuta desde la raiz del repo (usa dashboard/node_modules).
"""
import re
import sys
import xml.etree.ElementTree as ET

SVG_DIR = 'dashboard/node_modules/@meteocons/svg/monochrome'
NO_SE_PINTA = {'defs', 'mask', 'clipPath', 'linearGradient', 'radialGradient',
               'filter', 'symbol', 'pattern'}
NUM = re.compile(r'[-+]?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?')
CMD = re.compile(r'([MmLlHhVvCcSsQqTtAaZz])([^MmLlHhVvCcSsQqTtAaZz]*)')
TRANSLATE = re.compile(r'translate\(\s*([-+0-9.eE]+)[ ,]+([-+0-9.eE]+)')
PASOS = 24          # muestras por curva: sobra para redondear a entero


def _tag(el):
    return el.tag.split('}')[-1]


def _nums(s):
    return [float(x) for x in NUM.findall(s)]


def _bezier3(p0, p1, p2, p3):
    for i in range(PASOS + 1):
        t = i / PASOS
        u = 1 - t
        yield (u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
               u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1])


def _bezier2(p0, p1, p2):
    for i in range(PASOS + 1):
        t = i / PASOS
        u = 1 - t
        yield (u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
               u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1])


def puntos_de_path(d):
    """Puntos por los que pasa el trazo, con las curvas ya aplanadas."""
    pts = []
    cur = (0.0, 0.0)
    ini = (0.0, 0.0)
    prev_ctrl = None
    for letra, resto in CMD.findall(d):
        a = _nums(resto)
        rel = letra.islower()
        c = letra.upper()

        def abso(x, y, _cur=None):
            base = _cur if _cur is not None else cur
            return (base[0] + x, base[1] + y) if rel else (x, y)

        if c == 'M':
            for i in range(0, len(a) - 1, 2):
                cur = abso(a[i], a[i + 1])
                if i == 0:
                    ini = cur
                pts.append(cur)
            prev_ctrl = None
        elif c == 'L':
            for i in range(0, len(a) - 1, 2):
                cur = abso(a[i], a[i + 1])
                pts.append(cur)
            prev_ctrl = None
        elif c == 'H':
            for x in a:
                cur = (cur[0] + x, cur[1]) if rel else (x, cur[1])
                pts.append(cur)
            prev_ctrl = None
        elif c == 'V':
            for y in a:
                cur = (cur[0], cur[1] + y) if rel else (cur[0], y)
                pts.append(cur)
            prev_ctrl = None
        elif c == 'C':
            for i in range(0, len(a) - 5, 6):
                p1, p2, p3 = abso(a[i], a[i + 1]), abso(a[i + 2], a[i + 3]), abso(a[i + 4], a[i + 5])
                pts.extend(_bezier3(cur, p1, p2, p3))
                cur, prev_ctrl = p3, p2
        elif c == 'S':
            for i in range(0, len(a) - 3, 4):
                p1 = (2 * cur[0] - prev_ctrl[0], 2 * cur[1] - prev_ctrl[1]) if prev_ctrl else cur
                p2, p3 = abso(a[i], a[i + 1]), abso(a[i + 2], a[i + 3])
                pts.extend(_bezier3(cur, p1, p2, p3))
                cur, prev_ctrl = p3, p2
        elif c == 'Q':
            for i in range(0, len(a) - 3, 4):
                p1, p2 = abso(a[i], a[i + 1]), abso(a[i + 2], a[i + 3])
                pts.extend(_bezier2(cur, p1, p2))
                cur, prev_ctrl = p2, p1
        elif c == 'T':
            for i in range(0, len(a) - 1, 2):
                p1 = (2 * cur[0] - prev_ctrl[0], 2 * cur[1] - prev_ctrl[1]) if prev_ctrl else cur
                p2 = abso(a[i], a[i + 1])
                pts.extend(_bezier2(cur, p1, p2))
                cur, prev_ctrl = p2, p1
        elif c == 'A':
            # Ningun icono del paquete que se use trae arcos; se toma el punto final
            # para no fallar en silencio si aparece alguno.
            for i in range(0, len(a) - 6, 7):
                cur = abso(a[i + 5], a[i + 6])
                pts.append(cur)
            prev_ctrl = None
        elif c == 'Z':
            cur = ini
            pts.append(cur)
            prev_ctrl = None
    return pts


def _escala_maxima(raiz):
    """Factor de escala mas grande que alcanza la animacion, y su centro."""
    f = 1.0
    centro = None
    for g in raiz.iter():
        if _tag(g) in NO_SE_PINTA:
            continue
        for hijo in g:
            if _tag(hijo) != 'animateTransform' or (hijo.get('type') or '') != 'scale':
                continue
            for trozo in (hijo.get('values') or '').split(';'):
                for v in _nums(trozo)[:2]:
                    if v > f:
                        f = v
                        m = TRANSLATE.search(g.get('transform') or '')
                        centro = (float(m.group(1)), float(m.group(2))) if m else None
    return f, centro


def caja(nombre, con_trazo=True):
    """(x, y, w, h) de la tinta. Con `con_trazo` suma la mitad del grosor del contorno."""
    arbol = ET.parse('%s/%s.svg' % (SVG_DIR, nombre))
    xs, ys = [], []

    def anda(el, hereda_sw=0.0, hereda_trazo=False):
        if _tag(el) in NO_SE_PINTA:
            return
        sw_attr = el.get('stroke-width')
        sw = float(sw_attr) if sw_attr else hereda_sw
        # El trazo SE HEREDA: puede declararlo un <g> y no repetirlo cada path, asi que
        # mirando solo el propio elemento se perderia el desborde del contorno.
        propio = el.get('stroke')
        tiene_trazo = hereda_trazo if propio is None else (propio not in ('', 'none'))
        # Grosor por omision 1 cuando hay trazo y nadie lo declara, que es lo que dice SVG.
        if tiene_trazo and not sw:
            sw = 1.0
        margen = (sw / 2.0) if (con_trazo and tiene_trazo and sw) else 0.0

        t = _tag(el)
        pts = []
        if t == 'path' and el.get('d'):
            pts = puntos_de_path(el.get('d'))
        elif t == 'circle':
            cx, cy, r = (float(el.get(k, 0)) for k in ('cx', 'cy', 'r'))
            pts = [(cx - r, cy - r), (cx + r, cy + r)]
        elif t == 'rect':
            x, y = float(el.get('x', 0)), float(el.get('y', 0))
            w, h = float(el.get('width', 0)), float(el.get('height', 0))
            pts = [(x, y), (x + w, y + h)]
        elif t == 'ellipse':
            cx, cy = float(el.get('cx', 0)), float(el.get('cy', 0))
            rx, ry = float(el.get('rx', 0)), float(el.get('ry', 0))
            pts = [(cx - rx, cy - ry), (cx + rx, cy + ry)]
        elif t == 'line':
            pts = [(float(el.get('x1', 0)), float(el.get('y1', 0))),
                   (float(el.get('x2', 0)), float(el.get('y2', 0)))]

        for (x, y) in pts:
            xs.extend([x - margen, x + margen])
            ys.extend([y - margen, y + margen])
        for hijo in el:
            anda(hijo, sw, tiene_trazo)

    anda(arbol.getroot())
    if not xs:
        return None
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)

    # La caja cubre el MAXIMO de la animacion, no el reposo: varios Meteocons laten con
    # `animateTransform type="scale"` hasta 1.1x y recortando al reposo el icono sale
    # cortado en el pico del latido.
    f, centro = _escala_maxima(arbol.getroot())
    if f > 1.0:
        cx, cy = centro if centro else ((x0 + x1) / 2.0, (y0 + y1) / 2.0)
        x0, x1 = cx + (x0 - cx) * f, cx + (x1 - cx) * f
        y0, y1 = cy + (y0 - cy) * f, cy + (y1 - cy) * f
    return (round(x0, 1), round(y0, 1), round(x1 - x0, 1), round(y1 - y0, 1))


# Lo que ya estaba medido a mano en MeteoGlyph.tsx, para validar la herramienta.
YA_MEDIDO = {
    'thermometer': (50, 31, 28, 66),
    'barometer': (24, 24, 80, 80),
    'humidity': (44, 32, 42, 65),
    'windsock': (41.5, 29.5, 47, 67),
}

if __name__ == '__main__':
    objetivos = sys.argv[1:]
    if not objetivos:
        print('Validacion contra las cajas medidas a mano en el navegador:')
        print('  %-14s %-24s %s' % ('icono', 'en TINTA', 'calculado aqui'))
        for n, esperado in YA_MEDIDO.items():
            print('  %-14s %-24s %s' % (n, esperado, caja(n)))
        print('\nPara medir uno nuevo:  python scripts/tinta-meteocons.py <icono>')
    else:
        for n in objetivos:
            print('%-22s %s' % (n, caja(n)))
