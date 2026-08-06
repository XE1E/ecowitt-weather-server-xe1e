# Fuentes de la réplica de consola

Las dos son de la familia **DSEG** de keshikan (<http://www.keshikan.net>), versión
v0.46, y las usa sólo `ConsoleReplica` (la página `?page=consola` del kiosco y el tab
"Consola" del dashboard). Licencia **SIL Open Font License 1.1**, texto completo en
`DSEG-LICENSE.txt`.

| Archivo | Para qué |
|---|---|
| `DSEG7Classic-Bold.woff2` | Los NÚMEROS. Siete segmentos, como una consola física. |
| `DSEG14Classic-Bold.woff2` | El RUMBO del viento (`NNE`, `OSO`…). Catorce segmentos. |

## Por qué hacen falta las dos

DSEG7 forma las letras con los mismos siete segmentos que las cifras, y con siete no
se pueden dibujar todas: medido sobre el propio archivo a cuerpo 60, sus dígitos y su
`E` dan 60 px de tinta, pero la `O` y la `N` sólo 34 --poco más de la mitad-- y la `S`
sale como una `b`, sin la barra de arriba. `OSO` se leía "oSo" y `SSE` parecía
recortado por arriba.

Con catorce segmentos (que añaden diagonales) las cuatro letras de los rumbos salen a
altura completa: `N` 58 px, `E`/`S`/`O` 60. De ahí la segunda fuente, en vez de
sustituir letras por cifras parecidas --`O`→`0`, `S`→`5`--, que fue el apaño anterior y
mostraba `0S0` donde debía decir `OSO`.

## Están SIN MODIFICAR, y así deben quedarse

Son los `.woff2` oficiales del release, tal cual. **No subconjuntar**: la licencia
reserva el nombre "DSEG" (*Reserved Font Name*), y la OFL 1.1 prohíbe que una versión
modificada lo conserve, así que un subconjunto obligaría a renombrar la fuente. Un
subconjunto con sólo `N E S O -` bajaba de 5920 a 752 bytes, pero por 5 KB no vale la
pena entrar en eso.

Al actualizar la versión, traer los `.woff2` del release y el `DSEG-LICENSE.txt` que
los acompaña, sin pasarlos por ninguna herramienta.
