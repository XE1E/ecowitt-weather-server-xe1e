import { useState } from 'react'
import { RefreshCw, Tornado } from 'lucide-react'
import { PageInfo } from '../components/station/PageInfo'
import { CyclonesMap } from '../components/station/CyclonesMap'
import { CycloneSat } from '../components/station/CycloneSat'
import { useSharedFetch } from '../hooks/useSharedFetch'
import { useUnits } from '../units'
import {
  Ciclon, Nivel, Temporada, useCiclones, colorCiclon, etiquetaCiclon, categoriaDeKt, fraseAmenaza,
  fmtHora, enTemporada, NIVEL_TXT, SMN_AVISO,
} from '../components/station/cyclones'

const NIVEL_CLS: Record<Nivel, string> = {
  alta: 'bg-red-500/15 border-red-500/50 text-red-200',
  media: 'bg-amber-500/15 border-amber-500/50 text-amber-200',
  baja: 'bg-white/5 border-white/10 text-slate-300',
}

// Imagen del NHC servida por nuestro proxy. Si no existe (p. ej. no todas las
// tormentas tienen "Key Messages") se oculta sin dejar hueco.
// `v`: hora de los datos. Cambia en cada renovación (10 min), así el navegador
// vuelve a pedir la imagen y el cono/mensajes nuevos no se quedan atrás.
function NhcImg({ src: base, v, alt, caption }: { src: string | null; v?: string; alt: string; caption?: string }) {
  // Se recuerda QUÉ src falló: con la siguiente versión se vuelve a intentar (los
  // Key Messages pueden aparecer a media tormenta).
  const [fallo, setFallo] = useState<string | null>(null)
  const src = base && v ? `${base}?v=${encodeURIComponent(v)}` : base
  if (!src || fallo === src) return null
  return (
    <figure>
      <a href={src} target="_blank" rel="noopener noreferrer" title="Abrir en grande">
        <img src={src} alt={alt} loading="lazy" onError={() => setFallo(src)}
          className="w-full rounded-lg border border-white/10 bg-white" />
      </a>
      {caption && <figcaption className="text-[11px] text-slate-500 mt-1">{caption}</figcaption>}
    </figure>
  )
}

function Dato({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg bg-white/5 px-3 py-2">
      <p className="text-[11px] text-slate-400">{label}</p>
      <p className="text-base font-bold text-slate-100 leading-tight">{value}</p>
      {sub && <p className="text-[11px] text-slate-500 leading-tight">{sub}</p>}
    </div>
  )
}

const GRADO_CLS = {
  aviso: 'border-red-500/50 bg-red-500/10 text-red-200',
  vigilancia: 'border-amber-500/50 bg-amber-500/10 text-amber-200',
}

/** Vigilancias y avisos costeros vigentes (traducidos del aviso público del NHC). */
function AvisosCosta({ c }: { c: Ciclon }) {
  const { vigentes, notas } = c.avisos
  const cerca = c.nivel !== 'baja'
  // De tormentas lejanas sólo interesa si tocan México (casi nunca): se omite el resto.
  const vs = cerca ? vigentes : vigentes.filter((v) => v.zonas.some((z) => z.mexico))
  const ns = cerca ? notas : []
  if (!vs.length && !ns.length) return null
  return (
    <div className="space-y-2">
      <p className="text-sm font-semibold text-slate-200">Vigilancias y avisos en la costa</p>
      {vs.map((v, i) => (
        <div key={i} className={`rounded-lg border px-3 py-2 text-sm ${GRADO_CLS[v.grado]}`}>
          <p className="font-semibold">{v.tipo}</p>
          <ul className="mt-0.5 space-y-0.5">
            {v.zonas.map((z, j) => (
              <li key={j} className={z.mexico ? '' : 'opacity-70'}>• {z.zona}{z.mexico ? '' : ' (fuera de México)'}</li>
            ))}
          </ul>
        </div>
      ))}
      {ns.map((n, i) => <p key={i} className="text-sm text-slate-300">ℹ️ {n.texto}</p>)}
      <p className="text-[11px] text-slate-500">
        <strong>Aviso</strong>: se esperan esas condiciones (en México, zona de prevención). <strong>Vigilancia</strong>: son
        posibles (zona de vigilancia). Traducido del aviso del NHC; el oficial para México es el del SMN.
      </p>
    </div>
  )
}

