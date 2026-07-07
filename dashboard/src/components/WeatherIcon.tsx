// Animated weather icons from Meteocons (formerly Basmilius weather-icons), MIT.
// Imported as URLs and rendered via <img>; the SVGs are self-contained and
// animate on their own.
import clearDay from '@meteocons/svg/fill/clear-day.svg'
import clearNight from '@meteocons/svg/fill/clear-night.svg'
import partlyCloudyDay from '@meteocons/svg/fill/partly-cloudy-day.svg'
import partlyCloudyNight from '@meteocons/svg/fill/partly-cloudy-night.svg'
import overcastDay from '@meteocons/svg/fill/overcast-day.svg'
import overcastNight from '@meteocons/svg/fill/overcast-night.svg'
import overcastDayRain from '@meteocons/svg/fill/overcast-day-rain.svg'
import overcastNightRain from '@meteocons/svg/fill/overcast-night-rain.svg'
import rain from '@meteocons/svg/fill/rain.svg'
import drizzle from '@meteocons/svg/fill/drizzle.svg'
import snow from '@meteocons/svg/fill/snow.svg'
import thunderstormsRain from '@meteocons/svg/fill/thunderstorms-rain.svg'
import fogDay from '@meteocons/svg/fill/fog-day.svg'
import fogNight from '@meteocons/svg/fill/fog-night.svg'
import mist from '@meteocons/svg/fill/mist.svg'
import thermometer from '@meteocons/svg/fill/thermometer.svg'
import thermometerWarmer from '@meteocons/svg/fill/thermometer-warmer.svg'
import humidity from '@meteocons/svg/fill/humidity.svg'
import barometer from '@meteocons/svg/fill/barometer.svg'
import windsock from '@meteocons/svg/fill/windsock.svg'
import uvIndex from '@meteocons/svg/fill/uv-index.svg'
import raindrops from '@meteocons/svg/fill/raindrops.svg'
import compass from '@meteocons/svg/fill/compass.svg'
import notAvailable from '@meteocons/svg/fill/not-available.svg'
// Forecast + astronomy
import partlyCloudyDayDrizzle from '@meteocons/svg/fill/partly-cloudy-day-drizzle.svg'
import partlyCloudyDayRain from '@meteocons/svg/fill/partly-cloudy-day-rain.svg'
import overcastDaySleet from '@meteocons/svg/fill/overcast-day-sleet.svg'
import overcastDaySnow from '@meteocons/svg/fill/overcast-day-snow.svg'
import thunderstormsDayRain from '@meteocons/svg/fill/thunderstorms-day-rain.svg'
import sunrise from '@meteocons/svg/fill/sunrise.svg'
import sunset from '@meteocons/svg/fill/sunset.svg'
import moonNew from '@meteocons/svg/fill/moon-new.svg'
import moonWaxingCrescent from '@meteocons/svg/fill/moon-waxing-crescent.svg'
import moonFirstQuarter from '@meteocons/svg/fill/moon-first-quarter.svg'
import moonWaxingGibbous from '@meteocons/svg/fill/moon-waxing-gibbous.svg'
import moonFull from '@meteocons/svg/fill/moon-full.svg'
import moonWaningGibbous from '@meteocons/svg/fill/moon-waning-gibbous.svg'
import moonLastQuarter from '@meteocons/svg/fill/moon-last-quarter.svg'
import moonWaningCrescent from '@meteocons/svg/fill/moon-waning-crescent.svg'

const ICONS: Record<string, string> = {
  'clear-day': clearDay,
  'clear-night': clearNight,
  'partly-cloudy-day': partlyCloudyDay,
  'partly-cloudy-night': partlyCloudyNight,
  'overcast-day': overcastDay,
  'overcast-night': overcastNight,
  'overcast-day-rain': overcastDayRain,
  'overcast-night-rain': overcastNightRain,
  rain,
  drizzle,
  snow,
  'thunderstorms-rain': thunderstormsRain,
  'fog-day': fogDay,
  'fog-night': fogNight,
  mist,
  thermometer,
  'thermometer-warmer': thermometerWarmer,
  humidity,
  barometer,
  windsock,
  'uv-index': uvIndex,
  raindrops,
  compass,
  'partly-cloudy-day-drizzle': partlyCloudyDayDrizzle,
  'partly-cloudy-day-rain': partlyCloudyDayRain,
  'overcast-day-sleet': overcastDaySleet,
  'overcast-day-snow': overcastDaySnow,
  'thunderstorms-day-rain': thunderstormsDayRain,
  sunrise,
  sunset,
  'moon-new': moonNew,
  'moon-waxing-crescent': moonWaxingCrescent,
  'moon-first-quarter': moonFirstQuarter,
  'moon-waxing-gibbous': moonWaxingGibbous,
  'moon-full': moonFull,
  'moon-waning-gibbous': moonWaningGibbous,
  'moon-last-quarter': moonLastQuarter,
  'moon-waning-crescent': moonWaningCrescent,
}

interface WeatherIconProps {
  name: string
  size?: number
  className?: string
  alt?: string
}

export function WeatherIcon({ name, size = 32, className = '', alt = '' }: WeatherIconProps) {
  const src = ICONS[name] ?? notAvailable
  return (
    <img
      src={src}
      width={size}
      height={size}
      className={className}
      alt={alt || name}
      draggable={false}
      style={{ display: 'block' }}
    />
  )
}
