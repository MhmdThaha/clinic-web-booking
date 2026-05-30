import { initializeApp } from "firebase/app"
import { getAuth } from "firebase/auth"
import { getFirestore } from "firebase/firestore"

const firebaseConfig = {
  apiKey: "AIzaSyBZcfDwE88rooDWNrau03t3kjImMB3Mknk",
  authDomain: "booking2-56a8b.firebaseapp.com",
  projectId: "booking2-56a8b",
  storageBucket: "booking2-56a8b.firebasestorage.app",
  messagingSenderId: "920533946320",
  appId: "1:920533946320:web:9471af2ac22f00441f73d5"
}

const app = initializeApp(firebaseConfig)

export const auth = getAuth(app)
export const db = getFirestore(app)