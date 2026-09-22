import fs from 'node:fs';
import path from 'node:path';

/**
 * The destination filesystem the brain files into, and every path decision
 * around it.
 *
 * No fallback list and no default — unlike resolveClaude()'s candidate paths
 * in brain.ts, guessing at a location on Joshua's filesystem is worse than
 * refusing to run.
 */

const MAX_DEPTH = 8;
const MAX_PATH_LENGTH = 400;

export function inboxRoot(): string | null {
  const configured = process.env.ZIMADASH_INBOX_ROOT;
  if (!configured) return null;

  const resolved = path.resolve(configured);
  try {
    fs.accessSync(resolved, fs.constants.W_OK);
    return fs.statSync(resolved).isDirectory() ? resolved : null;
  } catch {
    return null;
  }
}

function hasControlChar(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    if (value.charCodeAt(i) < 0x20) return true;
  }
  return false;
}

// Also rejects '.' and '..', since both start with a dot — and rejects hidden
// folders outright (.git, .obsidian, .trash) as defense in depth beyond the
// prompt's own instruction not to file into one.
function safeSegment(segment: string): boolean {
  return segment.length > 0 && !segment.startsWith('.') && !hasControlChar(segment);
}

/**
 * Resolves a model-chosen folder + filename against the root, or returns null
 * if it tries to leave it.
 *
 * The destination is chosen by a model that was only told to explore a
 * directory, so this has to distrust it fully. String math alone
 * (path.relative starting with "..") doesn't catch a symlink inside the root
 * pointing somewhere else, so the deepest already-existing ancestor of the
 * target gets a realpath check too.
 */
export function resolveWithin(root: string, folder: string, filename: string): string | null {
  if (path.isAbsolute(folder)) return null;
  if (folder.length > MAX_PATH_LENGTH || filename.length > MAX_PATH_LENGTH) return null;
  if (!safeSegment(filename) || filename.includes('/')) return null;

  const segments = folder.split('/').filter((segment) => segment.length > 0);
  if (segments.length > MAX_DEPTH) return null;
  if (!segments.every(safeSegment)) return null;

  const targetDir = path.resolve(root, ...segments);
  if (path.relative(root, targetDir).startsWith('..')) return null;

  let existing = targetDir;
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) break;
    existing = parent;
  }
  try {
    const real = fs.realpathSync(existing);
    if (path.relative(root, real).startsWith('..')) return null;
  } catch {
    return null;
  }

  return path.join(targetDir, filename);
}

/** The extension is ours, not the model's — it may rename the basename
 *  (`scan_0042.pdf` -> `2024 tax return.pdf`), but the extension always comes
 *  from the upload, matching what code actually wrote to disk. */
export function forceExtension(proposedFilename: string, originalFilename: string): string {
  const ext = path.extname(originalFilename);
  const base = path.basename(proposedFilename, path.extname(proposedFilename)).trim();
  return ext ? `${base || path.basename(originalFilename, ext)}${ext}` : base || originalFilename;
}

/** Never clobbers an existing file — appends " (2)", " (3)", ... before the
 *  extension. */
export function uncollided(target: string): string {
  if (!fs.existsSync(target)) return target;

  const dir = path.dirname(target);
  const ext = path.extname(target);
  const base = path.basename(target, ext);

  for (let n = 2; n <= 50; n++) {
    const candidate = path.join(dir, `${base} (${n})${ext}`);
    if (!fs.existsSync(candidate)) return candidate;
  }
  return path.join(dir, `${base} (${Date.now()})${ext}`);
}

/** Moves a staged file to its destination. Falls back to copy+remove across a
 *  filesystem boundary — DATA_DIR and the drop root are plausibly different
 *  mounts. */
export function place(staged: string, target: string): void {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  try {
    fs.renameSync(staged, target);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err;
    fs.copyFileSync(staged, target);
    fs.rmSync(staged, { force: true });
  }
}
