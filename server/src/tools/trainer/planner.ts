import { randomUUID } from 'node:crypto';
import {
  loadLadder,
  nextPrescription,
  type ExerciseDef,
  type Inventory,
  type Session,
  type SessionExercise,
  type SessionType,
} from '../../shared/trainer.js';

/**
 * Build a session from the rules alone — no model involved.
 *
 * This exists for two reasons. It is what phase one can show before the model
 * layer is written, and it stays afterwards as the honest fallback: rotation
 * plus the pool plus the adjustment table already make a serviceable session,
 * so a dead estimator should cost you a considered session, not a workout.
 *
 * That is a deliberate divergence from the calorie tracker, where there is no
 * fallback because a silently unestimated meal is worse than a visible failure.
 * Here the fallback is a real workout, and it is always offered rather than
 * substituted quietly — `plannedBy` records which one you got.
 */

/** Roughly 45 minutes at 7–15 minutes an exercise. */
const COMPOUND_SLOTS = 3;
const ACCESSORY_SLOTS = 3;

/** The brief's defaults: compounds heavy and low-rep, accessories lighter and
 *  longer. Only a starting point — the rating moves them from there. */
const DEFAULT_SETS = 4;
const COMPOUND_REPS = 6;
const ACCESSORY_SETS = 3;
const ACCESSORY_REPS = 10;

interface LastSeen {
  date: string;
  weightLb: number;
  sets: number;
  reps: number;
  rating: SessionExercise['result'] extends null
    ? never
    : NonNullable<SessionExercise['result']>['rating'];
}

/** The most recent performed result per exercise name. */
function lastResults(history: Session[]): Map<string, LastSeen> {
  const seen = new Map<string, LastSeen>();

  for (const session of history) {
    for (const exercise of session.exercises) {
      const result = exercise.result;
      if (!result || result.skipped) continue;
      const previous = seen.get(exercise.name);
      if (previous && previous.date > session.date) continue;
      seen.set(exercise.name, {
        date: session.date,
        weightLb: result.weightLb,
        sets: result.sets,
        reps: result.reps,
        rating: result.rating,
      });
    }
  }

  return seen;
}

/**
 * Where a lift with no history starts.
 *
 * The brief says to lean toward the more challenging option and trust him to
 * adjust down mid-set, so a compound takes the second rung rather than the
 * bottom. An accessory does not: the same ladder that makes 30lb a modest
 * goblet squat makes it 15lb per hand on a lateral raise, which isn't hard, it
 * is impossible with any form. Small single-joint work starts at the bottom and
 * climbs — that's what the rating is for.
 */
function startingWeight(ladder: number[], kind: ExerciseDef['kind']): number {
  if (ladder.length === 0) return 0;
  const rung = kind === 'compound' ? Math.min(1, ladder.length - 1) : 0;
  return ladder[rung] ?? 0;
}

export function planSession(
  type: SessionType,
  catalogue: ExerciseDef[],
  inventory: Inventory,
  history: Session[],
  today: string,
): Session {
  const seen = lastResults(history);

  const eligible = catalogue.filter(
    (exercise) => exercise.days.includes(type) && !exercise.complex,
  );

  // Longest untouched first, so nothing quietly falls out of the rotation —
  // the brief warns about muscle groups getting skipped entirely.
  const byStaleness = [...eligible].sort((a, b) => {
    const aSeen = seen.get(a.name)?.date ?? '';
    const bSeen = seen.get(b.name)?.date ?? '';
    return aSeen.localeCompare(bSeen);
  });

  const chosen = [
    ...byStaleness.filter((exercise) => exercise.kind === 'compound').slice(0, COMPOUND_SLOTS),
    ...byStaleness.filter((exercise) => exercise.kind === 'accessory').slice(0, ACCESSORY_SLOTS),
  ];

  const exercises: SessionExercise[] = chosen.map((definition) => {
    const ladder = loadLadder(inventory, definition.implement);
    const last = seen.get(definition.name);
    const compound = definition.kind === 'compound';

    const prescribed = last
      ? nextPrescription(
          { weightLb: last.weightLb, sets: last.sets, reps: last.reps },
          last.rating,
          ladder,
          { kneeLoaded: definition.kneeLoaded },
        )
      : {
          weightLb: startingWeight(ladder, definition.kind),
          sets: compound ? DEFAULT_SETS : ACCESSORY_SETS,
          reps: compound ? COMPOUND_REPS : ACCESSORY_REPS,
          because: 'no history yet — starting point',
        };

    return {
      name: definition.name,
      implement: definition.implement,
      kneeLoaded: definition.kneeLoaded,
      format: 'straight',
      prescribed: {
        weightLb: prescribed.weightLb,
        sets: prescribed.sets,
        reps: prescribed.reps,
      },
      instructions: definition.note,
      result: null,
    };
  });

  return {
    id: randomUUID(),
    date: today,
    type,
    status: 'planned',
    cursor: 0,
    exercises,
    plannedBy: 'rules',
  };
}
