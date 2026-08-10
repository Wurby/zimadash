import { RATINGS, RATING_META, TARGET_RATING, type Rating } from '@shared/trainer'

/**
 * How the set felt — the only thing you have to tap.
 *
 * A vertical scale rather than a row of buttons: it reads as a scale, and every
 * row is full width so the target problem disappears entirely. Each row shows
 * what it does to next time, which puts the adjustment rule on screen instead
 * of in your head.
 *
 * "Hard" is the target. A working set should feel hard, so calling the target
 * "just right" would be smoothing something that doesn't need it.
 */
export function RatingScale({
  onPick,
  busy,
  kneeLoaded,
}: {
  onPick: (rating: Rating) => void
  busy?: boolean
  kneeLoaded?: boolean
}) {
  return (
    <div>
      <ul className="border-line border">
        {RATINGS.map((rating) => {
          const meta = RATING_META[rating]
          const target = rating === TARGET_RATING
          // Knee work backs off twice as far, so the label has to say so rather
          // than quietly doing something else than it claims.
          const consequence = kneeLoaded && meta.rungs < 0 ? 'down two — knee' : meta.consequence

          return (
            <li key={rating} className="border-line border-b last:border-b-0">
              <button
                type="button"
                onClick={() => onPick(rating)}
                disabled={busy}
                className={`flex min-h-14 w-full items-center justify-between gap-3 px-4 text-left transition-colors disabled:opacity-40 ${
                  target
                    ? 'text-accent hover:bg-accent/10 font-semibold'
                    : 'hover:bg-line/40 hover:text-ink'
                }`}
              >
                <span className="text-base">{meta.label}</span>
                <span className="text-ink-dim shrink-0 font-mono text-xs">
                  {consequence}
                  {target ? ' · target' : ''}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
