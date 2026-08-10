import { useEffect, useState } from 'react'
import {
  RATING_META,
  RATINGS,
  TARGET_RATING,
  spokenFor,
  spokenGuide,
  type ExerciseGuide,
  type PersonalRecord,
  type Rating,
  type Session,
  type SessionExercise,
} from '@shared/trainer'
import { usePolled } from '../../lib/refresh'
import {
  abandonSession,
  finishSession,
  getActive,
  getAlternatives,
  getGuide,
  getPlan,
  planWithModel,
  recordResult,
  startSession,
  swapExercise,
  type Alternative,
} from './api'
import { RatingScale } from './RatingScale'
import { Speaker, setVoiceEnabled, voiceEnabled, type SpeechCapability } from './speech'

/**
 * Running a workout.
 *
 * Plan → start → one exercise a screen → rate it, which advances → finished.
 * The happy path is **one tap per exercise**: the load and reps default to what
 * was prescribed, and you only touch them if reality differed.
 *
 * Every result is written the moment it's tapped. The session only counts as
 * finished at the end, but a phone sleeps between sets and a reload has to put
 * you back where you were.
 */

const TOUCH = 'min-h-11'

function Loading() {
  return <p className="text-ink-dim text-sm">loading…</p>
}

// ─── Before you start ────────────────────────────────────────────────────────

/**
 * The plan, before you start.
 *
 * The rules plan renders immediately and the model's is requested underneath
 * it, swapping in when it arrives. Waiting a minute on a blank screen to find
 * out what today is would be worse than seeing a serviceable session at once and
 * watching it get better — and if the model is down, what's on screen is
 * already the fallback, labelled as such rather than substituted quietly.
 */
type ModelPlan = 'idle' | { session: Session; reasoning: string } | { error: string }

function PlanSummary({ onStart, starting }: { onStart: () => void; starting: boolean }) {
  const plan = usePolled('event-driven', getPlan)
  const [model, setModel] = useState<ModelPlan>('idle')

  const base = plan.status === 'ok' ? plan.data : null
  const alreadyModel = base?.plannedBy === 'model'

  useEffect(() => {
    if (!base || alreadyModel) return
    let alive = true
    planWithModel()
      .then((found) => alive && setModel(found))
      .catch(
        (err: unknown) =>
          alive && setModel({ error: err instanceof Error ? err.message : 'the planner is down' }),
      )
    return () => {
      alive = false
    }
  }, [base, alreadyModel])

  if (plan.status === 'loading') return <Loading />
  if (plan.status === 'error') return <p className="text-danger text-sm">{plan.message}</p>

  const upgraded = typeof model === 'object' && 'session' in model ? model : null
  const failed = typeof model === 'object' && 'error' in model ? model.error : null
  // Working is derived rather than stored, so nothing has to set state from
  // inside the effect that starts the request.
  const thinking = !alreadyModel && model === 'idle'

  const session = upgraded?.session ?? plan.data.session
  const byModel = alreadyModel || upgraded !== null

  return (
    <div className="space-y-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold tracking-tight">{session.type}</h2>
        <span className="text-ink-dim font-mono text-xs">{session.exercises.length} exercises</span>
      </div>

      <p className="text-ink-dim text-xs">
        {thinking ? (
          <span className="text-accent">Planning your session… showing the rules version.</span>
        ) : byModel ? (
          (upgraded?.reasoning ?? 'Planned for you.')
        ) : (
          <>Built from the rules{failed ? ` — ${failed}` : ''}.</>
        )}
      </p>

      <ul className="space-y-2">
        {session.exercises.map((exercise, index) => (
          <li key={exercise.name} className="border-line bg-surface flex gap-3 border p-3">
            <span className="text-ink-dim shrink-0 font-mono text-xs tabular-nums">
              {index + 1}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">{exercise.name}</span>
              {exercise.kneeLoaded && (
                <span className="text-ink-dim block text-[0.65rem] tracking-wide uppercase">
                  knee protocol
                </span>
              )}
            </span>
            <span className="shrink-0 text-right font-mono text-sm tabular-nums">
              {exercise.prescribed.weightLb > 0 ? `${exercise.prescribed.weightLb}lb` : 'body'}
              <span className="text-ink-dim block text-[0.65rem]">
                {exercise.prescribed.sets}×{exercise.prescribed.reps}
              </span>
            </span>
          </li>
        ))}
      </ul>

      <button
        type="button"
        onClick={onStart}
        disabled={starting}
        className="border-accent text-accent hover:bg-accent/10 min-h-14 w-full border text-base font-medium transition-colors disabled:opacity-40"
      >
        {starting ? 'starting…' : 'Start session'}
      </button>
    </div>
  )
}

