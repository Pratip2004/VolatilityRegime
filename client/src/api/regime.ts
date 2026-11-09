import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  FoldInfo,
  RegimeDiagnostics,
  RegimeHindsight,
  RegimeHistory,
  RegimeInsights,
  RegimeLatest,
  RegimeVixParams,
  TrainStatus,
  TrainSummary,
} from '../types/regime'
import { apiGet, apiPost, isNotTrained } from './client'

const BASE = '/api/regime'

export const regimeKeys = {
  all: ['regime'] as const,
  latest: () => [...regimeKeys.all, 'latest'] as const,
  status: () => [...regimeKeys.all, 'status'] as const,
  history: (start?: string, end?: string) => [...regimeKeys.all, 'history', start, end] as const,
  diagnostics: () => [...regimeKeys.all, 'diagnostics'] as const,
  hindsight: (start?: string) => [...regimeKeys.all, 'hindsight', start] as const,
  folds: () => [...regimeKeys.all, 'folds'] as const,
  insights: () => [...regimeKeys.all, 'insights'] as const,
  vixParams: () => [...regimeKeys.all, 'vix-params'] as const,
}

// Don't retry "not trained" (404); retry other failures once.
const retry = (count: number, err: unknown) => !isNotTrained(err) && count < 1

export function useRegimeLatest() {
  return useQuery({
    queryKey: regimeKeys.latest(),
    queryFn: () => apiGet<RegimeLatest>(`${BASE}/latest`),
    retry,
  })
}

export function useRegimeStatus() {
  const qc = useQueryClient()
  return useQuery({
    queryKey: regimeKeys.status(),
    queryFn: async () => {
      const prev = qc.getQueryData<TrainStatus>(regimeKeys.status())
      const next = await apiGet<TrainStatus>(`${BASE}/status`)
      // A run started elsewhere (CLI, another tab) just finished: refresh everything.
      if (prev?.training && !next.training) {
        void qc.invalidateQueries({
          queryKey: regimeKeys.all,
          predicate: (q) => q.queryKey[1] !== 'status',
        })
      }
      return next
    },
    // Poll while a training run is in progress anywhere.
    refetchInterval: (q) => (q.state.data?.training ? 5000 : false),
    retry,
  })
}

export function useRegimeHistory(start?: string, end?: string) {
  return useQuery({
    queryKey: regimeKeys.history(start, end),
    queryFn: () => apiGet<RegimeHistory>(`${BASE}/history`, { start, end }),
    placeholderData: keepPreviousData,
    retry,
  })
}

export function useRegimeDiagnostics() {
  return useQuery({
    queryKey: regimeKeys.diagnostics(),
    queryFn: () => apiGet<RegimeDiagnostics>(`${BASE}/diagnostics`),
    retry,
  })
}

export function useRegimeHindsight(start: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: regimeKeys.hindsight(start),
    queryFn: () => apiGet<RegimeHindsight>(`${BASE}/hindsight`, { start }),
    enabled,
    retry,
  })
}

export function useRegimeFolds() {
  return useQuery({
    queryKey: regimeKeys.folds(),
    queryFn: () => apiGet<FoldInfo[]>(`${BASE}/folds`),
    retry,
  })
}

export function useRegimeVixParams(enabled = true) {
  return useQuery({
    queryKey: regimeKeys.vixParams(),
    queryFn: () => apiGet<RegimeVixParams>(`${BASE}/vix-params`),
    enabled,
    retry,
  })
}

export function useTrainRegime() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => apiPost<TrainSummary>(`${BASE}/train`),
    onSettled: () => qc.invalidateQueries({ queryKey: regimeKeys.all }),
  })
}

export function useRegimeInsights() {
  return useQuery({
    queryKey: regimeKeys.insights(),
    queryFn: () => apiGet<RegimeInsights>(`${BASE}/insights`),
    retry,
  })
}
