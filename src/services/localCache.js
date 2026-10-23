/**
 * 瀏覽器端快取（IndexedDB）
 * ------------------------------------------------------------------
 * 存放上次從 Firestore 讀到的全班資料，下次開網頁只需要補抓有變動的部分。
 *
 * 用 IndexedDB 而不是 localStorage：全班交易紀錄會一直累積，
 * localStorage 只有約 5 MB，而且已經放了 1 MB 多的全市場代號清單。
 * 任何錯誤（隱私模式、空間不足、瀏覽器不支援）一律當作「沒有快取」，只會退回整包讀取。
 */

const DB_NAME = 'ntust-invest'
const STORE = 'cache'

let opening = null

function openDb() {
  if (!opening) {
    opening = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1)
      req.onupgradeneeded = () => req.result.createObjectStore(STORE)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    // 打不開就下次再試，不要把失敗的 Promise 留著
    opening.catch(() => {
      opening = null
    })
  }
  return opening
}

async function run(mode, action) {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode)
    const req = action(tx.objectStore(STORE))
    tx.oncomplete = () => resolve(req.result)
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

export async function readCache(key) {
  try {
    return (await run('readonly', (store) => store.get(key))) ?? null
  } catch {
    return null
  }
}

export async function writeCache(key, value) {
  try {
    await run('readwrite', (store) => store.put(value, key))
  } catch {
    /* 存不進去就算了，下次整包重讀 */
  }
}

export async function removeCache(key) {
  try {
    await run('readwrite', (store) => store.delete(key))
  } catch {
    /* ignore */
  }
}
