"""Configuração explícita, sem dependência de arquivos .env."""

from dataclasses import dataclass, field
from pathlib import Path
import os

BASE_DIR = Path(__file__).resolve().parent.parent


@dataclass(frozen=True)
class Settings:
    database_path: Path = field(default_factory=lambda: Path(
        os.environ.get("RADAR_DATABASE", str(BASE_DIR / "data" / "radar.sqlite3"))
    ).expanduser().resolve())
    seed: bool = field(default_factory=lambda: os.environ.get("RADAR_SEED", "1") == "1")
    session_hours: int = 8
    cors_origins: tuple[str, ...] = field(default_factory=lambda: tuple(
        item.strip() for item in os.environ.get(
            "RADAR_CORS_ORIGINS", "http://127.0.0.1:8000,http://localhost:8000"
        ).split(",") if item.strip()
    ))

