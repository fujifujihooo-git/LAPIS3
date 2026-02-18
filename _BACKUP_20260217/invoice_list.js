document.addEventListener('DOMContentLoaded', () => {
    // --- Selectors ---
    const invoiceListBody = document.getElementById('invoice-list-body');
    const filterCustomer = document.getElementById('filter-customer');
    const filterStatus = document.getElementById('filter-status');
    const filterDateStart = document.getElementById('filter-date-start');
    const filterDateEnd = document.getElementById('filter-date-end');
    const includePaid = document.getElementById('include-paid');
    const allPeriods = document.getElementById('all-periods');
    const countDisplay = document.getElementById('count-display');
    const btnResetFilters = document.getElementById('btn-reset-filters');
    const btnNewInvoice = document.getElementById('btn-new-invoice');

    // --- State ---
    let invoices = [];
    let customersMap = {}; // ID -> Customer Object
    let paymentsMap = {}; // Invoice ID -> Array of Payments
    let currentSort = { column: 'invoice_date', direction: 'desc' };
    let fetchedData = []; // Data fetched from Firestore (before client-side filtering like customer name)

    // --- Functions ---

    function init() {
        setDefaultFilters();

        // Sorting header listeners
        document.querySelectorAll('#invoice-table th.sortable').forEach(th => {
            th.addEventListener('click', () => {
                const column = th.dataset.sort;
                const direction = currentSort.column === column && currentSort.direction === 'asc' ? 'desc' : 'asc';
                currentSort = { column, direction };

                updateSortIndicators('invoice-table', column, direction);
                renderTable(); // Re-render with current sort
            });
        });

        // Initialize with default search
        searchData();
    }

    function setDefaultFilters() {
        // 過去3ヶ月の開始日を計算
        const today = new Date();
        const threeMonthsAgo = new Date();
        threeMonthsAgo.setMonth(today.getMonth() - 3);
        filterDateStart.value = threeMonthsAgo.toISOString().split('T')[0];

        // 終了日は今日
        filterDateEnd.value = today.toISOString().split('T')[0];

        // 「入金済を含む」はデフォルトOFF
        includePaid.checked = false;
        // 「すべての期間」はデフォルトOFF
        allPeriods.checked = false;
    }

    async function searchData() {
        // Show loading state
        invoiceListBody.innerHTML = '<tr><td colspan="7" class="no-data-cell">データを読み込み中...</td></tr>';
        countDisplay.textContent = '読み込み中...';

        const sVal = filterStatus.value;
        const dStart = filterDateStart.value;
        const dEnd = filterDateEnd.value;
        const isIncludePaid = includePaid.checked;
        const isAllPeriods = allPeriods.checked;

        try {
            let query = db.collection('invoices');

            // 1. Status Filter (Server-side if possible)
            if (sVal) {
                query = query.where('status', '==', sVal);
            }

            // 2. Date Range Filter
            if (!isAllPeriods) {
                if (dStart) query = query.where('invoice_date', '>=', dStart);
                if (dEnd) query = query.where('invoice_date', '<=', dEnd);
            }

            // Ordering
            query = query.orderBy('invoice_date', 'desc');

            const snapshot = await query.get();
            invoices = snapshot.docs.map(doc => doc.data());

            // 3. Client-side Status Filtering (for "exclude Paid" when no specific status selected)
            if (!sVal && !isIncludePaid) {
                invoices = invoices.filter(inv => inv.status !== '入金済');
            }

            if (invoices.length === 0) {
                fetchedData = [];
                renderTable();
                return;
            }

            // 4. Fetch Related Data (Customers, Payments)
            const customerIds = [...new Set(invoices.map(inv => inv.customer_id))];
            const invoiceIds = invoices.map(inv => inv.invoice_id);

            // Fetch Customers (Chunked IN query)
            customersMap = {};
            const custChunks = [];
            for (let i = 0; i < customerIds.length; i += 10) {
                custChunks.push(customerIds.slice(i, i + 10));
            }

            const custPromises = custChunks.map(chunk =>
                db.collection('customers').where('customer_id', 'in', chunk).get()
            );

            // Fetch Payments (Chunked IN query)
            paymentsMap = {};
            const invChunks = [];
            for (let i = 0; i < invoiceIds.length; i += 10) {
                invChunks.push(invoiceIds.slice(i, i + 10));
            }
            const payPromises = invChunks.map(chunk =>
                db.collection('payments').where('invoice_id', 'in', chunk).get()
            );

            const [custSnapshots, paySnapshots] = await Promise.all([
                Promise.all(custPromises),
                Promise.all(payPromises)
            ]);

            custSnapshots.forEach(snap => {
                snap.forEach(doc => {
                    const c = doc.data();
                    customersMap[c.customer_id] = c;
                });
            });

            paySnapshots.forEach(snap => {
                snap.forEach(doc => {
                    const p = doc.data();
                    if (!paymentsMap[p.invoice_id]) paymentsMap[p.invoice_id] = [];
                    paymentsMap[p.invoice_id].push(p);
                });
            });

            // Join Data
            fetchedData = invoices.map(inv => {
                const customer = customersMap[inv.customer_id];
                const invPayments = paymentsMap[inv.invoice_id] || [];
                const paidAmount = invPayments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);

                return {
                    ...inv,
                    customer_name: customer ? customer.customer_name : '',
                    paid_amount: paidAmount,
                    balance: (inv.total_amount || 0) - paidAmount
                };
            });

            renderTable();

        } catch (error) {
            console.error('Search failed:', error);
            invoiceListBody.innerHTML = `<tr><td colspan="7" class="no-data-cell error">データの取得に失敗しました: ${error.message}</td></tr>`;
        }
    }

    function renderTable() {
        // Apply Client-side Customer Name Filter
        const cVal = filterCustomer.value.toLowerCase();
        let displayData = fetchedData.filter(item => {
            const cName = item.customer_name.toLowerCase();
            return cVal === "" || cName.includes(cVal);
        });

        // Apply Sorting
        displayData = handleSort('invoice-table', displayData, currentSort.column, 'string', currentSort.direction);

        // Render
        invoiceListBody.innerHTML = '';
        if (displayData.length === 0) {
            invoiceListBody.innerHTML = `<tr><td colspan="7" class="no-data-cell">該当するデータがありません</td></tr>`;
            countDisplay.textContent = `表示件数：0件`;
            return;
        }

        displayData.forEach(inv => {
            const row = document.createElement('tr');
            row.style.cursor = 'pointer';
            row.addEventListener('click', () => {
                window.location.href = `invoice_detail.html?id=${inv.invoice_id}`;
            });

            const balanceColor = inv.balance > 0 ? '#dc2626' : '#64748b';
            const balanceWeight = inv.balance > 0 ? '600' : 'normal';

            row.innerHTML = `
                <td><strong>${inv.invoice_number}</strong></td>
                <td>${formatDisplayValue(inv.customer_name)}</td>
                <td>${formatDate(inv.invoice_date)}</td>
                <td style="font-weight: 600;">${formatCurrency(inv.total_amount)}</td>
                <td><span class="badge ${getInvoiceStatusClass(inv.status)}">${inv.status}</span></td>
                <td style="color: #059669;">${formatCurrency(inv.paid_amount)}</td>
                <td style="color: ${balanceColor}; font-weight: ${balanceWeight};">${formatCurrency(inv.balance)}</td>
            `;
            invoiceListBody.appendChild(row);
        });

        countDisplay.textContent = `表示件数：${displayData.length}件`;
    }

    // --- Event Listeners ---
    [filterDateStart, filterDateEnd, filterStatus, includePaid, allPeriods].forEach(el => {
        el.addEventListener('change', searchData);
    });

    // Customer Name Filter is Client-side, so input event triggers re-render
    filterCustomer.addEventListener('input', renderTable);

    btnResetFilters.addEventListener('click', () => {
        filterCustomer.value = '';
        filterStatus.value = '';
        setDefaultFilters();
        searchData();
    });

    btnNewInvoice.addEventListener('click', () => {
        window.location.href = 'invoice_detail.html';
    });

    // Start
    init();
});
