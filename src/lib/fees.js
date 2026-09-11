/**
 * 台股交易成本計算
 * ------------------------------------------------------------------
 *   手續費 = 成交金額 × 0.1425% × 折扣（未滿最低手續費以最低收取）
 *   證交稅 = 成交金額 × 0.3%（僅賣出收取；ETF 為 0.1%，可在設定頁調整）
 * 券商實務上手續費與證交稅皆採無條件捨去到元。
 */

export const DEFAULT_FEES = {
  feeRate: 0.001425, // 手續費率
  feeDiscount: 1, // 折扣（0.6 = 6 折）
  minFee: 20, // 最低手續費（元）
  taxRate: 0.003, // 證交稅率（賣出）
}

function normalize(fees) {
  return { ...DEFAULT_FEES, ...(fees || {}) }
}

function commission(gross, f) {
  if (gross <= 0) return 0
  const raw = Math.floor(gross * f.feeRate * f.feeDiscount)
  return Math.max(raw, Math.min(f.minFee, Math.floor(gross)))
}

/** 買進：net 為實際扣款金額（含手續費） */
export function buyCost(price, shares, fees) {
  const f = normalize(fees)
  const gross = round2(price * shares)
  const fee = commission(gross, f)
  return { gross, fee, tax: 0, net: round2(gross + fee) }
}

/** 賣出：net 為實際入帳金額（扣手續費與證交稅） */
export function sellProceeds(price, shares, fees) {
  const f = normalize(fees)
  const gross = round2(price * shares)
  const fee = commission(gross, f)
  const tax = gross > 0 ? Math.floor(gross * f.taxRate) : 0
  return { gross, fee, tax, net: round2(gross - fee - tax) }
}

export function settle(side, price, shares, fees) {
  return side === 'SELL' ? sellProceeds(price, shares, fees) : buyCost(price, shares, fees)
}

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100
}
