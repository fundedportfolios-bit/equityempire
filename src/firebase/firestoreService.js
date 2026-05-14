// firestoreService.js
// Cloud save/load for authenticated (non-guest) users.
// Structure: users/{uid}/saveSlots/slot_{0|1|2}
//
// Each document: { state, savedAt, createdAt, updatedAt }

import { db }                          from './config.js'
import { doc, getDoc, setDoc, deleteDoc } from 'firebase/firestore'

const SLOT_COUNT = 3

function slotRef(uid, slotIndex) {
  return doc(db, 'users', uid, 'saveSlots', `slot_${slotIndex}`)
}

// Load a single slot (returns null if it doesn't exist)
export async function loadSlotFromFirestore(uid, slotIndex) {
  try {
    const snap = await getDoc(slotRef(uid, slotIndex))
    return snap.exists() ? snap.data() : null
  } catch (e) {
    console.error('[Firestore] loadSlot error:', e)
    return null
  }
}

// Save a single slot
export async function saveSlotToFirestore(uid, slotIndex, state) {
  try {
    const ref  = slotRef(uid, slotIndex)
    const snap = await getDoc(ref)
    const now  = new Date().toISOString()
    await setDoc(ref, {
      state,
      savedAt:   now,
      createdAt: snap.exists() ? (snap.data().createdAt ?? now) : now,
      updatedAt: now,
    })
  } catch (e) {
    console.error('[Firestore] saveSlot error:', e)
  }
}

// Delete a single slot
export async function deleteSlotFromFirestore(uid, slotIndex) {
  try {
    await deleteDoc(slotRef(uid, slotIndex))
  } catch (e) {
    console.error('[Firestore] deleteSlot error:', e)
  }
}

// Load all 3 slots in parallel (returns array of slot data or null per slot)
export async function getAllSlotsFromFirestore(uid) {
  try {
    const snaps = await Promise.all(
      Array.from({ length: SLOT_COUNT }, (_, i) => getDoc(slotRef(uid, i)))
    )
    return snaps.map(s => (s.exists() ? s.data() : null))
  } catch (e) {
    console.error('[Firestore] getAllSlots error:', e)
    return Array(SLOT_COUNT).fill(null)
  }
}
