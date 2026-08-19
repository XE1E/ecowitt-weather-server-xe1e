import { useState, useEffect } from 'react'
import { WeatherData, DailyStats } from '../../types'
import { ForecastResult } from '../../forecast'
import { Comparison } from '../../station-data'
import { useUnits } from '../../units'
import { LOCATION } from '../../config'
import { cardinal } from '../../weather'
import { MeteoGlyph } from '../MeteoGlyph'
import { glifoPresion, glifoRumbo, glifoTermometro, glifoViento } from '../../theme/icons'

interface Props {
  data: WeatherData
  stats: DailyStats['stats'] | null
  forecast: ForecastResult | null
  compare: Comparison | null
}

interface ImecaData {
  available: boolean
  imeca?: number; dominant?: string; category?: string; color?: string
}

/**
 * Una casilla del resumen. Lleva glifo desde el 2026-08-18: la tira era la única parte
 * del sitio hecha de texto pelado, y es donde las familias graduadas de Meteocons
 * (Beaufort, barómetro, brújula) informan de verdad en vez de duplicar algo —el resto de
 * las tarjetas ya tienen su instrumento propio: la brújula que gira, la escala Beaufort
 * en segmentos de color, el chevrón de tendencia—.
 *
 * El glifo se pinta con `color="currentColor"` a propósito: así hereda el color que ya
 * tiene la casilla —sea clase de Tailwind o hex del IMECA— y no hay que duplicar la
 * paleta en dos formatos.
 */
function Tile({ label, value, sub, color = 'text-slate-100', hex, glyph, glyphH = 26, outline }: {
  label: string; value: string; sub?: string; color?: string; hex?: string
  glyph?: string; glyphH?: number; outline?: boolean
}) {
  const tinte = hex ? '' : color
  const estilo = hex ? { color: hex } : undefined
  return (
    // Apilado y CENTRADO. Antes iba el glifo a la izquierda y el texto a su derecha, y
    // dentro de la casilla los rótulos quedaban descolgados hacia el lado derecho. De
    // paso la casilla se estrecha: el ancho lo fija la rejilla de fuera, igual para
    // todas, así que da lo mismo cuántas casillas opcionales aparezcan.
    <div className="rounded-xl border border-white/10 bg-white/5 px-2 py-2 flex flex-col items-center text-center gap-0.5">
      {glyph && (
        <span className={tinte} style={estilo}>
          <MeteoGlyph name={glyph} size={glyphH} color="currentColor" title={label} outline={outline} />
        </span>
      )}
      {/* El RÓTULO sí puede partirse en dos líneas --"PRECIPITACIÓN" no cabe de una en
          una casilla de ~110 px-- pero el valor no: partir "18 km/h" se lee como un
          fallo, y un rótulo en dos líneas centradas, no. */}
      <p className="text-[10px] uppercase tracking-wide text-slate-400 leading-tight">{label}</p>
      <p className={`text-base font-bold whitespace-nowrap ${tinte}`} style={estilo}>{value}</p>
      {sub && <p className="text-[10px] text-slate-400 whitespace-nowrap">{sub}</p>}
    </div>
  )
}

