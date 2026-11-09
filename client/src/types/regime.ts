// Mirrors backend/app/api/schemas/regime.py — keep in sync.

export type RegimeName = 'Calm' | 'Stressed' | 'Panic'
export type Probabilities = Record<string, number>

export interface FoldSummary {
  fold_id: string
  train_start: string
  train_end: string
  test_start: string | null
  test_end: string | null
  n_train: number
  log_likelihood: number
  runtime_s: number | null
}

export interface TrainSummary {
  trained_at: string
  runtime_s: number
  n_folds: number
  refit_freq: string
  features: string[]
  data_start: string
  data_end: string
  folds: FoldSummary[]
  live: { train_end: string; log_likelihood: number; runtime_s: number }
}

export interface TrainStatus {
  trained: boolean
  training: boolean
  trained_at: string | null
  data_end: string | null
  runtime_s: number | null
}

export interface RiskStats {
  count: number
  mean: number | null
  median: number | null
  std: number | null
  p1: number | null
  p5: number | null
  p25: number | null
  p75: number | null
  p95: number | null
  p99: number | null
  prob_up_10: number | null
  prob_up_20: number | null
  prob_up_30: number | null
  prob_down_10?: number | null
  prob_down_20?: number | null
  prob_down_30?: number | null
  next_regime_prob: Probabilities
}

export interface SeriesPoint {
  date: string
  value: number | null
}

export interface FeatureValue {
  name: string
  value: number
  z_score: number
  history: SeriesPoint[]
}

export interface ForecastRow {
  horizon: number
  probabilities: Probabilities
}

export interface RegimeLatest {
  date: string
  smoothed_label: RegimeName
  raw_label: RegimeName
  previous_label: RegimeName | null
  changed_today: boolean
  days_in_regime: number
  probabilities: Probabilities
  features: FeatureValue[]
  vix: number
  vvix: number
  forecast: ForecastRow[]
  expected_remaining_duration: number
  expected_duration: Record<string, number>
  risk: RiskStats
  risk_period: Record<string, string>
  trained_at: string | null
}

export interface HistoryRow {
  date: string
  probabilities: Probabilities
  raw_label: RegimeName
  smoothed_label: RegimeName
  baseline_label: RegimeName
  in_sample: boolean
  fold_id: string
  vix: number
  contango: number
  uvxy_close: number | null
  days_in_regime: number
  uvxy_next_ret: number | null
}

export interface RegimeHistory {
  start: string | null
  end: string | null
  names: RegimeName[]
  rows: HistoryRow[]
}

export interface DurationStats {
  spells: number
  mean?: number | null
  median?: number | null
  max?: number | null
  share_le_10d?: number | null
  histogram?: { bins: string[]; counts: number[] } | null
}

export interface RestartScore {
  seed: number
  log_likelihood: number | null
  converged: boolean
}

export interface EpisodeSource {
  days: number
  share_flagged: number | null
  share_panic: number | null
  passed: boolean
}

export interface Episode {
  name: string
  start: string
  end: string
  in_sample: boolean
  hmm: EpisodeSource
  baseline: EpisodeSource
}

export interface ComparisonRow {
  check: string
  hmm: number | null
  baseline: number | null
  better: 'hmm' | 'baseline' | 'tie' | 'neither' | null
}

export interface SpikeStats {
  spike_days: number
  spike_events: number
  hit_rate: number | null
  event_hit_rate: number | null
  false_alarm_rate: number | null
  precision: number | null
  median_days_flagged_before_event: number | null
}

export interface Validation {
  oos_start: string | null
  oos_end: string | null
  oos_days: number
  known_episodes: Episode[]
  calm_share_year: Record<string, number | null>
  stability: Record<string, number>
  spike_lead_time: Record<string, SpikeStats | number>
  label_share: Record<string, Probabilities>
  summary: ComparisonRow[]
}

export interface VixParams {
  n: number
  kappa: number | null
  theta: number | null
  sigma: number | null
  lam?: number | null
  mu_j?: number | null
  sigma_j?: number | null
  jumps?: number | null
  half_life_days: number | null
  mean_daily_log_change: number | null
  std_daily_log_change: number | null
}

export interface RegimeVixParams {
  model: string
  source: string
  all_days: VixParams
  by_regime: Record<string, VixParams>
  current_regime: string | null
  as_of?: string | null
  /** Drop-in fields for the Monte Carlo simulator's POST /api/simulate. */
  simulator?: { model: string; overrides: Record<string, number> } | null
}

export interface RegimeDiagnostics {
  names: RegimeName[]
  features: string[]
  transition_matrix: number[][]
  empirical_transition: Record<string, Probabilities>
  state_means: Record<string, Record<string, number>>
  state_stds: Record<string, Record<string, number>>
  expected_duration: Record<string, number>
  durations: Record<string, Record<string, DurationStats>>
  risk_stats: Record<string, Record<string, RiskStats>>
  risk_period: Record<string, string>
  validation: Validation
  restarts: RestartScore[]
  live_log_likelihood: number
  vix_params: RegimeVixParams
}

export interface HindsightRow {
  date: string
  filtered: Probabilities
  smoothed: Probabilities
}

export interface RegimeHindsight {
  note: string
  rows: HindsightRow[]
}

export interface FoldInfo extends FoldSummary {
  state_mapping: Record<string, string>
  features: string[]
  label_contango: Record<string, number>
  transmat: number[][] | null
}

export interface RegimeEpisode {
  regime: RegimeName
  start: string
  end: string
  days: number
  ongoing: boolean
  in_sample: boolean
  previous_regime: RegimeName | null
  next_regime: RegimeName | null
  vix_start: number | null
  vix_peak: number | null
  vix_end: number | null
  uvxy_change: number | null
  spx_change: number | null
}

export interface CurrentSpell extends RegimeEpisode {
  longer_than_share: number | null
  continued_share: number | null
}

export interface RegimeProfile {
  share_of_days: number
  days: number
  spells: number
  spell_median: number | null
  spell_mean: number | null
  spell_p75: number | null
  spell_p90: number | null
  spell_max: number | null
  spell_lengths: number[]
  exit_to: Probabilities
  vix_median: number | null
  vix_p10: number | null
  vix_p90: number | null
  contango_median: number | null
  risk: RiskStats
}

export interface YearShare {
  year: number
  days: number
  in_sample: boolean
  shares: Probabilities
}

export interface RegimeInsights {
  names: RegimeName[]
  as_of: string
  oos_start: string | null
  profiles: Record<string, RegimeProfile>
  current: CurrentSpell
  episodes: RegimeEpisode[]
  yearly: YearShare[]
}
