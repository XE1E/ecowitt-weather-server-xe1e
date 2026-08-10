export function DisclaimerPage() {
  const updated = '2026-08-10'

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold mb-1">Aviso Legal</h1>
        <p className="text-sm text-slate-500">Última actualización: {updated}</p>
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-200">Aviso General</h2>
        <p className="text-slate-400 leading-relaxed">
          Nunca bases decisiones importantes que puedan resultar en daño a personas o propiedad
          en la información meteorológica de este sitio. Esta estación es un proyecto personal
          y se proporciona únicamente con fines informativos.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-200">Exactitud y Disponibilidad</h2>
        <p className="text-slate-400 leading-relaxed">
          Los datos meteorológicos y pronósticos pueden estar retrasados, incompletos o ser
          inexactos. No se garantiza disponibilidad continua ni precisión de los datos.
          Los sensores pueden fallar, descalibrarse o perder conectividad sin previo aviso.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-200">No Usar para Decisiones Críticas</h2>
        <p className="text-slate-400 leading-relaxed">
          No utilices este sitio como única fuente para decisiones críticas de seguridad,
          incluyendo pero no limitado a:
        </p>
        <ul className="list-disc list-inside text-slate-400 space-y-1 ml-2">
          <li>Respuesta a clima severo (tormentas, huracanes, tornados)</li>
          <li>Operaciones de aviación o navegación marítima</li>
          <li>Gestión de emergencias</li>
          <li>Protección de propiedades</li>
          <li>Actividades agrícolas comerciales</li>
          <li>Eventos al aire libre masivos</li>
        </ul>
        <p className="text-slate-400 leading-relaxed mt-3">
          Para avisos oficiales y guía de emergencia, consulta el{' '}
          <a href="https://smn.conagua.gob.mx" target="_blank" rel="noopener noreferrer"
            className="text-sky-400 hover:text-sky-300">Servicio Meteorológico Nacional (SMN)</a>,{' '}
          <a href="https://www.gob.mx/cenapred" target="_blank" rel="noopener noreferrer"
            className="text-sky-400 hover:text-sky-300">CENAPRED</a> y las autoridades locales.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-200">Datos de Terceros</h2>
        <p className="text-slate-400 leading-relaxed">
          Parte de la información proviene de proveedores externos y está sujeta a sus
          términos y requisitos de atribución:
        </p>
        <ul className="list-disc list-inside text-slate-400 space-y-1 ml-2">
          <li><strong className="text-slate-300">Pronóstico:</strong> Open-Meteo (CC BY 4.0), WeatherAPI.com</li>
          <li><strong className="text-slate-300">Astronomía:</strong> Open-Meteo, cálculos locales</li>
          <li><strong className="text-slate-300">Calidad del aire:</strong> WAQI (aqicn.org), Open-Meteo</li>
          <li><strong className="text-slate-300">Radar:</strong> Ventusky</li>
          <li><strong className="text-slate-300">Satélite:</strong> NASA GIBS (MODIS/VIIRS)</li>
          <li><strong className="text-slate-300">Sismos:</strong> USGS, SSN México</li>
          <li><strong className="text-slate-300">METAR/TAF:</strong> aviationweather.gov (NOAA)</li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-200">Privacidad</h2>
        <p className="text-slate-400 leading-relaxed">
          Este sitio no recopila información personal de los visitantes. No se utilizan
          cookies de seguimiento ni servicios de analítica de terceros. Los únicos datos
          almacenados son las lecturas meteorológicas de los sensores físicos.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-200">Código Abierto</h2>
        <p className="text-slate-400 leading-relaxed">
          El código fuente de este proyecto está disponible en{' '}
          <a href="https://github.com/XE1E/ecowitt-weather-server-xe1e" target="_blank"
            rel="noopener noreferrer" className="text-sky-400 hover:text-sky-300">
            GitHub
          </a>. Puedes usarlo, modificarlo y desplegarlo para tu propia estación meteorológica.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-200">Contacto</h2>
        <p className="text-slate-400 leading-relaxed">
          Para reportar problemas con el sitio o el código, abre un issue en el repositorio
          de GitHub. Para consultas generales sobre la estación, puedes contactar al operador
          a través del mismo repositorio.
        </p>
      </section>

      <div className="border-t border-white/10 pt-6 text-sm text-slate-500">
        <p>
          Al utilizar este sitio, aceptas que el operador no será responsable de ningún
          daño directo, indirecto, incidental o consecuente que surja del uso de la
          información proporcionada.
        </p>
      </div>
    </div>
  )
}
