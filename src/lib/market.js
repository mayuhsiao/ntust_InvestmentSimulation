/**
 * 台股交易時段判斷
 * ------------------------------------------------------------------
 * 本競賽一律以「收盤價」成交，所以盤中不開放下單 ——
 * 否則同學看著即時走勢，卻用昨天的收盤價買賣，等於穩賺不賠。
 *
 *   09:00–13:30  盤中（13:30 收盤，資料約 14:00 定案）
 *   14:00 之後   可用「今日收盤價」交易
 *   隔日 09:00 前 仍可用「今日收盤價」交易
 *   六日與休市日  全天開放，用最近一個交易日的收盤價
 */

export const MARKET_OPEN_MIN = 9 * 60 // 09:00 開盤
export const MARKET_CLOSE_MIN = 13 * 60 + 30 // 13:30 收盤
export const DATA_READY_MIN = 14 * 60 // 14:00 收盤資料定案

/** 目前的台北時間（以 UTC 欄位讀取，不受瀏覽器所在時區影響） */
export function taipeiNow(now = Date.now()) {
  return new Date(now + 8 * 3600 * 1000)
}

function hhmm(minutes) {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

/**
 * @param {object}  opts
 * @param {boolean} opts.enabled      是否啟用盤中禁止交易（老師可關閉）
 * @param {boolean} opts.todayClosed  今日收盤價是否已經取得
 * @param {number}  opts.now          時間戳，測試用
 */
export function marketSession({ enabled = true, todayClosed = false, now = Date.now() } = {}) {
  const t = taipeiNow(now)
  const dow = t.getUTCDay() // 0=週日, 6=週六
  const minutes = t.getUTCHours() * 60 + t.getUTCMinutes()
  const weekend = dow === 0 || dow === 6
  const inSession = !weekend && minutes >= MARKET_OPEN_MIN && minutes < DATA_READY_MIN

  const base = { weekend, inSession, minutes, time: hhmm(minutes) }

  if (!enabled) return { ...base, blocked: false, label: '不限時段' }
  if (weekend) return { ...base, blocked: false, inSession: false, label: '假日休市' }
  // 今日收盤價已經抓到，代表已收盤，可以交易
  if (todayClosed) return { ...base, blocked: false, inSession: false, label: '已收盤' }
  if (inSession) {
    return {
      ...base,
      blocked: true,
      label: minutes < MARKET_CLOSE_MIN ? '盤中' : '收盤結算中',
      reopenAt: hhmm(DATA_READY_MIN),
    }
  }
  return { ...base, blocked: false, label: minutes < MARKET_OPEN_MIN ? '開盤前' : '已收盤' }
}
