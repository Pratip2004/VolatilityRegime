import type {
  RegimeDiagnostics,
  RegimeHistory,
  RegimeInsights,
  RegimeLatest,
  RegimeProfile,
  RiskStats,
} from '../types/regime'

const risk = (scale: number): RiskStats => ({
  count: 500,
  mean: -0.003 * scale,
  median: -0.008,
  std: 0.05 * scale,
  p1: -0.12 * scale,
  p5: -0.07 * scale,
  p25: -0.03 * scale,
  p75: 0.02 * scale,
  p95: 0.09 * scale,
  p99: 0.2 * scale,
  prob_up_10: 0.03 * scale,
  prob_up_20: 0.01 * scale,
  prob_up_30: 0.004 * scale,
  next_regime_prob: { Calm: 0.95, Stressed: 0.03, Panic: 0.02 },
})

const hist = (days: number, base: number) =>
  Array.from({ length: days }, (_, i) => ({
    date: `2026-09-${String(i + 1).padStart(2, '0')}`,
    value: base + i * 0.001,
  }))

export const latest: RegimeLatest = {
  date: '2026-11-06',
  smoothed_label: 'Panic',
  raw_label: 'Panic',
  previous_label: 'Stressed',
  changed_today: true,
  days_in_regime: 1,
  probabilities: { Calm: 0.01, Stressed: 0.04, Panic: 0.95 },
  features: [
    { name: 'contango', value: -0.0638, z_score: -1.82, history: hist(20, -0.05) },
    { name: 'vix_ratio', value: 1.042, z_score: 1.7, history: hist(20, 1.0) },
    { name: 'log_vvix', value: Math.log(121.9), z_score: 1.66, history: hist(20, 4.7) },
    { name: 'rv20', value: 0.2, z_score: 0.33, history: hist(20, 0.18) },
    { name: 'vix_pct_252', value: 0.95, z_score: 1.58, history: hist(20, 0.9) },
    { name: 'd_contango_5', value: -0.036, z_score: -0.77, history: hist(20, -0.02) },
  ],
  vix: 25.64,
  vvix: 121.94,
  forecast: [1, 5, 20].map((h) => ({
    horizon: h,
    probabilities: { Calm: 0.01 * h, Stressed: 0.02 * h, Panic: 1 - 0.03 * h },
  })),
  expected_remaining_duration: 40.4,
  expected_duration: { Calm: 42.3, Stressed: 43.5, Panic: 40.4 },
  risk: risk(2),
  risk_period: { start: '2014-01-02', end: '2026-11-06' },
  trained_at: '2026-11-09T10:18:54+00:00',
}

export const history: RegimeHistory = {
  start: null,
  end: null,
  names: ['Calm', 'Stressed', 'Panic'],
  rows: ['2013-12-30', '2013-12-31', '2014-01-02', '2014-01-03'].map((date, i) => ({
    date,
    probabilities: { Calm: 0.7, Stressed: 0.2, Panic: 0.1 },
    raw_label: i < 3 ? 'Calm' : 'Panic',
    smoothed_label: i < 3 ? 'Calm' : 'Panic',
    baseline_label: 'Stressed',
    in_sample: i < 2,
    fold_id: i < 2 ? '2013-12-31' : '2013-12-31',
    vix: 14 + i,
    contango: 0.05,
    uvxy_close: i === 0 ? null : 1000 + i,
    days_in_regime: i < 3 ? i + 1 : 1,
    uvxy_next_ret: i < 3 ? 0.01 * i : null,
  })),
}

const dur = {
  spells: 10,
  mean: 20,
  median: 12,
  max: 80,
  share_le_10d: 0.4,
  histogram: { bins: ['1', '2', '3-5', '6+'], counts: [1, 2, 3, 4] },
}

const ep = (passed: boolean) => ({ days: 20, share_flagged: passed ? 1 : 0.2, share_panic: 0.5, passed })
const spike = {
  spike_days: 273,
  spike_events: 96,
  hit_rate: 0.61,
  event_hit_rate: 0.63,
  false_alarm_rate: 0.58,
  precision: 0.088,
  median_days_flagged_before_event: 8.5,
}

