import { KioskPage } from '../pages/KioskPage'
import { UnitsProvider } from '../units'
import { StationDataProvider } from '../station-data'

export default function KioskApp() {
  return (
    <UnitsProvider>
      <StationDataProvider>
        <KioskPage />
      </StationDataProvider>
    </UnitsProvider>
  )
}
