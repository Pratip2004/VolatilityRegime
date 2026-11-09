import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, vi } from 'vitest'
import { NOT_ADVICE, SIZE_NOT_DIRECTION } from '../lib/regime'
import { diagnostics, history, latest } from '../test/fixtures'
import { mockFetch, renderWithProviders } from '../test/render'
import RegimeDiagnosticsPage from './RegimeDiagnosticsPage'
import RegimeHistoryPage from './RegimeHistoryPage'
import RegimeTodayPage from './RegimeTodayPage'

const status = {
  trained: true,
  training: false,
  trained_at: '2026-11-09T10:18:54+00:00',
  data_end: '2026-11-06',
  runtime_s: 118,
}

afterEach(() => vi.unstubAllGlobals())

describe('RegimeTodayPage', () => {
  it('shows the regime, probabilities, risk card wording and change alert', async () => {
    mockFetch({ '/api/regime/latest': { body: latest }, '/api/regime/status': { body: status } })
    const { container } = renderWithProviders(<RegimeTodayPage />)
    expect(await screen.findByTestId('changed-today')).toHaveTextContent('Stressed → Panic')
    expect(screen.getAllByTestId('regime-tag-Panic').length).toBeGreaterThan(0)
    expect(screen.getByTestId('size-not-direction')).toHaveTextContent(SIZE_NOT_DIRECTION)
    expect(screen.getByTestId('not-advice')).toHaveTextContent(NOT_ADVICE)
    expect(screen.getByText('95.0%')).toBeInTheDocument()
    expect(container.textContent).toContain('121.9') // VVIX in levels, not ln(VVIX)
    expect(container.textContent).toContain('-6.38%') // contango
    expect(screen.getByText('20 trading days')).toBeInTheDocument()
    expect(screen.getByText(/Last trained/)).toBeInTheDocument()
  })

  it('never implies direction', async () => {
    mockFetch({ '/api/regime/latest': { body: latest }, '/api/regime/status': { body: status } })
    const { container } = renderWithProviders(<RegimeTodayPage />)
    await screen.findByTestId('size-not-direction')
    const text = container.textContent?.toLowerCase() ?? ''
    for (const word of ['buy', 'sell', 'go long', 'go short', 'will rise', 'will fall']) {
      expect(text).not.toContain(word)
    }
  })

  it('shows an empty state with a retrain button when the model is not trained', async () => {
    mockFetch({
      '/api/regime/latest': { status: 404, body: { detail: 'live model missing' } },
      '/api/regime/status': { body: { ...status, trained: false, trained_at: null } },
    })
    renderWithProviders(<RegimeTodayPage />)
    expect(await screen.findByTestId('page-not-trained')).toBeInTheDocument()
    expect(screen.getByTestId('retrain')).toBeInTheDocument()
  })

  it('shows an error with retry on server failure', async () => {
    mockFetch({
      '/api/regime/latest': { status: 500, body: { detail: 'boom' } },
      '/api/regime/status': { body: status },
    })
    renderWithProviders(<RegimeTodayPage />)
    // The hook retries non-404 errors once before surfacing them.
    expect(await screen.findByTestId('page-error', {}, { timeout: 4000 })).toHaveTextContent('boom')
  })

  it('posts to /train when Retrain is clicked', async () => {
    const fetchMock = mockFetch({
      '/api/regime/latest': { body: latest },
      '/api/regime/status': { body: status },
      '/api/regime/train': { body: { runtime_s: 100 } },
    })
    renderWithProviders(<RegimeTodayPage />)
    await screen.findByTestId('size-not-direction')
    await userEvent.click(screen.getByTestId('retrain'))
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([u, init]) => String(u) === '/api/regime/train' && init?.method === 'POST',
        ),
      ).toBe(true),
    )
  })
})

