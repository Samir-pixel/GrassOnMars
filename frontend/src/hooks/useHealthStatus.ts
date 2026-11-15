import { useCallback, useEffect, useState } from "react";
import { fetchSystemHealth } from "../services/api";
import type { HealthResponse } from "../types/health";

export interface HealthState {
  data: HealthResponse | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

export function useHealthStatus(): HealthState {
  const [data, setData] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback((signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    fetchSystemHealth(signal)
      .then((res) => {
        setData(res);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") {
          return;
        }
        const message = err instanceof Error ? err.message : "Неизвестная ошибка соединения";
        setError(message);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  return { data, loading, error, reload: () => load() };
}
