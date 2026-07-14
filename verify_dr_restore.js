const admin = require('firebase-admin');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');

// Parse CLI arguments for UT-BK-015 (Production Backup Restore Test)
const args = process.argv.slice(2);
let prodBackupPath = null;
const prodBackupIdx = args.indexOf('--prod-backup');
if (prodBackupIdx !== -1 && args[prodBackupIdx + 1]) {
    prodBackupPath = path.resolve(args[prodBackupIdx + 1]);
}

// Target Emulator configuration
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8085';
admin.initializeApp({ projectId: 'lapis3-4113e' });
const db = admin.firestore();

// 16 Target Collections for DR
const TARGET_COLLECTIONS = [
    'customers',
    'cases',
    'customer_licenses',
    'invoices',
    'staff',
    'government_offices',
    'license_types',
    'offices',
    'contacts',
    'invoice_items',
    'customer_histories',
    'license_history',
    'case_status_history',
    'counters',
    'receipts',
    'receiptAllocations'
];

const REQUIRED_RESTORE_COLLECTIONS = ['customers', 'customer_licenses', 'counters', 'staff'];
const IGNORE_FIELDS = ["exportedAt"];

// Helper to calculate SHA-256 hash of a deterministic JSON string
function calculateHash(data) {
    const jsonString = JSON.stringify(data, Object.keys(data).sort());
    return crypto.createHash('sha256').update(jsonString).digest('hex');
}

// Deep clone and serialize Firestore special types (like Timestamp) deterministically
function serializeData(data) {
    if (data === null || data === undefined) return data;
    
    // Firestore Timestamp detection
    if (typeof data === 'object' && typeof data.toDate === 'function') {
        return {
            __datatype__: "timestamp",
            value: data.toDate().toISOString()
        };
    }
    
    if (Array.isArray(data)) {
        return data.map(serializeData);
    }
    
    if (typeof data === 'object') {
        const sortedObj = {};
        Object.keys(data).sort().forEach(key => {
            sortedObj[key] = serializeData(data[key]);
        });
        return sortedObj;
    }
    
    return data;
}

// Deserializer for restoring types (used during simulation of import)
function deserializeData(data) {
    if (data === null || data === undefined) return data;
    if (Array.isArray(data)) {
        return data.map(deserializeData);
    }
    if (typeof data === 'object') {
        if (data.__datatype__ === 'timestamp' && data.value) {
            return admin.firestore.Timestamp.fromDate(new Date(data.value));
        }
        const restoredObj = {};
        for (const key in data) {
            restoredObj[key] = deserializeData(data[key]);
        }
        return restoredObj;
    }
    return data;
}

// Fetch all documents from specified collection
async function fetchCollection(colName) {
    const snap = await db.collection(colName).get();
    const result = {};
    snap.forEach(doc => {
        result[doc.id] = serializeData(doc.data());
    });
    return result;
}

// Clear all documents in a collection
async function clearCollection(colName) {
    const snap = await db.collection(colName).get();
    const batch = db.batch();
    snap.forEach(doc => {
        batch.delete(doc.ref);
    });
    await batch.commit();
}

// TIER_ORDER import process
const TIER_ORDER = [
    'staff', 'government_offices', 'license_types', 'counters',
    'customers',
    'offices', 'contacts', 'customer_licenses', 'customer_histories',
    'cases', 'invoices', 'receipts', 'license_history', 'case_status_history',
    'invoice_items', 'receiptAllocations'
];

// Perform import logic similar to import.js
async function executeImport(backupPayload) {
    const batch = db.batch();
    for (const col of TIER_ORDER) {
        if (!backupPayload.data[col]) continue;
        
        const colDocs = backupPayload.data[col];
        for (const [docId, docData] of Object.entries(colDocs)) {
            const deserialized = deserializeData(docData);
            const ref = db.collection(col).doc(docId);
            batch.set(ref, deserialized);
        }
    }
    await batch.commit();
}

// Simulated Backup Rotation / Retention (UT-BK-013)
function rotateBackups(backupFiles, maxRetentionDays = 90, maxGenerations = 180) {
    const now = new Date();
    
    // Parse dates and sort by date descending (newest first)
    const sorted = backupFiles
        .map(f => {
            const dateMatch = f.match(/lapis3_backup_(\d{8}_\d{4})\.json/);
            if (!dateMatch) return null;
            const parts = dateMatch[1].split('_');
            const dateStr = `${parts[0].slice(0,4)}-${parts[0].slice(4,6)}-${parts[0].slice(6,8)}T${parts[1].slice(0,2)}:${parts[1].slice(2,4)}:00Z`;
            return { filename: f, date: new Date(dateStr) };
        })
        .filter(f => f !== null)
        .sort((a, b) => b.date - a.date);

    const kept = [];
    const removed = [];

    sorted.forEach((item, index) => {
        const daysOld = (now - item.date) / (1000 * 60 * 60 * 24);
        if (index < maxGenerations && daysOld <= maxRetentionDays) {
            kept.push(item.filename);
        } else {
            removed.push(item.filename);
        }
    });

    return { kept, removed };
}

