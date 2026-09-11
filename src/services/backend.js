import { hasFirebaseConfig } from '../firebase.js'
import { createLocalBackend } from './localBackend.js'
import { createFirebaseBackend } from './firebaseBackend.js'

/** 有 Firebase 設定就走雲端，否則自動退回本機示範模式 */
export const backend = hasFirebaseConfig ? createFirebaseBackend() : createLocalBackend()

export const isLocalMode = backend.mode === 'local'
