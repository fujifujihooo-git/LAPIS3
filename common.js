document.addEventListener('DOMContentLoaded', () => {
    const backToTopBtn = document.getElementById('back-to-top');

    if (backToTopBtn) {
        window.addEventListener('scroll', () => {
            if (window.pageYOffset > 200) {
                backToTopBtn.classList.add('show');
            } else {
                backToTopBtn.classList.remove('show');
            }
        });

        backToTopBtn.addEventListener('click', () => {
            window.scrollTo({
                top: 0,
                behavior: 'smooth'
            });
        });
    }

    // --- Amount Input Auto-Helper ---
    const amountInputs = document.querySelectorAll('.amount-input');
    amountInputs.forEach(input => {
        // 初期状態のフォーマット
        if (input.value) {
            input.value = unformatAmount(input.value);
            input.value = formatAmount(input.value);
        }

        input.addEventListener('focus', (e) => {
            e.target.value = unformatAmount(e.target.value);
        });

        input.addEventListener('blur', (e) => {
            e.target.value = formatAmount(e.target.value);
        });

        // 数字以外を入力不可に
        input.addEventListener('keypress', (e) => {
            if (!/[0-9]/.test(e.key)) {
                e.preventDefault();
            }
        });
    });

    console.log('LAPIS2 Common JS Loaded - v1.1.0');
    // --- Data Initialization ---
    initStaffData();

    // --- Authentication Check ---
    checkAuth();
});

// --- Data Initialization Functions ---
function initStaffData() {
    // 以前の localStorage ベースの初期化は不要なためコメントアウトまたは削除可能
    // 現在は Firestore にデータがある前提
}

// --- Authentication Functions ---
function checkAuth() {
    // Guard: firebase.auth may not be loaded yet
    if (typeof firebase === 'undefined' || typeof firebase.auth !== 'function') {
        console.warn('Firebase Auth SDK not yet loaded, retrying in 1s...');
        setTimeout(checkAuth, 1000);
        return;
    }

    const isLoginPage = window.location.pathname.endsWith('login.html');
    const isMigratePage = window.location.pathname.endsWith('migrate_auth.html');

    firebase.auth().onAuthStateChanged(async (user) => {
        if (!user) {
            if (!isLoginPage && !isMigratePage) {
                window.location.href = 'login.html';
            }
        } else {
            // セッション情報を最新に保つために Firestore から取得
            // セッション情報を最新に保つために Firestore から取得
            const session = JSON.parse(localStorage.getItem('lapis2_session'));

            // Modified: Do NOT auto-create session if on login page (let login.js handle 2FA)
            // or if 2FA is explicitly pending.
            const is2faPending = sessionStorage.getItem('lapis2_2fa_pending') === 'true';

            if ((!session || session.email !== user.email) && !isLoginPage && !is2faPending) {
                const staffData = await getDocFromFirestore('staff', 'email', user.email);
                if (staffData) {
                    const newSession = {
                        staff_id: staffData.staff_id,
                        staff_name: staffData.staff_name,
                        email: staffData.email,
                        login_at: new Date().toISOString()
                    };
                    localStorage.setItem('lapis2_session', JSON.stringify(newSession));
                    renderUserStatus(newSession);
                }
            } else if (session && !is2faPending) {
                renderUserStatus(session);
            }

            if (isLoginPage) {
                // Modified: Only redirect if session exists (2FA/Staff check completed)
                // AND 2FA is NOT pending
                const session = JSON.parse(localStorage.getItem('lapis2_session'));
                const is2faPending = sessionStorage.getItem('lapis2_2fa_pending') === 'true';

                if (session && session.email === user.email && !is2faPending) {
                    window.location.href = 'index.html';
                }
                // Otherwise, stay on login page to allow 2FA flow (login.js handles the rest)
            }
        }
    });
}

