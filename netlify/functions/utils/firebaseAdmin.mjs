// ═══════════════════════════════════════════════════════════════
// Firebase Admin SDK singleton for Netlify Functions.
//
// Credentials come from Netlify environment variables ONLY — never
// commit them, never expose them to the frontend.
//
// Required env vars:
//   FIREBASE_PROJECT_ID    — e.g. "equity-empire-2026"
//   FIREBASE_CLIENT_EMAIL  — e.g. "firebase-adminsdk-xxxxx@equity-empire-2026.iam.gserviceaccount.com"
//   FIREBASE_PRIVATE_KEY   — service-account private key. Netlify usually
//                            stores this with literal "\n" escape sequences;
//                            we convert them back to real newlines below.
//
// To get these: Firebase Console → Project Settings → Service accounts →
// Generate new private key. From the downloaded JSON copy the three fields
// above into Netlify env vars. Do NOT paste the JSON file into the repo.
// IMPORTANT: when pasting the private_key field, do NOT include the
// surrounding double quotes from the JSON. The value should start with
// "-----BEGIN PRIVATE KEY-----" and end with "-----END PRIVATE KEY-----".
//
// Usage:
//   const { hasAdmin, reason, getDb, verifyIdToken } = await getFirebaseAdmin()
//   if (!hasAdmin) { ... fallback ... }
// ═══════════════════════════════════════════════════════════════

import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore'
import { getAuth } from 'firebase-admin/auth'

let cached = null

// Normalize a private-key env var. Handles:
//   • literal "\n" escape sequences → real newlines (Netlify common case)
//   • accidental surrounding "..." JSON quotes
//   • leading/trailing whitespace
// Returns null if the result doesn't look like a PEM key.
function normalizePrivateKey(raw) {
  if (typeof raw !== 'string') return null
  let key = raw.trim()
  // Strip surrounding JSON-string quotes if the user pasted them.
  if (key.length >= 2 && key.startsWith('"') && key.endsWith('"')) {
    key = key.slice(1, -1)
  }
  // Convert "\n" escape sequences into real newlines.
  key = key.replace(/\\n/g, '\n')
  if (!key.includes('-----BEGIN') || !key.includes('-----END')) return null
  return key
}

export async function getFirebaseAdmin() {
  if (cached) return cached

  const projectId   = process.env.FIREBASE_PROJECT_ID
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL
  const rawKey      = process.env.FIREBASE_PRIVATE_KEY

  const missing = []
  if (!projectId)   missing.push('FIREBASE_PROJECT_ID')
  if (!clientEmail) missing.push('FIREBASE_CLIENT_EMAIL')
  if (!rawKey)      missing.push('FIREBASE_PRIVATE_KEY')
  if (missing.length) {
    console.warn(`[firebaseAdmin] Missing env: ${missing.join(', ')}. Admin disabled.`)
    cached = { hasAdmin: false, reason: 'missing-env', missing }
    return cached
  }

  const privateKey = normalizePrivateKey(rawKey)
  if (!privateKey) {
    console.warn('[firebaseAdmin] FIREBASE_PRIVATE_KEY did not parse as a PEM key (no BEGIN/END markers after normalization). Admin disabled.')
    cached = { hasAdmin: false, reason: 'bad-private-key' }
    return cached
  }

  try {
    if (getApps().length === 0) {
      initializeApp({
        credential: cert({ projectId, clientEmail, privateKey }),
      })
    }
    const db   = getFirestore()
    const auth = getAuth()

    console.log('[firebaseAdmin] Initialized for project:', projectId)
    cached = {
      hasAdmin: true,
      reason:   null,
      db,
      auth,
      FieldValue,
      Timestamp,
      verifyIdToken: async (token) => {
        if (!token) return null
        try { return await auth.verifyIdToken(token) }
        catch (e) { console.warn('[firebaseAdmin] ID token verify failed:', e?.code || e?.message); return null }
      },
    }
    return cached
  } catch (e) {
    // Log a category, not the full key. e.message may include details — we
    // log a compact summary so it's safe to surface in logs but not full
    // stack traces (which can leak the private key).
    const msg  = (e?.message || String(e)).slice(0, 240)
    const code = e?.code || e?.errorInfo?.code || null
    console.error('[firebaseAdmin] Init failed:', { code, msg })
    cached = { hasAdmin: false, reason: 'init-failed', code, message: msg }
    return cached
  }
}
