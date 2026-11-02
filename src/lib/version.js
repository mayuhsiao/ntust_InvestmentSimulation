/**
 * 網站版本檢查
 * ------------------------------------------------------------------
 * 同學常把分頁開著不關（手機尤其如此），切回來時瀏覽器只是把舊畫面叫出來，
 * 跑的還是部署前的程式，要手動重新整理才會更新。
 * 建置時會輸出 /version.json（見 vite.config.js），前端拿它跟自己的版本號比對。
 */

/* global __BUILD_ID__ */
export const BUILD_ID = __BUILD_ID__

/** 伺服器上是不是已經有新版；本機開發或查不到時一律回傳 false */
export async function hasNewVersion() {
  if (import.meta.env.DEV) return false
  try {
    const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' })
    if (!res.ok) return false
    const { build } = await res.json()
    return Boolean(build) && build !== BUILD_ID
  } catch {
    return false
  }
}
