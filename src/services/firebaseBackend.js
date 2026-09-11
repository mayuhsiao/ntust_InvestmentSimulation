/**
 * Firebase 後端（Auth + Firestore）
 * ------------------------------------------------------------------
 * 學生以「學號 + 密碼」登入：內部把學號轉成 {學號}@ntust-invest.local
 * 當作 Firebase Auth 的信箱，學生完全不用記信箱。
 *
 * Firestore 結構：
 *   config/contest                競賽設定
 *   students/{學號}               學生名單（含 role、是否已啟用）
 *   trades/{autoId}               每一筆買賣紀錄
 *   prices/{代號}                 日收盤價快取
 *   settlements/{YYYY-MM-DD}      每日結算淨值
 */

import { getFirebase, emailFor, normalizeId, isAdminId } from '../firebase.js'
import { DEFAULT_CONFIG, COLLECTIONS, CONFIG_DOC, makeStudent } from './defaults.js'

const AUTH_ERRORS = {
  'auth/invalid-credential': '學號或密碼錯誤',
  'auth/wrong-password': '學號或密碼錯誤',
  'auth/user-not-found': '帳號尚未啟用，請先點選「首次啟用帳號」',
  'auth/invalid-email': '學號格式不正確',
  'auth/email-already-in-use': '此帳號已啟用，請直接登入',
  'auth/weak-password': '密碼至少 6 個字元',
  'auth/too-many-requests': '嘗試次數過多，請稍後再試',
  'auth/network-request-failed': '網路連線失敗，請檢查網路後再試',
  'auth/operation-not-allowed': 'Firebase 尚未啟用「電子郵件/密碼」登入方式',
}

function friendly(err) {
  const code = err?.code || ''
  if (AUTH_ERRORS[code]) return new Error(AUTH_ERRORS[code])
  if (code === 'permission-denied') {
    return new Error('權限不足：請確認 Firestore 安全性規則已部署，且你的學號在管理者名單中')
  }
  return err instanceof Error ? err : new Error(String(err))
}

function idFromEmail(email) {
  return normalizeId(String(email || '').split('@')[0])
}

function clean(obj) {
  const out = {}
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v
  return out
}