function Barra({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-16 sm:w-24 rounded-full bg-white/10 overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${Math.max(pct, pct > 0 ? 3 : 0)}%`, backgroundColor: color }} />
      </div>
      <span className="tabular-nums w-9 text-right">{pct > 0 ? `${pct}%` : '<1%'}</span>
    </div>
  )
}

/** Probabilidad de vientos fuertes por localidad mexicana (tabla PWS del NHC). */
function Probabilidades({ c }: { c: Ciclon }) {
  const u = useUnits()
  const [todas, setTodas] = useState(false)
  const mx = c.probabilidades.filter((p) => p.mexico && p.p34 > 0)
  if (!mx.length) return null
  const lista = todas ? mx : mx.slice(0, 8)
  const kmh = (kt: number) => `${u.wind(kt * 1.852, 0)} ${u.windU}`
  return (
    <div>
      <p className="text-sm font-semibold text-slate-200">Probabilidad de vientos fuertes en los próximos 5 días</p>
      <div className="overflow-x-auto mt-1">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] text-slate-400">
              <th className="py-1 pr-3 font-medium">Lugar</th>
              <th className="py-1 pr-3 font-medium">Tormenta tropical (≥ {kmh(34)})</th>
              <th className="py-1 pr-3 font-medium">≥ {kmh(50)}</th>
              <th className="py-1 font-medium">Huracán (≥ {kmh(64)})</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5 text-slate-300">
            {lista.map((p) => (
              <tr key={p.lugar}>
                <td className="py-1 pr-3 whitespace-nowrap">{p.lugar}</td>
                <td className="py-1 pr-3"><Barra pct={p.p34} color="#34d399" /></td>
                <td className="py-1 pr-3"><Barra pct={p.p50} color="#fb923c" /></td>
                <td className="py-1"><Barra pct={p.p64} color="#e11d48" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {mx.length > 8 && (
        <button onClick={() => setTodas((t) => !t)} className="text-xs text-sky-400 hover:text-sky-300 mt-1">
          {todas ? 'Ver menos' : `Ver las ${mx.length} localidades`}
        </button>
      )}
      <p className="text-[11px] text-slate-500 mt-1">Probabilidad de que el viento sostenido llegue a ese nivel en algún momento de los próximos 5 días (NHC).</p>
    </div>
  )
}

function TormentaCard({ c, v }: { c: Ciclon; v?: string }) {
  const u = useUnits()
  const color = colorCiclon(c)
  const [verPron, setVerPron] = useState(false)
  return (
    <div className="card space-y-4" id={c.id}>
      <div className="flex items-start gap-3 flex-wrap">
        <span className="w-12 h-12 rounded-xl flex items-center justify-center text-lg font-extrabold shrink-0"
          style={{ backgroundColor: color + '26', color }}>
          {c.categoria ?? c.clase}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xl font-bold text-slate-100 leading-tight">{c.tipo} {c.nombre}</p>
          <p className="text-sm text-slate-400">
            {c.categoria ? `Categoría ${c.categoria} · ` : ''}Océano {c.oceano}
            {c.aviso_num ? ` · aviso #${Number(c.aviso_num)}` : ''}
            {c.actualizado ? ` · ${fmtHora(c.actualizado)}` : ''}
          </p>
        </div>
        <span className={`text-xs font-semibold rounded-full border px-2.5 py-1 ${NIVEL_CLS[c.nivel]}`}>
          {NIVEL_TXT[c.nivel]}
        </span>
      </div>

      <p className={`text-sm rounded-lg border px-3 py-2 ${NIVEL_CLS[c.nivel]}`}>
        {fraseAmenaza(c)}
        {/* Los avisos del NHC pueden ser de otro país (Hawái, Cabo Verde…): sólo se
            remite al SMN cuando la tormenta está cerca de México. */}
        {c.avisos_costeros && (c.nivel !== 'baja'
          ? <> Hay <strong>vigilancias o avisos costeros vigentes</strong>: consulta el aviso oficial del SMN.</>
          : <> Tiene avisos costeros vigentes en otras costas.</>)}
      </p>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        <Dato label="Viento sostenido" value={c.viento_kmh != null ? `${u.wind(c.viento_kmh, 0)} ${u.windU}` : '--'}
          sub={c.viento_kt != null ? `${c.viento_kt} nudos` : undefined} />
        <Dato label="Presión central" value={c.presion_mb != null ? `${c.presion_mb} mb` : '--'} />
        <Dato label="Se mueve hacia"
          value={c.movimiento.rumbo ?? (c.movimiento.kmh === 0 ? 'Estacionario' : '--')}
          sub={c.movimiento.kmh ? `${u.wind(c.movimiento.kmh, 0)} ${u.windU}` : undefined} />
        <Dato label="Costa de México" value={c.ahora.sobre_tierra ? 'En tierra' : `${c.ahora.km_costa.toLocaleString('es-MX')} km`}
          sub={c.ahora.lugar} />
        <Dato label="De la estación" value={`${c.km_estacion.toLocaleString('es-MX')} km`}
          sub={`${Math.abs(c.lat).toFixed(1)}°${c.lat >= 0 ? 'N' : 'S'} ${Math.abs(c.lon).toFixed(1)}°${c.lon <= 0 ? 'O' : 'E'}`} />
      </div>

      <AvisosCosta c={c} />
      <Probabilidades c={c} />

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        <NhcImg src={c.imagenes.cono} v={v} alt={`Cono de pronóstico de ${c.nombre}`}
          caption="Cono de pronóstico a 5 días (NHC). El centro puede ir por cualquier parte del cono; los efectos llegan mucho más allá." />
        <CycloneSat id={c.id} nombre={c.nombre} />
        <NhcImg src={c.imagenes.mensajes} v={v} alt={`Mensajes clave de ${c.nombre}`}
          caption="Mensajes clave del NHC: los peligros más importantes de esta tormenta." />
      </div>

      {c.pronostico.length > 0 && (
        <div>
          <button onClick={() => setVerPron((v) => !v)} className="text-sm text-sky-400 hover:text-sky-300">
            {verPron ? '▾' : '▸'} Pronóstico de trayectoria ({c.pronostico.length} puntos)
          </button>
          {verPron && (
            <div className="overflow-x-auto mt-2">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] text-slate-400">
                    <th className="py-1 pr-3 font-medium">Hora (local)</th>
                    <th className="py-1 pr-3 font-medium">Posición</th>
                    <th className="py-1 pr-3 font-medium">Viento</th>
                    <th className="py-1 font-medium">Intensidad</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {c.pronostico.map((p) => {
                    const cat = categoriaDeKt(p.viento_kt)
                    const tipo = p.viento_kt == null ? '--' : cat ? `Huracán cat. ${cat}` : p.viento_kt >= 34 ? 'Tormenta tropical' : 'Depresión'
                    return (
                      <tr key={p.horas} className="text-slate-300">
                        <td className="py-1 pr-3 whitespace-nowrap">{p.valido ? fmtHora(p.valido) : `+${p.horas} h`}</td>
                        <td className="py-1 pr-3 whitespace-nowrap tabular-nums">{p.lat.toFixed(1)}°N {Math.abs(p.lon).toFixed(1)}°O</td>
                        <td className="py-1 pr-3 whitespace-nowrap">{p.viento_kt != null ? `${u.wind(p.viento_kt * 1.852, 0)} ${u.windU}` : '--'}</td>
                        <td className="py-1 whitespace-nowrap">{tipo}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <a href={SMN_AVISO[c.cuenca]} target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:text-sky-300">Aviso oficial del SMN ↗</a>
        {c.aviso_url && <a href={c.aviso_url} target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:text-sky-300">Aviso público NHC (inglés) ↗</a>}
        {c.graficas_url && <a href={c.graficas_url} target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:text-sky-300">Todas las gráficas NHC ↗</a>}
      </div>
    </div>
  )
}

const ESCALA: [string, string, string][] = [
  ['Depresión tropical', '< 63 km/h', '#38bdf8'],
  ['Tormenta tropical', '63–118 km/h', '#34d399'],
  ['Huracán cat. 1', '119–153 km/h', '#facc15'],
  ['Huracán cat. 2', '154–177 km/h', '#fb923c'],
  ['Huracán cat. 3 (mayor)', '178–208 km/h', '#f87171'],
  ['Huracán cat. 4 (mayor)', '209–251 km/h', '#e11d48'],
  ['Huracán cat. 5 (mayor)', '≥ 252 km/h', '#c026d3'],
]

export function CyclonesPage() {
  const data = useCiclones()
  const pac = enTemporada('ep'), atl = enTemporada('al')
  const tormentas = data?.tormentas ?? []
  const porOceano = (cu: string[]) => tormentas.filter((t) => cu.includes(t.cuenca))

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-bold text-slate-100 flex items-center gap-2"><Tornado className="w-6 h-6 text-sky-400" /> Ciclones tropicales</h2>
        <p className="text-sm text-slate-400">
          Depresiones, tormentas tropicales y huracanes activos en el Pacífico y el Atlántico, y qué tan cerca están de México.
        </p>
        <div className="flex flex-wrap gap-2 mt-2 text-xs">
          <span className={`rounded-full border px-2.5 py-0.5 ${pac ? 'border-sky-500/40 bg-sky-500/10 text-sky-200' : 'border-white/10 text-slate-400'}`}>
            Pacífico: {pac ? 'temporada activa' : 'fuera de temporada'} (15 may – 30 nov)
          </span>
          <span className={`rounded-full border px-2.5 py-0.5 ${atl ? 'border-sky-500/40 bg-sky-500/10 text-sky-200' : 'border-white/10 text-slate-400'}`}>
            Atlántico: {atl ? 'temporada activa' : 'fuera de temporada'} (1 jun – 30 nov)
          </span>
        </div>
      </div>

      {data?.stale && (
        <div className="card border-amber-500/30 bg-amber-500/5 text-sm text-amber-200">
          ⚠ El NHC no responde en este momento; se muestra la última información que alcanzó a publicar.
        </div>
      )}

      {!data ? (
        <div className="h-48 flex items-center justify-center"><RefreshCw className="w-8 h-8 animate-spin text-blue-400" /></div>
      ) : tormentas.length === 0 ? (
        <div className="card">
          <p className="text-slate-200 font-medium">No hay ciclones tropicales activos en el Pacífico ni en el Atlántico.</p>
          <p className="text-sm text-slate-400 mt-1">Abajo está la perspectiva a 7 días: las zonas donde podría formarse uno.</p>
        </div>
      ) : (
        <>
          <p className="text-sm text-slate-300">
            {tormentas.length} {tormentas.length === 1 ? 'ciclón activo' : 'ciclones activos'}:{' '}
            {porOceano(['ep', 'cp']).length} en el Pacífico y {porOceano(['al']).length} en el Atlántico.
            Primero los más cercanos a México.
          </p>
          <div className="flex flex-wrap gap-2">
            {tormentas.map((t) => (
              <a key={t.id} href={`#${t.id}`} className="flex items-center gap-1.5 rounded-lg bg-white/5 hover:bg-white/10 px-2.5 py-1 text-sm text-slate-200">
                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: colorCiclon(t) }} />
                {t.nombre} <span className="text-slate-400 text-xs">· {etiquetaCiclon(t)}</span>
              </a>
            ))}
          </div>
          <CyclonesMap tormentas={tormentas} />
          {tormentas.map((t) => <TormentaCard key={t.id} c={t} v={data.actualizado} />)}
        </>
      )}

      <TemporadaResumen />

      <section>
        <h3 className="text-lg font-semibold text-slate-300 mb-2">Perspectiva a 7 días</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="card"><NhcImg src="/api/ciclones/img/outlook/pacifico" v={data?.actualizado} alt="Perspectiva del Pacífico a 7 días"
            caption="Pacífico oriental. Las zonas marcadas son áreas donde podría formarse un ciclón (amarillo: baja, naranja: media, rojo: alta probabilidad)." /></div>
          <div className="card"><NhcImg src="/api/ciclones/img/outlook/atlantico" v={data?.actualizado} alt="Perspectiva del Atlántico a 7 días"
            caption="Atlántico, Golfo de México y Caribe. Mismo código de colores." /></div>
        </div>
      </section>

      <section>
        <h3 className="text-lg font-semibold text-slate-300 mb-2">Escala de intensidad</h3>
        <div className="card">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
            {ESCALA.map(([n, v, col]) => (
              <div key={n} className="flex items-center gap-2 text-sm">
                <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: col }} />
                <span className="text-slate-200">{n}</span>
                <span className="text-slate-500 text-xs ml-auto whitespace-nowrap">{v}</span>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-slate-500 mt-2">Viento sostenido de 1 minuto (escala Saffir-Simpson).</p>
        </div>
      </section>

      <PageInfo>
        <p>
          Datos del <span className="font-semibold">Centro Nacional de Huracanes de EE. UU. (NHC · NOAA)</span>, que
          vigila el Atlántico y el Pacífico oriental; se actualizan cada 10 minutos y el NHC publica un aviso nuevo cada
          3 a 6 horas. Las distancias a la costa de México y la "amenaza" las calcula esta página con un contorno
          aproximado del país: son orientativas.
        </p>
        <p className="mt-2">
          <span className="font-semibold text-slate-200">Los avisos oficiales para México los emite el SMN (CONAGUA)</span>.
          Ante una amenaza real, sigue las indicaciones de Protección Civil.
        </p>
      </PageInfo>
    </div>
  )
}

function Cifra({ n, label }: { n: number; label: string }) {
  return (
    <div className="text-center">
      <p className="text-2xl font-bold text-slate-100 leading-none">{n}</p>
      <p className="text-[11px] text-slate-400">{label}</p>
    </div>
  )
}

function Oceano({ nombre, c }: { nombre: string; c: Temporada['pacifico'] }) {
  return (
    <div className="rounded-lg bg-white/5 px-3 py-2">
      <p className="text-sm font-semibold text-slate-200 mb-2">{nombre}</p>
      <div className="grid grid-cols-4 gap-2">
        <Cifra n={c.total} label="ciclones" /><Cifra n={c.tormentas} label="con nombre" />
        <Cifra n={c.huracanes} label="huracanes" /><Cifra n={c.mayores} label="mayores" />
      </div>
    </div>
  )
}

const fDia = (iso: string) => new Date(iso).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })

/** Resumen de la temporada (bitácora propia; empezó el 25 sep 2026). */
function TemporadaResumen() {
  const t = useSharedFetch<Temporada>('/api/ciclones/temporada', 600000)
  const u = useUnits()
  if (!t || !t.tormentas.length) return null
  const desde = t.desde ? new Date(t.desde).toLocaleDateString('es-MX', { day: 'numeric', month: 'long' }) : ''
  return (
    <section>
      <h3 className="text-lg font-semibold text-slate-300 mb-2">Temporada {t.anio}</h3>
      <div className="card space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Oceano nombre="Pacífico" c={t.pacifico} />
          <Oceano nombre="Atlántico" c={t.atlantico} />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] text-slate-400">
                <th className="py-1 pr-3 font-medium">Ciclón</th>
                <th className="py-1 pr-3 font-medium">Máxima intensidad</th>
                <th className="py-1 pr-3 font-medium">Presión mín.</th>
                <th className="py-1 pr-3 font-medium">Activo</th>
                <th className="py-1 font-medium">Para México</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 text-slate-300">
              {[...t.tormentas].reverse().map((e) => {
                const col = colorCiclon({ clase: (e.max_kt ?? 0) >= 34 ? 'TS' : 'TD', categoria: e.max_categoria ?? null })
                return (
                  <tr key={e.id}>
                    <td className="py-1 pr-3 whitespace-nowrap">
                      <span className="inline-block w-2.5 h-2.5 rounded-full mr-1.5 align-middle" style={{ backgroundColor: col }} />
                      {e.nombre} <span className="text-slate-500 text-xs">· {e.cuenca === 'al' ? 'Atl.' : 'Pac.'}</span>
                    </td>
                    <td className="py-1 pr-3 whitespace-nowrap">
                      {e.max_categoria ? `Huracán cat. ${e.max_categoria}` : e.max_tipo ?? '--'}
                      {e.max_kt != null && <span className="text-slate-500 text-xs"> · {u.wind(e.max_kt * 1.852, 0)} {u.windU}</span>}
                    </td>
                    <td className="py-1 pr-3 whitespace-nowrap tabular-nums">{e.min_mb != null ? `${e.min_mb} mb` : '--'}</td>
                    <td className="py-1 pr-3 whitespace-nowrap">{fDia(e.primera)} – {fDia(e.ultima)}</td>
                    <td className="py-1 whitespace-nowrap">
                      {e.nivel_max === 'alta' ? '🔴 Amenazó' : e.nivel_max === 'media' ? '🟠 Se acercó' : '—'}
                      {e.toco_tierra && <span className="text-slate-500 text-xs"> · pronóstico a tierra en {e.toco_tierra}</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-slate-500">Bitácora de esta estación: cuenta los ciclones vistos desde el {desde} (antes no se registraba).</p>
      </div>
    </section>
  )
}
