document.addEventListener('DOMContentLoaded', async () => {
    console.log('License Detail Initialized (Firestore Mode)');

    // --- Selectors ---
    const pageTitle = document.getElementById('page-title');
    const licenseEditTitle = document.getElementById('license-edit-title');
    // const customerNameDisplay = document.getElementById('customer-name-display'); // Missing in HTML
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
    const remainingDaysSpan = document.getElementById('remaining-days');
    const noticeDaysSpan = document.getElementById('notice-days');
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

    // Autocomplete Selectors
    const governmentOfficeSearch = document.getElementById('government-office-search');
    const governmentOfficeId = document.getElementById('government-office-id');
    const autocompleteList = document.getElementById('office-autocomplete-list');

    // --- State ---
    let currentId = null;
    let licenses = [];
    let customers = [];
    let licenseTypes = [];
    let staffMembers = [];
    let licenseHistory = [];
    let governmentOffices = [];
    let currentLicense = null;
    let fromCustomerId = null; // 顧客詳細画面から遷移した場合の顧客ID

    // --- Functions ---
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

    function updateDisplay() {
        const rem = calculateRemainingDays(expiryDate.value);
        const not = calculateRemainingDays(noticeDate.value);
        if (remainingDaysSpan) { remainingDaysSpan.textContent = formatDays(rem); remainingDaysSpan.className = rem < 30 ? 'days-critical' : 'days-safe'; }
        if (noticeDaysSpan) { noticeDaysSpan.textContent = formatDays(not); noticeDaysSpan.className = not < 7 ? 'days-danger' : 'days-safe'; }
    }

    async function init() {
        console.log('Fetching initial data for License Detail...');
        try {
            // Fetch Master Data Only
            [licenseTypes, staffMembers, governmentOffices] = await Promise.all([
                getAllFromFirestore('license_types'),
                getAllFromFirestore('staff'),
                getAllFromFirestore('government_offices')
            ]);

            currentId = getUrlParameter('id');

            // Populate License Types
            licenseTypeId.innerHTML = '<option value="">選択してください</option>';
            licenseTypes.sort((a, b) => (a.sort_order || 999) - (b.sort_order || 999)).forEach(lt => {
                const opt = document.createElement('option'); opt.value = lt.license_type_id; opt.textContent = lt.license_type_name;
                licenseTypeId.appendChild(opt);
            });

            // Populate Staff
            changedBy.innerHTML = '<option value="">選択してください</option>';
            staffMembers.filter(s => s.status === '在籍').forEach(s => {
                const opt = document.createElement('option'); opt.value = s.staff_id; opt.textContent = s.staff_name;
                changedBy.appendChild(opt);
            });

            initAutocomplete();

            if (currentId === 'new') {
                if (pageTitle) pageTitle.textContent = '新規許認可登録';
                renderTitleArea('new', null);
                const cIdParam = getUrlParameter('customer_id');
                if (cIdParam) {
                    fromCustomerId = cIdParam; // 遷移元の顧客IDを保持
                    // Fetch specific customer
                    const cDoc = await db.collection('customers').doc(`cust_${cIdParam}`).get();
                    if (cDoc.exists) {
                        selectCustomer(cDoc.data());
                        // 顧客詳細画面からの遷移時は顧客変更を不可にする
                        if (btnSearchCustomer) btnSearchCustomer.disabled = true;
                        if (customerSearch) customerSearch.disabled = true;
                    } else {
                        alert('指定された顧客が見つかりません');
                        fromCustomerId = null;
                    }
                } else {
                    customerSearchGroup.style.display = 'block';
                }
            } else {
                // 既存許認可の編集: URLの customer_id パラメータも保持
                const cIdParam = getUrlParameter('customer_id');
                if (cIdParam) fromCustomerId = cIdParam;

                // ドキュメントIDで直接フェッチ（license_id重複対策）
                const docIdParam = getUrlParameter('docId');
                let lDoc = null;

                if (docIdParam) {
                    // docIdパラメータがある場合: ドキュメントID直接参照（確実）
                    const directDoc = await db.collection('customer_licenses').doc(docIdParam).get();
                    if (directDoc.exists) {
                        lDoc = directDoc;
                    }
                }

                if (!lDoc) {
                    // フォールバック: license_idフィールドでクエリ
                    const lSnap = await db.collection('customer_licenses').where('license_id', '==', parseInt(currentId)).get();
                    if (!lSnap.empty) {
                        lDoc = lSnap.docs[0];
                    }
                }

                if (lDoc) {
                    currentLicense = lDoc.data();
                    // Store doc ID for updates
                    currentLicense._docId = lDoc.id;

                    // Fetch related history
                    const licenseIdNum = currentLicense.license_id || parseInt(currentId);
                    const hSnap = await db.collection('license_history').where('license_id', '==', licenseIdNum).get();
                    licenseHistory = hSnap.docs.map(d => ({
                        ...d.data(),
                        _docId: d.id
                    }));

                    loadData(currentLicense);
                    loadHistory(licenseIdNum);
                    if (btnDelete) btnDelete.style.display = 'inline-block';

                    // Fetch associated customer
                    const cDoc = await db.collection('customers').doc(`cust_${currentLicense.customer_id}`).get();
                    if (cDoc.exists) {
                        selectCustomer(cDoc.data());
                    }
                } else {
                    alert('許認可が見つかりません');
                    window.location.href = 'license_list.html';
                }
            }
        } catch (err) { console.error('Init failed:', err); }
    }

    async function searchCustomer() {
        const val = customerSearch.value.trim();
        if (!val) { alert('検索キーワードを入力してください'); return; }

        customerSearchResults.style.display = 'block';
        customerSearchResults.innerHTML = '検索中...';
        try {
            // Prefix search: name >= val and name <= val + '\uf8ff'
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
        startDate.value = l.start_date || '';
        expiryDate.value = l.expiry_date || '';
        noticeDate.value = l.notice_date || '';
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
        historyBody.innerHTML = hist.length ? '' : '<tr><td colspan="5" style="text-align:center">履歴なし</td></tr>';
        hist.forEach(h => {
            const s = staffMembers.find(st => st.staff_id === h.changed_by);
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${formatToJST(h.change_date)}</td>
                <td>${h.change_type}</td>
                <td>${s ? s.staff_name : '不明'}</td>
                <td>${h.comment || '-'}</td>
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

        // Re-initialize lucide icons for the newly added buttons
        if (typeof lucide !== 'undefined') {
            lucide.createIcons({
                root: historyBody
            });
        }
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

            // 顧客詳細画面から遷移した場合は元の顧客画面に戻る（コメントアウト）
            // const returnUrl = fromCustomerId
            //     ? `customer_detail.html?id=${fromCustomerId}`
            //     : 'license_list.html';
            // setTimeout(() => window.location.href = returnUrl, 1000);
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
        } catch (e) {
            console.error('履歴追加エラー:', e);
            alert('履歴追加失敗: ' + e.message);
        }
    }

    btnSave.addEventListener('click', handleSave);
    if (btnSearchCustomer) btnSearchCustomer.addEventListener('click', searchCustomer);
    if (btnDelete) btnDelete.addEventListener('click', handleDelete);
    if (btnAddHistory) btnAddHistory.addEventListener('click', addHistory);

    // 戻るボタン: 顧客詳細画面経由なら顧客画面に戻る
    [btnBack].forEach(btn => btn?.addEventListener('click', () => {
        if (confirm('戻りますか？')) {
            const returnUrl = fromCustomerId
                ? `customer_detail.html?id=${fromCustomerId}`
                : 'license_list.html';
            window.location.href = returnUrl;
        }
    }));

    // 「顧客詳細へ」ボタンの動的リンク設定
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

    await init();
});