export function createFirebaseBackend() {
  return {
    mode: 'firebase',
    label: 'Firebase 雲端資料庫',

    /* ---------------- 帳號 ---------------- */
    onAuthChange(cb) {
      let unsubscribe = () => {}
      let cancelled = false
      getFirebase()
        .then(({ auth, fbAuth }) => {
          if (cancelled) return
          unsubscribe = fbAuth.onAuthStateChanged(auth, (user) => {
            cb(user ? idFromEmail(user.email) : null)
          })
        })
        .catch((err) => {
          console.error('[firebase] 初始化失敗', err)
          cb(null)
        })
      return () => {
        cancelled = true
        unsubscribe()
      }
    },

    async signIn(studentId, password) {
      const { auth, fbAuth } = await getFirebase()
      const id = normalizeId(studentId)
      if (!id) throw new Error('請輸入學號')
      try {
        await fbAuth.signInWithEmailAndPassword(auth, emailFor(id), password)
        return id
      } catch (err) {
        throw friendly(err)
      }
    },

    /**
     * 首次啟用：先建立 Auth 帳號，再確認學號有沒有在老師匯入的名單裡。
     * 不在名單中就把剛建立的帳號刪掉，避免留下孤兒帳號。
     */
    async activate(studentId, password, { name, group } = {}) {
      const { auth, db, fbAuth, fs } = await getFirebase()
      const id = normalizeId(studentId)
      if (!id) throw new Error('請輸入學號')
      if (String(password).length < 6) throw new Error('密碼至少 6 個字元')

      let credential
      try {
        credential = await fbAuth.createUserWithEmailAndPassword(auth, emailFor(id), password)
      } catch (err) {
        throw friendly(err)
      }

      try {
        const ref = fs.doc(db, COLLECTIONS.students, id)
        const snap = await fs.getDoc(ref)
        const admin = isAdminId(id)

        if (!snap.exists()) {
          if (!admin) {
            throw new Error('名單中查無此學號，請聯絡老師確認名單是否已匯入')
          }
          await fs.setDoc(
            ref,
            clean(
              makeStudent({
                studentId: id,
                name: name || id,
                group: group || '',
                role: 'admin',
                activated: true,
                uid: credential.user.uid,
                activatedAt: fs.serverTimestamp(),
                createdAt: fs.serverTimestamp(),
              }),
            ),
          )
        } else {
          await fs.updateDoc(
            ref,
            clean({
              uid: credential.user.uid,
              activated: true,
              activatedAt: fs.serverTimestamp(),
              name: name || snap.data().name || id,
              group: group || snap.data().group || '',
              role: admin ? 'admin' : snap.data().role || 'student',
            }),
          )
        }
        return id
      } catch (err) {
        // 啟用失敗就回收剛剛建立的帳號，學生可以重試
        try {
          await fbAuth.deleteUser(credential.user)
        } catch {
          /* 刪不掉就算了，老師可在 Console 移除 */
        }
        throw friendly(err)
      }
    },

    async signOut() {
      const { auth, fbAuth } = await getFirebase()
      await fbAuth.signOut(auth)
    },

    async changePassword(studentId, oldPassword, newPassword) {
      const { auth, fbAuth } = await getFirebase()
      const user = auth.currentUser
      if (!user) throw new Error('請先登入')
      if (String(newPassword).length < 6) throw new Error('新密碼至少 6 個字元')
      try {
        const cred = fbAuth.EmailAuthProvider.credential(user.email, oldPassword)
        await fbAuth.reauthenticateWithCredential(user, cred)
        await fbAuth.updatePassword(user, newPassword)
      } catch (err) {
        if (err?.code === 'auth/invalid-credential' || err?.code === 'auth/wrong-password') {
          throw new Error('原密碼錯誤')
        }
        throw friendly(err)
      }
    },

    /** 雲端模式無法由前端直接改別人的密碼，改成清除啟用狀態讓學生重新啟用 */
    async resetPassword(studentId) {
      const { db, fs } = await getFirebase()
      const id = normalizeId(studentId)
      await fs.updateDoc(fs.doc(db, COLLECTIONS.students, id), { activated: false, uid: null })
      throw new Error(
        `已清除 ${id} 的啟用狀態。請再到 Firebase 主控台 → Authentication 刪除 ${emailFor(id)}，該生即可重新啟用帳號。`,
      )
    },

    /* ---------------- 設定 ---------------- */
    async loadConfig() {
      const { db, fs } = await getFirebase()
      const snap = await fs.getDoc(fs.doc(db, COLLECTIONS.config, CONFIG_DOC))
      return { ...DEFAULT_CONFIG, ...(snap.exists() ? snap.data() : {}) }
    },

    async saveConfig(patch) {
      const { db, fs } = await getFirebase()
      const ref = fs.doc(db, COLLECTIONS.config, CONFIG_DOC)
      await fs.setDoc(ref, clean({ ...patch, updatedAt: fs.serverTimestamp() }), { merge: true })
      return this.loadConfig()
    },

    /* ---------------- 學生 ---------------- */
    async loadStudents() {
      const { db, fs } = await getFirebase()
      const snap = await fs.getDocs(fs.collection(db, COLLECTIONS.students))
      return snap.docs.map((d) => makeStudent({ ...d.data(), studentId: d.id }))
    },

    async saveStudents(list) {
      const { db, fs } = await getFirebase()
      const chunks = []
      for (let i = 0; i < list.length; i += 400) chunks.push(list.slice(i, i + 400))

      for (const chunk of chunks) {
        const batch = fs.writeBatch(db)
        for (const raw of chunk) {
          const id = normalizeId(raw.studentId)
          if (!id) continue
          const { studentId, activated, uid, activatedAt, ...rest } = raw
          batch.set(
            fs.doc(db, COLLECTIONS.students, id),
            clean({ ...rest, studentId: id, updatedAt: fs.serverTimestamp() }),
            { merge: true },
          )
        }
        await batch.commit()
      }
      return this.loadStudents()
    },

    async removeStudent(studentId) {
      const { db, fs } = await getFirebase()
      const id = normalizeId(studentId)
      const trades = await fs.getDocs(
        fs.query(fs.collection(db, COLLECTIONS.trades), fs.where('studentId', '==', id)),
      )
      const batch = fs.writeBatch(db)
      trades.docs.forEach((d) => batch.delete(d.ref))
      batch.delete(fs.doc(db, COLLECTIONS.students, id))
      await batch.commit()
    },

    /* ---------------- 交易 ---------------- */
    async loadTrades() {
      const { db, fs } = await getFirebase()
      const snap = await fs.getDocs(fs.query(fs.collection(db, COLLECTIONS.trades), fs.orderBy('date')))
      return snap.docs.map((d) => ({ ...d.data(), id: d.id }))
    },

    async addTrade(trade) {
      const { db, fs } = await getFirebase()
      const ref = await fs.addDoc(
        fs.collection(db, COLLECTIONS.trades),
        clean({ ...trade, createdAt: fs.serverTimestamp() }),
      )
      return { ...trade, id: ref.id, createdAt: Date.now() }
    },

    async removeTrade(id) {
      const { db, fs } = await getFirebase()
      await fs.deleteDoc(fs.doc(db, COLLECTIONS.trades, id))
    },

    /* ---------------- 報價快取 ---------------- */
    async loadPrices() {
      const { db, fs } = await getFirebase()
      const snap = await fs.getDocs(fs.collection(db, COLLECTIONS.prices))
      const out = {}
      snap.docs.forEach((d) => {
        out[d.id] = d.data()
      })
      return out
    },

    async savePrices(entries) {
      const { db, fs } = await getFirebase()
      const list = Object.entries(entries)
      for (let i = 0; i < list.length; i += 300) {
        const batch = fs.writeBatch(db)
        for (const [code, data] of list.slice(i, i + 300)) {
          // 不用 merge：呼叫端已經合併成完整快取，
          // merge 會把 closes 當成 map 做深層合併，導致移除掉的日期又被寫回來。
          batch.set(
            fs.doc(db, COLLECTIONS.prices, code),
            clean({ ...data, code, updatedAt: fs.serverTimestamp() }),
          )
        }
        await batch.commit()
      }
      return entries
    },

    /* ---------------- 每日結算 ---------------- */
    async loadSettlements() {
      const { db, fs } = await getFirebase()
      const snap = await fs.getDocs(fs.collection(db, COLLECTIONS.settlements))
      return snap.docs.map((d) => ({ ...d.data(), date: d.id })).sort((a, b) => a.date.localeCompare(b.date))
    },

    async saveSettlements(rows) {
      const { db, fs } = await getFirebase()
      for (let i = 0; i < rows.length; i += 300) {
        const batch = fs.writeBatch(db)
        for (const row of rows.slice(i, i + 300)) {
          batch.set(
            fs.doc(db, COLLECTIONS.settlements, row.date),
            clean({ ...row, createdAt: fs.serverTimestamp() }),
          )
        }
        await batch.commit()
      }
      return rows
    },
  }
}
