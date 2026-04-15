// @ts-nocheck
import { useEffect, useState } from 'react'

export function usePersistedTripState(key, initialValue) {
  const [state, setState] = useState(() => {
    if (typeof window === 'undefined') return initialValue

    try {
      const raw = window.localStorage.getItem(key)
      if (raw == null) return initialValue
      return JSON.parse(raw)
    } catch {
      return initialValue
    }
  })

  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(state))
    } catch {
      // Ignore persistence errors so the app still works in restricted environments.
    }
  }, [key, state])

  return [state, setState]
}
