# Monté mi propia estación meteorológica (y publica el clima de mi colonia en tiempo real)

*Borrador para el blog. Ajusta el tono, los datos personales y añade fotos donde
veas los marcadores `[foto: …]`.*

---

Los pronósticos del clima que vemos en el teléfono son para "la ciudad". Pero la
Ciudad de México no tiene *un* clima: llueve en Coyoacán y en mi calle sigue el
sol, o el viento de la tarde en mi azotea no se parece en nada al del
aeropuerto. Quería saber **qué está pasando exactamente en mi punto**, con datos
reales y no una estimación regional. Así que monté mi propia estación
meteorológica y la puse en línea, abierta para quien quiera consultarla:

👉 **[clima.xe1e.net](https://clima.xe1e.net)**

[foto: la consola / el sensor en la azotea]

## El hardware

La estación es un kit **Ecowitt WS2910** con un sensor exterior **WS69** (el
clásico "7-en-1") y varios termohigrómetros **WN31** repartidos por canales. Entre
todos miden lo esperable de una estación decente:

- Temperatura y humedad (exterior, interior y por canales)
- Viento: velocidad, dirección y ráfagas
- Lluvia: intensidad y acumulados (hora, día, mes, año)
- Presión barométrica
- Radiación solar e índice UV

La gracia del WS2910 es que **puede enviar sus lecturas a un servidor propio**
(no solo a la nube del fabricante). Eso abrió la puerta a todo lo demás.

## El servidor: los datos son míos

En lugar de depender de una app cerrada, la estación envía cada lectura —cada
minuto, más o menos— a un pequeño servidor que corre en un VPS. Ahí un servicio
en Python la recibe, la procesa y la guarda en una base de datos de series
temporales (InfluxDB). Encima, un sitio web hecho en React muestra todo en vivo.

Todo el proyecto es **software libre y está en GitHub**, en un stack propio
(FastAPI + InfluxDB + React) desplegado con Docker y HTTPS. *Mis datos, mi base
de datos, mi sitio.*

[foto: captura del tablero /pro]

## Lo que más me interesaba: exprimir el dato local

Aquí está la parte divertida. Tener el dato crudo permite hacerle cosas que una
app no te deja:

- **Control de calidad**: descarto automáticamente lecturas imposibles (un pico
  de temperatura por interferencia, por ejemplo) para que no ensucien las
  gráficas ni disparen falsas alarmas.
- **Calibración**: si un sensor lee medio grado de más, lo corrijo por software.
- **Variables derivadas**: además de lo que mide el sensor, calculo punto de
  rocío, sensación térmica, humidex y hasta una estimación de la **base de las
  nubes**.
- **Pronóstico local propio**: con la **tendencia del barómetro** (cómo cambia la
  presión en las últimas horas) genero un pronóstico corto a la vieja usanza,
  independiente de cualquier modelo externo.
- **Climatología**: cada día se guarda un resumen, y con eso construyo récords
  históricos, un reporte mensual/anual al estilo de los boletines de la NOAA
  (con grados-día y evapotranspiración incluidos) y hasta un *"en este día"* para
  comparar con años anteriores.

El sitio también trae pronóstico (Open-Meteo), radar interactivo (Ventusky),
astronomía con un almanaque completo (crepúsculos, luna y planetas), calidad del
aire y el METAR del aeropuerto. Y, claro, **alertas**: si sube mucho la
temperatura, si hay ráfagas fuertes, si se queda sin batería un sensor o si la
estación deja de reportar, me llega un aviso por Telegram.

## Aportar a la comunidad meteorológica

Los datos no se quedan solo en mi sitio. La estación también los **publica a
redes públicas** —Weather Underground, Windy, PWSWeather, OpenWeatherMap y
CWOP/APRS—, igual que hago con mi receptor ADSB alimentando redes de vuelos. En
una zona con pocas estaciones personales, cada aporte suma: mejora los mapas,
alimenta modelos e incluso llega a los sistemas de la NOAA. Y de paso, algunas
redes te dan acceso ampliado a sus datos a cambio.

## ¿Para qué sirve, en concreto?

- Saber si **me va a agarrar la lluvia** antes de salir, mirando la tendencia y
  el radar de mi zona.
- Ver **cuánto llovió de verdad** en mi calle este mes.
- Tener el **histórico** para responder "¿fue el junio más caluroso?" con datos,
  no con sensación.
- Integrarlo con **Home Assistant** para automatizaciones.

## Lo que sigue

El proyecto está vivo. En la lista: instalar el hardware definitivo en su
ubicación final, afinar la calibración con los primeros meses de datos reales, y
seguir sumando pequeños detalles. Si te interesa el código o montar algo
parecido, todo está publicado en GitHub.

Mientras tanto, si tienes curiosidad por el clima de mi rincón de la CDMX, pásate
por **[clima.xe1e.net](https://clima.xe1e.net)**. 🌦️

*— XE1E*
