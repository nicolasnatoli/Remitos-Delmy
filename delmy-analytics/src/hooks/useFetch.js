import { useState, useEffect, useCallback, useRef } from 'react'

export function useFetch(url, deps = []) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const abortRef = useRef(null)

  const load = useCallback(() => {
    if (!url) return
    if (abortRef.current) abortRef.current.abort()
    abortRef.current = new AbortController()
    setLoading(true)
    setError(null)
    fetch(url, { signal: abortRef.current.signal })
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then(d => { setData(d); setLoading(false) })
      .catch(e => { if (e.name !== 'AbortError') { setError(e.message); setLoading(false) } })
  }, [url])

  useEffect(() => { load() }, [load, ...deps])

  return { data, loading, error, reload: load }
}

export function buildQS(filters) {
  const p = new URLSearchParams()
  if (filters.desde) p.set('desde', filters.desde)
  if (filters.hasta) p.set('hasta', filters.hasta)
  if (filters.sucursal && filters.sucursal !== 'todas') p.set('sucursal', filters.sucursal)
  return p.toString() ? '?' + p.toString() : ''
}
