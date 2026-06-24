document.addEventListener('DOMContentLoaded', async () => {
    const tPageStart = performance.now();
    console.log('License Detail: Phase 1 (Sync UI) starting...');
    const DPH = window.DetailPageHelper;

    // --- Selectors ---
    const pageTitle = document.getElementById('page-title');
    const licenseEditTitle = document.getElementById('license-edit-title');
    const customerSearchGroup = document.getElementById('customer-search-group');
    const customerSearch = document.getElementById('customer-search');
    const btnSearchCustomer = document.getElementById('btn-search-customer');
    const customerSearchResults = document.getElementById('customer-search-results');
    const customerId = document.getElementById('customer-id');
    const licenseTypeId = document.getElementById('license-type-id');
    const licenseNumber1 = document.getElementById('license-number-1');
    const licenseNumber2 = document.getElementById('license-number-2');
    const status = document.getElementById('status');
    const startDate = document.getElementById('start-date');
    const expiryDate = document.getElementById('expiry-date');
    const noticeDate = document.getElementById('notice-date');
    const historyBody = document.getElementById('history-body');
    const changeType = document.getElementById('change-type');
    const changedBy = document.getElementById('changed-by');
    const comment = document.getElementById('comment');
    const remarks = document.getElementById('remarks');
    const createdDateDisplay = document.getElementById('created-date');
    const lastUpdatedDisplay = document.getElementById('last-updated');
    const btnBack = document.getElementById('btn-back');
    const btnSave = document.getElementById('btn-save');
    const btnDelete = document.getElementById('btn-delete');
    const btnAddHistory = document.getElementById('btn-add-history');

    // New UI selectors
    const licenseStatusHeader = document.getElementById('license-status-header');
    const headerTitle = document.getElementById('header-title');
    const headerBadge = document.getElementById('header-badge');
    const headerExpiryInfo = document.getElementById('header-expiry-info');
    const headerLastHistory = document.getElementById('header-last-history');
    const remainingDaysBadge = document.getElementById('remaining-days-badge');
    const noticeDaysBadge = document.getElementById('notice-days-badge');
    const nextActionBox = document.getElementById('next-action');
    const nextActionText = document.getElementById('next-action-text');
    const stickyBar = document.getElementById('sticky-action-bar');
    const stickyBtnSave = document.getElementById('sticky-btn-save');
    const stickyBtnDelete = document.getElementById('sticky-btn-delete');
    const topActionBar = document.getElementById('top-action-bar');
    const newModeGuide = document.getElementById('new-mode-guide');

    // Autocomplete Selectors
    const governmentOfficeSearch = document.getElementById('government-office-search');
    const governmentOfficeId = document.getElementById('government-office-id');
    const autocompleteList = document.getElementById('office-autocomplete-list');

    // --- State ---
    let currentId = null;
    let licenseTypes = [];
    let staffMembers = [];
    let licenseHistory = [];
    let governmentOffices = [];
    let currentLicense = null;
    let fromCustomerId = null;
    let isDirty = false;
    let initialSnapshot = '';

    // --- Pure Functions ---
    function getUrlParameter(name) {
        return new URLSearchParams(window.location.search).get(name);
    }

    function calculateRemainingDays(target) {
        if (!target) return null;
        const d = new Date(target); d.setHours(0, 0, 0, 0);
        const today = new Date(); today.setHours(0, 0, 0, 0);
        return Math.ceil((d - today) / (1000 * 60 * 60 * 24));
    }

    function formatDays(days) {
        if (days === null) return 'ー';
        if (days < 0) return `${Math.abs(days)}日超過`;
        return `${days}日`;
    }

    function combineLicenseNumber(n1, n2) {
        if (n1 && n2) return `${n1}-${n2}`;
        return n1 || n2 || '';
    }

    function getExpiryBadgeClass(days) {
        if (days === null) return 'badge-none';
        if (days < 0) return 'badge-expired';
        if (days <= 30) return 'badge-danger';
        if (days <= 90) return 'badge-caution';
        return 'badge-safe';
    }

    function getHeaderStatusClass(days) {
        if (days === null) return 'status-safe';
        if (days < 0) return 'status-expired';
        if (days <= 30) return 'status-danger';
        if (days <= 90) return 'status-caution';
        return 'status-safe';
    }

    // --- Display Updates ---
    function updateDisplay() {
        const rem = calculateRemainingDays(expiryDate.value);
        const not = calculateRemainingDays(noticeDate.value);

        // Expiry Badges
        if (remainingDaysBadge) {
            remainingDaysBadge.textContent = `残り日数：${formatDays(rem)}`;
            remainingDaysBadge.className = `expiry-badge ${getExpiryBadgeClass(rem)}`;
        }
        if (noticeDaysBadge) {
            noticeDaysBadge.textContent = `案内まで：${formatDays(not)}`;
            noticeDaysBadge.className = `expiry-badge ${not !== null && not <= 0 ? 'badge-caution' : 'badge-none'}`;
        }

        // Update header if in edit mode
        if (currentId && currentId !== 'new') {
            renderLicenseHeader();
            renderNextAction(rem, not);
        }
    }

    function renderLicenseHeader() {
        if (!licenseStatusHeader) return;
        const typeName = licenseTypes.find(t => t.license_type_id === parseInt(licenseTypeId.value))?.license_type_name || '';
        const num = combineLicenseNumber(licenseNumber1.value, licenseNumber2.value);
        const titleText = [typeName, num].filter(Boolean).join('｜');
        if (headerTitle) headerTitle.textContent = titleText || 'ー';

        // Status badge
        const st = status.value;
        if (headerBadge) {
            headerBadge.textContent = st;
            headerBadge.className = 'license-header-badge ' +
                (st === '有効' ? 'badge-active' : st === '失効' ? 'badge-expired-status' : 'badge-cancelled');
        }

        // Expiry info line
        const rem = calculateRemainingDays(expiryDate.value);
        if (headerExpiryInfo) {
            const parts = [];
            if (expiryDate.value) parts.push(`満了：${expiryDate.value}`);
            if (rem !== null) parts.push(`残り${formatDays(rem)}`);
            const not = calculateRemainingDays(noticeDate.value);
            if (not !== null) parts.push(`案内まで${formatDays(not)}`);
            headerExpiryInfo.textContent = parts.join('　');
        }

        // Header color
        licenseStatusHeader.className = `license-header ${getHeaderStatusClass(rem)}`;

        // Last history
        renderHeaderLastHistory();
        licenseStatusHeader.style.display = 'block';
    }

    function renderHeaderLastHistory() {
        if (!headerLastHistory) return;
        const lId = parseInt(currentId);
        const sorted = licenseHistory
            .filter(h => h.license_id === lId)
            .sort((a, b) => new Date(b.change_date) - new Date(a.change_date));
        if (sorted.length === 0) {
            headerLastHistory.textContent = '最終履歴：なし';
            return;
        }
        const latest = sorted[0];
        const s = staffMembers.find(st => st.staff_id === latest.changed_by);
        const name = s ? s.staff_name : '不明';
        const dateStr = formatToJST(latest.change_date);
        let text = `最終履歴：${dateStr} ${latest.change_type}｜${name}`;
        if (latest.comment) {
            const truncated = latest.comment.length > 20 ? latest.comment.substring(0, 20) + '…' : latest.comment;
            text += ` 「${truncated}」`;
        }
        headerLastHistory.textContent = text;
    }

    function renderNextAction(rem, not) {
        if (!nextActionBox || !nextActionText) return;
        nextActionBox.style.display = 'flex';
        let msg = '', cls = 'action-none';
        if (rem === null) {
            msg = '期限が設定されていません'; cls = 'action-none';
        } else if (rem < 0) {
            msg = '期限超過の可能性があります — 状況確認を推奨します'; cls = 'action-danger';
        } else if (rem <= 30) {
            msg = '更新申請準備が必要です'; cls = 'action-danger';
        } else if (rem <= 90 || (not !== null && not <= 0)) {
            msg = '更新案内対象です'; cls = 'action-caution';
        } else {
            const nd = noticeDate.value;
            msg = nd ? `次回更新案内予定：${nd}` : '更新時期まで余裕があります';
            cls = 'action-safe';
        }
        nextActionText.textContent = msg;
        nextActionBox.className = `next-action-box ${cls}`;
    }

    // --- Dirty State (Diff-based) ---
    function serializeForm() {
        const data = {};
        document.querySelectorAll('#page-content input:not([type=hidden]), #page-content select, #page-content textarea').forEach(el => {
            if (el.id) data[el.id] = el.value;
        });
        return JSON.stringify(data);
    }

    function setupDirtyTracking() {
        initialSnapshot = serializeForm();
        document.getElementById('page-content').addEventListener('input', evaluateDirty);
        document.getElementById('page-content').addEventListener('change', evaluateDirty);
    }

    function evaluateDirty() {
        isDirty = serializeForm() !== initialSnapshot;
        updateSaveButtonState();
    }

    function resetDirtyState() {
        initialSnapshot = serializeForm();
        isDirty = false;
        updateSaveButtonState();
    }

    function updateSaveButtonState() {
        [btnSave, stickyBtnSave].forEach(btn => {
            if (!btn) return;
            btn.disabled = !isDirty;
            btn.style.opacity = isDirty ? '1' : '0.5';
        });
    }

    // --- Sticky Action Bar ---
    function setupStickyBar() {
        if (!topActionBar || !stickyBar) return;
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                stickyBar.classList.toggle('visible', !entry.isIntersecting);
            });
        }, { threshold: 0 });
        observer.observe(topActionBar);
    }

    // --- New/Edit Mode ---
    function applyEditMode(isNew) {
        const editOnlyEls = document.querySelectorAll('[data-edit-only]');
        editOnlyEls.forEach(el => el.style.display = isNew ? 'none' : '');
        if (newModeGuide) newModeGuide.style.display = isNew ? 'block' : 'none';
        if (licenseStatusHeader) licenseStatusHeader.style.display = isNew ? 'none' : 'block';
    }

    // =========================================================
    //  Phase 1: 同期UI初期化 — ブロッキングなし、即時描画
    // =========================================================
    currentId = getUrlParameter('id');
    const isNewMode = (currentId === 'new');

    // RBAC: 削除ボタンは管理者のみ
    if (btnDelete && typeof isUserAdmin === 'function' && !isUserAdmin()) {
        btnDelete.style.display = 'none';
    }

    // New/Edit mode
    applyEditMode(isNewMode);

    if (isNewMode) {
        if (pageTitle) pageTitle.textContent = '新規許認可登録';
        renderTitleArea('new', null);
    } else {
        if (historyBody && DPH) {
            DPH.renderSkeleton('history-body', { rows: 3, cols: 3, type: 'table' });
        }
    }

    // Event listeners
    btnSave.addEventListener('click', handleSave);
    if (stickyBtnSave) stickyBtnSave.addEventListener('click', handleSave);
    if (btnSearchCustomer) btnSearchCustomer.addEventListener('click', searchCustomer);
    if (btnDelete) btnDelete.addEventListener('click', handleDelete);
    if (stickyBtnDelete) stickyBtnDelete.addEventListener('click', handleDelete);
    if (btnAddHistory) btnAddHistory.addEventListener('click', addHistory);

    [btnBack].forEach(btn => btn?.addEventListener('click', () => {
        if (!isDirty || confirm('変更が保存されていません。戻りますか？')) {
            const returnUrl = fromCustomerId
                ? `customer_detail.html?id=${fromCustomerId}`
                : 'license_list.html';
            window.location.href = returnUrl;
        }
    }));

    const btnBackToCustomer = document.getElementById('btn-back-to-customer');
    if (btnBackToCustomer) {
        btnBackToCustomer.addEventListener('click', () => {
            const cId = customerId.value || fromCustomerId;
            if (cId) {
                window.location.href = `customer_detail.html?id=${cId}`;
            } else {
                alert('顧客が選択されていません');
            }
        });
    }

    expiryDate.addEventListener('change', updateDisplay);
    noticeDate.addEventListener('change', updateDisplay);
    status.addEventListener('change', updateDisplay);
    licenseTypeId.addEventListener('change', updateDisplay);
    licenseNumber1.addEventListener('input', updateDisplay);
    licenseNumber2.addEventListener('input', updateDisplay);

    // Sticky Bar + Dirty Tracking setup
    setupStickyBar();
    updateSaveButtonState();

    console.log(`[Perf] Phase 1 (Sync UI) completed in ${(performance.now() - tPageStart).toFixed(1)}ms`);

    // =========================================================
    //  Phase 2: 非同期データ取得 — Fire & Forget
    // =========================================================
    loadAllData();

    // --- Phase 2 実装 ---

    async function loadAllData() {
        const t2Start = performance.now();

        // R2: マスタデータはMasterDataManager経由で取得（キャッシュ活用）
        const masterPromise = window.MasterDataManager.loadAll().then(() => {
            licenseTypes = window.MasterDataManager.getLicenseTypes();
            staffMembers = window.MasterDataManager.getStaff();
            governmentOffices = window.MasterDataManager.getGovernmentOffices();

            // マスタデータでUI要素をPopulate
            populateMasterDropdowns();
            initAutocomplete();

            console.log(`[Perf] Master data loaded in ${(performance.now() - t2Start).toFixed(1)}ms`);
        }).catch(err => {
            console.error('Master data load failed:', err);
        });

        if (currentId === 'new') {
            // 新規モード: マスタデータだけ待つ
            await masterPromise;

            const cIdParam = getUrlParameter('customer_id');
            if (cIdParam) {
                fromCustomerId = cIdParam;
                // 顧客データを非同期で取得
                try {
                    const cDoc = await db.collection('customers').doc(`cust_${cIdParam}`).get();
                    if (cDoc.exists) {
                        selectCustomer(cDoc.data());
                        if (btnSearchCustomer) btnSearchCustomer.disabled = true;
                        if (customerSearch) customerSearch.disabled = true;
                    } else {
                        alert('指定された顧客が見つかりません');
                        fromCustomerId = null;
                    }
                } catch (err) {
                    console.error('Customer fetch failed:', err);
                }
            } else {
                customerSearchGroup.style.display = 'block';
            }
            // Setup dirty tracking for new mode
            setupDirtyTracking();
        } else {
            // 既存モード: マスタ + ライセンス + 履歴 + 顧客を並列で取得
            const cIdParam = getUrlParameter('customer_id');
            if (cIdParam) fromCustomerId = cIdParam;

            const docIdParam = getUrlParameter('docId');

            // R5: ライセンスデータ取得（非同期）
            const licensePromise = (async () => {
                let lDoc = null;

                if (docIdParam) {
                    const directDoc = await db.collection('customer_licenses').doc(docIdParam).get();
                    if (directDoc.exists) lDoc = directDoc;
                }

                if (!lDoc) {
                    const lSnap = await db.collection('customer_licenses').where('license_id', '==', parseInt(currentId)).get();
                    if (!lSnap.empty) lDoc = lSnap.docs[0];
                }

                if (lDoc) {
                    currentLicense = lDoc.data();
                    currentLicense._docId = lDoc.id;
                    return currentLicense;
                } else {
                    alert('許認可が見つかりません');
                    window.location.href = 'license_list.html';
                    return null;
                }
            })();

            // R5: 全データを並列取得
            try {
                const [_, licenseData] = await Promise.all([masterPromise, licensePromise]);

                if (!licenseData) return;

                // ライセンスデータをフォームに反映
                loadData(licenseData);
                if (btnDelete) btnDelete.style.display = 'inline-block';
                if (stickyBtnDelete) stickyBtnDelete.style.display = 'inline-block';

                console.log(`[Perf] License data loaded in ${(performance.now() - t2Start).toFixed(1)}ms`);

                const licenseIdNum = licenseData.license_id || parseInt(currentId);

                const historyPromise = loadHistoryAsync(licenseIdNum);
                const customerPromise = loadCustomerAsync(licenseData.customer_id);

                await Promise.all([historyPromise, customerPromise]);

                // Setup dirty tracking after all data loaded
                setupDirtyTracking();

                console.log(`[Perf] All Phase 2 data loaded in ${(performance.now() - t2Start).toFixed(1)}ms`);
            } catch (err) {
                console.error('Phase 2 data load failed:', err);
            }
        }
    }

    function populateMasterDropdowns() {
        // Populate License Types
        if (licenseTypeId) {
            const currentValue = licenseTypeId.value;
            licenseTypeId.innerHTML = '<option value="">選択してください</option>';
            licenseTypes.sort((a, b) => (a.sort_order || 999) - (b.sort_order || 999)).forEach(lt => {
                const opt = document.createElement('option'); opt.value = lt.license_type_id; opt.textContent = lt.license_type_name;
                licenseTypeId.appendChild(opt);
            });
            if (currentValue) licenseTypeId.value = currentValue;
        }

        // Populate Staff
        if (changedBy) {
            const currentValue = changedBy.value;
            changedBy.innerHTML = '<option value="">選択してください</option>';
            staffMembers.filter(s => s.status === '在籍').forEach(s => {
                const opt = document.createElement('option'); opt.value = s.staff_id; opt.textContent = s.staff_name;
                changedBy.appendChild(opt);
            });
            if (currentValue) changedBy.value = currentValue;
        }
    }

    async function loadHistoryAsync(licenseIdNum) {
        try {
            const hSnap = await db.collection('license_history').where('license_id', '==', licenseIdNum).get();
            licenseHistory = hSnap.docs.map(d => ({
                ...d.data(),
                _docId: d.id
            }));
            loadHistory(licenseIdNum);
        } catch (err) {
            console.error('History load failed:', err);
            if (DPH) {
                DPH.renderErrorUI('history-body', () => loadHistoryAsync(licenseIdNum), {
                    isTbody: true,
                    message: '履歴の取得に失敗しました'
                });
            }
        }
    }

    async function loadCustomerAsync(customerIdVal) {
        try {
            const cDoc = await db.collection('customers').doc(`cust_${customerIdVal}`).get();
            if (cDoc.exists) {
                selectCustomer(cDoc.data());
            }
        } catch (err) {
            console.error('Customer fetch failed:', err);
        }
    }

    // --- 既存ロジック（変更なし） ---

    async function searchCustomer() {
        const val = customerSearch.value.trim();
        if (!val) { alert('検索キーワードを入力してください'); return; }

        customerSearchResults.style.display = 'block';
        customerSearchResults.innerHTML = '検索中...';
        try {
            const snapshot = await db.collection('customers')
                .where('customer_name', '>=', val)
                .where('customer_name', '<=', val + '\uf8ff')
                .limit(10)
                .get();

            customerSearchResults.innerHTML = '';
            if (snapshot.empty) {
                customerSearchResults.textContent = '該当する顧客が見つかりません';
                return;
            }

            snapshot.forEach(doc => {
                const c = doc.data();
                const div = document.createElement('div');
                div.className = 'search-result-item';
                div.style.padding = '8px';
                div.style.borderBottom = '1px solid #eee';
                div.style.cursor = 'pointer';
                div.textContent = `${c.customer_name} (${c.customer_id})`;
                div.onclick = () => {
                    selectCustomer(c);
                    customerSearchResults.innerHTML = '';
                    customerSearchResults.style.display = 'none';
                };
                customerSearchResults.appendChild(div);
            });
        } catch (err) {
            console.error(err);
            customerSearchResults.textContent = '検索エラーが発生しました';
        }
    }

    function selectCustomer(cust) {
        customerId.value = cust.customer_id;
        if (licenseEditTitle) {
            licenseEditTitle.textContent = `${cust.customer_id} ${cust.customer_name}`;
        }
        renderTitleArea(currentId, cust);
        customerSearchGroup.style.display = 'none';
    }

    function renderTitleArea(id, cust) {
        const titleArea = document.getElementById('detail-title-area');
        if (!titleArea) return;

        const name = cust ? cust.customer_name : '不明な顧客';

        if (id === 'new' && !cust) {
            titleArea.innerHTML = `<h1 class="page-title" id="page-title">新規許認可登録</h1>
                <span id="license-id-display" style="font-size: 11pt; color: var(--text-muted); font-weight: 400; margin-left: 8px;">License ID: -</span>`;
        } else {
            const heading = id === 'new' ? '新規許認可登録' : '許認可詳細';
            let html = `<h1 class="page-title" id="page-title" style="display:inline-block; margin-right:8px; margin-bottom:0;">${heading}：<span style="color: var(--text-main); font-weight: 600;">${name}</span></h1>`;

            if (cust && id !== 'new') {
                html += `<a href="customer_detail.html?id=${cust.customer_id}" class="action-link" style="margin-left:12px">→ 顧客詳細</a>`;
            }

            html += `<span id="license-id-display" style="font-size: 11pt; color: var(--text-muted); font-weight: 400; margin-left: 8px;">License ID: ${id === 'new' ? '-' : id}</span>`;

            titleArea.innerHTML = html;
        }
    }

    function loadData(l) {
        licenseTypeId.value = l.license_type_id;
        licenseNumber1.value = l.license_number_1 || '';
        licenseNumber2.value = l.license_number_2 || '';
        status.value = l.status || '有効';
        window.setDateValueById('start-date', formatDateForInput(l.start_date));
        window.setDateValueById('expiry-date', formatDateForInput(l.expiry_date));
        window.setDateValueById('notice-date', formatDateForInput(l.notice_date));

        remarks.value = l.remarks || '';
        createdDateDisplay.textContent = l.created_date || '-';
        lastUpdatedDisplay.textContent = formatToJST(l.last_updated);

        if (l.government_office_id) {
            const off = governmentOffices.find(o => o.office_id === l.government_office_id);
            if (off) { governmentOfficeSearch.value = off.office_name; governmentOfficeId.value = off.office_id; }
        } else { governmentOfficeSearch.value = l.government_office || ''; }

        updateDisplay();
    }

    async function deleteHistoryRecord(docId) {
        if (!confirm('この履歴を削除してもよろしいですか？')) return;
        try {
            await deleteFromFirestore('license_history', docId);
            // Update local state to avoid refetching
            licenseHistory = licenseHistory.filter(h => h._docId !== docId);
            const lId = parseInt(currentId) || (currentLicense && currentLicense.license_id);
            if (lId) loadHistory(lId);
            showToast('履歴を削除しました', 'success');
        } catch (err) {
            console.error('履歴削除エラー:', err);
            alert('履歴の削除に失敗しました: ' + err.message);
        }
    }

    function loadHistory(lId) {
        const hist = licenseHistory.filter(h => h.license_id === lId).sort((a, b) => new Date(b.change_date) - new Date(a.change_date));
        historyBody.innerHTML = hist.length ? '' : '<tr><td colspan="3" style="text-align:center">履歴なし</td></tr>';
        hist.forEach(h => {
            const s = staffMembers.find(st => st.staff_id === h.changed_by);
            const name = s ? s.staff_name : '不明';
            const content = `${h.change_type}｜${name}${h.comment ? ` 「${h.comment}」` : ''}`;
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${formatToJST(h.change_date)}</td>
                <td>${content}</td>
                <td style="text-align:center;">
                    <button type="button" class="btn-icon btn-delete-history" data-id="${h._docId}" style="color:var(--danger, #ef4444); background:none; border:none; cursor:pointer; padding:4px;" title="履歴削除">
                        <i data-lucide="trash-2" style="width: 18px; height: 18px;"></i>
                    </button>
                </td>
            `;
            const deleteBtn = tr.querySelector('.btn-delete-history');
            if (deleteBtn && h._docId) {
                deleteBtn.addEventListener('click', () => deleteHistoryRecord(h._docId));
            }
            historyBody.appendChild(tr);
        });

        if (typeof lucide !== 'undefined') {
            lucide.createIcons({ root: historyBody });
        }

        // Update header last history
        renderHeaderLastHistory();
    }

    function initAutocomplete() {
        governmentOfficeSearch.addEventListener('input', function () {
            const val = this.value.trim().toLowerCase();
            autocompleteList.innerHTML = '';
            if (!val) { governmentOfficeId.value = ''; return; }
            governmentOffices.filter(o => o.status === '有効' && o.office_name.toLowerCase().includes(val)).slice(0, 10).forEach(o => {
                const div = document.createElement('div'); div.textContent = o.office_name;
                div.onclick = () => { governmentOfficeSearch.value = o.office_name; governmentOfficeId.value = o.office_id; autocompleteList.innerHTML = ''; };
                autocompleteList.appendChild(div);
            });
        });
    }

    async function handleSave() {
        // バリデーション強化: 顧客IDと種別の必須チェック
        const customerIdVal = parseInt(customerId.value);
        if (!customerId.value || isNaN(customerIdVal) || customerIdVal <= 0) {
            alert('有効な顧客を選択してください'); return;
        }
        if (!licenseTypeId.value) {
            alert('許認可種別を選択してください'); return;
        }

        // 顧客詳細画面から遷移した場合、URLパラメータのIDと一致するか検証
        if (fromCustomerId && customerIdVal !== parseInt(fromCustomerId)) {
            alert('顧客IDが不整合です。画面を再読込してください。'); return;
        }

        const now = new Date().toISOString();
        const data = {
            customer_id: customerIdVal,
            license_type_id: parseInt(licenseTypeId.value),
            government_office_id: parseInt(governmentOfficeId.value) || null,
            government_office: governmentOfficeSearch.value.trim(),
            license_number_1: licenseNumber1.value.trim(),
            license_number_2: licenseNumber2.value.trim(),
            start_date: startDate.value,
            expiry_date: expiryDate.value,
            notice_date: noticeDate.value,
            status: status.value,
            remarks: remarks.value.trim(),
            last_updated: now
        };

        try {
            if (currentId === 'new') {
                // Use getNextSequence for reliable ID generation
                const nextId = await getNextSequence('customer_licenses');
                data.license_id = nextId;
                data.created_date = now;

                // Check for ID collision just in case
                const docId = `lic_${nextId}`;
                const check = await db.collection('customer_licenses').doc(docId).get();
                if (check.exists) {
                    if (!confirm(`License ID ${nextId} already exists. Overwrite?`)) return;
                }

                await saveToFirestore('customer_licenses', docId, data);
                // Update URL for the newly created license without reloading
                currentId = nextId;
                if (fromCustomerId) {
                    history.replaceState(null, '', `?customer_id=${fromCustomerId}&id=${nextId}`);
                } else {
                    history.replaceState(null, '', `?id=${nextId}`);
                }

                if (changedBy.value) {
                    const hId = Date.now();
                    await saveToFirestore('license_history', `hist_${hId}`, { history_id: hId, license_id: nextId, change_date: now, change_type: '新規', changed_by: parseInt(changedBy.value), comment: '新規作成' });
                }
            } else {
                data.license_id = parseInt(currentId);
                data.created_date = currentLicense.created_date;
                // Use the original doc ID if available
                const docIdToSave = currentLicense._docId || `lic_${currentId}`;
                await saveToFirestore('customer_licenses', docIdToSave, data);
            }
            showToast('保存しました', 'success');
            resetDirtyState();

            // If was new mode, switch to edit mode
            if (isNewMode) {
                applyEditMode(false);
                updateDisplay();
                setupDirtyTracking();
            }
        } catch (err) {
            console.error('保存失敗:', err);
            alert('保存失敗: ' + err.message);
        }
    }

    async function handleDelete() {
        if (!confirm('本当に削除しますか？')) return;
        try {
            const docIdToDelete = currentLicense._docId || `lic_${currentId}`;
            await deleteFromFirestore('customer_licenses', docIdToDelete);
            showToast('削除しました', 'success');
            setTimeout(() => window.location.href = 'license_list.html', 1000);
        } catch (err) { alert('削除失敗'); }
    }

    async function addHistory() {
        if (currentId === 'new') { alert('先に保存してください'); return; }
        if (!changedBy.value) { alert('変更者を選択してください'); return; }
        const hId = Date.now();
        try {
            const docId = `hist_${hId}`;
            const newHistoryData = {
                history_id: hId,
                license_id: parseInt(currentId),
                change_date: new Date().toISOString(),
                change_type: changeType.value,
                changed_by: parseInt(changedBy.value),
                comment: comment.value.trim()
            };

            await saveToFirestore('license_history', docId, newHistoryData);

            // Add to local state
            newHistoryData._docId = docId;
            licenseHistory.push(newHistoryData);

            // Clear inputs
            comment.value = '';

            showToast('履歴を追加しました', 'success');
            loadHistory(parseInt(currentId));
            resetDirtyState();
        } catch (e) {
            console.error('履歴追加エラー:', e);
            alert('履歴追加失敗: ' + e.message);
        }
    }
});
