import { handleApiRequest } from '../../server/api.mjs'

/** GET /api/stock-list — 上市 + 上櫃全市場代號、名稱與最新收盤價 */
export default async (request) => handleApiRequest(request)

export const config = { path: '/api/stock-list' }
