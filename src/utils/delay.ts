// Developed by AI Agent
import { RATE_LIMITS } from '@shared/constants'


function gaussianRandom(mean: number, stdDev: number): number {
  const u1 = Math.random()
  const u2 = Math.random()
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
  return mean + z * stdDev
}


export function gaussianDelay(minMs: number, maxMs: number): number {
  const mean = (minMs + maxMs) / 2
  const stdDev = (maxMs - minMs) / 4
  let delay = gaussianRandom(mean, stdDev)
  delay = Math.max(minMs, Math.min(maxMs, delay))
  return Math.round(delay)
}


export async function humanDelay(minMs: number, maxMs: number): Promise<void> {
  let delay = gaussianDelay(minMs, maxMs)

  
  if (Math.random() < RATE_LIMITS.distractionChance) {
    const distraction = gaussianDelay(
      RATE_LIMITS.distractionMin,
      RATE_LIMITS.distractionMax
    )
    delay += distraction
    console.log(`[xSocial] 走神 +${(distraction / 1000).toFixed(1)}s`)
  }

  await sleep(delay)
}


export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}


export async function followDelay(): Promise<void> {
  await humanDelay(RATE_LIMITS.followDelayMin, RATE_LIMITS.followDelayMax)
}


export async function readDelay(): Promise<void> {
  await sleep(gaussianDelay(RATE_LIMITS.readDelayMin, RATE_LIMITS.readDelayMax))
}


export async function batchRest(): Promise<void> {
  await sleep(gaussianDelay(RATE_LIMITS.batchRestMin, RATE_LIMITS.batchRestMax))
}


export function isActiveHours(start = RATE_LIMITS.activeHoursStart, end = RATE_LIMITS.activeHoursEnd): boolean {
  const hour = new Date().getHours()
  return hour >= start && hour < end
}
