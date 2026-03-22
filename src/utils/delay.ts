import { RATE_LIMITS } from '@shared/constants'

/**
 * 高斯随机数 (Box-Muller 变换)
 * 产生均值 mean, 标准差 stdDev 的正态分布随机数
 */
function gaussianRandom(mean: number, stdDev: number): number {
  const u1 = Math.random()
  const u2 = Math.random()
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
  return mean + z * stdDev
}

/**
 * 高斯延迟 — 比均匀随机更像人类行为
 * 大多数延迟集中在中间值附近，偶尔有较长等待
 */
export function gaussianDelay(minMs: number, maxMs: number): number {
  const mean = (minMs + maxMs) / 2
  const stdDev = (maxMs - minMs) / 4
  let delay = gaussianRandom(mean, stdDev)
  delay = Math.max(minMs, Math.min(maxMs, delay))
  return Math.round(delay)
}

/**
 * 模拟人类等待 — 包含 5% "走神" 概率
 */
export async function humanDelay(minMs: number, maxMs: number): Promise<void> {
  let delay = gaussianDelay(minMs, maxMs)

  // 5% 概率走神 (模拟人类切换其他 tab、看手机等)
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

/**
 * 简单 sleep
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * 关注操作延迟 (60-180 秒 + 走神)
 */
export async function followDelay(): Promise<void> {
  await humanDelay(RATE_LIMITS.followDelayMin, RATE_LIMITS.followDelayMax)
}

/**
 * 读取操作延迟 (3-8 秒)
 */
export async function readDelay(): Promise<void> {
  await sleep(gaussianDelay(RATE_LIMITS.readDelayMin, RATE_LIMITS.readDelayMax))
}

/**
 * 批次间休息 (5-10 分钟)
 */
export async function batchRest(): Promise<void> {
  await sleep(gaussianDelay(RATE_LIMITS.batchRestMin, RATE_LIMITS.batchRestMax))
}

/**
 * 检查当前是否在活跃时段内
 */
export function isActiveHours(start = RATE_LIMITS.activeHoursStart, end = RATE_LIMITS.activeHoursEnd): boolean {
  const hour = new Date().getHours()
  return hour >= start && hour < end
}
