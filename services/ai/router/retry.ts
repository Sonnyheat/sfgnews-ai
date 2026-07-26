// Timeout + bounded retry helper.
//
// Wraps a single provider call with an AbortController-backed timeout and a
// capped exponential backoff. `sleep` and `now` are injectable so tests run
// instantly and deterministically. Retries are bounded — this is part of the
// runaway-usage / loop-prevention guarantees.

export interface RetryOptions {
  perCallMs: number
  maxRetries: number
  baseDelayMs: number
  sleep?: (ms: number) => Promise<void>
  now?: () => number
  /** Decide whether an error is worth retrying (default: retry all). */
  isRetryable?: (err: unknown) => boolean
}

export interface RetryOutcome<T> {
  value: T | null
  error: Error | null
  attempts: number
  retries: number
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export async function withTimeoutAndRetry<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  opts: RetryOptions,
): Promise<RetryOutcome<T>> {
  const sleep = opts.sleep ?? defaultSleep
  const isRetryable = opts.isRetryable ?? (() => true)
  let attempts = 0
  let lastError: Error | null = null

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    attempts++
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), opts.perCallMs)
    try {
      const value = await fn(controller.signal)
      clearTimeout(timer)
      return { value, error: null, attempts, retries: attempt }
    } catch (err) {
      clearTimeout(timer)
      lastError =
        err instanceof Error ? err : new Error(String(err))
      if (controller.signal.aborted) {
        lastError = new Error(`timeout after ${opts.perCallMs}ms`)
      }
      if (attempt >= opts.maxRetries || !isRetryable(err)) break
      // Exponential backoff: base * 2^attempt.
      await sleep(opts.baseDelayMs * Math.pow(2, attempt))
    }
  }

  return { value: null, error: lastError, attempts, retries: attempts - 1 }
}
