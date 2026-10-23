/**
 * Firebase 後端（Auth + Firestore）
 * ------------------------------------------------------------------
 * 學生以「學號 + 密碼」登入：內部把學號轉成 {學號}@ntust-invest.local
 * 當作 Firebase Auth 的信箱，學生完全不用記信箱。
 *
 * Firestore 結構：
 *   config/contest                競賽設定（含 rosterEpoch／tradesEpoch，見 loadClassData）
 *   students/{學號}               學生名單（含 role、是否已啟用）
 *   trades/{autoId}               每一筆買賣紀錄
 *   prices/_pack0…                日收盤價快取，全部股票打包成一份文件（見 loadPrices）
 *   prices/{代號}                 舊版的一檔一份快取，只在打包文件不存在時才讀
 *   settlements/{YYYY-MM-DD}      每日結算淨值
 *
 * Spark 免費方案每天只有 5 萬次讀取，所以讀取一律盡量省：
 * 全班名單與交易紀錄存在瀏覽器（IndexedDB），每次只補抓變動的部分；
 * 報價快取打包成單一文件；每日結算只有老師的管理頁會讀。
 */

import { getFirebase, emailFor, normalizeId, isAdminId } from '../firebase.js'
import { DEFAULT_CONFIG, COLLECTIONS, CONFIG_DOC, makeStudent } from './defaults.js'
import { readCache, writeCache, removeCache } from './localCache.js'
import { plain, latest, mergeSince, asciiJson, chunkText } from '../lib/sync.js'
import { sortTrades } from '../lib/portfolio.js'

const AUTH_ERRORS = {
  'auth/invalid-credential': '學號或密碼錯誤',
  'auth/wrong-password': '學號或密碼錯誤',
  'auth/user-not-found': '帳號尚未啟用，請先點選「首次啟用帳號」',
  'auth/invalid-email': '學號格式不正確',
  'auth/email-already-in-use': '此帳號已啟用，請直接登入',
  'auth/weak-password': '密碼至少 6 個字元',
  'auth/too-many-requests': '嘗試次數過多，請稍後再試',
  'auth/network-request-failed': '網路連線失敗，請檢查網路後再試',
  'auth/operation-not-allowed':
    'Firebase 尚未啟用「電子郵件/密碼」登入方式。請到 Firebase 主控台 → Authentication → Sign-in method 啟用。',
  // 專案根本還沒開過 Authentication 時會是這個錯誤
  'auth/configuration-not-found':
    'Firebase 專案尚未啟用 Authentication。請到 Firebase 主控台 → Authentication → 開始使用 → 選「電子郵件/密碼」並啟用，然後重新整理本頁。',
  'auth/invalid-api-key': 'Firebase 設定有誤：API 金鑰不正確，請檢查環境變數 VITE_FIREBASE_API_KEY。',
  'auth/api-key-not-valid': 'Firebase 設定有誤：API 金鑰不正確，請檢查環境變數 VITE_FIREBASE_API_KEY。',
  'auth/admin-restricted-operation': 'Firebase 目前限制自行註冊，請到 Authentication → Settings 關閉限制。',
}

