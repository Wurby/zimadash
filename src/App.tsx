import { Route, Routes } from 'react-router'
import { Header } from './components/Header'
import { Home } from './routes/Home'
import { NotFound } from './routes/NotFound'
import { ToolShell } from './routes/ToolShell'

/**
 * Every tool gets its own URL. The route table is derived from the registry
 * rather than written out — `:slug/*` hands the whole subtree to the tool, so a
 * tool can grow sub-routes without anything here changing.
 */
function App() {
  return (
    <>
      <Header />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path=":slug/*" element={<ToolShell />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </>
  )
}

export default App
