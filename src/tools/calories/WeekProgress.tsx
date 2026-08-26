import type { FieldConfig } from '@shared/calories'
import { KCAL_PER_LB, daysBetween, endOfWeek } from '@shared/calories'
import { CaloriesBar } from './CaloriesBar'

/**
 * This calendar week (Sunday–Saturday, same as the Log tab) against the
 * weekly budget. Daily targets hide the 3,500 kcal that actually move a pound.
 */

function weeklyFields(fields: FieldConfig[]): FieldConfig[] {
  return fields.map((field) =>
    field.id === 'calories' && field.goal ? { ...field, goal: field.goal * 7 } : field,
  )
}

export function WeekProgress({
  totals,
  pendingTotals,
  fields,
  today,
  tdee,
  rateLbPerWeek,
  daysLogged,
  atGoal = false,
  compact = false,
}: {
  totals: Record<string, number>
  pendingTotals?: Record<string, number>
  fields: FieldConfig[]
  today: string
  tdee: number | null
  rateLbPerWeek: number
  /** Logged days in this calendar week. Unlogged days are not zeros. */
  daysLogged: number
  atGoal?: boolean
  compact?: boolean
}) {
  const calorieGoal = fields.find((field) => field.id === 'calories')?.goal ?? null
  const weeklyGoal = calorieGoal !== null ? calorieGoal * 7 : null
  const eaten = Math.round((totals.calories ?? 0) + (pendingTotals?.calories ?? 0))
  const remaining = weeklyGoal !== null ? weeklyGoal - eaten : null
  const daysLeft = daysBetween(today, endOfWeek(today)) + 1
  const pace = remaining !== null && daysLeft > 0 ? Math.round(remaining / daysLeft) : null
  const weeklyBurn = tdee !== null ? tdee * 7 : null
  const rateLabel = Number.isInteger(rateLbPerWeek)
    ? String(rateLbPerWeek)
    : rateLbPerWeek.toFixed(1)
  const deficitNeeded = rateLbPerWeek * KCAL_PER_LB

  const projected = daysLogged > 0 ? (eaten / daysLogged) * 7 : null
  const projectedLb =
    weeklyBurn !== null && projected !== null ? (weeklyBurn - projected) / KCAL_PER_LB : null

  if (compact) {
    return (
      <div>
        <p className="font-mono text-sm tabular-nums">
          <span className="text-ink-dim mr-2 text-[0.6rem] tracking-wide uppercase">This week</span>
          {eaten}
          {weeklyGoal !== null ? <span className="text-ink-dim"> / {weeklyGoal}</span> : null}
          {remaining !== null ? (
            <span className={remaining < 0 ? 'text-danger' : 'text-ink-dim'}>
              {' '}
              · {remaining >= 0 ? `${remaining} left` : `${Math.abs(remaining)} over`}
            </span>
          ) : null}
        </p>
        {pace !== null && remaining !== null && remaining >= 0 && (
          <p className="text-ink-dim mt-0.5 font-mono text-[0.65rem] tabular-nums">
            {pace} a day for {daysLeft} day{daysLeft === 1 ? '' : 's'}
          </p>
        )}
      </div>
    )
  }

  return (
    <section className="border-line bg-surface border px-4 py-3">
      <p className="text-ink-dim mb-2 text-[0.65rem] font-medium tracking-wide uppercase">
        This week
      </p>
      <CaloriesBar totals={totals} fields={weeklyFields(fields)} pendingTotals={pendingTotals} />

      <div className="mt-3 space-y-1">
        {remaining !== null && (
          <p className="font-mono text-sm tabular-nums">
            {remaining >= 0 ? (
              <>
                {remaining} left
                {pace !== null ? (
                  <span className="text-ink-dim">
                    {' '}
                    · {pace} a day for {daysLeft} day{daysLeft === 1 ? '' : 's'}
                  </span>
                ) : null}
              </>
            ) : (
              <span className="text-danger">{Math.abs(remaining)} over the week</span>
            )}
          </p>
        )}

        {projectedLb !== null && !atGoal && (
          <p className="text-ink-dim font-mono text-sm tabular-nums">
            On pace for {(-projectedLb).toFixed(1)} lb
            <span className="ml-2 text-xs">
              from {daysLogged} day{daysLogged === 1 ? '' : 's'}
            </span>
          </p>
        )}

        {atGoal ? (
          <p className="text-ink-dim text-sm">Holding at goal — eat around what you burn.</p>
        ) : (
          <p className="text-ink-dim text-sm">
            A {rateLabel} lb week is a {deficitNeeded} kcal deficit.
            {weeklyBurn !== null && weeklyGoal !== null
              ? ` Burns ${weeklyBurn} · eat ${weeklyGoal}.`
              : weeklyGoal !== null
                ? ` Eat ${weeklyGoal} this week.`
                : ''}
          </p>
        )}
      </div>
    </section>
  )
}