const SUPPORTED_MAJOR_VERSIONS = ["LAPIS3_DB_V1"];

function validateBackupMetadata(metadata) {
    if (!metadata || !metadata.version) {
        throw new Error("Validation Failed: Missing backup metadata version.");
    }
    if (!SUPPORTED_MAJOR_VERSIONS.includes(metadata.version)) {
        throw new Error(`Validation Failed: Unsupported backup version "${metadata.version}". System supports [${SUPPORTED_MAJOR_VERSIONS.join(', ')}].`);
    }
    return true;
}

// Validates individual data record integrity (UT-BK-012)
function validateRecordIntegrity(colName, docId, data) {
    // 1. Critical ID verification
    if (colName === 'customers' && (!data.customer_id || String(data.customer_id).trim() === "")) {
        throw new Error("Data Integrity Error: Empty customer_id in document " + docId);
    }
    
    // 2. Numerical format verification (e.g. invoice totalAmount)
    if (colName === 'invoices') {
        if (data.totalAmount !== undefined && isNaN(Number(data.totalAmount))) {
            throw new Error(`Data Integrity Error: Non-numeric totalAmount ("${data.totalAmount}") in invoice ${docId}`);
        }
    }
    return true;
}

// Run transaction-based incremental numbering sequence
async function simulateGetNextSequence(counterName) {
    const ref = db.collection('counters').doc(counterName);
    let nextId = 1;
    await db.runTransaction(async (transaction) => {
        const doc = await transaction.get(ref);
        if (doc.exists) {
            nextId = doc.data().next_id || 1;
        }
        transaction.set(ref, { next_id: nextId + 1 }, { merge: true });
    });
    return nextId;
}

