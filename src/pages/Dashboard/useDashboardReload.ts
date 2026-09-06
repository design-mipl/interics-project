import { useEffect, useRef, type DependencyList } from 'react'

type DashboardLoader = (isActive: () => boolean) => void | Promise<void>

/**
 * Loads dashboard data on mount and again when the window/tab becomes active.
 * Only the latest in-flight request may commit; stale responses are ignored.
 */
export function useDashboardReload(load: DashboardLoader, deps: DependencyList): void {
  const loadRef = useRef(load)
  loadRef.current = load

  useEffect(() => {
    let isMounted = true
    let requestId = 0
    let focusTimer: ReturnType<typeof setTimeout> | null = null

    const run = () => {
      const currentId = ++requestId
      void loadRef.current(() => isMounted && currentId === requestId)
    }

    run()

    function handleFocus() {
      if (focusTimer) clearTimeout(focusTimer)
      // Debounce: MUI menus/selects blur+focus the window and would otherwise spam refetch.
      focusTimer = setTimeout(run, 300)
    }

    function handleVisibilityChange() {
      if (document.visibilityState === 'visible') {
        handleFocus()
      }
    }

    window.addEventListener('focus', handleFocus)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      isMounted = false
      if (focusTimer) clearTimeout(focusTimer)
      window.removeEventListener('focus', handleFocus)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- caller controls deps explicitly
  }, deps)
}
