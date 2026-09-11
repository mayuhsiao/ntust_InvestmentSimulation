import { handleApiRequest } from '../../server/api.mjs'

/** GET /api/stock-search?q=apple — 美股代號即時搜尋 */
export default async (request) => handleApiRequest(request)

export const config = { path: '/api/stock-search' }
