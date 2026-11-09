"""Pydantic v2 response models for ``/api/regime``. Mirrored in ``client/src/types/regime.ts``."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict

Probabilities = dict[str, float]  # regime name -> probability


class _Model(BaseModel):
    model_config = ConfigDict(extra="ignore")


class FoldSummary(_Model):
    fold_id: str
    train_start: str
    train_end: str
    test_start: str | None = None
    test_end: str | None = None
    n_train: int
    log_likelihood: float
    runtime_s: float | None = None


class LiveSummary(_Model):
    train_end: str
    log_likelihood: float
    runtime_s: float


class TrainSummary(_Model):
    trained_at: str
    runtime_s: float
    n_folds: int
    refit_freq: str
    features: list[str]
    data_start: str
    data_end: str
    folds: list[FoldSummary]
    live: LiveSummary


class TrainStatus(_Model):
    trained: bool
    training: bool
    trained_at: str | None = None
    data_end: str | None = None
    runtime_s: float | None = None


class RiskStats(_Model):
    count: int
    mean: float | None = None
    median: float | None = None
    std: float | None = None
    p1: float | None = None
    p5: float | None = None
    p25: float | None = None
    p75: float | None = None
    p95: float | None = None
    p99: float | None = None
    prob_up_10: float | None = None
    prob_up_20: float | None = None
    prob_up_30: float | None = None
    next_regime_prob: Probabilities = {}


class SeriesPoint(_Model):
    date: str
    value: float | None


class FeatureValue(_Model):
    name: str
    value: float
    z_score: float
    history: list[SeriesPoint]


class ForecastRow(_Model):
    horizon: int
    probabilities: Probabilities


class RegimeLatest(_Model):
    date: str
    smoothed_label: str
    raw_label: str
    previous_label: str | None
    changed_today: bool
    days_in_regime: int
    probabilities: Probabilities
    features: list[FeatureValue]
    vix: float
    vvix: float
    forecast: list[ForecastRow]
    expected_remaining_duration: float
    expected_duration: dict[str, float]
    risk: RiskStats
    risk_period: dict[str, str]
    trained_at: str | None = None


class HistoryRow(_Model):
    date: str
    probabilities: Probabilities
    raw_label: str
    smoothed_label: str
    baseline_label: str
    in_sample: bool
    fold_id: str
    vix: float
    contango: float
    uvxy_close: float | None


class RegimeHistory(_Model):
    start: str | None
    end: str | None
    names: list[str]
    rows: list[HistoryRow]


class DurationHistogram(_Model):
    bins: list[str]
    counts: list[int]


class DurationStats(_Model):
    spells: int
    mean: float | None = None
    median: float | None = None
    max: int | None = None
    share_le_10d: float | None = None
    histogram: DurationHistogram | None = None


class RestartScore(_Model):
    seed: int
    log_likelihood: float | None
    converged: bool


class EpisodeSource(_Model):
    days: int
    share_flagged: float | None
    share_panic: float | None
    passed: bool


class Episode(_Model):
    name: str
    start: str
    end: str
    in_sample: bool
    hmm: EpisodeSource
    baseline: EpisodeSource


class ComparisonRow(_Model):
    check: str
    hmm: float | None
    baseline: float | None
    better: str | None


class SpikeStats(_Model):
    spike_days: int
    spike_events: int
    hit_rate: float | None
    event_hit_rate: float | None
    false_alarm_rate: float | None
    precision: float | None
    median_days_flagged_before_event: float | None


class Validation(_Model):
    oos_start: str | None
    oos_end: str | None
    oos_days: int
    known_episodes: list[Episode]
    calm_share_year: dict[str, float | int | None]
    stability: dict[str, float]
    spike_lead_time: dict[str, SpikeStats | float | int]
    label_share: dict[str, Probabilities]
    summary: list[ComparisonRow]


class VixParams(_Model):
    n: int
    kappa: float | None = None
    theta: float | None = None
    sigma: float | None = None
    half_life_days: float | None = None
    mean_daily_log_change: float | None = None
    std_daily_log_change: float | None = None


class RegimeVixParams(_Model):
    model: str
    source: str
    all_days: VixParams
    by_regime: dict[str, VixParams]
    current_regime: str | None = None


class RegimeDiagnostics(_Model):
    names: list[str]
    features: list[str]
    transition_matrix: list[list[float]]
    empirical_transition: dict[str, Probabilities]
    state_means: dict[str, dict[str, float]]
    state_stds: dict[str, dict[str, float]]
    expected_duration: dict[str, float]
    durations: dict[str, dict[str, DurationStats]]
    risk_stats: dict[str, dict[str, RiskStats]]
    risk_period: dict[str, str]
    validation: Validation
    restarts: list[RestartScore]
    live_log_likelihood: float
    vix_params: RegimeVixParams


class HindsightRow(_Model):
    date: str
    filtered: Probabilities
    smoothed: Probabilities


class RegimeHindsight(_Model):
    note: str
    rows: list[HindsightRow]


class FoldInfo(_Model):
    fold_id: str
    train_start: str
    train_end: str
    test_start: str | None = None
    test_end: str | None = None
    n_train: int
    log_likelihood: float
    runtime_s: float | None = None
    state_mapping: dict[str, str]
    features: list[str]
    label_contango: dict[str, float]
    transmat: list[list[float]] | None = None
