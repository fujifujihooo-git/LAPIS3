document.addEventListener('DOMContentLoaded', async () => {
    console.log('License Detail Initialized (Firestore Mode)');

    // --- Selectors ---
    const pageTitle = document.getElementById('page-title');
    // const customerNameDisplay = document.getElementById('customer-name-display'); // Missing in HTML
    const customerSearchGroup = document.getElementById('customer-search-group');
    const customerDisplayGroup = document.getElementById('customer-display-group');
    const customerSearch = document.getElementById('customer-search');
    const btnSearchCustomer = document.getElementById('btn-search-customer');
    const customerSearchResults = document.getElementById('customer-search-results');
    const customerSelectedDisplay = document.getElementById('customer-selected-display');
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
            licenseTypes.filter(lt => lt.status === '有効').sort((a, b) => (a.sort_order || 999) - (b.sort_order || 999)).forEach(lt => {
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
                pageTitle.textContent = '新規許認可登録';
                const cIdParam = getUrlParameter('customer_id');
                if (cIdParam) {
                    // Fetch specific customer
                    const cDoc = await db.collection('customers').doc(`cust_${cIdParam}`).get();
                    if (cDoc.exists) {
                        selectCustomer(cDoc.data());
                    } else {
                        alert('指定された顧客が見つかりません');
                    }
                } else {
                    customerSearchGroup.style.display = 'block';
                }
            } else {
                // Fetch License by ID (Query by field to support mixed doc ID formats)
                // const lDoc = await db.collection('customer_licenses').doc(`lic_${currentId}`).get();
                const lSnap = await db.collection('customer_licenses').where('license_id', '==', parseInt(currentId)).get();

                if (!lSnap.empty) {
                    const lDoc = lSnap.docs[0];
                    currentLicense = lDoc.data();
                    // Store doc ID for updates
                    currentLicense._docId = lDoc.id;

                    // Fetch related history
                    const hSnap = await db.collection('license_history').where('license_id', '==', parseInt(currentId)).get();
                    licenseHistory = hSnap.docs.map(d => d.data());

                    loadData(currentLicense);
                    loadHistory(currentLicense.license_id);
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
                div.className = 'search-result-item'; // Add styling in CSS if needed
                div.style.padding = '8px';
                div.style.borderBottom = '1px solid #eee';
                div.style.cursor = 'pointer';
                div.textContent = `${c.customer_name} (${c.customer_id})`;
                div.onclick = () => { selectCustomer(c); customerSearchResults.innerHTML = ''; };
                customerSearchResults.appendChild(div);
            });
        } catch (err) {
            console.error(err);
            customerSearchResults.textContent = '検索エラー occurred';
        }
    }

    function selectCustomer(cust) {
        customerId.value = cust.customer_id;
        customerSelectedDisplay.textContent = cust.customer_name;
        // customerNameDisplay.textContent = cust.customer_name; // Removed due to missing element
        customerSearchGroup.style.display = 'none';
        customerDisplayGroup.style.display = 'block';
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
        lastUpdatedDisplay.textContent = l.last_updated || '-';

        if (l.government_office_id) {
            const off = governmentOffices.find(o => o.office_id === l.government_office_id);
            if (off) { governmentOfficeSearch.value = off.office_name; governmentOfficeId.value = off.office_id; }
        } else { governmentOfficeSearch.value = l.government_office || ''; }

        updateDisplay();
    }

    function loadHistory(lId) {
        const hist = licenseHistory.filter(h => h.license_id === lId).sort((a, b) => new Date(b.change_date) - new Date(a.change_date));
        historyBody.innerHTML = hist.length ? '' : '<tr><td colspan="4" style="text-align:center">履歴なし</td></tr>';
        hist.forEach(h => {
            const s = staffMembers.find(st => st.staff_id === h.changed_by);
            const tr = document.createElement('tr');
            tr.innerHTML = `<td>${formatDate(h.change_date)}</td><td>${h.change_type}</td><td>${s ? s.staff_name : '不明'}</td><td>${h.comment || '-'}</td>`;
            historyBody.appendChild(tr);
        });
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
        if (!customerId.value || !licenseTypeId.value) { alert('顧客と種別を選択してください'); return; }
        const now = new Date().toISOString();
        const data = {
            customer_id: parseInt(customerId.value),
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
            setTimeout(() => window.location.href = 'license_list.html', 1000);
        } catch (err) { alert('保存失敗'); }
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
            await saveToFirestore('license_history', `hist_${hId}`, { history_id: hId, license_id: parseInt(currentId), change_date: new Date().toISOString(), change_type: changeType.value, changed_by: parseInt(changedBy.value), comment: comment.value.trim() });
            alert('履歴追加完了'); loadHistory(parseInt(currentId));
        } catch (e) { alert('履歴追加失敗'); }
    }

    btnSave.addEventListener('click', handleSave);
    if (btnSearchCustomer) btnSearchCustomer.addEventListener('click', searchCustomer);
    if (btnDelete) btnDelete.addEventListener('click', handleDelete);
    if (btnAddHistory) btnAddHistory.addEventListener('click', addHistory);
    [btnBack].forEach(btn => btn?.addEventListener('click', () => { if (confirm('戻りますか？')) window.location.href = 'license_list.html'; }));
    expiryDate.addEventListener('change', updateDisplay);
    noticeDate.addEventListener('change', updateDisplay);

    await init();
});