function renderUserStatus(session) {
    // Try New Header (Sidebar Layout)
    const headerRight = document.getElementById('header-right');
    // Try Old Header (Legacy Layout)
    const headerTier2 = document.querySelector('.unified-header-tier2');

    const targetContainer = headerRight || headerTier2;

    if (!targetContainer) return;

    // 既存のユーザーエリアがあれば削除
    const oldUserArea = document.getElementById('user-status-area');
    if (oldUserArea) oldUserArea.remove();

    const userArea = document.createElement('div');
    userArea.id = 'user-status-area';
    userArea.className = 'user-status-widget'; // Add class for styling
    userArea.style.display = 'flex';
    userArea.style.alignItems = 'center';
    userArea.style.gap = '16px';

    // Legacy styling fallback
    if (!headerRight) {
        userArea.style.marginLeft = 'auto';
        userArea.style.fontSize = '0.9rem';
    }

    userArea.innerHTML = `
        <div style="text-align: right; line-height: 1.2;">
            <div style="font-size: 0.75rem; color: #a0a0a0;">Signed in as</div>
            <div style="font-weight: 600; color: var(--text-main);">${session.staff_name}</div>
        </div>
        <button type="button" class="btn btn-sm btn-secondary" onclick="logout()" style="margin-left: 8px;">
            <span style="font-size: 14px">🚪</span>
        </button>
    `;

    targetContainer.appendChild(userArea);
}

async function logout() {
    if (confirm('ログアウトしますか？')) {
        try {
            await firebase.auth().signOut();
            localStorage.removeItem('lapis2_session');
            window.location.href = 'login.html';
        } catch (err) {
            console.error('Logout error:', err);
            alert('ログアウト中にエラーが発生しました。');
        }
    }
}

// --- Case & License Utilities ---
function getStatusClass(status) {
    switch (status) {
        case '相談': return 'status-sodan';
        case '受任': return 'status-junin';
        case '作成中': return 'status-sakusei';
        case '申請準備完了': return 'status-ready';
        case '受付（受理）': return 'status-uketuke';
        case '補正対応中': return 'status-hosei';
        case '完了': return 'status-kanryo';
        case '返却済': return 'status-henkyoku';
        case '取下げ': return 'status-torisage';
        default: return 'status-sodan';
    }
}

// --- Invoice Utilities ---
function getInvoiceStatusClass(status) {
    switch (status) {
        case '下書き': return 'status-draft';
        case '発行済': return 'status-issued';
        case '一部入金': return 'status-partial';
        case '入金済': return 'status-paid';
        case '延滞': return 'status-overdue';
        default: return 'status-draft';
    }
}

// 金額表示用 (¥ あり)
function formatCurrency(amount) {
    if (amount === undefined || amount === null || amount === '') return '¥0';
    return new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY' }).format(amount);
}

// 金額入力欄用 (カンマのみ)
function formatAmount(val) {
    if (!val && val !== 0) return '';
    const num = parseInt(unformatAmount(val));
    if (isNaN(num)) return '';
    return new Intl.NumberFormat('ja-JP').format(num);
}

function unformatAmount(val) {
    if (!val) return '';
    return String(val).replace(/,/g, '');
}

