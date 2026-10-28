// Shared bounded-timeout helpers for Meta model calls.
// A never-resolving endpoint must degrade like an ordinary error, never
// hang the request. Timeouts are env-overridable and injectable in tests.

export const DEFAULT_MODEL_TIMEOUT_MS = 120_000;

export function parseTimeoutMs(
  raw: string | undefined,
  fallback: number = DEFAULT_MODEL_TIMEOUT_MS,
): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function timeoutMsFromEnv(
  name: string,
  fallback: number = DEFAULT_MODEL_TIMEOUT_MS,
): number {
  return parseTimeoutMs(process.env[name], fallback);
}

export function resolveTimeoutMs(
  explicit: number | undefined,
  envName: string,
  fallback: number = DEFAULT_MODEL_TIMEOUT_MS,
): number {
  if (typeof explicit === "number" && Number.isFinite(explicit) && explicit > 0) {
    return explicit;
  }
  return timeoutMsFromEnv(envName, fallback);
}

export async function withModelTimeout<T>(
  pending: Promise<T>,
  timeoutMs: number,
  message = "model zaman asimi",
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    });
    return await Promise.race([pending, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
