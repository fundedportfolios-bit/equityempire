// firestoreService.js
// Cloud save/load for authenticated (non-guest) users.
// Structure: users/{uid}/saveSlots/slot_{0|1|2}
//
// Every Firestore call logs:
//   - auth.currentUser (uid/email)
//   - exact document path
//   - payload size on save
//   - full success or error (with .code and .message)
// Errors are RE-THROWN so the caller can surface them. They are never
// silently swallowed.

import { db, auth }                       from './config.js'
import { doc, getDoc, setDoc, deleteDoc } from 'firebase/firestore'

const SLOT_COUNT = 3

function slotId(slotIndex) {
  return `slot_${slotIndex}`
}

function slotPath(uid, slotIndex) {
  return `users/${uid}/saveSlots/${slotId(slotIndex)}`
}

function slotRef(uid, slotIndex) {
  return doc(db, 'users', uid, 'saveSlots', slotId(slotIndex))
}

// Logs auth.currentUser and verifies uid matches what the caller passed.
// Throws if there is no current Firebase Auth user. Re-thrown errors are
// what Firestore's security rules denial would surface anyway, but we want
// to fail fast with a clear message before the request is even sent.
function assertAuthAndUid(callerUid, op) {
  const cu = auth.currentUser
  console.log(`[Firestore.${op}] auth.currentUser:`, cu ? {
    uid:           cu.uid,
    email:         cu.email,
    isAnonymous:   cu.isAnonymous,
    emailVerified: cu.emailVerified,
  } : null)
  if (!cu) {
    const err = new Error(`[Firestore.${op}] No Firebase Auth current user — refusing to call Firestore (would be denied by rules).`)
    err.code = 'no-current-user'
    throw err
  }
  console.log(`[Firestore.${op}] uid match check:`, {
    caller:    callerUid,
    authUid:   cu.uid,
    matches:   callerUid === cu.uid,
  })
  if (callerUid !== cu.uid) {
    console.warn(`[Firestore.${op}] uid MISMATCH between caller (${callerUid}) and auth.currentUser (${cu.uid}). Using auth.currentUser.uid.`)
  }
  return cu.uid
}

// ─── Load one slot ─────────────────────────────────────────────────────
export async function loadSlotFromFirestore(uid, slotIndex) {
  const op   = 'loadSlot'
  const sid  = slotId(slotIndex)
  const path = slotPath(uid, slotIndex)
  console.log(`[Firestore.${op}] READ —`, { slotIndex, slotId: sid, path })

  try {
    const authedUid = assertAuthAndUid(uid, op)
    const ref       = slotRef(authedUid, slotIndex)
    const snap      = await getDoc(ref)
    if (snap.exists()) {
      const data = snap.data()
      console.log(`[Firestore.${op}] SUCCESS — found document at`, path, {
        savedAt:   data.savedAt,
        updatedAt: data.updatedAt,
        hasState:  !!data.state,
      })
      return data
    }
    console.log(`[Firestore.${op}] SUCCESS — no document exists at`, path, '(empty slot)')
    return null
  } catch (e) {
    console.error(`[Firestore.${op}] FAILED at`, path, '| code:', e.code, '| message:', e.message, '| full error:', e)
    throw e
  }
}

// ─── Save one slot ─────────────────────────────────────────────────────
export async function saveSlotToFirestore(uid, slotIndex, state) {
  const op   = 'saveSlot'
  const sid  = slotId(slotIndex)
  const path = slotPath(uid, slotIndex)
  console.log(`[Firestore.${op}] WRITE —`, { slotIndex, slotId: sid, path })

  try {
    const authedUid = assertAuthAndUid(uid, op)
    const ref       = slotRef(authedUid, slotIndex)
    const snap      = await getDoc(ref)
    const now       = new Date().toISOString()
    const payload   = {
      state,
      savedAt:   now,
      createdAt: snap.exists() ? (snap.data().createdAt ?? now) : now,
      updatedAt: now,
    }
    const payloadSize = JSON.stringify(payload).length
    console.log(`[Firestore.${op}] payload size:`, payloadSize, 'bytes |',
      'currentMonth:', state.currentMonth,
      '| properties:', state.properties?.length ?? 0,
      '| cash:', state.cash,
    )
    await setDoc(ref, payload)
    console.log(`[Firestore.${op}] SUCCESS — wrote`, path, 'at', now)
  } catch (e) {
    console.error(`[Firestore.${op}] FAILED at`, path, '| code:', e.code, '| message:', e.message, '| full error:', e)
    throw e
  }
}

// ─── Delete one slot ───────────────────────────────────────────────────
export async function deleteSlotFromFirestore(uid, slotIndex) {
  const op   = 'deleteSlot'
  const path = slotPath(uid, slotIndex)
  console.log(`[Firestore.${op}] DELETE —`, { slotIndex, path })

  try {
    const authedUid = assertAuthAndUid(uid, op)
    await deleteDoc(slotRef(authedUid, slotIndex))
    console.log(`[Firestore.${op}] SUCCESS — deleted`, path)
  } catch (e) {
    console.error(`[Firestore.${op}] FAILED at`, path, '| code:', e.code, '| message:', e.message, '| full error:', e)
    throw e
  }
}

// ─── Load all 3 slots ──────────────────────────────────────────────────
export async function getAllSlotsFromFirestore(uid) {
  const op = 'getAllSlots'
  console.log(`[Firestore.${op}] — listing slots for uid:`, uid)
  try {
    const authedUid = assertAuthAndUid(uid, op)
    const snaps     = await Promise.all(
      Array.from({ length: SLOT_COUNT }, (_, i) => getDoc(slotRef(authedUid, i)))
    )
    const result = snaps.map((s, i) => {
      const exists = s.exists()
      console.log(`[Firestore.${op}]   slot ${i}:`, exists ? `${slotPath(authedUid, i)} (exists)` : `${slotPath(authedUid, i)} (empty)`)
      return exists ? s.data() : null
    })
    console.log(`[Firestore.${op}] SUCCESS —`, result.filter(Boolean).length, '/', SLOT_COUNT, 'slots have data')
    return result
  } catch (e) {
    console.error(`[Firestore.${op}] FAILED | code:`, e.code, '| message:', e.message, '| full error:', e)
    throw e
  }
}
