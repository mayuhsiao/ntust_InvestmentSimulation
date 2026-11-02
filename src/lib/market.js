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

/**
 * 美股交易時段判斷
 * ------------------------------------------------------------------
 * 美股常規盤為紐約時間 09:30–16:00，換算台灣時間：
 *   夏令時間 21:30–04:00、冬令時間 22:30–05:00
 * 一律以紐約時區計算，日光節約時間會自動切換。
 *
 * 不能只靠報價回傳的 marketOpen：Yahoo 開盤後要一段時間才出現當天那一筆，
 * 下單頁也不會一直重抓報價，開盤前先選好股票、開盤後再按下單，
 * 就會用昨天的收盤價成交。所以改以時鐘強制判斷。
 *
 * 收盤後一路鎖到台灣時間隔天 10:00：美股報價在台灣時間清晨 6～9 點之間
 * 常回傳不完整或錯誤的資料（收盤價仍在修正、盤別資訊切換），等穩定後再開放。
 */

export const US_OPEN_MIN = 9 * 60 + 30 // 紐約 09:30 開盤
export const US_CLOSE_MIN = 16 * 60 // 紐約 16:00 收盤
export const US_REOPEN_TAIPEI_MIN = 10 * 60 // 台灣時間隔天 10:00 起可用該盤收盤價

const NY_CLOCK = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

/** 紐約當地的星期與分鐘數 */
function newYorkClock(now) {
  const parts = Object.fromEntries(NY_CLOCK.formatToParts(new Date(now)).map((p) => [p.type, p.value]))
  return { weekday: parts.weekday, minutes: (Number(parts.hour) % 24) * 60 + Number(parts.minute) }
}

/**
 * @param {object}  opts
 * @param {boolean} opts.enabled  是否啟用盤中禁止交易（老師可關閉）
 * @param {number}  opts.now      時間戳，測試用
 * @returns 時間一律為台灣時間：time 現在、opensAt 開盤、reopenAt 可再下單
 */
export function usMarketSession({ enabled = true, now = Date.now() } = {}) {
  const t = taipeiNow(now)
  const taipeiMin = t.getUTCHours() * 60 + t.getUTCMinutes()
  const ny = newYorkClock(now)
  // 台北比紐約快 12（夏令）或 13（冬令）小時
  const offset = (taipeiMin - ny.minutes + 1440) % 1440
  const inTaipei = (nyMin) => hhmm((nyMin + offset) % 1440)
  // 台灣時間隔天 10:00 換算回紐約時間，落在紐約開盤當天的晚上（21:00 或 22:00）
  const reopenNy = (US_REOPEN_TAIPEI_MIN - offset + 1440) % 1440

  const weekend = ny.weekday === 'Sat' || ny.weekday === 'Sun'
  const inSession = !weekend && ny.minutes >= US_OPEN_MIN && ny.minutes < reopenNy

  const base = {
    weekend,
    inSession,
    time: hhmm(taipeiMin),
    opensAt: inTaipei(US_OPEN_MIN),
    reopenAt: hhmm(US_REOPEN_TAIPEI_MIN),
  }

  if (!enabled) return { ...base, blocked: false, label: '不限時段' }
  if (inSession) {
    return { ...base, blocked: true, label: ny.minutes < US_CLOSE_MIN ? '美股盤中' : '美股收盤資料確認中' }
  }
  return { ...base, blocked: false, label: weekend ? '美股休市' : ny.minutes < US_OPEN_MIN ? '美股開盤前' : '美股已收盤' }
}

/**
 * 全班交易紀錄暫停查詢的時段（台灣時間，每天）
 * ------------------------------------------------------------------
 * 台股開盤前後與美股開盤前後是同學最常上線查看的時候：
 * 這兩段暫停查詢全班交易，分散流量，也避免開盤前看著別人的下單跟單。
 * 老師不受限制；自己的交易紀錄隨時可查。
 */
export const CLASS_TRADES_PAUSES = [
  [8 * 60, 9 * 60 + 30], // 08:00–09:30
  [20 * 60 + 30, 22 * 60 + 30], // 20:30–22:30
]

/** @returns {{paused:boolean, until?:string, windows:string[]}} */
export function classTradesPause(now = Date.now()) {
  const t = taipeiNow(now)
  const minutes = t.getUTCHours() * 60 + t.getUTCMinutes()
  const windows = CLASS_TRADES_PAUSES.map(([from, to]) => `${hhmm(from)}–${hhmm(to)}`)
  const hit = CLASS_TRADES_PAUSES.find(([from, to]) => minutes >= from && minutes < to)
  return hit ? { paused: true, until: hhmm(hit[1]), windows } : { paused: false, windows }
}
