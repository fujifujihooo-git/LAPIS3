document.addEventListener('DOMContentLoaded', () => {
    // --- Selectors ---
    const invoiceListBody = document.getElementById('invoice-list-body');
    const filterCustomer = document.getElementById('filter-customer');
    const filterStatus = document.getElementById('filter-status');
    const filterDateStart = document.getElementById('filter-date-start');
    const filterDateEnd = document.getElementById('filter-date-end');
    const filterUnpaid = document.getElementById('filter-unpaid'); // Changed from includePaid
    const allPeriods = document.getElementById('all-periods');
    const countDisplay = document.getElementById('count-display');
    const countDisplayArea = document.getElementById('count-display-area');
    const initialMessage = document.getElementById('initial-message');
    const tableWrapper = document.getElementById('table-wrapper');
    const btnResetFilters = document.getElementById('btn-reset-filters');
    const btnSearchExecute = document.getElementById('btn-search-execute');
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

        // Enter key support 
        filterCustomer.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') searchData();
        });
    }

    function setDefaultFilters() {
        // 過去3ヶ月の開始日を計算
        const today = new Date();
        const threeMonthsAgo = new Date();
        threeMonthsAgo.setMonth(today.getMonth() - 3);
        filterDateStart.value = threeMonthsAgo.toISOString().split('T')[0];

        // 終了日は今日
        filterDateEnd.value = today.toISOString().split('T')[0];

        // 「残高ありのみ表示」はデフォルトON
        if (filterUnpaid) filterUnpaid.checked = true;
        // 「すべての期間」はデフォルトOFF
        if (allPeriods) allPeriods.checked = false;
    }

    async function searchData() {
        // Toggle view containers
        initialMessage.style.display = 'none';
        tableWrapper.style.display = 'block';
        countDisplayArea.style.display = 'flex';

        // Show loading state
        invoiceListBody.innerHTML = '<tr><td colspan="7" class="no-data-cell">データを読み込み中...</td></tr>';
        countDisplay.textContent = '表示件数：読み込み中...';

        const sVal = filterStatus.value;
        const dStart = filterDateStart.value;
        const dEnd = filterDateEnd.value;
        const isUnpaidOnly = filterUnpaid ? filterUnpaid.checked : true;
        const isAllPeriods = allPeriods ? allPeriods.checked : false;

        // 期間指定が有効かどうか判定
        const hasDateFilter = !isAllPeriods && (dStart || dEnd);

        try {
            let query = db.collection('invoices');

            // 1. Status Filter (Server-side if possible)
            if (sVal) {
                query = query.where('status', '==', sVal);
            }

            // 2. Hybrid Server-side Filtering: 期間指定がない場合はFirestore側で残高フィルタを適用し、読み取り回数を節約
            if (isUnpaidOnly && !hasDateFilter) {
                query = query.where('balance', '>', 0).orderBy('balance').orderBy('invoice_date', 'desc');
            } else {
                // 通常の期間フィルタとソート
                if (hasDateFilter) {
                    if (dStart) query = query.where('invoice_date', '>=', dStart);
                    if (dEnd) query = query.where('invoice_date', '<=', dEnd);
                }
                query = query.orderBy('invoice_date', 'desc');
            }

            const snapshot = await query.get();
            invoices = snapshot.docs.map(doc => ({
                ...doc.data(),
                doc_id: doc.id
            }));

            if (invoices.length === 0) {
                fetchedData = [];
                renderTable();
                return;
            }

            // 3. Fetch Related Data (Customers, Payments)
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
            let mappedData = invoices.map(inv => {
                const customer = customersMap[inv.customer_id];
                const invPayments = paymentsMap[inv.invoice_id] || [];
                const paidAmount = invPayments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);

                // Firestoreから取得したbalanceが存在すればそれを優先、なければ計算値を使用(後方互換性)
                const calcBalance = (inv.total_amount || 0) - paidAmount;

                return {
                    ...inv,
                    customer_name: customer ? customer.customer_name : '',
                    paid_amount: paidAmount,
                    balance: inv.balance !== undefined ? inv.balance : calcBalance
                };
            });

            // 4. Client-side Balance Filtering
            // 期間指定がある場合は、Firestore側で残高フィルタがかけられないためクライアント側でフィルタする
            if (isUnpaidOnly && hasDateFilter) {
                mappedData = mappedData.filter(inv => inv.balance > 0);
            }

            // もしステータス指定がない＆未収のみチェックもない場合、デフォルトで「入金済」を除外するかについて:
            // 今回の要件で「残高あり・なしで切り替える」となったため、未収チェックが「OFF」の場合は全て表示する仕様に統一。

            fetchedData = mappedData;

            renderTable();

        } catch (error) {
            console.error('Search failed:', error);

            // Extract Firebase Index URL if available
            let errorMsg = `データの取得に失敗しました: ${error.message}`;
            if (error.message.includes('The query requires an index')) {
                const urlMatch = error.message.match(/https:\/\/console\.firebase\.google\.com[^\s]*/);
                if (urlMatch) {
                    errorMsg = `検索速度を上げるためのインデックス作成が必要です。<br><br><a href="${urlMatch[0]}" target="_blank" style="color: var(--primary); text-decoration: underline; font-weight: bold;">ここをクリックしてFirebaseコンソールでインデックスを作成してください。</a><br><br><span style="font-size: 0.9em; color: var(--text-muted);">※作成後、有効になるまで数分かかります。</span>`;
                }
            }

            invoiceListBody.innerHTML = `<tr><td colspan="7" class="no-data-cell error" style="padding: 20px;">${errorMsg}</td></tr>`;
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
                window.location.href = `invoice_detail.html?id=${inv.doc_id}`;
            });

            const hasBalance = inv.balance > 0;
            // 未収行のUI強調
            if (hasBalance) {
                row.style.backgroundColor = 'rgba(239, 68, 68, 0.05)'; // 非常に薄い赤背景 (bg-red-50相当)
            }

            const balanceColor = hasBalance ? '#dc2626' : '#64748b';
            const balanceWeight = hasBalance ? 'bold' : 'normal';

            row.innerHTML = `
                <td><strong>${inv.invoice_number || '-'}</strong></td>
                <td>${formatDisplayValue(inv.customer_name)}</td>
                <td>${formatDate(inv.invoice_date)}</td>
                <td style="font-weight: 600;">${formatCurrency(inv.total_amount)}</td>
                <td><span class="badge ${getInvoiceStatusClass(inv.status)}">${inv.status || '-'}</span></td>
                <td style="color: #059669;">${formatCurrency(inv.paid_amount)}</td>
                <td style="color: ${balanceColor}; font-weight: ${balanceWeight};">${formatCurrency(inv.balance)}</td>
            `;
            invoiceListBody.appendChild(row);
        });

        countDisplay.textContent = `表示件数：${displayData.length}件`;
    }

    // --- Event Listeners ---
    if (btnSearchExecute) {
        btnSearchExecute.addEventListener('click', searchData);
    }

    btnResetFilters.addEventListener('click', () => {
        // 全ての検索条件を明示的にクリアする
        filterCustomer.value = '';
        filterStatus.value = '';

        // 日付入力は UI(Flatpickr) が上書きしているため専用のクリアメソッドを呼ぶ
        if (filterDateStart._flatpickr) {
            filterDateStart._flatpickr.clear();
        } else {
            filterDateStart.value = '';
        }

        if (filterDateEnd._flatpickr) {
            filterDateEnd._flatpickr.clear();
        } else {
            filterDateEnd.value = '';
        }

        if (includePaid) includePaid.checked = false;
        if (allPeriods) allPeriods.checked = false;

        // Return to initial state
        initialMessage.style.display = 'block';
        tableWrapper.style.display = 'none';
        countDisplayArea.style.display = 'none';
        invoices = [];
        fetchedData = [];
        invoiceListBody.innerHTML = '';
    });

    btnNewInvoice.addEventListener('click', () => {
        window.location.href = 'invoice_detail.html';
    });

    // Start
    init();
});
