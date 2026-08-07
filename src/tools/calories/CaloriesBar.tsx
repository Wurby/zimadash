import type { FieldConfig } from '@shared/calories'
import { composition } from './macros'

/**
 * The headline. Calories isn't another tracked field — it's the one the others
 * add up to, so it gets the top of the page and a bar made of them.
 *
 * With a goal, the bar fills toward it and the segments show what filled it.
 * Without one, the bar is the whole width and reads purely as composition.
 * Going over the goal doesn't clip: the fill caps at full width and the number
 * turns, because a bar that silently stops at 100% hides the thing you most
 * want to know.
 */
export function CaloriesBar({
  totals,
  fields,
  compact = false,
}: {
  totals: Record<string, number>
  fields: FieldConfig[]
  /** Tile version: no percentage legend, tighter type. The coloured bar still
   *  carries the breakdown — the numbers are detail for the tool page. */
  compact?: boolean
}) {
  const calories = Math.round(totals.calories ?? 0)
  const goal = fields.find((field) => field.id === 'calories')?.goal ?? null

  const colors = Object.fromEntries(fields.map((field) => [field.id, field.color]))
  const { segments, accounted } = composition(totals, colors)

  const fill = goal ? Math.min(100, (calories / goal) * 100) : 100
  const over = goal !== null && calories > goal

  return (
    <section>
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-ink-dim text-[0.6rem] font-medium tracking-wide uppercase">Calories</h2>
        <p className="font-mono tabular-nums">
          <span className={`${compact ? 'text-lg' : 'text-2xl'} ${over ? 'text-danger' : ''}`}>
            {calories}
          </span>
          {goal ? (
            <span className={`text-ink-dim ${compact ? 'text-[0.65rem]' : 'text-sm'}`}>
              {' '}
              / {goal}
            </span>
          ) : null}
        </p>
      </div>

      <div
        className={`bg-line mt-1.5 flex w-full overflow-hidden ${compact ? 'h-2' : 'h-3'}`}
        role="img"
        aria-label={
          segments.length
            ? `${calories} calories: ${segments.map((s) => `${s.label} ${Math.round(s.kcal)}`).join(', ')}`
            : `${calories} calories`
        }
      >
        {accounted > 0 ? (
          segments.map((segment) => (
            <div
              key={segment.id}
              // Each segment's width is its share of the macro total, scaled by
              // how full the bar is overall.
              style={{ width: `${segment.share * fill}%`, background: segment.color }}
            />
          ))
        ) : (
          // Only a bare number was logged — there is nothing to break down.
          <div className="bg-ink-dim" style={{ width: `${fill}%` }} />
        )}
      </div>

      {segments.length > 0 && !compact && (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
          {segments.map((segment) => (
            <span key={segment.id} className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="size-2 shrink-0"
                style={{ background: segment.color }}
              />
              <span className="text-ink-dim text-[0.6rem] tracking-wide uppercase">
                {segment.label}
              </span>
              <span className="text-ink-dim font-mono text-[0.65rem] tabular-nums">
                {Math.round(segment.share * 100)}%
              </span>
            </span>
          ))}
        </div>
      )}
    </section>
  )
}
