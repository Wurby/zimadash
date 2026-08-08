import type { Expenditure, WeightSettings } from '@shared/calories'

/**
 * Weight progress, as one bar.
 *
 * Deliberately a single line rather than four figures: current weight, goal,
 * how far along, and when you'd arrive all fit here without the tile turning
 * into a wall of digits you stop reading from across the room.
 *
 * It measures from where you started, not from zero — a bar from 0 to 170 lb
 * would sit at 98% forever and tell you nothing.
 */
export function WeightBar({
  settings,
  expenditure,
  startLb,
}: {
  settings: WeightSettings
  expenditure: Expenditure
  startLb: number | null
}) {
  const { trendLb, projectedDate, atGoal } = expenditure
  const goal = settings.goalLb

  if (trendLb === null) return null

  const start = startLb ?? trendLb
  const total = goal !== null ? start - goal : 0
  const done = goal !== null ? start - trendLb : 0
  const progress = total > 0 ? Math.min(100, Math.max(0, (done / total) * 100)) : 0

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-mono text-sm tabular-nums">{trendLb.toFixed(1)}</span>
        {goal !== null && (
          <span className="text-ink-dim font-mono text-[0.65rem] tabular-nums">
            {atGoal ? 'at goal' : `${goal} lb`}
          </span>
        )}
      </div>

      {goal !== null && (
        <>
          <div className="bg-line mt-1 h-1.5 w-full overflow-hidden">
            <div
              className="bg-accent h-full"
              style={{ width: `${progress}%` }}
              role="img"
              aria-label={`${Math.round(progress)}% of the way from ${start.toFixed(1)} to ${goal} lb`}
            />
          </div>
          {projectedDate && !atGoal && (
            <p className="text-ink-dim mt-1 font-mono text-[0.6rem]">by {projectedDate}</p>
          )}
        </>
      )}
    </div>
  )
}
