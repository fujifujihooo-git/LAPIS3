/**
 * LAPIS2 -> LAPIS3 LocalStorage Migration Bridge
 * Policy: Lazy Migration with Deferred Cleanup
 */
(() => {
    const MIGRATION_FLAG_KEY = 'lapis3_migration_completed';
    // 移行対象のレガシーキー群
    const legacyKeys = ['lapis2_session', 'lapis2_device_id'];

    try {
        // [フェーズ2] 移行完了フラグがあれば旧キーを安全に削除（Deferred Cleanup）
        if (localStorage.getItem(MIGRATION_FLAG_KEY) === 'true') {
            legacyKeys.forEach(oldKey => {
                if (localStorage.getItem(oldKey) !== null) {
                    localStorage.removeItem(oldKey);
                    console.log(`[LAPIS3 Migration] Cleaned up legacy storage key: ${oldKey}`);
                }
            });
            return; // クリーンアップ完了済みの場合は処理終了
        }

        // [フェーズ1] 移行フラグがない場合、旧キーから新キーへデータをコピー
        let allMigrated = true;
        let migrationAttempted = false;

        legacyKeys.forEach(oldKey => {
            const newKey = oldKey.replace('lapis2_', 'lapis3_');
            const oldVal = localStorage.getItem(oldKey);
            
            if (oldVal !== null) {
                migrationAttempted = true;
                if (localStorage.getItem(newKey) === null) {
                    localStorage.setItem(newKey, oldVal);
                    console.log(`[LAPIS3 Migration] Lazy migrated: ${oldKey} -> ${newKey}`);
                }
            } else {
                // 古いデータが存在しない場合は、そのキーについては移行の必要なし
            }
        });

        // データのコピー（移行）が完了した、または元からLAPIS2データが存在しない新規ユーザーの場合
        // フラグを立てて、次回起動時(次回リロード時)に旧キーを削除させる
        if (allMigrated || !migrationAttempted) {
            localStorage.setItem(MIGRATION_FLAG_KEY, 'true');
        }
    } catch (e) {
        console.error('[LAPIS3 Migration] Error during storage migration:', e);
    }
})();

