import { RATE_LIMITS } from '@shared/constants'

/**
 * Gaussian random number (Box-Muller transform)
 * Generates a normally distributed random number with given mean and stdDev
 */
function gaussianRandom(mean: number, stdDev: number): number {
  const u1 = Math.random()
  const u2 = Math.random()
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
  return mean + z * stdDev
}

/**
 * Gaussian delay — more human-like than uniform random
 * Most delays cluster near the midpoint, with occasional longer waits
 */
export function gaussianDelay(minMs: number, maxMs: number): number {
  const mean = (minMs + maxMs) / 2
  const stdDev = (maxMs - minMs) / 4
  let delay = gaussianRandom(mean, stdDev)
  delay = Math.max(minMs, Math.min(maxMs, delay))
  return Math.round(delay)
}

/**
 * Simulate human waiting — includes 5% "distraction" probability
 */
export async function humanDelay(minMs: number, maxMs: number): Promise<void> {
  let delay = gaussianDelay(minMs, maxMs)

  // 5% chance of distraction (simulates switching tabs, checking phone, etc.)
  if (Math.random() < RATE_LIMITS.distractionChance) {
    const distraction = gaussianDelay(
      RATE_LIMITS.distractionMin,
      RATE_LIMITS.distractionMax
    )
    delay += distraction
    console.log(`[xSocial] distraction +${(distraction / 1000).toFixed(1)}s`)
  }

  await sleep(delay)
}

/**
 * Simple sleep
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Follow action delay (60-180 seconds + distraction)
 */
export async function followDelay(): Promise<void> {
  await humanDelay(RATE_LIMITS.followDelayMin, RATE_LIMITS.followDelayMax)
}

/**
 * Read operation delay (3-8 seconds)
 */
export async function readDelay(): Promise<void> {
  await sleep(gaussianDelay(RATE_LIMITS.readDelayMin, RATE_LIMITS.readDelayMax))
}

/**
 * Batch rest interval (5-10 minutes)
 */
export async function batchRest(): Promise<void> {
  await sleep(gaussianDelay(RATE_LIMITS.batchRestMin, RATE_LIMITS.batchRestMax))
}

/**
 * Check if current time is within active hours
 */
export function isActiveHours(start = RATE_LIMITS.activeHoursStart, end = RATE_LIMITS.activeHoursEnd): boolean {
  const hour = new Date().getHours()
  return hour >= start && hour < end
}
