import { DEFAULT_FEES } from '../lib/fees.js'

/** 競賽預設設定（老師可在「管理設定」頁修改） */
export const DEFAULT_CONFIG = {
  name: '115-1 學期 台股投資模擬競賽',

  // 測試期：先從 9/1 起算，讓同學一進來就有幾天真實走勢可看、也能立刻下單。
  // 9/17 正式開賽前，老師到「管理 → 競賽設定 → 正式開賽重置」一鍵切換。
  startDate: '2026-09-01',
  endDate: '2026-12-22',

  /** 這天（含）以前為測試期，畫面會顯示提醒；留空代表已正式開賽 */
  practiceUntil: '2026-09-16',
  /** 正式開賽日，「正式開賽重置」會把 startDate 換成這一天 */
  officialStartDate: '2026-09-17',

  /** 班級網站，會顯示在登入頁與導覽列 */
  classSiteUrl: 'https://emrd115.netlify.app/',

  initialCapital: 2000000,
  benchmark: '0050',
  lockTrading: false, // 鎖定後學生無法下單（結算/展示用）
  allowShort: false, // 不允許超賣（賣出不得超過持股）

  /**
   * 交易時段限制
   *   'afterClose' 盤中（平日 09:00–14:00）不開放下單，只能在收盤後交易
   *   'always'     不限時段
   */
  tradingWindow: 'afterClose',
  ...DEFAULT_FEES,
}

export const COLLECTIONS = {
  config: 'config',
  students: 'students',
  trades: 'trades',
  prices: 'prices',
  settlements: 'settlements',
}

export const CONFIG_DOC = 'contest'

export function makeStudent(partial = {}) {
  return {
    studentId: '',
    name: '',
    group: '',
    role: 'student',
    activated: false,
    uid: null,
    initialCapital: null, // null = 沿用競賽預設本金
    note: '',
    ...partial,
  }
}
