document.addEventListener('DOMContentLoaded', async () => {
    // --- Selectors ---
    const form = document.getElementById('customer-form');
    const customerIdInput = document.getElementById('customer_id');
    const lastUpdatedDisplay = document.getElementById('last-updated-display');
    const relatedCasesBody = document.getElementById('related-cases-body');
    const officesListBody = document.getElementById('offices-list-body');
    const contactsListBody = document.getElementById('contacts-list-body');
    const licensesListBody = document.getElementById('licenses-list-body');
    const btnBack = document.getElementById('btn-back');
    const btnBackTop = document.getElementById('btn-back-top');
    const btnDelete = document.getElementById('btn-delete');
    const btnExportPdf = document.getElementById('btn-export-pdf');
    const btnExportExcel = document.getElementById('btn-export-excel');

    // --- State ---
    let customers = [];
    let cases = [];
    let offices = [];
    let contacts = [];
    let licenses = [];
    let licenseTypes = [];
    let staffMembers = [];
    let currentCustomer = null;
    let customerIdParam = null;

    // Sorting state for Related Cases
    let currentRelatedSort = { key: null, order: null };

    // --- Functions ---
    // [DESTRUCTIVE TEST HOOK] 検証終了後に完全削除すること
    async function executeTestHook() {
        const isTestMode = (location.hostname === 'localhost' || location.hostname === '127.0.0.1') && (window.__TEST_MODE__ === true);
        if (!isTestMode) return;
        
        const params = new URLSearchParams(window.location.search);
        if (params.get('test_delay')) {
            const delayMs = parseInt(params.get('test_delay')) || 1000;
            console.warn(`[TEST HOOK] Injecting ${delayMs}ms delay`);
            await new Promise(r => setTimeout(r, delayMs));
        }
        if (params.get('test_error') === 'true') {
            console.warn(`[TEST HOOK] Forcing error`);
            throw new Error('Forced Error by Test Hook');
        }
    }

    function getCustomerIdFromUrl() {
        return new URLSearchParams(window.location.search).get('id');
    }

    /* ===============================
       Decoupled Data Fetching Logic (Phase 4)
    =============================== */
    let lastVisibleDoc = {
        offices: null,
        contacts: null,
        licenses: null,
        cases: null
    };

    async function init() {
        const tStart = performance.now();
        console.log('Initializing Customer Detail (1-Frame Mode)...');
        customerIdParam = getCustomerIdFromUrl();
        
        // 1. Synchronous UI initialization & Cache preview
        initAdditionalDropdowns();
        
        if (customerIdParam === 'new') {
            customers = [];
            cases = []; offices = []; contacts = []; licenses = [];
            updateScreenMode('new');
            
            // Wait for next ID but don't block basic UI
            getNextSequence('customers').then(nextId => {
                customerIdInput.value = nextId;
            });
            
        } else {
            const cId = !isNaN(customerIdParam) ? Number(customerIdParam) : customerIdParam;
            // [Preview Phase] Try to load from Session Storage (temp_transition_customer)
            try {
                const tempStr = sessionStorage.getItem('temp_transition_customer');
                if (tempStr) {
                    const tempData = JSON.parse(tempStr);
                    if (Number(tempData.customer_id) === cId) {
                        currentCustomer = tempData;
                        customers = [currentCustomer];
                        populateForm(currentCustomer);
                        const headerTitle = document.getElementById('header-title');
                        if (headerTitle) headerTitle.textContent = `顧客詳細：${currentCustomer.customer_name || ''}`;
                    }
                }
            } catch (e) { console.warn('Preview parse error', e); }

            // Start Skeleton on lists
            ['offices-list-body', 'contacts-list-body', 'licenses-list-body', 'related-cases-body'].forEach(id => {
                const tbody = document.getElementById(id);
                if (tbody) {
                    tbody.innerHTML = Array(3).fill('<tr><td colspan="10"><div class="skeleton-row skeleton-shimmer"></div></td></tr>').join('');
                }
            });
        }

        // --- 顧客名の入力に連動してヘッダータイトルを動的に更新 ---
        const nameInput = document.getElementById('customer_name');
        const headerTitle2 = document.getElementById('header-title');
        const nameDisplay = document.getElementById('customer-name-display');
        if (nameInput) {
            nameInput.addEventListener('input', (e) => {
                const val = e.target.value.trim();
                if (headerTitle2) headerTitle2.textContent = `顧客詳細：${val}`;
                if (nameDisplay) nameDisplay.textContent = val || '―';
            });
        }

        // RBAC: 削除ボタンの表示制御（管理者のみ）
        if (btnDelete && !isUserAdmin()) {
            btnDelete.style.display = 'none';
        }
        
        // Refresh Cache Event Listener
        const btnRefresh = document.getElementById('btn-refresh-cache');
        if (btnRefresh) {
            btnRefresh.addEventListener('click', async () => {
                if (customerIdParam !== 'new') {
                    window.AppCache.invalidate(`customer_${customerIdParam}`);
                    await refreshCustomerUI(parseInt(customerIdParam));
                }
            });
        }

        const tEnd = performance.now();
        console.table({
            'Phase': 'Initial UI Render',
            'Time (ms)': (tEnd - tStart).toFixed(2)
        });

        // 2. Asynchronous Data Fetching Phase
        if (customerIdParam !== 'new') {
            updateScreenMode('existing');
            const cId = !isNaN(customerIdParam) ? Number(customerIdParam) : customerIdParam;
            // Fetch everything, wait for completion to avoid race conditions
            await refreshCustomerUI(cId);
        }
        
        // Setup Sort Headers for cases (Sorting logic works on currently loaded cases array)
        initSortHeaders('#related-cases-table', currentRelatedSort, () => {
            if (currentCustomer && currentCustomer.customer_id) {
                renderRelatedCases(Number(currentCustomer.customer_id));
            }
        });

        // 組織・連絡タブ: 本店・代表連絡先カードのイベント設定
        setupHQCardEvents();
    }

    /* ===============================
       顧客カルテ画面 — UI描画関数
    =============================== */

    /** 顧客名ヘッダーカード更新 */
    function updateCustomerHeaderCard(data) {
        if (!data) return;
        const nameEl = document.getElementById('customer-name-display');
        if (nameEl) nameEl.textContent = data.customer_name || '―';

        const typeEl = document.getElementById('customer-type-badge');
        if (typeEl) typeEl.textContent = data.customer_type || '法人';

        const codeEl = document.getElementById('customer-code-display');
        if (codeEl) codeEl.textContent = `CUST${String(data.customer_id || '').padStart(6, '0')}`;

        const staffEl = document.getElementById('staff-display');
        if (staffEl) {
            const staff = staffMembers.find(s => s.staff_id === data.primary_staff_id);
            staffEl.textContent = staff ? staff.staff_name : '―';
        }

        const fiscalEl = document.getElementById('fiscal-display');
        if (fiscalEl) fiscalEl.textContent = data.fiscal_year_end_month ? `${data.fiscal_year_end_month}月` : '―';

        const corpEl = document.getElementById('corp-num-display');
        if (corpEl) corpEl.textContent = data.corporate_number || '―';

        const lastUpdEl = document.getElementById('last-updated-meta');
        if (lastUpdEl) {
            if (data.updated_at) {
                const d = data.updated_at.toDate ? data.updated_at.toDate() : new Date(data.updated_at);
                lastUpdEl.textContent = d.toLocaleString('ja-JP');
            } else {
                lastUpdEl.textContent = '―';
            }
        }

        // ページタイトル更新
        const pageTitle = document.getElementById('page-title');
        if (pageTitle) pageTitle.textContent = `顧客カルテ：${data.customer_name || ''}`;
    }

    /** 概要タブ 基本情報（読み取り専用テーブル）更新 */
    function updateOverviewTab(data) {
        if (!data) return;
        const setText = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val || '―'; };
        setText('ov-name', data.customer_name);
        setText('ov-kana', data.customer_kana);
        setText('ov-rep', data.representative_name);
        setText('ov-type', data.customer_type);
        setText('ov-fiscal', data.fiscal_year_end_month ? `${data.fiscal_year_end_month}月${data.fiscal_year_end_day || ''}日` : null);
        setText('ov-corp', data.corporate_number);
        setText('ov-phone', data.phone);
        setText('ov-fax', data.fax);
        setText('ov-email', data.email);
        setText('ov-zip', data.postal_code);
        setText('ov-addr', (data.address || '') + (data.building_name ? ' ' + data.building_name : '') || null);
        const staff = staffMembers.find(s => s.staff_id === data.primary_staff_id);
        setText('ov-staff', staff ? staff.staff_name : null);
        setText('ov-remarks', data.remarks);

        // 設立日: YYYY/MM/DD形式で表示
        const foundedEl = document.getElementById('ov-founded');
        if (foundedEl) {
            if (data.founded_date) {
                foundedEl.textContent = data.founded_date.replace(/-/g, '/');
            } else {
                foundedEl.textContent = '―';
            }
        }

        // 資本金: 千円単位のカンマ区切り表示
        const capitalEl = document.getElementById('ov-capital');
        if (capitalEl) {
            if (data.capital && Number(data.capital) > 0) {
                capitalEl.textContent = Number(data.capital).toLocaleString() + ' 千円';
            } else {
                capitalEl.textContent = '―';
            }
        }

        // 従業員数: 人単位で表示
        const employeesEl = document.getElementById('ov-employees');
        if (employeesEl) {
            if (data.employee_count && Number(data.employee_count) > 0) {
                employeesEl.textContent = Number(data.employee_count).toLocaleString() + ' 人';
            } else {
                employeesEl.textContent = '―';
            }
        }
    }

    /** サマリーカード4枚描画 */
    function renderSummaryCards(cId) {
        // 許認可サマリー
        const custLicenses = licenses.filter(l => l.customer_id === cId);
        const activeLics = custLicenses.filter(l => l.status === '有効');
        const now = new Date();
        const warn90 = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
        let warnCount = 0, expiredCount = 0;
        activeLics.forEach(l => {
            if (l.expiry_date) {
                const exp = l.expiry_date.toDate ? l.expiry_date.toDate() : new Date(l.expiry_date);
                if (exp < now) expiredCount++;
                else if (exp < warn90) warnCount++;
            }
        });
        const el = (id, val) => { const e = document.getElementById(id); if (e) e.textContent = val; };
        el('sc-lic-active', activeLics.length);
        el('sc-lic-total', custLicenses.length);
        el('sc-lic-warn', warnCount);
        el('sc-lic-expired', expiredCount);

        // 案件サマリー
        const custCases = cases.filter(c => c.customer_id === cId);
        const activeCases = custCases.filter(c => c.status && c.status !== '完了' && c.status !== '取下げ');
        const doneCases = custCases.filter(c => c.status === '完了');
        el('sc-case-active', activeCases.length);
        el('sc-case-done', doneCases.length);
        if (custCases.length > 0) {
            const latest = custCases.sort((a, b) => {
                const da = a.contract_date ? (a.contract_date.toDate ? a.contract_date.toDate() : new Date(a.contract_date)) : new Date(0);
                const db2 = b.contract_date ? (b.contract_date.toDate ? b.contract_date.toDate() : new Date(b.contract_date)) : new Date(0);
                return db2 - da;
            })[0];
            el('sc-case-recent', latest.license_type || latest.status || '―');
        } else {
            el('sc-case-recent', 'なし');
        }

        // 請求サマリー（プレースホルダー）
        el('sc-inv-unpaid', '-');
        el('sc-inv-amount', '（データ接続準備中）');

        // 要対応アラート
        const alertCount = warnCount + expiredCount + activeCases.filter(c => c.status === '受任' || c.status === '申請中').length;
        el('sc-alert-count', alertCount);
        const alertDetailEl = document.getElementById('sc-alert-detail');
        if (alertDetailEl) {
            const details = [];
            if (expiredCount > 0) details.push(`期限切れ ${expiredCount}件`);
            if (warnCount > 0) details.push(`期限注意 ${warnCount}件`);
            if (activeCases.length > 0) details.push(`進行中案件 ${activeCases.length}件`);
            alertDetailEl.textContent = details.length > 0 ? details.join('、') : '対応事項なし';
        }
    }

    /** 概要タブ 許認可・案件ミニテーブル描画 */
    function renderOverviewLists(cId) {
        // 許認可テーブル（上位5件）
        const licBody = document.getElementById('ov-license-body');
        if (licBody) {
            const custLics = licenses.filter(l => l.customer_id === cId);
            if (custLics.length === 0) {
                licBody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:#999;font-style:italic;padding:12px;">許認可データなし</td></tr>';
            } else {
                // 期限リスク順ソート: 期限切れ(古い順) → 期限あり(近い順) → 期限なし(最後尾)
                const MAX_DATE = new Date('9999-12-31');
                const sortedLics = [...custLics].sort((a, b) => {
                    const da = a.expiry_date ? (a.expiry_date.toDate ? a.expiry_date.toDate() : new Date(a.expiry_date)) : MAX_DATE;
                    const db2 = b.expiry_date ? (b.expiry_date.toDate ? b.expiry_date.toDate() : new Date(b.expiry_date)) : MAX_DATE;
                    return da - db2;
                });
                licBody.innerHTML = sortedLics.slice(0, 5).map(l => {
                    const type = licenseTypes.find(lt => lt.license_type_id === l.license_type_id);
                    const expDate = l.expiry_date ? (l.expiry_date.toDate ? l.expiry_date.toDate() : new Date(l.expiry_date)) : null;
                    const expStr = expDate ? expDate.toLocaleDateString('ja-JP') : '―';
                    const statusClass = l.status === '有効' ? 'badge-success-sm' : (l.status === '期限切れ' ? 'badge-danger-sm' : 'badge-warning-sm');
                    const licenseNum = typeof formatLicenseNumber === 'function' ? formatLicenseNumber(l) : (l.license_number || '―');
                    return `<tr>
                        <td>${type ? type.license_type_name : '―'}</td>
                        <td>${licenseNum}</td>
                        <td>${expStr}</td>
                        <td><span class="${statusClass}">${l.status || '―'}</span></td>
                    </tr>`;
                }).join('');
            }
        }

        // 案件テーブル（上位5件）
        const caseBody = document.getElementById('ov-case-body');
        if (caseBody) {
            const custCases = cases.filter(c => c.customer_id === cId);
            if (custCases.length === 0) {
                caseBody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:#999;font-style:italic;padding:12px;">案件データなし</td></tr>';
            } else {
                // 受任日（contract_date）で降順ソート
                const sortedCases = [...custCases].sort((a, b) => {
                    const da = a.contract_date ? (a.contract_date.toDate ? a.contract_date.toDate() : new Date(a.contract_date)) : new Date(0);
                    const db2 = b.contract_date ? (b.contract_date.toDate ? b.contract_date.toDate() : new Date(b.contract_date)) : new Date(0);
                    return db2 - da; // 降順
                });

                caseBody.innerHTML = sortedCases.slice(0, 5).map(c => {
                    const complDate = c.completion_date ? (c.completion_date.toDate ? c.completion_date.toDate() : new Date(c.completion_date)) : null;
                    const complStr = complDate ? complDate.toLocaleDateString('ja-JP') : '―';

                    // 受任日のフォーマット（YYYY/MM/DD）
                    const contDate = c.contract_date ? (c.contract_date.toDate ? c.contract_date.toDate() : new Date(c.contract_date)) : null;
                    const contStr = contDate ? `${contDate.getFullYear()}/${String(contDate.getMonth() + 1).padStart(2, '0')}/${String(contDate.getDate()).padStart(2, '0')}` : '―';

                    // 見積合計（税込）表示：
                    // パターン1: total_amount フィールドが存在する場合はそのまま利用
                    // パターン2: estimated_fee（税抜課税額）+ 消費税(10%) + suspense_receipt_amount（非課税額）で算出
                    let totalEstimate;
                    if (c.total_amount !== undefined && c.total_amount !== null && c.total_amount !== '') {
                        totalEstimate = Number(c.total_amount);
                    } else {
                        const taxable = Number(c.estimated_fee || 0);
                        const tax = Math.floor(taxable * 0.1);
                        const nontaxable = Number(c.suspense_receipt_amount || 0);
                        totalEstimate = taxable + tax + nontaxable;
                    }
                    const feeStr = totalEstimate > 0
                        ? totalEstimate.toLocaleString() + ' 円'
                        : '―';

                    // ステータスバッジ：案件一覧(app.js)と同じ getStatusKey マッピングを使用
                    const statusKeyMap = {
                        '相談': 'sodan', '受任': 'junin', '作成中': 'sakusei',
                        '作成完了': 'ready', '受付（受理）': 'uketuke', '補正': 'hosei',
                        '完了': 'kanryo', '取下げ': 'torisage', '返却（県局）': 'henkyoku'
                    };
                    const statusKey = statusKeyMap[c.status] || 'sodan';
                    const statusBadgeHtml = `<span class="badge status-${statusKey}">${c.status || '―'}</span>`;

                    return `<tr>
                        <td>
                            <div style="font-weight: 600;">${c.license_type || '―'}</div>
                            <div style="font-size: 0.85rem; color: var(--text-muted); margin-top: 2px;">${contStr === '―' ? '―' : contStr + ' 受任'}</div>
                        </td>
                        <td>${statusBadgeHtml}</td>
                        <td>${feeStr}</td>
                        <td>${complStr}</td>
                    </tr>`;
                }).join('');
            }
        }
    }

    /**
     * ページ上部統合警告バナーを表示
     * @param {string} title - 警告タイトル
     * @param {string} detail - 詳細メッセージ
     * @param {boolean} isIndexError - Firestoreインデックス不足かどうか
     */
    function showPageWarning(title, detail, isIndexError = false) {
        const container = document.getElementById('page-warning-container');
        if (!container) return;
        const cssClass = isIndexError ? 'warning-index' : 'warning-error';
        const icon = isIndexError ? '⚙️' : '⚠️';
        container.innerHTML = `<div class="page-warning-banner ${cssClass}">
            <span class="warning-icon">${icon}</span>
            <div class="warning-body">
                <div class="warning-title">${title}</div>
                <div class="warning-detail">${detail}</div>
            </div>
            <button type="button" class="btn-warning-retry" id="btn-page-retry">再読み込み</button>
        </div>`;
        const btn = container.querySelector('#btn-page-retry');
        if (btn) {
            btn.addEventListener('click', async () => {
                btn.disabled = true;
                btn.textContent = '読み込み中...';
                clearPageWarning();
                if (currentCustomer && currentCustomer.customer_id) {
                    await refreshCustomerUI(Number(currentCustomer.customer_id));
                }
            });
        }
    }

    /** ページ上部統合警告バナーを消去 */
    function clearPageWarning() {
        const container = document.getElementById('page-warning-container');
        if (container) container.innerHTML = '';
    }

    async function loadAllSections(cId, options = {}) {
        const { includeBasicData = false } = options;

        // Master data load if not cached (non-blocking)
        if (window.MasterDataManager) {
            window.MasterDataManager.loadAll().then(() => {
                licenseTypes = window.MasterDataManager.getLicenseTypes();
                staffMembers = window.MasterDataManager.getStaff();
                initAdditionalDropdowns();
                // Re-render lists that might depend on master data names after masters load
                renderRelatedCases(cId);
                renderOffices(cId);
                renderContacts(cId);
                renderLicenses(cId);
                // サマリーカードも再描画（staffName等が解決される）
                renderSummaryCards(cId);
                renderOverviewLists(cId);
            }).catch(e => console.error("Master data load error", e));
        }

        const tAllStart = performance.now();

        // 前回の警告をクリア
        clearPageWarning();
        
        // Parallel Async Fetching
        const promises = [
            loadOffices(cId).then(() => {
                console.log(`[Perf] Offices loaded in ${(performance.now() - tAllStart).toFixed(2)}ms`);
            }),
            loadContacts(cId).then(() => {
                console.log(`[Perf] Contacts loaded in ${(performance.now() - tAllStart).toFixed(2)}ms`);
            }),
            loadLicenses(cId).then(() => {
                console.log(`[Perf] Licenses loaded in ${(performance.now() - tAllStart).toFixed(2)}ms`);
            }),
            loadCases(cId).then(() => {
                console.log(`[Perf] Cases loaded in ${(performance.now() - tAllStart).toFixed(2)}ms`);
            })
        ];

        if (includeBasicData) {
            promises.push(
                loadCustomerBasicData(cId).then(() => {
                    console.log(`[Perf] Basic Info loaded in ${(performance.now() - tAllStart).toFixed(2)}ms`);
                })
            );
        }

        // 全データ読み込み完了後に結果を検査
        const results = await Promise.allSettled(promises);

        // 失敗したセクションを集計
        const failedResults = results.filter(r => r.status === 'rejected');
        if (failedResults.length > 0) {
            console.error('[CustomerDetail] Section load failures:', failedResults.map(r => r.reason));

            const hasIndexError = failedResults.some(r =>
                r.reason?.code === 'failed-precondition' ||
                (r.reason?.message && r.reason.message.includes('requires an index'))
            );

            if (hasIndexError) {
                showPageWarning(
                    '初期設定中です',
                    'データベース設定を適用中のため、数分後に再度お試しください。',
                    true
                );
            } else {
                showPageWarning(
                    '一部データの読み込みに失敗しました',
                    '再読み込みをお試しください。問題が続く場合は管理者にお問い合わせください。',
                    false
                );
            }
        }
        
        renderSummaryCards(cId);
        renderOverviewLists(cId);

        // [バッジ即時反映のための追加]
        // 各データセクション（拠点リストなど）と基本情報（登記上所在地IDを含む）のロードは非同期かつ並列で走るため、
        // 拠点一覧のロード（loadOffices）の時点で顧客基本情報のロード（loadCustomerBasicData）が未完了の場合、
        // 登記上所在地バッジが描画されないタイミングが発生します。
        // そのため、全セクションの並列ロード（Promise.allSettled）がすべて完了したこの最終段階で、
        // 最新の顧客データと拠点データを用いて「登記上所在地」バッジを含む拠点一覧を確実に再描画します。
        renderOffices(cId);

        console.log(`[Perf] All sections + summary loaded in ${(performance.now() - tAllStart).toFixed(2)}ms`);
    }

    async function refreshCustomerUI(cId) {
        await loadAllSections(cId, { includeBasicData: true });
    }

    function updateScreenMode(mode) {
        if (mode === 'new') {
            ['offices-table', 'contacts-table', 'licenses-table', 'related-cases-table'].forEach(id => {
                const el = document.getElementById(id);
                if (!el) return;
                const section = el.closest('.form-section') || el.closest('.org-section') || el.closest('.table-responsive');
                if (section) section.style.display = 'none';
            });
            customerIdInput.value = '採番中...';
            document.getElementById('page-title').textContent = '新規顧客登録';
            const headerTitle = document.getElementById('header-title');
            if (headerTitle) headerTitle.textContent = '顧客詳細：';
            if (btnDelete) btnDelete.style.display = 'none';
            const nameDisp = document.getElementById('customer-name-display');
            if (nameDisp) nameDisp.textContent = '新規顧客';
            const summaryCards = document.getElementById('summary-cards');
            if (summaryCards) summaryCards.style.display = 'none';
            
            const tabs = document.querySelectorAll('.tab-btn');
            const contents = document.querySelectorAll('.tab-content');
            tabs.forEach(t => t.classList.remove('active'));
            contents.forEach(c => c.classList.remove('active'));
            const basicTab = document.querySelector('[data-tab="basic"]');
            const basicContent = document.getElementById('tab-basic');
            if (basicTab) basicTab.classList.add('active');
            if (basicContent) basicContent.classList.add('active');
        } else if (mode === 'existing') {
            ['offices-table', 'contacts-table', 'licenses-table', 'related-cases-table'].forEach(id => {
                const el = document.getElementById(id);
                if (!el) return;
                const section = el.closest('.form-section') || el.closest('.org-section') || el.closest('.table-responsive');
                if (section) section.style.display = '';
            });
            if (btnDelete && isUserAdmin()) btnDelete.style.display = '';
            const summaryCards = document.getElementById('summary-cards');
            if (summaryCards) summaryCards.style.display = '';
        }
    }

    async function loadCustomerBasicData(cId) {
        try {
            await executeTestHook(); // TEST HOOK
            let custData = window.AppCache ? window.AppCache.get(`customer_${cId}`) : null;
            if (!custData) {
                const custDoc = await db.collection('customers').doc(`cust_${cId}`).get();
                if (!custDoc.exists) {
                    alert('顧客が見つかりません');
                    window.location.href = 'customer_list.html';
                    return;
                }
                custData = custDoc.data({ serverTimestamps: 'estimate' });
                if (window.AppCache) window.AppCache.set(`customer_${cId}`, custData);
            }
            
            // Overwrite preview with actual fresh data
            currentCustomer = custData;
            customers = [currentCustomer];
            populateForm(currentCustomer);
            const headerTitle = document.getElementById('header-title');
            if (headerTitle) headerTitle.textContent = `顧客詳細：${currentCustomer.customer_name || ''}`;

            // 顧客名ヘッダーカード更新
            updateCustomerHeaderCard(currentCustomer);
            // 概要タブ更新
            updateOverviewTab(currentCustomer);
            // 組織・連絡タブ: 本店・代表連絡先カード更新
            renderHQInfoCard(currentCustomer);

            // [バッジ即時反映のための追加]
            // 顧客データ（特に登記上所在地ID：registered_office_id）のロード完了後に、
            // 拠点一覧を再描画して「登記上所在地」バッジを即時に反映させます。
            renderOffices(cId);
        } catch(err) {
            console.error('Failed to load customer basic data', err);
        }
    }

    async function loadOffices(cId) {
        await executeTestHook(); // TEST HOOK
        const snap = await db.collection('offices')
            .where('customer_id', '==', cId)
            .orderBy('last_updated', 'desc')
            .limit(20)
            .get();
            
        offices = snap.docs.map(d => ({ ...d.data({ serverTimestamps: 'estimate' }), _docId: d.id }));
        if(snap.docs.length > 0) lastVisibleDoc.offices = snap.docs[snap.docs.length - 1];
        
        renderOffices(cId);
    }

    async function loadContacts(cId) {
        await executeTestHook(); // TEST HOOK
        const snap = await db.collection('contacts')
            .where('customer_id', '==', cId)
            .orderBy('last_updated', 'desc')
            .limit(20)
            .get();
            
        contacts = snap.docs.map(d => d.data({ serverTimestamps: 'estimate' }));
        if(snap.docs.length > 0) lastVisibleDoc.contacts = snap.docs[snap.docs.length - 1];
        
        renderContacts(cId);
    }

    async function loadLicenses(cId) {
        await executeTestHook(); // TEST HOOK
        const snap = await db.collection('customer_licenses')
            .where('customer_id', '==', cId)
            .orderBy('last_updated', 'desc')
            .limit(20)
            .get();
            
        licenses = snap.docs.map(d => ({ ...d.data({ serverTimestamps: 'estimate' }), _docId: d.id }));
        lastVisibleDoc.licenses = snap.docs.length === 20 ? snap.docs[snap.docs.length - 1] : null;
        
        renderLicenses(cId);
    }

    async function loadCases(cId) {
        const queryId = !isNaN(cId) ? Number(cId) : cId;
        await executeTestHook();
        const snap = await db.collection('cases')
            .where('customer_id', '==', queryId)
            .orderBy('last_updated', 'desc')
            .limit(20)
            .get();
        cases = snap.docs.map(d => d.data({ serverTimestamps: 'estimate' }));
        lastVisibleDoc.cases = snap.docs.length === 20 ? snap.docs[snap.docs.length - 1] : null;
        renderRelatedCases(cId);
    }

    // --- Load More Functions ---
    window.loadMoreOffices = async function(cId) {
        if(!lastVisibleDoc.offices) return;
        const btn = document.querySelector('#offices-list-body .btn-load-more');
        if(btn) { btn.innerHTML = '読み込み中...'; btn.disabled = true; }
        try {
            const snap = await db.collection('offices').where('customer_id', '==', cId)
                .orderBy('last_updated', 'desc').startAfter(lastVisibleDoc.offices).limit(20).get();
            if(snap.docs.length > 0) {
                const newDocs = snap.docs.map(d => ({ ...d.data({ serverTimestamps: 'estimate' }), _docId: d.id }));
                offices.push(...newDocs);
                lastVisibleDoc.offices = snap.docs.length === 20 ? snap.docs[snap.docs.length - 1] : null;
                renderOffices(cId);
            } else {
                lastVisibleDoc.offices = null;
                renderOffices(cId);
            }
        } catch(err) { console.error(err); alert('拠点データの追加読み込みに失敗しました'); }
    }

    window.loadMoreContacts = async function(cId) {
        if(!lastVisibleDoc.contacts) return;
        const btn = document.querySelector('#contacts-list-body .btn-load-more');
        if(btn) { btn.innerHTML = '読み込み中...'; btn.disabled = true; }
        try {
            const snap = await db.collection('contacts').where('customer_id', '==', cId)
                .orderBy('last_updated', 'desc').startAfter(lastVisibleDoc.contacts).limit(20).get();
            if(snap.docs.length > 0) {
                const newDocs = snap.docs.map(d => d.data({ serverTimestamps: 'estimate' }));
                contacts.push(...newDocs);
                lastVisibleDoc.contacts = snap.docs.length === 20 ? snap.docs[snap.docs.length - 1] : null;
                renderContacts(cId);
            } else {
                lastVisibleDoc.contacts = null;
                renderContacts(cId);
            }
        } catch(err) { console.error(err); alert('担当者データの追加読み込みに失敗しました'); }
    }

    window.loadMoreLicenses = async function(cId) {
        if(!lastVisibleDoc.licenses) return;
        const btn = document.querySelector('#licenses-list-body .btn-load-more');
        if(btn) { btn.innerHTML = '読み込み中...'; btn.disabled = true; }
        try {
            const snap = await db.collection('customer_licenses').where('customer_id', '==', cId)
                .orderBy('updated_at', 'desc').startAfter(lastVisibleDoc.licenses).limit(20).get();
            if(snap.docs.length > 0) {
                const newDocs = snap.docs.map(d => ({ ...d.data({ serverTimestamps: 'estimate' }), _docId: d.id }));
                licenses.push(...newDocs);
                lastVisibleDoc.licenses = snap.docs.length === 20 ? snap.docs[snap.docs.length - 1] : null;
                renderLicenses(cId);
            } else {
                lastVisibleDoc.licenses = null;
                renderLicenses(cId);
            }
        } catch(err) { console.error(err); alert('許認可データの追加読み込みに失敗しました'); }
    }

    window.loadMoreCases = async function(cId) {
        if(!lastVisibleDoc.cases) return;
        const btn = document.querySelector('#related-cases-body .btn-load-more');
        if(btn) { btn.innerHTML = '読み込み中...'; btn.disabled = true; }
        try {
            const snap = await db.collection('cases').where('customer_id', '==', cId)
                .orderBy('last_updated', 'desc').startAfter(lastVisibleDoc.cases).limit(20).get();
            if(snap.docs.length > 0) {
                const newDocs = snap.docs.map(d => d.data({ serverTimestamps: 'estimate' }));
                cases.push(...newDocs);
                lastVisibleDoc.cases = snap.docs.length === 20 ? snap.docs[snap.docs.length - 1] : null;
                renderRelatedCases(cId);
            } else {
                lastVisibleDoc.cases = null;
                renderRelatedCases(cId);
            }
        } catch(err) { console.error(err); alert('案件データの追加読み込みに失敗しました'); }
    }



    function initAdditionalDropdowns() {
        // 決算期（月）
        const monthSel = document.getElementById('fiscal_year_end_month');
        if (monthSel && monthSel.options.length <= 1) {
            for (let i = 1; i <= 12; i++) {
                const opt = document.createElement('option');
                opt.value = i;
                opt.textContent = `${i}月`;
                monthSel.appendChild(opt);
            }
        }
        // 決算期（日）
        const daySel = document.getElementById('fiscal_year_end_day');
        if (daySel && daySel.options.length <= 1) {
            for (let i = 1; i <= 31; i++) {
                const opt = document.createElement('option');
                opt.value = i;
                opt.textContent = `${i}日`;
                daySel.appendChild(opt);
            }
        }
        // 外務担当者
        const staffSel = document.getElementById('primary_staff_id');
        if (staffSel) {
            const activeStaff = staffMembers
                .filter(s => s.status === '在籍')
                .sort((a, b) => (a.staff_id || 0) - (b.staff_id || 0));
            activeStaff.forEach(s => {
                const opt = document.createElement('option');
                opt.value = s.staff_id;
                opt.textContent = s.staff_name;
                staffSel.appendChild(opt);
            });
        }
    }

    function populateForm(c) {
        document.getElementById('customer_name').value = c.customer_name || '';
        document.getElementById('customer_kana').value = c.customer_kana || '';
        document.getElementById('representative_name').value = c.representative_name || '';
        document.getElementById('customer_type').value = c.customer_type || '法人';
        document.getElementById('postal_code').value = c.postal_code || '';
        document.getElementById('address').value = c.address || '';
        document.getElementById('building_name').value = c.building_name || '';
        document.getElementById('phone').value = c.phone || '';
        document.getElementById('fax').value = c.fax || '';
        document.getElementById('email').value = c.email || '';
        document.getElementById('status').value = c.status || '稼働中';
        document.getElementById('nenga').value = c.nenga || 'なし';
        document.getElementById('chugen').value = c.chugen || 'なし';
        document.getElementById('fax_ok').value = c.fax_ok || '送信OK';
        document.getElementById('remarks').value = c.remarks || '';
        customerIdInput.value = c.customer_id;

        if (c.fiscal_year_end_month) document.getElementById('fiscal_year_end_month').value = c.fiscal_year_end_month;
        if (c.fiscal_year_end_day) document.getElementById('fiscal_year_end_day').value = c.fiscal_year_end_day;
        if (c.corporate_number) document.getElementById('corporate_number').value = c.corporate_number;
        if (c.primary_staff_id) document.getElementById('primary_staff_id').value = c.primary_staff_id;

        if (c.founded_date) document.getElementById('founded_date').value = c.founded_date;
        if (c.capital) {
            document.getElementById('capital').value = c.capital;
            document.getElementById('capital_display').value = c.capital.toLocaleString();
        }
        if (c.employee_count) {
            document.getElementById('employee_count').value = c.employee_count;
            document.getElementById('employee_count_display').value = c.employee_count.toLocaleString();
        }

        if (lastUpdatedDisplay) lastUpdatedDisplay.textContent = formatToJST(c.last_updated);
    }

    function getStatusKey(status) {
        const map = {
            '相談': 'sodan', '受任': 'junin', '作成中': 'sakusei',
            '作成完了': 'ready', '受付（受理）': 'uketuke', '補正': 'hosei',
            '完了': 'kanryo', '取下げ': 'torisage', '返却（県局）': 'henkyoku'
        };
        return map[status] || 'sodan';
    }

    function renderRelatedCases(customerId) {
        if (!relatedCasesBody) return;
        try {
            const related = cases.filter(c => Number(c?.customer_id) === customerId);
            relatedCasesBody.innerHTML = '';

            if (related.length === 0) {
                relatedCasesBody.innerHTML = '<tr><td colspan="6" class="no-data-cell">関連する案件はありません</td></tr>';
                return;
            }

            const sortedRelated = sortCasesCommon(related, currentRelatedSort);


            sortedRelated.forEach(c => {
                if (!c) return; // 安全対策
                const tr = document.createElement('tr');
                const days = calculateRemainingDays(c?.application_scheduled_date);
                const daysClass = getRemainingDaysClass(days, c?.status);
                const fieldStaff = staffMembers.find(s => s.staff_id === Number(c?.field_staff_id))?.staff_name || '-';
                const docStaff = staffMembers.find(s => s.staff_id === Number(c?.document_staff_id))?.staff_name || '-';

                tr.innerHTML = `
                    <td><span class="badge status-${getStatusKey(c?.status)}">${c?.status || '-'}</span></td>
                    <td>${formatDate(c?.contract_date)}</td>
                    <td>
                        <div style="font-weight: 600;">${c?.license_type || '-'}</div>
                        <div style="font-size: 0.8rem; color: var(--text-muted);">${c?.procedure_name || '-'}</div>
                    </td>
                    <td>${formatDate(c?.acceptance_date)}</td>
                    <td>
                        <span class="days-badge ${daysClass}">${formatRemainingDays(days, c?.status)}</span>
                    </td>
                    <td>
                        <div>${fieldStaff}</div>
                        <div style="font-size: 0.8rem; color: var(--text-muted);">${docStaff}</div>
                    </td>
                `;
                tr.style.cursor = 'pointer';
                tr.addEventListener('click', () => {
                    if (c?.case_id) window.location.href = `detail.html?id=${c.case_id}`;
                });
                relatedCasesBody.appendChild(tr);
            });

            if (lastVisibleDoc.cases && related.length >= 20) {
                const tr = document.createElement('tr');
                tr.innerHTML = `<td colspan="6" style="text-align:center; padding:16px; background: transparent; border-bottom: none;"><button type="button" class="btn btn-load-more" onclick="window.loadMoreCases(${customerId})">もっと見る <i data-lucide="chevron-down"></i></button></td>`;
                relatedCasesBody.appendChild(tr);
                if (window.lucide) lucide.createIcons();
            }
        } catch (error) {
            console.error('Error rendering related cases:', error);
            relatedCasesBody.innerHTML = '<tr><td colspan="6" class="no-data-cell" style="color: red;">データの表示中にエラーが発生しました</td></tr>';
        }
    }

    /* ===============================
       組織・連絡タブ — フィルタ状態
    =============================== */
    let contactFilterOfficeId = null; // 拠点フィルタ用

    /* --- 拠点状態Badge ヘルパー --- */
    function getOfficeStatusBadge(status) {
        const s = status || '稼働中';
        const map = {
            '稼働中': { cls: 'badge-status-active', label: '稼働中' },
            'active': { cls: 'badge-status-active', label: '稼働中' },
            '有効': { cls: 'badge-status-active', label: '稼働中' },
            '休止': { cls: 'badge-status-suspended', label: '休止' },
            '注意': { cls: 'badge-status-suspended', label: '注意' },
            '閉鎖': { cls: 'badge-status-closed', label: '閉鎖' },
            'inactive': { cls: 'badge-status-closed', label: '閉鎖' },
            '無効': { cls: 'badge-status-closed', label: '閉鎖' },
            '仮登録': { cls: 'badge-status-provisional', label: '仮登録' },
        };
        const m = map[s] || { cls: 'badge-status-provisional', label: s || '―' };
        return `<span class="badge-status ${m.cls}">${m.label}</span>`;
    }

    /* --- 担当者状態Badge ヘルパー --- */
    function getContactStatusBadge(contact) {
        if (contact.is_primary) return `<span class="badge-status badge-status-primary">主担当</span>`;
        const map = {
            '在籍': { cls: 'badge-status-active', label: '在籍' },
            'active': { cls: 'badge-status-active', label: '在籍' },
            '有効': { cls: 'badge-status-active', label: '在籍' },
            '退職予定': { cls: 'badge-status-retiring', label: '退職予定' },
            '退職': { cls: 'badge-status-retired', label: '退職' },
            'inactive': { cls: 'badge-status-retired', label: '退職' },
            '無効': { cls: 'badge-status-retired', label: '退職' },
        };
        const s = contact.status || '在籍';
        const m = map[s] || { cls: 'badge-status-provisional', label: s };
        return `<span class="badge-status ${m.cls}">${m.label}</span>`;
    }

    /* --- 役割Badge ヘルパー --- */
    function getRoleBadge(role) {
        if (!role || role === '') return '';
        const map = {
            '許認可窓口': 'badge-role-license',
            '請求担当': 'badge-role-billing',
            '経理担当': 'badge-role-accounting',
            '営業窓口': 'badge-role-sales',
            '代表窓口': 'badge-role-representative',
            'その他': 'badge-role-other',
        };
        const cls = map[role] || 'badge-role-other';
        return `<span class="badge-role ${cls}">${role}</span>`;
    }

    /* --- 拠点区分 ヘルパー --- */
    function getOfficeTypeLabel(o) {
        const type = o.office_type || (o.is_main ? '本社' : '営業所');
        return type;
    }

    /* ===============================
       本店・代表連絡先カード 描画
    =============================== */
    function renderHQInfoCard(data) {
        if (!data) return;
        const setText = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val || '―'; };
        setText('hq-zip-display', data.postal_code);
        setText('hq-address-display', data.address);
        setText('hq-building-display', data.building_name);
        setText('hq-phone-display', data.phone);
        setText('hq-fax-display', data.fax);
        setText('hq-email-display', data.email);

        // 登記上所在地バッジ — registered_office_id が null の場合は本店が登記上所在地
        const badgeArea = document.getElementById('hq-registry-badge-area');
        if (badgeArea) {
            if (!data.registered_office_id) {
                badgeArea.innerHTML = '<span class="badge-registry">🏢 登記上所在地</span>';
            } else {
                badgeArea.innerHTML = '';
            }
        }
    }

    function setupHQCardEvents() {
        const hqCard = document.getElementById('hq-card');
        const btnEdit = document.getElementById('btn-hq-edit');
        const btnCancel = document.getElementById('btn-hq-cancel');
        const btnDone = document.getElementById('btn-hq-done');
        const btnCopy = document.getElementById('btn-copy-address');
        const btnMap = document.getElementById('btn-open-map');

        if (btnEdit) {
            btnEdit.addEventListener('click', () => {
                if (hqCard) hqCard.classList.add('editing');
                btnEdit.textContent = '✎ 編集中...';
                btnEdit.disabled = true;
            });
        }
        if (btnCancel) {
            btnCancel.addEventListener('click', () => {
                if (hqCard) hqCard.classList.remove('editing');
                if (btnEdit) { btnEdit.textContent = '✎ 編集'; btnEdit.disabled = false; }
                // 元の値に戻す
                if (currentCustomer) populateForm(currentCustomer);
                renderHQInfoCard(currentCustomer);
            });
        }
        if (btnDone) {
            btnDone.addEventListener('click', () => {
                if (hqCard) hqCard.classList.remove('editing');
                if (btnEdit) { btnEdit.textContent = '✎ 編集'; btnEdit.disabled = false; }
                // 閲覧カードを更新（input値を反映）
                const getVal = (id) => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };
                const viewData = {
                    postal_code: getVal('postal_code'),
                    address: getVal('address'),
                    building_name: getVal('building_name'),
                    phone: getVal('phone'),
                    fax: getVal('fax'),
                    email: getVal('email'),
                    registered_office_id: currentCustomer ? currentCustomer.registered_office_id : null
                };
                renderHQInfoCard(viewData);
            });
        }
        if (btnCopy) {
            btnCopy.addEventListener('click', (e) => {
                e.stopPropagation();
                const addr = (document.getElementById('hq-address-display')?.textContent || '') +
                    ' ' + (document.getElementById('hq-building-display')?.textContent || '');
                const fullAddr = `〒${document.getElementById('hq-zip-display')?.textContent || ''} ${addr}`.trim();
                navigator.clipboard.writeText(fullAddr).then(() => {
                    showToast('住所をコピーしました', 'success');
                }).catch(() => {
                    showToast('コピーに失敗しました', 'error');
                });
            });
        }
        if (btnMap) {
            btnMap.addEventListener('click', (e) => {
                e.stopPropagation();
                const addr = (document.getElementById('hq-address-display')?.textContent || '') +
                    ' ' + (document.getElementById('hq-building-display')?.textContent || '');
                if (addr.trim() && addr.trim() !== '―') {
                    window.open(`https://www.google.com/maps/search/${encodeURIComponent(addr.trim())}`, '_blank');
                } else {
                    showToast('住所が設定されていません', 'error');
                }
            });
        }

        // 郵便番号検索
        const btnLookupZip = document.getElementById('btn-lookup-zip');
        if (btnLookupZip) {
            btnLookupZip.addEventListener('click', async () => {
                const zip = document.getElementById('postal_code').value.replace(/[^0-9]/g, '');
                if (!/^\d{7}$/.test(zip)) {
                    alert('郵便番号は7桁で入力してください。');
                    return;
                }
                try {
                    const response = await fetch(`https://zipcloud.ibsnet.co.jp/api/search?zipcode=${zip}`);
                    const data = await response.json();
                    if (data.status === 200 && data.results) {
                        const result = data.results[0];
                        const address = result.address1 + result.address2 + result.address3;
                        document.getElementById('address').value = address;
                    } else {
                        alert('該当する住所が見つかりませんでした。');
                    }
                } catch (error) {
                    console.error('ZipCloud API Error:', error);
                    alert('住所の取得に失敗しました。');
                }
            });
        }
    }

    /* ===============================
       拠点一覧 描画（リファクタリング済）
    =============================== */
    function renderOffices(customerId) {
        if (!officesListBody) return;
        const related = offices.filter(o => Number(o.customer_id) === customerId);
        officesListBody.innerHTML = '';

        // 件数表示
        const countEl = document.getElementById('offices-count');
        if (countEl) countEl.textContent = `（${related.length}件）`;

        if (related.length === 0) {
            officesListBody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:#999; font-style:italic; padding:20px;">拠点データがありません</td></tr>';
            return;
        }

        // 登記上所在地の office_id を取得
        const registeredOfficeId = currentCustomer ? currentCustomer.registered_office_id : null;

        related.forEach(o => {
            const tr = document.createElement('tr');
            const primaryContact = contacts.find(c => c.office_id === o.office_id && Number(c.customer_id) === customerId && c.is_primary);
            const primaryName = primaryContact ? (primaryContact.contact_name || '名称未設定') : '<span style="color:#aaa;">-</span>';
            
            const isRegistered = (registeredOfficeId && registeredOfficeId === o.office_id);
            const registryBadge = isRegistered ? ' <span class="badge-registry">🏢 登記上所在地</span>' : '';

            // フィルタ中の行をハイライト
            if (contactFilterOfficeId === o.office_id) {
                tr.classList.add('active-filter');
            }

            tr.innerHTML = `
                <td class="cell-name">${o.office_name || '-'}${registryBadge}</td>
                <td>${o.address || '-'}</td>
                <td>${o.phone || '-'}</td>
                <td>${primaryName}</td>
                <td>${getOfficeStatusBadge(o.status)}</td>
                <td class="cell-ops">
                    <button type="button" class="btn-row-edit" data-office-id="${o.office_id}" title="編集">✎</button>
                </td>
            `;

            // 行クリック → 担当者フィルタ
            tr.addEventListener('click', (e) => {
                if (e.target.closest('.btn-row-edit')) return; // 編集ボタンは別処理
                if (contactFilterOfficeId === o.office_id) {
                    // 同じ拠点を再クリック → フィルタ解除
                    contactFilterOfficeId = null;
                } else {
                    contactFilterOfficeId = o.office_id;
                }
                renderOffices(customerId); // ハイライト更新
                renderContacts(customerId); // フィルタ適用
            });

            officesListBody.appendChild(tr);
        });

        // 編集ボタンのイベント
        officesListBody.querySelectorAll('.btn-row-edit').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const oId = btn.dataset.officeId;
                window.location.href = `office_detail.html?customer_id=${customerId}&id=${oId}`;
            });
        });

        // 拠点追加ボタンのイベント
        const btnAddOffice = document.getElementById('btn-add-office');
        if (btnAddOffice && !btnAddOffice.dataset.bound) {
            btnAddOffice.dataset.bound = 'true';
            btnAddOffice.addEventListener('click', () => {
                const cid = new URLSearchParams(window.location.search).get('id');
                if (cid && cid !== 'new') {
                    location.href = `office_detail.html?v=${Date.now()}&customer_id=${cid}&id=new`;
                } else {
                    alert('先に顧客情報を保存してください');
                }
            });
        }

        if (lastVisibleDoc.offices && related.length >= 20) {
            const tr = document.createElement('tr');
            tr.innerHTML = `<td colspan="6" style="text-align:center; padding:16px; background: transparent; border-bottom: none;"><button type="button" class="btn btn-load-more" onclick="window.loadMoreOffices(${customerId})">もっと見る</button></td>`;
            officesListBody.appendChild(tr);
        }
    }

    /* ===============================
       担当者一覧 描画（リファクタリング済）
    =============================== */
    function renderContacts(customerId) {
        if (!contactsListBody) return;
        let related = contacts.filter(c => Number(c.customer_id) === customerId);

        // フィルタタグ描画
        const filterBar = document.getElementById('contact-filter-bar');
        if (filterBar) {
            if (contactFilterOfficeId !== null) {
                const filterOffice = offices.find(o => o.office_id === contactFilterOfficeId);
                const filterName = filterOffice ? filterOffice.office_name : `拠点ID: ${contactFilterOfficeId}`;
                filterBar.innerHTML = `<span class="filter-tag">${filterName} <span class="filter-tag-close" id="btn-clear-filter">&times;</span></span>`;
                // ×クリックでフィルタ解除
                const clearBtn = document.getElementById('btn-clear-filter');
                if (clearBtn) {
                    clearBtn.addEventListener('click', () => {
                        contactFilterOfficeId = null;
                        renderOffices(customerId);
                        renderContacts(customerId);
                    });
                }
                // フィルタ適用
                related = related.filter(c => c.office_id === contactFilterOfficeId);
            } else {
                filterBar.innerHTML = '';
            }
        }

        // 件数表示
        const countEl = document.getElementById('contacts-count');
        const totalCount = contacts.filter(c => Number(c.customer_id) === customerId).length;
        if (countEl) {
            if (contactFilterOfficeId !== null) {
                countEl.textContent = `（${related.length}/${totalCount}件）`;
            } else {
                countEl.textContent = `（${totalCount}件）`;
            }
        }

        contactsListBody.innerHTML = '';

        if (related.length === 0) {
            const msg = contactFilterOfficeId !== null ? 'この拠点に所属する担当者はいません' : '担当者データがありません';
            contactsListBody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:#999; font-style:italic; padding:20px;">${msg}</td></tr>`;
            return;
        }

        related.forEach(c => {
            const officeName = offices.find(o => o.office_id === c.office_id && Number(o.customer_id) === customerId)?.office_name || '-';
            const tr = document.createElement('tr');

            // 連絡先統合表示（電話 + メール をシンプルな2段構成に）
            let contactCell = '<div style="padding: 6px 0; line-height: 1.5; font-size: 11pt;">';
            if (c.phone) {
                contactCell += `<div style="color: var(--text-main);">${c.phone}</div>`;
            } else if (c.mobile) {
                contactCell += `<div style="color: var(--text-main);">${c.mobile} (携)</div>`;
            }
            
            if (c.email) {
                contactCell += `<div><a href="mailto:${c.email}" style="color: #2563eb; text-decoration: none;">${c.email}</a></div>`;
            } else if (!c.phone && !c.mobile) {
                contactCell += '<span style="color:#999;">―</span>';
            }
            contactCell += '</div>';

            tr.innerHTML = `
                <td class="cell-name">${c.contact_name || '-'}</td>
                <td>${officeName}</td>
                <td>${contactCell}</td>
                <td>${getContactStatusBadge(c)}</td>
                <td class="cell-ops">
                    <button type="button" class="btn-row-edit" data-contact-id="${c.contact_id}" title="編集">✎</button>
                </td>
            `;

            contactsListBody.appendChild(tr);
        });

        // 編集ボタンのイベント
        contactsListBody.querySelectorAll('.btn-row-edit').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const cId = btn.dataset.contactId;
                window.location.href = `contact_detail.html?customer_id=${customerId}&id=${cId}`;
            });
        });

        // 担当者追加ボタンのイベント
        const btnAddContact = document.getElementById('btn-add-contact');
        if (btnAddContact && !btnAddContact.dataset.bound) {
            btnAddContact.dataset.bound = 'true';
            btnAddContact.addEventListener('click', () => {
                const cid = new URLSearchParams(window.location.search).get('id');
                if (cid && cid !== 'new') {
                    location.href = `contact_detail.html?customer_id=${cid}&id=new`;
                } else {
                    alert('先に顧客情報を保存してください');
                }
            });
        }

        if (lastVisibleDoc.contacts && related.length >= 20) {
            const tr = document.createElement('tr');
            tr.innerHTML = `<td colspan="6" style="text-align:center; padding:16px; background: transparent; border-bottom: none;"><button type="button" class="btn btn-load-more" onclick="window.loadMoreContacts(${customerId})">もっと見る</button></td>`;
            contactsListBody.appendChild(tr);
            if (window.lucide) lucide.createIcons();
        }
    }

    function renderLicenses(customerId) {
        if (!licensesListBody) return;
        const related = licenses.filter(l => Number(l.customer_id) === customerId);
        licensesListBody.innerHTML = '';

        if (related.length === 0) {
            licensesListBody.innerHTML = '<tr><td colspan="5" class="no-data-cell">許認可データがありません</td></tr>';
            return;
        }

        related.forEach(l => {
            const type = licenseTypes.find(lt => lt.license_type_id === l.license_type_id);
            const typeName = type ? type.license_type_name : (l.license_type || '-');
            const licenseNum = typeof formatLicenseNumber === 'function' ? formatLicenseNumber(l) : (l.license_number || '-');

            // 残り日数（期限まで）
            const days = calculateRemainingDays(l.expiry_date);
            const daysClass = getRemainingDaysClass(days);

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td style="font-weight: 600;">${typeName}</td>
                <td>${licenseNum}</td>
                <td>${formatDate(l.expiry_date)}</td>
                <td><span class="days-badge ${daysClass}">${formatRemainingDays(days)}</span></td>
                <td><span class="badge ${l.status === '有効' ? 'status-junin' : 'status-torisage'}">${l.status || '-'}</span></td>
            `;
            tr.style.cursor = 'pointer';
            tr.addEventListener('click', () => {
                window.location.href = `license_detail.html?docId=${l._docId}&customer_id=${customerId}&id=${l.license_id}`;
            });
            licensesListBody.appendChild(tr);
        });

        if (lastVisibleDoc.licenses && related.length >= 20) {
            const tr = document.createElement('tr');
            tr.innerHTML = `<td colspan="5" style="text-align:center; padding:16px; background: transparent; border-bottom: none;"><button type="button" class="btn btn-load-more" onclick="window.loadMoreLicenses(${customerId})">もっと見る <i data-lucide="chevron-down"></i></button></td>`;
            licensesListBody.appendChild(tr);
            if (window.lucide) lucide.createIcons();
        }
    }

    // --- Format Input Helpers ---
    function setupNumericInput(displayId, hiddenId) {
        const displayEl = document.getElementById(displayId);
        const hiddenEl = document.getElementById(hiddenId);
        if (!displayEl || !hiddenEl) return;

        displayEl.addEventListener('blur', function() {
            let val = this.value.replace(/,/g, '');
            if (!isNaN(val) && val !== '') {
                hiddenEl.value = val;
                this.value = parseInt(val, 10).toLocaleString();
            } else {
                hiddenEl.value = '';
                this.value = '';
            }
        });

        displayEl.addEventListener('focus', function() {
            if (hiddenEl.value) {
                this.value = hiddenEl.value;
            }
        });
    }

    setupNumericInput('capital_display', 'capital');
    setupNumericInput('employee_count_display', 'employee_count');

    async function handleSave(e) {
        if (e) e.preventDefault();

        let newId;
        const cIdInput = document.getElementById('customer_id');
        if (customerIdParam === 'new') {
            if (cIdInput && !isNaN(parseInt(cIdInput.value))) {
                newId = parseInt(cIdInput.value);
            } else {
                newId = await getNextSequence('customers');
                if (cIdInput) cIdInput.value = newId;
            }
        } else {
            if (cIdInput) {
                newId = parseInt(cIdInput.value);
            } else {
                newId = parseInt(customerIdParam);
            }
        }

        if (isNaN(newId)) { alert('有効なIDを取得できませんでした'); return; }

        // Helper to safely get values
        const getVal = (id) => {
            const el = document.getElementById(id);
            return el ? el.value.trim() : '';
        };
        const getNum = (id) => {
            const el = document.getElementById(id);
            return el ? (parseInt(el.value) || null) : null;
        };

        const corporateNumber = getVal('corporate_number');
        if (corporateNumber && !/^\d{13}$/.test(corporateNumber)) {
            alert('法人番号は13桁の半角数字で入力してください。');
            return;
        }

        const now = new Date().toISOString();
        const updatedCustomer = {
            customer_id: newId,
            customer_name: getVal('customer_name'),
            customer_kana: getVal('customer_kana'),
            customer_type: getVal('customer_type'),
            representative_name: getVal('representative_name'),
            postal_code: getVal('postal_code'),
            address: getVal('address'),
            building_name: getVal('building_name'),
            phone: getVal('phone'),
            fax: getVal('fax'),
            email: getVal('email'),
            status: getVal('status'),
            nenga: getVal('nenga'),
            chugen: getVal('chugen'),
            fax_ok: getVal('fax_ok'),
            remarks: getVal('remarks'),
            fiscal_year_end_month: getNum('fiscal_year_end_month'),
            fiscal_year_end_day: getNum('fiscal_year_end_day'),
            founded_date: getVal('founded_date'),
            capital: getNum('capital'),
            employee_count: getNum('employee_count'),
            corporate_number: corporateNumber,
            primary_staff_id: getNum('primary_staff_id'),
            last_updated: now
        };

        try {
            // Debug: 保存直前のデータを表示
            // const debugMsg = `保存データの確認:\nID: ${newId}\n名前: ${updatedCustomer.customer_name}\nDocID: cust_${newId}`;
            // if (!confirm(debugMsg + '\n\nこの内容で保存しますか？')) return;

            if (customerIdParam === 'new') {
                updatedCustomer.created_date = now;
                await saveToFirestore('customers', `cust_${newId}`, updatedCustomer);
                
                // Switch SPA state instead of reloading
                history.replaceState(null, '', `?id=${newId}`);
                customerIdParam = String(newId);
                currentCustomer = updatedCustomer;
                document.getElementById('page-title').textContent = '顧客詳細';
                
                // Initialize existing mode UI
                updateScreenMode('existing');
                // Fetch basic data (again) and other sections
                await refreshCustomerUI(newId);
            } else {
                await saveToFirestore('customers', `cust_${newId}`, { ...currentCustomer, ...updatedCustomer });
                currentCustomer = { ...currentCustomer, ...updatedCustomer };
                // キャッシュ無効化 → 最新データで概要タブ等を再描画
                if (window.AppCache) window.AppCache.invalidate(`customer_${newId}`);
                // Fetch latest data to refresh UI
                await refreshCustomerUI(newId);
            }
            showToast('保存しました', 'success');

            // if (typeof isDirty !== 'undefined') isDirty = false;
        } catch (err) {
            console.error(err);
            alert('保存失敗: ' + err.message);
        }
    }

    async function handleDelete() {
        if (!isUserAdmin()) {
            alert('削除権限がありません。');
            return;
        }
        if (customerIdParam === 'new') return;
        if (confirm('本当に削除しますか？')) {
            try {
                const cId = parseInt(customerIdParam);
                await deleteFromFirestore('customers', `cust_${cId}`);
                showToast('削除しました', 'success');
                setTimeout(() => window.location.href = 'customer_list.html', 1000);
            } catch (err) { alert('削除失敗'); }
        }
    }

    // --- Export Utility ---
    // HTMLタグを除去してプレーンテキストを返す（Excel/PDF出力用）
    function plainText(val) {
        if (val === undefined || val === null || val === '') return '';
        if (typeof val === 'string' && val.includes('<')) {
            return val.replace(/<[^>]*>/g, '').trim() || '';
        }
        return val;
    }
    // 日付をプレーンテキストで返す（HTML不可のExcel/PDF用）
    function plainDate(dateStr) {
        if (!dateStr || dateStr === 'null') return '';
        if (dateStr && typeof dateStr.toDate === 'function') {
            const d = dateStr.toDate();
            return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
        }
        if (typeof dateStr === 'string') return dateStr.replace(/-/g, '/');
        return '';
    }
    // 許可番号をプレーンテキストで返す
    function plainLicenseNumber(license) {
        if (!license) return '';
        const n1 = license.license_number_1 || '';
        const n2 = license.license_number_2 || '';
        if (!n1 && !n2) return '';
        return `${n1}${n2 ? '-' + n2 : ''}`;
    }

    // --- Export Functions ---
    function buildPrintHTML(data) {
        const staff = staffMembers.find(s => s.staff_id === data.primary_staff_id);
        const staffName = staff ? staff.staff_name : '-';
        const now = new Date().toLocaleString('ja-JP');

        // --- デザイン定数（Excel と統一） ---
        const NAVY = '#1B2A4A';
        const SUB_HEADER = '#3D5A80';
        const LABEL_BG = '#E8ECF0';
        const LIGHT_BG = '#F0F4F8';
        const BORDER = '#B0B8C4';

        const sectionHeader = (title) => `
            <tr><td colspan="6" style="background:${NAVY};color:#fff;font-weight:bold;font-size:13px;padding:6px 10px;border:1px solid ${BORDER};">${title}</td></tr>`;

        const kvRow = (pairs, isAlt) => {
            let html = '<tr>';
            for (let i = 0; i < 6; i += 2) {
                const label = pairs[i] || '';
                const value = pairs[i + 1] || '';
                html += `<td style="background:${LABEL_BG};font-weight:bold;padding:4px 8px;border:1px solid ${BORDER};font-size:11px;width:15%;">${label}</td>`;
                html += `<td style="${isAlt ? 'background:' + LIGHT_BG + ';' : ''}padding:4px 8px;border:1px solid ${BORDER};font-size:11px;width:18%;">${value}</td>`;
            }
            html += '</tr>';
            return html;
        };

        const tableHeader = (headers) => {
            let html = '<tr>';
            headers.forEach(h => {
                html += `<td style="background:${SUB_HEADER};color:#fff;font-weight:bold;text-align:center;padding:4px 8px;border:1px solid ${BORDER};font-size:11px;">${h}</td>`;
            });
            html += '</tr>';
            return html;
        };

        const tableRow = (values, colCount, isAlt) => {
            let html = '<tr>';
            values.forEach(v => {
                html += `<td style="${isAlt ? 'background:' + LIGHT_BG + ';' : ''}padding:4px 8px;border:1px solid ${BORDER};font-size:11px;">${v || '-'}</td>`;
            });
            html += '</tr>';
            return html;
        };

        const emptyRow = (colCount) => `<tr><td colspan="${colCount}" style="text-align:center;color:#999;font-style:italic;padding:4px 8px;border:1px solid ${BORDER};font-size:11px;">なし</td></tr>`;

        // --- 各セクション生成 ---
        // ■ 基本情報
        let basicInfo = sectionHeader('■ 基本情報');
        basicInfo += kvRow(['顧客名', data.customer_name || '-', 'フリガナ', data.customer_kana || '-', '顧客区分', data.customer_type || '-'], false);
        basicInfo += kvRow(['代表者名', data.representative_name || '-', '外務担当', staffName, '状態', data.status || '-'], false);
        basicInfo += kvRow(['法人番号', data.corporate_number || '-', '決算期', `${data.fiscal_year_end_month || '-'}月 ${data.fiscal_year_end_day || '-'}日`, '', ''], false);

        // ■ 連絡先・住所
        let contactInfo = sectionHeader('■ 連絡先・住所');
        // 住所行: D:F結合（住所値を広く表示）
        contactInfo += `<tr>
            <td style="background:${LABEL_BG};font-weight:bold;padding:4px 8px;border:1px solid ${BORDER};font-size:11px;width:15%;">〒</td>
            <td style="padding:4px 8px;border:1px solid ${BORDER};font-size:11px;width:18%;">${data.postal_code || '-'}</td>
            <td style="background:${LABEL_BG};font-weight:bold;padding:4px 8px;border:1px solid ${BORDER};font-size:11px;width:15%;">住所</td>
            <td colspan="3" style="padding:4px 8px;border:1px solid ${BORDER};font-size:11px;">${(data.address || '') + (data.building_name ? ' ' + data.building_name : '') || '-'}</td>
        </tr>`;
        contactInfo += kvRow(['電話番号', data.phone || '-', 'FAX', data.fax || '-', 'メール', data.email || '-'], false);
        contactInfo += kvRow(['年賀状', data.nenga || '-', '中元', data.chugen || '-', 'FAX可否', data.fax_ok || '-'], false);
        // 備考行: B:F結合（備考値を広く表示）
        contactInfo += `<tr>
            <td style="background:${LABEL_BG};font-weight:bold;padding:4px 8px;border:1px solid ${BORDER};font-size:11px;width:15%;">備考</td>
            <td colspan="5" style="padding:4px 8px;border:1px solid ${BORDER};font-size:11px;">${data.remarks || '-'}</td>
        </tr>`;

        // ■ 拠点一覧
        const relatedOffices = offices.filter(o => Number(o.customer_id) === data.customer_id);
        let officeSection = sectionHeader('■ 拠点一覧');
        officeSection += '<tr>' + ['拠点名', '住所', '電話番号'].map(h => `<td colspan="2" style="background:${SUB_HEADER};color:#fff;font-weight:bold;text-align:center;padding:4px 8px;border:1px solid ${BORDER};font-size:11px;">${h}</td>`).join('') + '</tr>';
        if (relatedOffices.length === 0) {
            officeSection += `<tr><td colspan="6" style="text-align:center;color:#999;font-style:italic;padding:4px 8px;border:1px solid ${BORDER};font-size:11px;">なし</td></tr>`;
        } else {
            relatedOffices.forEach((o, idx) => {
                const bg = idx % 2 === 1 ? `background:${LIGHT_BG};` : '';
                officeSection += `<tr><td colspan="2" style="${bg}padding:4px 8px;border:1px solid ${BORDER};font-size:11px;">${o.office_name || '-'}</td><td colspan="2" style="${bg}padding:4px 8px;border:1px solid ${BORDER};font-size:11px;">${o.address || '-'}</td><td colspan="2" style="${bg}padding:4px 8px;border:1px solid ${BORDER};font-size:11px;">${o.phone || '-'}</td></tr>`;
            });
        }

        // ■ 有効な許認可
        const relatedLicenses = licenses.filter(l => l.customer_id === data.customer_id && l.status === '有効');
        let licenseSection = sectionHeader('■ 有効な許認可');
        licenseSection += '<tr>' + ['許認可種別', '許可番号', '有効期限'].map(h => `<td colspan="2" style="background:${SUB_HEADER};color:#fff;font-weight:bold;text-align:center;padding:4px 8px;border:1px solid ${BORDER};font-size:11px;">${h}</td>`).join('') + '</tr>';
        if (relatedLicenses.length === 0) {
            licenseSection += `<tr><td colspan="6" style="text-align:center;color:#999;font-style:italic;padding:4px 8px;border:1px solid ${BORDER};font-size:11px;">なし</td></tr>`;
        } else {
            relatedLicenses.forEach((l, idx) => {
                const type = licenseTypes.find(lt => lt.license_type_id === l.license_type_id);
                const bg = idx % 2 === 1 ? `background:${LIGHT_BG};` : '';
                licenseSection += `<tr><td colspan="2" style="${bg}padding:4px 8px;border:1px solid ${BORDER};font-size:11px;">${type ? type.license_type_name : '-'}</td><td colspan="2" style="${bg}padding:4px 8px;border:1px solid ${BORDER};font-size:11px;">${plainLicenseNumber(l) || '-'}</td><td colspan="2" style="${bg}padding:4px 8px;border:1px solid ${BORDER};font-size:11px;">${plainDate(l.expiry_date) || '-'}</td></tr>`;
            });
        }

        // ■ 担当者一覧
        const relatedContacts = contacts.filter(c => Number(c.customer_id) === data.customer_id);
        let contactSection = sectionHeader('■ 担当者一覧');
        contactSection += '<tr><td style="background:' + SUB_HEADER + ';color:#fff;font-weight:bold;text-align:center;padding:4px 8px;border:1px solid ' + BORDER + ';font-size:11px;">氏名</td><td colspan="2" style="background:' + SUB_HEADER + ';color:#fff;font-weight:bold;text-align:center;padding:4px 8px;border:1px solid ' + BORDER + ';font-size:11px;">所属拠点</td><td style="background:' + SUB_HEADER + ';color:#fff;font-weight:bold;text-align:center;padding:4px 8px;border:1px solid ' + BORDER + ';font-size:11px;">役職</td><td colspan="2" style="background:' + SUB_HEADER + ';color:#fff;font-weight:bold;text-align:center;padding:4px 8px;border:1px solid ' + BORDER + ';font-size:11px;">電話番号</td></tr>';
        if (relatedContacts.length === 0) {
            contactSection += `<tr><td colspan="6" style="text-align:center;color:#999;font-style:italic;padding:4px 8px;border:1px solid ${BORDER};font-size:11px;">なし</td></tr>`;
        } else {
            relatedContacts.forEach((c, idx) => {
                const officeName = offices.find(o => o.office_id === c.office_id && Number(o.customer_id) === data.customer_id)?.office_name || '-';
                const bg = idx % 2 === 1 ? `background:${LIGHT_BG};` : '';
                contactSection += `<tr><td style="${bg}padding:4px 8px;border:1px solid ${BORDER};font-size:11px;">${c.contact_name || '-'}</td><td colspan="2" style="${bg}padding:4px 8px;border:1px solid ${BORDER};font-size:11px;">${officeName}</td><td style="${bg}padding:4px 8px;border:1px solid ${BORDER};font-size:11px;">${c.title || '-'}</td><td colspan="2" style="${bg}padding:4px 8px;border:1px solid ${BORDER};font-size:11px;">${c.phone || '-'}</td></tr>`;
            });
        }

        // ■ 関連案件
        const relatedCases = cases.filter(c => c.customer_id === data.customer_id);
        let caseSection = sectionHeader('■ 関連案件');
        caseSection += '<tr><td style="background:' + SUB_HEADER + ';color:#fff;font-weight:bold;text-align:center;padding:4px 8px;border:1px solid ' + BORDER + ';font-size:11px;">ステータス</td><td colspan="2" style="background:' + SUB_HEADER + ';color:#fff;font-weight:bold;text-align:center;padding:4px 8px;border:1px solid ' + BORDER + ';font-size:11px;">業務内容</td><td style="background:' + SUB_HEADER + ';color:#fff;font-weight:bold;text-align:center;padding:4px 8px;border:1px solid ' + BORDER + ';font-size:11px;">受任日</td><td colspan="2" style="background:' + SUB_HEADER + ';color:#fff;font-weight:bold;text-align:center;padding:4px 8px;border:1px solid ' + BORDER + ';font-size:11px;">完了日</td></tr>';
        if (relatedCases.length === 0) {
            caseSection += `<tr><td colspan="6" style="text-align:center;color:#999;font-style:italic;padding:4px 8px;border:1px solid ${BORDER};font-size:11px;">なし</td></tr>`;
        } else {
            relatedCases.forEach((c, idx) => {
                const bg = idx % 2 === 1 ? `background:${LIGHT_BG};` : '';
                caseSection += `<tr><td style="${bg}padding:4px 8px;border:1px solid ${BORDER};font-size:11px;">${c.status || '-'}</td><td colspan="2" style="${bg}padding:4px 8px;border:1px solid ${BORDER};font-size:11px;">${c.license_type || '-'}</td><td style="${bg}padding:4px 8px;border:1px solid ${BORDER};font-size:11px;">${plainDate(c.contract_date) || '-'}</td><td colspan="2" style="${bg}padding:4px 8px;border:1px solid ${BORDER};font-size:11px;">${plainDate(c.completion_date) || '-'}</td></tr>`;
            });
        }

        // --- 全体HTML ---
        return `
        <div style="padding:30px;font-family:'BIZ UDPGothic','Hiragino Kaku Gothic ProN',sans-serif;color:#333;line-height:1.4;background:#fff;">
            <div style="margin-bottom:12px;">
                <div style="font-size:22px;font-weight:bold;color:${NAVY};margin-bottom:4px;">顧客詳細：${data.customer_name || ''}</div>
                <div style="display:flex;justify-content:space-between;font-size:10px;color:#666;">
                    <span>顧客ID: ${data.customer_id}</span>
                    <span>出力日: ${new Date().toLocaleDateString('ja-JP')}</span>
                </div>
            </div>
            <table style="width:100%;border-collapse:collapse;margin-bottom:8px;">${basicInfo}</table>
            <div style="height:6px;"></div>
            <table style="width:100%;border-collapse:collapse;margin-bottom:8px;">${contactInfo}</table>
            <div style="height:6px;"></div>
            <table style="width:100%;border-collapse:collapse;margin-bottom:8px;">${officeSection}</table>
            <div style="height:6px;"></div>
            <table style="width:100%;border-collapse:collapse;margin-bottom:8px;">${licenseSection}</table>
            <div style="height:6px;"></div>
            <table style="width:100%;border-collapse:collapse;margin-bottom:8px;">${contactSection}</table>
            <div style="height:6px;"></div>
            <table style="width:100%;border-collapse:collapse;margin-bottom:8px;">${caseSection}</table>
            <div style="margin-top:24px;text-align:center;font-size:9px;color:#999;border-top:1px dashed #ccc;padding-top:8px;">LAPIS3 案件管理システム - 顧客詳細出力</div>
        </div>`;
    }

    if (btnExportPdf) {
        btnExportPdf.addEventListener('click', () => {
            if (!currentCustomer) return;
            const element = document.getElementById('print-template');
            element.innerHTML = buildPrintHTML(currentCustomer);
            element.style.display = 'block';
            html2pdf(element, {
                margin: 8,
                filename: `顧客詳細_${currentCustomer.customer_name}_${new Date().toISOString().split('T')[0]}.pdf`,
                image: { type: 'jpeg', quality: 0.98 },
                html2canvas: { scale: 2 },
                jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
            }).then(() => {
                element.style.display = 'none';
            });
        });
    }

    if (btnExportExcel) {
        btnExportExcel.addEventListener('click', async () => {
            if (!currentCustomer) return;
            try {
                btnExportExcel.disabled = true;
                btnExportExcel.textContent = '生成中...';

                const wb = new ExcelJS.Workbook();
                wb.creator = 'LAPIS3';
                const ws = wb.addWorksheet('顧客詳細', {
                    pageSetup: {
                        paperSize: 9, // A4
                        orientation: 'portrait',
                        fitToPage: true,
                        fitToWidth: 1,
                        fitToHeight: 0,
                        margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.4, header: 0.2, footer: 0.2 }
                    }
                });

                // ===== デザイン定数 =====
                const NAVY = '1B2A4A';
                const SUB_HEADER = '3D5A80';
                const LIGHT_BG = 'F0F4F8';
                const LABEL_BG = 'E8ECF0';
                const WHITE = 'FFFFFF';
                const FONT_NAME = 'BIZ UDPゴシック';
                const FONT_SIZE = 11;
                const BORDER_COLOR = 'B0B8C4';

                const thinBorder = {
                    top: { style: 'thin', color: { argb: BORDER_COLOR } },
                    left: { style: 'thin', color: { argb: BORDER_COLOR } },
                    bottom: { style: 'thin', color: { argb: BORDER_COLOR } },
                    right: { style: 'thin', color: { argb: BORDER_COLOR } }
                };
                const shrinkAlign = { vertical: 'middle', shrinkToFit: true };
                const shrinkAlignWrap = { vertical: 'middle', shrinkToFit: true, wrapText: false };

                const headerFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
                const subHeaderFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SUB_HEADER } };
                const labelFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LABEL_BG } };
                const lightFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LIGHT_BG } };
                const headerFont = { name: FONT_NAME, size: FONT_SIZE, bold: true, color: { argb: WHITE } };
                const dataFont = { name: FONT_NAME, size: FONT_SIZE };
                const labelFont = { name: FONT_NAME, size: FONT_SIZE, bold: true };

                // ===== カラム幅設定（A4縦に合わせて6列） =====
                ws.columns = [
                    { width: 14 }, // A: label
                    { width: 22 }, // B: value
                    { width: 14 }, // C: label
                    { width: 22 }, // D: value
                    { width: 14 }, // E: label
                    { width: 22 }, // F: value
                ];

                // ===== ヘルパー関数 =====
                const COLS = ['A', 'B', 'C', 'D', 'E', 'F'];

                function addSectionHeader(ws, row, title) {
                    ws.mergeCells(`A${row}:F${row}`);
                    const cell = ws.getCell(`A${row}`);
                    cell.value = title;
                    cell.font = { name: FONT_NAME, size: FONT_SIZE + 1, bold: true, color: { argb: WHITE } };
                    cell.fill = headerFill;
                    cell.alignment = { vertical: 'middle' };
                    cell.border = thinBorder;
                    COLS.forEach(c => { ws.getCell(`${c}${row}`).fill = headerFill; ws.getCell(`${c}${row}`).border = thinBorder; });
                    ws.getRow(row).height = 26;
                    return row + 1;
                }

                function addKeyValueRow(ws, row, pairs, isAlt) {
                    const r = ws.getRow(row);
                    r.height = 22;
                    for (let i = 0; i < 3; i++) {
                        const lCol = COLS[i * 2];     // A, C, E
                        const vCol = COLS[i * 2 + 1]; // B, D, F
                        const lCell = ws.getCell(`${lCol}${row}`);
                        const vCell = ws.getCell(`${vCol}${row}`);
                        lCell.value = pairs[i * 2] || '';
                        lCell.font = labelFont;
                        lCell.fill = labelFill;
                        lCell.border = thinBorder;
                        lCell.alignment = shrinkAlign;
                        vCell.value = pairs[i * 2 + 1] || '';
                        vCell.font = dataFont;
                        vCell.border = thinBorder;
                        vCell.alignment = shrinkAlign;
                        if (isAlt) vCell.fill = lightFill;
                    }
                    return row + 1;
                }

                function addTableHeader(ws, row, headers, colGroups) {
                    if (colGroups) {
                        colGroups.forEach((cols, i) => {
                            ws.mergeCells(`${cols[0]}${row}:${cols[1]}${row}`);
                            const cell = ws.getCell(`${cols[0]}${row}`);
                            cell.value = headers[i];
                            cell.font = { ...headerFont, size: FONT_SIZE };
                            cell.fill = subHeaderFill;
                            cell.border = thinBorder;
                            cell.alignment = { ...shrinkAlign, horizontal: 'center' };
                            ws.getCell(`${cols[1]}${row}`).border = thinBorder;
                            ws.getCell(`${cols[1]}${row}`).fill = subHeaderFill;
                        });
                    } else {
                        headers.forEach((h, i) => {
                            const cell = ws.getCell(`${COLS[i]}${row}`);
                            cell.value = h;
                            cell.font = { ...headerFont, size: FONT_SIZE };
                            cell.fill = subHeaderFill;
                            cell.border = thinBorder;
                            cell.alignment = { ...shrinkAlign, horizontal: 'center' };
                        });
                    }
                    ws.getRow(row).height = 22;
                    return row + 1;
                }

                function addTableRow(ws, row, values, colGroups, isAlt) {
                    if (colGroups) {
                        colGroups.forEach((cols, i) => {
                            ws.mergeCells(`${cols[0]}${row}:${cols[1]}${row}`);
                            const cell = ws.getCell(`${cols[0]}${row}`);
                            cell.value = values[i] || '-';
                            cell.font = dataFont;
                            cell.border = thinBorder;
                            cell.alignment = shrinkAlign;
                            if (isAlt) cell.fill = lightFill;
                            ws.getCell(`${cols[1]}${row}`).border = thinBorder;
                            if (isAlt) ws.getCell(`${cols[1]}${row}`).fill = lightFill;
                        });
                    } else {
                        values.forEach((v, i) => {
                            const cell = ws.getCell(`${COLS[i]}${row}`);
                            cell.value = v || '-';
                            cell.font = dataFont;
                            cell.border = thinBorder;
                            cell.alignment = shrinkAlign;
                            if (isAlt) cell.fill = lightFill;
                        });
                    }
                    ws.getRow(row).height = 20;
                    return row + 1;
                }

                function addEmptyRow(ws, row, msg) {
                    ws.mergeCells(`A${row}:F${row}`);
                    const cell = ws.getCell(`A${row}`);
                    cell.value = msg || 'なし';
                    cell.font = { ...dataFont, italic: true, color: { argb: '999999' } };
                    cell.border = thinBorder;
                    cell.alignment = { ...shrinkAlign, horizontal: 'center' };
                    ws.getRow(row).height = 20;
                    return row + 1;
                }

                let row = 1;

                // ===== タイトル =====
                ws.mergeCells(`A${row}:F${row}`);
                const titleCell = ws.getCell(`A${row}`);
                titleCell.value = `顧客詳細：${currentCustomer.customer_name || ''}`;
                titleCell.font = { name: FONT_NAME, size: 18, bold: true, color: { argb: NAVY } };
                titleCell.alignment = shrinkAlign;
                ws.getRow(row).height = 32;
                row++;

                // 出力日・顧客ID行
                ws.mergeCells(`A${row}:C${row}`);
                ws.getCell(`A${row}`).value = `顧客ID: ${currentCustomer.customer_id}`;
                ws.getCell(`A${row}`).font = { name: FONT_NAME, size: 10, color: { argb: '666666' } };
                ws.getCell(`A${row}`).alignment = shrinkAlign;
                ws.mergeCells(`D${row}:F${row}`);
                ws.getCell(`D${row}`).value = `出力日: ${new Date().toLocaleDateString('ja-JP')}`;
                ws.getCell(`D${row}`).font = { name: FONT_NAME, size: 10, color: { argb: '666666' } };
                ws.getCell(`D${row}`).alignment = { ...shrinkAlign, horizontal: 'right' };
                ws.getRow(row).height = 18;
                row += 2;

                // ===== ■ 基本情報 =====
                const staff = staffMembers.find(s => s.staff_id === currentCustomer.primary_staff_id);
                row = addSectionHeader(ws, row, '■ 基本情報');
                row = addKeyValueRow(ws, row, ['顧客名', currentCustomer.customer_name || '-', 'フリガナ', currentCustomer.customer_kana || '-', '顧客区分', currentCustomer.customer_type || '-'], false);
                row = addKeyValueRow(ws, row, ['代表者名', currentCustomer.representative_name || '-', '外務担当', staff ? staff.staff_name : '-', '状態', currentCustomer.status || '-'], false);
                row = addKeyValueRow(ws, row, ['法人番号', currentCustomer.corporate_number || '-', '決算期', `${currentCustomer.fiscal_year_end_month || '-'}月 ${currentCustomer.fiscal_year_end_day || '-'}日`, '', ''], false);
                row++;

                // ===== ■ 連絡先・住所 =====
                row = addSectionHeader(ws, row, '■ 連絡先・住所');
                // 住所行: D:F結合（住所値を広く表示）
                const addrRow = row;
                row = addKeyValueRow(ws, row, ['〒', currentCustomer.postal_code || '-', '住所', (currentCustomer.address || '') + (currentCustomer.building_name ? ' ' + currentCustomer.building_name : ''), '', ''], false);
                // E,Fのラベル/値をクリアしてD:Fを結合
                ws.getCell(`E${addrRow}`).value = '';
                ws.getCell(`E${addrRow}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF' } };
                ws.getCell(`F${addrRow}`).value = '';
                ws.getCell(`F${addrRow}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF' } };
                ws.mergeCells(`D${addrRow}:F${addrRow}`);
                ws.getCell(`D${addrRow}`).border = thinBorder;
                ws.getCell(`D${addrRow}`).alignment = shrinkAlign;

                row = addKeyValueRow(ws, row, ['電話番号', currentCustomer.phone || '-', 'FAX', currentCustomer.fax || '-', 'メール', currentCustomer.email || '-'], false);
                row = addKeyValueRow(ws, row, ['年賀状', currentCustomer.nenga || '-', '中元', currentCustomer.chugen || '-', 'FAX可否', currentCustomer.fax_ok || '-'], false);

                // 備考行: B:F結合（備考値を広く表示）
                const remarksRow = row;
                row = addKeyValueRow(ws, row, ['備考', currentCustomer.remarks || '-', '', '', '', ''], false);
                // C-Fのラベル/値をクリアしてB:Fを結合
                ['C', 'D', 'E', 'F'].forEach(c => {
                    ws.getCell(`${c}${remarksRow}`).value = '';
                    ws.getCell(`${c}${remarksRow}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF' } };
                });
                ws.mergeCells(`B${remarksRow}:F${remarksRow}`);
                ws.getCell(`B${remarksRow}`).value = currentCustomer.remarks || '-';
                ws.getCell(`B${remarksRow}`).font = dataFont;
                ws.getCell(`B${remarksRow}`).border = thinBorder;
                ws.getCell(`B${remarksRow}`).alignment = shrinkAlign;
                row++;

                // ===== ■ 拠点一覧 =====
                row = addSectionHeader(ws, row, '■ 拠点一覧');
                const officeColGroups = [['A', 'B'], ['C', 'D'], ['E', 'F']];
                row = addTableHeader(ws, row, ['拠点名', '住所', '電話番号'], officeColGroups);

                const relatedOffices = offices.filter(o => Number(o.customer_id) === currentCustomer.customer_id);
                if (relatedOffices.length === 0) {
                    row = addEmptyRow(ws, row);
                } else {
                    relatedOffices.forEach((o, idx) => {
                        row = addTableRow(ws, row, [o.office_name, o.address, o.phone], officeColGroups, idx % 2 === 1);
                    });
                }
                row++;

                // ===== ■ 有効な許認可 =====
                row = addSectionHeader(ws, row, '■ 有効な許認可');
                const licColGroups = [['A', 'B'], ['C', 'D'], ['E', 'F']];
                row = addTableHeader(ws, row, ['許認可種別', '許可番号', '有効期限'], licColGroups);

                const relatedLicenses = licenses.filter(l => l.customer_id === currentCustomer.customer_id && l.status === '有効');
                if (relatedLicenses.length === 0) {
                    row = addEmptyRow(ws, row);
                } else {
                    relatedLicenses.forEach((l, idx) => {
                        const type = licenseTypes.find(lt => lt.license_type_id === l.license_type_id);
                        const licNum = plainLicenseNumber(l) || '-';
                        const expiry = plainDate(l.expiry_date) || '-';
                        row = addTableRow(ws, row, [type ? type.license_type_name : '-', licNum, expiry], licColGroups, idx % 2 === 1);
                    });
                }
                row++;

                // ===== ■ 担当者一覧 =====
                row = addSectionHeader(ws, row, '■ 担当者一覧');
                row = addTableHeader(ws, row, ['氏名', '所属拠点', '役職', '電話番号'], [['A', 'A'], ['B', 'C'], ['D', 'D'], ['E', 'F']]);

                const relatedContacts = contacts.filter(c => Number(c.customer_id) === currentCustomer.customer_id);
                if (relatedContacts.length === 0) {
                    row = addEmptyRow(ws, row);
                } else {
                    relatedContacts.forEach((c, idx) => {
                        const officeName = offices.find(o => o.office_id === c.office_id && Number(o.customer_id) === currentCustomer.customer_id)?.office_name || '-';
                        row = addTableRow(ws, row, [c.contact_name, officeName, c.title, c.phone], [['A', 'A'], ['B', 'C'], ['D', 'D'], ['E', 'F']], idx % 2 === 1);
                    });
                }
                row++;

                // ===== ■ 関連案件 =====
                row = addSectionHeader(ws, row, '■ 関連案件');
                row = addTableHeader(ws, row, ['ステータス', '業務内容', '受任日', '完了日'], [['A', 'A'], ['B', 'C'], ['D', 'D'], ['E', 'F']]);

                const relatedCases = cases.filter(c => c.customer_id === currentCustomer.customer_id);
                if (relatedCases.length === 0) {
                    row = addEmptyRow(ws, row);
                } else {
                    relatedCases.forEach((c, idx) => {
                        const contractDate = plainDate(c.contract_date) || '-';
                        const completionDate = plainDate(c.completion_date) || '-';
                        row = addTableRow(ws, row, [c.status, c.license_type, contractDate, completionDate], [['A', 'A'], ['B', 'C'], ['D', 'D'], ['E', 'F']], idx % 2 === 1);
                    });
                }

                // ===== ファイル保存 =====
                const buffer = await wb.xlsx.writeBuffer();
                const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
                saveAs(blob, `顧客詳細_${currentCustomer.customer_name}_${new Date().toISOString().split('T')[0]}.xlsx`);

            } catch (err) {
                console.error('Excel export failed:', err);
                alert('Excel出力に失敗しました: ' + err.message);
            } finally {
                btnExportExcel.disabled = false;
                btnExportExcel.innerHTML = '<span>📊</span> Excel出力';
            }
        });
    }

    form.addEventListener('submit', handleSave);

    // Explicitly attach to header save button to ensure it works
    const btnHeaderSave = document.querySelector('button[form="customer-form"]');
    if (btnHeaderSave) {
        btnHeaderSave.addEventListener('click', handleSave);
    }

    if (btnDelete) btnDelete.addEventListener('click', handleDelete);
    [btnBack, btnBackTop].forEach(btn => btn?.addEventListener('click', () => { if (confirm('戻りますか？')) window.location.href = 'customer_list.html'; }));

    // Buttons for adding related data (Ensure CIDs are passed)
    document.getElementById('btn-add-office')?.addEventListener('click', () => {
        if (!customerIdParam || customerIdParam === 'new') { alert('先に顧客情報を保存してください'); return; }
        window.location.href = `office_detail.html?customer_id=${customerIdParam}&id=new`;
    });
    document.getElementById('btn-add-contact')?.addEventListener('click', () => {
        if (!customerIdParam || customerIdParam === 'new') { alert('先に顧客情報を保存してください'); return; }
        window.location.href = `contact_detail.html?customer_id=${customerIdParam}&id=new`;
    });
    document.getElementById('btn-add-license')?.addEventListener('click', () => {
        if (!customerIdParam || customerIdParam === 'new') { alert('先に顧客情報を保存してください'); return; }
        window.location.href = `license_detail.html?customer_id=${customerIdParam}&id=new`;
    });
    document.getElementById('btn-add-related-case')?.addEventListener('click', () => {
        if (!customerIdParam || customerIdParam === 'new') { alert('先に顧客情報を保存してください'); return; }
        window.location.href = `detail.html?customer_id=${customerIdParam}&id=new`;
    });

    // --- 概要タブ内のボタン → タブ切替 ---
    function switchToTab(tabName) {
        const tabs = document.querySelectorAll('.tab-btn');
        const contents = document.querySelectorAll('.tab-content');
        tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === tabName));
        contents.forEach(c => c.classList.toggle('active', c.id === `tab-${tabName}`));
    }
    document.getElementById('btn-goto-basic')?.addEventListener('click', () => switchToTab('basic'));
    document.getElementById('btn-goto-basic-memo')?.addEventListener('click', () => switchToTab('basic'));
    document.getElementById('btn-goto-licenses')?.addEventListener('click', () => switchToTab('licenses'));
    document.getElementById('btn-goto-cases')?.addEventListener('click', () => switchToTab('projects'));
    // サマリーカードリンク
    document.getElementById('link-to-licenses')?.addEventListener('click', () => switchToTab('licenses'));
    document.getElementById('link-to-cases')?.addEventListener('click', () => switchToTab('projects'));
    document.getElementById('link-to-invoices')?.addEventListener('click', () => switchToTab('billing'));
    document.getElementById('link-to-alerts')?.addEventListener('click', () => switchToTab('overview'));

    // --- Postal code address lookup ---
    const btnLookupZip = document.getElementById('btn-lookup-zip');
    const postalCodeInput = document.getElementById('postal_code');
    if (btnLookupZip && postalCodeInput) {
        btnLookupZip.addEventListener('click', async () => {
            const zip = postalCodeInput.value.trim().replace(/-/g, '');
            if (!/^\d{7}$/.test(zip)) {
                alert('7桁の郵便番号を入力してください（例：1234567）');
                return;
            }
            try {
                const response = await fetch(`https://zipcloud.ibsnet.co.jp/api/search?zipcode=${zip}`);
                const data = await response.json();
                if (data.status === 200 && data.results) {
                    const result = data.results[0];
                    const addr = result.address1 + result.address2 + result.address3;
                    document.getElementById('address').value = addr;
                    showToast('住所を入力しました', 'success');
                } else {
                    alert('該当する住所が見つかりませんでした。');
                }
            } catch (error) {
                console.error('ZipCloud API Error:', error);
                alert('住所の取得に失敗しました。');
            }
        });
    }


    // --- Report Engine (Tax Certificate) ---
    const btnOpenTaxCert = document.getElementById('btn-open-tax-cert-modal');
    const reportModal = document.getElementById('report-modal');
    const btnCloseReport = document.getElementById('btn-close-report-modal');
    const btnPreviewReport = document.getElementById('btn-preview-report');
    const btnPrintReport = document.getElementById('btn-print-report');
    const selApplicantType = document.getElementById('report_applicant_type');
    const groupStaffSelect = document.getElementById('group_staff_select');
    const selReportStaff = document.getElementById('report_staff_id');

    if (btnOpenTaxCert) {
        btnOpenTaxCert.addEventListener('click', () => {
            if (!currentCustomer) {
                alert('顧客データが保存されていません。先に保存してください。');
                return;
            }
            
            // Populate staff dropdown if empty
            if (selReportStaff && selReportStaff.options.length <= 1) {
                const activeStaff = staffMembers
                    .filter(s => s.status === '在籍')
                    .sort((a, b) => (a.staff_id || 0) - (b.staff_id || 0));
                activeStaff.forEach(s => {
                    const opt = document.createElement('option');
                    opt.value = s.staff_id;
                    opt.textContent = s.staff_name;
                    selReportStaff.appendChild(opt);
                });
            }

            // Set default period
            const periodStartInput = document.getElementById('report_period_start');
            const periodEndInput = document.getElementById('report_period_end');
            
            function calculateStartDate(endDateStr) {
                if (!endDateStr) return '';
                const endDate = new Date(endDateStr);
                if (isNaN(endDate.getTime())) return '';
                // 1年前の翌日
                const startDate = new Date(endDate);
                startDate.setFullYear(startDate.getFullYear() - 1);
                startDate.setDate(startDate.getDate() + 1);
                return Math.max(startDate.getFullYear(), 1900) + '-' + String(startDate.getMonth() + 1).padStart(2, '0') + '-' + String(startDate.getDate()).padStart(2, '0');
            }

            if (periodEndInput && periodStartInput) {
                if (!periodEndInput.value) {
                    if (currentCustomer.fiscal_year_end_month && currentCustomer.fiscal_year_end_day) {
                        const today = new Date();
                        // 実行当日の時刻をリセットして厳密な日付比較を行う
                        today.setHours(0, 0, 0, 0);

                        const m = parseInt(currentCustomer.fiscal_year_end_month, 10);
                        const d = parseInt(currentCustomer.fiscal_year_end_day, 10);
                        
                        // 今年の決算日候補を作成
                        let candidateEndDate = new Date(today.getFullYear(), m - 1, d);
                        
                        // 候補日が「本日以降（同日含む）」であれば、1年前を決算日とする（直近の既経過決算期）
                        if (candidateEndDate >= today) {
                            candidateEndDate.setFullYear(candidateEndDate.getFullYear() - 1);
                        }
                        
                        const yStr = candidateEndDate.getFullYear();
                        const mStr = String(candidateEndDate.getMonth() + 1).padStart(2, '0');
                        const dStr = String(candidateEndDate.getDate()).padStart(2, '0');
                        
                        initialEndDate = `${yStr}-${mStr}-${dStr}`;
                    } else {
                        // 決算日の設定がない場合は本日をセット（安全なフォールバック）
                        const today = new Date();
                        initialEndDate = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
                    }
                    
                    periodEndInput.value = initialEndDate;
                    periodStartInput.value = calculateStartDate(initialEndDate);
                }

                if (!periodEndInput.dataset.listenerAttached) {
                    periodEndInput.addEventListener('change', (e) => {
                        periodStartInput.value = calculateStartDate(e.target.value);
                    });
                    periodEndInput.dataset.listenerAttached = 'true';
                }
            }

            if(reportModal) reportModal.style.display = 'flex';
        });
    }

    if (btnCloseReport) {
        btnCloseReport.addEventListener('click', () => {
            if(reportModal) reportModal.style.display = 'none';
        });
    }

    if (selApplicantType) {
        selApplicantType.addEventListener('change', (e) => {
            if (e.target.value === '代理人') {
                if(groupStaffSelect) groupStaffSelect.style.display = 'block';
            } else {
                if(groupStaffSelect) groupStaffSelect.style.display = 'none';
                if(selReportStaff) selReportStaff.value = ''; // Reset
            }
        });
        // Trigger initial state
        setTimeout(()=>selApplicantType.dispatchEvent(new Event('change')), 100);
    }

    async function handleReportAction(actionType) {
        if (!currentCustomer) return;

        // Validation
        const appType = selApplicantType ? selApplicantType.value : '本人';
        const staffId = selReportStaff ? selReportStaff.value : '';
        if (appType === '代理人' && !staffId) {
            alert('代理人の担当者を選択してください。');
            return;
        }

        // Gather form data
        const taxTypes = Array.from(document.querySelectorAll('input[name="taxType"]:checked')).map(cb => cb.value);
        const selectedStaff = staffMembers.find(s => String(s.staff_id) === String(staffId)) || null;
        
        const formData = {
            taxTypes: taxTypes,
            period_start: document.getElementById('report_period_start') ? document.getElementById('report_period_start').value : '',
            period_end: document.getElementById('report_period_end') ? document.getElementById('report_period_end').value : '',
            copies: document.getElementById('report_copies') ? document.getElementById('report_copies').value : '1',
            submittedTo: document.getElementById('report_submitted_to') ? document.getElementById('report_submitted_to').value : '',
            applicantType: appType,
            staff: selectedStaff ? {
                name: selectedStaff.staff_name,
                kana: selectedStaff.staff_kana,
                tel: selectedStaff.phone,
                address: selectedStaff.address || ''
            } : null
        };

        try {
            // Disable buttons
            if (btnPreviewReport) btnPreviewReport.disabled = true;
            if (btnPrintReport) btnPrintReport.disabled = true;
            let btnOriginalText = '';
            if (actionType === 'preview') {
                btnOriginalText = btnPreviewReport.textContent;
                btnPreviewReport.textContent = '生成中...';
            } else {
                btnOriginalText = btnPrintReport.textContent;
                btnPrintReport.textContent = '生成中...';
            }

            // 1. Build View Data
            const viewData = window.TaxCertificateView.buildData(currentCustomer, formData);

            // 2. Load Mapping (相対パスから絶対URLを動的生成)
            const getAbsoluteUrl = (relativePath) => {
                const base = window.location.href.split('?')[0].replace(/\/[^\/]*$/, '/');
                return new URL(relativePath, base).href;
            };
            
            const mapUrl = getAbsoluteUrl('report-system/report-templates/tax_certificate_map.json');
            const mapRes = await fetch(mapUrl);
            if (!mapRes.ok) throw new Error('マッピング定義の読み込みに失敗しました');
            const mappingJson = await mapRes.json();

            // 3. URLs
            let templateUrl = getAbsoluteUrl('report-system/report-templates/tax_certificate.pdf');
            const templateRes = await fetch(templateUrl, {method: 'HEAD'});
            if (!templateRes.ok) {
                templateUrl = getAbsoluteUrl('report-system/report-templates/tax_certificate.pdf.pdf'); // User upload fallback
            }
            const fontUrl = getAbsoluteUrl('report-system/report-templates/NotoSansJP-Regular.ttf');

            // 4. Generate
            const pdfBytes = await window.ReportEngine.generateReport(templateUrl, fontUrl, mappingJson, viewData);

            // 5. Output
            if (actionType === 'preview') {
                window.ReportEngine.previewPDF(pdfBytes);
                if (btnPreviewReport) btnPreviewReport.textContent = btnOriginalText;
            } else {
                // ファイル出力時の名称を変更（禁則文字がある場合はここでサニタイズ処理を入れることを推奨）
                const filename = `納税証明申請書_都税_${currentCustomer.customer_name}.pdf`;
                window.ReportEngine.downloadPDF(pdfBytes, filename);
                if(reportModal) reportModal.style.display = 'none'; // Close modal on download
                if (btnPrintReport) btnPrintReport.textContent = btnOriginalText;
            }
        } catch (err) {
            console.error('Report Generation Error:', err);
            alert('帳票の生成に失敗しました: ' + err.message);
            if (btnPreviewReport) btnPreviewReport.textContent = 'プレビュー';
            if (btnPrintReport) btnPrintReport.textContent = '印刷（ダウンロード）';
        } finally {
            if (btnPreviewReport) btnPreviewReport.disabled = false;
            if (btnPrintReport) btnPrintReport.disabled = false;
        }
    }

    if (btnPreviewReport) {
        btnPreviewReport.addEventListener('click', () => handleReportAction('preview'));
    }
    if (btnPrintReport) {
        btnPrintReport.addEventListener('click', () => handleReportAction('download'));
    }

    // --- Report Engine (National Tax Certificate) ---
    const btnOpenNationalTaxCert = document.getElementById('btn-open-national-tax-cert-modal');
    const reportNationalModal = document.getElementById('report-national-modal');
    const btnCloseNationalReport = document.getElementById('btn-close-national-modal');
    const btnPrintNationalReport = document.getElementById('btn-print-national-report');
    const selNationalApplicantType = document.getElementById('report_national_applicant_type');
    const groupNationalStaffSelect = document.getElementById('group_national_staff_select');
    const selNationalReportStaff = document.getElementById('report_national_staff_id');

    if (btnOpenNationalTaxCert) {
        btnOpenNationalTaxCert.addEventListener('click', () => {
            if (!currentCustomer) {
                alert('顧客データが保存されていません。先に保存してください。');
                return;
            }
            
            // Populate staff dropdown if empty
            if (selNationalReportStaff && selNationalReportStaff.options.length <= 1) {
                const activeStaff = staffMembers
                    .filter(s => s.status === '在籍')
                    .sort((a, b) => (a.staff_id || 0) - (b.staff_id || 0));
                activeStaff.forEach(s => {
                    const opt = document.createElement('option');
                    opt.value = s.staff_id;
                    opt.textContent = s.staff_name;
                    selNationalReportStaff.appendChild(opt);
                });
            }

            if(reportNationalModal) reportNationalModal.style.display = 'flex';
        });
    }

    if (btnCloseNationalReport) {
        btnCloseNationalReport.addEventListener('click', () => {
            if(reportNationalModal) reportNationalModal.style.display = 'none';
        });
    }

    if (selNationalApplicantType) {
        selNationalApplicantType.addEventListener('change', (e) => {
            if (e.target.value === '代理人') {
                if(groupNationalStaffSelect) groupNationalStaffSelect.style.display = 'block';
            } else {
                if(groupNationalStaffSelect) groupNationalStaffSelect.style.display = 'none';
                if(selNationalReportStaff) selNationalReportStaff.value = ''; // Reset
            }
        });
        // Trigger initial state
        setTimeout(()=>selNationalApplicantType.dispatchEvent(new Event('change')), 100);
    }

    async function handleNationalReportAction() {
        if (!currentCustomer) return;

        // Validation
        const appType = selNationalApplicantType ? selNationalApplicantType.value : '本人';
        const staffId = selNationalReportStaff ? selNationalReportStaff.value : '';
        if (appType === '代理人' && !staffId) {
            alert('代理人の担当者を選択してください。');
            return;
        }

        const selectedStaff = staffMembers.find(s => String(s.staff_id) === String(staffId)) || null;
        
        const formData = {
            taxType: document.getElementById('report_national_tax_type') ? document.getElementById('report_national_tax_type').value : '',
            period_start: document.getElementById('report_national_period_start') ? document.getElementById('report_national_period_start').value : '',
            period_end: document.getElementById('report_national_period_end') ? document.getElementById('report_national_period_end').value : '',
            copies: document.getElementById('report_national_copies') ? document.getElementById('report_national_copies').value : '1',
            purpose: document.getElementById('report_national_purpose') ? document.getElementById('report_national_purpose').value : '',
            applicantType: appType,
            staff: selectedStaff ? {
                name: selectedStaff.staff_name,
                kana: selectedStaff.staff_kana,
                tel: selectedStaff.phone,
                address: selectedStaff.address || ''
            } : null
        };

        try {
            if (btnPrintNationalReport) btnPrintNationalReport.disabled = true;
            let btnOriginalText = btnPrintNationalReport.textContent;
            btnPrintNationalReport.textContent = '生成中...';

            // 1. Build View Data
            const viewData = window.TaxCertificateNationalView.buildData(currentCustomer, formData);

            // キャッシュ対策：PDF差し替え時にブラウザキャッシュが残るのを防ぐため、タイムスタンプを付与
            const t = new Date().getTime();

            // 2. Load Mapping
            const mapRes = await fetch(`report-system/report-templates/TaxPaymentCertificate_National_map.json?t=${t}`);
            if (!mapRes.ok) throw new Error('国税用マッピング定義の読み込みに失敗しました');
            const mappingJson = await mapRes.json();

            // 3. URLs
            const templateUrl = `report-system/report-templates/Tax_Payment_Certificate.pdf?t=${t}`;
            const fontUrl = 'report-system/report-templates/NotoSansJP-Regular.ttf';

            // 4. Generate
            const pdfBytes = await window.ReportEngine.generateReport(templateUrl, fontUrl, mappingJson, viewData);

            // 5. Output
            const safeCustomerName = currentCustomer.customer_name.replace(/[\\/:*?"<>|]/g, '_');
            const filename = `TaxPaymentCertificate_National_${safeCustomerName}.pdf`;
            window.ReportEngine.downloadPDF(pdfBytes, filename);
            if(reportNationalModal) reportNationalModal.style.display = 'none'; // Close modal on download
            if (btnPrintNationalReport) btnPrintNationalReport.textContent = btnOriginalText;
            
        } catch (err) {
            console.error('Report Generation Error:', err);
            alert('国税帳票の生成に失敗しました: ' + err.message);
            if (btnPrintNationalReport) btnPrintNationalReport.textContent = '印刷（ダウンロード）';
        } finally {
            if (btnPrintNationalReport) btnPrintNationalReport.disabled = false;
        }
    }

    if (btnPrintNationalReport) {
        btnPrintNationalReport.addEventListener('click', () => handleNationalReportAction());
    }

    await init();
});
