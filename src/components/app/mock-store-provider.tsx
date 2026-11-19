"use client"

import { createContext, useContext, useEffect, useState } from "react"

import { MockStore, type MockState } from "@/lib/project-store"

type MockStoreContextValue = {
  store: MockStore
  state: MockState
  ready: boolean
}

const MockStoreContext = createContext<MockStoreContextValue | null>(null)

export function MockStoreProvider({
  projectId,
  children,
}: {
  projectId: string
  children: React.ReactNode
}) {
  const [store] = useState(() => new MockStore(projectId))
  const [state, setState] = useState(() => store.getState())
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const unsubscribe = store.subscribe(() => setState(store.getState()))
    setReady(true)
    return () => {
      unsubscribe()
    }
  }, [store])

  return (
    <MockStoreContext.Provider value={{ store, state, ready }}>
      {children}
    </MockStoreContext.Provider>
  )
}

export function useMockStore() {
  const context = useContext(MockStoreContext)
  if (!context) throw new Error("useMockStore must be used inside MockStoreProvider")
  return context
}
