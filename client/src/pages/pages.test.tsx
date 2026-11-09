import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { afterEach, vi } from 'vitest'
import { NOT_ADVICE, SIZE_NOT_DIRECTION } from '../lib/regime'
import { diagnostics, history, insights, latest } from '../test/fixtures'
import { mockFetch, renderWithProviders } from '../test/render'
import RegimeDiagnosticsPage from './RegimeDiagnosticsPage'
import RegimeHistoryPage from './RegimeHistoryPage'
import RegimeInsightsPage from './RegimeInsightsPage'
import RegimeTodayPage from './RegimeTodayPage'

const status = {
  trained: true,
  training: false,
  trained_at: '2026-11-09T10:18:54+00:00',
  data_end: '2026-11-06',
  runtime_s: 23,
}

const ok = {
  '/api/regime/latest': { body: latest },
  '/api/regime/status': { body: status },
  '/api/regime/insights': { body: insights },
  '/api/regime/history': { body: history },
  '/api/regime/diagnostics': { body: diagnostics },
}

afterEach(() => vi.unstubAllGlobals())

describe('Overview (RegimeTodayPage)', () => {
  it('explains today in plain English with the change alert', async () => {
    mockFetch(ok)
    const { container } = renderWithProviders(<RegimeTodayPage />)
    expect(await screen.findByTestId('changed-today')).toHaveTextContent('Stressed')
    const hero = screen.getByRole('heading', { level: 1 })
    expect(hero).toHaveTextContent('Panic')
    expect(hero).toHaveTextContent('day 1')
    const summary = screen.getByTestId('summary')
    expect(summary).toHaveTextContent('95%')
    expect(summary).toHaveTextContent('-6.0% and +4.0%') // p25/p75 of Panic fixture
    expect(summary).toHaveTextContent('about 1 in 50 days') // prob_up_20 = 0.02
    expect(summary).toHaveTextContent('92%') // continued_share
    expect(screen.getByTestId('size-not-direction')).toHaveTextContent(SIZE_NOT_DIRECTION)
    expect(screen.getByTestId('not-advice')).toHaveTextContent(NOT_ADVICE)
    expect(container.textContent).toContain('121.9') // VVIX in levels
    expect(screen.getByText('Tomorrow')).toBeInTheDocument()
    expect(screen.getByText('The three regimes at a glance')).toBeInTheDocument()
  })

  it('never implies direction or advice', async () => {
    mockFetch(ok)
    const { container } = renderWithProviders(<RegimeTodayPage />)
    await screen.findByTestId('summary')
    const text = container.textContent?.toLowerCase() ?? ''
    for (const word of ['buy', 'sell', 'go long', 'go short', 'will rise', 'will fall', 'you should']) {
      expect(text).not.toContain(word)
    }
  })

  it('shows the not-trained state with a retrain button', async () => {
    mockFetch({
      ...ok,
      '/api/regime/latest': { status: 404, body: { detail: 'missing' } },
      '/api/regime/insights': { status: 404, body: { detail: 'missing' } },
    })
    renderWithProviders(<RegimeTodayPage />)
    expect(await screen.findByTestId('page-not-trained')).toBeInTheDocument()
    expect(screen.getByTestId('retrain')).toBeInTheDocument()
  })

  it('shows an error with retry on server failure', async () => {
    mockFetch({ ...ok, '/api/regime/latest': { status: 500, body: { detail: 'boom' } } })
    renderWithProviders(<RegimeTodayPage />)
    expect(await screen.findByTestId('page-error', {}, { timeout: 4000 })).toHaveTextContent('boom')
  })

  it('posts to /train when Retrain is clicked', async () => {
    const fetchMock = mockFetch({ ...ok, '/api/regime/train': { body: { runtime_s: 20 } } })
    renderWithProviders(<RegimeTodayPage />)
    await screen.findByTestId('summary')
    await userEvent.click(screen.getByTestId('retrain'))
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([u, init]) => String(u) === '/api/regime/train' && init?.method === 'POST'),
      ).toBe(true),
    )
  })
})

function renderExplorer(url: string) {
  window.history.pushState({}, '', url)
  return renderWithProviders(
    <Routes>
      <Route path="/explorer" element={<RegimeHistoryPage />} />
    </Routes>,
    url,
  )
}

describe('Explorer (RegimeHistoryPage)', () => {
  it('filters by regime tags and date range from the URL and shows the table', async () => {
    mockFetch(ok)
    renderExplorer('/explorer?start=2013-12-01&end=2014-01-31&view=table&regimes=Calm')
    const summary = await screen.findByTestId('range-summary')
    expect(summary).toHaveTextContent('4 trading days from')
    expect(summary).toHaveTextContent('showing 3')
    const table = screen.getByRole('table')
    expect(within(table).getAllByTestId('regime-tag-Calm')).toHaveLength(3)
    expect(within(table).queryByTestId('regime-tag-Panic')).toBeNull()
    expect(screen.getByTestId('filter-Calm')).toHaveTextContent('3')
    expect(screen.getByTestId('filter-Panic')).toHaveTextContent('1')
  })

  it('opens day details from the URL', async () => {
    mockFetch(ok)
    renderExplorer('/explorer?start=2013-12-01&end=2014-01-31&day=2014-01-03')
    expect(await screen.findByText('Friday 3 January 2014')).toBeInTheDocument()
    expect(screen.getByText('what actually happened')).toBeInTheDocument()
  })

  it('renders the calendar by default and an empty message for an empty range', async () => {
    mockFetch(ok)
    renderExplorer('/explorer?start=2013-12-01&end=2014-01-31')
    expect(await screen.findByRole('img', { name: /2014: regime by trading day/ })).toBeInTheDocument()
  })
})

describe('Insights', () => {
  it('compares the regimes and drills into one', async () => {
    mockFetch(ok)
    renderWithProviders(<RegimeInsightsPage />)
    expect(await screen.findByTestId('profile-Calm')).toBeInTheDocument()
    expect(screen.getByTestId('profile-Panic')).toHaveTextContent('today')
    // Deep dive defaults to today's regime.
    expect(screen.getByText('Past Panic episodes')).toBeInTheDocument()
    expect(screen.getByText('82.7')).toBeInTheDocument()
    await userEvent.click(screen.getByText('Deep dive into Calm'))
    expect(await screen.findByText('Past Calm episodes')).toBeInTheDocument()
    expect(screen.getByText('Time spent in each regime, by year')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^2020: .*Panic 60%/ })).toBeInTheDocument()
  })
})

describe('Model details (RegimeDiagnosticsPage)', () => {
  it('renders matrix, verdict, episodes, baseline ribbons and hindsight panel', async () => {
    mockFetch(ok)
    renderWithProviders(<RegimeDiagnosticsPage />)
    expect(await screen.findByText('Transition matrix (live model, daily)')).toBeInTheDocument()
    expect(screen.getByText(/HMM is not clearly better than the baseline/)).toBeInTheDocument()
    expect(screen.getByText('Neither (both fail)')).toBeInTheDocument()
    expect(await screen.findByText('HMM vs baseline labels, day by day')).toBeInTheDocument()
    expect(screen.getByText(/not usable for trading/)).toBeInTheDocument()
  })

  it('shows not-trained state on 404', async () => {
    mockFetch({ '/api/regime/diagnostics': { status: 404, body: { detail: 'missing' } } })
    renderWithProviders(<RegimeDiagnosticsPage />)
    expect(await screen.findByTestId('page-not-trained')).toBeInTheDocument()
  })
})