// ─── Mid-session ─────────────────────────────────────────────────────────────

function Adjust({
  exercise,
  onChange,
}: {
  exercise: SessionExercise
  onChange: (patch: { weightLb?: number; sets?: number; reps?: number }) => void
}) {
  const field = `border-line focus:border-accent ${TOUCH} w-20 border bg-transparent px-2 text-center font-mono text-sm outline-none`

  return (
    <div className="border-line mt-3 flex flex-wrap items-end gap-3 border-t pt-3">
      <label>
        <span className="text-ink-dim block text-xs">Weight</span>
        <input
          type="number"
          min={0}
          defaultValue={exercise.prescribed.weightLb}
          onChange={(event) => onChange({ weightLb: Number(event.target.value) })}
          className={`${field} mt-1`}
        />
      </label>
      <label>
        <span className="text-ink-dim block text-xs">Sets</span>
        <input
          type="number"
          min={0}
          defaultValue={exercise.prescribed.sets}
          onChange={(event) => onChange({ sets: Number(event.target.value) })}
          className={`${field} mt-1`}
        />
      </label>
      <label>
        <span className="text-ink-dim block text-xs">Reps</span>
        <input
          type="number"
          min={0}
          defaultValue={exercise.prescribed.reps}
          onChange={(event) => onChange({ reps: Number(event.target.value) })}
          className={`${field} mt-1`}
        />
      </label>
    </div>
  )
}