export const diagnostics: RegimeDiagnostics = {
  names: ['Calm', 'Stressed', 'Panic'],
  features: ['contango', 'vix_ratio'],
  transition_matrix: [
    [0.97, 0.02, 0.01],
    [0.01, 0.98, 0.01],
    [0.01, 0.01, 0.98],
  ],
  empirical_transition: {},
  state_means: {
    Calm: { contango: 0.097, vix_ratio: 0.87 },
    Stressed: { contango: 0.069, vix_ratio: 0.88 },
    Panic: { contango: -0.011, vix_ratio: 0.98 },
  },
  state_stds: {},
  expected_duration: { Calm: 42, Stressed: 43, Panic: 40 },
  durations: {
    hmm: { Calm: dur, Stressed: dur, Panic: dur },
    baseline: { Calm: dur, Stressed: dur, Panic: dur },
  },
  risk_stats: {
    hmm: { Calm: risk(1), Stressed: risk(1.3), Panic: risk(2) },
    baseline: { Calm: risk(1), Stressed: risk(1.5), Panic: risk(2.2) },
  },
  risk_period: { start: '2014-01-02', end: '2026-11-06' },
  validation: {
    oos_start: '2014-01-02',
    oos_end: '2026-11-06',
    oos_days: 3232,
    known_episodes: [
      { name: 'Financial crisis', start: '2008-09-15', end: '2008-12-31', in_sample: true, hmm: ep(true), baseline: ep(true) },
      { name: 'COVID', start: '2020-02-24', end: '2020-04-30', in_sample: false, hmm: ep(true), baseline: ep(false) },
    ],
    calm_share_year: { year: 2017, hmm: 0.93, baseline: 0.84 },
    stability: { hmm_raw_flips_per_year: 12.3, hmm_smoothed_flips_per_year: 11.8, baseline_flips_per_year: 36.9 },
    spike_lead_time: { threshold: 0.3, window: 5, hmm: spike, baseline: spike },
    label_share: {},
    summary: [
      { check: 'Spike hit rate (days)', hmm: 0.61, baseline: 0.41, better: 'hmm' },
      { check: 'Spike false-alarm rate', hmm: 0.58, baseline: 0.42, better: 'baseline' },
      { check: 'Flips per year (smoothed)', hmm: 11.8, baseline: 36.9, better: 'hmm' },
      { check: 'Panic minus Calm next-day mean (expected > 0)', hmm: -0.0009, baseline: -0.0022, better: 'neither' },
    ],
  },
  restarts: [
    { seed: 0, log_likelihood: -24959.5, converged: true },
    { seed: 1, log_likelihood: -25216.6, converged: true },
  ],
  live_log_likelihood: -24959.5,
  vix_params: {
    model: 'log-OU',
    source: 'out-of-sample smoothed HMM labels',
    all_days: { n: 3000, kappa: 5, theta: 18, sigma: 1, half_life_days: 30, mean_daily_log_change: 0, std_daily_log_change: 0.07 },
    by_regime: {
      Calm: { n: 1300, kappa: 6, theta: 14, sigma: 0.8, half_life_days: 25, mean_daily_log_change: 0, std_daily_log_change: 0.05 },
      Stressed: { n: 900, kappa: 6, theta: 18, sigma: 1, half_life_days: 25, mean_daily_log_change: 0, std_daily_log_change: 0.07 },
      Panic: { n: 900, kappa: 8, theta: 25, sigma: 1.3, half_life_days: 20, mean_daily_log_change: 0, std_daily_log_change: 0.09 },
    },
    current_regime: 'Panic',
  },
}

const profile = (scale: number, median: number): RegimeProfile => ({
  share_of_days: 0.3,
  days: 900,
  spells: 40,
  spell_median: median,
  spell_mean: median * 1.5,
  spell_p75: median * 2,
  spell_p90: median * 4,
  spell_max: median * 9,
  spell_lengths: [1, 2, 5, median, median * 2, median * 4],
  exit_to: { Calm: 0.44, Stressed: 0.56 },
  vix_median: 14 * scale,
  vix_p10: 11 * scale,
  vix_p90: 21 * scale,
  contango_median: 0.05,
  risk: risk(scale),
})

export const insights: RegimeInsights = {
  names: ['Calm', 'Stressed', 'Panic'],
  as_of: '2026-11-06',
  oos_start: '2014-01-02',
  profiles: {
    Calm: { ...profile(1, 14), exit_to: { Stressed: 0.65, Panic: 0.35 } },
    Stressed: { ...profile(1.3, 12), exit_to: { Calm: 0.63, Panic: 0.37 } },
    Panic: profile(2, 12),
  },
  current: {
    regime: 'Panic',
    start: '2026-11-05',
    end: '2026-11-06',
    days: 2,
    ongoing: true,
    in_sample: false,
    previous_regime: 'Stressed',
    next_regime: null,
    vix_start: 28.2,
    vix_peak: 28.2,
    vix_end: 25.6,
    uvxy_change: 0.42,
    spx_change: -0.04,
    longer_than_share: 0,
    continued_share: 0.92,
  },
  episodes: [
    {
      regime: 'Panic',
      start: '2020-02-24',
      end: '2020-07-28',
      days: 109,
      ongoing: false,
      in_sample: false,
      previous_regime: 'Stressed',
      next_regime: 'Stressed',
      vix_start: 25,
      vix_peak: 82.69,
      vix_end: 25,
      uvxy_change: 1.09,
      spx_change: -0.05,
    },
    {
      regime: 'Calm',
      start: '2017-01-03',
      end: '2017-06-30',
      days: 124,
      ongoing: false,
      in_sample: false,
      previous_regime: 'Stressed',
      next_regime: 'Stressed',
      vix_start: 12,
      vix_peak: 14,
      vix_end: 11,
      uvxy_change: -0.6,
      spx_change: 0.08,
    },
  ],
  yearly: [
    { year: 2013, days: 252, in_sample: true, shares: { Calm: 0.5, Stressed: 0.3, Panic: 0.2 } },
    { year: 2020, days: 253, in_sample: false, shares: { Calm: 0.2, Stressed: 0.2, Panic: 0.6 } },
  ],
}
