#!/usr/bin/env node
/**
 * Start everything local dev needs: the API on :3107 and Vite on :5173.
 *
 * Vite proxies /api to the backend, so with only Vite running every API call
 * comes back 502 — which looks like an auth bug rather than a missing process.
 * One command avoids that.
 *
 * Hand-rolled rather than pulling in `concurrently`: it is a dozen lines of
 * spawn and teardown, and this stays a zero-dependency script.
 */

import { spawn } from 'node:child_process'

const DIM = '\x1b[2m'
const CYAN = '\x1b[36m'
const RED = '\x1b[31m'
const RESET = '\x1b[0m'

const children = []
let shuttingDown = false

/**
 * `detached` puts each child in its own process group so we can take down the
 * whole tree. `npm run` spawns a shell which spawns node — killing just the npm
 * process would leave Vite and tsx orphaned and still holding their ports.
 */
function start(name, args, { prefix }) {
  const child = spawn('npm', args, {
    detached: true,
    stdio: prefix ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  })

  if (prefix) {
    const label = `${CYAN}[${name}]${RESET} `
    for (const stream of [child.stdout, child.stderr]) {
      stream.setEncoding('utf8')
      let buffer = ''
      stream.on('data', (chunk) => {
        buffer += chunk
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) console.log(label + line)
      })
    }
  }

  child.on('exit', (code, signal) => {
    if (shuttingDown) return
    const how = signal ? `signal ${signal}` : `code ${code}`
    console.log(`\n${RED}${name} exited (${how}) — shutting down${RESET}`)
    shutdown(code ?? 1)
  })

  children.push({ name, child })
  return child
}

function shutdown(code) {
  if (shuttingDown) return
  shuttingDown = true

  for (const { child } of children) {
    if (child.exitCode !== null || child.signalCode !== null) continue
    try {
      // Negative pid targets the whole process group.
      process.kill(-child.pid, 'SIGTERM')
    } catch {
      /* already gone */
    }
  }

  // Give them a moment to go quietly before the runner itself exits.
  setTimeout(() => process.exit(code), 200).unref()
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.log(`\n${DIM}stopping…${RESET}`)
    shutdown(0)
  })
}

// The backend gets a prefix because its output is just log lines. Vite inherits
// the terminal so its address block, colours, and h+enter shortcuts all survive.
start('server', ['--prefix', 'server', 'run', 'dev'], { prefix: true })
start('web', ['run', 'dev:web'], { prefix: false })

console.log(`${DIM}api :3107 · web :5173 — ctrl-c stops both${RESET}`)