export function MiniStats({ data, stats, forecast, compare }: Props) {
  const u = useUnits()
  const t = stats?.temperature_outdoor
  const g = stats?.wind_gust
  const today = forecast?.days?.[0]
  const uv = data.uv_index ?? 0

  const [imeca, setImeca] = useState<ImecaData | null>(null)
  useEffect(() => {
    fetch(`/api/airquality/imeca?lat=${LOCATION.latitude}&lon=${LOCATION.longitude}`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setImeca)
      .catch(() => {})
  }, [])

  // Delta de temperatura vs 24h previas (conversión de diferencia: °F = °C*9/5)
  const dRaw = compare?.temperature_outdoor?.delta
  const dDisp = dRaw != null ? (u.system === 'imperial' ? dRaw * 9 / 5 : dRaw) : null

  // Cuánto se separa la sensación de la temperatura real: es lo que decide si el
  // termómetro va en su versión de calor o de frío. Con humedad alta el humidex sube y
  // con viento la sensación baja, así que el signo dice algo, no es decorativo.
  const sensacionDelta = (data.feels_like != null && data.temperature_outdoor != null)
    ? data.feels_like - data.temperature_outdoor
    : null

  return (
    // Rejilla en vez de tira con scroll. Con `overflow-x-auto` las doce casillas sumaban
    // ~1580 px y en una pantalla de 1440 salía una barra de desplazamiento horizontal,
    // que en una fila de resumen se lee como que algo no cabe. Con `auto-fit` +
    // `minmax(0,1fr)` todas miden LO MISMO, se reparten el ancho disponible y bajan de
    // fila cuando no caben, así que nunca hay slider y da igual cuántas casillas
    // opcionales --IMECA, rumbo, "vs 24 h"-- se estén mostrando.
    <div className="grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(104px,1fr))]">
      <Tile
        label="Hoy"
        value={t?.max != null ? `${u.temp(t.max)}${u.tempU}` : '--'}
        sub={t?.min != null ? `mín ${u.temp(t.min)}${u.tempU}` : undefined}
        color="text-orange-300"
        glyph="thermometer"
      />
      <Tile label="Humedad" value={data.humidity_outdoor != null ? `${data.humidity_outdoor.toFixed(0)}%` : '--'} color="text-cyan-300" glyph="humidity" />
      <Tile
        label="Presión"
        value={u.press(data.pressure_relative, 0)}
        sub={u.pressU}
        color="text-violet-300"
        // El nivel se decide con los hPa MÉTRICOS, no con el número que se muestra: en
        // imperial son pulgadas de mercurio y los cortes no cuadrarían.
        glyph={glifoPresion(data.pressure_relative)}
      />
      <Tile
        label="Viento máx"
        value={g?.max != null ? `${u.wind(g.max, 0)} ${u.windU}` : '--'}
        color="text-emerald-300"
        // Igual que la presión: el grado sale de los km/h métricos.
        glyph={glifoViento(g?.max)}
        // El Beaufort es el único ANCHO de todos (89x58 de tinta): a 26 px de alto
        // ocuparía 40 de ancho y desequilibraría la fila, así que va a 24 --37 de
        // ancho--, que sigue dejando legible la cifra del grado.
        glyphH={24}
      />
      {data.wind_direction != null && (
        // Casilla nueva: el rumbo no estaba en la tira, aunque el dato llega desde el
        // primer día. `cardinal` y `glifoRumbo` usan los mismos sectores de 45°, así que
        // la aguja y las letras no pueden discrepar.
        <Tile
          label="Rumbo"
          value={cardinal(data.wind_direction)}
          sub={`${data.wind_direction.toFixed(0)}°`}
          color="text-emerald-200"
          glyph={glifoRumbo(data.wind_direction)}
        />
      )}
      <Tile label="Precipitación" value={`${u.rain(data.rain_daily)} ${u.rainU}`} sub="hoy" color="text-blue-300" glyph="raindrops" />
      <Tile
        label="Prob. lluvia"
        value={today ? `${today.precipProb}%` : '--'}
        sub="hoy"
        color="text-sky-300"
        glyph="raindrops"
        // Gotas HUECAS para la probabilidad y macizas para el acumulado de al lado: el
        // mismo dibujo distingue "puede llover" de "ha llovido" sin gastar otro icono.
        outline
      />
      <Tile
        label="Sensación"
        value={`${u.temp(data.feels_like)}${u.tempU}`}
        glyph={glifoTermometro(sensacionDelta)}
        color={sensacionDelta != null && sensacionDelta > 0.5 ? 'text-red-300'
          : sensacionDelta != null && sensacionDelta < -0.5 ? 'text-sky-300' : 'text-slate-100'}
      />
      <Tile label="Rocío" value={`${u.temp(data.dew_point)}${u.tempU}`} color="text-cyan-200" glyph="thermometer-raindrop" />
      <Tile
        label="Índice UV"
        value={`${uv}`}
        color={uv >= 8 ? 'text-red-300' : uv >= 6 ? 'text-orange-300' : 'text-yellow-300'}
        glyph="uv-index"
      />
      {imeca?.available && imeca.imeca != null && (
        <Tile
          label="IMECA"
          value={`${imeca.imeca}`}
          sub={imeca.category}
          hex={imeca.color}
          glyph="dust"
        />
      )}
      {dDisp != null && (
        // "vs 24 h antes", no "vs ayer": /api/compare promedia las últimas 24 h
        // contra las 24 h previas (ventana rodante), no el día de ayer completo.
        <Tile
          label="vs 24 h"
          value={`${dDisp > 0 ? '+' : ''}${dDisp.toFixed(1)}°`}
          sub={dDisp > 0.1 ? 'más cálido' : dDisp < -0.1 ? 'más frío' : 'similar'}
          color={dDisp > 0.1 ? 'text-red-300' : dDisp < -0.1 ? 'text-sky-300' : 'text-slate-300'}
          glyph={glifoTermometro(dDisp)}
        />
      )}
    </div>
  )
}
