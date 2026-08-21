# Assets

## `moon.png`

Foto real de la luna llena, usada como textura en `MoonGlyph` (`ConsoleReplica.tsx`)
en vez de las manchas dibujadas a mano que había antes. Se recorta con el mismo path
del terminador (`litPath`) que ya calcula la fase, así que sirve para cualquier fase,
no sólo la luna llena: como desde la Tierra siempre se ve la misma cara, una sola foto
de disco completo basta.

Original: *FullMoon2010.jpg*, Gregory H. Revera, [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:FullMoon2010.jpg),
licencia **CC BY-SA 3.0** (atribución + compartir igual). Reprocesada para este
proyecto: recortada al disco, pasada a escala de grises, reducida a 512×512 y con un
pequeño realce de contraste/nitidez para que las crestas se lean a tamaño de icono
(~40-80 px). El color (tonos cálidos de sombra/luz) no viene de la foto: lo sigue
poniendo el degradado de `MoonGlyph` por debajo, con la foto en `mix-blend-mode:
multiply` encima sólo para el relieve.