document.addEventListener('DOMContentLoaded', () => {
    // --- Back to Top Logic ---
    const btnTop = document.getElementById('back-to-top');

    // 要素が存在しないページでのエラーを防ぐガード節
    if (btnTop) {
        window.addEventListener('scroll', () => {
            // 300px以上スクロールで表示
            if (window.scrollY > 300) {
                btnTop.style.opacity = '1';
                btnTop.style.pointerEvents = 'auto';
            } else {
                btnTop.style.opacity = '0';
                btnTop.style.pointerEvents = 'none';
            }
        });

        // クリックで最上部へスムーススクロール
        btnTop.addEventListener('click', () => {
            window.scrollTo({ top: 0, behavior: 'smooth' });
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

    console.log('LAPIS3 Common JS Loaded - v1.2.0');
    // --- Data Initialization ---
    initStaffData();

    // --- Authentication Check ---
    checkAuth();

    // --- Mobile Sidebar Toggle ---
    const mobileToggle = document.getElementById('mobile-toggle');
    const sidebarOverlay = document.querySelector('.sidebar-overlay');

    if (mobileToggle) {
        mobileToggle.addEventListener('click', () => {
            document.body.classList.toggle('sidebar-open');
        });
    }

    if (sidebarOverlay) {
        sidebarOverlay.addEventListener('click', () => {
            document.body.classList.remove('sidebar-open');
        });
    }

    // --- Lucide Icons Initialization ---
    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
    }

    // --- DatePicker & MonthPicker ---
    initDatePicker();
    if (typeof initUnifiedMonthPicker === 'function') { initUnifiedMonthPicker(); }
});

function initDatePicker() {
    // Use UnifiedDatePicker if available (preferred)
    if (typeof initUnifiedDatePicker === 'function') {
        initUnifiedDatePicker();
        console.log('UnifiedDatePicker initialized.');
        return;
    }

    // Fallback: Flatpickr
    if (typeof flatpickr !== 'undefined') {
        const dateInputs = document.querySelectorAll('input[type="date"], .lapis-datepicker');
        dateInputs.forEach(input => {
            flatpickr(input, {
                locale: "ja", altInput: true, altFormat: "Y/m/d",
                dateFormat: "Y-m-d", allowInput: true, disableMobile: true,
                monthSelectorType: "dropdown"
            });
        });
        return;
    }

    console.warn('No date picker library found.');
}

/**
 * Update the text of a wareki helper element
 */
function updateWarekiHelper(helperElement, dateStr) {
    if (!helperElement) return;
    if (!dateStr) {
        helperElement.textContent = '';
        return;
    }
    const wareki = convertToWareki(dateStr);
    helperElement.textContent = wareki ? `(${wareki})` : '';
}

/**
 * Convert ISO date string (YYYY-MM-DD) to Japanese Era (Wareki)
 * Example: 2026-02-25 -> 令和8年2月25日
 */
function convertToWareki(dateStr) {
    if (!dateStr) return null;
    try {
        const date = new Date(dateStr);
        if (isNaN(date.getTime())) return null;

        // Use Intl.DateTimeFormat for accurate era calculation
        const formatter = new Intl.DateTimeFormat('ja-JP-u-ca-japanese', {
            era: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });

        // The format produced is "令和8年2月25日"
        return formatter.format(date);
    } catch (e) {
        console.error('Wareki conversion error:', e);
        return null;
    }
}

/**
 * Convert Date, Firestore Timestamp, or ISO string to JST Time String
 * Output Format: YYYY/MM/DD HH:mm
 */
function formatToJST(dateInput) {
    if (!dateInput) return '-';

    let d;
    if (typeof dateInput === 'string') {
        d = new Date(dateInput);
    } else if (typeof dateInput.toDate === 'function') {
        d = dateInput.toDate();
    } else {
        d = new Date(dateInput);
    }

    if (isNaN(d.getTime())) return '-';

    // Japanese Time Settings
    const options = {
        timeZone: 'Asia/Tokyo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    };

    try {
        const formatter = new Intl.DateTimeFormat('ja-JP', options);
        // => "2026/03/03 10:10" (some environments may use commas/slashes differently by default, so we replace)
        const parts = formatter.formatToParts(d);
        const map = {};
        parts.forEach(p => map[p.type] = p.value);
        return `${map.year}/${map.month}/${map.day} ${map.hour}:${map.minute}`;
    } catch (e) {
        console.error('JST Date formatting error:', e);
        return '-';
    }
}


// --- Data Initialization Functions ---
function initStaffData() {
    // 以前の localStorage ベースの初期化は不要なためコメントアウトまたは削除可能
    // 現在は Firestore にデータがある前提
}

// --- Authentication Functions ---
// --- RBAC Helpers ---
function canAccessAccounting() {
    try {
        const session = JSON.parse(localStorage.getItem('lapis3_session'));
        return session && (session.authority === 'admin' || session.authority === 'accounting');
    } catch (e) {
        return false;
    }
}

function isUserAdmin() {
    try {
        const session = JSON.parse(localStorage.getItem('lapis3_session'));
        return session && session.authority === 'admin';
    } catch (e) {
        return false;
    }
}

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
            const session = JSON.parse(localStorage.getItem('lapis3_session'));

            // Modified: Do NOT auto-create session if on login page (let login.js handle 2FA)
            // or if 2FA is explicitly pending.
            const is2faPending = sessionStorage.getItem('lapis3_2fa_pending') === 'true';

            if ((!session || session.email !== user.email) && !isLoginPage && !is2faPending) {
                const staffData = await getDocFromFirestore('staff', 'email', user.email);
                if (staffData) {
                    const newSession = {
                        staff_id: staffData.staff_id,
                        staff_name: staffData.staff_name,
                        email: staffData.email,
                        authority: staffData.authority || (staffData.role === '管理者' ? 'admin' : 'staff'),
                        login_at: new Date().toISOString()
                    };
                    localStorage.setItem('lapis3_session', JSON.stringify(newSession));
                    renderUserStatus(newSession);
                    applyPermissions(newSession);
                }
            } else if (session && !is2faPending) {
                renderUserStatus(session);
                applyPermissions(session);

                // Background update to sync role changes
                getDocFromFirestore('staff', 'email', user.email).then(staffData => {
                    if (staffData) {
                        const currentAuth = staffData.authority || (staffData.role === '管理者' ? 'admin' : 'staff');
                        if (session.authority !== currentAuth || session.staff_name !== staffData.staff_name) {
                            session.authority = currentAuth;
                            session.staff_name = staffData.staff_name;
                            localStorage.setItem('lapis3_session', JSON.stringify(session));
                            renderUserStatus(session);
                            applyPermissions(session);
                        }
                    }
                }).catch(err => console.error("Background session sync failed", err));
            }

            if (isLoginPage) {
                // Modified: Only redirect if session exists (2FA/Staff check completed)
                // AND 2FA is NOT pending
                const session = JSON.parse(localStorage.getItem('lapis3_session'));
                const is2faPending = sessionStorage.getItem('lapis3_2fa_pending') === 'true';

                if (session && session.email === user.email && !is2faPending) {
                    window.location.href = 'index.html';
                }
                // Otherwise, stay on login page to allow 2FA flow (login.js handles the rest)
            }
        }
    });
}

