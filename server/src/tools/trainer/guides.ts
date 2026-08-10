import crypto from 'node:crypto';
import { readJson, writeJson } from '../../paths.js';
import type { ExerciseGuide } from '../../shared/trainer.js';

/**
 * Long-form how-tos, cached per exercise.
 *
 * The cue on the exercise screen is about today; this is about the movement, so
 * it is worth generating once and keeping. The first tap waits on the model,
 * every tap after is instant — which matters, because the moment you want this
 * is stood in front of a weight.
 *
 * Keyed by exercise name plus a hash of the brief. The brief shapes how a
 * movement gets described — the knee protocol most obviously — so rewriting it
 * should invalidate what was written under the old one rather than leaving
 * advice that quietly contradicts it.
 */

const FILE = 'trainer/guides.json';

interface GuidesFile {
  guides: ExerciseGuide[];
}

export function policyHash(policy: string): string {
  return crypto.createHash('sha256').update(policy).digest('hex').slice(0, 16);
}

function load(): GuidesFile {
  const file = readJson<GuidesFile>(FILE);
  return file && Array.isArray(file.guides) ? file : { guides: [] };
}

/** The cached guide, if one exists and was written under this brief. */
export function findGuide(exercise: string, policy: string): ExerciseGuide | null {
  const hash = policyHash(policy);
  return (
    load().guides.find((guide) => guide.exercise === exercise && guide.policyHash === hash) ?? null
  );
}

export function saveGuide(guide: ExerciseGuide): void {
  const file = load();
  file.guides = [...file.guides.filter((existing) => existing.exercise !== guide.exercise), guide];
  writeJson(FILE, file);
}

export function forgetGuide(exercise: string): void {
  const file = load();
  file.guides = file.guides.filter((guide) => guide.exercise !== exercise);
  writeJson(FILE, file);
}
