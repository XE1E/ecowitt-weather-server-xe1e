import { useState, useMemo } from 'react'
import { AreaChart, Area, XAxis, YAxis, ReferenceLine, ResponsiveContainer, CartesianGrid, Tooltip } from 'recharts'
import { Sun } from 'lucide-react'
import { LOCATION } from '../../config'

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const MESES_LARGO = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

function toRad(deg: number) { return deg * Math.PI / 180 }
function toDeg(rad: number) { return rad * 180 / Math.PI }

function calcSunTimes(date: Date, lat: number, lon: number) {
  const year = date.getFullYear()
  const start = new Date(year, 0, 1)
  const dayOfYear = Math.floor((date.getTime() - start.getTime()) / 86400000) + 1

  const gamma = 2 * Math.PI / 365 * (dayOfYear - 1 + (12 - 12) / 24)
  const eqtime = 229.18 * (0.000075 + 0.001868 * Math.cos(gamma) - 0.032077 * Math.sin(gamma)
    - 0.014615 * Math.cos(2 * gamma) - 0.040849 * Math.sin(2 * gamma))
  const decl = 0.006918 - 0.399912 * Math.cos(gamma) + 0.070257 * Math.sin(gamma)
    - 0.006758 * Math.cos(2 * gamma) + 0.000907 * Math.sin(2 * gamma)
    - 0.002697 * Math.cos(3 * gamma) + 0.00148 * Math.sin(3 * gamma)

  const latRad = toRad(lat)
  const zenith = toRad(90.833)
  let ha = Math.acos(Math.cos(zenith) / (Math.cos(latRad) * Math.cos(decl)) - Math.tan(latRad) * Math.tan(decl))

  if (isNaN(ha)) {
    const midDay = toDeg(decl) > 0 ? (lat > 0 ? 24 : 0) : (lat > 0 ? 0 : 24)
    return { sunrise: midDay === 24 ? 0 : 12, sunset: midDay === 24 ? 24 : 12, dayLength: midDay }
  }

  ha = toDeg(ha)
  const solarNoon = (720 - 4 * lon - eqtime) / 60
  const offset = -new Date().getTimezoneOffset() / 60
  const sunrise = solarNoon - ha / 15 + offset
  const sunset = solarNoon + ha / 15 + offset

  return {
    sunrise: Math.max(0, Math.min(24, sunrise)),
    sunset: Math.max(0, Math.min(24, sunset)),
    dayLength: Math.max(0, Math.min(24, sunset - sunrise))
  }
}

