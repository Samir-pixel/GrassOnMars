from pathlib import Path
from urllib.parse import quote_plus

from pydantic import SecretStr, computed_field
from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT_ENV = Path(__file__).resolve().parents[3] / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(str(ROOT_ENV), ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "MARSWALK API"
    app_version: str = "0.3.0"
    app_env: str = "development"
    log_level: str = "INFO"

    postgres_user: str = "marswalk"
    postgres_password: SecretStr = SecretStr("marswalk_dev_password")
    postgres_db: str = "marswalk"
    postgres_host: str = "localhost"
    postgres_port: int = 4782
    database_url: str | None = None

    cors_origins: str = "http://localhost:4780,http://127.0.0.1:4780,https://grassonmars.myspaceproject.app"
    data_dir: Path = Path(__file__).resolve().parents[3] / "data"
    gemini_api_key: SecretStr | None = None

    @computed_field  # type: ignore[prop-decorator]
    @property
    def sqlalchemy_database_uri(self) -> str:
        if self.database_url:
            if self.database_url.startswith("postgresql://"):
                return self.database_url.replace("postgresql://", "postgresql+psycopg://", 1)
            return self.database_url
        pwd = quote_plus(self.postgres_password.get_secret_value())
        return (
            f"postgresql+psycopg://{self.postgres_user}:{pwd}"
            f"@{self.postgres_host}:{self.postgres_port}/{self.postgres_db}"
        )

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def gemini_configured(self) -> bool:
        if self.gemini_api_key is None:
            return False
        raw = self.gemini_api_key.get_secret_value().strip()
        return bool(raw) and raw != "your_gemini_api_key_here"


settings = Settings()
