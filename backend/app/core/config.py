"""Central configuration. Every tunable number for the data layer and regime detector lives here."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[2]

ALL_FEATURES = ("contango", "vix_ratio", "log_vvix", "rv20", "vix_pct_252", "d_contango_5")
REGIME_NAMES = ("Calm", "Stressed", "Panic")


class HysteresisConfig(BaseModel):
    enter_calm: float = 0.60
    enter_stressed: float = 0.60
    enter_panic: float = 0.70
    exit_panic: float = 0.40


class BaselineConfig(BaseModel):
    calm_min_contango: float = 0.05
    calm_max_vix_ratio: float = 0.95


class ValidationConfig(BaseModel):
    spike_threshold: float = 0.30  # VIX rise >= 30% ...
    spike_window: int = 5  # ... within the next 5 trading days
    calm_year: int = 2017
    pass_share: float = 0.5  # known episode "pass" if >= this share flagged Stressed/Panic


class JumpConfig(BaseModel):
    """Jump detection for spot-VIX calibration; same defaults as the Monte Carlo simulator."""

    threshold_k: float = 3.0
    side: Literal["up", "both"] = "up"
    max_iter: int = 10


class RegimeConfig(BaseModel):
    features: list[str] = Field(default_factory=lambda: list(ALL_FEATURES))
    n_states: int = 3
    n_restarts: int = 10
    n_iter: int = 500
    min_covar: float = 1e-4
    tol: float = 1e-4
    analysis_start: str = "2008-01-01"
    first_train_end: str = "2013-12-31"
    refit_freq: Literal["yearly", "quarterly"] = "yearly"
    forecast_horizons: list[int] = Field(default_factory=lambda: [1, 5, 20])
    pct_window: int = 252
    rv_window: int = 20
    d_contango_lag: int = 5
    hysteresis: HysteresisConfig = Field(default_factory=HysteresisConfig)
    baseline: BaselineConfig = Field(default_factory=BaselineConfig)
    validation: ValidationConfig = Field(default_factory=ValidationConfig)
    jump: JumpConfig = Field(default_factory=JumpConfig)

    @field_validator("n_states")
    @classmethod
    def _states_range(cls, v: int) -> int:
        if not 2 <= v <= 4:
            raise ValueError("n_states must be between 2 and 4")
        return v

    @field_validator("features")
    @classmethod
    def _known_features(cls, v: list[str]) -> list[str]:
        unknown = set(v) - set(ALL_FEATURES)
        if unknown:
            raise ValueError(f"unknown features: {sorted(unknown)}")
        if "contango" not in v:
            raise ValueError("'contango' is required: states are labelled by mean contango")
        return v


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="UVXY_", env_file=".env", extra="ignore")

    data_dir: Path = BACKEND_DIR / "data"
    data_start: str = "2007-01-01"
    http_timeout: float = 30.0
    # Training parallelism. Each worker process needs ~200 MB and BLAS is pinned to
    # ``train_blas_threads`` per worker, so peak CPU threads = n_jobs * blas_threads.
    # Keep this modest on small machines (e.g. WSL with ~6 GB RAM): n_jobs=-1 on 12 cores
    # exhausted memory and stalled the host.
    train_n_jobs: int = Field(default=4, ge=1, le=32)
    train_blas_threads: int = Field(default=1, ge=1, le=16)
    cors_origins: list[str] = Field(
        # 5174: this client; 5173: the Monte Carlo simulator's client ("Use today's regime").
        default_factory=lambda: [
            "http://localhost:5174",
            "http://127.0.0.1:5174",
            "http://localhost:5173",
            "http://127.0.0.1:5173",
        ]
    )
    regime: RegimeConfig = Field(default_factory=RegimeConfig)

    @property
    def raw_dir(self) -> Path:
        return self.data_dir / "raw"

    @property
    def processed_dir(self) -> Path:
        return self.data_dir / "processed"

    @property
    def regime_dir(self) -> Path:
        return self.processed_dir / "regime"

    @property
    def panel_path(self) -> Path:
        return self.processed_dir / "panel.parquet"


@lru_cache
def get_settings() -> Settings:
    return Settings()
