import { handleApiRequest } from '../../server/api.mjs'

/**
 * GET /api/stock-price?code=2330&start=2026-09-17&end=2026-12-22
 * GET /api/stock-price?codes=2330,2317,0050&start=...&end=...
 */
export default async (request) => handleApiRequest(request)

export const config = { path: '/api/stock-price' }
