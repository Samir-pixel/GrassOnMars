import type { HealthResponse } from "../types/health";

interface StatusPanelProps {
  health: HealthResponse | null;
  loading: boolean;
  error: string | null;
  onReload: () => void;
  swaggerUrl: string;
}

function StatusRow({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-dotted border-signal py-2 text-[22px] leading-[1.25]">
      <span className="text-ink">{label}</span>
      <span className={ok ? "text-ink font-semibold" : "text-signal font-semibold"}>{value}</span>
    </div>
  );
}

export function StatusPanel({ health, loading, error, onReload, swaggerUrl }: StatusPanelProps) {
  return (
    <section className="mx-auto max-w-[1160px] px-5 py-16">
      <div className="border-2 border-ink bg-paper p-6 md:p-8">
        <div className="bg-signal px-5 py-3 text-paper">
          <h2 className="font-display text-[36px] uppercase leading-none md:text-[48px]">
            Статус среды разработки (Этап 2)
          </h2>
        </div>

        <div className="mt-6 space-y-2">
          {loading && <p className="text-[24px]">Проверка связи с сервером MARSWALK...</p>}

          {error && (
            <div className="border-2 border-signal p-4 text-[22px] text-signal">
              Не удалось связаться с Backend API: {error}
            </div>
          )}

          {health && (
            <>
              <StatusRow
                label="Сервер FastAPI"
                value={`${health.service} v${health.version} (${health.status.toUpperCase()})`}
                ok={health.status === "ok"}
              />
              <StatusRow
                label="База данных PostgreSQL"
                value={
                  health.database.connected
                    ? `Подключена (v${health.database.server_version ?? "?"})`
                    : `Нет соединения (${health.database.error ?? "ошибка"})`
                }
                ok={health.database.connected}
              />
              <StatusRow
                label="Расширение PostGIS"
                value={
                  health.database.postgis_installed
                    ? `Активно (${health.database.postgis_version ?? "установлено"})`
                    : "Ожидает контейнера PostGIS (Этап 4)"
                }
                ok={health.database.postgis_installed}
              />
              <StatusRow
                label="Локальный каталог геоданных (data/)"
                value={health.data_dir_ready ? "Готов" : "Не найден"}
                ok={health.data_dir_ready}
              />
              <StatusRow
                label="Ключ Google Gemini API (.env)"
                value={health.gemini_configured ? "Настроен на сервере" : "Не задан"}
                ok={health.gemini_configured}
              />
            </>
          )}
        </div>

        <div className="mt-8 flex flex-wrap gap-[10px]">
          <button
            type="button"
            onClick={onReload}
            className="flex h-[70px] items-center justify-center rounded-action bg-signal px-[30px] py-[20px] font-display text-[22px] uppercase leading-[30px] tracking-[-0.02em] text-paper transition-colors duration-200 hover:bg-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#005fcc]"
          >
            Обновить статус
          </button>
          <a
            href={swaggerUrl}
            target="_blank"
            rel="noreferrer"
            className="flex h-[70px] items-center justify-center rounded-action bg-ink px-[30px] py-[20px] font-display text-[22px] uppercase leading-[30px] tracking-[-0.02em] text-paper transition-colors duration-200 hover:bg-signal focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#005fcc]"
          >
            Открыть Swagger (/docs)
          </a>
        </div>
      </div>
    </section>
  );
}
