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
//
// Usage:
//   const { getDb, verifyIdToken, hasAdmin } = await getFirebaseAdmin()
//   if (!hasAdmin) { ... fallback ... }
// ═══════════════════════════════════════════════════════════════

import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore'
import { getAuth } from 'firebase-admin/auth'

let cached = null

export async function getFirebaseAdmin() {
  if (cached) return cached

  const projectId   = process.env.FIREBASE_PROJECT_ID
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL
  let   privateKey  = process.env.FIREBASE_PRIVATE_KEY

  if (!projectId || !clientEmail || !privateKey) {
    // Don't crash — caller decides how to fall back. We log a single line
    // (no secret content) so you can spot missing env in function logs.
    console.warn('[firebaseAdmin] Missing one or more required env vars; admin disabled.')
    cached = { hasAdmin: false }
    return cached
  }

  // Netlify usually stores multi-line keys with literal "\n" escapes.
  privateKey = privateKey.replace(/\\n/g, '\n')

  try {
    if (getApps().length === 0) {
      initializeApp({
        credential: cert({ projectId, clientEmail, privateKey }),
      })
    }
    const db   = getFirestore()
    const auth = getAuth()

    cached = {
      hasAdmin: true,
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
    console.error('[firebaseAdmin] Init failed:', e?.message || e)
    cached = { hasAdmin: false }
    return cached
  }
}
