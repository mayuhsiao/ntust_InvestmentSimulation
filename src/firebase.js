/**
 * Firebase 設定
 * ------------------------------------------------------------------
 * 所有金鑰都放在環境變數（.env.local 或 Netlify 的 Environment variables），
 * 沒有設定時整個 App 會自動退回「本機示範模式」，資料存在瀏覽器裡，
 * 讓你在拿到 Firebase 專案之前就能先操作、先驗收畫面。
 */

const env = import.meta.env

export const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
  measurementId: env.VITE_FIREBASE_MEASUREMENT_ID,
}

export const hasFirebaseConfig = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId)

/** 這些學號登入後具備管理者（老師）權限；需與 firestore.rules 內的名單一致 */
export const ADMIN_IDS = String(env.VITE_ADMIN_IDS || 'teacher')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean)

/** 學號 → Firebase Auth 用的假信箱，學生只要記學號與密碼 */
const AUTH_EMAIL_DOMAIN = env.VITE_AUTH_EMAIL_DOMAIN || 'ntust-invest.local'

export function normalizeId(studentId) {
  return String(studentId || '').trim().toUpperCase()
}

export function emailFor(studentId) {
  return `${normalizeId(studentId).toLowerCase()}@${AUTH_EMAIL_DOMAIN}`
}

export function isAdminId(studentId) {
  return ADMIN_IDS.includes(normalizeId(studentId).toLowerCase())
}

let cached = null

/** 延遲載入 Firebase SDK：本機示範模式完全不會下載這包 */
export async function getFirebase() {
  if (cached) return cached
  if (!hasFirebaseConfig) throw new Error('尚未設定 Firebase 環境變數')

  const [{ initializeApp }, auth, firestore] = await Promise.all([
    import('firebase/app'),
    import('firebase/auth'),
    import('firebase/firestore'),
  ])

  const app = initializeApp(firebaseConfig)
  const authInstance = auth.getAuth(app)
  try {
    await auth.setPersistence(authInstance, auth.browserLocalPersistence)
  } catch {
    /* 隱私模式下可能失敗，改用記憶體 persistence 即可 */
  }

  cached = { app, auth: authInstance, db: firestore.getFirestore(app), fbAuth: auth, fs: firestore }
  return cached
}