function formatTime(hours: number): string {
  const h = Math.floor(hours)
  const m = Math.round((hours - h) * 60)
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`
}

function formatDuration(hours: number): string {
  const h = Math.floor(hours)
  const m = Math.round((hours - h) * 60)
  return `${h}h ${m}min`
}

function formatDate(dayIndex: number): string {
  const d = new Date(new Date().getFullYear(), 0, dayIndex + 1)
  return `${d.getDate()} de ${MESES_LARGO[d.getMonth()]}`
}

function formatShortDate(dayIndex: number): string {
  const d = new Date(new Date().getFullYear(), 0, dayIndex + 1)
  return `${d.getDate()} ${MESES[d.getMonth()]}`
}

export function DaylightChart() {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)

  const { data, todayIndex } = useMemo(() => {
    const year = new Date().getFullYear()
    const today = new Date()
    const startOfYear = new Date(year, 0, 1)
    const currentDayIndex = Math.floor((today.getTime() - startOfYear.getTime()) / 86400000)

    const result: Array<{
      day: number
      month: string
      sunrise: number
      sunset: number
      dayLength: number
      nightBefore: number
      daylight: number
      nightAfter: number
    }> = []

    for (let d = 0; d < 365; d++) {
      const date = new Date(year, 0, d + 1)
      const { sunrise, sunset, dayLength } = calcSunTimes(date, LOCATION.latitude, LOCATION.longitude)
      result.push({
        day: d,
        month: MESES[date.getMonth()],
        sunrise,
        sunset,
        dayLength,
        nightBefore: sunrise,
        daylight: sunset - sunrise,
        nightAfter: 24 - sunset
      })
    }
    return { data: result, todayIndex: currentDayIndex }
  }, [])

  const todayData = data[todayIndex]
  const hoverData = hoverIndex !== null ? data[hoverIndex] : null

  const monthTicks = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334]

  const tip = {
    contentStyle: { backgroundColor: 'var(--surface, #0f1a2a)', border: '1px solid var(--line, #334155)', borderRadius: 8 },
    labelStyle: { color: 'var(--ink, #e2e8f0)', fontWeight: 600 },
  }
  const cursor = { stroke: 'rgba(148,163,184,0.7)', strokeDasharray: '4 4' }

  return (
    <div className="card">
      <p className="card-title flex items-center gap-2"><Sun className="w-4 h-4 text-amber-400" /> Duración día</p>
      <div className="h-80 md:h-64 overflow-x-auto chart-scroll">
        <div style={{ minWidth: '480px', height: '100%' }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
            data={data}
            margin={{ top: 5, right: 6, left: -8, bottom: 0 }}
            onMouseMove={(e) => {
              if (e && e.activeTooltipIndex !== undefined) {
                setHoverIndex(e.activeTooltipIndex)
              }
            }}
            onMouseLeave={() => setHoverIndex(null)}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.35)" />
            <XAxis
              dataKey="day"
              tick={{ fill: '#94a3b8', fontSize: 12 }}
              ticks={monthTicks}
              tickFormatter={(d) => data[d]?.month || ''}
              minTickGap={12}
            />
            <YAxis
              yAxisId="left"
              domain={[0, 24]}
              ticks={[0, 4, 8, 12, 16, 20, 24]}
              tickFormatter={(v) => `${v.toString().padStart(2, '0')}:00`}
              tick={{ fill: '#94a3b8', fontSize: 12 }}
              width={48}
            />
            <YAxis
              yAxisId="right"
              orientation="right"
              domain={[0, 15]}
              ticks={[0, 5, 10, 15]}
              tickFormatter={(v) => `${v}h`}
              tick={{ fill: '#94a3b8', fontSize: 12 }}
              width={32}
            />
            <Tooltip
              cursor={cursor}
              {...tip}
              labelFormatter={(idx: number) => formatShortDate(idx)}
              formatter={(v: number, name: string) => {
                if (name === 'Ocaso') return [formatTime(v), name]
                return [null, null]
              }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null
                const d = payload[0]?.payload
                if (!d) return null
                return (
                  <div style={{ backgroundColor: '#0f1a2a', border: '1px solid #334155', borderRadius: 8, padding: '8px 12px' }}>
                    <p style={{ color: '#e2e8f0', fontWeight: 600, marginBottom: 4 }}>{formatShortDate(d.day)}</p>
                    <p style={{ color: '#94a3b8', fontSize: 12 }}>Amanecer: <span style={{ color: '#38bdf8' }}>{formatTime(d.sunrise)}</span></p>
                    <p style={{ color: '#94a3b8', fontSize: 12 }}>Ocaso: <span style={{ color: '#f97316' }}>{formatTime(d.sunset)}</span></p>
                    <p style={{ color: '#94a3b8', fontSize: 12 }}>Duración: <span style={{ color: '#fbbf24' }}>{formatDuration(d.dayLength)}</span></p>
                  </div>
                )
              }}
            />
            <Area
              yAxisId="left"
              type="monotone"
              dataKey="nightBefore"
              stackId="1"
              fill="#2d3a4a"
              stroke="none"
              isAnimationActive={false}
            />
            <Area
              yAxisId="left"
              type="monotone"
              dataKey="daylight"
              stackId="1"
              fill="#7a6b32"
              stroke="none"
              isAnimationActive={false}
            />
            <Area
              yAxisId="left"
              type="monotone"
              dataKey="nightAfter"
              stackId="1"
              fill="#3d4654"
              stroke="none"
              isAnimationActive={false}
            />
            <Area
              yAxisId="left"
              type="monotone"
              dataKey="sunset"
              name="Ocaso"
              fill="none"
              stroke="#f97316"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
            <ReferenceLine
              yAxisId="left"
              x={todayIndex}
              stroke="#3b82f6"
              strokeWidth={1.5}
              label={{
                value: formatShortDate(todayIndex),
                position: 'insideBottomLeft',
                fill: '#3b82f6',
                fontSize: 10,
                offset: 5
              }}
            />
            {hoverIndex !== null && hoverIndex !== todayIndex && (
              <ReferenceLine
                yAxisId="left"
                x={hoverIndex}
                stroke="#9ca3af"
                strokeWidth={1}
                label={{
                  value: formatShortDate(hoverIndex),
                  position: 'insideBottomLeft',
                  fill: '#9ca3af',
                  fontSize: 10,
                  offset: 5
                }}
              />
            )}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="mt-3 border-t border-white/10 pt-3">
        <div className="grid grid-cols-4 gap-2 text-sm text-slate-400 border-b border-white/10 pb-2 mb-2">
          <span></span>
          <span className="text-center">Amanecer</span>
          <span className="text-center">Ocaso</span>
          <span className="text-center flex items-center justify-center gap-1">
            <span className="w-2 h-2 rounded-full bg-amber-400"></span>
            Duración día
          </span>
        </div>
        <div className="grid grid-cols-4 gap-2 text-sm">
          <span className="text-slate-200 font-medium">{formatDate(todayIndex)}</span>
          <span className="text-center text-sky-400 tabular-nums font-semibold">{formatTime(todayData.sunrise)}</span>
          <span className="text-center text-orange-400 tabular-nums font-semibold">{formatTime(todayData.sunset)}</span>
          <span className="text-center text-amber-400 tabular-nums font-semibold">{formatDuration(todayData.dayLength)}</span>
        </div>
        <div className="grid grid-cols-4 gap-2 text-sm mt-2">
          <span className="text-slate-500">{hoverData ? formatDate(hoverIndex!) : '--'}</span>
          <span className="text-center text-sky-400/70 tabular-nums">{hoverData ? formatTime(hoverData.sunrise) : '--'}</span>
          <span className="text-center text-orange-400/70 tabular-nums">{hoverData ? formatTime(hoverData.sunset) : '--'}</span>
          <span className="text-center text-amber-400/70 tabular-nums">{hoverData ? formatDuration(hoverData.dayLength) : '--'}</span>
        </div>
      </div>
    </div>
  )
}
