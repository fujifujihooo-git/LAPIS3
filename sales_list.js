document.addEventListener('DOMContentLoaded', () => {
    // --- State ---
    let cases = [];
    let salesData = [];
    let currentSort = { column: 'contract_date', direction: 'desc' };

    // Caches
    let customersMap = {};
    let staffMap = {};
    let invoiceItemsMap = {};
    let totalPeriodPaid = 0;

    // --- Selectors ---
    const listBody = document.getElementById('sales-list-body');
    const filterDateStart = document.getElementById('filter-date-start');
    const filterDateEnd = document.getElementById('filter-date-end');
    const filterCustomer = document.getElementById('filter-customer');
    const filterStaff = document.getElementById('filter-staff');
    const btnExcelExport = document.getElementById('btn-export-csv');
    const btnPdfExport = document.getElementById('btn-pdf-export');
    const btnSearchExecute = document.getElementById('btn-search-execute');

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
        await fetchMasters();
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
        if (!filterDateStart || !filterDateEnd) return;
        const now = new Date();
        const y = now.getFullYear();
        const m = String(now.getMonth() + 1).padStart(2, '0');
        // デフォルトを今月の月初〜末日に設定
        const lastDay = new Date(y, Number(m), 0).getDate();
        filterDateStart.value = `${y}-${m}-01`;
        filterDateEnd.value = `${y}-${m}-${String(lastDay).padStart(2, '0')}`;
    }

    async function fetchMasters() {
        // ★ コレクション名は 'staff' が正しい (他画面と統一)
        try {
            const sSnap = await db.collection('staff').get();
            sSnap.forEach(doc => {
                const s = doc.data();
                staffMap[s.staff_id] = s;
            });
            console.log(`[Sales List] スタッフマスタ取得: ${Object.keys(staffMap).length}件`);
        } catch (e) {
            console.warn('[Sales List] スタッフ取得エラー:', e.message);
        }
    }

    function renderStaffOptions() {
        if (!filterStaff) return;
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

    // ================================================================
    // searchData: メインのデータ取得・集約処理
    // ================================================================
    async function searchData() {
        // Loading UI
        if (listBody) {
            listBody.innerHTML = '<tr><td colspan="5" class="no-data-cell">データを集計中...</td></tr>';
        }
        if (btnSearchExecute) {
            btnSearchExecute.disabled = true;
            btnSearchExecute.innerHTML = '<i data-lucide="loader-2" class="spin"></i> 集計中...';
            if (typeof lucide !== 'undefined') lucide.createIcons();
        }

        // ── フィルタ値の取得 ──
        const dateFrom = filterDateStart?.value || '';
        const dateTo = filterDateEnd?.value || '';

        console.log(`[Sales List] ========== 集計開始 ==========`);
        console.log(`[Sales List] 検索期間: ${dateFrom || '指定なし'} ～ ${dateTo || '指定なし'}`);

        try {
            // ================================================================
            // 1. 案件(cases)コレクションから「受任日(contract_date)」で範囲検索
            //    ※ Firestore上のフィールド名:
            //       受任日 = contract_date  (YYYY-MM-DD 文字列)
            //       見積金額(課税) = estimated_fee  (number)
            //       仮受金 = suspense_receipt_amount (旧: reimbursement_fee)  (number)
            // ================================================================
            let cQuery = db.collection('cases');
            if (dateFrom) cQuery = cQuery.where('contract_date', '>=', dateFrom);
            if (dateTo) cQuery = cQuery.where('contract_date', '<=', dateTo);

            const cSnap = await cQuery.get();
            const fetchedCases = cSnap.docs.map(d => d.data());
            console.log(`[Sales List] Firestore取得件数 (contract_date ${dateFrom}～${dateTo}): ${fetchedCases.length}件`);

            // デバッグ: 全件の主要フィールドを出力
            fetchedCases.forEach((c, i) => {
                console.log(`[Sales List]   [${i}] case_id=${c.case_id}, contract_date=${c.contract_date}, ` +
                    `status=${c.status}, estimated_fee=${c.estimated_fee}, ` +
                    `procedure_name=${c.procedure_name}, license_type=${c.license_type}`);
            });

            // ================================================================
            // 2. フィルタ条件:
            //    ★★★ ユーザーのビジネスロジック: 「受任した時点で売上計上」 ★★★
            //    - 唯一の除外条件: ステータスが「取消」の案件のみ除外
            //    - estimated_fee が 0 や未入力でも表示する（見積未入力の案件も売上一覧に出す）
            //    - 完了日やその他のステータスによるフィルタは行わない
            // ================================================================
            cases = fetchedCases.filter(c => {
                if (c.status === '取消') {
                    console.log(`[Sales List] フィルタ除外(取消): case_id=${c.case_id}`);
                    return false;
                }
                return true;
            });
            console.log(`[Sales List] 売上対象件数 (フィルタ後): ${cases.length}件`);

            // 3. 関連データの取得
            if (cases.length === 0) {
                salesData = [];
                await fetchPeriodPayments(dateFrom, dateTo);
                render();
                return;
            }

            // ★★★ undefined/null を除外してからクエリに渡す（エラー防止の核心） ★★★
            const caseIds = cases.map(c => c.case_id).filter(id => id !== undefined && id !== null);
            const customerIds = [...new Set(cases.map(c => c.customer_id).filter(id => id !== undefined && id !== null))];

            console.log(`[Sales List] caseIds (${caseIds.length}件):`, caseIds);
            console.log(`[Sales List] customerIds (${customerIds.length}件):`, customerIds);

            // 顧客データ取得（customer_id が存在する場合のみ）
            customersMap = {};
            if (customerIds.length > 0) {
                try {
                    const custChunks = [];
                    for (let i = 0; i < customerIds.length; i += 10) custChunks.push(customerIds.slice(i, i + 10));
                    const custSnaps = await Promise.all(
                        custChunks.map(ids => {
                            console.log(`[Sales List] 顧客クエリ発行: customer_id in`, ids);
                            return db.collection('customers').where('customer_id', 'in', ids).get();
                        })
                    );
                    custSnaps.forEach(snap => snap.forEach(d => {
                        const c = d.data();
                        customersMap[c.customer_id] = c;
                    }));
                    console.log(`[Sales List] 顧客マスタ取得完了: ${Object.keys(customersMap).length}件`);
                } catch (custErr) {
                    console.error('[Sales List] 顧客データ取得エラー:', custErr.message);
                    console.error('[Sales List]   → customerIds:', customerIds);
                }
            }

            // 請求明細データ取得（case_id が存在する場合のみ）
            invoiceItemsMap = {};
            if (caseIds.length > 0) {
                try {
                    const itemChunks = [];
                    for (let i = 0; i < caseIds.length; i += 10) itemChunks.push(caseIds.slice(i, i + 10));
                    const itemSnaps = await Promise.all(
                        itemChunks.map(ids => {
                            console.log(`[Sales List] 請求明細クエリ発行: case_id in`, ids);
                            return db.collection('invoice_items').where('case_id', 'in', ids).get();
                        })
                    );
                    itemSnaps.forEach(snap => snap.forEach(d => {
                        const item = d.data();
                        if (!invoiceItemsMap[item.case_id]) invoiceItemsMap[item.case_id] = [];
                        invoiceItemsMap[item.case_id].push(item);
                    }));
                    console.log(`[Sales List] 請求明細取得完了: ${Object.keys(invoiceItemsMap).length}件`);
                } catch (itemErr) {
                    console.error('[Sales List] 請求明細取得エラー:', itemErr.message);
                    console.error('[Sales List]   → caseIds:', caseIds);
                }
            }

            // 入金データ取得
            await fetchPeriodPayments(dateFrom, dateTo);

            // ================================================================
            // 4. salesData へのマッピング
            //    - 請求明細がある場合: 明細から金額を積算 (確定)
            //    - 請求明細がない場合: estimated_fee を見込売上として使用
            // ================================================================
            salesData = cases.map(c => {
                const items = invoiceItemsMap[c.case_id] || [];
                const hasItems = items.length > 0;

                let fee = 0;
                let tax = 0;
                let reimbursement = 0;
                let status = '見込';

                if (hasItems) {
                    // 請求明細がある場合 → 確定金額
                    status = '確定';
                    items.forEach(item => {
                        const amt = Number(item.amount) || 0;
                        if (item.item_type === '手数料' || item.item_type === '報酬') {
                            fee += amt;
                            if (item.is_taxable) {
                                tax += Math.floor(amt * 0.1);
                            }
                        } else if (item.item_type === '仮受金' || item.item_type === '立替金' || item.item_type === '実費') {
                            reimbursement += amt;
                        }
                    });
                } else {
                    // 見積から取得 (estimated_fee は見積明細の課税合計)
                    status = '見込';
                    fee = Number(c.estimated_fee) || 0;
                    tax = Math.floor(fee * 0.1);
                    reimbursement = Number(c.suspense_receipt_amount) || Number(c.reimbursement_fee) || 0;
                }

                const feeTaxIncluded = fee + tax;
                const totalAmount = feeTaxIncluded + reimbursement;

                const entry = {
                    case_id: c.case_id,
                    contract_date: c.contract_date || '',
                    customer_name: customersMap[c.customer_id]?.customer_name || c.customer_name || '',
                    case_name: `${c.procedure_name || ''} (${c.license_type || ''})`,
                    fee,
                    tax,
                    fee_tax_included: feeTaxIncluded,
                    total_sales: feeTaxIncluded, // 既存ロジック互換用
                    reimbursement,
                    total_amount: totalAmount,
                    staff_id: c.field_staff_id,
                    staff_name: staffMap[c.field_staff_id]?.staff_name || '',
                    status
                };

                return entry;
            });

            console.log(`[Sales List] salesData 生成完了: ${salesData.length}件`);
            console.log(`[Sales List] ========== 集計完了 ==========`);
            render();

        } catch (error) {
            console.error('[Sales List] 検索エラー:', error);
            if (listBody) {
                listBody.innerHTML = '<tr><td colspan="5" class="no-data-cell error">エラーが発生しました: ' + error.message + '</td></tr>';
            }
        } finally {
            if (btnSearchExecute) {
                btnSearchExecute.disabled = false;
                btnSearchExecute.innerHTML = '<i data-lucide="search"></i> 集計実行';
                if (typeof lucide !== 'undefined') lucide.createIcons();
            }
        }
    }

    async function fetchPeriodPayments(dateFrom, dateTo) {
        try {
            // payments -> receiptAllocations に変更。
            // 実際はreceipts自体を引く運用もあるが、売上対比の「消込済み」入金としてAllocationsを利用する
            let pQuery = db.collection('receiptAllocations').where('status', '==', 'active');
            if (dateFrom) pQuery = pQuery.where('receiptDate', '>=', dateFrom);
            if (dateTo) pQuery = pQuery.where('receiptDate', '<=', dateTo);

            const pSnap = await pQuery.get();
            const periodPayments = pSnap.docs.map(d => d.data());
            totalPeriodPaid = periodPayments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
        } catch (e) {
            console.warn('[Sales List] 入金データ取得エラー:', e.message);
            totalPeriodPaid = 0;
        }
    }

    // --- フィルタリング (顧客名・担当者の絞り込み) ---
    function getFilteredData() {
        const custFilter = filterCustomer ? filterCustomer.value.toLowerCase() : '';
        const staffFilter = filterStaff ? filterStaff.value : '';

        let filtered = salesData.filter(d => {
            const mCust = d.customer_name.toLowerCase().includes(custFilter);
            const mStaff = staffFilter ? String(d.staff_id) === staffFilter : true;
            return mCust && mStaff;
        });

        filtered = handleSort('sales-table', filtered, currentSort.column, 'string', currentSort.direction);

        return filtered;
    }

    // --- レンダリング ---
    function render() {
        const filtered = getFilteredData();

        if (!listBody) return;
        listBody.innerHTML = '';

        if (filtered.length === 0) {
            listBody.innerHTML = '<tr><td colspan="5" class="no-data-cell">該当する売上データはありません。</td></tr>';
        } else {
            filtered.forEach(item => {
                const tr = document.createElement('tr');
                tr.style.cursor = 'pointer';
                tr.addEventListener('click', () => { window.location.href = `detail.html?id=${item.case_id}`; });
                tr.innerHTML = `
                    <td>${formatDate(item.contract_date)}</td>
                    <td>${formatDisplayValue(item.customer_name)}</td>
                    <td>${formatDisplayValue(item.case_name)}</td>
                    <td class="text-right">${formatCurrency(item.reimbursement)}</td>
                    <td class="text-right">${formatCurrency(item.fee_tax_included)}</td>
                    <td class="text-right" style="font-weight: 600; color: var(--primary);">${formatCurrency(item.total_amount)}</td>
                    <td>${formatDisplayValue(item.staff_name)}</td>
                `;
                listBody.appendChild(tr);
            });
        }

        // 集計値
        const totalFee = filtered.reduce((s, i) => s + (Number(i.fee) || 0), 0);
        const totalTax = filtered.reduce((s, i) => s + (Number(i.tax) || 0), 0);
        const totalSales = totalFee + totalTax;
        const totalReimbursement = filtered.reduce((s, i) => s + (Number(i.reimbursement) || 0), 0);

        const dateStart = filterDateStart?.value || '';
        const dateEnd = filterDateEnd?.value || '';
        const displayPeriod = (dateStart && dateEnd) ? `${dateStart} 〜 ${dateEnd}` : '全期間';

        if (aggTitle) aggTitle.textContent = `${displayPeriod} 集計 (表示分)`;

        // サマリーカード
        const elTotalSales = document.getElementById('val-total-sales');
        const elTotalCount = document.getElementById('val-total-count');
        if (elTotalSales) elTotalSales.textContent = formatCurrency(totalFee);
        if (elTotalCount) elTotalCount.textContent = `${filtered.length}件`;

        if (aggFee) aggFee.textContent = formatCurrency(totalFee);
        if (aggTax) aggTax.textContent = formatCurrency(totalTax);
        if (aggTotalSales) aggTotalSales.textContent = formatCurrency(totalSales);
        if (aggReimbursement) aggReimbursement.textContent = formatCurrency(totalReimbursement);

        // サマリービュー
        const summaryContent = document.getElementById('summary-content');
        if (summaryContent) {
            renderSummaryView(filtered, totalFee, totalTax, totalSales, totalReimbursement, totalPeriodPaid);
        }
    }

    function renderSummaryView(data, fee, tax, sales, reimb, periodPaid) {
        const summaryContent = document.getElementById('summary-content');
        if (!summaryContent) return;

        const unpaid = sales - (periodPaid || 0);

        // 担当者別
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

        const dateStart = filterDateStart?.value || '';
        const dateEnd = filterDateEnd?.value || '';
        const displayPeriod = (dateStart && dateEnd) ? `${dateStart} 〜 ${dateEnd}` : '全期間';

        summaryContent.innerHTML = `
            <div class="summary-header">売上サマリー：${displayPeriod}</div>
            <h3 style="margin-top: 10px; border-bottom: 1px solid #ddd; padding-bottom: 5px;">■ 売上</h3>
            <div class="summary-row"><span>手数料（税抜）</span><span>${formatCurrency(fee)}</span></div>
            <div class="summary-row"><span>消費税</span><span>${formatCurrency(tax)}</span></div>
            <div class="summary-row total"><span>売上合計</span><span>${formatCurrency(sales)}</span></div>

            <h3 style="margin-top: 24px; border-bottom: 1px solid #ddd; padding-bottom: 5px;">■ 仮受金（参考）</h3>
            <div class="summary-row"><span>仮受金合計</span><span>${formatCurrency(reimb)}</span></div>

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
                        <th style="padding: 8px; text-align: left; font-size: 0.85rem;">仮受金</th>
                    </tr>
                </thead>
                <tbody>${staffHtml}</tbody>
            </table>
        `;
    }

    // --- Excel エクスポート ---
    function exportExcel() {
        const filtered = getFilteredData();
        if (filtered.length === 0) {
            alert('出力対象のデータがありません');
            return;
        }

        if (typeof XLSX === 'undefined') {
            alert('Excelエクスポートライブラリが読み込まれていません');
            return;
        }

        const dateStart = filterDateStart?.value || '';
        const dateEnd = filterDateEnd?.value || '';
        const displayPeriod = (dateStart && dateEnd) ? `${dateStart} 〜 ${dateEnd}` : '全期間';

        // Sheet 1: 売上明細
        const listData = filtered.map(item => ({
            "売上日(受任日)": item.contract_date,
            "顧客名": item.customer_name,
            "案件名": item.case_name,
            "手数料(税抜)": item.fee,
            "消費税": item.tax,
            "売上計": item.total_sales,
            "仮受金": item.reimbursement,
            "担当者": item.staff_name,
            "ステータス": item.status
        }));
        const wsList = XLSX.utils.json_to_sheet(listData);
        XLSX.utils.book_append_sheet(wb, wsList, "売上明細");

        // Sheet 2: サマリー
        const totalFee = filtered.reduce((s, i) => s + (Number(i.fee) || 0), 0);
        const totalTax = filtered.reduce((s, i) => s + (Number(i.tax) || 0), 0);
        const totalSales = totalFee + totalTax;
        const totalReimbursement = filtered.reduce((s, i) => s + (Number(i.reimbursement) || 0), 0);
        const unpaid = totalSales - totalPeriodPaid;

        const summaryRows = [
            ["項目", "金額", "備考"],
            ["集計期間", displayYm, ""],
            ["手数料合計(税抜)", totalFee, ""],
            ["消費税", totalTax, ""],
            ["売上合計", totalSales, "手数料+消費税"],
            ["仮受金合計", totalReimbursement, ""],
            ["期間内入金計", totalPeriodPaid, "期間内の全入金"],
            ["未回収(参考)", unpaid, "売上計 - 入金計"],
            ["", "", ""],
            ["【担当者別集計】", "", ""],
            ["担当者", "件数", "売上合計"]
        ];

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

        const fnDate = dateStart ? dateStart.replace(/-/g, '') : 'all';
        XLSX.writeFile(wb, `売上管理_${fnDate}.xlsx`);
    }

    // --- イベントバインディング ---
    [filterDateStart, filterDateEnd].forEach(el => {
        if (el) el.addEventListener('change', searchData);
    });
    if (btnSearchExecute) btnSearchExecute.addEventListener('click', searchData);
    [filterCustomer, filterStaff].forEach(el => {
        if (el) el.addEventListener('input', render);
    });

    if (btnExcelExport) btnExcelExport.addEventListener('click', exportExcel);

    // タブ切替
    if (tabList) {
        tabList.addEventListener('click', () => {
            tabList.classList.add('active');
            if (tabSummary) tabSummary.classList.remove('active');
            if (viewList) viewList.style.display = 'block';
            if (monthlyAggArea) monthlyAggArea.style.display = 'flex';
            if (viewSummary) viewSummary.style.display = 'none';
        });
    }

    if (tabSummary) {
        tabSummary.addEventListener('click', () => {
            if (tabList) tabList.classList.remove('active');
            tabSummary.classList.add('active');
            if (viewList) viewList.style.display = 'none';
            if (monthlyAggArea) monthlyAggArea.style.display = 'none';
            if (viewSummary) viewSummary.style.display = 'block';
        });
    }

    // ================================================================
    // ■ 財務スナップショット ダッシュボード (疎結合セクション)
    //   FinancialService モジュール (financial_service.js) と連携
    // ================================================================

    const DashboardUI = (() => {
        // --- Selectors ---
        const closingDateInput = document.getElementById('snapshot-closing-date');
        const btnExecute = document.getElementById('btn-snapshot-execute');
        const cardsContainer = document.getElementById('snapshot-cards');
        const initialMsg = document.getElementById('snapshot-initial-msg');
        const detailWrapper = document.getElementById('snapshot-detail-wrapper');
        const detailTitle = document.getElementById('snapshot-detail-title');
        const detailBody = document.getElementById('snapshot-detail-body');
        const btnCloseDetail = document.getElementById('btn-close-snapshot-detail');

        // --- State ---
        let snapshotResult = null;
        let activeCategory = null;

        // --- Init ---
        if (closingDateInput) {
            // デフォルトを本日に設定
            const now = new Date();
            const y = now.getFullYear();
            const m = String(now.getMonth() + 1).padStart(2, '0');
            const d = String(now.getDate()).padStart(2, '0');
            closingDateInput.value = `${y}-${m}-${d}`;
        }

        /**
         * カードの数値を更新
         */
        function updateCards(summary) {
            if (!summary) return;

            const categories = ['ar', 'expenses', 'advances', 'prospects'];
            categories.forEach(cat => {
                const data = summary[cat];
                const amountEl = document.getElementById(`snapshot-${cat}-amount`);
                const countEl = document.getElementById(`snapshot-${cat}-count`);
                if (amountEl) amountEl.textContent = formatCurrency(data.total);
                if (countEl) countEl.textContent = `${data.count}件`;
            });

            // カードを表示
            if (cardsContainer) cardsContainer.style.display = 'grid';
            if (initialMsg) initialMsg.style.display = 'none';
        }

        /**
         * 明細テーブルを描画
         */
        function renderDetailList(category, items) {
            if (!detailBody || !detailWrapper) return;

            const labels = {
                ar: '売掛金',
                expenses: '立替金',
                advances: '前受金 (仮受金)',
                prospects: '見込'
            };

            if (detailTitle) {
                detailTitle.textContent = `${labels[category] || category} 明細 (${items.length}件)`;
            }

            detailBody.innerHTML = '';

            if (items.length === 0) {
                detailBody.innerHTML = '<tr><td colspan="6" class="no-data-cell">該当するデータはありません。</td></tr>';
            } else {
                items.forEach(item => {
                    const tr = document.createElement('tr');
                    const elapsedDisplay = item.elapsedDays !== undefined
                        ? `${item.elapsedDays}日`
                        : 'ー';
                    const elapsedColor = item.elapsedDays > 90 ? 'color: #ef4444; font-weight: 600;'
                        : item.elapsedDays > 30 ? 'color: #f59e0b; font-weight: 600;'
                        : '';

                    tr.innerHTML = `
                        <td>${formatDisplayValue(item.customerName)}</td>
                        <td>${formatDisplayValue(item.caseName)}</td>
                        <td class="text-right" style="font-weight: 700; color: var(--primary);">${formatCurrency(item.amount)}</td>
                        <td class="text-right">${formatCurrency(item.originalAmount)}</td>
                        <td class="text-right">${formatCurrency(item.allocatedAmount)}</td>
                        <td class="text-right" style="${elapsedColor}">${elapsedDisplay}</td>
                    `;
                    detailBody.appendChild(tr);
                });

                // 合計行
                const totalAmount = items.reduce((s, i) => s + (i.amount || 0), 0);
                const trTotal = document.createElement('tr');
                trTotal.style.background = '#f8fafc';
                trTotal.style.fontWeight = '700';
                trTotal.innerHTML = `
                    <td>合計</td>
                    <td></td>
                    <td class="text-right" style="color: var(--primary);">${formatCurrency(totalAmount)}</td>
                    <td></td>
                    <td></td>
                    <td></td>
                `;
                detailBody.appendChild(trTotal);
            }

            // 表示切替
            detailWrapper.classList.add('visible');

            // スクロール
            detailWrapper.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }

        /**
         * カードの選択状態を更新
         */
        function setActiveCard(category) {
            activeCategory = category;
            const allCards = document.querySelectorAll('.snapshot-card');
            allCards.forEach(card => card.classList.remove('active'));
            const targetCard = document.getElementById(`card-${category}`);
            if (targetCard) targetCard.classList.add('active');
        }

        /**
         * スナップショット実行
         */
        async function executeSnapshot() {
            const closingDate = closingDateInput?.value;
            if (!closingDate) {
                alert('決算日を入力してください。');
                return;
            }

            // Loading state
            if (btnExecute) {
                btnExecute.disabled = true;
                btnExecute.innerHTML = '<i data-lucide="loader-2" class="spin"></i> 集計中...';
                if (typeof lucide !== 'undefined') lucide.createIcons();
            }

            try {
                // FinancialService からデータ取得+集計
                snapshotResult = await FinancialService.execute(closingDate);
                updateCards(snapshotResult.summary);

                // デフォルトで売掛金を選択
                setActiveCard('ar');
                renderDetailList('ar', snapshotResult.ar);

                if (typeof showToast === 'function') {
                    showToast(`${closingDate} 時点のスナップショットを生成しました`, 'success');
                }

            } catch (error) {
                console.error('[DashboardUI] スナップショットエラー:', error);
                alert('スナップショットの生成に失敗しました。\n' + error.message);
            } finally {
                if (btnExecute) {
                    btnExecute.disabled = false;
                    btnExecute.innerHTML = '<i data-lucide="camera"></i> スナップショット実行';
                    if (typeof lucide !== 'undefined') lucide.createIcons();
                }
            }
        }

        // --- Event Binding ---
        if (btnExecute) {
            btnExecute.addEventListener('click', executeSnapshot);
        }

        // カードクリック
        document.querySelectorAll('.snapshot-card').forEach(card => {
            card.addEventListener('click', () => {
                if (!snapshotResult) return;
                const category = card.dataset.category;
                setActiveCard(category);
                renderDetailList(category, snapshotResult[category] || []);
            });
        });

        // 明細閉じるボタン
        if (btnCloseDetail) {
            btnCloseDetail.addEventListener('click', () => {
                if (detailWrapper) detailWrapper.classList.remove('visible');
                const allCards = document.querySelectorAll('.snapshot-card');
                allCards.forEach(card => card.classList.remove('active'));
                activeCategory = null;
            });
        }

        return { executeSnapshot, updateCards, renderDetailList };
    })();

});
