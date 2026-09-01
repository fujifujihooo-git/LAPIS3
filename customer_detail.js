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

    // --- Lazy Load Helper (Phase1 パフォーマンス改善) ---
    function loadScript(url) {
        return new Promise((resolve, reject) => {
            if (document.querySelector(`script[src="${url}"]`)) {
                resolve();
                return;
            }
            const script = document.createElement('script');
            script.src = url;
            script.onload = resolve;
            script.onerror = () => reject(new Error(`スクリプトの読み込みに失敗しました: ${url}`));
            document.head.appendChild(script);
        });
    }

    // --- State ---
    let customers = [];
    let cases = [];
    let offices = [];
    let contacts = [];
    let licenses = [];
    let licenseTypes = [];
    let staffMembers = [];
    let governmentOffices = [];
    let currentCustomer = null;
    let customerIdParam = null;
    const billingCacheMap = {};

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
                    const wrapper = btnRefresh.querySelector('.refresh-icon-wrapper');
                    if (wrapper) wrapper.classList.add('spinner');
                    btnRefresh.disabled = true;
                    try {
                        window.AppCache.invalidate(`customer_${customerIdParam}`);
                        await refreshCustomerUI(parseInt(customerIdParam));
                    } catch (e) {
                        console.error('リフレッシュエラー:', e);
                        showToast('最新データの取得に失敗しました', 'error');
                    } finally {
                        if (wrapper) wrapper.classList.remove('spinner');
                        btnRefresh.disabled = false;
                    }
                }
            });
        }



        // 書類返却通知書モーダル起動ボタンのイベントリスナー
        const btnDocReturn = document.getElementById('btn-document-return');
        if (btnDocReturn) {
            btnDocReturn.addEventListener('click', () => {
                if (!currentCustomer) {
                    alert('顧客情報を読み込んでから実行してください。');
                    return;
                }
                const docModal = new window.DocumentReturnModal();
                docModal.open(currentCustomer, contacts || [], async (record) => {
                    console.log('書類返却完了レコード:', record);
                    if (currentCustomer && (currentCustomer.customer_id || currentCustomer.id)) {
                        const cId = currentCustomer.customer_id || currentCustomer.id;
                        await loadCustomerHistories(cId);
                    }
                });
            });
        }

        // レターパック宛名印刷モーダル起動ボタンのイベントリスナー
        const btnShipLabel = document.getElementById('btn-open-shipping-label-modal');
        if (btnShipLabel) {
            btnShipLabel.addEventListener('click', () => {
                if (!currentCustomer) {
                    alert('顧客情報を読み込んでから実行してください。');
                    return;
                }
                const shipModal = new window.ShippingLabelModal();
                shipModal.open(currentCustomer, contacts || [], typeof staffMembers !== 'undefined' ? (staffMembers || []) : [], async (record) => {
                    console.log('レターパック発送履歴レコード:', record);
                    if (currentCustomer && (currentCustomer.customer_id || currentCustomer.id)) {
                        const cId = currentCustomer.customer_id || currentCustomer.id;
                        await loadCustomerHistories(cId);
                    }
                }, offices || []);
            });
        }

        // 2. Asynchronous Data Fetching Phase
        if (customerIdParam !== 'new') {
            updateScreenMode('existing');
            const cId = !isNaN(customerIdParam) ? Number(customerIdParam) : customerIdParam;
            // Fetch everything, wait for completion to avoid race conditions
            await refreshCustomerUI(cId);
            await loadCustomerHistories(cId);
        }
        
        // Setup Sort Headers for cases (Sorting logic works on currently loaded cases array)
        initSortHeaders('#related-cases-table', currentRelatedSort, () => {
            if (currentCustomer && currentCustomer.customer_id) {
                renderRelatedCases(Number(currentCustomer.customer_id));
            }
        });

        // 組織・連絡タブ: 本店・代表連絡先カードのイベント設定
        setupHQCardEvents();

        // 履歴タブ: イベント設定
        initHistoryEvents();

        // 3. 復元処理（activeTabの復元）
        const urlParams = new URLSearchParams(window.location.search);
        const activeTab = urlParams.get('activeTab');
        if (activeTab) {
            switchToTab(activeTab);
        }
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
            const staff = staffMembers.find(s => Number(s.staff_id) === Number(data.primary_staff_id));
            staffEl.textContent = staff ? staff.staff_name : '―';
            console.log('[HeaderRender]', data.primary_staff_id);
        }

        const fiscalEl = document.getElementById('fiscal-display');
        if (fiscalEl) fiscalEl.textContent = data.fiscal_year_end_month ? `${data.fiscal_year_end_month}月` : '―';

        const corpEl = document.getElementById('corp-num-display');
        if (corpEl) corpEl.textContent = data.corporate_number || '―';

        const lastUpdEl = document.getElementById('last-updated-meta');
        if (lastUpdEl) {
            lastUpdEl.textContent = typeof formatToJST === 'function' ? formatToJST(data.updated_at) : '―';
        }

        // ページタイトル更新
        const pageTitle = document.getElementById('page-title');
        if (pageTitle) pageTitle.textContent = `顧客カルテ：${data.customer_name || ''}`;
    }

    /**
     * 画面とPDFで共有する、顧客の概要表示用データを解決する共通関数
     * @param {Object} data - 顧客基本情報
     * @param {Array} contactsList - 取引先担当者リスト
     * @param {Array} officesList - 拠点リスト
     * @param {Array} staffMembersList - 自社スタッフマスタ
     * @returns {Object} 解決された表示用データオブジェクト
     */
    function resolveOverviewDisplayData(data, contactsList, officesList, staffMembersList) {
        if (!data) {
            return {
                salesStaffName: '―',
                primaryContactName: '―',
                primaryOfficeName: '―',
                primaryEmail: '―',
                foundedDate: '―',
                capitalStr: '―',
                fiscalStr: '―'
            };
        }

        // 外務担当者 (自社スタッフ)
        let salesStaffName = '―';
        if (data.primary_staff_id) {
            const staff = staffMembersList.find(s => Number(s.staff_id) === Number(data.primary_staff_id));
            if (staff) {
                salesStaffName = staff.staff_name || '―';
            }
        }

        // 主担当者・所属拠点・担当メール
        let primaryContactName = '―';
        let primaryOfficeName = '―';
        let primaryEmail = '―';
        const cId = Number(data.customer_id);
        const primaryContact = contactsList.find(c => Number(c.customer_id) === cId && c.is_primary === true);
        if (primaryContact) {
            primaryContactName = primaryContact.contact_name || '―';
            const primaryOffice = officesList.find(o =>
                String(o.office_id) === String(primaryContact.office_id) && Number(o.customer_id) === cId
            );
            primaryOfficeName = primaryOffice ? primaryOffice.office_name : '―';
            primaryEmail = primaryContact.email || (primaryOffice ? primaryOffice.email : null) || '―';
        }

        // 設立日
        let foundedDate = '―';
        if (data.founded_date) {
            foundedDate = data.founded_date.replace(/-/g, '/');
        }

        // 資本金
        let capitalStr = '―';
        if (data.capital && Number(data.capital) > 0) {
            capitalStr = Number(data.capital).toLocaleString() + ' 千円';
        }

        // 決算期
        let fiscalStr = '―';
        if (data.fiscal_year_end_month) {
            fiscalStr = `${data.fiscal_year_end_month}月${data.fiscal_year_end_day || ''}日`;
        }

        return {
            salesStaffName,
            primaryContactName,
            primaryOfficeName,
            primaryEmail,
            foundedDate,
            capitalStr,
            fiscalStr
        };
    }

    /** 概要タブ 基本情報（読み取り専用テーブル）更新 */
    function updateOverviewTab(data) {
        if (!data) return;
        const setText = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val || '―'; };
        
        // 共通ロジックでのデータ解決
        const dispData = resolveOverviewDisplayData(data, contacts, offices, staffMembers);

        setText('ov-name', data.customer_name);
        setText('ov-kana', data.customer_kana);
        setText('ov-rep', data.representative_name);
        setText('ov-type', data.customer_type);
        setText('ov-fiscal', dispData.fiscalStr !== '―' ? dispData.fiscalStr : null);
        setText('ov-corp', data.corporate_number);
        setText('ov-phone', data.phone);
        setText('ov-fax', data.fax);
        setText('ov-email', data.email);
        setText('ov-zip', data.postal_code);
        setText('ov-addr', (data.address || '') + (data.building_name ? ' ' + data.building_name : '') || null);
        setText('ov-remarks', data.remarks);

        // 新共通ロジックに基づく値の設定
        setText('ov-staff', dispData.salesStaffName !== '―' ? dispData.salesStaffName : null);
        setText('ov-primary-contact', dispData.primaryContactName !== '―' ? dispData.primaryContactName : null);
        setText('ov-primary-office', dispData.primaryOfficeName !== '―' ? dispData.primaryOfficeName : null);
        setText('ov-primary-email', dispData.primaryEmail !== '―' ? dispData.primaryEmail : null);

        const foundedEl = document.getElementById('ov-founded');
        if (foundedEl) {
            foundedEl.textContent = dispData.foundedDate;
        }

        const capitalEl = document.getElementById('ov-capital');
        if (capitalEl) {
            capitalEl.textContent = dispData.capitalStr;
        }
        window.__CUSTOMER_LOADED__ = true;
    }


    /**
     * 顧客アラート情報の更新・表示
     */
    function updateCustomerAlerts(cId) {
        const alertsContainer = document.getElementById('customer-alerts-container');
        if (!alertsContainer) return;
        
        alertsContainer.innerHTML = '';
        
        // 許認可アラート（期限切れ、90日以内）
        const custLicenses = licenses.filter(l => l.customer_id === cId);
        const activeLics = custLicenses.filter(l => l.status === '有効' || l.status === '期限切れ');
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

        // 優先度順にアラートHTMLを生成 (1.期限切れ, 2.更新期限接近)
        if (expiredCount > 0) {
            const badge = document.createElement('span');
            badge.className = 'customer-alert-badge customer-alert-danger';
            badge.textContent = `🔴 期限切れ ${expiredCount}件`;
            alertsContainer.appendChild(badge);
        }
        
        if (warnCount > 0) {
            const badge = document.createElement('span');
            badge.className = 'customer-alert-badge customer-alert-warning';
            badge.textContent = `🟡 更新期限90日以内 ${warnCount}件`;
            alertsContainer.appendChild(badge);
        }

        if (expiredCount === 0 && warnCount === 0) {
            alertsContainer.style.display = 'none';
        } else {
            alertsContainer.style.display = 'flex';
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
                // 状態判定用の今日の日付
                const today = new Date();
                today.setHours(0, 0, 0, 0);

                licBody.innerHTML = sortedLics.slice(0, 5).map(l => {
                    const type = licenseTypes.find(lt => lt.license_type_id === l.license_type_id);
                    const expDate = l.expiry_date ? (l.expiry_date.toDate ? l.expiry_date.toDate() : new Date(l.expiry_date)) : null;
                    const expStr = expDate ? expDate.toLocaleDateString('ja-JP') : '―';
                    const statusClass = l.status === '有効' ? 'badge-success-sm' : (l.status === '期限切れ' ? 'badge-danger-sm' : 'badge-warning-sm');
                    const licenseNum = typeof formatLicenseNumber === 'function' ? formatLicenseNumber(l) : (l.license_number || '―');
                    const officeName = typeof getGovernmentOfficeName === 'function' ? getGovernmentOfficeName(l) || '―' : '―';
                    
                    // --- 状態別行ハイライト ---
                    let rowClass = '';
                    const notDate = l.notice_date ? (l.notice_date.toDate ? l.notice_date.toDate() : new Date(l.notice_date)) : null;
                    
                    if (expDate && expDate < today) {
                        rowClass = 'license-row-expired';
                    } else if (notDate && notDate <= today) {
                        rowClass = 'license-row-notice';
                    }

                    return `<tr class="${rowClass}">
                        <td>${type ? type.license_type_name : '―'}</td>
                        <td>
                            <div class="overview-primary-text">${licenseNum}</div>
                            <div class="overview-secondary-text">${officeName}</div>
                        </td>
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

                    const officeName = getGovernmentOfficeName(c);
                    const officeHtml = officeName ? `<span class="ov-case-office" title="${escapeHtml(officeName)}">(${escapeHtml(officeName)})</span>` : '';

                    return `<tr>
                        <td>
                            <div style="font-weight: 600;">${c.license_type || '―'}${officeHtml}</div>
                            <div class="overview-secondary-text">${contStr === '―' ? '―' : contStr + ' 受任'}</div>
                        </td>
                        <td>${statusBadgeHtml}</td>
                        <td>${feeStr}</td>
                        <td>${complStr}</td>
                    </tr>`;
                }).join('');
            }
        }
    }

    /** 概要タブ 直近の対応履歴描画 */
    function renderOverviewHistories(cId) {
        const container = document.getElementById('ov-history-list');
        if (!container) return;

        // 履歴データがない場合
        if (!histories || histories.length === 0) {
            container.innerHTML = '<div style="padding: 12px; text-align: center; color: #999; font-style: italic;">対応履歴はありません</div>';
            return;
        }

        // 最新の5件を抽出（histories はすでに response_date の降順でソート済み）
        const recentHistories = histories.slice(0, 5);

        container.innerHTML = recentHistories.map(h => {
            let badgeClass = 'ov-badge-other';
            if (h.history_category === 'document_return' || h.history_type === '書類返却') {
                badgeClass = 'ov-badge-document';
            } else if (h.history_type === '電話') {
                badgeClass = 'ov-badge-phone';
            } else if (h.history_type === 'メール') {
                badgeClass = 'ov-badge-mail';
            } else if (h.history_type === '訪問') {
                badgeClass = 'ov-badge-visit';
            }

            const rDate = h.response_date ? (h.response_date.toDate ? h.response_date.toDate() : new Date(h.response_date)) : null;
            // 簡潔に YYYY/MM/DD HH:mm 形式にする
            let dateStr = '―';
            if (rDate) {
                const year = rDate.getFullYear();
                const month = String(rDate.getMonth() + 1).padStart(2, '0');
                const day = String(rDate.getDate()).padStart(2, '0');
                const hour = String(rDate.getHours()).padStart(2, '0');
                const minute = String(rDate.getMinutes()).padStart(2, '0');
                dateStr = `${year}/${month}/${day} ${hour}:${minute}`;
            }

            // 概要タブはダッシュボード。50文字で打ち切り。
            const truncatedContent = truncateText(h.content, 50);
            const contentHtml = truncatedContent
                ? `<div class="ov-history-content">${escapeHtml(truncatedContent)}</div>`
                : '';

            return `
                <div class="ov-history-item" data-id="${h.id}">
                    <div class="ov-history-meta">
                        <div class="ov-history-meta-left">
                            <span class="ov-history-date">${dateStr}</span>
                            <span class="ov-history-badge ${badgeClass}">${escapeHtml(h.history_type || 'その他')}</span>
                        </div>
                        <span class="ov-history-author">担当：${escapeHtml(h.created_by_name || '―')}</span>
                    </div>
                    <div class="ov-history-subject">${escapeHtml(h.subject || '')}</div>
                    ${contentHtml}
                </div>
            `;
        }).join('');

        // イベントバインド: 概要タブの履歴をクリックした際、履歴タブを開いて詳細を表示する
        container.querySelectorAll('.ov-history-item').forEach(item => {
            item.addEventListener('click', () => {
                const id = item.dataset.id;
                const found = histories.find(h => h.id === id);
                if (found) {
                    switchToTab('history');
                    selectHistory(found);
                }
            });
        });
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

        // 前回の警告をクリア
        clearPageWarning();

        // 1. 【根本解決】マスタデータのロード完了を保証する
        if (window.MasterDataManager) {
            try {
                await window.MasterDataManager.loadAll();
                licenseTypes = window.MasterDataManager.getLicenseTypes();
                staffMembers = window.MasterDataManager.getStaff();
                governmentOffices = window.MasterDataManager.getGovernmentOffices();
                console.log('[MasterLoaded]', staffMembers ? staffMembers.length : 0);
                initAdditionalDropdowns();
            } catch(e) {
                console.error("Master data load error", e);
            }
        }

        const tAllStart = performance.now();
        
        // Parallel Async Fetching
        const promises = [
            loadOffices(cId),
            loadContacts(cId),
            loadLicenses(cId),
            loadCases(cId),
            loadCustomerHistories(cId)
        ];

        if (includeBasicData) {
            promises.push(
                loadCustomerBasicData(cId)
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
        
        updateCustomerAlerts(cId);
        renderOverviewLists(cId);
        renderOverviewHistories(cId);

        // [バッジ即時反映のための追加]
        // 各データセクション（拠点リストなど）と基本情報（登記上所在地IDを含む）のロードは非同期かつ並列で走るため、
        // 拠点一覧のロード（loadOffices）の時点で顧客基本情報のロード（loadCustomerBasicData）が未完了の場合、
        // 登記上所在地バッジが描画されないタイミングが発生します。
        // そのため、全セクションの並列ロード（Promise.allSettled）がすべて完了したこの最終段階で、
        // 最新の顧客データと拠点データを用いて「登記上所在地」バッジを含む拠点一覧を確実に再描画します。
        renderOffices(cId);

        // [担当営業情報の確実な反映]
        // contacts/offices は並列ロードのため、loadCustomerBasicData 内の updateOverviewTab 呼び出し時点では
        // まだデータが揃っていない場合がある。全セクションのロード完了後に再度呼び出して担当営業情報を反映する。
        if (currentCustomer) {
            updateOverviewTab(currentCustomer);
        }


    }

    async function refreshCustomerUI(cId) {
        await loadAllSections(cId, { includeBasicData: true });
    }

    function updateScreenMode(mode) {
        const btnRefresh = document.getElementById('btn-refresh-cache');
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
            if (btnRefresh) btnRefresh.style.display = 'none';
            const nameDisp = document.getElementById('customer-name-display');
            if (nameDisp) nameDisp.textContent = '新規顧客';

            // 新規登録画面では顧客IDが存在せず集計対象がないため、サマリーを非表示とする。
            // ただし、将来的に新規作成直後の編集画面でも表示する可能性があるため、ハードコードせずupdateScreenModeで制御する。
            const summaryBar = document.getElementById('header-summary-bar');
            if (summaryBar) summaryBar.style.display = 'none';
            
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
            if (btnRefresh) btnRefresh.style.display = '';
            const summaryBar = document.getElementById('header-summary-bar');
            if (summaryBar) summaryBar.style.display = 'flex';
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
            console.log('[CustomerLoaded]', currentCustomer ? currentCustomer.primary_staff_id : null);
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
                .orderBy('last_updated', 'desc').startAfter(lastVisibleDoc.licenses).limit(20).get();
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
            // 重複追加を防ぐため、一旦最初の「未選択」オプション以外をクリアする
            while (staffSel.options.length > 1) {
                staffSel.remove(1);
            }
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

        window.setDateValueById('founded_date', c.founded_date);
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
                const officeName = getGovernmentOfficeName(c) || '-';

                tr.innerHTML = `
                    <td><span class="badge status-${getStatusKey(c?.status)}">${c?.status || '-'}</span></td>
                    <td>${formatDate(c?.contract_date)}</td>
                    <td>${officeName}</td>
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

    // ステータス判定用定数とヘルパー関数
    const CLOSED_OFFICE_STATUSES = ['閉鎖', 'inactive', '無効'];
    const RETIRED_CONTACT_STATUSES = ['退職', 'inactive', '無効'];

    function isOfficeClosed(office) {
        if (!office || !office.status) return false;
        return CLOSED_OFFICE_STATUSES.includes(office.status);
    }

    function isContactRetired(contact) {
        if (!contact || !contact.status) return false;
        return RETIRED_CONTACT_STATUSES.includes(contact.status);
    }

    // フィルタチェックボックスの初期化・イベントリスナー登録
    function initOrgFilterEvents(customerId) {
        const chkOffice = document.getElementById('chk-show-closed-offices');
        if (chkOffice) {
            if (!chkOffice.dataset.initialized) {
                const savedOfficeState = sessionStorage.getItem('lapis_show_closed_offices');
                if (savedOfficeState !== null) {
                    chkOffice.checked = (savedOfficeState === 'true');
                }
                chkOffice.dataset.initialized = 'true';
            }
            if (!chkOffice.dataset.bound) {
                chkOffice.dataset.bound = 'true';
                chkOffice.addEventListener('change', () => {
                    sessionStorage.setItem('lapis_show_closed_offices', chkOffice.checked ? 'true' : 'false');
                    renderOffices(customerId);
                });
            }
        }

        const chkContact = document.getElementById('chk-show-retired-contacts');
        if (chkContact) {
            if (!chkContact.dataset.initialized) {
                const savedContactState = sessionStorage.getItem('lapis_show_retired_contacts');
                if (savedContactState !== null) {
                    chkContact.checked = (savedContactState === 'true');
                }
                chkContact.dataset.initialized = 'true';
            }
            if (!chkContact.dataset.bound) {
                chkContact.dataset.bound = 'true';
                chkContact.addEventListener('change', () => {
                    sessionStorage.setItem('lapis_show_retired_contacts', chkContact.checked ? 'true' : 'false');
                    renderContacts(customerId);
                });
            }
        }
    }

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
        initOrgFilterEvents(customerId);

        const allRelated = offices.filter(o => Number(o.customer_id) === customerId);
        officesListBody.innerHTML = '';

        const chkOffice = document.getElementById('chk-show-closed-offices');
        const showClosed = chkOffice ? chkOffice.checked : false;
        const displayList = showClosed ? allRelated : allRelated.filter(o => !isOfficeClosed(o));

        // 件数表示（表示数/全拠点数件）
        const countEl = document.getElementById('offices-count');
        if (countEl) countEl.textContent = `（${displayList.length}/${allRelated.length}件）`;

        if (allRelated.length === 0) {
            officesListBody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:#999; font-style:italic; padding:20px;">拠点データがありません</td></tr>';
            return;
        }

        if (displayList.length === 0) {
            officesListBody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:#999; font-style:italic; padding:20px;">稼働中の拠点データがありません（『閉鎖拠点を含めて表示』をチェックすると表示されます）</td></tr>';
            return;
        }

        // 登記上所在地の office_id を取得
        const registeredOfficeId = currentCustomer ? currentCustomer.registered_office_id : null;

        // 規定表示順の自動ソート (1. 登記上所在地 -> 2. 稼働状態 -> 3. 拠点名昇順)
        displayList.sort((a, b) => {
            const regA = (registeredOfficeId && registeredOfficeId === a.office_id) ? 1 : 0;
            const regB = (registeredOfficeId && registeredOfficeId === b.office_id) ? 1 : 0;
            if (regA !== regB) return regB - regA;

            const closedA = isOfficeClosed(a) ? 1 : 0;
            const closedB = isOfficeClosed(b) ? 1 : 0;
            if (closedA !== closedB) return closedA - closedB;

            const nameA = a.office_name ?? '';
            const nameB = b.office_name ?? '';
            return nameA.localeCompare(nameB, 'ja');
        });

        displayList.forEach(o => {
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

        if (lastVisibleDoc.offices && displayList.length >= 20) {
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
        initOrgFilterEvents(customerId);

        const allCustomerContacts = contacts.filter(c => Number(c.customer_id) === customerId);

        // 拠点絞り込みの判定
        let scopeContacts = allCustomerContacts;
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
                // 拠点フィルタ適用
                scopeContacts = allCustomerContacts.filter(c => c.office_id === contactFilterOfficeId);
            } else {
                filterBar.innerHTML = '';
            }
        }

        // 退職者表示チェックボックスの判定
        const chkContact = document.getElementById('chk-show-retired-contacts');
        const showRetired = chkContact ? chkContact.checked : false;
        const displayList = showRetired ? scopeContacts : scopeContacts.filter(c => !isContactRetired(c));

        // 規定表示順の自動ソート (1. 主担当者 -> 2. 在籍状態 -> 3. 氏名昇順)
        displayList.sort((a, b) => {
            const primA = a.is_primary ? 1 : 0;
            const primB = b.is_primary ? 1 : 0;
            if (primA !== primB) return primB - primA;

            const retA = isContactRetired(a) ? 1 : 0;
            const retB = isContactRetired(b) ? 1 : 0;
            if (retA !== retB) return retA - retB;

            const nameA = a.contact_name ?? '';
            const nameB = b.contact_name ?? '';
            return nameA.localeCompare(nameB, 'ja');
        });

        // 件数表示（拠点選択中なら「表示数/選択拠点内全件数」、未選択なら「表示数/顧客内全件数」）
        const countEl = document.getElementById('contacts-count');
        if (countEl) {
            countEl.textContent = `（${displayList.length}/${scopeContacts.length}件）`;
        }

        contactsListBody.innerHTML = '';

        if (allCustomerContacts.length === 0) {
            contactsListBody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:#999; font-style:italic; padding:20px;">担当者データがありません</td></tr>';
            return;
        }

        if (contactFilterOfficeId !== null && scopeContacts.length === 0) {
            contactsListBody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:#999; font-style:italic; padding:20px;">この拠点に所属する担当者はいません</td></tr>';
            return;
        }

        if (displayList.length === 0) {
            contactsListBody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:#999; font-style:italic; padding:20px;">在職中の担当者データがありません（『退職者を含めて表示』をチェックすると表示されます）</td></tr>';
            return;
        }

        displayList.forEach(c => {
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

        if (lastVisibleDoc.contacts && displayList.length >= 20) {
            const tr = document.createElement('tr');
            tr.innerHTML = `<td colspan="6" style="text-align:center; padding:16px; background: transparent; border-bottom: none;"><button type="button" class="btn btn-load-more" onclick="window.loadMoreContacts(${customerId})">もっと見る</button></td>`;
            contactsListBody.appendChild(tr);
            if (window.lucide) lucide.createIcons();
        }
    }

    function getGovernmentOfficeName(entity) {
        if (!entity) return '';
        if (entity.government_office_id) {
            const office = governmentOffices.find(
                o => Number(o.office_id) === Number(entity.government_office_id)
            );
            if (office) {
                return office.office_name;
            }
        }
        return entity.government_office || '';
    }

    function renderLicenses(customerId) {
        if (!licensesListBody) return;
        const related = licenses.filter(l => Number(l.customer_id) === customerId);
        licensesListBody.innerHTML = '';

        if (related.length === 0) {
            licensesListBody.innerHTML = '<tr><td colspan="7" class="no-data-cell">許認可データがありません</td></tr>';
            return;
        }

        // --- ソート: 概要タブと統一（expiry_date ASC, 期限なし最後尾） ---
        // NOTE: 現在はクライアントサイドソート。全件取得後に並べ替えるため、
        // 「もっと見る」ページング（20件単位）で追加取得した場合も全体をソートする。
        // 将来的に1顧客あたりの許認可件数が大幅に増加した場合は、
        // Firestore側の orderBy('expiry_date', 'asc') + 複合インデックスへの移行を検討すること。
        const MAX_DATE = new Date('9999-12-31');
        const sorted = [...related].sort((a, b) => {
            const da = a.expiry_date ? (a.expiry_date.toDate ? a.expiry_date.toDate() : new Date(a.expiry_date)) : MAX_DATE;
            const db2 = b.expiry_date ? (b.expiry_date.toDate ? b.expiry_date.toDate() : new Date(b.expiry_date)) : MAX_DATE;
            return da - db2;
        });

        // --- 状態判定用の今日の日付 ---
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        sorted.forEach(l => {
            const type = licenseTypes.find(lt => lt.license_type_id === l.license_type_id);
            const typeName = type ? type.license_type_name : (l.license_type || '-');
            const licenseNum = typeof formatLicenseNumber === 'function' ? formatLicenseNumber(l) : (l.license_number || '-');
            const officeName = getGovernmentOfficeName(l) || '-';

            // 残り日数（期限まで）
            const days = calculateRemainingDays(l.expiry_date);
            const daysClass = getRemainingDaysClass(days);

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td style="font-weight: 600;">${typeName}</td>
                <td>${officeName}</td>
                <td>${licenseNum}</td>
                <td>${formatDate(l.start_date)}</td>
                <td>${formatDate(l.expiry_date)}</td>
                <td><span class="days-badge ${daysClass}">${formatRemainingDays(days)}</span></td>
                <td><span class="badge ${l.status === '有効' ? 'status-junin' : 'status-torisage'}">${l.status || '-'}</span></td>
            `;

            // --- 状態別行ハイライト ---
            // 優先順位: 期限切れ(赤) > 案内日到来(黄) > 通常(白)
            // 色は license_detail.html の action-danger / action-caution と同一体系
            const expDate = l.expiry_date ? (l.expiry_date.toDate ? l.expiry_date.toDate() : new Date(l.expiry_date)) : null;
            const notDate = l.notice_date ? (l.notice_date.toDate ? l.notice_date.toDate() : new Date(l.notice_date)) : null;

            if (expDate && expDate < today) {
                tr.classList.add('license-row-expired');
            } else if (notDate && notDate <= today) {
                tr.classList.add('license-row-notice');
            }

            tr.style.cursor = 'pointer';
            tr.addEventListener('click', () => {
                window.location.href = `license_detail.html?docId=${l._docId}&customer_id=${customerId}&id=${l.license_id}`;
            });
            licensesListBody.appendChild(tr);
        });

        if (lastVisibleDoc.licenses && related.length >= 20) {
            const tr = document.createElement('tr');
            tr.innerHTML = `<td colspan="7" style="text-align:center; padding:16px; background: transparent; border-bottom: none;"><button type="button" class="btn btn-load-more" onclick="window.loadMoreLicenses(${customerId})">もっと見る <i data-lucide="chevron-down"></i></button></td>`;
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

        // 検索用フィールドを自動生成（search_utils.js）
        updatedCustomer.search_name = generateSearchName(updatedCustomer.customer_name);
        updatedCustomer.search_kana = generateSearchKana(updatedCustomer.customer_kana);

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
        const staff = staffMembers.find(s => Number(s.staff_id) === Number(data.primary_staff_id));
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
        btnExportPdf.addEventListener('click', async () => {
            if (!currentCustomer) return;
            const originalHTML = btnExportPdf.innerHTML;
            try {
                btnExportPdf.disabled = true;
                btnExportPdf.textContent = '読み込み中...';
                await loadScript('https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js');
                btnExportPdf.textContent = '生成中...';
                const element = document.getElementById('print-template');
                element.innerHTML = buildPrintHTML(currentCustomer);
                element.style.display = 'block';
                await html2pdf(element, {
                    margin: 8,
                    filename: `顧客詳細_${currentCustomer.customer_name}_${new Date().toISOString().split('T')[0]}.pdf`,
                    image: { type: 'jpeg', quality: 0.98 },
                    html2canvas: { scale: 2 },
                    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
                });
                element.style.display = 'none';
            } catch (err) {
                console.error('PDF export failed:', err);
                alert('PDF出力に失敗しました: ' + err.message);
            } finally {
                btnExportPdf.disabled = false;
                btnExportPdf.innerHTML = originalHTML;
            }
        });
    }

    // ===== Excelエクスポート（ExcelJS + FileSaver.js） =====
    const exportModal = document.getElementById('export-excel-modal');
    const btnCloseExportModal = document.getElementById('btn-close-export-modal');
    const btnCancelExport = document.getElementById('btn-cancel-export');
    const btnConfirmExport = document.getElementById('btn-confirm-export');

    if (btnExportExcel && exportModal) {
        btnExportExcel.addEventListener('click', () => {
            if (!currentCustomer) return;
            exportModal.style.display = 'flex';
        });

        // モーダルを閉じる処理
        const closeExportModal = () => {
            exportModal.style.display = 'none';
        };
        btnCloseExportModal?.addEventListener('click', closeExportModal);
        btnCancelExport?.addEventListener('click', closeExportModal);

        btnConfirmExport?.addEventListener('click', async () => {
            const exportTypeInput = document.querySelector('input[name="export-type"]:checked');
            if (!exportTypeInput) return;
            const exportType = exportTypeInput.value;

            try {
                // UI無効化 & 2ステップ進捗表示開始 [1/2] データ取得中...
                btnConfirmExport.disabled = true;
                if (btnCancelExport) btnCancelExport.disabled = true;
                if (btnCloseExportModal) btnCloseExportModal.disabled = true;
                btnConfirmExport.textContent = ' [1/2] データを取得中...';

                // ライブラリ動的ロード
                await loadScript('https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js');

                const wb = new ExcelJS.Workbook();
                wb.creator = 'LAPIS3';

                // 顧客コード：Excel内とファイル名で同一の値を使用する
                const resolvedCode = currentCustomer.customer_code || `CUST-${currentCustomer.customer_id}`;
                const sanitizedCode = sanitizeFileName(resolvedCode);
                const sanitizedName = sanitizeFileName(currentCustomer.customer_name);
                const yyyymmdd = formatDateYYYYMMDD(new Date());

                let fileSuffix = '';
                
                // 共通変数
                const activeStaffName = getActiveStaffName();
                const nowStr = formatDateTime(new Date());

                if (exportType === 'customer_card') {
                    fileSuffix = '顧客カルテ';

                    // 1. 基本情報シート用のデータ配列
                    const staff = staffMembers.find(s => s.staff_id === currentCustomer.primary_staff_id);
                    const basicData = [[
                        currentCustomer.customer_id,
                        resolvedCode,
                        currentCustomer.customer_name || '-',
                        currentCustomer.customer_kana || '-',
                        currentCustomer.customer_type || '-',
                        currentCustomer.representative_name || '-',
                        currentCustomer.corporate_number || '-',
                        labelStatus(currentCustomer.status),
                        `${currentCustomer.fiscal_year_end_month || '-'}月 ${currentCustomer.fiscal_year_end_day || '-'}日`,
                        currentCustomer.postal_code || '-',
                        (currentCustomer.address || '') + (currentCustomer.building_name ? ' ' + currentCustomer.building_name : ''),
                        currentCustomer.phone || '-',
                        currentCustomer.fax || '-',
                        currentCustomer.email || '-',
                        staff ? staff.staff_name : '-',
                        currentCustomer.nenga || '-',
                        currentCustomer.chugen || '-',
                        currentCustomer.fax_ok || '-',
                        currentCustomer.remarks || '-',
                        '顧客カルテ',
                        nowStr,
                        activeStaffName
                    ]];

                    const basicHeaders = [
                        '顧客ID', '顧客コード', '顧客名', 'フリガナ', '顧客区分', '代表者名', '法人番号', '状態', '決算期', '郵便番号', '住所', '電話番号', 'FAX番号', 'メールアドレス', '外務担当者', '年賀状', '中元', 'FAX可否', '備考', '出力種別', '出力日時', '出力ユーザー'
                    ];

                    // 2. 許認可シート用のデータ配列 (全件出力)
                    const relatedLicenses = licenses.filter(l => l.customer_id === currentCustomer.customer_id);
                    const licenseHeaders = ['許認可名', '管轄官公庁', '許可番号', '開始日', '有効期限', '状態'];
                    const licenseRows = relatedLicenses.map(l => {
                        const type = licenseTypes.find(lt => lt.license_type_id === l.license_type_id);
                        return [
                            type ? type.license_type_name : '-',
                            l.jurisdiction || '-',
                            plainLicenseNumber(l) || '-',
                            plainDate(l.start_date) || '-',
                            plainDate(l.expiry_date) || '-',
                            labelStatus(l.status)
                        ];
                    });

                    // 3. 案件シート用のデータ配列 (直近20件)
                    const relatedCases = cases.filter(c => c.customer_id === currentCustomer.customer_id);
                    // 受任日降順でソート
                    relatedCases.sort((a, b) => {
                        const dateA = a.contract_date ? new Date(a.contract_date).getTime() : 0;
                        const dateB = b.contract_date ? new Date(b.contract_date).getTime() : 0;
                        return dateB - dateA;
                    });
                    const sliceCases = relatedCases.slice(0, 20);
                    const caseHeaders = ['案件名', '状態', '受任日', '完了日', '見積合計額'];
                    const caseRows = sliceCases.map(c => [
                        c.license_type || '-',
                        labelStatus(c.status),
                        plainDate(c.contract_date) || '-',
                        plainDate(c.completion_date) || '-',
                        c.estimated_total || 0
                    ]);

                    // 進捗更新 [2/2] Excelファイルを生成中...
                    btnConfirmExport.textContent = ' [2/2] Excelファイルを生成中...';

                    // シート書き出し (カルテ用4シート)
                    writeSimpleSheet(wb, '基本情報', basicHeaders, basicData);
                    writeSimpleSheet(wb, '許認可', licenseHeaders, licenseRows);
                    writeSimpleSheet(wb, '案件', caseHeaders, caseRows);
                    
                    const custOffices = offices.filter(o => Number(o.customer_id) === currentCustomer.customer_id);
                    const custContacts = contacts.filter(c => Number(c.customer_id) === currentCustomer.customer_id);
                    writeCombinedSheet(wb, '拠点・担当者', custOffices, custContacts);

                } else if (exportType === 'customer_archive') {
                    fileSuffix = '顧客履歴出力';

                    // Firestoreから並列データ取得 (Promise.all)
                    const [invoicesSnap, receiptsSnap, historiesSnap] = await Promise.all([
                        db.collection('invoices').where('customer_id', '==', currentCustomer.customer_id).get(),
                        db.collection('receipts').where('customer_id', '==', currentCustomer.customer_id).get(),
                        db.collection('customer_histories').where('customer_id', '==', currentCustomer.customer_id).where('deleted_at', '==', null).get()
                    ]);

                    // データ復元・構築
                    const archiveInvoices = invoicesSnap.docs.map(doc => doc.data());
                    const archiveReceipts = receiptsSnap.docs.map(doc => doc.data());
                    const archiveHistories = historiesSnap.docs.map(doc => doc.data());

                    // ソート処理
                    archiveInvoices.sort((a, b) => (b.invoice_date || '').localeCompare(a.invoice_date || ''));
                    archiveReceipts.sort((a, b) => (b.receiptDate || '').localeCompare(a.receiptDate || ''));
                    archiveHistories.sort((a, b) => {
                        const toMs = v => v ? (v.toDate ? v.toDate().getTime() : new Date(v).getTime()) : 0;
                        return toMs(b.response_date) - toMs(a.response_date);
                    });

                    // 1. 基本情報
                    const staff = staffMembers.find(s => s.staff_id === currentCustomer.primary_staff_id);
                    const basicData = [[
                        currentCustomer.customer_id,
                        resolvedCode,
                        currentCustomer.customer_name || '-',
                        currentCustomer.customer_kana || '-',
                        currentCustomer.customer_type || '-',
                        currentCustomer.representative_name || '-',
                        currentCustomer.corporate_number || '-',
                        labelStatus(currentCustomer.status),
                        `${currentCustomer.fiscal_year_end_month || '-'}月 ${currentCustomer.fiscal_year_end_day || '-'}日`,
                        currentCustomer.postal_code || '-',
                        (currentCustomer.address || '') + (currentCustomer.building_name ? ' ' + currentCustomer.building_name : ''),
                        currentCustomer.phone || '-',
                        currentCustomer.fax || '-',
                        currentCustomer.email || '-',
                        staff ? staff.staff_name : '-',
                        currentCustomer.nenga || '-',
                        currentCustomer.chugen || '-',
                        currentCustomer.fax_ok || '-',
                        currentCustomer.remarks || '-',
                        '顧客履歴出力',
                        nowStr,
                        activeStaffName
                    ]];
                    const basicHeaders = [
                        '顧客ID', '顧客コード', '顧客名', 'フリガナ', '顧客区分', '代表者名', '法人番号', '状態', '決算期', '郵便番号', '住所', '電話番号', 'FAX番号', 'メールアドレス', '外務担当者', '年賀状', '中元', 'FAX可否', '備考', '出力種別', '出力日時', '出力ユーザー'
                    ];

                    // 2. 許認可 (全件)
                    const relatedLicenses = licenses.filter(l => l.customer_id === currentCustomer.customer_id);
                    const licenseHeaders = ['許認可名', '管轄官公庁', '許可番号', '開始日', '有効期限', '状態'];
                    const licenseRows = relatedLicenses.map(l => {
                        const type = licenseTypes.find(lt => lt.license_type_id === l.license_type_id);
                        return [
                            type ? type.license_type_name : '-',
                            l.jurisdiction || '-',
                            plainLicenseNumber(l) || '-',
                            plainDate(l.start_date) || '-',
                            plainDate(l.expiry_date) || '-',
                            labelStatus(l.status)
                        ];
                    });

                    // 3. 案件 (制限なし全件)
                    const relatedCases = cases.filter(c => c.customer_id === currentCustomer.customer_id);
                    relatedCases.sort((a, b) => {
                        const dateA = a.contract_date ? new Date(a.contract_date).getTime() : 0;
                        const dateB = b.contract_date ? new Date(b.contract_date).getTime() : 0;
                        return dateB - dateA;
                    });
                    const caseHeaders = ['案件名', '状態', '受任日', '完了日', '見積合計額'];
                    const caseRows = relatedCases.map(c => [
                        c.license_type || '-',
                        labelStatus(c.status),
                        plainDate(c.contract_date) || '-',
                        plainDate(c.completion_date) || '-',
                        c.estimated_total || 0
                    ]);

                    // 4. 拠点
                    const custOffices = offices.filter(o => Number(o.customer_id) === currentCustomer.customer_id);
                    const officeHeaders = ['拠点名', '郵便番号', '住所', '電話番号'];
                    const officeRows = custOffices.map(o => [
                        o.office_name || '-',
                        o.postal_code || '-',
                        o.address || '-',
                        o.phone || '-'
                    ]);

                    // 5. 担当者
                    const custContacts = contacts.filter(c => Number(c.customer_id) === currentCustomer.customer_id);
                    const contactHeaders = ['氏名', '所属拠点', '役職', '電話番号', 'メールアドレス'];
                    const contactRows = custContacts.map(c => {
                        const officeName = custOffices.find(o => o.office_id === c.office_id)?.office_name || '―';
                        return [
                            c.contact_name || '-',
                            officeName,
                            c.title || '-',
                            c.phone || '-',
                            c.email || '-'
                        ];
                    });

                    // 6. 請求
                    const invoiceHeaders = ['請求日', '請求番号', '請求額', '入金消込額', '残高', '状態'];
                    const invoiceRows = archiveInvoices.map(inv => [
                        plainDate(inv.invoice_date) || '-',
                        inv.invoice_number || '-',
                        inv.total_amount || 0,
                        inv.allocatedAmount || 0,
                        inv.balance || 0,
                        labelStatus(inv.status)
                    ]);

                    // 7. 入金
                    const receiptHeaders = ['入金日', '振込人名', '入金金額', '未消込残高', '状態'];
                    const receiptRows = archiveReceipts.map(rec => [
                        plainDate(rec.receiptDate) || '-',
                        rec.payerName || '-',
                        rec.amount || 0,
                        rec.balance || 0,
                        labelStatus(rec.status)
                    ]);

                    // 8. 対応履歴
                    const historyHeaders = ['対応日時', '区分', '件名', '内容', '担当者'];
                    const historyRows = archiveHistories.map(h => {
                        const rDate = h.response_date ? (h.response_date.toDate ? h.response_date.toDate() : new Date(h.response_date)) : null;
                        const dateStr = rDate ? formatDateTime(rDate) : '―';
                        return [
                            dateStr,
                            h.history_type || '-',
                            h.subject || '-',
                            h.content || '-',
                            h.created_by_name || '-'
                        ];
                    });

                    // 進捗更新 [2/2] Excelファイルを生成中...
                    btnConfirmExport.textContent = ' [2/2] Excelファイルを生成中...';

                    // シート書き出し (履歴用8シート)
                    writeSimpleSheet(wb, '基本情報', basicHeaders, basicData);
                    writeSimpleSheet(wb, '許認可', licenseHeaders, licenseRows);
                    writeSimpleSheet(wb, '案件', caseHeaders, caseRows);
                    writeSimpleSheet(wb, '拠点', officeHeaders, officeRows);
                    writeSimpleSheet(wb, '担当者', contactHeaders, contactRows);
                    writeSimpleSheet(wb, '請求', invoiceHeaders, invoiceRows);
                    writeSimpleSheet(wb, '入金', receiptHeaders, receiptRows);
                    writeSimpleSheet(wb, '対応履歴', historyHeaders, historyRows);
                }

                // ===== ファイル保存 =====
                const buffer = await wb.xlsx.writeBuffer();
                const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
                saveAs(blob, `${sanitizedCode}_${sanitizedName}_${fileSuffix}_${yyyymmdd}.xlsx`);

                closeExportModal();

            } catch (err) {
                console.error('Excel export failed:', err);
                alert('Excelエクスポートに失敗しました: ' + err.message);
            } finally {
                // UI無効化解除
                btnConfirmExport.disabled = false;
                if (btnCancelExport) btnCancelExport.disabled = false;
                if (btnCloseExportModal) btnCloseExportModal.disabled = false;
                btnConfirmExport.textContent = 'ダウンロード開始';
            }
        });
    }

    // ===== ヘルパー関数定義 =====
    function sanitizeFileName(name) {
        return name ? name.replace(/[\\/:*?"<>|]/g, '_') : '―';
    }

    /**
     * Firestoreの内部状態値を実務向け日本語ラベルに変換する。
     * 未知の値はそのまま返す（データ損失を防ぐため）。
     */
    function labelStatus(val) {
        if (!val) return '-';
        const map = {
            'active':      '有効',
            'inactive':    '無効',
            'deleted':     '削除済み',
            'pending':     '保留',
            'completed':   '完了',
            'in_progress': '進行中',
            'cancelled':   'キャンセル',
            'expired':     '期限切れ',
            'suspended':   '停止中',
            'draft':       '下書き',
            'paid':        '入金済み',
            'unpaid':      '未入金',
            'partial':     '一部入金',
            'allocated':   '消込済み',
            'unallocated': '未消込',
        };
        return map[val] ?? val;
    }

    function formatDateYYYYMMDD(d) {
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}${month}${day}`;
    }

    function formatDateTime(d) {
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        const hour = String(d.getHours()).padStart(2, '0');
        const minute = String(d.getMinutes()).padStart(2, '0');
        return `${year}/${month}/${day} ${hour}:${minute}`;
    }

    function getActiveStaffName() {
        try {
            const sessionData = localStorage.getItem('lapis3_session');
            if (sessionData) {
                const session = JSON.parse(sessionData);
                if (session && session.staff_name) {
                    return session.staff_name;
                }
            }
        } catch (e) {
            console.warn('Failed to parse session info for export audit:', e);
        }
        return '―';
    }

    function writeSimpleSheet(wb, sheetName, headers, rows) {
        const ws = wb.addWorksheet(sheetName);
        
        // ヘッダー行 (1行目)
        const headerRow = ws.getRow(1);
        headerRow.values = headers;
        headerRow.height = 24;
        
        headers.forEach((_, i) => {
            const cell = headerRow.getCell(i + 1);
            cell.font = { name: 'BIZ UDPゴシック', size: 11, bold: true, color: { argb: 'FFFFFF' } };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '0F766E' } };
            cell.alignment = { vertical: 'middle', horizontal: 'center' };
            cell.border = {
                top: { style: 'thin', color: { argb: 'B0B8C4' } },
                left: { style: 'thin', color: { argb: 'B0B8C4' } },
                bottom: { style: 'thin', color: { argb: 'B0B8C4' } },
                right: { style: 'thin', color: { argb: 'B0B8C4' } }
            };
        });
        
        // データ行 (2行目以降)
        rows.forEach((rowData, rIdx) => {
            const row = ws.getRow(rIdx + 2);
            row.values = rowData;
            row.height = 20;
            
            rowData.forEach((_, cIdx) => {
                const cell = row.getCell(cIdx + 1);
                cell.font = { name: 'BIZ UDPゴシック', size: 11 };
                cell.border = {
                    top: { style: 'thin', color: { argb: 'B0B8C4' } },
                    left: { style: 'thin', color: { argb: 'B0B8C4' } },
                    bottom: { style: 'thin', color: { argb: 'B0B8C4' } },
                    right: { style: 'thin', color: { argb: 'B0B8C4' } }
                };
                cell.alignment = { vertical: 'middle', shrinkToFit: true };
            });
        });
        
        ws.columns = headers.map(h => {
            return { width: Math.max(12, h.length * 2.5 + 4) };
        });
    }

    function writeCombinedSheet(wb, sheetName, offices, contacts) {
        const ws = wb.addWorksheet(sheetName);
        let rowIdx = 1;
        
        const thinBorder = {
            top: { style: 'thin', color: { argb: 'B0B8C4' } },
            left: { style: 'thin', color: { argb: 'B0B8C4' } },
            bottom: { style: 'thin', color: { argb: 'B0B8C4' } },
            right: { style: 'thin', color: { argb: 'B0B8C4' } }
        };
        
        // === 拠点一覧 ===
        ws.mergeCells(`A${rowIdx}:E${rowIdx}`);
        const officeTitle = ws.getCell(`A${rowIdx}`);
        officeTitle.value = '■ 拠点一覧';
        officeTitle.font = { name: 'BIZ UDPゴシック', size: 12, bold: true, color: { argb: '0F766E' } };
        ws.getRow(rowIdx).height = 24;
        rowIdx++;
        
        const officeHeaders = ['拠点名', '郵便番号', '住所', '電話番号'];
        const officeHeaderRow = ws.getRow(rowIdx);
        officeHeaderRow.values = officeHeaders;
        officeHeaderRow.height = 22;
        officeHeaders.forEach((_, i) => {
            const cell = officeHeaderRow.getCell(i + 1);
            cell.font = { name: 'BIZ UDPゴシック', size: 11, bold: true, color: { argb: 'FFFFFF' } };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '0F766E' } };
            cell.alignment = { vertical: 'middle', horizontal: 'center' };
            cell.border = thinBorder;
        });
        rowIdx++;
        
        if (offices.length === 0) {
            ws.mergeCells(`A${rowIdx}:D${rowIdx}`);
            ws.getCell(`A${rowIdx}`).value = '登録なし';
            ws.getCell(`A${rowIdx}`).font = { name: 'BIZ UDPゴシック', size: 11, italic: true };
            ws.getCell(`A${rowIdx}`).alignment = { vertical: 'middle', horizontal: 'center' };
            ws.getCell(`A${rowIdx}`).border = thinBorder;
            ws.getRow(rowIdx).height = 20;
            rowIdx++;
        } else {
            offices.forEach(o => {
                const r = ws.getRow(rowIdx);
                r.values = [o.office_name || '-', o.postal_code || '-', o.address || '-', o.phone || '-'];
                r.height = 20;
                for (let i = 1; i <= 4; i++) {
                    const cell = r.getCell(i);
                    cell.font = { name: 'BIZ UDPゴシック', size: 11 };
                    cell.border = thinBorder;
                    cell.alignment = { vertical: 'middle', shrinkToFit: true };
                }
                rowIdx++;
            });
        }
        
        rowIdx += 2;
        
        // === 担当者一覧 ===
        ws.mergeCells(`A${rowIdx}:E${rowIdx}`);
        const contactTitle = ws.getCell(`A${rowIdx}`);
        contactTitle.value = '■ 担当者一覧';
        contactTitle.font = { name: 'BIZ UDPゴシック', size: 12, bold: true, color: { argb: '0F766E' } };
        ws.getRow(rowIdx).height = 24;
        rowIdx++;
        
        const contactHeaders = ['氏名', '所属拠点', '役職', '電話番号', 'メールアドレス'];
        const contactHeaderRow = ws.getRow(rowIdx);
        contactHeaderRow.values = contactHeaders;
        contactHeaderRow.height = 22;
        contactHeaders.forEach((_, i) => {
            const cell = contactHeaderRow.getCell(i + 1);
            cell.font = { name: 'BIZ UDPゴシック', size: 11, bold: true, color: { argb: 'FFFFFF' } };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '0F766E' } };
            cell.alignment = { vertical: 'middle', horizontal: 'center' };
            cell.border = thinBorder;
        });
        rowIdx++;
        
        if (contacts.length === 0) {
            ws.mergeCells(`A${rowIdx}:E${rowIdx}`);
            ws.getCell(`A${rowIdx}`).value = '登録なし';
            ws.getCell(`A${rowIdx}`).font = { name: 'BIZ UDPゴシック', size: 11, italic: true };
            ws.getCell(`A${rowIdx}`).alignment = { vertical: 'middle', horizontal: 'center' };
            ws.getCell(`A${rowIdx}`).border = thinBorder;
            ws.getRow(rowIdx).height = 20;
            rowIdx++;
        } else {
            contacts.forEach(c => {
                const officeName = offices.find(o => o.office_id === c.office_id)?.office_name || '―';
                const r = ws.getRow(rowIdx);
                r.values = [c.contact_name || '-', officeName, c.title || '-', c.phone || '-', c.email || '-'];
                r.height = 20;
                for (let i = 1; i <= 5; i++) {
                    const cell = r.getCell(i);
                    cell.font = { name: 'BIZ UDPゴシック', size: 11 };
                    cell.border = thinBorder;
                    cell.alignment = { vertical: 'middle', shrinkToFit: true };
                }
                rowIdx++;
            });
        }
        
        ws.columns = [
            { width: 18 },
            { width: 14 },
            { width: 30 },
            { width: 18 },
            { width: 25 },
        ];
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

        // 概要タブ切り替え時に、直近の対応履歴を自動で最新化する（UX改善）
        if (tabName === 'overview') {
            const customerId = document.getElementById('customer_id')?.value;
            if (customerId && customerId !== 'new') {
                renderOverviewHistories(Number(customerId));
            }
        }

        // 請求・売上タブ切り替え時に、請求一覧を遅延ロード（フェーズ1-A）
        if (tabName === 'billing') {
            const customerId = document.getElementById('customer_id')?.value;
            if (customerId && customerId !== 'new') {
                loadBillingTab(Number(customerId));
            }
        }
    }
    document.getElementById('btn-goto-basic')?.addEventListener('click', () => switchToTab('basic'));
    document.getElementById('btn-goto-basic-memo')?.addEventListener('click', () => switchToTab('basic'));
    document.getElementById('btn-goto-licenses')?.addEventListener('click', () => switchToTab('licenses'));
    document.getElementById('btn-goto-cases')?.addEventListener('click', () => switchToTab('projects'));
    document.getElementById('btn-goto-history')?.addEventListener('click', () => switchToTab('history'));

    // --- 請求書作成（顧客カルテから） ---
    document.getElementById('btn-create-invoice-from-customer')?.addEventListener('click', () => {
        const customerId = document.getElementById('customer_id')?.value;
        if (!customerId || customerId === 'new') {
            alert('顧客情報を保存してから請求書を作成してください。');
            return;
        }
        // Phase 1: URLパラメータによる遷移と復元
        const url = `invoice_detail.html?id=new&customerId=${customerId}&source=customer&returnCustomerId=${customerId}&returnTab=billing`;
        window.location.href = url;
    });


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
                    
                    window.setDateControlValue(periodEndInput, initialEndDate);
                    window.setDateControlValue(periodStartInput, calculateStartDate(initialEndDate));
                }

                if (!periodEndInput.dataset.listenerAttached) {
                    periodEndInput.addEventListener('change', (e) => {
                        window.setDateControlValue(periodStartInput, calculateStartDate(e.target.value));
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

        const previewWindow = window.ReportEngine.openPreviewWindow();
        if (!previewWindow) {
            alert('プレビュー画面を開けませんでした。ブラウザのポップアップブロック設定を確認してください。');
            return;
        }

        try {
            // Disable buttons
            if (btnPreviewReport) btnPreviewReport.disabled = true;
            if (btnPrintReport) btnPrintReport.disabled = true;
            let btnOriginalText = '';
            if (actionType === 'preview') {
                btnOriginalText = btnPreviewReport.textContent;
                btnPreviewReport.textContent = '読み込み中...';
            } else {
                btnOriginalText = btnPrintReport.textContent;
                btnPrintReport.textContent = '読み込み中...';
            }

            // 遅延ロード: pdf-lib + fontkit
            await Promise.all([
                loadScript('https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js'),
                loadScript('https://unpkg.com/@pdf-lib/fontkit@0.0.4/dist/fontkit.umd.min.js')
            ]);
            if (actionType === 'preview') {
                btnPreviewReport.textContent = '生成中...';
            } else {
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
            window.ReportEngine.previewPDF(pdfBytes, previewWindow);
            if (actionType === 'preview') {
                if (btnPreviewReport) btnPreviewReport.textContent = btnOriginalText;
            } else {
                if (reportModal) reportModal.style.display = 'none'; // Close modal
                if (btnPrintReport) btnPrintReport.textContent = btnOriginalText;
            }
        } catch (err) {
            console.error('Report Generation Error:', err);
            alert('帳票の生成に失敗しました: ' + err.message);
            window.ReportEngine.closePreviewWindow(previewWindow);
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

    // Redesigned DOM elements for national certificate types
    const chkNationalCertSono1 = document.getElementById('national_cert_sono1');
    const chkNationalCertSono2 = document.getElementById('national_cert_sono2');
    const chkNationalCertSono33 = document.getElementById('national_cert_sono33');
    const groupNationalSono1 = document.getElementById('group_national_sono1');
    const groupNationalSono2 = document.getElementById('group_national_sono2');
    const groupNationalSono33 = document.getElementById('group_national_sono33');

    const toggleNationalGroups = () => {
        if (groupNationalSono1) groupNationalSono1.style.display = (chkNationalCertSono1 && chkNationalCertSono1.checked) ? 'block' : 'none';
        if (groupNationalSono2) groupNationalSono2.style.display = (chkNationalCertSono2 && chkNationalCertSono2.checked) ? 'block' : 'none';
        if (groupNationalSono33) groupNationalSono33.style.display = (chkNationalCertSono33 && chkNationalCertSono33.checked) ? 'block' : 'none';
    };

    if (chkNationalCertSono1) chkNationalCertSono1.addEventListener('change', toggleNationalGroups);
    if (chkNationalCertSono2) chkNationalCertSono2.addEventListener('change', toggleNationalGroups);
    if (chkNationalCertSono33) chkNationalCertSono33.addEventListener('change', toggleNationalGroups);

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

            // Reset modal state
            if (chkNationalCertSono1) chkNationalCertSono1.checked = false;
            if (chkNationalCertSono2) chkNationalCertSono2.checked = false;
            if (chkNationalCertSono33) chkNationalCertSono33.checked = false;
            toggleNationalGroups();

            const resetCheckboxes = (ids) => {
                ids.forEach(id => {
                    const el = document.getElementById(id);
                    if (el) el.checked = false;
                });
            };

            const resetValues = (ids, val) => {
                ids.forEach(id => {
                    const el = document.getElementById(id);
                    if (el) el.value = val;
                });
            };

            resetCheckboxes([
                'national_sono1_tax_income', 'national_sono1_tax_corporate', 'national_sono1_tax_consumption',
                'national_sono2_tax_income', 'national_sono2_tax_corporate'
            ]);
            resetValues([
                'national_sono1_copies', 'national_sono2_copies', 'national_sono33_copies'
            ], '1');

            // 自動計算による期間のデフォルト初期設定
            const sono1Start = document.getElementById('national_sono1_period_start');
            const sono1End = document.getElementById('national_sono1_period_end');
            const sono2Start = document.getElementById('national_sono2_period_start');
            const sono2End = document.getElementById('national_sono2_period_end');

            function calculateStartDate(endDateStr) {
                if (!endDateStr) return '';
                const endDate = new Date(endDateStr);
                if (isNaN(endDate.getTime())) return '';
                const startDate = new Date(endDate);
                startDate.setFullYear(startDate.getFullYear() - 1);
                startDate.setDate(startDate.getDate() + 1);
                return Math.max(startDate.getFullYear(), 1900) + '-' + String(startDate.getMonth() + 1).padStart(2, '0') + '-' + String(startDate.getDate()).padStart(2, '0');
            }

            let initialEndDate = '';
            if (currentCustomer && currentCustomer.fiscal_year_end_month && currentCustomer.fiscal_year_end_day) {
                const today = new Date();
                today.setHours(0, 0, 0, 0);

                const m = parseInt(currentCustomer.fiscal_year_end_month, 10);
                const d = parseInt(currentCustomer.fiscal_year_end_day, 10);
                
                let candidateEndDate = new Date(today.getFullYear(), m - 1, d);
                if (candidateEndDate >= today) {
                    candidateEndDate.setFullYear(candidateEndDate.getFullYear() - 1);
                }
                
                const yStr = candidateEndDate.getFullYear();
                const mStr = String(candidateEndDate.getMonth() + 1).padStart(2, '0');
                const dStr = String(candidateEndDate.getDate()).padStart(2, '0');
                
                initialEndDate = `${yStr}-${mStr}-${dStr}`;
            } else {
                const today = new Date();
                initialEndDate = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
            }

            if (sono1Start && sono1End) {
                window.setDateControlValue(sono1End, initialEndDate);
                window.setDateControlValue(sono1Start, calculateStartDate(initialEndDate));
            }
            if (sono2Start && sono2End) {
                window.setDateControlValue(sono2End, initialEndDate);
                window.setDateControlValue(sono2Start, calculateStartDate(initialEndDate));
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

        // Validation - Types selection
        const isSono1 = chkNationalCertSono1 && chkNationalCertSono1.checked;
        const isSono2 = chkNationalCertSono2 && chkNationalCertSono2.checked;
        const isSono33 = chkNationalCertSono33 && chkNationalCertSono33.checked;

        if (!isSono1 && !isSono2 && !isSono33) {
            alert('その1・その2・その3の3のいずれかを選択してください。');
            return;
        }

        // Validation - Applicant
        const appType = selNationalApplicantType ? selNationalApplicantType.value : '本人';
        const staffId = selNationalReportStaff ? selNationalReportStaff.value : '';
        if (appType === '代理人' && !staffId) {
            alert('代理人の担当者を選択してください。');
            return;
        }

        // Validation - Group specific inputs
        if (isSono1) {
            const hasTax = document.getElementById('national_sono1_tax_income').checked ||
                           document.getElementById('national_sono1_tax_corporate').checked ||
                           document.getElementById('national_sono1_tax_consumption').checked;
            if (!hasTax) {
                alert('その1の税目を1つ以上選択してください。');
                return;
            }
            const start = document.getElementById('national_sono1_period_start').value;
            const end = document.getElementById('national_sono1_period_end').value;
            if (!start || !end) {
                alert('その1の開始日と終了日を入力してください。');
                return;
            }
            const copies = Number(document.getElementById('national_sono1_copies').value);
            if (isNaN(copies) || copies < 1) {
                alert('その1の枚数は1以上を入力してください。');
                return;
            }
        }

        if (isSono2) {
            const hasTax = document.getElementById('national_sono2_tax_income').checked ||
                           document.getElementById('national_sono2_tax_corporate').checked;
            if (!hasTax) {
                alert('その2の税目を1つ以上選択してください。');
                return;
            }
            const start = document.getElementById('national_sono2_period_start').value;
            const end = document.getElementById('national_sono2_period_end').value;
            if (!start || !end) {
                alert('その2の開始日と終了日を入力してください。');
                return;
            }
            const copies = Number(document.getElementById('national_sono2_copies').value);
            if (isNaN(copies) || copies < 1) {
                alert('その2の枚数は1以上を入力してください。');
                return;
            }
        }

        if (isSono33) {
            const copies = Number(document.getElementById('national_sono33_copies').value);
            if (isNaN(copies) || copies < 1) {
                alert('その3の3の枚数は1以上を入力してください。');
                return;
            }
        }

        const selectedStaff = staffMembers.find(s => String(s.staff_id) === String(staffId)) || null;

        const buildTaxesArray = (prefix, list) => {
            const result = [];
            list.forEach(t => {
                if (document.getElementById(`${prefix}_tax_${t}`).checked) {
                    result.push(t === 'income' ? '所得税' : t === 'corporate' ? '法人税' : '消費税');
                }
            });
            return result;
        };

        const formData = {
            certificateTypes: {
                sono1: {
                    enabled: isSono1,
                    taxes: isSono1 ? buildTaxesArray('national_sono1', ['income', 'corporate', 'consumption']) : [],
                    startDate: isSono1 ? document.getElementById('national_sono1_period_start').value : '',
                    endDate: isSono1 ? document.getElementById('national_sono1_period_end').value : '',
                    copies: isSono1 ? Number(document.getElementById('national_sono1_copies').value) : 0
                },
                sono2: {
                    enabled: isSono2,
                    taxes: isSono2 ? buildTaxesArray('national_sono2', ['income', 'corporate']) : [],
                    startDate: isSono2 ? document.getElementById('national_sono2_period_start').value : '',
                    endDate: isSono2 ? document.getElementById('national_sono2_period_end').value : '',
                    copies: isSono2 ? Number(document.getElementById('national_sono2_copies').value) : 0
                },
                sono33: {
                    enabled: isSono33,
                    copies: isSono33 ? Number(document.getElementById('national_sono33_copies').value) : 0
                }
            },
            purpose: document.getElementById('report_national_purpose') ? document.getElementById('report_national_purpose').value : '',
            applicantType: appType,
            staff: selectedStaff ? {
                name: selectedStaff.staff_name,
                kana: selectedStaff.staff_kana,
                tel: selectedStaff.phone,
                address: selectedStaff.address || ''
            } : null
        };

        const previewWindow = window.ReportEngine.openPreviewWindow();
        if (!previewWindow) {
            alert('プレビュー画面を開けませんでした。ブラウザのポップアップブロック設定を確認してください。');
            return;
        }

        try {
            if (btnPrintNationalReport) btnPrintNationalReport.disabled = true;
            let btnOriginalText = btnPrintNationalReport.textContent;
            btnPrintNationalReport.textContent = '読み込み中...';

            // 遅延ロード: pdf-lib + fontkit
            await Promise.all([
                loadScript('https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js'),
                loadScript('https://unpkg.com/@pdf-lib/fontkit@0.0.4/dist/fontkit.umd.min.js')
            ]);
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
            window.ReportEngine.previewPDF(pdfBytes, previewWindow);
            if(reportNationalModal) reportNationalModal.style.display = 'none'; // Close modal
            if (btnPrintNationalReport) btnPrintNationalReport.textContent = btnOriginalText;
            
        } catch (err) {
            console.error('Report Generation Error:', err);
            alert('国税帳票の生成に失敗しました: ' + err.message);
            window.ReportEngine.closePreviewWindow(previewWindow);
            if (btnPrintNationalReport) btnPrintNationalReport.textContent = '印刷（ダウンロード）';
        } finally {
            if (btnPrintNationalReport) btnPrintNationalReport.disabled = false;
        }
    }

    if (btnPrintNationalReport) {
        btnPrintNationalReport.addEventListener('click', () => handleNationalReportAction());
    }


    // =========================================================
    //  対応履歴（customer_histories）タブ用ロジック
    // =========================================================
    
    // --- History Tab State ---
    let histories = [];
    let filteredHistories = [];
    let selectedHistory = null;

    async function loadCustomerHistories(cId) {
        try {

            
            const customerId = Number(cId);
            if (Number.isNaN(customerId)) {
                throw new Error('customer_id must be a valid number');
            }
            
            // NOTE: orderBy('response_date') は customer_id + deleted_at との複合インデックスが必要。
            // インデックス未反映環境でのエラー回避のため、orderBy はクエリから除外し JS 側でソートする。
            // インデックス定義は firestore.indexes.json に記載済み（デプロイ後も動作は変わらない）。
            const snap = await db.collection('customer_histories')
                .where('customer_id', '==', customerId)
                .where('deleted_at', '==', null)
                .get();
            

            
            histories = snap.docs.map(doc => {
                const data = doc.data({ serverTimestamps: 'estimate' });

                return {
                    id: doc.id,
                    ...data
                };
            });

            // JS側で response_date 降順ソート（Firestore側 orderBy を除いたため）
            histories.sort((a, b) => {
                const toMs = v => v ? (v.toDate ? v.toDate().getTime() : new Date(v).getTime()) : 0;
                return toMs(b.response_date) - toMs(a.response_date);
            });


            
            applyHistoryFilters();
            renderOverviewHistories(customerId);
        } catch (err) {
            console.error('Failed to load customer histories:', err);
        }
    }

    function applyHistoryFilters() {
        const keyword = document.getElementById('history-search-keyword')?.value.trim().toLowerCase();
        const filterTypeAll = document.getElementById('filter-type-all')?.checked;
        const checkedTypes = Array.from(document.querySelectorAll('input[name="filter-type"]:checked')).map(cb => cb.value);
        const dateStartVal = document.getElementById('history-search-start')?.value;
        const dateEndVal = document.getElementById('history-search-end')?.value;

        filteredHistories = histories.filter(h => {
            // 1. 種別フィルタ (history_type 判定に加え history_category === 'document_return' も判定)
            if (!filterTypeAll && checkedTypes.length > 0) {
                const isDocReturnChecked = checkedTypes.includes('書類返却');
                const matchesType = checkedTypes.includes(h.history_type);
                const matchesCategory = isDocReturnChecked && (h.history_category === 'document_return' || h.history_type === '書類返却');
                if (!matchesType && !matchesCategory) return false;
            }
            
            // 2. キーワード検索（件名、内容。部分一致）
            if (keyword) {
                const subject = (h.subject || '').toLowerCase();
                const content = (h.content || '').toLowerCase();
                if (!subject.includes(keyword) && !content.includes(keyword)) return false;
            }

            // 3. 期間指定
            if (h.response_date) {
                const hDate = h.response_date.toDate ? h.response_date.toDate() : new Date(h.response_date);
                
                if (dateStartVal) {
                    const startLimit = new Date(dateStartVal);
                    startLimit.setHours(0, 0, 0, 0);
                    if (hDate < startLimit) return false;
                }
                
                if (dateEndVal) {
                    const endLimit = new Date(dateEndVal);
                    endLimit.setHours(23, 59, 59, 999);
                    if (hDate > endLimit) return false;
                }
            } else {
                if (dateStartVal || dateEndVal) return false;
            }

            return true;
        });

        renderHistories();
    }

    function renderHistories() {
        const container = document.getElementById('history-timeline-container');
        const countEl = document.getElementById('history-list-count');
        
        if (!container) {
            console.error('[CustomerDetail] renderHistories: container not found');
            return;
        }
        
        if (countEl) {
            countEl.textContent = `(${filteredHistories.length}件)`;
        }



        if (filteredHistories.length === 0) {
            container.innerHTML = '<div class="no-history-message">対応履歴はありません</div>';
            return;
        }

        container.innerHTML = filteredHistories.map(h => {
            let typeClass = 'type-color-other';
            let iconName = 'file-text';
            
            if (h.history_category === 'document_return' || h.history_type === '書類返却') {
                typeClass = 'type-color-document';
                iconName = 'package';
            } else if (h.history_type === '電話') {
                typeClass = 'type-color-phone';
                iconName = 'phone';
            } else if (h.history_type === 'メール') {
                typeClass = 'type-color-mail';
                iconName = 'mail';
            } else if (h.history_type === '訪問') {
                typeClass = 'type-color-visit';
                iconName = 'users';
            }
            
            const rDate = h.response_date ? (h.response_date.toDate ? h.response_date.toDate() : new Date(h.response_date)) : null;
            const dateStr = rDate ? formatHistoryDateTime(rDate) : '―';
            
            const activeClass = selectedHistory && selectedHistory.id === h.id ? 'active' : '';
            const excerpt = truncateText(h.content, 60);
            
            return `
                <div class="history-item ${activeClass}" data-id="${h.id}">
                    <div class="history-item-icon-wrapper">
                        <div class="history-type-icon ${typeClass}">
                            <i data-lucide="${iconName}" style="width: 18px; height: 18px;"></i>
                        </div>
                    </div>
                    <div class="history-item-content">
                        <div class="history-item-header">
                           <div class="history-item-date">${dateStr}</div>
                           <div class="history-item-author">${h.created_by_name || '―'}</div>
                        </div>
                        <div class="history-item-subject">${escapeHtml(h.subject || '')}</div>
                        <div class="history-item-excerpt">${escapeHtml(excerpt)}</div>
                    </div>
                </div>
            `;
        }).join('');

        if (typeof lucide !== 'undefined') {
            lucide.createIcons({ root: container });
        }



        container.querySelectorAll('.history-item').forEach(item => {
            item.addEventListener('click', () => {
                const id = item.dataset.id;
                const found = filteredHistories.find(h => h.id === id);
                if (found) {
                    selectHistory(found);
                }
            });
        });
    }

    function formatHistoryDateTime(d) {
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        const hour = String(d.getHours()).padStart(2, '0');
        const minute = String(d.getMinutes()).padStart(2, '0');
        const days = ['日', '月', '火', '水', '木', '金', '土'];
        const dayOfWeek = days[d.getDay()];
        return `${year}/${month}/${day} (${dayOfWeek}) ${hour}:${minute}`;
   }

   function escapeHtml(str) {
       return str
           .replace(/&/g, "&amp;")
           .replace(/</g, "&lt;")
           .replace(/>/g, "&gt;")
           .replace(/"/g, "&quot;")
           .replace(/'/g, "&#039;");
   }

   function selectHistory(h) {
       selectedHistory = h;
       
       const container = document.getElementById('history-timeline-container');
       if (container) {
           container.querySelectorAll('.history-item').forEach(item => {
               item.classList.toggle('active', item.dataset.id === h.id);
           });
       }

       const actionsEl = document.getElementById('history-detail-actions-container');
       if (actionsEl) actionsEl.style.display = 'flex';

       const detailContainer = document.getElementById('history-detail-container');
       if (!detailContainer) return;

       let typeClass = 'type-color-other';
       let iconName = 'file-text';
       if (h.history_type === '電話') {
           typeClass = 'type-color-phone';
           iconName = 'phone';
       } else if (h.history_type === 'メール') {
           typeClass = 'type-color-mail';
           iconName = 'mail';
       } else if (h.history_type === '訪問') {
           typeClass = 'type-color-visit';
           iconName = 'users';
       }

       const rDate = h.response_date ? (h.response_date.toDate ? h.response_date.toDate() : new Date(h.response_date)) : null;
       const dateStr = rDate ? formatHistoryDateTime(rDate) : '―';

       const nextActionDate = h.next_action_date ? (h.next_action_date.toDate ? h.next_action_date.toDate() : new Date(h.next_action_date)) : null;
       const nextActionStr = nextActionDate ? nextActionDate.toLocaleDateString('ja-JP') : '―';

       const cAt = h.created_at ? (h.created_at.toDate ? h.created_at.toDate() : new Date(h.created_at)) : null;
       const uAt = h.updated_at ? (h.updated_at.toDate ? h.updated_at.toDate() : new Date(h.updated_at)) : null;
       const cAtStr = cAt ? cAt.toLocaleString('ja-JP') : '―';
       const uAtStr = uAt ? uAt.toLocaleString('ja-JP') : '―';

       detailContainer.innerHTML = `
           <div class="detail-row">
               <div class="detail-label">対応日時</div>
               <div class="detail-value" style="font-weight: 600;">${dateStr}</div>
           </div>
           <div class="detail-row">
               <div class="detail-label">種別</div>
               <div class="detail-value">
                   <span class="detail-type-badge ${typeClass}">
                       <i data-lucide="${iconName}" style="width:14px; height:14px;"></i> ${h.history_type || 'その他'}
                   </span>
               </div>
           </div>
           <div class="detail-row">
               <div class="detail-label">件名</div>
               <div class="detail-value" style="font-weight: 600;">${escapeHtml(h.subject || '')}</div>
           </div>
           <div class="detail-row" style="flex-direction: column; gap: 8px;">
               <div class="detail-label">内容</div>
               <div class="detail-value-content">${escapeHtml(h.content || '')}</div>
           </div>
           <div class="detail-row" style="flex-direction: column; gap: 8px;">
               <div class="detail-label">備考</div>
               <div class="detail-value-content">${h.remarks ? escapeHtml(h.remarks).replace(/\n/g, '<br>') : '―'}</div>
           </div>
           <div class="detail-row">
               <div class="detail-label">次回対応予定日</div>
               <div class="detail-value">${nextActionStr}</div>
           </div>
           <div class="detail-row">
               <div class="detail-label">登録者</div>
               <div class="detail-value">${h.created_by_name || '―'}</div>
           </div>
           <div class="detail-row" style="font-size: 11pt; border-bottom: none; opacity: 0.7;">
               <div class="detail-label">作成日時</div>
               <div class="detail-value">${cAtStr}</div>
           </div>
           <div class="detail-row" style="font-size: 11pt; border-bottom: none; opacity: 0.7; padding-top: 0;">
               <div class="detail-label">最終更新</div>
               <div class="detail-value">${uAtStr}</div>
           </div>
       `;

       if (typeof lucide !== 'undefined') {
           lucide.createIcons({ root: detailContainer });
       }
   }

   function clearHistoryDetail() {
       selectedHistory = null;
       const actionsEl = document.getElementById('history-detail-actions-container');
       if (actionsEl) actionsEl.style.display = 'none';

       const detailContainer = document.getElementById('history-detail-container');
       if (detailContainer) {
           detailContainer.innerHTML = `
               <div class="select-history-placeholder">
                   一覧から対応履歴を選択してください。
               </div>
           `;
       }
   }

   function openHistoryModal(h = null) {
       const modal = document.getElementById('history-form-modal');
       const form = document.getElementById('history-modal-form');
       const titleEl = document.getElementById('history-modal-title');
       const editIdInput = document.getElementById('history-edit-id');
       
       if (!modal || !form) return;

       form.reset();

       if (h) {
           titleEl.textContent = '対応履歴を編集';
           editIdInput.value = h.id;
           
           const rDate = h.response_date ? (h.response_date.toDate ? h.response_date.toDate() : new Date(h.response_date)) : new Date();
           const yyyymmdd = rDate.getFullYear() + '-' + String(rDate.getMonth() + 1).padStart(2, '0') + '-' + String(rDate.getDate()).padStart(2, '0');
           const hhmm = String(rDate.getHours()).padStart(2, '0') + ':' + String(rDate.getMinutes()).padStart(2, '0');
           
           window.setDateValueById('history-input-date', yyyymmdd);
           document.getElementById('history-input-time').value = hhmm;

           const radio = form.querySelector(`input[name="history-type"][value="${h.history_type}"]`);
           if (radio) radio.checked = true;

           document.getElementById('history-input-subject').value = h.subject || '';
           document.getElementById('history-input-content').value = h.content || '';

           if (h.next_action_date) {
               const nDate = h.next_action_date.toDate ? h.next_action_date.toDate() : new Date(h.next_action_date);
               const nYmd = nDate.getFullYear() + '-' + String(nDate.getMonth() + 1).padStart(2, '0') + '-' + String(nDate.getDate()).padStart(2, '0');
               window.setDateValueById('history-input-next-action', nYmd);
           } else {
               window.setDateValueById('history-input-next-action', '');
           }
           
           document.getElementById('btn-confirm-history-save').textContent = '更新';
       } else {
           titleEl.textContent = '対応履歴を登録';
           editIdInput.value = '';

           const now = new Date();
           const yyyymmdd = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
           const hhmm = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
           
           window.setDateValueById('history-input-date', yyyymmdd);
           document.getElementById('history-input-time').value = hhmm;
           
           form.querySelector('input[name="history-type"][value="電話"]').checked = true;
           window.setDateValueById('history-input-next-action', '');
           document.getElementById('btn-confirm-history-save').textContent = '登録';
       }

       updateCounter('history-input-subject', 'history-subject-counter', 100);
       updateCounter('history-input-content', 'history-content-counter', 1000);

       modal.style.display = 'flex';
   }

   function closeHistoryModal() {
       const modal = document.getElementById('history-form-modal');
       if (modal) modal.style.display = 'none';
   }

   function updateCounter(inputId, counterId, max) {
       const input = document.getElementById(inputId);
       const counter = document.getElementById(counterId);
       if (input && counter) {
           const len = input.value.length;
           counter.textContent = `${len} / ${max}`;
           if (len > max) {
               counter.style.color = '#ef4444';
           } else {
               counter.style.color = '#94a3b8';
           }
       }
   }

   async function handleHistorySave(e) {
       e.preventDefault();

       const rawCId = document.getElementById('customer_id').value;
       if (!rawCId) {
           alert('顧客情報が特定できません。');
           return;
       }
        const cId = Number(rawCId);
        if (Number.isNaN(cId)) {
            alert('顧客IDが無効な数値です。数値型である必要があります。');
            return;
        }

       const editId = document.getElementById('history-edit-id').value;
       const dateVal = document.getElementById('history-input-date').value;
       const timeVal = document.getElementById('history-input-time').value;
       const typeVal = document.querySelector('input[name="history-type"]:checked').value;
       const subjectVal = document.getElementById('history-input-subject').value.trim();
       const contentVal = document.getElementById('history-input-content').value.trim();
       const nextActionVal = document.getElementById('history-input-next-action').value;

       if (!dateVal || !timeVal || !subjectVal || !contentVal) {
           alert('必須項目を入力してください。');
           return;
       }

       if (subjectVal.length > 100) {
           alert('件名は100文字以内で入力してください。');
           return;
       }

       if (contentVal.length > 1000) {
           alert('内容は1000文字以内で入力してください。');
           return;
       }

       const responseDate = new Date(`${dateVal}T${timeVal}`);
       if (isNaN(responseDate.getTime())) {
           alert('無効な対応日時です。');
           return;
       }

       let nextActionDate = null;
       if (nextActionVal) {
           nextActionDate = new Date(nextActionVal);
           if (isNaN(nextActionDate.getTime())) {
               alert('無効な次回対応予定日です。');
               return;
           }
       }

       const session = JSON.parse(localStorage.getItem('lapis3_session')) || {};
       if (!session.staff_id || !session.staff_name) {
           alert('セッション情報がありません。再度ログインしてください。');
           return;
       }

       const data = {
           customer_id: cId,
           history_type: typeVal,
           subject: subjectVal,
           content: contentVal,
           response_date: firebase.firestore.Timestamp.fromDate(responseDate),
           next_action_date: nextActionDate ? firebase.firestore.Timestamp.fromDate(nextActionDate) : null,
           deleted_at: null
       };

       try {
           if (editId) {
               await saveToFirestore('customer_histories', editId, data);
               showToast('対応履歴を更新しました', 'success');
           } else {
               const docRef = db.collection('customer_histories').doc();
               data.created_by_id = Number(session.staff_id);
               data.created_by_name = session.staff_name;
               data.created_at = firebase.firestore.FieldValue.serverTimestamp();
               
               await saveToFirestore('customer_histories', docRef.id, data);
               showToast('対応履歴を登録しました', 'success');
           }

           closeHistoryModal();
           await loadCustomerHistories(cId);
           
           const targetId = editId || (histories.length > 0 ? histories[0].id : null);
           if (targetId) {
               const target = histories.find(h => h.id === targetId);
               if (target) selectHistory(target);
           } else {
               clearHistoryDetail();
           }

       } catch (err) {
           console.error('Failed to save customer history:', err);
           alert('保存に失敗しました: ' + err.message);
       }
   }

   async function handleHistoryDelete() {
       if (!selectedHistory) return;
       if (!confirm('この対応履歴を削除しますか？（論理削除されます）')) return;

               const rawCId = document.getElementById('customer_id').value;
        const cId = Number(rawCId);
        if (Number.isNaN(cId)) {
            alert('顧客IDが無効な数値です。数値型である必要があります。');
            return;
        }
       
       try {
           const data = {
               deleted_at: firebase.firestore.FieldValue.serverTimestamp()
           };

           await saveToFirestore('customer_histories', selectedHistory.id, data);
           showToast('対応履歴を削除しました', 'success');

           clearHistoryDetail();
           await loadCustomerHistories(cId);
       } catch (err) {
           console.error('Failed to delete customer history:', err);
           alert('削除に失敗しました: ' + err.message);
       }
   }

   function initHistoryEvents() {
       document.getElementById('btn-open-history-modal')?.addEventListener('click', () => openHistoryModal());
       document.getElementById('btn-close-history-modal')?.addEventListener('click', closeHistoryModal);
       document.getElementById('btn-cancel-history-save')?.addEventListener('click', closeHistoryModal);
       document.getElementById('history-modal-form')?.addEventListener('submit', handleHistorySave);

       document.getElementById('history-input-subject')?.addEventListener('input', () => {
           updateCounter('history-input-subject', 'history-subject-counter', 100);
       });
       document.getElementById('history-input-content')?.addEventListener('input', () => {
           updateCounter('history-input-content', 'history-content-counter', 1000);
       });

       document.getElementById('history-search-keyword')?.addEventListener('input', applyHistoryFilters);

       const filterAll = document.getElementById('filter-type-all');
       const typeCheckboxes = document.querySelectorAll('input[name="filter-type"]');

       if (filterAll) {
           filterAll.addEventListener('change', (e) => {
               if (e.target.checked) {
                   typeCheckboxes.forEach(cb => cb.checked = false);
               }
               applyHistoryFilters();
           });
       }

       typeCheckboxes.forEach(cb => {
           cb.addEventListener('change', () => {
               if (cb.checked && filterAll) {
                   filterAll.checked = false;
               }
               const anyChecked = Array.from(typeCheckboxes).some(c => c.checked);
               if (!anyChecked && filterAll) {
                   filterAll.checked = true;
               }
               applyHistoryFilters();
           });
       });

       document.getElementById('history-search-start')?.addEventListener('change', applyHistoryFilters);
       document.getElementById('history-search-end')?.addEventListener('change', applyHistoryFilters);

       document.getElementById('btn-clear-history-search')?.addEventListener('click', () => {
           const kw = document.getElementById('history-search-keyword');
           if (kw) kw.value = '';

           const filterAll = document.getElementById('filter-type-all');
           if (filterAll) filterAll.checked = true;

           document.querySelectorAll('input[name="filter-type"]').forEach(cb => cb.checked = false);

           const ds = document.getElementById('history-search-start');
           const de = document.getElementById('history-search-end');
           
           if (ds) {
               window.setDateControlValue(ds, '');
           }
           if (de) {
               window.setDateControlValue(de, '');
           }

           applyHistoryFilters();
       });

       document.getElementById('btn-edit-history')?.addEventListener('click', () => {
           if (selectedHistory) openHistoryModal(selectedHistory);
       });
       
       document.getElementById('btn-delete-history-btn')?.addEventListener('click', handleHistoryDelete);
   }

    // =========================================================
    //  顧客カルテ概要票 PDF 出力ロジック
    // =========================================================
    async function handleExportSummaryPdf() {
        if (!currentCustomer) {
            alert('顧客データがロードされていません。先に保存するか画面を再読み込みしてください。');
            return;
        }

        const previewWindow = window.ReportEngine.openPreviewWindow();
        if (!previewWindow) {
            alert('プレビュー画面を開けませんでした。ブラウザのポップアップブロック設定を確認してください。');
            return;
        }

        const btn = document.getElementById('btn-export-summary-pdf');
        let originalHTML = '';
        if (btn) {
            originalHTML = btn.innerHTML;
            btn.disabled = true;
            btn.innerHTML = '<i data-lucide="loader" class="spin"></i> 処理中...';
            if (typeof lucide !== 'undefined') lucide.createIcons({ root: btn });
        }

        try {
            // 顧客概要票レポートオブジェクトを作成してPDF生成
            const dispData = resolveOverviewDisplayData(currentCustomer, contacts, offices, staffMembers);
            const report = new window.CustomerSummaryReport();
            await report.generate(currentCustomer, licenses, cases, histories, staffMembers, licenseTypes, dispData, governmentOffices);

            // プレビュー表示
            report.preview(previewWindow);
        } catch (err) {
            console.error('[ExportSummaryPDF] Failed to generate PDF report:', err);
            // エラー表示 (フォントロード失敗時などもここに集約される)
            alert('PDF出力に失敗しました: ' + err.message);
            window.ReportEngine.closePreviewWindow(previewWindow);
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = originalHTML;
                if (typeof lucide !== 'undefined') lucide.createIcons({ root: btn });
            }
        }
    }

    // イベント登録
    document.getElementById('btn-export-summary-pdf')?.addEventListener('click', handleExportSummaryPdf);

    // =========================================================
    //  宛名ラベル PDF 出力ロジック
    // =========================================================
    const ENCLOSURE_TYPES = [
        { code: '', label: 'なし' },
        { code: 'invoice', label: '請求書' },
        { code: 'estimate', label: '見積書' },
        { code: 'document', label: '資料' },
        { code: 'financial', label: '決算書' },
        { code: 'receipt_slip', label: '受付票' },
        { code: 'report_copy', label: '届出控え' },
        { code: 'application_copy', label: '申請控え' },
        { code: 'deposit_receipt', label: '預かり証' },
        { code: 'receipt', label: '領収書' },
        { code: 'original_docs', label: '社会保険等原本類' },
        { code: 'result_notice', label: '審査結果通知書' },
        { code: 'registry_copy', label: '登記申請控え' },
        { code: 'procedure_guide', label: 'お手続き準備のご案内' },
        { code: 'proxy', label: '委任状' },
        { code: 'other', label: 'その他' }
    ];

    const btnOpenAddressLabelModal = document.getElementById('btn-open-address-label-modal');
    const addressLabelModal = document.getElementById('address-label-modal');
    const btnCloseAddressLabelModal = document.getElementById('btn-close-address-label-modal');
    const btnPrintAddressLabel = document.getElementById('btn-print-address-label');
    const selLabelOffice = document.getElementById('label_office_select');
    const selLabelContact = document.getElementById('label_contact_select');
    const groupLabelOfficeSelect = document.getElementById('group_label_office_select');
    const groupLabelContactSelect = document.getElementById('group_label_contact_select');

    // 在中文言個別設定用UI要素
    const chkLabelEnclosureAllSame = document.getElementById('label_enclosure_all_same');
    const groupLabelEnclosureSingle = document.getElementById('group_label_enclosure_single');
    const groupLabelEnclosureMulti = document.getElementById('group_label_enclosure_multi');

    // 5つのプルダウンとその他の入力欄の定義
    const enclosureSelectIds = [
        { selectId: 'label_enclosure_select_1', otherGroupId: 'group_label_enclosure_other_1', otherInputId: 'label_enclosure_other_1' },
        { selectId: 'label_enclosure_select_1_multi', otherGroupId: 'group_label_enclosure_other_1_multi', otherInputId: 'label_enclosure_other_1_multi' },
        { selectId: 'label_enclosure_select_2', otherGroupId: 'group_label_enclosure_other_2', otherInputId: 'label_enclosure_other_2' },
        { selectId: 'label_enclosure_select_3', otherGroupId: 'group_label_enclosure_other_3', otherInputId: 'label_enclosure_other_3' },
        { selectId: 'label_enclosure_select_4', otherGroupId: 'group_label_enclosure_other_4', otherInputId: 'label_enclosure_other_4' }
    ];

    // 在中文言の初期構築
    enclosureSelectIds.forEach(item => {
        const el = document.getElementById(item.selectId);
        if (el) {
            el.innerHTML = '';
            ENCLOSURE_TYPES.forEach(enc => {
                const opt = document.createElement('option');
                opt.value = enc.code;
                opt.textContent = enc.label;
                el.appendChild(opt);
            });
        }
    });

    // 宛先種別による表示切り替え処理
    function toggleAddressTargetFields() {
        const checkedRadio = document.querySelector('input[name="addressTargetType"]:checked');
        if (!checkedRadio) return;
        const val = checkedRadio.value;

        if (val === '会社宛（御中）' || val === '会社宛（代表者）') {
            if (groupLabelOfficeSelect) groupLabelOfficeSelect.style.display = 'none';
            if (groupLabelContactSelect) groupLabelContactSelect.style.display = 'none';
        } else if (val === '営業所宛') {
            if (groupLabelOfficeSelect) groupLabelOfficeSelect.style.display = 'block';
            if (groupLabelContactSelect) groupLabelContactSelect.style.display = 'none';
        } else if (val === '担当者宛') {
            if (groupLabelOfficeSelect) groupLabelOfficeSelect.style.display = 'block';
            if (groupLabelContactSelect) groupLabelContactSelect.style.display = 'block';
        }
    }

    // 在中文言一括／個別トグル処理
    function toggleEnclosureSetup() {
        if (!chkLabelEnclosureAllSame) return;
        if (chkLabelEnclosureAllSame.checked) {
            if (groupLabelEnclosureSingle) groupLabelEnclosureSingle.style.display = 'block';
            if (groupLabelEnclosureMulti) groupLabelEnclosureMulti.style.display = 'none';
        } else {
            if (groupLabelEnclosureSingle) groupLabelEnclosureSingle.style.display = 'none';
            if (groupLabelEnclosureMulti) groupLabelEnclosureMulti.style.display = 'block';
        }
    }

    // 営業所・担当者プルダウンの更新
    function updateLabelOfficeDropdown() {
        if (!selLabelOffice) return;
        
        // 最初の (未選択) オプションを残してクリア
        while (selLabelOffice.options.length > 1) {
            selLabelOffice.remove(1);
        }

        console.log('[DEBUG_AUDIT_OFFICE] Generate office dropdown. offices length:', offices.length);
        console.log('[DEBUG_AUDIT_OFFICE] Loaded offices raw data: ' + JSON.stringify(offices.map(o => ({
            office_id: o.office_id,
            office_id_type: typeof o.office_id,
            office_name: o.office_name,
            status: o.status
        }))));

        // アクティブな営業所をソートして追加 ('active' も許容するように拡張)
        const activeOffices = offices
            .filter(o => o.status === '有効' || o.status === '稼働中' || o.status === 'active' || !o.status)
            .sort((a, b) => (a.office_id || 0) - (b.office_id || 0));

        console.log('[DEBUG_AUDIT_OFFICE] Filtered activeOffices raw data: ' + JSON.stringify(activeOffices.map(o => ({
            office_id: o.office_id,
            office_name: o.office_name
        }))));

        activeOffices.forEach(o => {
            const opt = document.createElement('option');
            opt.value = o.office_id;
            opt.textContent = o.office_name;
            selLabelOffice.appendChild(opt);
        });

        console.log('[DEBUG_AUDIT_OFFICE] Generated office option elements count:', selLabelOffice.options.length);
    }

    function updateLabelContactDropdown() {
        if (!selLabelContact || !selLabelOffice) return;

        // 最初の (未選択) オプションを残してクリア
        while (selLabelContact.options.length > 1) {
            selLabelContact.remove(1);
        }

        const selectedOfficeId = selLabelOffice.value;
        console.log('[DEBUG_AUDIT_CONTACT] updateLabelContactDropdown trigger.');
        console.log('[DEBUG_AUDIT_CONTACT] selectedOfficeId =', selectedOfficeId, 'type =', typeof selectedOfficeId);
        
        console.log('[DEBUG_AUDIT_CONTACT] All loaded contacts: ' + JSON.stringify(contacts.map(c => ({
            name: c.contact_name,
            office_id: c.office_id,
            office_id_type: typeof c.office_id,
            status: c.status
        }))));

        if (!selectedOfficeId) {
            console.log('[DEBUG_AUDIT_CONTACT] selectedOfficeId is empty, early return.');
            return;
        }

        // 選択された営業所に所属する在籍担当者を取得 ('退職' 以外のステータスを通すように安全側に倒す)
        const officeContacts = contacts
            .filter(c => String(c.office_id) === String(selectedOfficeId) && (c.status !== '退職' && c.status !== '非アクティブ'))
            .sort((a, b) => (a.contact_id || 0) - (b.contact_id || 0));

        console.log('[DEBUG_AUDIT_CONTACT] Filtered officeContacts: ' + JSON.stringify(officeContacts.map(c => ({
            name: c.contact_name,
            office_id: c.office_id,
            status: c.status
        }))));

        officeContacts.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c.contact_id;
            // 表示名に部署・役職を添えて分かりやすくする
            const deptPos = [c.department, c.position].filter(Boolean).join(' ');
            opt.textContent = c.contact_name + (deptPos ? ` (${deptPos})` : '');
            selLabelContact.appendChild(opt);
        });

        console.log('[DEBUG_AUDIT_CONTACT] Generated contact option elements count:', selLabelContact.options.length);
    }

    // イベント設定
    if (btnOpenAddressLabelModal) {
        btnOpenAddressLabelModal.addEventListener('click', () => {
            if (!currentCustomer) {
                alert('顧客データが保存されていません。先に保存してください。');
                return;
            }

            // 初期状態リセット
            const defaultRadio = document.querySelector('input[name="addressTargetType"][value="会社宛（御中）"]');
            if (defaultRadio) defaultRadio.checked = true;
            toggleAddressTargetFields();

            updateLabelOfficeDropdown();
            if (selLabelOffice) selLabelOffice.value = '';
            updateLabelContactDropdown();

            if (chkLabelEnclosureAllSame) chkLabelEnclosureAllSame.checked = true;
            toggleEnclosureSetup();

            enclosureSelectIds.forEach(item => {
                const el = document.getElementById(item.selectId);
                if (el) el.value = '';
                const grp = document.getElementById(item.otherGroupId);
                if (grp) grp.style.display = 'none';
                const inp = document.getElementById(item.otherInputId);
                if (inp) inp.value = '';
            });

            if (addressLabelModal) addressLabelModal.style.display = 'flex';
        });
    }

    if (btnCloseAddressLabelModal) {
        btnCloseAddressLabelModal.addEventListener('click', () => {
            if (addressLabelModal) addressLabelModal.style.display = 'none';
        });
    }

    document.querySelectorAll('input[name="addressTargetType"]').forEach(radio => {
        radio.addEventListener('change', toggleAddressTargetFields);
    });

    if (chkLabelEnclosureAllSame) {
        chkLabelEnclosureAllSame.addEventListener('change', toggleEnclosureSetup);
    }

    // 営業所選択プルダウンの change イベントをドキュメント全体に委譲 (DOM再構築時のイベント消失対策)
    document.addEventListener('change', (e) => {
        if (e.target && e.target.id === 'label_office_select') {
            updateLabelContactDropdown();
        }
    });

    // 各プルダウンのその他トグルのイベントリスナ登録
    enclosureSelectIds.forEach(item => {
        const el = document.getElementById(item.selectId);
        if (el) {
            el.addEventListener('change', (e) => {
                const grp = document.getElementById(item.otherGroupId);
                const inp = document.getElementById(item.otherInputId);
                if (e.target.value === 'other') {
                    if (grp) grp.style.display = 'block';
                } else {
                    if (grp) grp.style.display = 'none';
                    if (inp) inp.value = '';
                }
            });
        }
    });

    async function handlePrintAddressLabel() {
        console.log('[AddressLabel] handlePrintAddressLabel start');
        if (!currentCustomer) {
            console.warn('[AddressLabel] currentCustomer is null');
            return;
        }

        // 1. バリデーション
        const checkedRadio = document.querySelector('input[name="addressTargetType"]:checked');
        if (!checkedRadio) return;
        const targetType = checkedRadio.value;

        // 代表者名チェック
        if (targetType === '会社宛（代表者）') {
            if (!currentCustomer.representative_name || !currentCustomer.representative_name.trim()) {
                alert('代表者名が登録されていません');
                return;
            }
        }

        // 営業所・担当者チェック
        let selectedOffice = null;
        let selectedContact = null;

        if (targetType === '営業所宛' || targetType === '担当者宛') {
            const officeId = selLabelOffice ? selLabelOffice.value : '';
            if (!officeId) {
                alert('営業所を選択してください');
                return;
            }
            selectedOffice = offices.find(o => String(o.office_id) === String(officeId)) || null;
            if (!selectedOffice) {
                alert('選択された営業所データが見つかりません');
                return;
            }

            if (targetType === '担当者宛') {
                const contactId = selLabelContact ? selLabelContact.value : '';
                if (!contactId) {
                    alert('担当者を選択してください');
                    return;
                }
                selectedContact = contacts.find(c => String(c.contact_id) === String(contactId)) || null;
                if (!selectedContact) {
                    alert('選択された担当者データが見つかりません');
                    return;
                }
            }
        }

        // 在中文言の解決とバリデーション
        const enclosures = [];
        const isAllSame = chkLabelEnclosureAllSame ? chkLabelEnclosureAllSame.checked : true;

        if (isAllSame) {
            // 一括設定
            const selEl = document.getElementById('label_enclosure_select_1');
            const code = selEl ? selEl.value : '';
            let text = '';
            if (code === 'other') {
                const inpEl = document.getElementById('label_enclosure_other_1');
                const otherVal = inpEl ? inpEl.value.trim() : '';
                if (!otherVal) {
                    alert('在中文言を入力してください');
                    return;
                }
                text = otherVal;
            } else {
                const item = ENCLOSURE_TYPES.find(x => x.code === code);
                text = item ? item.label : 'なし';
            }
            // 4面すべて同じ値で複製
            for (let i = 0; i < 4; i++) {
                enclosures.push({ code, text });
            }
        } else {
            // 個別設定 (4面別々)
            const targets = [
                { selectId: 'label_enclosure_select_1_multi', otherId: 'label_enclosure_other_1_multi', labelName: 'ラベル①' },
                { selectId: 'label_enclosure_select_2', otherId: 'label_enclosure_other_2', labelName: 'ラベル②' },
                { selectId: 'label_enclosure_select_3', otherId: 'label_enclosure_other_3', labelName: 'ラベル③' },
                { selectId: 'label_enclosure_select_4', otherId: 'label_enclosure_other_4', labelName: 'ラベル④' }
            ];
            for (const tgt of targets) {
                const selEl = document.getElementById(tgt.selectId);
                const code = selEl ? selEl.value : '';
                let text = '';
                if (code === 'other') {
                    const inpEl = document.getElementById(tgt.otherId);
                    const otherVal = inpEl ? inpEl.value.trim() : '';
                    if (!otherVal) {
                        alert(`${tgt.labelName}の在中文言を入力してください`);
                        return;
                    }
                    text = otherVal;
                } else {
                    const item = ENCLOSURE_TYPES.find(x => x.code === code);
                    text = item ? item.label : 'なし';
                }
                enclosures.push({ code, text });
            }
        }

        // 2. 宛名用データオブジェクト構築 (将来の面ごと個別宛先拡張を見据えたデータ構造)
        const baseLabel = {
            targetType: targetType,
            customerName: currentCustomer.customer_name || '',
            postalCode: '',
            address: '',
            phone: '',
            officeName: '',
            contactName: '',
            department: '',
            position: '',
            representativeName: ''
        };

        if (targetType === '会社宛（御中）' || targetType === '会社宛（代表者）') {
            baseLabel.postalCode = currentCustomer.postal_code || '';
            const bld = currentCustomer.building_name ? ` ${currentCustomer.building_name}` : '';
            baseLabel.address = (currentCustomer.address || '') + bld;
            baseLabel.phone = currentCustomer.phone || '';
            if (targetType === '会社宛（代表者）') {
                baseLabel.representativeName = currentCustomer.representative_name || '';
            }
        } else if (targetType === '営業所宛') {
            baseLabel.officeName = selectedOffice.office_name || '';
            baseLabel.postalCode = selectedOffice.postal_code || currentCustomer.postal_code || '';
            
            const bld = selectedOffice.building_name ? ` ${selectedOffice.building_name}` : '';
            const officeAddr = (selectedOffice.address || '') + bld;
            const mainBld = currentCustomer.building_name ? ` ${currentCustomer.building_name}` : '';
            const mainAddr = (currentCustomer.address || '') + mainBld;
            baseLabel.address = officeAddr || mainAddr;

            baseLabel.phone = selectedOffice.phone || currentCustomer.phone || '';
        } else if (targetType === '担当者宛') {
            baseLabel.officeName = selectedOffice.office_name || '';
            baseLabel.postalCode = selectedOffice.postal_code || currentCustomer.postal_code || '';

            const bld = selectedOffice.building_name ? ` ${selectedOffice.building_name}` : '';
            const officeAddr = (selectedOffice.address || '') + bld;
            const mainBld = currentCustomer.building_name ? ` ${currentCustomer.building_name}` : '';
            const mainAddr = (currentCustomer.address || '') + mainBld;
            baseLabel.address = officeAddr || mainAddr;

            baseLabel.phone = selectedOffice.phone || currentCustomer.phone || '';
            
            baseLabel.contactName = selectedContact.contact_name || '';
            baseLabel.department = selectedContact.department || '';
            // 役職名は contacts コレクションでは title に格納されているため、title を優先的に position へ詰める
            baseLabel.position = selectedContact.title || selectedContact.position || '';
        }

        const labels = [];
        for (let i = 0; i < 4; i++) {
            labels.push({
                ...baseLabel,
                enclosure: enclosures[i] || { code: '', text: 'なし' }
            });
        }

        const pdfData = {
            labels: labels
        };

        console.log('[AddressLabel] pdfData resolved:', JSON.stringify(pdfData));

        // 3. プレビューウィンドウの事前起動 (ポップアップブロック対策)
        const previewWindow = window.ReportEngine.openPreviewWindow();
        if (!previewWindow) {
            alert('プレビュー画面を開けませんでした。ブラウザのポップアップブロック設定を確認してください。');
            return;
        }

        const originalBtnHTML = btnPrintAddressLabel.innerHTML;
        try {
            btnPrintAddressLabel.disabled = true;
            btnPrintAddressLabel.innerHTML = '<i data-lucide="loader" class="spin"></i> 生成中...';
            if (typeof lucide !== 'undefined') lucide.createIcons({ root: btnPrintAddressLabel });

            // 4. PDF生成
            const report = new window.AddressLabelReport();
            await report.generate(pdfData);

            // 5. プレビュー表示
            report.preview(previewWindow);
        } catch (err) {
            console.error('[ExportAddressLabelPDF] Failed to generate address label PDF:', err);
            alert('PDF出力に失敗しました: ' + err.message);
            window.ReportEngine.closePreviewWindow(previewWindow);
        } finally {
            btnPrintAddressLabel.disabled = false;
            btnPrintAddressLabel.innerHTML = originalBtnHTML;
            if (typeof lucide !== 'undefined') lucide.createIcons({ root: btnPrintAddressLabel });
        }
    }

    if (btnPrintAddressLabel) {
        btnPrintAddressLabel.addEventListener('click', handlePrintAddressLabel);
    }

    // ─────────────────────────────────────────────────────────
    // 請求・売上タブ 関連ロジック (フェーズ1-A)
    // ─────────────────────────────────────────────────────────
    function normalizeStatus(status) {
        return String(status || '').trim().toLowerCase();
    }

    const KPI_EXCLUDED_STATUSES = ['cancelled', 'draft', '下書き'];

    async function loadBillingTab(cId) {
        if (!cId || isNaN(cId)) return;
        const listBody = document.getElementById('customer-billing-list-body');
        if (!listBody) return;

        // 1. キャッシュが存在し、有効な場合はキャッシュから描画
        if (billingCacheMap[cId]) {
            console.log(`[BillingCache] Hit cache for customerId: ${cId}`);
            renderBillingUI(billingCacheMap[cId].invoices);
            return;
        }

        // 2. キャッシュがない場合はローディング表示を行い、Firestoreから取得
        listBody.innerHTML = `
            <tr>
                <td colspan="6" style="text-align: center; padding: 24px; color: #64748b;">
                    <div style="display: inline-flex; align-items: center; gap: 8px;">
                        <span class="spinner" style="display: inline-block; width: 16px; height: 16px; border: 2px solid #cbd5e1; border-top-color: #3b82f6; border-radius: 50%; animation: spin 1s linear infinite;"></span>
                        データを読み込み中...
                    </div>
                </td>
            </tr>
        `;

        try {
            const querySnap = await db.collection('invoices')
                .where('customer_id', '==', cId)
                .get();

            const invoices = querySnap.docs.map(doc => ({
                doc_id: doc.id,
                ...doc.data()
            }));

            // ソート処理（日付降順 ➔ 作成日時降順 ➔ 請求番号降順）
            invoices.sort((a, b) => {
                const dateCompare = (b.invoice_date || '').localeCompare(a.invoice_date || '');
                if (dateCompare !== 0) return dateCompare;

                const timeA = a.created_date && typeof a.created_date.toDate === 'function'
                    ? a.created_date.toDate().getTime()
                    : 0;
                const timeB = b.created_date && typeof b.created_date.toDate === 'function'
                    ? b.created_date.toDate().getTime()
                    : 0;
                if (timeA !== timeB) return timeB - timeA;

                return (b.invoice_number || '').localeCompare(a.invoice_number || '');
            });

            // キャッシュに保存
            billingCacheMap[cId] = {
                loadedAt: Date.now(),
                invoices: invoices
            };

            renderBillingUI(invoices);
        } catch (err) {
            console.error('[Billing] Failed to load invoices:', err);
            listBody.innerHTML = `
                <tr>
                    <td colspan="6" style="text-align: center; padding: 24px; color: #ef4444; font-weight: 500;">
                        請求データの取得に失敗しました
                    </td>
                </tr>
            `;
        }
    }

    function renderBillingUI(invoices) {
        const listBody = document.getElementById('customer-billing-list-body');
        if (!listBody) return;

        listBody.innerHTML = '';

        if (!invoices || invoices.length === 0) {
            listBody.innerHTML = `
                <tr>
                    <td colspan="6" style="text-align: center; padding: 24px; color: #94a3b8;">
                        請求データはありません
                    </td>
                </tr>
            `;
            return;
        }

        invoices.forEach(inv => {
            const tr = document.createElement('tr');

            // 取消 (cancelled) の場合はグレーアウト
            const isCancelled = normalizeStatus(inv.status) === 'cancelled';
            if (isCancelled) {
                tr.style.opacity = '0.6';
                tr.style.background = '#f8fafc';
            }

            // 未収あり (balance > 0) かつ 取消以外の場合、薄い赤背景で強調
            const hasBalance = (inv.balance || 0) > 0 && !isCancelled;
            if (hasBalance) {
                tr.style.backgroundColor = 'rgba(239, 68, 68, 0.04)';
            }

            const balanceColor = hasBalance ? '#dc2626' : '#64748b';
            const balanceWeight = hasBalance ? 'bold' : 'normal';

            // ステータスバッジのCSSクラス決定
            const statusClass = typeof window.getInvoiceStatusClass === 'function' 
                ? window.getInvoiceStatusClass(inv.status) 
                : 'status-draft';

            tr.innerHTML = `
                <td><strong>${inv.invoice_number || 'ー'}</strong></td>
                <td>${formatDate(inv.invoice_date)}</td>
                <td style="text-align: right; font-weight: 600;">${formatCurrency(inv.total_amount)}</td>
                <td style="text-align: right; color: #059669;">${formatCurrency(inv.allocatedAmount || 0)}</td>
                <td style="text-align: right; color: ${balanceColor}; font-weight: ${balanceWeight};">${formatCurrency(inv.balance)}</td>
                <td style="text-align: center;"><span class="badge ${statusClass}">${inv.status || 'ー'}</span></td>
            `;
            listBody.appendChild(tr);
        });
    }

    // イベント登録（手動更新 ＆ タブクリックによる遅延ロード）
    document.getElementById('btn-refresh-billing')?.addEventListener('click', () => {
        const cId = document.getElementById('customer_id')?.value;
        if (cId && cId !== 'new') {
            console.log(`[BillingCache] Clearing cache for customerId: ${cId}`);
            delete billingCacheMap[Number(cId)];
            loadBillingTab(Number(cId));
        }
    });

    document.querySelectorAll('.tab-btn').forEach(button => {
        button.addEventListener('click', () => {
            const tabId = button.getAttribute('data-tab');
            if (tabId === 'billing') {
                const cId = document.getElementById('customer_id')?.value;
                if (cId && cId !== 'new') {
                    loadBillingTab(Number(cId));
                }
            }
        });
    });

     await init();
});