function applyPermissions(session) {
    console.log("Current User Role:", session.authority);
    // サイドバーのバックアップ／インポート管理リンク制御
    const adminLinks = [
        document.querySelector('a[href="backup.html"]'),
        document.querySelector('a[href="import.html"]')
    ];
    adminLinks.forEach(link => {
        if (link) {
            const parentLi = link.closest('li');
            if (parentLi) {
                if (session.authority === 'admin') {
                    parentLi.style.display = 'block';
                } else {
                    parentLi.style.display = 'none';
                }
            }
        }
    });

    // 経理系リンク（未収一覧・入金消込）の制御
    const accountingLinks = [
        document.querySelector('a[href="unpaid_invoice_list.html"]')
    ];
    accountingLinks.forEach(link => {
        if (link) {
            const parentLi = link.closest('li');
            if (parentLi) {
                if (session.authority === 'admin' || session.authority === 'accounting') {
                    parentLi.style.display = 'block';
                } else {
                    parentLi.style.display = 'none';
                }
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
            <div class="user-signed-in-label">Signed in as</div>
            <div class="user-display-name">${session.staff_name}</div>
        </div>
        <button type="button" class="btn-logout" onclick="logout()">
            <i data-lucide="log-out"></i> ログアウト
        </button>
    `;

    targetContainer.appendChild(userArea);

    // Re-initialize Lucide icons to render the new log-out icon
    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
    }
}

async function logout() {
    if (confirm('ログアウトしますか？')) {
        try {
            await firebase.auth().signOut();
            localStorage.removeItem('lapis3_session');
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
/**
 * クライアントサイドでの配列ソート処理を行う共通関数
 * @param {Array} casesArray - ソート対象の配列
 * @param {Object} currentSort - ソート状態 { key: 'status'|'acceptance_date'|'remaining_days'|null, order: 'asc'|'desc'|null }
 * @returns {Array} ソート済みの新しい配列
 */
function sortCasesCommon(casesArray, currentSort) {
    if (!currentSort.key || !currentSort.order) {
        // デフォルト: 期限が近い順 > 受付日順
        return [...casesArray].sort((a, b) => {
            const daysA = typeof calculateRemainingDays === 'function' ? calculateRemainingDays(a.application_scheduled_date) : null;
            const daysB = typeof calculateRemainingDays === 'function' ? calculateRemainingDays(b.application_scheduled_date) : null;
            if (daysA !== null && daysB !== null) return daysA - daysB;
            if (daysA !== null) return -1;
            if (daysB !== null) return 1;
            return new Date(b.acceptance_date || 0) - new Date(a.acceptance_date || 0);
        });
    }

    const statusPriority = {
        '相談': 1, '受任': 2, '作成中': 3, '申請準備完了': 4,
        '受付（受理）': 5, '補正対応中': 6, '完了': 7, '返却済': 8, '取下げ': 9
    };
    const terminalStatuses = ['完了', '返却済', '取下げ', '失効', '取消'];

    return [...casesArray].sort((a, b) => {
        const orderMultiplier = currentSort.order === 'asc' ? 1 : -1;

        // 終結ステータスの特殊処理（昇順・降順に関わらず常にリストの最下部へ）
        const isTerminalA = terminalStatuses.includes(a.status);
        const isTerminalB = terminalStatuses.includes(b.status);

        if (isTerminalA && !isTerminalB) return 1; // Aが終結なら常に後
        if (!isTerminalA && isTerminalB) return -1; // Bが終結なら常に後
        if (isTerminalA && isTerminalB) return 0;   // 共に終結ならそのまま

        switch (currentSort.key) {
            case 'status':
                const priorityA = statusPriority[a.status] || 99;
                const priorityB = statusPriority[b.status] || 99;
                if (priorityA !== priorityB) {
                    return (priorityA - priorityB) * orderMultiplier;
                }
                break;
            case 'acceptance_date':
                const dateA = a.acceptance_date || '';
                const dateB = b.acceptance_date || '';
                if (dateA !== dateB) {
                    return dateA.localeCompare(dateB) * orderMultiplier;
                }
                break;
            case 'remaining_days':
                if (typeof calculateRemainingDays === 'function') {
                    const daysA = calculateRemainingDays(a.application_scheduled_date);
                    const daysB = calculateRemainingDays(b.application_scheduled_date);
                    // 期日が未定（null）のものも一番下に回す
                    const valA = daysA === null ? Infinity : daysA;
                    const valB = daysB === null ? Infinity : daysB;

                    if (valA > valB) return 1 * orderMultiplier;
                    if (valA < valB) return -1 * orderMultiplier;
                }
                return 0;
        }
        return new Date(b.created_date || 0) - new Date(a.created_date || 0);
    });
}

/**
 * 汎用ソートヘッダー初期化関数
 * @param {string} containerSelector - テーブル等のコンテナ要素（例: '#case-table'）
 * @param {Object} sortStateObj - ソート状態を保持するオブジェクト（参照渡し）
 * @param {Function} onSortChanged - ソート状態変更時に呼ばれるコールバック（レンダリング処理等）
 */
function initSortHeaders(containerSelector, sortStateObj, onSortChanged) {
    const container = document.querySelector(containerSelector);
    if (!container) return;

    const headers = container.querySelectorAll('th.sortable');
    headers.forEach(header => {
        header.addEventListener('click', () => {
            const sortKey = header.getAttribute('data-sort');

            if (sortStateObj.key === sortKey) {
                if (sortStateObj.order === 'asc') sortStateObj.order = 'desc';
                else { sortStateObj.order = null; sortStateObj.key = null; }
            } else {
                sortStateObj.key = sortKey;
                sortStateObj.order = 'asc';
            }

            updateSortUI(container, sortStateObj);
            if (onSortChanged) onSortChanged();
        });
    });
    // 初期状態の反映
    updateSortUI(container, sortStateObj);
}

function updateSortUI(container, sortStateObj) {
    const headers = container.querySelectorAll('th.sortable');
    headers.forEach(header => {
        const iconSpan = header.querySelector('.sort-icon');
        const key = header.getAttribute('data-sort');

        header.classList.remove('sort-active');
        if (iconSpan) iconSpan.innerHTML = '<span style="color:#ccc; margin-left:4px; font-size:0.8em;">↕</span>';

        if (sortStateObj.key === key) {
            header.classList.add('sort-active');
            if (iconSpan) {
                iconSpan.innerHTML = sortStateObj.order === 'asc'
                    ? '<span style="color:var(--primary); margin-left:4px;">▲</span>'
                    : '<span style="color:var(--primary); margin-left:4px;">▼</span>';
            }
        }
    });
}

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

    let targetDate;
    if (typeof scheduledDate.toDate === 'function') {
        targetDate = scheduledDate.toDate();
    } else {
        targetDate = new Date(scheduledDate);
    }

    if (isNaN(targetDate.getTime())) return null;

    targetDate.setHours(0, 0, 0, 0);
    const diffTime = targetDate - today;
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

function formatRemainingDays(days, status) {
    // 完了済みのステータスは「ー」を表示
    const terminalStatuses = ['完了', '返却済', '取下げ'];
    if (status && terminalStatuses.includes(status)) {
        return '<span class="empty-placeholder">ー</span>';
    }

    if (days === null) return formatDisplayValue(null);
    if (days === 0) return '今日';
    if (days > 0) return `${days}日後`;
    return `${Math.abs(days)}日超過`;
}

function getRemainingDaysClass(days, status) {
    const terminalStatuses = ['完了', '返却済', '取下げ'];
    if (status && terminalStatuses.includes(status)) {
        return 'days-none';
    }

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

// --- Payment Allocation Helpers (Phase B) ---
/**
 * 入金消込を実行するトランザクション処理
 * @param {string} receiptId - 対象の入金ドキュメントID
 * @param {string} invoiceId - 充当先の請求書ドキュメントID
 * @param {number} allocateAmount - 充当する金額
 * @returns {Promise<string>} 作成された allocationId
 */
async function allocateReceiptToInvoice(receiptId, invoiceId, allocateAmount) {
    if (!receiptId || !invoiceId || typeof allocateAmount !== 'number' || allocateAmount <= 0) {
        throw new Error("Invalid parameters for allocation");
    }

    const receiptRef = db.collection('receipts').doc(receiptId);
    const invoiceRef = db.collection('invoices').doc(invoiceId);
    const allocationRef = db.collection('receiptAllocations').doc(); // 新規ID生成

    return db.runTransaction(async (transaction) => {
        const [receiptSnap, invoiceSnap] = await Promise.all([
            transaction.get(receiptRef),
            transaction.get(invoiceRef)
        ]);

        if (!receiptSnap.exists) throw new Error("Receipt does not exist.");
        if (!invoiceSnap.exists) throw new Error("Invoice does not exist.");

        const receiptData = receiptSnap.data();
        const invoiceData = invoiceSnap.data();

        if (receiptData.status !== 'active') throw new Error("Cannot allocate a cancelled receipt.");
        if (invoiceData.status === 'cancelled') throw new Error("Cannot allocate to a cancelled invoice.");

        // 残額チェック
        const currentReceiptBalance = receiptData.balance || 0;
        const currentInvoiceBalance = invoiceData.balance !== undefined ? invoiceData.balance : (invoiceData.totalAmount || 0);

        if (currentReceiptBalance < allocateAmount) {
            throw new Error(`Insufficient receipt balance. Requested: ${allocateAmount}, Available: ${currentReceiptBalance}`);
        }
        if (currentInvoiceBalance < allocateAmount) {
            throw new Error(`Allocation amount exceeds invoice balance. Requested: ${allocateAmount}, Balance: ${currentInvoiceBalance}`);
        }

        // --- 更新値の計算 ---
        // 請求書
        const newInvoiceAllocated = (invoiceData.allocatedAmount || 0) + allocateAmount;
        const newInvoiceBalance = currentInvoiceBalance - allocateAmount;
        
        let newInvoiceStatus = invoiceData.status;
        if (newInvoiceStatus === 'issued' || newInvoiceStatus === '一部入金') {
            if (newInvoiceBalance === 0) {
                newInvoiceStatus = '入金済';
            } else if (newInvoiceAllocated > 0) {
                newInvoiceStatus = '一部入金';
            }
        }

        // 入金データ
        const newReceiptAllocated = (receiptData.allocatedAmount || 0) + allocateAmount;
        const newReceiptBalance = currentReceiptBalance - allocateAmount;

        // --- 書き込み ---
        const serverTimestamp = firebase.firestore.FieldValue.serverTimestamp();

        // 1. レシート更新
        transaction.update(receiptRef, {
            allocatedAmount: newReceiptAllocated,
            balance: newReceiptBalance,
            lastUpdatedAt: serverTimestamp
        });

        // 2. 請求書更新
        transaction.update(invoiceRef, {
            allocatedAmount: newInvoiceAllocated,
            balance: newInvoiceBalance,
            status: newInvoiceStatus,
            lastUpdatedAt: serverTimestamp
        });

        // 3. 消込履歴作成
        // ※ invoicesコレクションのフィールド名は customer_id (snake_case)
        const resolvedCustomerId = invoiceData.customer_id || invoiceData.customerId || null;
        if (!resolvedCustomerId) {
            console.warn('[WARN] customerId could not be resolved from invoice data. Using null.');
        }

        transaction.set(allocationRef, {
            allocationId: allocationRef.id,
            receiptId: receiptId,
            invoiceId: invoiceId,
            amount: allocateAmount,
            status: 'active', // 'active' or 'cancelled'
            customerId: resolvedCustomerId,
            // N+1クエリ回避用: 表示に必要なスナップショットを冗長保持
            receiptDate: receiptData.receiptDate || '',
            payerName: receiptData.payerName || '',
            customerName: invoiceData.customer_name_snapshot || '',
            invoiceNumber: invoiceData.invoice_number || '',
            createdAt: serverTimestamp,
            lastUpdatedAt: serverTimestamp
        });

        return allocationRef.id;
    });
}

/**
 * 入金消込を取り消すトランザクション処理
 * @param {string} allocationId - 取消対象の Allocation ドキュメントID
 * @returns {Promise<void>}
 */
async function cancelReceiptAllocation(allocationId) {
    if (!allocationId) throw new Error("allocationId is required");

    const allocationRef = db.collection('receiptAllocations').doc(allocationId);

    return db.runTransaction(async (transaction) => {
        const allocSnap = await transaction.get(allocationRef);
        if (!allocSnap.exists) throw new Error("Allocation does not exist.");

        const allocData = allocSnap.data();
        if (allocData.status === 'cancelled') throw new Error("Allocation is already cancelled.");

        const receiptRef = db.collection('receipts').doc(allocData.receiptId);
        const invoiceRef = db.collection('invoices').doc(allocData.invoiceId);

        const [receiptSnap, invoiceSnap] = await Promise.all([
            transaction.get(receiptRef),
            transaction.get(invoiceRef)
        ]);

        if (!receiptSnap.exists) throw new Error("Associated receipt not found during cancellation.");
        if (!invoiceSnap.exists) throw new Error("Associated invoice not found during cancellation.");

        const receiptData = receiptSnap.data();
        const invoiceData = invoiceSnap.data();
        const amountToRestore = allocData.amount;

        // --- 状態復元計算 ---
        const newReceiptAllocated = Math.max(0, (receiptData.allocatedAmount || 0) - amountToRestore);
        const newReceiptBalance = (receiptData.balance || 0) + amountToRestore;

        const newInvoiceAllocated = Math.max(0, (invoiceData.allocatedAmount || 0) - amountToRestore);
        const newInvoiceBalance = (invoiceData.balance !== undefined ? invoiceData.balance : (invoiceData.totalAmount || 0)) + amountToRestore;

        let newInvoiceStatus = invoiceData.status;
        if (newInvoiceStatus === '入金済' || newInvoiceStatus === '一部入金') {
            if (newInvoiceAllocated === 0) {
                newInvoiceStatus = '発行済'; // 一部入金も無くなった場合
            } else {
                newInvoiceStatus = '一部入金';
            }
        }

        const serverTimestamp = firebase.firestore.FieldValue.serverTimestamp();

        // 1. レシート復元
        transaction.update(receiptRef, {
            allocatedAmount: newReceiptAllocated,
            balance: newReceiptBalance,
            lastUpdatedAt: serverTimestamp
        });

        // 2. 請求書復元
        transaction.update(invoiceRef, {
            allocatedAmount: newInvoiceAllocated,
            balance: newInvoiceBalance,
            status: newInvoiceStatus,
            lastUpdatedAt: serverTimestamp
        });

        // 3. Allocationの論理削除
        transaction.update(allocationRef, {
            status: 'cancelled',
            lastUpdatedAt: serverTimestamp
        });
    });
}
