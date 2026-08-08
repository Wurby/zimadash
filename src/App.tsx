import { Route, Routes } from 'react-router'
import { Home } from './routes/Home'
import { NotFound } from './routes/NotFound'
import { ToolShell } from './routes/ToolShell'

/**
 * Every tool gets its own URL, and nothing sits above them.
 *
 * There is deliberately no chrome here. The controls that used to ride along in
 * a sticky header — the theme toggle, the one-tap actions, the system readout —
 * are items on the dashboard grid now, which is where they can be arranged.
 * Opening a tool should feel like opening an app: the tool fills the screen and
 * owns its own way back.
 */
function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path=":slug/*" element={<ToolShell />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}

export default App
