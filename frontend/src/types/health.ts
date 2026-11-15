export interface DatabaseStatus {
  connected: boolean;
  server_version: string | null;
  postgis_installed: boolean;
  postgis_version: string | null;
  error: string | null;
}

export interface HealthResponse {
  status: "ok" | "degraded";
  service: string;
  version: string;
  environment: string;
  timestamp_utc: string;
  database: DatabaseStatus;
  data_dir_ready: boolean;
  gemini_configured: boolean;
  disclaimer_ru: string;
}