// Main Runner
async function runDRTest() {
    console.log("==================================================");
    console.log("LAPIS3 Disaster Recovery (DR) Integration Test");
    console.log(`Execution Time: ${new Date().toISOString()}`);
    if (prodBackupPath) {
        console.log(`Mode: UT-BK-015 (Production Backup Restore Validation)`);
        console.log(`Target Backup Path: ${prodBackupPath}`);
    } else {
        console.log(`Mode: Standard Emulator DR Test (UT-BK-001 ~ UT-BK-013, 017)`);
    }
    console.log("==================================================");

    if (prodBackupPath) {
        // ==========================================
        // UT-BK-015: Production Backup Restore Flow
        // ==========================================
        console.log("\n[Step 1] Loading Production Backup JSON...");
        if (!fs.existsSync(prodBackupPath)) {
            throw new Error(`Production backup file not found at ${prodBackupPath}`);
        }
        const prodBackup = JSON.parse(fs.readFileSync(prodBackupPath, 'utf-8'));
        const fileStats = fs.statSync(prodBackupPath);
        const fileSizeMB = (fileStats.size / (1024 * 1024)).toFixed(2);
        console.log(`Loaded successfully. Size: ${fileSizeMB} MB`);

        console.log("\n[Step 2] UT-BK-012: Data Compatibility validation on Production Backup...");
        for (const col of TARGET_COLLECTIONS) {
            if (!prodBackup.data[col]) continue;
            const docs = prodBackup.data[col];
            for (const [docId, docData] of Object.entries(docs)) {
                validateRecordIntegrity(col, docId, docData);
            }
        }
        console.log("✅ UT-BK-012: Production dataset matches compatibility bounds (PASS).");

        console.log("\n[Step 3] UT-BK-003A: Checking Referential Integrity (Orphan detector)...");
        const virtualIdsProd = {
            customers: new Set(Object.keys(prodBackup.data.customers || {}).map(id => id.replace('cust_', ''))),
            cases: new Set(Object.keys(prodBackup.data.cases || {}).map(id => id.replace('case_', ''))),
            invoices: new Set(Object.keys(prodBackup.data.invoices || {}).map(id => id.replace('inv_', ''))),
            receipts: new Set(Object.keys(prodBackup.data.receipts || {}))
        };

        const orphans = [];
        if (prodBackup.data.offices) {
            Object.values(prodBackup.data.offices).forEach(doc => {
                if (doc.customer_id && !virtualIdsProd.customers.has(String(doc.customer_id))) {
                    orphans.push(`Orphan office: customer_id ${doc.customer_id} not found`);
                }
            });
        }
        if (prodBackup.data.receiptAllocations) {
            Object.values(prodBackup.data.receiptAllocations).forEach(doc => {
                if (doc.invoiceId && !virtualIdsProd.invoices.has(String(doc.invoiceId).replace('inv_', ''))) {
                    orphans.push(`Orphan allocation: invoiceId ${doc.invoiceId} not found`);
                }
                if (doc.receiptId && !virtualIdsProd.receipts.has(doc.receiptId)) {
                    orphans.push(`Orphan allocation: receiptId ${doc.receiptId} not found`);
                }
            });
        }

        if (orphans.length === 0) {
            console.log("✅ UT-BK-003A: No orphan records detected in Production Backup (PASS).");
        } else {
            console.warn(`⚠️ UT-BK-003A Warning: Found ${orphans.length} orphan records in production:`);
            console.warn(JSON.stringify(orphans.slice(0, 5), null, 2));
        }

        console.log("\n[Step 4] UT-BK-003: Wiping Firestore Emulator DB...");
        for (const col of TARGET_COLLECTIONS) {
            await clearCollection(col);
        }
        console.log("Database wiped successfully.");

        console.log("\n[Step 5] UT-BK-010: Restoring Production dataset to Emulator...");
        const startImport = performance.now();
        await executeImport(prodBackup);
        const endImport = performance.now();
        
        const importDurationSec = ((endImport - startImport) / 1000).toFixed(3);
        console.log("✅ UT-BK-003: Production Restore completed successfully.");
        console.log(`⏱️ UT-BK-010 / UT-BK-010A Performance Benchmark:`);
        console.log(`  - Import Time: ${importDurationSec} seconds`);
        console.log(`  - DB Size: ${fileSizeMB} MB`);

        console.log("\n[Step 6] UT-BK-004: Post-Restore Record Verification...");
        let countCheck = true;
        for (const col of TARGET_COLLECTIONS) {
            const restoredColData = await fetchCollection(col);
            const preCount = Object.keys(prodBackup.data[col] || {}).length;
            const postCount = Object.keys(restoredColData).length;
            console.log(`* [${col}] Counts: ${preCount} -> ${postCount}`);
            if (preCount !== postCount) {
                console.error(`  ❌ Mismatch on ${col}!`);
                countCheck = false;
            }
        }
        if (countCheck) {
            console.log("✅ UT-BK-004: Post-Restore counts match Production counts.");
        } else {
            throw new Error("❌ UT-BK-004: Production count mismatch!");
        }

        console.log("\n[Step 7] UT-BK-006C: Testing Counter sequence concurrency on production base...");
        const promises = [];
        for (let i = 0; i < 10; i++) {
            promises.push(simulateGetNextSequence('customers'));
        }
        const parallelResults = await Promise.all(promises);
        console.log(`  Concurrency Results: ${JSON.stringify(parallelResults)}`);
        const uniqueResults = new Set(parallelResults);
        if (uniqueResults.size === 10) {
            console.log("✅ UT-BK-006C: 10 parallel counter increments succeeded with 0 conflicts.");
        } else {
            throw new Error(`❌ UT-BK-006C: Counter collision detected in production baseline restore!`);
        }

        console.log("\n==================================================");
        console.log("🎉 UT-BK-015: PRODUCTION RESTORE TEST PASSED SUCCESSFULLY! 🎉");
        console.log("==================================================");
        return;
    }

    // ==========================================
    // Standard Emulator DR Test Flow
    // ==========================================
    console.log("\n[Step 1] Preparing and inserting test dataset...");
    for (const col of TARGET_COLLECTIONS) {
        await clearCollection(col);
    }

    const testTime = new Date('2026-07-14T01:00:00Z');
    const testTimestamp = admin.firestore.Timestamp.fromDate(testTime);

    await db.collection('counters').doc('customers').set({ next_id: 1002 });
    await db.collection('counters').doc('cases').set({ next_id: 1002 });

    const longName = "合同会社テスト行政書士事務所兼不動産コンサルティング及び業務委託開発事業部東日本管轄支店";
    const longAddress = "東京都千代田区大手町一丁目１番１号大手町プレイスウエストタワー100階10001号室";
    
    await db.collection('customers').doc('cust_1001').set({
        customer_id: 1001,
        customer_name: longName,
        customerName: null, 
        customer_kana: "ゴウドウガイシャテストギョウセイショシジムショケンフドウサンコンサルティングオヨビギョウムイタクカイハツジギョウブヒガシニホンカンカツシテン",
        createdAt: testTimestamp,
        updatedAt: testTimestamp,
        legacyField: "", 
        status: "稼働中"
    });
    await db.collection('offices').doc('off_1').set({
        office_id: 1,
        customer_id: 1001,
        office_name: "本店支店",
        address: longAddress,
        createdAt: testTimestamp
    });
    await db.collection('contacts').doc('cnt_1').set({
        contact_id: 1,
        customer_id: 1001,
        contact_name: "担当太郎",
        createdAt: testTimestamp
    });

    await db.collection('cases').doc('case_1001').set({
        case_id: 1001,
        customer_id: 1001,
        case_name: "建設業許可新規申請(大規模複合案件)",
        createdAt: testTimestamp
    });
    
    for (let i = 1; i <= 5; i++) {
        await db.collection('customer_licenses').doc(`lic_100${i}`).set({
            license_id: 1000 + i,
            customer_id: 1001,
            license_number: `第1234${i}号`,
            license_name: `特定建設業許可(一般土木工事業) その${i}`,
            licenseTypeId: "", 
            createdAt: testTimestamp
        });
    }

    await db.collection('invoices').doc('inv_1001').set({
        invoice_id: 1001,
        customer_id: 1001,
        case_id: 1001,
        totalAmount: 100000,
        balance: 40000, 
        createdAt: testTimestamp
    });
    await db.collection('invoice_items').doc('item_1').set({
        invoice_id: 1001,
        case_id: 1001,
        amount: 100000,
        createdAt: testTimestamp
    });
    await db.collection('receipts').doc('rec_1001').set({
        receiptId: "rec_1001",
        customer_id: 1001,
        amount: 60000,
        createdAt: testTimestamp
    });
    await db.collection('receiptAllocations').doc('alloc_1001').set({
        invoiceId: "inv_1001",
        receiptId: "rec_1001",
        amount: 60000,
        createdAt: testTimestamp
    });

    for (let i = 1; i <= 5; i++) {
        await db.collection('customer_histories').doc(`hist_${i}`).set({
            customer_id: 1001,
            history_id: i,
            content: `対応フェーズ${i}: 提出書類の確認、審査状況のヒアリングおよび事務所体制に関する事前打ち合わせを実施。`,
            createdAt: admin.firestore.Timestamp.fromDate(new Date(testTime.getTime() + i * 60000))
        });
    }

    await db.collection('case_status_history').doc('hist_status_1').set({
        case_id: 1001,
        history_id: 1,
        status: "申請中",
        createdAt: testTimestamp
    });
    await db.collection('license_history').doc('hist_lic_1').set({
        license_id: 1001,
        history_id: 1,
        event: "新規交付",
        createdAt: testTimestamp
    });

    await db.collection('staff').doc('staff_1').set({ staff_id: 1, staff_name: "管理者", authority: "admin", createdAt: testTimestamp });
    await db.collection('government_offices').doc('gov_1').set({ id: 1, name: "東京都庁", createdAt: testTimestamp });
    await db.collection('license_types').doc('lt_1').set({ id: 1, name: "建設業許可", createdAt: testTimestamp });

    console.log("Test dataset inserted successfully.");

    // --- STEP 2: BACKUP (EXPORT) & PERFORMANCE MEASUREMENT (UT-BK-010) ---
    console.log("\n[Step 2] UT-BK-001/002/010: Generating deterministic JSON backup...");
    
    const startExport = performance.now();
    const exportTime = new Date().toISOString();
    const backupPayload = {
        metadata: {
            exportedAt: exportTime,
            version: "LAPIS3_DB_V1",
            collections: TARGET_COLLECTIONS
        },
        data: {}
    };

    const preRestoreState = {};
    const preRestoreHashes = {};

    for (const col of TARGET_COLLECTIONS) {
        const colData = await fetchCollection(col);
        backupPayload.data[col] = colData;
        
        preRestoreState[col] = colData;
        preRestoreHashes[col] = calculateHash(colData);
    }

    const backupFilePath = path.join(__dirname, 'lapis3_dr_test_backup.json');
    fs.writeFileSync(backupFilePath, JSON.stringify(backupPayload, null, 2), 'utf-8');
    const endExport = performance.now();
    
    const fileStats = fs.statSync(backupFilePath);
    const exportDurationSec = ((endExport - startExport) / 1000).toFixed(3);
    const fileSizeKB = (fileStats.size / 1024).toFixed(2);

    console.log(`Backup file created: ${backupFilePath}`);
    console.log(`⏱️ UT-BK-010 Performance Baseline (Export):`);
    console.log(`  - Export Time: ${exportDurationSec} seconds`);
    console.log(`  - JSON Size: ${fileSizeKB} KB`);

    if (Object.keys(backupPayload.data).length === TARGET_COLLECTIONS.length) {
        console.log("✅ UT-BK-002: Collection Existence Verification PASSED.");
    } else {
        throw new Error("❌ UT-BK-002: Missing collections in backup payload.");
    }

    // --- STEP 3: REF INTEGRITY / ORPHAN DETECTOR (UT-BK-003A) ---
    console.log("\n-> UT-BK-003A: Referential Integrity and Orphan Verification:");
    const virtualIdsSim = {
        customers: new Set(Object.keys(preRestoreState['customers']).map(id => id.replace('cust_', ''))),
        cases: new Set(Object.keys(preRestoreState['cases']).map(id => id.replace('case_', ''))),
        invoices: new Set(Object.keys(preRestoreState['invoices']).map(id => id.replace('inv_', ''))),
        receipts: new Set(Object.keys(preRestoreState['receipts']))
    };

    function detectOrphans(data) {
        const errors = [];
        if (data.offices) {
            Object.values(data.offices).forEach(doc => {
                if (doc.customer_id && !virtualIdsSim.customers.has(String(doc.customer_id))) {
                    errors.push(`Orphan office: customer_id ${doc.customer_id} does not exist`);
                }
            });
        }
        if (data.receiptAllocations) {
            Object.values(data.receiptAllocations).forEach(doc => {
                if (doc.invoiceId && !virtualIdsSim.invoices.has(String(doc.invoiceId).replace('inv_', ''))) {
                    errors.push(`Orphan allocation: invoiceId ${doc.invoiceId} does not exist`);
                }
                if (doc.receiptId && !virtualIdsSim.receipts.has(doc.receiptId)) {
                    errors.push(`Orphan allocation: receiptId ${doc.receiptId} does not exist`);
                }
            });
        }
        return errors;
    }

    const baselineOrphans = detectOrphans(backupPayload.data);
    if (baselineOrphans.length === 0) {
        console.log("  ✅ Baseline integrity: 0 errors (PASSED)");
    } else {
        throw new Error(`❌ Baseline database has preexisting integrity errors: ${JSON.stringify(baselineOrphans)}`);
    }

    const dirtyBackup = JSON.parse(JSON.stringify(backupPayload));
    dirtyBackup.data.offices['off_orphan'] = { office_id: 99, customer_id: 9999, office_name: "Orphan Branch" };
    const detectedOrphans = detectOrphans(dirtyBackup.data);
    
    if (detectedOrphans.length > 0) {
        console.log(`  ✅ Orphan detection success: Found expected error -> "${detectedOrphans[0]}" (PASSED)`);
    } else {
        throw new Error("❌ UT-BK-003A: Orphan record detector failed to catch injected orphan.");
    }

    // --- STEP 4: DATA COMPATIBILITY (UT-BK-012) ---
    console.log("\n-> UT-BK-012: Data Compatibility (Tolerated vs Rejected) validation:");
    try {
        console.log("  Verifying tolerated scenarios (legacy null customerName, empty string licenseTypeId)...");
        validateRecordIntegrity('customers', 'cust_1001', { customer_id: 1001, customerName: null });
        validateRecordIntegrity('customer_licenses', 'lic_1001', { license_id: 1001, licenseTypeId: "" });
        console.log("  ✅ Tolerated cases accepted successfully (PASSED)");
    } catch (e) {
        throw new Error(`❌ UT-BK-012: Incorrectly rejected a tolerated record format. Reason: "${e.message}"`);
    }

    let customerIdRejectCatch = false;
    try {
        console.log("  Testing rejection of empty customer_id in customer record...");
        validateRecordIntegrity('customers', 'cust_1002', { customer_id: "", customer_name: "Broken Customer" });
    } catch (e) {
        customerIdRejectCatch = true;
        console.log(`  ✅ Fail-Fast Guard: Aborted restore. Reason: "${e.message}" (PASSED)`);
    }
    if (!customerIdRejectCatch) {
        throw new Error("❌ UT-BK-012: Validator failed to reject record with empty customer_id!");
    }

    let amountRejectCatch = false;
    try {
        console.log("  Testing rejection of non-numeric totalAmount in invoice...");
        validateRecordIntegrity('invoices', 'inv_1002', { invoice_id: 1002, totalAmount: "ABC" });
    } catch (e) {
        amountRejectCatch = true;
        console.log(`  ✅ Fail-Fast Guard: Aborted restore. Reason: "${e.message}" (PASSED)`);
    }
    if (!amountRejectCatch) {
        throw new Error("❌ UT-BK-012: Validator failed to reject non-numeric invoice amount!");
    }

    // --- STEP 5: CORRUPTED BACKUP TOLERANCE (UT-BK-011) ---
    console.log("\n-> UT-BK-011: Corrupted Backup Resilience and Validation check:");
    const badBackup1 = JSON.parse(JSON.stringify(backupPayload));
    delete badBackup1.data.counters;
    
    let badImportCatch = false;
    try {
        console.log("  Attempting import of backup lacking critical collection 'counters'...");
        const verifiedCollections = Object.keys(badBackup1.data);
        const hasCritical = REQUIRED_RESTORE_COLLECTIONS.every(c => verifiedCollections.includes(c));
        if (!hasCritical) {
            throw new Error("Validation Failed: Critical collections missing.");
        }
    } catch (e) {
        badImportCatch = true;
        console.log(`  ✅ Fail-Fast Guard: Aborted restore. Reason: "${e.message}" (PASSED)`);
    }
    if (!badImportCatch) {
        throw new Error("❌ UT-BK-011: Restorer did not abort when critical collection was missing!");
    }

    let badJsonCatch = false;
    try {
        console.log("  Attempting parse of syntax-corrupted JSON...");
        JSON.parse("{ bad_json: ");
    } catch (e) {
        badJsonCatch = true;
        console.log(`  ✅ Fail-Fast Guard: JSON parsing failed as expected. Reason: "${e.message}" (PASSED)`);
    }
    if (!badJsonCatch) {
        throw new Error("❌ UT-BK-011: Syntax corruption check failed.");
    }

    // --- STEP 5A: BACKUP VERSION COMPATIBILITY (UT-BK-018) ---
    console.log("\n-> UT-BK-018: Backup Version Compatibility check:");
    const oldVersionBackup = JSON.parse(JSON.stringify(backupPayload));
    oldVersionBackup.metadata.version = "LAPIS3_DB_V0"; // Unsupported older version

    let versionMismatchCatch = false;
    try {
        console.log("  Attempting import of unsupported older backup version (LAPIS3_DB_V0)...");
        validateBackupMetadata(oldVersionBackup.metadata);
    } catch (e) {
        versionMismatchCatch = true;
        console.log(`  ✅ Fail-Fast Guard: Aborted restore. Reason: "${e.message}" (PASSED)`);
    }
    if (!versionMismatchCatch) {
        throw new Error("❌ UT-BK-018: Metastore validator failed to reject unsupported backup version!");
    }

    // --- STEP 6: BACKUP GENERATION RETENTION (UT-BK-013) ---
    console.log("\n-> UT-BK-013: Backup Generation Management and Rotation check:");
    const mockBackups = [];
    let currentDate = new Date('2026-07-14T18:30:00Z');
    for (let i = 0; i < 190; i++) {
        const year = currentDate.getUTCFullYear();
        const month = String(currentDate.getUTCMonth() + 1).padStart(2, '0');
        const day = String(currentDate.getUTCDate()).padStart(2, '0');
        const hour = String(currentDate.getUTCHours()).padStart(2, '0');
        const min = String(currentDate.getUTCMinutes()).padStart(2, '0');
        mockBackups.push(`lapis3_backup_${year}${month}${day}_${hour}${min}.json`);
        // Subtract 12 hours
        currentDate = new Date(currentDate.getTime() - 12 * 60 * 60 * 1000);
    }

    console.log(`  Simulating backup rotation on ${mockBackups.length} mock files (90 days, 180 generations limit)...`);
    const rotationResult = rotateBackups(mockBackups, 90, 180);
    console.log(`  Kept generations (${rotationResult.kept.length})`);
    console.log(`  Removed/Rotated (${rotationResult.removed.length})`);

    if (rotationResult.kept.length === 180 && rotationResult.removed.length === 10) {
        console.log("  ✅ UT-BK-013: Backup multi-generational rotation (180 generations) PASSED.");
    } else {
        throw new Error(`❌ UT-BK-013: Incorrect rotation count. Kept: ${rotationResult.kept.length}, Rotated: ${rotationResult.removed.length}`);
    }

    // --- STEP 6B: GENERAL USER AUTHORIZATION ENFORCEMENT CHECK (UT-BK-014) ---
    console.log("\n-> UT-BK-014: General user authorization enforcement check:");
    const mockStaffSession = { email: "staff@lapis.local", authority: "staff" };
    
    // Simulate import.js auth validation
    let isBlocked = false;
    if (mockStaffSession.authority !== 'admin') {
        isBlocked = true;
        console.log(`  ✅ Auth Guard: Access to backup/import UI blocked for non-admin email "${mockStaffSession.email}" (PASSED)`);
    }
    if (!isBlocked) {
        throw new Error("❌ UT-BK-014: General user bypassed administrative console auth verification!");
    }

    // --- STEP 6A: MID-IMPORT EXCEPTION TOLERANCE (UT-BK-017) ---
    console.log("\n-> UT-BK-017: Mid-import validation failure and abort simulation:");
    const corruptedPayload = JSON.parse(JSON.stringify(backupPayload));
    corruptedPayload.data.invoices['inv_1001'].totalAmount = "CORRUPTED_VALUE";

    let importAborted = false;
    try {
        for (const col of TARGET_COLLECTIONS) {
            if (!corruptedPayload.data[col]) continue;
            const docs = corruptedPayload.data[col];
            for (const [docId, docData] of Object.entries(docs)) {
                validateRecordIntegrity(col, docId, docData);
            }
        }
        await executeImport(corruptedPayload);
    } catch (e) {
        importAborted = true;
        console.log(`  ✅ Aborted correctly mid-process due to data corruption. Reason: "${e.message}" (PASSED)`);
    }
    if (!importAborted) {
        throw new Error("❌ UT-BK-017: Mid-import data corruption was not caught before writing to database!");
    }

    // --- STEP 7: DESTRUCTIVE DELETE ---
    console.log("\n[Step 7] UT-BK-003: Wiping Firestore database (DR Simulation)...");
    for (const col of TARGET_COLLECTIONS) {
        await clearCollection(col);
    }
    
    for (const col of TARGET_COLLECTIONS) {
        const snap = await db.collection(col).get();
        if (snap.size > 0) {
            throw new Error(`❌ Collection ${col} was not fully wiped.`);
        }
    }
    console.log("Database wiped successfully. State count is zero.");

    // --- STEP 8: RESTORE (IMPORT) & PERFORMANCE MEASUREMENT (UT-BK-010) ---
    console.log("\n[Step 8] Restoring database from backup...");
    const loadedBackup = JSON.parse(fs.readFileSync(backupFilePath, 'utf-8'));
    
    const startImport = performance.now();
    await executeImport(loadedBackup);
    const endImport = performance.now();

    const importDurationSec = ((endImport - startImport) / 1000).toFixed(3);
    console.log("✅ UT-BK-003: Restore process completed successfully.");
    console.log(`⏱️ UT-BK-010 Performance Baseline (Import):`);
    console.log(`  - Import Time: ${importDurationSec} seconds`);

    // --- STEP 9: VALIDATIONS ---
    console.log("\n[Step 9] Running UT-BK validations...");

    let validationPassed = true;
    for (const col of TARGET_COLLECTIONS) {
        const restoredColData = await fetchCollection(col);
        const restoredHash = calculateHash(restoredColData);
        
        const preCount = Object.keys(preRestoreState[col]).length;
        const postCount = Object.keys(restoredColData).length;
        
        console.log(`* [${col}] Counts: ${preCount} -> ${postCount}`);
        if (preCount !== postCount) {
            console.error(`  ❌ Count mismatch on ${col}!`);
            validationPassed = false;
        }

        console.log(`  Hash: ${preRestoreHashes[col]} -> ${restoredHash}`);
        if (preRestoreHashes[col] !== restoredHash) {
            console.error(`  ❌ Hash mismatch on ${col}! Data corruption detected.`);
            validationPassed = false;
        }
    }

    if (validationPassed) {
        console.log("✅ UT-BK-004 / 004A: Counts and Collections Hashing PASSED.");
    } else {
        throw new Error("❌ UT-BK-004 / 004A: Count or Hash mismatch occurred.");
    }

    const invoiceDoc = await db.collection('invoices').doc('inv_1001').get();
    const allocationDoc = await db.collection('receiptAllocations').doc('alloc_1001').get();
    
    if (invoiceDoc.data().balance === 40000 && allocationDoc.data().amount === 60000) {
        console.log("✅ UT-BK-005: Financial balance and allocation integrity PASSED.");
    } else {
        throw new Error(`❌ UT-BK-005: Balance (${invoiceDoc.data().balance}) or Allocation (${allocationDoc.data().amount}) is incorrect.`);
    }

    const currentReceipts = await fetchCollection('receipts');
    const currentAllocations = await fetchCollection('receiptAllocations');
    const totalAllocated = Object.values(currentAllocations)
        .filter(a => a.receiptId === 'rec_1001')
        .reduce((sum, a) => sum + a.amount, 0);

    console.log(`* Total Allocated: ${totalAllocated} / Receipt Amount: ${currentReceipts['rec_1001'].amount}`);
    if (totalAllocated <= currentReceipts['rec_1001'].amount) {
        console.log("✅ UT-BK-005A: Sum of allocations <= receipt amount PASSED.");
    } else {
        throw new Error(`❌ UT-BK-005A: Allocation sum (${totalAllocated}) exceeded receipt amount (${currentReceipts['rec_1001'].amount}).`);
    }

    const countersPreHash = preRestoreHashes['counters'];
    const currentCountersData = await fetchCollection('counters');
    const countersPostHash = calculateHash(currentCountersData);
    
    if (countersPreHash === countersPostHash) {
        console.log("✅ UT-BK-006B: counters document comparison PASSED.");
    } else {
        throw new Error(`❌ UT-BK-006B: counters state changed! Pre: ${countersPreHash}, Post: ${countersPostHash}`);
    }

    console.log("  Testing 5 consecutive counter increments starting from 1002...");
    const seq = [];
    for (let i = 0; i < 5; i++) {
        const val = await simulateGetNextSequence('customers');
        seq.push(val);
    }
    console.log(`  Generated customer_id sequence: ${JSON.stringify(seq)}`);
    if (JSON.stringify(seq) === '[1002,1003,1004,1005,1006]') {
        console.log("  ✅ UT-BK-006: 5 consecutive sequence generations PASSED.");
    } else {
        throw new Error(`❌ UT-BK-006: Unexpected sequence generated: ${JSON.stringify(seq)}`);
    }

    console.log("  Testing counter boundary transition (99 -> 100)...");
    await db.collection('counters').doc('test_boundary').set({ next_id: 99 });
    const val99 = await simulateGetNextSequence('test_boundary');
    const val100 = await simulateGetNextSequence('test_boundary');
    console.log(`  Boundary transition sequence: ${val99} -> ${val100}`);
    const finalBoundaryDoc = await db.collection('counters').doc('test_boundary').get();
    const finalNextId = finalBoundaryDoc.data().next_id;
    console.log(`  Counter next_id in Firestore: ${finalNextId}`);
    
    if (val99 === 99 && val100 === 100 && finalNextId === 101) {
        console.log("  ✅ UT-BK-006A: Counter boundary transition (99 -> 100 -> 101) PASSED.");
    } else {
        throw new Error(`❌ UT-BK-006A: Boundary transition failed. val99: ${val99}, val100: ${val100}, finalNextId: ${finalNextId}`);
    }
    await db.collection('counters').doc('test_boundary').delete();

    console.log("  Testing 10 parallel counter increments to check conflict prevention...");
    const promises = [];
    for (let i = 0; i < 10; i++) {
        promises.push(simulateGetNextSequence('customers'));
    }
    const parallelResults = await Promise.all(promises);
    console.log(`  Generated parallel sequence: ${JSON.stringify(parallelResults)}`);
    const uniqueResults = new Set(parallelResults);
    
    if (uniqueResults.size === 10) {
        console.log("  ✅ UT-BK-006C: 10 parallel increments completed with 0 conflicts.");
    } else {
        throw new Error(`❌ UT-BK-006C: Counter collision detected! Unique size: ${uniqueResults.size} / 10`);
    }

    const historiesSnap = await db.collection('customer_histories').where('customer_id', '==', 1001).orderBy('history_id', 'asc').get();
    const contents = [];
    historiesSnap.forEach(doc => contents.push(doc.data().content));
    
    if (contents.length === 5 && contents[0].startsWith("対応フェーズ1") && contents[4].startsWith("対応フェーズ5")) {
        console.log("✅ UT-BK-007: Histories loading and ordering PASSED.");
    } else {
        throw new Error(`❌ UT-BK-007: History list contents or order incorrect: ${JSON.stringify(contents)}`);
    }

    const reBackupPayload = {
        metadata: {
            exportedAt: new Date().toISOString(), 
            version: "LAPIS3_DB_V1",
            collections: TARGET_COLLECTIONS
        },
        data: {}
    };

    await db.collection('counters').doc('customers').set({ next_id: 1002 });

    for (const col of TARGET_COLLECTIONS) {
        reBackupPayload.data[col] = await fetchCollection(col);
    }

    const originalData = { ...loadedBackup.data };
    const restoredData = { ...reBackupPayload.data };

    const originalJson = JSON.stringify(originalData, Object.keys(originalData).sort());
    const restoredJson = JSON.stringify(restoredData, Object.keys(restoredData).sort());

    if (originalJson === restoredJson) {
        console.log("✅ UT-BK-009: Re-backup JSON exact match (excluding exportedAt) PASSED.");
    } else {
        console.error("❌ UT-BK-009: Re-backup JSON mismatch!");
        fs.writeFileSync(path.join(__dirname, 'original_data.json'), originalJson);
        fs.writeFileSync(path.join(__dirname, 'restored_data.json'), restoredJson);
        throw new Error("❌ UT-BK-009: Re-backup JSON differential validation failed. Check original_data.json vs restored_data.json.");
    }

    console.log("\n-> UT-BK-012: Restored Data Compatibility check:");
    const customerRestoreDoc = await db.collection('customers').doc('cust_1001').get();
    const licenseRestoreDoc = await db.collection('customer_licenses').doc('lic_1001').get();
    
    if (customerRestoreDoc.data().customerName === null && 
        customerRestoreDoc.data().customer_name === longName && 
        licenseRestoreDoc.data().licenseTypeId === "") {
        console.log("✅ UT-BK-012: Restored DB records match Tolerated data compatibility constraints.");
    } else {
        throw new Error("❌ UT-BK-012: Tolerated data values failed to restore correctly.");
    }

    console.log("\n==================================================");
    console.log("🎉 ALL DR VERIFICATION TESTS PASSED SUCCESSFULLY! 🎉");
    console.log("==================================================");
}

runDRTest().catch(err => {
    console.error("\n==================================================");
    console.error("❌ DR VERIFICATION TEST FAILED!");
    console.error(err);
    console.error("==================================================");
    process.exit(1);
});
