document.addEventListener('DOMContentLoaded', () => {
    // --- State ---
    let cases = [];
    let salesData = []; // Processed data for display/export
    let currentSort = { column: 'contract_date', direction: 'desc' };

    // Caches
    let customersMap = {};
    let staffMap = {};
    let invoiceItemsMap = {}; // case_id -> [items]
    let totalPeriodPaid = 0; // Global period paid total

    // --- Selectors ---
    const listBody = document.getElementById('sales-list-body');
    const filterDateFrom = document.getElementById('filter-date-from');
    const filterDateTo = document.getElementById('filter-date-to');
    const filterCustomer = document.getElementById('filter-customer');
    const filterStaff = document.getElementById('filter-staff');
    const btnExcelExport = document.getElementById('btn-excel-export');
    const btnPdfExport = document.getElementById('btn-pdf-export');

    // Tabs
    const tabList = document.getElementById('tab-list');
    const tabSummary = document.getElementById('tab-summary');
    const viewList = document.getElementById('view-list');
    const viewSummary = document.getElementById('view-summary');
    const monthlyAggArea = document.getElementById('monthly-agg-area');

    // Aggregates
    const aggTitle = document.getElementById('agg-title');
    const aggFee = document.getElementById('agg-fee');
    const aggTax = document.getElementById('agg-tax');
    const aggTotalSales = document.getElementById('agg-total-sales');
    const aggReimbursement = document.getElementById('agg-reimbursement');

    // --- Init ---
    init();

    async function init() {
        setupFilterOptions();
        await fetchMasters(); // Staff, etc.
        renderStaffOptions();

        // Sorting header listeners
        document.querySelectorAll('#sales-table th.sortable').forEach(th => {
            th.addEventListener('click', () => {
                const column = th.dataset.sort;
                const direction = currentSort.column === column && currentSort.direction === 'asc' ? 'desc' : 'asc';
                currentSort = { column, direction };
                updateSortIndicators('sales-table', column, direction);
                render();
            });
        });

        searchData();
    }

    function setupFilterOptions() {
        const now = new Date();
        const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
        const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);

        filterDateFrom.value = firstDay.toISOString().substring(0, 10);
        filterDateTo.value = lastDay.toISOString().substring(0, 10);
    }

    async function fetchMasters() {
        // Staff
        const sSnap = await db.collection('staff_members').get();
        sSnap.forEach(doc => {
            const s = doc.data();
            staffMap[s.staff_id] = s;
        });
    }

    function renderStaffOptions() {
        filterStaff.innerHTML = '<option value="">すべて</option>';
        Object.values(staffMap)
            .filter(s => s.status === '在籍')
            .forEach(s => {
                const opt = document.createElement('option');
                opt.value = s.staff_id;
                opt.textContent = s.staff_name;
                filterStaff.appendChild(opt);
            });
    }

    async function searchData() {
        // Loading
        listBody.innerHTML = '<tr><td colspan="8" class="no-data-cell">データを集計中...</td></tr>';

        const dateFrom = filterDateFrom.value;
        const dateTo = filterDateTo.value;

        try {
            // 1. Fetch Cases in Period
            let cQuery = db.collection('cases');
            // Use contract_date
            if (dateFrom) cQuery = cQuery.where('contract_date', '>=', dateFrom);
            if (dateTo) cQuery = cQuery.where('contract_date', '<=', dateTo);

            const cSnap = await cQuery.get();
            cases = cSnap.docs.map(d => d.data()).filter(c => c.status !== '取消');

            // 2. Fetch Related Data
            if (cases.length === 0) {
                salesData = [];
                // Check payments even if no sales? Yes, for cash flow.
                // But logically, "Sales List" usually implies Sales.
                // However, "Summary" has "Payment Status". 
                // Let's fetch payments anyway.
                await fetchPeriodPayments(dateFrom, dateTo);
                render();
                return;
            }

            const caseIds = cases.map(c => c.case_id);
            const customerIds = [...new Set(cases.map(c => c.customer_id))];

            // Fetch Customers
            const custChunks = [];
            for (let i = 0; i < customerIds.length; i += 10) custChunks.push(customerIds.slice(i, i + 10));

            if (custChunks.length > 0) {
                const custSnaps = await Promise.all(custChunks.map(ids => db.collection('customers').where('customer_id', 'in', ids).get()));
                customersMap = {};
                custSnaps.forEach(snap => snap.forEach(d => {
                    const c = d.data();
                    customersMap[c.customer_id] = c;
                }));
            }

            // Fetch Invoice Items for these Cases
            // Note: Invoice Items have `case_id`.
            const itemChunks = [];
            for (let i = 0; i < caseIds.length; i += 10) itemChunks.push(caseIds.slice(i, i + 10));

            if (itemChunks.length > 0) {
                const itemSnaps = await Promise.all(itemChunks.map(ids => db.collection('invoice_items').where('case_id', 'in', ids).get()));

                invoiceItemsMap = {};
                itemSnaps.forEach(snap => snap.forEach(d => {
                    const item = d.data();
                    if (!invoiceItemsMap[item.case_id]) invoiceItemsMap[item.case_id] = [];
                    invoiceItemsMap[item.case_id].push(item);
                }));
            }

            // Fetch Payments (For Period Cash Flow)
            await fetchPeriodPayments(dateFrom, dateTo);

            // 3. Aggregate
            salesData = cases.map(c => {
                const items = invoiceItemsMap[c.case_id] || [];
                const hasItems = items.length > 0;

                let fee = 0;
                let tax = 0;
                let reimbursement = 0;
                let status = '見込';

                if (hasItems) {
                    status = '確定';
                    items.forEach(item => {
                        const amt = Number(item.amount) || 0;
                        if (item.item_type === '報酬') {
                            fee += amt;
                            if (item.is_taxable) {
                                tax += Math.floor(amt * 0.1);
                            }
                        } else if (item.item_type === '立替金' || item.item_type === '実費') {
                            reimbursement += amt;
                        }
                    });
                } else {
                    status = '見込';
                    fee = Number(c.estimated_fee) || 0;
                    tax = Math.floor(fee * 0.1);
                    reimbursement = Number(c.reimbursement_fee) || 0;
                }

                return {
                    case_id: c.case_id,
                    contract_date: c.contract_date,
                    customer_name: customersMap[c.customer_id]?.customer_name || '',
                    case_name: `${c.procedure_name} (${c.license_type || ''})`,
                    fee,
                    tax,
                    total_sales: fee + tax,
                    reimbursement,
                    staff_id: c.field_staff_id,
                    status
                };
            });

            render();

        } catch (error) {
            console.error('Search Error:', error);
            listBody.innerHTML = '<tr><td colspan="8" class="no-data-cell error">エラーが発生しました: ' + error.message + '</td></tr>';
        }
    }

    async function fetchPeriodPayments(dateFrom, dateTo) {
        let pQuery = db.collection('payments');
        if (dateFrom) pQuery = pQuery.where('payment_date', '>=', dateFrom);
        if (dateTo) pQuery = pQuery.where('payment_date', '<=', dateTo);

        const pSnap = await pQuery.get();
        const periodPayments = pSnap.docs.map(d => d.data());

        totalPeriodPaid = periodPayments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
    }

    // --- Helper for Filtering ---
    function getFilteredData() {
        const custFilter = filterCustomer.value.toLowerCase();
        const staffFilter = filterStaff.value;

        // 1. Filter
        let filtered = salesData.filter(d => {
            const mCust = d.customer_name.toLowerCase().includes(custFilter);
            const mStaff = staffFilter ? String(d.staff_id) === staffFilter : true;
            return mCust && mStaff;
        });

        // 2. Sort
        filtered = handleSort('sales-table', filtered, currentSort.column, 'string', currentSort.direction);

        return filtered;
    }

    function render() {
        // use helper
        const filtered = getFilteredData();

        // List Render
        listBody.innerHTML = '';
        if (filtered.length === 0) {
            listBody.innerHTML = '<tr><td colspan="8" class="no-data-cell">該当する売上データはありません。</td></tr>';
        } else {
            filtered.forEach(item => {
                const tr = document.createElement('tr');
                tr.style.cursor = 'pointer';
                tr.addEventListener('click', () => { window.location.href = `detail.html?id=${item.case_id}`; });

                let statusClass = item.status === '確定' ? 'status-junin' : 'status-sodan';

                tr.innerHTML = `
                    <td>${formatDate(item.contract_date)}</td>
                    <td>${formatDisplayValue(item.customer_name)}</td>
                    <td>${formatDisplayValue(item.case_name)}</td>
                    <td class="text-right">${formatCurrency(item.fee)}</td>
                    <td class="text-right">${formatCurrency(item.tax)}</td>
                    <td class="text-right font-bold">${formatCurrency(item.total_sales)}</td>
                    <td class="text-right text-muted">${formatCurrency(item.reimbursement)}</td>
                    <td class="text-center"><span class="badge ${statusClass}">${item.status}</span></td>
                `;
                listBody.appendChild(tr);
            });
        }

        // Aggregates
        const totalFee = filtered.reduce((s, i) => s + i.fee, 0);
        const totalTax = filtered.reduce((s, i) => s + i.tax, 0);
        const totalSales = totalFee + totalTax;
        const totalReimbursement = filtered.reduce((s, i) => s + i.reimbursement, 0);

        const from = filterDateFrom.value.replace(/-/g, '/');
        const to = filterDateTo.value.replace(/-/g, '/');

        aggTitle.textContent = `${from} 〜 ${to} 集計 (表示分)`;
        aggFee.textContent = formatCurrency(totalFee);
        aggTax.textContent = formatCurrency(totalTax);
        aggTotalSales.textContent = formatCurrency(totalSales);
        aggReimbursement.textContent = formatCurrency(totalReimbursement);

        // Summary View Update
        renderSummaryView(filtered, totalFee, totalTax, totalSales, totalReimbursement, totalPeriodPaid);
    }

    function renderSummaryView(data, fee, tax, sales, reimb, periodPaid) {
        const summaryContent = document.getElementById('summary-content');

        const unpaid = sales - (periodPaid || 0);

        // Staff stats
        const staffStats = {};
        data.forEach(item => {
            const sid = item.staff_id || 0;
            if (!staffStats[sid]) {
                const sName = staffMap[sid]?.staff_name || '（担当なし）';
                staffStats[sid] = { name: sName, count: 0, sales: 0, reimb: 0 };
            }
            staffStats[sid].count++;
            staffStats[sid].sales += item.total_sales;
            staffStats[sid].reimb += item.reimbursement;
        });

        let staffHtml = '';
        Object.values(staffStats).forEach(s => {
            staffHtml += `
            <tr>
                <td>${s.name}</td>
                <td>${s.count}件</td>
                <td>${formatCurrency(s.sales)}</td>
                <td>${formatCurrency(s.reimb)}</td>
            </tr>`;
        });

        const fromDisplay = filterDateFrom.value.replace(/-/g, '/');
        const toDisplay = filterDateTo.value.replace(/-/g, '/');

        summaryContent.innerHTML = `
            <div class="summary-header">売上サマリー：${fromDisplay} 〜 ${toDisplay}</div>
            
            <h3 style="margin-top: 10px; border-bottom: 1px solid #ddd; padding-bottom: 5px;">■ 売上</h3>
            <div class="summary-row"><span>報酬（税抜）</span><span>${formatCurrency(fee)}</span></div>
            <div class="summary-row"><span>消費税</span><span>${formatCurrency(tax)}</span></div>
            <div class="summary-row total"><span>売上合計</span><span>${formatCurrency(sales)}</span></div>

            <h3 style="margin-top: 24px; border-bottom: 1px solid #ddd; padding-bottom: 5px;">■ 立替金（参考）</h3>
            <div class="summary-row"><span>立替金合計</span><span>${formatCurrency(reimb)}</span></div>

            <h3 style="margin-top: 24px; border-bottom: 1px solid #ddd; padding-bottom: 5px;">■ 入金状況 (期間全体)</h3>
            <div class="summary-row"><span>期間内入金計</span><span>${formatCurrency(periodPaid || 0)}</span></div>
            <div class="summary-row" style="color: ${unpaid > 0 ? '#e11d48' : 'inherit'}"><span>未回収（期間売上 - 期間入金）</span><span>${formatCurrency(unpaid)}</span></div>

            <h3 style="margin-top: 24px; border-bottom: 1px solid #ddd; padding-bottom: 5px;">■ 担当者別売上</h3>
            <table style="width: 100%; border-collapse: collapse; margin-top: 8px;">
                <thead style="background: #f1f5f9;">
                    <tr>
                        <th style="padding: 8px; text-align: left; font-size: 0.85rem;">担当者</th>
                        <th style="padding: 8px; text-align: left; font-size: 0.85rem;">件数</th>
                        <th style="padding: 8px; text-align: left; font-size: 0.85rem;">売上合計</th>
                        <th style="padding: 8px; text-align: left; font-size: 0.85rem;">立替金</th>
                    </tr>
                </thead>
                <tbody>${staffHtml}</tbody>
            </table>
        `;
    }

    // --- Export ---
    function exportPDF() {
        const filtered = getFilteredData();
        if (filtered.length === 0) {
            alert('出力対象のデータがありません');
            return;
        }

        // Populate Template
        const totalFee = filtered.reduce((s, i) => s + i.fee, 0);
        const totalTax = filtered.reduce((s, i) => s + i.tax, 0);
        const totalSales = totalFee + totalTax;
        const totalReimbursement = filtered.reduce((s, i) => s + i.reimbursement, 0);
        const unpaid = totalSales - totalPeriodPaid;

        const from = filterDateFrom.value.replace(/-/g, '/');
        const to = filterDateTo.value.replace(/-/g, '/');

        document.getElementById('p-print-now').textContent = new Date().toLocaleString();
        document.getElementById('p-period').textContent = `${from} 〜 ${to}`;
        document.getElementById('p-total-sales').textContent = formatCurrency(totalSales);
        document.getElementById('p-total-fee').textContent = formatCurrency(totalFee);
        document.getElementById('p-total-tax').textContent = formatCurrency(totalTax);
        document.getElementById('p-total-reimbursement').textContent = formatCurrency(totalReimbursement);
        document.getElementById('p-total-paid').textContent = formatCurrency(totalPeriodPaid);
        document.getElementById('p-total-unpaid').textContent = formatCurrency(unpaid);

        // List Body
        const tbody = document.getElementById('p-sales-body');
        tbody.innerHTML = filtered.map(item => `
            <tr>
                <td style="border:1px solid #ddd;padding:6px;">${formatDate(item.contract_date)}</td>
                <td style="border:1px solid #ddd;padding:6px;">${item.customer_name}</td>
                <td style="border:1px solid #ddd;padding:6px;">${item.case_name}</td>
                <td style="border:1px solid #ddd;padding:6px;text-align:right;">${formatCurrency(item.fee)}</td>
                <td style="border:1px solid #ddd;padding:6px;text-align:right;">${formatCurrency(item.tax)}</td>
                <td style="border:1px solid #ddd;padding:6px;text-align:right;">${formatCurrency(item.total_sales)}</td>
            </tr>
        `).join('');

        // Staff Body
        const staffStats = {};
        filtered.forEach(item => {
            const sid = item.staff_id || 0;
            if (!staffStats[sid]) {
                const sName = staffMap[sid]?.staff_name || '（担当なし）';
                staffStats[sid] = { name: sName, count: 0, sales: 0, reimb: 0 };
            }
            staffStats[sid].count++;
            staffStats[sid].sales += item.total_sales;
            staffStats[sid].reimb += item.reimbursement;
        });
        const staffBody = document.getElementById('p-staff-body');
        staffBody.innerHTML = Object.values(staffStats).map(s => `
            <tr>
                <td style="border:1px solid #ddd;padding:6px;">${s.name}</td>
                <td style="border:1px solid #ddd;padding:6px;text-align:right;">${s.count}</td>
                <td style="border:1px solid #ddd;padding:6px;text-align:right;">${formatCurrency(s.sales)}</td>
                <td style="border:1px solid #ddd;padding:6px;text-align:right;">${formatCurrency(s.reimb)}</td>
            </tr>
        `).join('');


        // Run html2pdf
        const element = document.getElementById('print-template-sales');
        element.style.display = 'block';

        html2pdf(element, {
            margin: 10,
            filename: `売上帳票_${from.replace(/\//g, '')}-${to.replace(/\//g, '')}.pdf`,
            image: { type: 'jpeg', quality: 0.98 },
            html2canvas: { scale: 2 },
            jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
        }).then(() => {
            element.style.display = 'none';
        });
    }

    function exportExcel() {
        const filtered = getFilteredData();
        if (filtered.length === 0) {
            alert('出力対象のデータがありません');
            return;
        }

        const wb = XLSX.utils.book_new();
        const from = filterDateFrom.value;
        const to = filterDateTo.value;

        // --- Sheet 1: Sales List ---
        const listData = filtered.map(item => ({
            "売上日": item.contract_date,
            "顧客名": item.customer_name,
            "案件名": item.case_name,
            "報酬(税抜)": item.fee,
            "消費税": item.tax,
            "売上計": item.total_sales,
            "立替金": item.reimbursement,
            "担当者": staffMap[item.staff_id]?.staff_name || '',
            "ステータス": item.status
        }));
        const wsList = XLSX.utils.json_to_sheet(listData);
        XLSX.utils.book_append_sheet(wb, wsList, "売上明細");

        // --- Sheet 2: Summary ---
        // Calc Totals
        const totalFee = filtered.reduce((s, i) => s + i.fee, 0);
        const totalTax = filtered.reduce((s, i) => s + i.tax, 0);
        const totalSales = totalFee + totalTax;
        const totalReimbursement = filtered.reduce((s, i) => s + i.reimbursement, 0);
        const unpaid = totalSales - totalPeriodPaid;

        const summaryRows = [
            ["項目", "金額", "備考"],
            ["集計期間", `${from} 〜 ${to}`, ""],
            ["報酬合計(税抜)", totalFee, ""],
            ["消費税", totalTax, ""],
            ["売上合計", totalSales, "報酬+消費税"],
            ["立替金合計", totalReimbursement, ""],
            ["期間内入金計", totalPeriodPaid, "期間内の全入金"],
            ["未回収(参考)", unpaid, "売上計 - 入金計"],
            ["", "", ""], // Spacer
            ["【担当者別集計】", "", ""],
            ["担当者", "件数", "売上合計"]
        ];

        // Staff Aggregation for Excel
        const staffStats = {};
        filtered.forEach(item => {
            const sid = item.staff_id || 0;
            if (!staffStats[sid]) {
                const sName = staffMap[sid]?.staff_name || '（担当なし）';
                staffStats[sid] = { name: sName, count: 0, sales: 0 };
            }
            staffStats[sid].count++;
            staffStats[sid].sales += item.total_sales;
        });

        Object.values(staffStats).forEach(s => {
            summaryRows.push([s.name, s.count, s.sales]);
        });

        const wsSummary = XLSX.utils.aoa_to_sheet(summaryRows);
        XLSX.utils.book_append_sheet(wb, wsSummary, "サマリー");

        // Download
        XLSX.writeFile(wb, `売上管理_${from.replace(/-/g, '')}-${to.replace(/-/g, '')}.xlsx`);
    }

    // --- Events ---
    [filterDateFrom, filterDateTo].forEach(el => el.addEventListener('change', searchData));
    [filterCustomer, filterStaff].forEach(el => el.addEventListener('input', render));

    if (btnExcelExport) btnExcelExport.addEventListener('click', exportExcel);
    if (btnPdfExport) btnPdfExport.addEventListener('click', exportPDF);

    // Tab Switching
    tabList.addEventListener('click', () => {
        tabList.classList.add('active');
        tabSummary.classList.remove('active');
        viewList.style.display = 'block';
        monthlyAggArea.style.display = 'flex';
        viewSummary.style.display = 'none';
    });

    tabSummary.addEventListener('click', () => {
        tabList.classList.remove('active');
        tabSummary.classList.add('active');
        viewList.style.display = 'none';
        monthlyAggArea.style.display = 'none';
        viewSummary.style.display = 'block';
    });
});
