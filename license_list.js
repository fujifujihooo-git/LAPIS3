document.addEventListener('DOMContentLoaded', async () => {
    console.log('License List Initialized (Firestore Mode)');

    // --- Selectors ---
    const licenseListBody = document.getElementById('license-list-body');
    const filterCustomer = document.getElementById('filter-customer');
    const filterLicenseType = document.getElementById('filter-license-type');
    const filterStatus = document.getElementById('filter-status');
    const filterNoticeDue = document.getElementById('filter-notice-due');
    const filterExpiryStart = document.getElementById('filter-expiry-start');
    const filterExpiryEnd = document.getElementById('filter-expiry-end');
    const filterNoticeStart = document.getElementById('filter-notice-start');
    const filterNoticeEnd = document.getElementById('filter-notice-end');
    const filterFieldStaff = document.getElementById('filter-field-staff');
    const filterJurisdiction = document.getElementById('filter-jurisdiction');
    const filterJurisdictionList = document.getElementById('filter-jurisdiction-list');
    const btnNewLicense = document.getElementById('btn-new-license');
    const btnReset = document.getElementById('btn-reset');
    const btnSearch = document.getElementById('btn-search-execute');

    // --- State ---
    let licenses = [];
    let customers = [];
    let licenseTypes = [];
    let staffMembers = [];
    let governmentOffices = [];
    let filteredData = [];
    let currentSort = { column: 'expiry_date', direction: 'asc' };

    // --- Functions ---

    // Calculate Remaining Days
    function calculateRemainingDays(expiryDate) {
        if (!expiryDate) return null;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const targetDate = new Date(expiryDate);
        targetDate.setHours(0, 0, 0, 0);
        const diffTime = targetDate - today;
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        return diffDays;
    }

    // Calculate Days Until Notice
    function calculateDaysUntilNotice(noticeDate) {
        if (!noticeDate) return null;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const targetDate = new Date(noticeDate);
        targetDate.setHours(0, 0, 0, 0);
        const diffTime = targetDate - today;
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        return diffDays;
    }

    // Format Remaining Days
    function formatRemainingDays(days, status) {
        const terminalStatuses = ['完了', '返却済', '取下げ', '失効', '取消'];
        if (status && terminalStatuses.includes(status)) {
            return 'ー';
        }
        if (days === null) return 'ー';
        if (days < 0) return `${Math.abs(days)}日超過`;
        return `${days}日`;
    }

    // Format Days Until Notice
    function formatDaysUntilNotice(days) {
        if (days === null) return 'ー';
        if (days < 0) return `${Math.abs(days)}日超過`;
        return `${days}日`;
    }

    // Get Remaining Days Class
    function getRemainingDaysClass(days, status) {
        const terminalStatuses = ['完了', '返却済', '取下げ', '失効', '取消'];
        if (status && terminalStatuses.includes(status)) {
            return 'days-none';
        }
        if (days === null) return 'days-none';
        if (days >= 90) return 'days-safe';
        if (days >= 30) return 'days-warning';
        if (days >= 14) return 'days-danger';
        return 'days-critical';
    }

    // Get Notice Days Class
    function getNoticeDaysClass(days) {
        if (days === null) return 'days-none';
        if (days >= 30) return 'days-safe';
        if (days >= 14) return 'days-warning';
        if (days >= 1) return 'days-danger';
        return 'days-critical';
    }

    // Get Status Class
    function getStatusClass(status) {
        switch (status) {
            case '有効': return 'status-junin';
            case '失効': return 'status-sodan';
            case '取消': return 'status-torisage';
            default: return 'status-sodan';
        }
    }

    // Format Date to Japanese Era (Wareki)
    function formatWareki(dateStr) {
        if (!dateStr || dateStr === 'null' || !dateStr) return '';
        try {
            const date = new Date(dateStr);
            if (isNaN(date.getTime())) return '';
            const formatter = new Intl.DateTimeFormat('ja-JP-u-ca-japanese', {
                era: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            });
            return formatter.format(date);
        } catch (e) {
            return '';
        }
    }

    // Resolve staff name from customer's primary_staff_id
    function getFieldStaffName(customer) {
        if (!customer || !customer.primary_staff_id) return '';
        const staff = staffMembers.find(s => s.staff_id === Number(customer.primary_staff_id));
        return staff ? staff.staff_name : '';
    }

    // Initialize jurisdiction autocomplete (combobox style, like license_detail)
    function initJurisdictionAutocomplete() {
        if (!filterJurisdiction || !filterJurisdictionList) return;

        filterJurisdiction.addEventListener('input', function () {
            const val = this.value.trim().toLowerCase();
            filterJurisdictionList.innerHTML = '';
            if (!val) return;

            const matches = governmentOffices
                .filter(o => o.status === '\u6709\u52b9' && o.office_name && o.office_name.toLowerCase().includes(val))
                .slice(0, 15);

            // Deduplicate by office_name
            const seen = new Set();
            matches.forEach(o => {
                if (seen.has(o.office_name)) return;
                seen.add(o.office_name);
                const div = document.createElement('div');
                div.textContent = o.office_name;
                div.addEventListener('click', () => {
                    filterJurisdiction.value = o.office_name;
                    filterJurisdictionList.innerHTML = '';
                });
                filterJurisdictionList.appendChild(div);
            });
        });

        // Close autocomplete on outside click
        document.addEventListener('click', function (e) {
            if (e.target !== filterJurisdiction) {
                filterJurisdictionList.innerHTML = '';
            }
        });
    }

    // Initialize Data from Firestore
    async function init() {
        console.log('Fetching master data for License List...');
        try {
            // Fetch Masters: license_types + staff + government_offices
            const [lt, st, go] = await Promise.all([
                getAllFromFirestore('license_types'),
                getAllFromFirestore('staff'),
                getAllFromFirestore('government_offices')
            ]);
            licenseTypes = lt;
            staffMembers = st;
            governmentOffices = go;

            // Populate license type filter
            if (filterLicenseType) {
                filterLicenseType.innerHTML = '<option value="">すべて</option>';
                licenseTypes.filter(lt => lt.status === '有効' || lt.status === 'active').sort((a, b) => (a.sort_order || 999) - (b.sort_order || 999)).forEach(lt => {
                    const opt = document.createElement('option');
                    opt.value = lt.license_type_id;
                    opt.textContent = lt.license_type_name;
                    filterLicenseType.appendChild(opt);
                });
            }

            // Populate field staff filter
            if (filterFieldStaff) {
                filterFieldStaff.innerHTML = '<option value="">すべて</option>';
                staffMembers.filter(s => s.status === '在籍')
                    .sort((a, b) => (a.staff_id || 0) - (b.staff_id || 0))
                    .forEach(s => {
                        const opt = document.createElement('option');
                        opt.value = s.staff_id;
                        opt.textContent = s.staff_name;
                        filterFieldStaff.appendChild(opt);
                    });
            }

            // Initialize jurisdiction autocomplete
            initJurisdictionAutocomplete();

            // Initial view: EMPTY (Save Quota)
            licenseListBody.innerHTML = '<tr><td colspan="7" class="no-data-cell" style="padding: 40px 0; color: #888;">検索条件を入力して検索を実行してください。</td></tr>';

        } catch (err) {
            console.error('Init failed:', err);
            showToast('マスターデータの読み込みに失敗しました', 'error');
        }
    }

    // Search Logic
    async function executeSearch() {
        const custName = filterCustomer.value.trim();
        const licType = filterLicenseType.value;
        const statusVal = filterStatus.value;
        const noticeDue = filterNoticeDue.checked;
        const expiryStart = filterExpiryStart ? filterExpiryStart.value : '';
        const expiryEnd = filterExpiryEnd ? filterExpiryEnd.value : '';
        const noticeStart = filterNoticeStart ? filterNoticeStart.value : '';
        const noticeEnd = filterNoticeEnd ? filterNoticeEnd.value : '';
        const fieldStaffVal = filterFieldStaff ? filterFieldStaff.value : '';
        const jurisdictionVal = filterJurisdiction ? filterJurisdiction.value.trim() : '';

        licenseListBody.innerHTML = '<tr><td colspan="7" style="text-align:center">検索中...</td></tr>';

        try {
            let results = [];

            // Quota optimization: Validation
            if (!custName && !licType && !statusVal && !noticeDue && !expiryStart && !expiryEnd && !noticeStart && !noticeEnd && !fieldStaffVal && !jurisdictionVal) {
                // If NO search conditions, ask for confirmation or return all with strict limit
                const proceed = confirm('検索条件が指定されていません。最新の許認可情報を表示しますか？');
                if (!proceed) {
                    licenseListBody.innerHTML = '<tr><td colspan="7" class="no-data-cell">検索条件を入力してください。</td></tr>';
                    return;
                }
            }

            // Strategy:
            // 1. If Customer Name is provided, search customers with PARTIAL match (includes).
            if (custName) {
                // Fetch all customers to perform partial match on client side.
                const cSnap = await db.collection('customers').get();
                const allCustomers = cSnap.docs.map(d => d.data());

                const searchLower = custName.toLowerCase();
                const matchedCustomers = allCustomers.filter(c => {
                    const nameLower = (c.customer_name || '').toLowerCase();
                    const kanaLower = (c.customer_kana || '').toLowerCase();
                    return nameLower.includes(searchLower) || kanaLower.includes(searchLower);
                });

                if (matchedCustomers.length === 0) {
                    licenseListBody.innerHTML = '<tr><td colspan="7" style="text-align:center">該当する顧客が見つかりません</td></tr>';
                    return;
                }

                if (matchedCustomers.length > 50) {
                    alert('該当する顧客が多すぎます。検索条件を詳しくしてください。\n（最初の50件に関連する許認可を表示します）');
                }

                const targetCustIds = matchedCustomers.slice(0, 50).map(c => c.customer_id);

                // Add to global customers cache for display
                matchedCustomers.forEach(c => {
                    if (!customers.find(existing => existing.customer_id === c.customer_id)) {
                        customers.push(c);
                    }
                });

                // Fetch licenses for these customers
                const lSnap = await db.collection('customer_licenses')
                    .where('customer_id', 'in', targetCustIds)
                    .get();
                results = lSnap.docs.map(d => ({ ...d.data(), _docId: d.id }));

            } else if (fieldStaffVal) {
                // 2a. Field Staff filter: pre-load customers with matching primary_staff_id
                const staffId = parseInt(fieldStaffVal);
                const custSnap = await db.collection('customers')
                    .where('primary_staff_id', '==', staffId)
                    .get();
                const matchedCusts = custSnap.docs.map(d => d.data());

                // Also try string match (some data stores primary_staff_id as string)
                if (matchedCusts.length === 0) {
                    const custSnap2 = await db.collection('customers')
                        .where('primary_staff_id', '==', String(fieldStaffVal))
                        .get();
                    custSnap2.docs.forEach(d => matchedCusts.push(d.data()));
                }

                // Cache customers
                matchedCusts.forEach(c => {
                    if (!customers.find(existing => existing.customer_id === c.customer_id)) {
                        customers.push(c);
                    }
                });

                if (matchedCusts.length === 0) {
                    licenseListBody.innerHTML = '<tr><td colspan="7" class="no-data-cell">該当する外務担当者の顧客が見つかりません</td></tr>';
                    return;
                }

                const targetCustIds = matchedCusts.map(c => c.customer_id);

                // Fetch licenses for these customers (batched for Firestore 'in' limit of 10)
                const licResolves = [];
                for (let i = 0; i < targetCustIds.length; i += 10) {
                    const chunk = targetCustIds.slice(i, i + 10);
                    if (chunk.length > 0)
                        licResolves.push(db.collection('customer_licenses').where('customer_id', 'in', chunk).get());
                }
                const licSnaps = await Promise.all(licResolves);
                licSnaps.forEach(snap => snap.docs.forEach(d => results.push({ ...d.data(), _docId: d.id })));

            } else {
                // 2b. No customer name and no field staff — use other filters
                let query = db.collection('customer_licenses');

                if (licType) {
                    query = query.where('license_type_id', '==', parseInt(licType));
                    if (statusVal) query = query.where('status', '==', statusVal);
                } else if (statusVal) {
                    query = query.where('status', '==', statusVal);
                } else if (noticeDue) {
                    const today = new Date().toISOString().split('T')[0];
                    query = query.where('notice_date', '<=', today);
                } else {
                    // No specific high selectivity filter
                    query = query.orderBy('expiry_date', 'asc');
                }

                // Global limit for read optimization
                query = query.limit(100);

                const snap = await query.get();
                results = snap.docs.map(d => ({ ...d.data(), _docId: d.id }));

                // We need customer names. Fetch associated customers.
                const neededCids = [...new Set(results.map(r => r.customer_id))];
                const missingCids = neededCids.filter(id => !customers.find(c => c.customer_id === id));

                if (missingCids.length > 0) {
                    const custResolves = [];
                    for (let i = 0; i < missingCids.length; i += 10) {
                        const chunk = missingCids.slice(i, i + 10);
                        if (chunk.length > 0)
                            custResolves.push(db.collection('customers').where('customer_id', 'in', chunk).get());
                    }
                    const custSnaps = await Promise.all(custResolves);
                    custSnaps.forEach(snap => snap.docs.forEach(d => customers.push(d.data())));
                }
            }

            // In-Memory Filtering for remaining conditions
            if (licType) { results = results.filter(l => l.license_type_id === parseInt(licType)); }
            if (statusVal) { results = results.filter(l => l.status === statusVal); }
            if (noticeDue) {
                const today = new Date(); today.setHours(0, 0, 0, 0);
                results = results.filter(l => {
                    if (!l.notice_date) return false;
                    return new Date(l.notice_date) <= today;
                });
            }

            // Date range filters (client-side in-memory)
            if (expiryStart) {
                results = results.filter(l => l.expiry_date && l.expiry_date >= expiryStart);
            }
            if (expiryEnd) {
                results = results.filter(l => l.expiry_date && l.expiry_date <= expiryEnd);
            }
            if (noticeStart) {
                results = results.filter(l => l.notice_date && l.notice_date >= noticeStart);
            }
            if (noticeEnd) {
                results = results.filter(l => l.notice_date && l.notice_date <= noticeEnd);
            }

            // Field Staff filter (via customer join)
            if (fieldStaffVal) {
                const staffId = parseInt(fieldStaffVal);
                // Find customer IDs that have this primary_staff_id
                const matchingCustIds = customers
                    .filter(c => Number(c.primary_staff_id) === staffId)
                    .map(c => c.customer_id);
                results = results.filter(l => matchingCustIds.includes(l.customer_id));
            }

            // Government Office (Jurisdiction) filter
            if (jurisdictionVal) {
                results = results.filter(l => l.government_office === jurisdictionVal);
            }

            licenses = results;
            filteredData = results;
            sortData(currentSort.column, currentSort.direction);

        } catch (err) {
            console.error(err);
            if (err.code === 'failed-precondition') {
                alert('検索に必要なインデックスがありません。管理コンソールで作成が必要です。');
            } else {
                alert('検索エラー');
            }
            licenseListBody.innerHTML = '<tr><td colspan="7" style="text-align:center; color:red">エラーが発生しました</td></tr>';
        }
    }

    // Format License Number
    function formatLicenseNumber(item) {
        const num1 = (item.license_number_1 || '').trim();
        const num2 = (item.license_number_2 || '').trim();

        if (!num1 && !num2) return 'ー';
        if (!num1) return num2;
        if (!num2) return num1;
        return `${num1} _ ${num2}`;
    }

    // --- Sort Logic ---
    function sortData(column, direction) {
        currentSort = { column, direction };
        const dir = direction === 'asc' ? 1 : -1;

        filteredData.sort((a, b) => {
            let valA, valB;

            if (column === 'customer_name') {
                const custA = customers.find(c => c.customer_id === a.customer_id);
                const custB = customers.find(c => c.customer_id === b.customer_id);
                valA = custA ? custA.customer_name : '';
                valB = custB ? custB.customer_name : '';
                if (!valA && !valB) return 0;
                if (!valA) return 1;
                if (!valB) return -1;
                return dir * valA.localeCompare(valB, 'ja');
            }

            // 日付系 (expiry_date, notice_date)
            valA = a[column] || '';
            valB = b[column] || '';
            if (!valA && !valB) return 0;
            if (!valA) return 1;
            if (!valB) return -1;
            return dir * valA.localeCompare(valB);
        });

        renderTable(filteredData);
        updateSortIndicators();
    }

    function updateSortIndicators() {
        document.querySelectorAll('#license-table thead th.sortable').forEach(th => {
            const key = th.dataset.sort;
            const existing = th.querySelector('.sort-indicator');
            if (existing) existing.remove();

            if (key === currentSort.column) {
                const indicator = document.createElement('span');
                indicator.className = 'sort-indicator active';
                indicator.textContent = currentSort.direction === 'asc' ? ' ▲' : ' ▼';
                th.appendChild(indicator);
            }
        });
    }

    // Render Table
    function renderTable(data) {
        if (!licenseListBody) return;
        licenseListBody.innerHTML = '';

        if (data.length === 0) {
            licenseListBody.innerHTML = `<tr><td colspan="7" class="no-data-cell">該当するデータがありません</td></tr>`;
            return;
        }

        data.forEach(item => {
            const customer = customers.find(c => c.customer_id === item.customer_id);
            const licenseType = licenseTypes.find(lt => lt.license_type_id === item.license_type_id);
            const fieldStaffName = getFieldStaffName(customer);

            const remainingDays = calculateRemainingDays(item.expiry_date);
            const noticeDays = calculateDaysUntilNotice(item.notice_date);

            const row = document.createElement('tr');
            row.style.cursor = 'pointer';
            row.addEventListener('click', () => {
                window.location.href = `license_detail.html?docId=${item._docId}&id=${item.license_id}`;
            });

            row.innerHTML = `
                <td>
                    <strong>${formatDisplayValue(customer ? customer.customer_name : null)}</strong>
                    ${fieldStaffName ? `<span class="staff-name-sub">${fieldStaffName}</span>` : ''}
                </td>
                <td style="max-width: 220px;" title="${item.government_office ? item.government_office + ' ' : ''}${formatDisplayValue(licenseType ? licenseType.license_type_name : null)}">
                    <div style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 13pt;">
                        ${item.government_office ? `<span style="font-weight: 500;">${item.government_office}</span> ` : ''}${formatDisplayValue(licenseType ? licenseType.license_type_name : null)}
                    </div>
                    <span class="license-number-sub" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${formatLicenseNumber(item)}</span>
                </td>
                <td>
                    ${formatDate(item.expiry_date)}
                    <span class="date-awareki">${formatWareki(item.expiry_date)}</span>
                </td>
                <td><span class="${getRemainingDaysClass(remainingDays, item.status)}">${formatRemainingDays(remainingDays, item.status)}</span></td>
                <td>
                    ${formatDate(item.notice_date)}
                    <span class="date-awareki">${formatWareki(item.notice_date)}</span>
                </td>
                <td><span class="${getNoticeDaysClass(noticeDays)}">${formatDaysUntilNotice(noticeDays)}</span></td>
                <td><span class="badge ${getStatusClass(item.status)}">${item.status}</span></td>
            `;
            licenseListBody.appendChild(row);
        });
    }

    // Filter Logic
    function handleFilter() {
        // ... (This function is used for simple front-end filtering after initial fetch)
        // ...
    }

    // Reset Logic
    async function handleReset() {
        filterCustomer.value = '';
        filterLicenseType.value = '';
        filterStatus.value = '有効';
        filterNoticeDue.checked = false;

        // Flatpickr-aware date input clearing
        [filterExpiryStart, filterExpiryEnd, filterNoticeStart, filterNoticeEnd].forEach(el => {
            if (el && el._flatpickr) {
                el._flatpickr.clear();
            } else if (el) {
                el.value = '';
            }
        });

        if (filterFieldStaff) filterFieldStaff.value = '';
        if (filterJurisdiction) filterJurisdiction.value = '';
        if (filterJurisdictionList) filterJurisdictionList.innerHTML = '';

        // Return to initial display (Recent 50)
        await init();
        showToast('検索条件をリセットしました');
    }

    // --- Listeners ---
    // Sortable header click events
    document.querySelectorAll('#license-table thead th.sortable').forEach(th => {
        th.addEventListener('click', () => {
            const key = th.dataset.sort;
            if (!['customer_name', 'expiry_date', 'notice_date'].includes(key)) return;
            const newDir = (currentSort.column === key && currentSort.direction === 'asc') ? 'desc' : 'asc';
            sortData(key, newDir);
        });
    });

    if (btnSearch) btnSearch.addEventListener('click', executeSearch);
    if (btnReset) btnReset.addEventListener('click', handleReset);

    if (filterCustomer) {
        filterCustomer.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') executeSearch();
        });
    }

    if (btnNewLicense) {
        btnNewLicense.addEventListener('click', () => {
            window.location.href = 'license_detail.html?id=new';
        });
    }

    // Initial Start
    await init();
});
