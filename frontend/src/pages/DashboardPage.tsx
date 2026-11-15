import { StatusPanel } from "../components/StatusPanel";
import { useHealthStatus } from "../hooks/useHealthStatus";
import { API_BASE_URL } from "../services/api";

function FourPointStar({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true" className={className ?? "h-12 w-12 fill-current"}>
      <path d="M24 0C25.8 14.8 33.2 22.2 48 24C33.2 25.8 25.8 33.2 24 48C22.2 33.2 14.8 25.8 0 24C14.8 22.2 22.2 14.8 24 0Z" />
    </svg>
  );
}

export function DashboardPage() {
  const { data, loading, error, reload } = useHealthStatus();

  return (
    <div className="min-h-screen paper-halftone flex flex-col">
      <header className="charcoal-halftone border-b-2 border-ink px-5 py-16 text-paper">
        <div className="mx-auto flex max-w-[1160px] flex-col items-center text-center">
          <div className="flex items-center justify-center gap-6 md:gap-10">
            <FourPointStar className="hidden h-11 w-11 fill-paper sm:block" />
            <h1 className="font-display text-[56px] uppercase leading-[0.875] md:text-[96px]">
              MARSWALK
            </h1>
            <FourPointStar className="hidden h-11 w-11 fill-paper sm:block" />
          </div>
          <p className="mt-8 max-w-[768px] text-[24px] leading-[1.25] text-paper">
            Интегрированная планетарная ГИС и система планирования маршрутов по кратеру Езеро на
            основе научных данных миссий NASA. Научные модули подключаются последовательно на этапах
            3–14.
          </p>
        </div>
      </header>

      <main className="flex-1">
        <StatusPanel
          health={data}
          loading={loading}
          error={error}
          onReload={reload}
          swaggerUrl={`${API_BASE_URL}/docs`}
        />
      </main>

      <footer className="bg-ink px-5 py-6 text-paper">
        <div className="mx-auto flex max-w-[1400px] flex-col items-center justify-between gap-4 text-center text-[20px] uppercase leading-[1.5] md:flex-row md:text-left">
          <span>Кратер Езеро · Сфера Марса 2000 (R = 3 396 190 м)</span>
          <span className="text-signal">
            Исследовательский прототип · Не сертифицирован NASA · Не для оценки безопасности экипажа
          </span>
        </div>
      </footer>
    </div>
  );
}
