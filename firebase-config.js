// Firebase Configuration
const firebaseConfig = {
    projectId: "lapis3-4113e",
    appId: "1:802380662413:web:8b98f5b8b7432cd56bc4c4",
    storageBucket: "lapis3-4113e.firebasestorage.app",
    apiKey: "AIzaSyB4PObusgsnMKVNeAzMTrCgjHIoJKNKyGo",
    authDomain: "lapis3-4113e.firebaseapp.com",
    messagingSenderId: "802380662413",
    measurementId: "G-3J5X5XP48J",
    projectNumber: "802380662413"
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
    auth.useEmulator("http://127.0.0.1:9099");
}

// Enable Offline Persistence
// Called AFTER emulator connection to avoid "already started" error
const isTestMode = (location.hostname === "localhost" || location.hostname === "127.0.0.1") && (window.__TEST_MODE__ === true);
if (!isTestMode) {
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
} else {
    console.log("Persistence disabled for Test Mode");
}
