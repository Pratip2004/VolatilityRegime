import {
  REGIME_COLORS,
  featureDisplayValue,
  fmtCheck,
  formatFeature,
  labelSpans,
  mostSevere,
  orderedNames,
  niceTicks,
  pct,
  regimeColor,
  signedPct,
  verdict,
} from './regime'

describe('regime helpers', () => {
  it('uses the spec colours', () => {
    expect(REGIME_COLORS).toEqual({ Calm: '#22C55E', Stressed: '#F59E0B', Panic: '#EF4444' })
    expect(regimeColor('Unknown')).toBe('#8c8c8c')
  })

  it('formats percentages and handles missing values', () => {
    expect(pct(0.1234)).toBe('12.3%')
    expect(signedPct(0.05)).toBe('+5.0%')
    expect(signedPct(-0.05)).toBe('-5.0%')
    expect(pct(null)).toBe('—')
    expect(signedPct(Number.NaN)).toBe('—')
  })

  it('shows VVIX in levels and contango as a signed percent', () => {
    expect(featureDisplayValue('log_vvix', Math.log(100))).toBeCloseTo(100)
    expect(formatFeature('log_vvix', Math.log(121.9))).toBe('121.9')
    expect(formatFeature('contango', -0.0638)).toBe('-6.38%')
    expect(formatFeature('vix_ratio', 1.04228)).toBe('1.042')
  })

  it('builds contiguous label spans that tile without gaps', () => {
    const rows = [
      { d: '2024-01-01', l: 'Calm' },
      { d: '2024-01-02', l: 'Calm' },
      { d: '2024-01-03', l: 'Panic' },
      { d: '2024-01-04', l: 'Calm' },
    ]
    const spans = labelSpans(rows, (r) => r.d, (r) => r.l)
    expect(spans).toEqual([
      { label: 'Calm', start: '2024-01-01', end: '2024-01-03' },
      { label: 'Panic', start: '2024-01-03', end: '2024-01-04' },
      { label: 'Calm', start: '2024-01-04', end: '2024-01-04' },
    ])
    expect(labelSpans([], (r: { d: string }) => r.d, () => 'x')).toEqual([])
  })

  it('makes readable box-plot ticks including zero', () => {
    const t = niceTicks(-0.21, 0.3)
    expect(t).toContain(0)
    expect(t[0]).toBeGreaterThanOrEqual(-0.21)
    expect(t[t.length - 1]).toBeLessThanOrEqual(0.3)
  })

  it('formats comparison checks by kind', () => {
    expect(fmtCheck('OOS episodes: mean share flagged', 1)).toBe('100.0%')
    expect(fmtCheck('Calm next-day mean return', -0.0035)).toBe('-0.35%')
    expect(fmtCheck('Flips per year (smoothed)', 11.77)).toBe('11.8')
    expect(fmtCheck('Panic/Calm next-day std ratio', 1.78)).toBe('1.78×')
    expect(fmtCheck('x', null)).toBe('—')
  })

  it('only calls the HMM clearly better with >= 3/4 of decided checks', () => {
    const row = (better: 'hmm' | 'baseline' | 'tie') => ({ check: better, hmm: 1, baseline: 0, better })
    expect(verdict([row('hmm'), row('hmm'), row('hmm'), row('baseline'), row('tie')]).clearlyBetter).toBe(true)
    expect(verdict([row('hmm'), row('hmm'), row('baseline'), row('baseline')]).clearlyBetter).toBe(false)
    expect(verdict([row('tie')]).clearlyBetter).toBe(false)
  })

  it('orders regime names canonically and finds the most severe', () => {
    expect(orderedNames(['Panic', 'Calm', 'Stressed'])).toEqual(['Calm', 'Stressed', 'Panic'])
    expect(orderedNames(['Elevated', 'Panic', 'Calm'])).toEqual(['Calm', 'Panic', 'Elevated'])
    expect(mostSevere(['Calm', 'Panic'])).toBe('Panic')
    expect(mostSevere(['Calm', 'Stressed'])).toBe('Stressed')
  })
})
