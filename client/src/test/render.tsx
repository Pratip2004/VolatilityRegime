import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import type { ReactElement } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'

export function renderWithProviders(ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  )
}

type Route = { status?: number; body: unknown } | ((url: string) => { status?: number; body: unknown })

/** Mock fetch by URL path prefix. */
export function mockFetch(routes: Record<string, Route>) {
  const fn = vi.fn(async (...args: [input: RequestInfo | URL, init?: RequestInit]) => {
    const url = String(args[0])
    const key = Object.keys(routes)
      .sort((a, b) => b.length - a.length)
      .find((k) => url.startsWith(k))
    if (!key) return new Response(JSON.stringify({ detail: 'not mocked' }), { status: 500 })
    const r = routes[key]
    const { status = 200, body } = typeof r === 'function' ? r(url) : r
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  })
  vi.stubGlobal('fetch', fn)
  return fn
}
