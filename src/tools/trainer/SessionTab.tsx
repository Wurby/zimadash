import { RATING_META, RATINGS, TARGET_RATING } from '@shared/trainer'
import { usePolled } from '../../lib/refresh'
import { getPlan } from './api'

/**
 * The next session, built from the rules alone.
 *
 * Read-only for now — running it, the one-tap ratings and voice mode are the
 * next phase. It is here already because it proves the parts underneath: the
 * rotation picked the day, the ladder picked the loads, and the adjustment
 * table moved them from what you last rated.
 */

export function SessionTab() {
  const plan = usePolled('event-driven', getPlan)

  if (plan.status === 'loading') return <p className="text-ink-dim text-sm">loading…</p>
  if (plan.status === 'error') return <p className="text-danger text-sm">{plan.message}</p>

  const { session } = plan.data

  return (
    <div className="space-y-6">
      <section>
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-lg font-semibold tracking-tight">{session.type}</h2>
          <span className="text-ink-dim font-mono text-xs">
            {session.exercises.length} exercises
          </span>
        </div>
        <p className="text-ink-dim mt-1 text-xs">
          Built from the rules — rotation, your pool, and what you last rated. The model's selection
          and written cues come next.
        </p>
      </section>

      <ul className="space-y-2">
        {session.exercises.map((exercise, index) => (
          <li key={exercise.name} className="border-line bg-surface border p-3">
            <div className="flex items-baseline gap-3">
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
                {exercise.prescribed.weightLb}
                <span className="text-ink-dim text-xs">lb</span>
                <span className="text-ink-dim block text-[0.65rem]">
                  {exercise.prescribed.sets}×{exercise.prescribed.reps}
                </span>
              </span>
            </div>
            {exercise.instructions && (
              <p className="text-ink-dim mt-2 text-xs">{exercise.instructions}</p>
            )}
          </li>
        ))}
      </ul>

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
          On the knee-loaded lifts, "too hard" drops two rungs rather than one. At the top of a
          ladder there is no next rung, so "easy" adds reps instead.
        </p>
      </section>
    </div>
  )
}
