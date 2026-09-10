import { createContext, useContext } from 'react'

export interface Session {
  owner: boolean
}

export const SessionContext = createContext<Session>({ owner: false })

export function useSession(): Session {
  return useContext(SessionContext)
}