// 日付表示統一 YYYY/MM/DD
function formatDate(dateStr) {
    if (!dateStr || dateStr === 'null') return formatDisplayValue(null);

    // Firestore Timestampオブジェクトの場合
    if (dateStr && typeof dateStr.toDate === 'function') {
        const date = dateStr.toDate();
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}/${month}/${day}`;
    }

    // 文字列の場合
    if (typeof dateStr === 'string') {
        return dateStr.replace(/-/g, '/');
    }

    return formatDisplayValue(null);
}

// Input[type="date"]用 (YYYY-MM-DD)
function formatDateForInput(dateStr) {
    if (!dateStr || dateStr === 'null') return '';

    // Firestore Timestamp
    if (dateStr && typeof dateStr.toDate === 'function') {
        const date = dateStr.toDate();
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    // String (YYYY/MM/DD or YYYY-MM-DD)
    if (typeof dateStr === 'string') {
        return dateStr.replace(/\//g, '-').substring(0, 10);
    }

    return '';
}

// 「ー」表示統一 (グレー)
function formatDisplayValue(val) {
    if (val === undefined || val === null || val === '') {
        return '<span class="empty-placeholder">ー</span>';
    }
    return val;
}

// --- Validation Helpers ---
function validatePostalCode(zip) {
    const cleanZip = String(zip).replace(/[^0-9]/g, '');
    if (cleanZip.length !== 7) {
        return { valid: false, message: '郵便番号は7桁の数字で入力してください（例：1234567）' };
    }
    return { valid: true, value: cleanZip };
}

function validateEmail(email) {
    if (!email) return { valid: true }; // 任意項目の場合
    const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!regex.test(email)) {
        return { valid: false, message: '正しいメールアドレスの形式で入力してください（例：example@mail.com）' };
    }
    return { valid: true };
}

function showInputError(elementId, message) {
    const el = document.getElementById(elementId);
    if (!el) return;

    el.classList.add('error-input');

    // 既存のエラーメッセージがあれば削除
    const oldMsg = el.parentNode.querySelector('.error-message');
    if (oldMsg) oldMsg.remove();

    const msgDiv = document.createElement('div');
    msgDiv.className = 'error-message';
    msgDiv.textContent = message;
    el.parentNode.appendChild(msgDiv);
}

function clearInputErrors() {
    const errors = document.querySelectorAll('.error-input');
    errors.forEach(el => el.classList.remove('error-input'));
    const messages = document.querySelectorAll('.error-message');
    messages.forEach(el => el.remove());
}

// --- Feedback ---
function showToast(message, type = 'success') {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    const icon = type === 'success' ? '✓' : '✗';
    toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;

    container.appendChild(toast);

    // 3秒後に削除
    setTimeout(() => {
        toast.remove();
    }, 3000);
}

// --- Sorting ---
function makeTableSortable(tableId) {
    const table = document.getElementById(tableId);
    if (!table) return;

    const headers = table.querySelectorAll('th');
    headers.forEach((th, index) => {
        th.classList.add('sortable-header');
        th.innerHTML += ' <span class="sort-icon"></span>';

        let sortOrder = 0; // 0: none, 1: asc, 2: desc

        th.addEventListener('click', () => {
            sortOrder = (sortOrder + 1) % 3;

            // アイコン更新
            headers.forEach(h => h.querySelector('.sort-icon').textContent = '');
            const icon = th.querySelector('.sort-icon');
            if (sortOrder === 1) icon.textContent = '↑';
            if (sortOrder === 2) icon.textContent = '↓';

            if (sortOrder === 0) {
                // 元の順序に戻すのは本来は元データを再描画すべきだが、簡易的に現状を維持するか、
                // あるいはID順などで再ソートする。ここでは「元に戻す」＝再描画を呼び出す必要があるため、
                // 各画面の render 関数と連携させるのが理想。
                // 汎用的には index 命令などを持っていない限り難しい。
                // 今回は 1:ASC, 2:DESC のトグルとする。
                sortOrder = 1;
                icon.textContent = '↑';
            }

            sortTable(table, index, sortOrder === 1);
        });
    });
}

function sortTable(table, column, asc = true) {
    const tbody = table.tBodies[0];
    const rows = Array.from(tbody.rows);

    const sortedRows = rows.sort((a, b) => {
        const valA = a.cells[column].innerText.toLowerCase();
        const valB = b.cells[column].innerText.toLowerCase();

        // 数値判定
        const numA = parseFloat(valA.replace(/[^0-9.-]/g, ''));
        const numB = parseFloat(valB.replace(/[^0-9.-]/g, ''));

        if (!isNaN(numA) && !isNaN(numB)) {
            return asc ? numA - numB : numB - numA;
        }

        // 文字列
        return asc
            ? valA.localeCompare(valB, 'ja')
            : valB.localeCompare(valA, 'ja');
    });

    while (tbody.firstChild) {
        tbody.removeChild(tbody.firstChild);
    }
    tbody.append(...sortedRows);
}

// --- Data Sorting for List Screens ---
function handleSort(tableId, data, column, type, direction) {
    if (!data || data.length === 0) return [];

    const sortedData = [...data].sort((a, b) => {
        let valA = a[column];
        let valB = b[column];

        // undefined/null handling
        if (valA === undefined || valA === null) valA = '';
        if (valB === undefined || valB === null) valB = '';

        if (type === 'number' || typeof valA === 'number') {
            const numA = parseFloat(valA);
            const numB = parseFloat(valB);
            return direction === 'asc' ? numA - numB : numB - numA;
        }

        // Default: string comparison
        valA = String(valA).toLowerCase();
        valB = String(valB).toLowerCase();
        return direction === 'asc'
            ? valA.localeCompare(valB, 'ja')
            : valB.localeCompare(valA, 'ja');
    });

    return sortedData;
}

function updateSortIndicators(tableId, activeColumn, direction) {
    const table = document.getElementById(tableId);
    if (!table) return;

    table.querySelectorAll('th.sortable').forEach(th => {
        th.classList.remove('sort-asc', 'sort-desc');
        if (th.dataset.sort === activeColumn) {
            th.classList.add(direction === 'asc' ? 'sort-asc' : 'sort-desc');
        }
    });
}

// --- Common UI Logic ---
function calculateRemainingDays(scheduledDate) {
    if (!scheduledDate) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const targetDate = new Date(scheduledDate);
    targetDate.setHours(0, 0, 0, 0);
    const diffTime = targetDate - today;
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

function formatRemainingDays(days) {
    if (days === null) return formatDisplayValue(null);
    if (days === 0) return '今日';
    if (days > 0) return `${days}日後`;
    return `${Math.abs(days)}日超過`;
}

function getRemainingDaysClass(days) {
    if (days === null) return 'days-none';
    if (days >= 14) return 'days-safe';
    if (days >= 7) return 'days-warning';
    if (days >= 3) return 'days-danger';
    return 'days-critical';
}

function formatLicenseNumber(license) {
    if (!license) return '';
    const n1 = license.license_number_1 || '';
    const n2 = license.license_number_2 || '';
    if (!n1 && !n2) return formatDisplayValue(null);
    return `${n1}${n2 ? '-' + n2 : ''}`;
}

// --- Firestore Integration Helpers (Phase 2) ---
// Note: These use the global 'db' instance from firebase-config.js

async function getAllFromFirestore(collectionName) {
    try {
        const snapshot = await db.collection(collectionName).get();
        return snapshot.docs.map(doc => doc.data());
    } catch (err) {
        console.error(`Firestore fetch error (${collectionName}):`, err);
        return [];
    }
}

async function getDocFromFirestore(collectionName, arg2, arg3) {
    try {
        if (arg3 !== undefined) {
            // Old pattern: getDocFromFirestore('staff', 'email', 'user@example.com')
            // Query-based lookup
            const snapshot = await db.collection(collectionName).where(arg2, '==', arg3).get();
            if (snapshot.empty) return null;
            return snapshot.docs[0].data();
        } else {
            // New pattern: getDocFromFirestore('government_offices', 'off_5')
            // Direct document ID lookup
            const docRef = await db.collection(collectionName).doc(arg2).get();
            if (!docRef.exists) return null;
            return docRef.data();
        }
    } catch (err) {
        console.error(`Firestore doc fetch error (${collectionName}):`, err);
        return null;
    }
}

async function saveToFirestore(collectionName, docId, data) {
    try {
        // saveToFirestore('customers', 'cust_1', { ... })
        // Always use docId directly as the document ID
        await db.collection(collectionName).doc(docId).set(data, { merge: true });
    } catch (err) {
        console.error(`Firestore save error (${collectionName}):`, err);
        throw err;
    }
}

async function deleteFromFirestore(collectionName, arg2, arg3) {
    try {
        if (arg3 !== undefined) {
            // Old pattern: deleteFromFirestore('staff', 'staff_id', 5)
            // Query-based delete
            const snapshot = await db.collection(collectionName).where(arg2, '==', arg3).get();
            if (snapshot.empty) {
                console.warn(`No document found to delete in ${collectionName} with ${arg2}=${arg3}`);
                return false;
            }
            const batch = db.batch();
            snapshot.docs.forEach(doc => batch.delete(doc.ref));
            await batch.commit();
            console.log(`Document(s) deleted from ${collectionName} where ${arg2}=${arg3}`);
            return true;
        } else {
            // New pattern: deleteFromFirestore('government_offices', 'off_5')
            // Direct document ID delete
            await db.collection(collectionName).doc(arg2).delete();
            console.log(`Document deleted from ${collectionName}: ${arg2}`);
            return true;
        }
    } catch (err) {
        console.error(`Firestore delete error (${collectionName}):`, err);
        throw err;
    }
}

// --- ID Generation Helper ---
async function getNextSequence(counterName) {
    const docRef = db.collection('counters').doc(counterName);
    return db.runTransaction(async (transaction) => {
        const doc = await transaction.get(docRef);
        let newCount = 1;
        if (doc.exists) {
            newCount = (doc.data().count || 0) + 1;
        }
        transaction.set(docRef, { count: newCount });
        return newCount;
    });
}
