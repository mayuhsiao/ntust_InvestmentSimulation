import { DEFAULT_FEES } from '../lib/fees.js'

/** 競賽預設設定（老師可在「管理設定」頁修改） */
export const DEFAULT_CONFIG = {
  name: '115-1 學期 台股投資模擬競賽',
  startDate: '2026-09-17',
  endDate: '2026-12-22',
  initialCapital: 2000000,
  benchmark: '0050',
  lockTrading: false, // 鎖定後學生無法下單（結算/展示用）
  allowShort: false, // 不允許超賣（賣出不得超過持股）
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
