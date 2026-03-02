// Firebase Configuration
const firebaseConfig = {
    projectId: "lapis2-2026",
    appId: "1:257877222040:web:544001f0cd06b0fdb226ed",
    storageBucket: "lapis2-2026.firebasestorage.app",
    apiKey: "AIzaSyDTiy6SkKl74myPT9A4BYSs45BgbjynerQ",
    authDomain: "lapis2-2026.firebaseapp.com",
    messagingSenderId: "257877222040",
    measurementId: "G-WNVCPG6S3Y",
    projectNumber: "257877222040"
};

// Initialize Firebase (Compat)
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// --- Emulator Connections ---
// IMPORTANT: Must be called BEFORE enablePersistence() or any other Firestore method
// Automatically connect to emulators when running on localhost
const useEmulator = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
if (useEmulator) {
    console.log("Using Firebase Emulators...");

    // Firestore Emulator
    db.useEmulator("127.0.0.1", 8085);

    // Auth Emulator
    const auth = firebase.auth();
    auth.useEmulator("http://127.0.0.1:9095");
}

// Enable Offline Persistence
// Called AFTER emulator connection to avoid "already started" error
db.enablePersistence()
    .catch((err) => {
        if (err.code == 'failed-precondition') {
            // Multiple tabs open, persistence can only be enabled in one tab at a a time.
            console.warn('Persistence failed: Multiple tabs open');
        } else if (err.code == 'unimplemented') {
            // The current browser does not support all of the features required to enable persistence
            console.warn('Persistence failed: Browser not supported');
        }
    });