describe('RegimeHistoryPage', () => {
  it('requests a date range and renders the charts and in-sample note', async () => {
    const fetchMock = mockFetch({ '/api/regime/history': { body: history } })
    renderWithProviders(<RegimeHistoryPage />)
    expect(await screen.findByText(/VIX with HMM regime bands/)).toBeInTheDocument()
    expect(screen.getByText(/Dates before 2014-01-02 are in-sample/)).toBeInTheDocument()
    expect(screen.getByText(/UVXY launched on 2011-10-04/)).toBeInTheDocument()
    const url = String(fetchMock.mock.calls[0][0])
    expect(url).toMatch(/start=\d{4}-\d{2}-\d{2}&end=\d{4}-\d{2}-\d{2}/)
    await userEvent.click(screen.getByText('Baseline rules'))
    expect(await screen.findByText(/VIX with baseline regime bands/)).toBeInTheDocument()
  })

  it('shows empty state for an empty range', async () => {
    mockFetch({ '/api/regime/history': { body: { ...history, rows: [] } } })
    renderWithProviders(<RegimeHistoryPage />)
    expect(await screen.findByText('No data for this selection.')).toBeInTheDocument()
  })
})

describe('RegimeDiagnosticsPage', () => {
  it('renders matrix, comparison verdict, episodes and hindsight panel', async () => {
    mockFetch({ '/api/regime/diagnostics': { body: diagnostics } })
    renderWithProviders(<RegimeDiagnosticsPage />)
    expect(await screen.findByText('Transition matrix (live model, daily)')).toBeInTheDocument()
    expect(screen.getAllByText('97.0%').length).toBeGreaterThan(0)
    expect(screen.getByText(/HMM is not clearly better than the baseline/)).toBeInTheDocument()
    expect(screen.getByText('Neither (both fail)')).toBeInTheDocument()
    expect(screen.getByText('Financial crisis')).toBeInTheDocument()
    expect(screen.getByText('in-sample')).toBeInTheDocument()
    expect(screen.getAllByText('attention').length).toBe(1)
    expect(screen.getByText(/not usable for trading/)).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /return distribution/ })).toBeInTheDocument()
  })

  it('shows not-trained state on 404', async () => {
    mockFetch({ '/api/regime/diagnostics': { status: 404, body: { detail: 'missing' } } })
    renderWithProviders(<RegimeDiagnosticsPage />)
    expect(await screen.findByTestId('page-not-trained')).toBeInTheDocument()
  })
})

describe('R5 review regressions', () => {
  it('shows an empty UVXY panel for ranges before UVXY existed', async () => {
    const rows = history.rows.map((r) => ({ ...r, uvxy_close: null }))
    mockFetch({ '/api/regime/history': { body: { ...history, rows } } })
    renderWithProviders(<RegimeHistoryPage />)
    expect(await screen.findByText(/No UVXY prices in this range/)).toBeInTheDocument()
  })

  it('renders two-state models without assuming Stressed', async () => {
    const two = {
      ...latest,
      smoothed_label: 'Calm' as const,
      raw_label: 'Calm' as const,
      changed_today: false,
      probabilities: { Calm: 0.8, Panic: 0.2 },
      forecast: [{ horizon: 1, probabilities: { Calm: 0.8, Panic: 0.2 } }],
    }
    mockFetch({ '/api/regime/latest': { body: two }, '/api/regime/status': { body: status } })
    renderWithProviders(<RegimeTodayPage />)
    await screen.findByTestId('size-not-direction')
    expect(screen.queryByLabelText('Stressed probability')).toBeNull()
    expect(screen.getByLabelText('Panic probability')).toBeInTheDocument()
  })

  it('shows progress when training runs elsewhere', async () => {
    mockFetch({
      '/api/regime/latest': { body: latest },
      '/api/regime/status': { body: { ...status, training: true } },
    })
    renderWithProviders(<RegimeTodayPage />)
    expect(await screen.findByText(/Training in progress elsewhere/)).toBeInTheDocument()
  })

  it('does not call the 99th percentile a "bad case"', async () => {
    mockFetch({ '/api/regime/latest': { body: latest }, '/api/regime/status': { body: status } })
    const { container } = renderWithProviders(<RegimeTodayPage />)
    await screen.findByTestId('size-not-direction')
    expect(container.textContent).not.toMatch(/bad case/i)
    expect(container.textContent).toContain('Tail move (99th pct)')
  })
})
