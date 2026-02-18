document.addEventListener('DOMContentLoaded', async () => {
    console.log('License List Initialized (Firestore Mode)');

    // --- Selectors ---
    const licenseListBody = document.getElementById('license-list-body');
    const filterCustomer = document.getElementById('filter-customer');
    const filterLicenseType = document.getElementById('filter-license-type');
    const filterStatus = document.getElementById('filter-status');
    const filterNoticeDue = document.getElementById('filter-notice-due');
    const btnNewLicense = document.getElementById('btn-new-license');

    // --- State ---
    let licenses = [];
    let customers = [];
    let licenseTypes = [];
    let filteredData = [];
    let currentSort = { column: 'notice_remaining', direction: 'asc' };

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
    function formatRemainingDays(days) {
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
    function getRemainingDaysClass(days) {
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

    // Initialize Data from Firestore
    async function init() {
        console.log('Fetching initial data for License List...');
        try {
            // Fetch Masters Only
            licenseTypes = await getAllFromFirestore('license_types');

            // customers are NOT fetched initially to save quota

            // Populate license type filter
            if (filterLicenseType) {
                filterLicenseType.innerHTML = '<option value="">すべて</option>';
                licenseTypes.filter(lt => lt.status === '有効').sort((a, b) => (a.sort_order || 999) - (b.sort_order || 999)).forEach(lt => {
                    const opt = document.createElement('option');
                    opt.value = lt.license_type_id;
                    opt.textContent = lt.license_type_name;
                    filterLicenseType.appendChild(opt);
                });
            }

            // Initial Fetch: Recent 50 licenses (by expiry date ascending - most urgent)
            const snapshot = await db.collection('customer_licenses')
                .orderBy('expiry_date', 'asc')
                .limit(50)
                .get();

            licenses = snapshot.docs.map(d => d.data());

            // We need customer names for display. 
            // Fetch distinct customer IDs from licenses and fetch customer names.
            const custIds = [...new Set(licenses.map(l => l.customer_id))];
            if (custIds.length > 0) {
                // Batch/Promise.all fetch is heavy. 
                // Maybe just show IDs if name not available? Or fetch individually effectively.
                // Or use `where('customer_id', 'in', ...)` for chunks.
                const custResolves = [];
                // Chunk into 10
                for (let i = 0; i < custIds.length; i += 10) {
                    const chunk = custIds.slice(i, i + 10);
                    if (chunk.length > 0) {
                        custResolves.push(db.collection('customers').where('customer_id', 'in', chunk).get());
                    }
                }
                const custSnaps = await Promise.all(custResolves);
                custSnaps.forEach(snap => {
                    snap.docs.forEach(d => customers.push(d.data()));
                });
            }

            filteredData = licenses;
            renderTable(licenses);
        } catch (err) {
            console.error('Init failed:', err);
            showToast('データ読み込みエラー', 'error');
        }
    }

    // Search Logic
    async function executeSearch() {
        const custName = filterCustomer.value.trim();
        const licType = filterLicenseType.value;
        const statusVal = filterStatus.value;
        const noticeDue = filterNoticeDue.checked;

        licenseListBody.innerHTML = '<tr><td colspan="8" style="text-align:center">検索中...</td></tr>';

        try {
            let results = [];

            // Strategy:
            // 1. If Customer Name is provided, search customers first.
            if (custName) {
                const cSnap = await db.collection('customers')
                    .where('customer_name', '>=', custName)
                    .where('customer_name', '<=', custName + '\uf8ff')
                    .limit(10) // Limit to avoid querying too many licenses
                    .get();

                if (cSnap.empty) {
                    licenseListBody.innerHTML = '<tr><td colspan="8" style="text-align:center">該当する顧客が見つかりません</td></tr>';
                    return;
                }

                if (cSnap.size >= 10) {
                    alert('該当する顧客が多すぎます。検索条件を詳しくしてください。');
                    licenseListBody.innerHTML = '<tr><td colspan="8" style="text-align:center">検索条件を絞ってください</td></tr>';
                    return;
                }

                const targetCustIds = cSnap.docs.map(d => d.data().customer_id);
                // Fetch customers to memory for display
                cSnap.docs.forEach(d => {
                    if (!customers.find(c => c.customer_id === d.data().customer_id)) {
                        customers.push(d.data());
                    }
                });

                // Fetch licenses for these customers
                const lSnap = await db.collection('customer_licenses')
                    .where('customer_id', 'in', targetCustIds)
                    .get();
                results = lSnap.docs.map(d => d.data());

            } else {
                // 2. If no customer name, use other filters as base query
                let query = db.collection('customer_licenses');

                if (licType) {
                    query = query.where('license_type_id', '==', parseInt(licType));
                } else if (statusVal) {
                    query = query.where('status', '==', statusVal);
                } else if (noticeDue) {
                    // Notice due means notice_date <= today
                    // This might require index
                    const today = new Date().toISOString().split('T')[0];
                    query = query.where('notice_date', '<=', today);
                } else {
                    // No specific high selectivity filter
                    query = query.orderBy('expiry_date', 'asc').limit(50);
                }

                // If using licType or statusVal, maybe add limit
                if (licType || statusVal || noticeDue) {
                    query = query.limit(100);
                }

                const snap = await query.get();
                results = snap.docs.map(d => d.data());

                // We need customer names. Fetch associated customers.
                const neededCids = [...new Set(results.map(r => r.customer_id))];
                // Filter out already loaded customers
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
            if (custName) { /* Already handled via customer search */ }

            if (licType) { results = results.filter(l => l.license_type_id === parseInt(licType)); }
            if (statusVal) { results = results.filter(l => l.status === statusVal); }
            if (noticeDue) {
                const today = new Date(); today.setHours(0, 0, 0, 0);
                results = results.filter(l => {
                    if (!l.notice_date) return false;
                    return new Date(l.notice_date) <= today;
                });
            }

            licenses = results;
            filteredData = results;
            renderTable(filteredData);

        } catch (err) {
            console.error(err);
            if (err.code === 'failed-precondition') {
                alert('検索に必要なインデックスがありません。管理コンソールで作成が必要です。');
            } else {
                alert('検索エラー');
            }
            licenseListBody.innerHTML = '<tr><td colspan="8" style="text-align:center; color:red">エラーが発生しました</td></tr>';
        }
    }

    // Format License Number
    function formatLicenseNumber(item) {
        const num1 = (item.license_number_1 || '').trim();
        const num2 = (item.license_number_2 || '').trim();

        if (!num1 && !num2) return 'ー';
        if (!num1) return num2;
        if (!num2) return num1;
        return `${num1} - ${num2}`;
    }

    // Render Table
    function renderTable(data) {
        if (!licenseListBody) return;
        licenseListBody.innerHTML = '';

        if (data.length === 0) {
            licenseListBody.innerHTML = `<tr><td colspan="8" class="no-data-cell">該当するデータがありません</td></tr>`;
            return;
        }

        data.forEach(item => {
            const customer = customers.find(c => c.customer_id === item.customer_id);
            const licenseType = licenseTypes.find(lt => lt.license_type_id === item.license_type_id);

            const remainingDays = calculateRemainingDays(item.expiry_date);
            const noticeDays = calculateDaysUntilNotice(item.notice_date);

            const row = document.createElement('tr');
            row.style.cursor = 'pointer';
            row.addEventListener('click', () => {
                window.location.href = `license_detail.html?id=${item.license_id}`;
            });

            row.innerHTML = `
                <td><strong>${formatDisplayValue(customer ? customer.customer_name : null)}</strong></td>
                <td>${formatDisplayValue(licenseType ? licenseType.license_type_name : null)}</td>
                <td>${formatLicenseNumber(item)}</td>
                <td>${formatDate(item.expiry_date)}</td>
                <td><span class="${getRemainingDaysClass(remainingDays)}">${formatRemainingDays(remainingDays)}</span></td>
                <td>${formatDate(item.notice_date)}</td>
                <td><span class="${getNoticeDaysClass(noticeDays)}">${formatDaysUntilNotice(noticeDays)}</span></td>
                <td><span class="badge ${getStatusClass(item.status)}">${item.status}</span></td>
            `;
            licenseListBody.appendChild(row);
        });
    }

    // Filter Logic
    function handleFilter() {
        const customerVal = filterCustomer.value.toLowerCase();
        const licenseTypeVal = filterLicenseType.value;
        const statusVal = filterStatus.value;
        const isNoticeDue = filterNoticeDue.checked;

        const filtered = licenses.filter(item => {
            const customer = customers.find(c => c.customer_id === item.customer_id);
            const matchCustomer = !customerVal || (customer && customer.customer_name.toLowerCase().includes(customerVal));
            const matchLicenseType = !licenseTypeVal || String(item.license_type_id) === licenseTypeVal;
            const matchStatus = !statusVal || item.status === statusVal;

            let matchNoticeDue = true;
            if (isNoticeDue) {
                const noticeDays = calculateDaysUntilNotice(item.notice_date);
                matchNoticeDue = noticeDays !== null && noticeDays <= 0;
            }

            return matchCustomer && matchLicenseType && matchStatus && matchNoticeDue;
        });

        // Current Sort Apply
        const mappedData = filtered.map(item => {
            const cust = customers.find(c => c.customer_id === item.customer_id);
            const type = licenseTypes.find(lt => lt.license_type_id === item.license_type_id);
            return {
                ...item,
                customer_name: cust ? cust.customer_name : '',
                license_type_name: type ? type.license_type_name : '',
                license_number: formatLicenseNumber(item),
                remaining_days: calculateRemainingDays(item.expiry_date) || 9999,
                notice_remaining: calculateDaysUntilNotice(item.notice_date) || 9999
            };
        });

        const sortedMapped = handleSort('license-table', mappedData, currentSort.column, 'string', currentSort.direction);
        filteredData = sortedMapped.map(sm => {
            const { customer_name, license_type_name, license_number, remaining_days, notice_remaining, ...original } = sm;
            return original;
        });

        updateSortIndicators('license-table', currentSort.column, currentSort.direction);
        renderTable(filteredData);
    }

    // --- Listeners ---
    // Removed direct change listeners
    const btnSearch = document.getElementById('btn-search-execute');
    if (btnSearch) btnSearch.addEventListener('click', executeSearch);

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
