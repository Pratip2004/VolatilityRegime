export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
    this.name = 'ApiError'
  }
}

async function detail(res: Response): Promise<string> {
  try {
    const body = await res.json()
    if (typeof body?.detail === 'string') return body.detail
    return JSON.stringify(body?.detail ?? body)
  } catch {
    return res.statusText || `HTTP ${res.status}`
  }
}

export async function apiGet<T>(path: string, params?: Record<string, string | undefined>) {
  const qs = new URLSearchParams()
  Object.entries(params ?? {}).forEach(([k, v]) => {
    if (v !== undefined && v !== '') qs.set(k, v)
  })
  const url = qs.toString() ? `${path}?${qs}` : path
  const res = await fetch(url)
  if (!res.ok) throw new ApiError(res.status, await detail(res))
  return (await res.json()) as T
}

export async function apiPost<T>(path: string, body?: unknown) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) throw new ApiError(res.status, await detail(res))
  return (await res.json()) as T
}

/** 404 from a regime endpoint means "model not trained yet" — an empty state, not an error. */
export function isNotTrained(err: unknown): boolean {
  return err instanceof ApiError && err.status === 404
}
