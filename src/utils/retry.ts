/**
 * Retry utility with exponential backoff.
 * Executes an async function and retries on failure with increasing delays.
 */

export interface RetryOptions {
  /** Maximum number of retry attempts (not counting the initial attempt). */
  maxRetries: number;
  /** Initial delay in milliseconds before the first retry. */
  initialDelay: number;
  /** Maximum delay in milliseconds between retries. */
  maxDelay: number;
  /** Multiplier for exponential backoff (default: 2). */
  backoffFactor: number;
  /** Whether to add random jitter to the delay. */
  jitter: boolean;
  /** Optional callback invoked before each retry with the attempt number and error. */
  onRetry?: (attempt: number, error: Error, nextDelay: number) => void;
}

const DEFAULT_OPTIONS: RetryOptions = {
  maxRetries: 3,
  initialDelay: 1000,
  maxDelay: 30000,
  backoffFactor: 2,
  jitter: true,
};

/**
 * Execute an async function with retry and exponential backoff.
 *
 * @param fn - The async function to execute
 * @param options - Retry configuration
 * @returns The result of the function if it succeeds
 * @throws The last error if all retries are exhausted
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: Partial<RetryOptions> = {}
): Promise<RetryResult<T>> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: Error | undefined;
  let attempt = 0;
  const startTime = Date.now();

  while (attempt <= opts.maxRetries) {
    try {
      const result = await fn();
      return {
        success: true,
        result,
        attempts: attempt + 1,
        totalDuration: Date.now() - startTime,
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      attempt++;

      if (attempt > opts.maxRetries) {
        break;
      }

      // Calculate delay with exponential backoff
      let delay = opts.initialDelay * Math.pow(opts.backoffFactor, attempt - 1);
      delay = Math.min(delay, opts.maxDelay);

      // Add jitter: random value between 0 and 50% of the delay
      if (opts.jitter) {
        const jitterAmount = delay * 0.5 * Math.random();
        delay = delay + jitterAmount;
      }

      delay = Math.round(delay);

      // Notify caller before retry
      if (opts.onRetry) {
        opts.onRetry(attempt, lastError, delay);
      }

      // Wait before retrying
      await sleep(delay);
    }
  }

  return {
    success: false,
    error: lastError!,
    attempts: attempt,
    totalDuration: Date.now() - startTime,
  };
}

/**
 * Result of a retry operation.
 */
export interface RetryResult<T> {
  success: boolean;
  result?: T;
  error?: Error;
  attempts: number;
  totalDuration: number;
}

/**
 * Calculate the delay for a specific attempt number.
 * Useful for previewing the backoff schedule.
 */
export function calculateDelay(
  attempt: number,
  options: Partial<RetryOptions> = {}
): number {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let delay = opts.initialDelay * Math.pow(opts.backoffFactor, attempt - 1);
  return Math.min(Math.round(delay), opts.maxDelay);
}

/**
 * Get the full backoff schedule as an array of delays.
 */
export function getBackoffSchedule(options: Partial<RetryOptions> = {}): number[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const schedule: number[] = [];
  for (let i = 1; i <= opts.maxRetries; i++) {
    schedule.push(calculateDelay(i, opts));
  }
  return schedule;
}

/**
 * Promise-based sleep utility.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
