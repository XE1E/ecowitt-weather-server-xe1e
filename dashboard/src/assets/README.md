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

El albedo real de la Luna es bajo (~12%), así que la foto sin retocar multiplicaba
el degradado a un resultado más oscuro de lo que se quería ver en la consola. Antes
de reducir a 512 se le sube el piso de las sombras (los negros pasan a ~18/255 en vez
de 0) y un empujón de brillo/contraste, para que ni el mar más oscuro llegue a
multiplicar casi a cero.
