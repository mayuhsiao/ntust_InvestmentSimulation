/**
 * 台股交易成本計算
 * ------------------------------------------------------------------
 *   手續費 = 成交金額 × 0.1425% × 折扣（未滿最低手續費以最低收取）
 *   證交稅 = 成交金額 × 0.3%（僅賣出收取；ETF 為 0.1%，可在設定頁調整）
 * 券商實務上手續費與證交稅皆採無條件捨去到元。
 */

export const DEFAULT_FEES = {
  feeRate: 0.001425, // 台股手續費率
  feeDiscount: 1, // 折扣（0.6 = 6 折）
  minFee: 20, // 最低手續費（元）
  taxRate: 0.003, // 證交稅率（賣出）

  // 美股（以國內券商複委託的收費方式模擬）
  usFeeRate: 0.005, // 手續費率 0.5%
  usMinFee: 500, // 最低手續費（新台幣，約 15 美元）
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

/**
 * 通用結算：支援美股與匯率換算，回傳的金額一律是新台幣。
 *
 * @param {object} o
 * @param {'BUY'|'SELL'} o.side
 * @param {number} o.price   原幣成交價（美股為美元）
 * @param {number} o.shares  股數
 * @param {number} o.fxRate  匯率（台股為 1；美股為當日 USD/TWD）
 * @param {'TW'|'US'} o.market
 */
export function settleTrade({ side, price, shares, fxRate = 1, market = 'TW', fees }) {
  const f = normalize(fees)
  const gross = round2(price * shares * fxRate)
  if (gross <= 0) return { gross: 0, fee: 0, tax: 0, net: 0 }

  let fee
  let tax = 0
  if (market === 'US') {
    // 複委託：按成交金額計費，未達最低手續費以最低收取；美股無證交稅
    fee = Math.max(Math.floor(gross * f.usFeeRate), Math.min(f.usMinFee, Math.floor(gross)))
  } else {
    fee = commission(gross, f)
    if (side === 'SELL') tax = Math.floor(gross * f.taxRate)
  }

  return {
    gross,
    fee,
    tax,
    net: side === 'SELL' ? round2(gross - fee - tax) : round2(gross + fee),
  }
}

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100
}
