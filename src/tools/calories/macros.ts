/**
 * Splitting a calorie total into what it was made of.
 *
 * Atwater factors: protein and carbohydrate yield 4 kcal/g, fat 9. Fibre is the
 * trap — it is counted *inside* total carbohydrate on every label, and it only
 * yields about 2 kcal/g because most of it isn't absorbed. Multiplying total
 * carbs by 4 and adding fibre separately double-counts it and inflates the
 * carb share; so carbohydrate is split into net carbs at 4 and fibre at 2.
 *
 * The macro-derived total will rarely match the logged calorie figure exactly —
 * estimates round, and alcohol isn't tracked at all. Rather than pretend, the
 * segments are drawn as *shares* of whatever the macros account for, and the
 * bar's own length comes from the real calorie number. The composition is
 * proportional; the total is honest.
 */

const KCAL = { protein: 4, fat: 9, netCarb: 4, fibre: 2 } as const

export interface Segment {
  id: string
  label: string
  color: string
  kcal: number
  /** Share of the macro-derived total, 0–1. */
  share: number
}

export interface Composition {
  segments: Segment[]
  /** kcal accounted for by macros. Zero when only a bare number was logged. */
  accounted: number
}

export function composition(
  totals: Record<string, number>,
  colors: Record<string, string>,
): Composition {
  const protein = Math.max(0, totals.protein ?? 0)
  const fat = Math.max(0, totals.fat ?? 0)
  const carbs = Math.max(0, totals.carbs ?? 0)
  // Clamp: a bad estimate can put fibre above total carbs, and a negative net
  // carb figure would draw a segment backwards.
  const fibre = Math.min(Math.max(0, totals.fibre ?? 0), carbs)

  const parts = [
    { id: 'protein', label: 'Protein', kcal: protein * KCAL.protein },
    { id: 'fat', label: 'Fat', kcal: fat * KCAL.fat },
    { id: 'carbs', label: 'Carbs', kcal: (carbs - fibre) * KCAL.netCarb + fibre * KCAL.fibre },
  ]

  const accounted = parts.reduce((sum, part) => sum + part.kcal, 0)

  return {
    accounted,
    segments: parts
      .filter((part) => part.kcal > 0)
      .map((part) => ({
        ...part,
        color: colors[part.id] ?? 'currentColor',
        share: accounted > 0 ? part.kcal / accounted : 0,
      })),
  }
}
