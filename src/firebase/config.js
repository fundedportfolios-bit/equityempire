import { initializeApp } from 'firebase/app'
import { getFirestore }  from 'firebase/firestore'
import { getAuth }       from 'firebase/auth'

const firebaseConfig = {
  apiKey:            'AIzaSyDh7iKv36ZGvbl3EobyUmajZzISPgQaY6o',
  authDomain:        'equity-empire-2026.firebaseapp.com',
  projectId:         'equity-empire-2026',
  storageBucket:     'equity-empire-2026.firebasestorage.app',
  messagingSenderId: '338281754091',
  appId:             '1:338281754091:web:5ac74306fde333deb7bdae',
  measurementId:     'G-J41B0P5L0L',
}

console.log('[Firebase] Initializing app with projectId:', firebaseConfig.projectId)

const app = initializeApp(firebaseConfig)
export const db   = getFirestore(app)
export const auth = getAuth(app)

console.log('[Firebase] App initialized. db:', !!db, '| auth:', !!auth)