function friendly(err) {
  const code = err?.code || ''
  if (AUTH_ERRORS[code]) return new Error(AUTH_ERRORS[code])
  if (code === 'permission-denied') {
    return new Error(
      '權限不足：請確認 firestore.rules 已部署到 Firebase，且你的學號有列在規則的 adminIds() 名單中。',
    )
  }
  if (code === 'unavailable') return new Error('連不上 Firestore，請檢查網路連線後再試')
  // 沒對應到的錯誤至少把代碼帶出來，方便查
  if (code) return new Error(`${err.message || '操作失敗'}（${code}）`)
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

const toStudent = (snap) => makeStudent({ ...plain(snap.data()), studentId: snap.id })
const toTrade = (snap) => ({ ...plain(snap.data()), id: snap.id })

/* ---------------- 本機快取與增量同步 ---------------- */

/** 瀏覽器快取的格式版本，格式改變時加一，舊快取自動作廢 */
const CACHE_FORMAT = 1
const cacheKey = (app) => `class:${app.options.projectId}`

/**
 * 交易紀錄每次都往回重抓這段時間。學生可以撤銷 30 分鐘內的交易（見 firestore.rules），
 * 重抓這段就能發現被撤銷的紀錄；更早的交易學生已經刪不掉，只有老師能刪（會遞增 tradesEpoch）。
 */
const TRADE_LOOKBACK = 35 * 60 * 1000
/** 名單只會在註冊、啟用帳號時變動（都會寫入 activatedAt），留一點緩衝即可 */
const ROSTER_LOOKBACK = 5 * 60 * 1000

/**
 * 增量同步看不到「刪除」與「修改」，所以老師刪交易、改名單時，
 * 把 config/contest 的版本號加一，大家的瀏覽器快取對不上就會整包重抓一次。
 */
const EPOCH_FIELD = { students: 'rosterEpoch', trades: 'tradesEpoch' }

function bumpEpochs(batch, fs, db, ...collections) {
  const patch = {}
  for (const name of collections) patch[EPOCH_FIELD[name]] = fs.increment(1)
  batch.set(fs.doc(db, COLLECTIONS.config, CONFIG_DOC), patch, { merge: true })
}

/* ---------------- 報價快取打包 ---------------- */

const PACK_IDS = ['_pack0', '_pack1', '_pack2', '_pack3']
/** 每段的字元數；asciiJson 保證一個字元一個位元組，單一文件上限 1 MiB */
const PACK_PART_SIZE = 900_000

export function createFirebaseBackend() {
  /** 上次讀到的報價快取來源：'pack' 打包文件／'legacy' 舊版一檔一份 */
  let priceSource = null

  /**
   * 註冊過程中會先建立 Auth 帳號，那一瞬間 Firebase 就會回報「已登入」，
   * App 會立刻切到登入後的畫面，害後面的錯誤訊息沒地方顯示。
   * 因此註冊期間先擋住狀態通知，等整個流程有結果了再一次送出。
   */
  let suppressAuth = false
  let authCallback = null
  const emitAuth = (id) => authCallback?.(id)

  return {
    mode: 'firebase',
    label: 'Firebase 雲端資料庫',

    /* ---------------- 帳號 ---------------- */
    onAuthChange(cb) {
      authCallback = cb
      let unsubscribe = () => {}
      let cancelled = false
      getFirebase()
        .then(({ auth, fbAuth }) => {
          if (cancelled) return
          unsubscribe = fbAuth.onAuthStateChanged(auth, (user) => {
            if (suppressAuth) return
            cb(user ? idFromEmail(user.email) : null)
          })
        })
        .catch((err) => {
          console.error('[firebase] 初始化失敗', err)
          cb(null)
        })
      return () => {
        cancelled = true
        authCallback = null
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

    /** 讀自己的名單資料（安全性規則永遠允許讀自己那一筆） */
    async getStudent(studentId) {
      const { db, fs } = await getFirebase()
      const id = normalizeId(studentId)
      if (!id) return null
      const snap = await fs.getDoc(fs.doc(db, COLLECTIONS.students, id))
      return snap.exists() ? toStudent(snap) : null
    },

    /**
     * 加入名單（已經登入才能呼叫）
     *   a) 學號已在老師匯入的名單中 → 直接認領，不需要認證碼
     *   b) 學號不在名單中           → 需要老師公布的註冊認證碼
     */
    async joinRoster(studentId, { name, group, joinCode } = {}) {
      const { auth, db, fs } = await getFirebase()
      const id = normalizeId(studentId)
      const user = auth.currentUser
      if (!user) throw new Error('請先登入')

      const ref = fs.doc(db, COLLECTIONS.students, id)
      const snap = await fs.getDoc(ref)
      const admin = isAdminId(id)

      try {
        if (snap.exists()) {
          await fs.updateDoc(
            ref,
            clean({
              uid: user.uid,
              activated: true,
              activatedAt: fs.serverTimestamp(),
              name: name || snap.data().name || id,
              group: group || snap.data().group || '',
              role: admin ? 'admin' : snap.data().role || 'student',
            }),
          )
        } else if (admin) {
          await fs.setDoc(
            ref,
            clean(
              makeStudent({
                studentId: id,
                name: name || id,
                group: group || '',
                role: 'admin',
                activated: true,
                uid: user.uid,
                activatedAt: fs.serverTimestamp(),
                createdAt: fs.serverTimestamp(),
              }),
            ),
          )
        } else {
          if (!joinCode) throw new Error('請輸入老師公布的註冊認證碼')
          if (!name) throw new Error('請輸入姓名')
          // joinCode 會存進文件中，讓 firestore.rules 比對 config/secret 的認證碼。
          // 只有同班同學（名單成員）讀得到，而他們本來就知道這組認證碼。
          await fs.setDoc(
            ref,
            clean(
              makeStudent({
                studentId: id,
                name,
                group: group || '',
                role: 'student',
                activated: true,
                uid: user.uid,
                joinCode,
                selfRegistered: true,
                activatedAt: fs.serverTimestamp(),
                createdAt: fs.serverTimestamp(),
              }),
            ),
          )
        }
        return id
      } catch (err) {
        if (err?.code === 'permission-denied') {
          throw new Error('註冊認證碼不正確，或老師尚未開放自行註冊。請向老師確認後再試一次。')
        }
        throw friendly(err)
      }
    },

    /**
     * 註冊：先建立 Auth 帳號，再加入名單。
     * 若加入名單失敗（例如認證碼打錯），**保留登入狀態不刪帳號**，
     * 讓 App 顯示「完成註冊」畫面直接重試，不必重新設定密碼。
     *
     * 學號已經有帳號時（多半是上次註冊到一半失敗），
     * 直接用同一組密碼登入後續完成加入名單 —— 對同學來說就是「再註冊一次就好」。
     */
    async activate(studentId, password, { name, group, joinCode } = {}) {
      const { auth, fbAuth } = await getFirebase()
      const id = normalizeId(studentId)
      if (!id) throw new Error('請輸入學號')
      if (String(password).length < 6) throw new Error('密碼至少 6 個字元')

      suppressAuth = true
      let createdHere = false
      try {
        try {
          await fbAuth.createUserWithEmailAndPassword(auth, emailFor(id), password)
          createdHere = true
        } catch (err) {
          if (err?.code !== 'auth/email-already-in-use') throw friendly(err)
          // 學號已經有帳號（多半是上次註冊到一半失敗）：密碼對得上就接續完成
          try {
            await fbAuth.signInWithEmailAndPassword(auth, emailFor(id), password)
          } catch {
            throw new Error(
              `學號 ${id} 已經註冊過了。請切換到「登入」分頁，用當初設定的密碼登入；` +
                '若忘記密碼，請聯絡老師協助重設。',
            )
          }
        }

        await this.joinRoster(id, { name, group, joinCode })
        return id
      } catch (err) {
        // 這次才建立的帳號就回收掉，不要在 Firebase 留下「有帳號卻不在名單」的孤兒，
        // 否則同學下次連重新註冊都會被擋，只能找老師到主控台刪除。
        if (createdHere && auth.currentUser) {
          try {
            await fbAuth.deleteUser(auth.currentUser)
          } catch {
            /* 刪不掉就登出，至少畫面狀態是乾淨的 */
          }
        }
        try {
          if (auth.currentUser) await fbAuth.signOut(auth)
        } catch {
          /* ignore */
        }
        throw err
      } finally {
        suppressAuth = false
        emitAuth(auth.currentUser ? idFromEmail(auth.currentUser.email) : null)
      }
    },

    /** 放棄註冊時刪掉自己的帳號，避免留下用不到的孤兒帳號 */
    async deleteOwnAccount() {
      const { auth, fbAuth } = await getFirebase()
      if (auth.currentUser) await fbAuth.deleteUser(auth.currentUser)
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
      const batch = fs.writeBatch(db)
      batch.update(fs.doc(db, COLLECTIONS.students, id), { activated: false, uid: null })
      bumpEpochs(batch, fs, db, 'students')
      await batch.commit()
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

    /**
     * 註冊認證碼放在 config/secret，安全性規則設定成只有老師讀得到。
     * 規則本身的 get() 不受用戶端讀取權限限制，所以仍能拿它驗證註冊。
     */
    async loadJoinCode() {
      const { db, fs } = await getFirebase()
      try {
        const snap = await fs.getDoc(fs.doc(db, COLLECTIONS.config, 'secret'))
        return snap.exists() ? snap.data().registrationCode || '' : ''
      } catch {
        return '' // 非老師讀不到，屬正常情況
      }
    },

    async saveJoinCode(code) {
      const { db, fs } = await getFirebase()
      await fs.setDoc(
        fs.doc(db, COLLECTIONS.config, 'secret'),
        { registrationCode: String(code || '').trim(), updatedAt: fs.serverTimestamp() },
        { merge: true },
      )
    },

    /* ---------------- 全班資料（增量同步） ---------------- */
    /**
     * 全班名單 + 交易紀錄。優先用瀏覽器快取，只向 Firestore 補抓有變動的部分：
     *   交易：createdAt 在「快取中最新一筆往前 TRADE_LOOKBACK」之後的文件
     *   名單：activatedAt 在快取之後的文件（自行註冊、首次啟用都會寫入）
     * config 的 rosterEpoch／tradesEpoch 與快取不同時（老師刪改過資料），該部分整包重讀。
     * 一律向伺服器查詢（getDocsFromServer）：離線時寧可報錯，也不要把不完整的結果存進快取。
     */
    async loadClassData(config = {}) {
      const { app, db, fs } = await getFirebase()
      const key = cacheKey(app)
      const rosterEpoch = Number(config.rosterEpoch) || 0
      const tradesEpoch = Number(config.tradesEpoch) || 0
      const cached = await readCache(key)
      const usable =
        cached?.format === CACHE_FORMAT && Array.isArray(cached.students) && Array.isArray(cached.trades)

      const changedSince = async (name, field, since) => {
        const snap = await fs.getDocsFromServer(
          fs.query(fs.collection(db, name), fs.where(field, '>=', fs.Timestamp.fromMillis(since))),
        )
        return snap.docs
      }

      const syncStudents = async () => {
        if (!usable || cached.rosterEpoch !== rosterEpoch) return this.loadStudents()
        const since = latest(cached.students, 'activatedAt') - ROSTER_LOOKBACK
        const docs = await changedSince(COLLECTIONS.students, 'activatedAt', since)
        return mergeSince(cached.students, docs.map(toStudent), { field: 'activatedAt', since, key: 'studentId' })
      }

      const syncTrades = async () => {
        if (!usable || cached.tradesEpoch !== tradesEpoch) return this.loadTrades()
        const since = latest(cached.trades, 'createdAt') - TRADE_LOOKBACK
        const docs = await changedSince(COLLECTIONS.trades, 'createdAt', since)
        return sortTrades(mergeSince(cached.trades, docs.map(toTrade), { field: 'createdAt', since, key: 'id' }))
      }

      const [students, trades] = await Promise.all([syncStudents(), syncTrades()])
      await writeCache(key, { format: CACHE_FORMAT, rosterEpoch, tradesEpoch, students, trades, savedAt: Date.now() })
      return { students, trades }
    },

    /** 登出時清掉瀏覽器裡的全班資料（共用電腦） */
    async forgetLocalCache() {
      const { app } = await getFirebase()
      await removeCache(cacheKey(app))
    },

    /** 讓所有人的瀏覽器快取作廢（老師直接在 Firebase 主控台改過資料時用） */
    async invalidateCaches() {
      const { db, fs } = await getFirebase()
      const batch = fs.writeBatch(db)
      bumpEpochs(batch, fs, db, 'students', 'trades')
      await batch.commit()
    },

    /* ---------------- 學生 ---------------- */
    async loadStudents() {
      const { db, fs } = await getFirebase()
      const snap = await fs.getDocsFromServer(fs.collection(db, COLLECTIONS.students))
      return snap.docs.map(toStudent)
    },

    async saveStudents(list) {
      const { db, fs } = await getFirebase()
      const chunks = []
      for (let i = 0; i < list.length; i += 400) chunks.push(list.slice(i, i + 400))

      for (const [n, chunk] of chunks.entries()) {
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
        if (n === chunks.length - 1) bumpEpochs(batch, fs, db, 'students')
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
      bumpEpochs(batch, fs, db, 'students', 'trades')
      await batch.commit()
    },

    /* ---------------- 交易 ---------------- */
    async loadTrades() {
      const { db, fs } = await getFirebase()
      const snap = await fs.getDocsFromServer(fs.query(fs.collection(db, COLLECTIONS.trades), fs.orderBy('date')))
      return snap.docs.map(toTrade)
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
      const batch = fs.writeBatch(db)
      batch.delete(fs.doc(db, COLLECTIONS.trades, id))
      bumpEpochs(batch, fs, db, 'trades')
      try {
        await batch.commit()
      } catch (err) {
        // 學生撤銷自己 30 分鐘內的交易時沒有權限改設定；
        // 那段期間每次同步都會重抓（TRADE_LOOKBACK），不必通知也看得到刪除
        if (err?.code !== 'permission-denied') throw err
        await fs.deleteDoc(fs.doc(db, COLLECTIONS.trades, id))
      }
    },

    /** 清空整個集合（重置測試資料用），回傳刪除筆數 */
    async clearCollection(name) {
      const { db, fs } = await getFirebase()
      const snap = await fs.getDocs(fs.collection(db, name))
      const docs = snap.docs
      for (let i = 0; i < docs.length; i += 400) {
        const batch = fs.writeBatch(db)
        docs.slice(i, i + 400).forEach((d) => batch.delete(d.ref))
        await batch.commit()
      }
      // 全部刪完才通知，避免有人在刪到一半時重抓，又把還沒刪掉的資料存進快取
      if (EPOCH_FIELD[name]) {
        const batch = fs.writeBatch(db)
        bumpEpochs(batch, fs, db, name)
        await batch.commit()
      }
      return docs.length
    },

    /* ---------------- 報價快取 ---------------- */
    /**
     * 全部股票的日收盤價打包成一段 JSON，存在 prices/_pack0（超過單一文件上限才接續 _pack1…），
     * 同學開網頁只要讀 1 份文件，不必一檔股票讀一份。
     * 還沒有打包文件時（剛升級到這個版本）退回讀舊版的一檔一份，等老師的瀏覽器打包。
     */
    async loadPrices() {
      const { db, fs } = await getFirebase()
      const col = fs.collection(db, COLLECTIONS.prices)
      const snap = await fs.getDocsFromServer(fs.query(col, fs.where(fs.documentId(), 'in', PACK_IDS)))
      const parts = new Map(snap.docs.map((d) => [d.id, d.data()]))
      const head = parts.get(PACK_IDS[0])
      if (head) {
        // 同一次寫入的各段 seq 相同，對不上代表不完整
        const pieces = PACK_IDS.slice(0, head.parts).map((id) => parts.get(id))
        if (pieces.every((p) => p?.seq === head.seq)) {
          try {
            const out = JSON.parse(pieces.map((p) => p.data).join(''))
            priceSource = 'pack'
            return out
          } catch {
            /* 內容壞掉就改讀舊格式，老師的瀏覽器會重新打包 */
          }
        }
      }

      const legacy = await fs.getDocsFromServer(col)
      const out = {}
      for (const d of legacy.docs) if (!PACK_IDS.includes(d.id)) out[d.id] = plain(d.data())
      priceSource = 'legacy'
      return out
    },

    /**
     * 只有老師寫得進去（見 firestore.rules）。
     * 傳入的是合併好的完整快取，整份覆寫；分段在同一個 batch 寫入，不會讀到一半新一半舊。
     */
    async savePrices(all) {
      const { db, fs } = await getFirebase()
      const pieces = chunkText(asciiJson(all), PACK_PART_SIZE)
      if (pieces.length > PACK_IDS.length) throw new Error('報價快取超過容量上限')
      const seq = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
      const batch = fs.writeBatch(db)
      PACK_IDS.forEach((id, i) => {
        const ref = fs.doc(db, COLLECTIONS.prices, id)
        if (i < pieces.length) {
          batch.set(ref, {
            code: id, // 舊版程式讀整個集合時會把它當成一檔股票，給個代號避免出錯
            seq,
            part: i,
            parts: pieces.length,
            data: pieces[i],
            updatedAt: fs.serverTimestamp(),
          })
        } else {
          batch.delete(ref) // 快取變小時清掉多出來的段落
        }
      })
      await batch.commit()
      priceSource = 'pack'
      return all
    },

    /** 這次讀到的是舊版一檔一份的快取，需要老師的瀏覽器打包一次 */
    pricePackMissing: () => priceSource === 'legacy',

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