function SwapPanel({
  session,
  index,
  onSwapped,
  onClose,
}: {
  session: Session
  index: number
  onSwapped: (session: Session) => void
  onClose: () => void
}) {
  const [options, setOptions] = useState<Alternative[] | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    getAlternatives(session.id, index)
      .then((found) => {
        if (alive) setOptions(found.alternatives)
      })
      .catch(() => {
        if (alive) setOptions([])
      })
    return () => {
      alive = false
    }
  }, [session.id, index])

  async function choose(name: string) {
    setBusy(true)
    try {
      onSwapped((await swapExercise(session.id, index, name)).session)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="border-line bg-surface mt-3 border p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">Swap for</p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className={`border-line text-ink-dim hover:border-accent ${TOUCH} w-11 shrink-0 border text-xs`}
        >
          ✕
        </button>
      </div>

      {options === null && <p className="text-ink-dim mt-2 text-xs">loading…</p>}
      {options?.length === 0 && (
        <p className="text-ink-dim mt-2 text-xs italic">Nothing else in the pool for this day.</p>
      )}

      <ul className="mt-2 space-y-1">
        {options?.map((option) => (
          <li key={option.name}>
            <button
              type="button"
              disabled={busy}
              onClick={() => void choose(option.name)}
              className={`border-line hover:border-accent ${TOUCH} w-full border px-3 py-2 text-left text-sm transition-colors disabled:opacity-40`}
            >
              {option.name}
              {!option.kneeLoaded && (
                <span className="text-ink-dim ml-2 text-[0.65rem]">low knee stress</span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * The long-form how-to, on request.
 *
 * The cue on the screen above is deliberately one or two sentences — that is
 * what you want between sets. This is what you want the first time you attempt
 * a movement, so it is a tap rather than always-on clutter.
 *
 * Cached server-side per exercise, so only the very first ask waits.
 */
function GuidePanel({
  exercise,
  speak,
  onClose,
}: {
  exercise: string
  speak: ((text: string) => void) | null
  onClose: () => void
}) {
  const [guide, setGuide] = useState<ExerciseGuide | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    getGuide(exercise)
      .then((found) => {
        if (!alive) return
        setGuide(found.guide)
        speak?.(spokenGuide(found.guide))
      })
      .catch((err: unknown) => {
        if (alive) setError(err instanceof Error ? err.message : 'could not write that up')
      })
    return () => {
      alive = false
    }
    // `speak` is intentionally excluded: re-reading the guide because the voice
    // toggle changed would talk over whatever is being said now.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exercise])

  return (
    <div className="border-line bg-surface mt-3 border p-3">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold">How to do it</h3>
        <button
          type="button"
          onClick={onClose}
          aria-label="Hide the detail"
          className={`border-line text-ink-dim hover:border-accent ${TOUCH} w-11 shrink-0 border text-xs`}
        >
          ✕
        </button>
      </div>

      {!guide && !error && (
        <p className="text-ink-dim mt-2 text-xs">writing it up — this happens once…</p>
      )}
      {error && <p className="text-danger mt-2 text-xs">{error}</p>}

      {guide && (
        <div className="mt-3 space-y-3 text-sm">
          <div>
            <p className="text-ink-dim text-[0.65rem] tracking-wide uppercase">Setup</p>
            <p className="mt-1">{guide.setup}</p>
          </div>

          <div>
            <p className="text-ink-dim text-[0.65rem] tracking-wide uppercase">Each rep</p>
            <ol className="mt-1 space-y-1">
              {guide.steps.map((step, index) => (
                <li key={step} className="flex gap-2">
                  <span className="text-ink-dim shrink-0 font-mono text-xs tabular-nums">
                    {index + 1}
                  </span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          </div>

          {guide.watchFor.length > 0 && (
            <div>
              <p className="text-ink-dim text-[0.65rem] tracking-wide uppercase">Watch for</p>
              <ul className="mt-1 space-y-1">
                {guide.watchFor.map((watch) => (
                  <li key={watch} className="flex gap-2">
                    <span className="text-ink-dim shrink-0">·</span>
                    <span>{watch}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {speak && (
              <button
                type="button"
                onClick={() => speak(spokenGuide(guide))}
                className={`border-line text-ink-dim hover:border-accent ${TOUCH} border px-3 text-xs transition-colors`}
              >
                read it out
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setGuide(null)
                setError(null)
                getGuide(exercise, true)
                  .then((found) => setGuide(found.guide))
                  .catch(() => setError('could not rewrite that'))
              }}
              className={`border-line text-ink-dim hover:border-accent ${TOUCH} border px-3 text-xs transition-colors`}
            >
              rewrite
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function Walkthrough({
  session,
  speaker,
  capability,
  onSession,
  onFinished,
}: {
  session: Session
  speaker: Speaker
  capability: SpeechCapability | null
  onSession: (session: Session) => void
  onFinished: (records: PersonalRecord[]) => void
}) {
  const index = Math.min(session.cursor, session.exercises.length - 1)
  const exercise = session.exercises[index]

  const [voice, setVoice] = useState(voiceEnabled)
  const [busy, setBusy] = useState(false)
  const [swapping, setSwapping] = useState(false)
  const [adjusting, setAdjusting] = useState(false)
  const [detail, setDetail] = useState(false)
  const [override, setOverride] = useState<{ weightLb?: number; sets?: number; reps?: number }>({})

  const spoken = exercise ? spokenFor(exercise, index, session.exercises.length) : ''

  // Read the exercise out as you land on it. Keyed on the sentence rather than
  // the index, so swapping one also re-reads it.
  useEffect(() => {
    if (!voice || !spoken) return
    void speaker.say(spoken)
    return () => speaker.stop()
  }, [voice, spoken, speaker])

  if (!exercise) return null

  async function rate(rating: Rating) {
    setBusy(true)
    try {
      const next = await recordResult(session.id, index, { rating, ...override })
      onSession(next.session)
      if (next.allDone) {
        const done = await finishSession(session.id)
        speaker.stop()
        onFinished(done.records)
      }
    } finally {
      setBusy(false)
    }
  }

  async function skip() {
    setBusy(true)
    try {
      const next = await recordResult(session.id, index, {
        skipped: true,
        skipReason: 'skipped during the session',
      })
      onSession(next.session)
      if (next.allDone) {
        const done = await finishSession(session.id)
        onFinished(done.records)
      }
    } finally {
      setBusy(false)
    }
  }

  const done = session.exercises.filter((candidate) => candidate.result !== null).length

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-ink-dim font-mono text-xs tabular-nums">
          {session.type} · {index + 1} of {session.exercises.length}
        </span>

        <div className="flex items-center gap-2">
          {voice && (
            <button
              type="button"
              onClick={() => void speaker.say(spoken)}
              aria-label="Read it again"
              className={`border-line text-ink-dim hover:border-accent ${TOUCH} w-11 border text-sm transition-colors`}
            >
              ↺
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              const next = !voice
              setVoice(next)
              setVoiceEnabled(next)
              if (next) {
                // Prime only. Flipping `voice` re-runs the effect below, and
                // that is what speaks — saying it here too fired two requests
                // for the same sentence at once, which is what collided on the
                // server and ended up with both voices talking.
                speaker.prime()
              } else {
                speaker.stop()
              }
            }}
            aria-pressed={voice}
            aria-label={voice ? 'Turn the voice off' : 'Turn the voice on'}
            className={`${TOUCH} border px-3 text-sm transition-colors ${
              voice ? 'border-accent text-accent' : 'border-line text-ink-dim hover:border-accent'
            }`}
          >
            {voice ? 'voice on' : 'voice off'}
          </button>
        </div>
      </div>

      <div className="bg-line h-1 w-full">
        <div
          className="bg-accent h-full transition-[width] duration-500"
          style={{ width: `${(done / session.exercises.length) * 100}%` }}
        />
      </div>

      <div>
        <h2 className="text-2xl font-semibold tracking-tight">{exercise.name}</h2>
        <p className="mt-1 font-mono text-3xl tabular-nums">
          {exercise.prescribed.weightLb > 0 ? (
            <>
              {override.weightLb ?? exercise.prescribed.weightLb}
              <span className="text-ink-dim text-lg">lb</span>
            </>
          ) : (
            <span className="text-2xl">Bodyweight</span>
          )}
          <span className="text-ink-dim ml-3 text-xl">
            {override.sets ?? exercise.prescribed.sets}×{override.reps ?? exercise.prescribed.reps}
          </span>
        </p>

        {exercise.kneeLoaded && (
          <p className="text-ink-dim mt-2 text-xs tracking-wide uppercase">
            knee work — control the descent, no bouncing
          </p>
        )}
        {exercise.instructions && (
          <p className="text-ink-dim mt-3 text-sm">{exercise.instructions}</p>
        )}
      </div>

      {adjusting && (
        <Adjust exercise={exercise} onChange={(patch) => setOverride({ ...override, ...patch })} />
      )}

      <div>
        <p className="text-ink-dim mb-2 text-xs tracking-wide uppercase">How did it feel?</p>
        <RatingScale
          onPick={(rating) => void rate(rating)}
          busy={busy}
          kneeLoaded={exercise.kneeLoaded}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setAdjusting((was) => !was)}
          className={`border-line text-ink-dim hover:border-accent ${TOUCH} border px-3 text-xs transition-colors`}
        >
          {adjusting ? 'done adjusting' : 'adjust weight or reps'}
        </button>
        <button
          type="button"
          onClick={() => setDetail((was) => !was)}
          aria-expanded={detail}
          className={`${TOUCH} border px-3 text-xs transition-colors ${
            detail ? 'border-accent text-accent' : 'border-line text-ink-dim hover:border-accent'
          }`}
        >
          how to do it
        </button>
        <button
          type="button"
          onClick={() => setSwapping((was) => !was)}
          className={`border-line text-ink-dim hover:border-accent ${TOUCH} border px-3 text-xs transition-colors`}
        >
          swap
        </button>
        <button
          type="button"
          onClick={() => void skip()}
          disabled={busy}
          className={`border-line text-ink-dim hover:border-danger hover:text-danger ${TOUCH} border px-3 text-xs transition-colors disabled:opacity-40`}
        >
          skip
        </button>
      </div>

      {detail && (
        <GuidePanel
          exercise={exercise.name}
          speak={voice ? (text) => void speaker.say(text) : null}
          onClose={() => setDetail(false)}
        />
      )}

      {swapping && (
        <SwapPanel
          session={session}
          index={index}
          onSwapped={(next) => {
            onSession(next)
            setSwapping(false)
          }}
          onClose={() => setSwapping(false)}
        />
      )}

      {capability && !capability.available && voice && (
        <p className="text-ink-dim text-xs">{capability.reason}</p>
      )}
    </div>
  )
}

// ─── Afterwards ──────────────────────────────────────────────────────────────

function Finished({ records, onClose }: { records: PersonalRecord[]; onClose: () => void }) {
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold tracking-tight">Logged.</h2>

      {records.length > 0 ? (
        <div>
          <p className="text-ink-dim text-sm">
            {records.length} personal record{records.length === 1 ? '' : 's'} today.
          </p>
          <ul className="mt-2 space-y-1">
            {records.map((record) => (
              <li
                key={record.exercise}
                className="border-line bg-surface flex items-center justify-between gap-3 border px-3 py-2 text-sm"
              >
                <span className="min-w-0 flex-1 truncate">{record.exercise}</span>
                <span className="text-accent shrink-0 font-mono tabular-nums">
                  {record.weightLb}lb ×{record.reps}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-ink-dim text-sm">No new records — it still counts.</p>
      )}

      <button
        type="button"
        onClick={onClose}
        className={`border-accent text-accent hover:bg-accent/10 ${TOUCH} border px-4 text-sm transition-colors`}
      >
        done
      </button>
    </div>
  )
}

// ─── The tab ─────────────────────────────────────────────────────────────────

export function SessionTab() {
  const active = usePolled('event-driven', getActive)
  const [session, setSession] = useState<Session | null>(null)
  const [finished, setFinished] = useState<PersonalRecord[] | null>(null)
  const [starting, setStarting] = useState(false)
  const [capability, setCapability] = useState<SpeechCapability | null>(null)

  // A lazy initialiser rather than a ref: this is a value the render actually
  // uses, and it has to be the same instance for the life of the tab so that
  // stopping one cue and starting the next isn't two different speakers talking
  // over each other.
  const [speaker] = useState(() => new Speaker())

  useEffect(() => {
    speaker
      .capability()
      .then(setCapability)
      .catch(() => setCapability(null))
    return () => speaker.dispose()
  }, [speaker])

  const current = session ?? (active.status === 'ok' ? active.data.session : null)

  async function start() {
    setStarting(true)
    // Unlock audio while a real tap is still on the stack — iOS will not speak
    // or play otherwise, and arriving at the first exercise is far too late.
    speaker.prime()
    try {
      setSession((await startSession()).session)
    } finally {
      setStarting(false)
    }
  }

  if (finished) {
    return (
      <Finished
        records={finished}
        onClose={() => {
          setFinished(null)
          setSession(null)
          active.refresh()
        }}
      />
    )
  }

  if (active.status === 'loading' && !session) return <Loading />

  if (!current) {
    return (
      <div className="space-y-6">
        <PlanSummary onStart={() => void start()} starting={starting} />
        <ScaleKey />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Keyed on the position, so moving to the next exercise remounts and
          every per-exercise scrap of state — an adjusted weight, an open swap
          panel — resets on its own rather than needing an effect to clear it. */}
      <Walkthrough
        key={current.cursor}
        session={current}
        speaker={speaker}
        capability={capability}
        onSession={setSession}
        onFinished={setFinished}
      />

      <Exits
        session={current}
        onEnded={setFinished}
        onAbandoned={() => {
          setSession(null)
          active.refresh()
        }}
      />
    </div>
  )
}

/**
 * The two ways out of a session, which are not the same thing.
 *
 * **Ending early keeps what you did.** Four of six is still four sets you
 * performed, and the server already records the rest as skipped rather than
 * pretending they happened. This is the one you want when life interrupts.
 *
 * **Abandoning throws the session away**, which is right when you started it by
 * mistake and wrong the rest of the time — so it confirms first, and says what
 * it is about to destroy. Every other delete in this codebase asks twice; the
 * most destructive action in it shouldn't be the exception.
 */
function Exits({
  session,
  onEnded,
  onAbandoned,
}: {
  session: Session
  onEnded: (records: PersonalRecord[]) => void
  onAbandoned: () => void
}) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

  const logged = session.exercises.filter((exercise) => exercise.result !== null).length
  const total = session.exercises.length

  async function end() {
    setBusy(true)
    try {
      onEnded((await finishSession(session.id)).records)
    } finally {
      setBusy(false)
    }
  }

  async function abandon() {
    setBusy(true)
    try {
      await abandonSession(session.id)
      onAbandoned()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="border-line flex flex-wrap gap-2 border-t pt-4">
      {logged > 0 && (
        <button
          type="button"
          onClick={() => void end()}
          disabled={busy}
          className={`border-accent text-accent hover:bg-accent/10 ${TOUCH} border px-3 text-xs transition-colors disabled:opacity-40`}
        >
          End here — keep {logged} of {total}
        </button>
      )}

      {confirming ? (
        <button
          type="button"
          onClick={() => void abandon()}
          disabled={busy}
          className={`border-danger text-danger hover:bg-danger/10 ${TOUCH} border px-3 text-xs transition-colors disabled:opacity-40`}
        >
          {logged > 0
            ? `Really? ${logged} logged exercise${logged === 1 ? '' : 's'} will be lost`
            : 'Really — bin this session?'}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          onBlur={() => setConfirming(false)}
          className={`border-line text-ink-dim hover:border-danger hover:text-danger ${TOUCH} border px-3 text-xs transition-colors`}
        >
          Abandon
        </button>
      )}
    </div>
  )
}

/** The scale, shown before you start so the words mean something the first
 *  time you see them mid-set. */
function ScaleKey() {
  return (
    <section>
      <h3 className="text-sm font-semibold tracking-tight">How you'll rate it</h3>
      <p className="text-ink-dim mt-1 text-xs">
        One tap per exercise. Each answer says what it does to next time, so the rule is on screen
        rather than in your head.
      </p>
      <ul className="border-line mt-3 border">
        {RATINGS.map((rating) => (
          <li
            key={rating}
            className={`border-line flex items-center justify-between gap-3 border-b px-3 py-2.5 text-sm last:border-b-0 ${
              rating === TARGET_RATING ? 'text-accent font-medium' : ''
            }`}
          >
            <span>{RATING_META[rating].label}</span>
            <span className="text-ink-dim font-mono text-xs">
              {RATING_META[rating].consequence}
              {rating === TARGET_RATING ? ' — target' : ''}
            </span>
          </li>
        ))}
      </ul>
      <p className="text-ink-dim mt-2 text-xs">
        On the knee-loaded lifts, "too hard" drops two rungs rather than one. At the top of a ladder
        there is no next rung, so "easy" adds reps instead.
      </p>
    </section>
  )
}
