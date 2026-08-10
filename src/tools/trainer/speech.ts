import { ApiError, api, apiBlob } from '../../lib/api'

/**
 * Reading the session out loud.
 *
 * **Two providers, best-first.** Piper on the box if it's installed — a local
 * neural voice, free, and much better than a stock system one. Otherwise the
 * browser's own `speechSynthesis`, which is always there. Voice is not allowed
 * to be a thing that stops working because a box got rebuilt, so the fallback
 * isn't a lesser mode, it's the floor.
 *
 * **iOS is the whole reason this is a class rather than a function.** Neither
 * audio playback nor speech will start unless a user gesture has unlocked them
 * first, and "the first exercise appeared" is not a gesture. `prime()` is called
 * from the Start tap, which is.
 *
 * A per-device preference, kept in `localStorage` like the theme: voice on in
 * your hand and off on the wall is a reasonable thing to want, and it is a UI
 * preference rather than state a deploy could destroy.
 */

const KEY = 'zimadash.trainer.voice'

export function voiceEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) === 'on'
  } catch {
    return false
  }
}

export function setVoiceEnabled(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off')
  } catch {
    /* private browsing — it just won't persist */
  }
}

export interface SpeechCapability {
  available: boolean
  voice: string | null
  reason?: string
}

export class Speaker {
  private audio: HTMLAudioElement | null = null
  private url: string | null = null
  /** Null until we've asked the server whether it can do better than the
   *  browser. */
  private server: boolean | null = null
  /** Bumped by every `stop()`, so a reply that arrives after it can tell that
   *  it is no longer wanted. */
  private generation = 0

  /**
   * Unlock audio while a real tap is on the stack.
   *
   * Both paths need it. `speechSynthesis` is unlocked by speaking something
   * empty; an `<audio>` element by attempting to play one. Failures are
   * deliberately swallowed — this is best-effort, and a browser that doesn't
   * need unlocking will simply reject.
   */
  prime(): void {
    try {
      const utterance = new SpeechSynthesisUtterance('')
      utterance.volume = 0
      window.speechSynthesis.speak(utterance)
    } catch {
      /* no speech synthesis here */
    }

    if (!this.audio) {
      this.audio = new Audio()
      this.audio.preload = 'auto'
    }
    void this.audio.play().catch(() => {
      /* nothing loaded yet — the point was the gesture, not the sound */
    })
  }

  /** Ask the box whether it can do better than the browser. Cached, so a
   *  session doesn't re-ask on every exercise. */
  async capability(): Promise<SpeechCapability> {
    const found = await api<SpeechCapability>('/api/tools/trainer/speech')
    this.server = found.available
    return found
  }

  /** Speak, interrupting whatever was being said. */
  async say(text: string): Promise<void> {
    // `stop()` bumps the generation, so anything already in flight is now
    // superseded. Synthesis takes about a second, which is easily long enough
    // to advance an exercise or toggle the voice underneath it — and a request
    // that lands late must neither play nor fall back, or you get the previous
    // exercise read over the current one.
    this.stop()
    const mine = this.generation

    if (this.server !== false) {
      try {
        const blob = await apiBlob('/api/tools/trainer/speech', {
          method: 'POST',
          body: JSON.stringify({ text }),
        })
        if (mine !== this.generation) return
        this.server = true
        this.playBlob(blob)
        return
      } catch (err) {
        if (mine !== this.generation) return

        // Only 503 means "this box has no local voice". Anything else is a
        // blip, and treating every failure as permanent was what let a single
        // hiccup switch engines mid-session — with the successful request still
        // playing through the other one.
        if (err instanceof ApiError && err.status === 503) {
          this.server = false
        } else {
          return
        }
      }
    }

    if (mine !== this.generation) return
    this.speakLocally(text)
  }

  private playBlob(blob: Blob): void {
    if (!this.audio) this.audio = new Audio()
    if (this.url) URL.revokeObjectURL(this.url)

    this.url = URL.createObjectURL(blob)
    this.audio.src = this.url
    void this.audio.play().catch(() => {
      /* the tab lost its gesture — silence is better than a thrown error */
    })
  }

  private speakLocally(text: string): void {
    try {
      const utterance = new SpeechSynthesisUtterance(text)
      // A shade slower than default: this is being listened to across a room
      // mid-set, not read.
      utterance.rate = 0.95
      window.speechSynthesis.speak(utterance)
    } catch {
      /* nothing more we can do */
    }
  }

  /** Silence everything, and invalidate any synthesis still on its way. */
  stop(): void {
    this.generation += 1

    try {
      window.speechSynthesis.cancel()
    } catch {
      /* not available */
    }
    if (this.audio) {
      this.audio.pause()
      this.audio.currentTime = 0
    }
  }

  dispose(): void {
    this.stop()
    if (this.url) URL.revokeObjectURL(this.url)
    this.url = null
    this.audio = null
  }
}
