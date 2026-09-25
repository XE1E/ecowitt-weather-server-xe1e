

export function WelcomeStep({ onNext }: { onNext: () => void }) {
  return (
    <div className="text-center">
      <div className="text-6xl mb-6">🌦️</div>
      <h2 className="text-2xl font-bold mb-4">Bienvenido al Panel de Administración</h2>
      <p className="text-slate-400 mb-8 max-w-md mx-auto">
        Tu estación está enviando datos correctamente. Vamos a configurar
        lo básico para que puedas sacarle el máximo provecho.
      </p>
      <button
        onClick={onNext}
        className="bg-sky-600 hover:bg-sky-500 text-white font-medium px-8 py-3 rounded-lg transition-colors"
      >
        Comenzar configuración
      </button>
    </div>
  )
}
