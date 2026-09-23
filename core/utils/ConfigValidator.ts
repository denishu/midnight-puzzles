import { Logger } from './Logger';

const logger = new Logger('ConfigValidator');

/**
 * Fail-fast configuration validation.
 *
 * Env vars are read all over the app with `|| ''` fallbacks, so a missing
 * secret (bot token, client id/secret) currently fails silently at runtime —
 * e.g. the Discord token exchange returns an opaque 500 only when a player
 * tries to launch the Activity. These helpers assert required config at boot so
 * a misconfigured process dies immediately with a clear message instead.
 */

/**
 * Assert that every named environment variable is present and non-empty.
 * Returns the validated values. Throws with a combined message listing all
 * missing vars (so one restart surfaces every problem, not one at a time).
 */
export function requireEnv(names: string[]): Record<string, string> {
  const values: Record<string, string> = {};
  const missing: string[] = [];

  for (const name of names) {
    const value = process.env[name];
    if (!value || value.trim() === '') {
      missing.push(name);
    } else {
      values[name] = value;
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variable(s): ${missing.join(', ')}. ` +
        `Set them (see .env.example) before starting.`
    );
  }

  return values;
}

/**
 * Validate required config at boot and exit the process on failure. Use this at
 * a service entry point so a misconfigured deploy fails fast and loudly rather
 * than limping along and erroring on the first user request.
 */
export function validateConfigOrExit(names: string[], context: string): void {
  try {
    requireEnv(names);
    logger.info(`[${context}] Config OK — ${names.length} required var(s) present`);
  } catch (e) {
    logger.error(`[${context}] ${(e as Error).message}`);
    process.exit(1);
  }
}
