/**
 * 本機示範後端
 * ------------------------------------------------------------------
 * 尚未設定 Firebase 時使用，資料全部存在瀏覽器 localStorage。
 * 介面與 firebaseBackend 完全相同，之後填好 Firebase 設定即可無痛切換。
 * 密碼以 SHA-256 雜湊後存放（僅為示範用途，正式競賽請使用 Firebase）。
 */

import { DEFAULT_CONFIG, makeStudent } from './defaults.js'
import { normalizeId, isAdminId } from '../firebase.js'

const NS = 'ntust-invest:'
const K = {
  config: `${NS}config`,
  students: `${NS}students`,
  trades: `${NS}trades`,
  prices: `${NS}prices`,
  settlements: `${NS}settlements`,
  secrets: `${NS}secrets`,
  session: `${NS}session`,
}

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch (err) {
    throw new Error(`瀏覽器儲存空間不足或被封鎖：${err.message}`)
  }
}

async function hash(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`ntust::${text}`))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

const listeners = new Set()
function emitAuth(id) {
  for (const cb of listeners) cb(id)
}

const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`

export function createLocalBackend() {
  return {
    mode: 'local',
    label: '本機示範模式',

    /* ---------------- 帳號 ---------------- */
    currentId: () => read(K.session, null),

    onAuthChange(cb) {
      listeners.add(cb)
      cb(read(K.session, null))
      return () => listeners.delete(cb)
    },

    async signIn(studentId, password) {
      const id = normalizeId(studentId)
      const secrets = read(K.secrets, {})
      if (!secrets[id]) throw new Error('帳號尚未啟用，請先點選「首次啟用帳號」')
      if (secrets[id] !== (await hash(password))) throw new Error('學號或密碼錯誤')
      write(K.session, id)
      emitAuth(id)
      return id
    },

    async activate(studentId, password, { name, group } = {}) {
      const id = normalizeId(studentId)
      if (!id) throw new Error('請輸入學號')
      if (String(password).length < 6) throw new Error('密碼至少 6 個字元')

      const secrets = read(K.secrets, {})
      if (secrets[id]) throw new Error('此帳號已啟用，請直接登入')

      const students = read(K.students, [])
      let student = students.find((s) => s.studentId === id)
      const roster = students.filter((s) => s.role !== 'admin')

      if (!student) {
        // 名單裡沒有這個學號：只有管理者或第一位使用者可以自行建立
        if (!isAdminId(id) && roster.length > 0) {
          throw new Error('名單中查無此學號，請聯絡老師確認')
        }
        student = makeStudent({
          studentId: id,
          name: name || id,
          group: group || '',
          role: isAdminId(id) || roster.length === 0 ? 'admin' : 'student',
        })
        students.push(student)
      }
      student.activated = true
      student.activatedAt = Date.now()
      if (name) student.name = name
      if (group) student.group = group
      if (isAdminId(id)) student.role = 'admin'

      write(K.students, students)
      secrets[id] = await hash(password)
      write(K.secrets, secrets)
      write(K.session, id)
      emitAuth(id)
      return id
    },

    async signOut() {
      localStorage.removeItem(K.session)
      emitAuth(null)
    },

    async changePassword(studentId, oldPassword, newPassword) {
      const id = normalizeId(studentId)
      const secrets = read(K.secrets, {})
      if (secrets[id] !== (await hash(oldPassword))) throw new Error('原密碼錯誤')
      if (String(newPassword).length < 6) throw new Error('新密碼至少 6 個字元')
      secrets[id] = await hash(newPassword)
      write(K.secrets, secrets)
    },

    async resetPassword(studentId, newPassword) {
      const id = normalizeId(studentId)
      const secrets = read(K.secrets, {})
      secrets[id] = await hash(newPassword)
      write(K.secrets, secrets)
      const students = read(K.students, [])
      const s = students.find((x) => x.studentId === id)
      if (s) {
        s.activated = true
        write(K.students, students)
      }
    },

    /* ---------------- 設定 ---------------- */
    async loadConfig() {
      return { ...DEFAULT_CONFIG, ...read(K.config, {}) }
    },

    async saveConfig(patch) {
      const next = { ...DEFAULT_CONFIG, ...read(K.config, {}), ...patch, updatedAt: Date.now() }
      write(K.config, next)
      return next
    },

    /* ---------------- 學生 ---------------- */
    async loadStudents() {
      return read(K.students, []).map((s) => makeStudent(s))
    },

    async saveStudents(list) {
      const existing = read(K.students, [])
      const byId = new Map(existing.map((s) => [s.studentId, s]))
      for (const raw of list) {
        const s = makeStudent({ ...raw, studentId: normalizeId(raw.studentId) })
        byId.set(s.studentId, { ...(byId.get(s.studentId) || {}), ...s })
      }
      const next = [...byId.values()]
      write(K.students, next)
      return next
    },

    async removeStudent(studentId) {
      const id = normalizeId(studentId)
      write(K.students, read(K.students, []).filter((s) => s.studentId !== id))
      write(K.trades, read(K.trades, []).filter((t) => t.studentId !== id))
      const secrets = read(K.secrets, {})
      delete secrets[id]
      write(K.secrets, secrets)
    },

    /* ---------------- 交易 ---------------- */
    async loadTrades() {
      return read(K.trades, [])
    },

    async addTrade(trade) {
      const trades = read(K.trades, [])
      const record = { ...trade, id: uid(), createdAt: Date.now() }
      trades.push(record)
      write(K.trades, trades)
      return record
    },

    async removeTrade(id) {
      write(K.trades, read(K.trades, []).filter((t) => t.id !== id))
    },

    /* ---------------- 報價快取 ---------------- */
    async loadPrices() {
      return read(K.prices, {})
    },

    // 呼叫端送進來的已經是合併好的完整快取，這裡整筆覆寫。
    // 若在這裡再合併一次，之前被移除的資料（例如尚未收盤的盤中價）會被救回來。
    async savePrices(entries) {
      const prices = read(K.prices, {})
      for (const [code, data] of Object.entries(entries)) prices[code] = data
      write(K.prices, prices)
      return prices
    },

    /* ---------------- 每日結算紀錄 ---------------- */
    async loadSettlements() {
      return read(K.settlements, [])
    },

    async saveSettlements(rows) {
      const existing = read(K.settlements, [])
      const byDate = new Map(existing.map((r) => [r.date, r]))
      for (const r of rows) byDate.set(r.date, r)
      const next = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
      write(K.settlements, next)
      return next
    },

    async reset() {
      for (const key of Object.values(K)) localStorage.removeItem(key)
      emitAuth(null)
    },
  }
}
