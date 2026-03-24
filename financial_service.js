/**
 * FinancialService - 決算日ベース財務スナップショット計算モジュール
 * 
 * 責務: Firestoreからのデータ取得 + 4分類（売掛金・立替金・前受金・見込）の集計ロジック
 * 原則: UIやDOMには一切関与しない。純粋なデータ層。
 * 
 * 消込計算ルール:
 *   - allocations に明細単位（item_type）の紐付けがあればそれに従う
 *   - 紐付けがない場合は、請求書内の報酬/立替金額比率で按分（端数は四捨五入）
 *   - 時系列再現: allocatedAt (createdAt) <= closingDate を最優先判定基準とする
 *   - 金額計算はすべて整数で行い、端数は四捨五入で統一
 */
const FinancialService = (() => {
    'use strict';

    // ────────────────────────────────────────
    // 内部ヘルパー
    // ────────────────────────────────────────

    /**
     * closingDate（文字列 YYYY-MM-DD）をその日の終端（23:59:59.999）のDateに変換
     */
    function toEndOfDay(dateStr) {
        const d = new Date(dateStr + 'T23:59:59.999');
        return d;
    }

    /**
     * closingDate（文字列 YYYY-MM-DD）をその日の開始（00:00:00）のDateに変換
     */
    function toStartOfDay(dateStr) {
        return new Date(dateStr + 'T00:00:00');
    }

    /**
     * 経過日数を計算（発生日 → closingDate）
     * @param {string} originDateStr - 発生日 (YYYY-MM-DD)
     * @param {string} closingDateStr - 決算日 (YYYY-MM-DD)
     * @returns {number} 経過日数
     */
    function calcElapsedDays(originDateStr, closingDateStr) {
        if (!originDateStr || !closingDateStr) return 0;
        const origin = toStartOfDay(originDateStr);
        const closing = toStartOfDay(closingDateStr);
        const diffMs = closing.getTime() - origin.getTime();
        return Math.floor(diffMs / (1000 * 60 * 60 * 24));
    }

    /**
     * Firestore Timestamp → YYYY-MM-DD 文字列に変換
     */
    function timestampToDateStr(ts) {
        if (!ts) return '';
        if (typeof ts.toDate === 'function') {
            const d = ts.toDate();
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            return `${y}-${m}-${day}`;
        }
        if (typeof ts === 'string') return ts.substring(0, 10);
        return '';
    }

    /**
     * Firestore Timestamp → Date オブジェクトに変換
     */
    function timestampToDate(ts) {
        if (!ts) return null;
        if (typeof ts.toDate === 'function') return ts.toDate();
        if (ts instanceof Date) return ts;
        if (typeof ts === 'string') return new Date(ts);
        return null;
    }

    /**
     * invoice_items を報酬系/立替系に分類
     * 報酬系: '手数料', '報酬'
     * 立替系: '仮受金', '立替金', '実費'
     */
    const REWARD_TYPES = ['手数料', '報酬'];
    const EXPENSE_TYPES = ['仮受金', '立替金', '実費'];

    function classifyItemType(itemType) {
        if (REWARD_TYPES.includes(itemType)) return 'reward';
        if (EXPENSE_TYPES.includes(itemType)) return 'expense';
        return 'reward'; // デフォルトは報酬系
    }

    // ────────────────────────────────────────
    // Firestoreデータ取得
    // ────────────────────────────────────────

    /**
     * closingDate以前の全財務データを一括取得
     * @param {string} closingDate - YYYY-MM-DD形式の決算日
     * @returns {Promise<Object>} rawData { invoices, invoiceItems, allocations, receipts, cases, customers }
     */
    async function fetchData(closingDate) {
        console.log(`[FinancialService] ====== fetchData 開始 (closingDate: ${closingDate}) ======`);

        const closingEndOfDay = toEndOfDay(closingDate);

        // ---- 並列取得 ----
        const [invoiceSnap, allocationSnap, receiptSnap, caseSnap, customerSnap] = await Promise.all([
            // 1. invoices: invoice_date <= closingDate, status != 'cancelled'
            //    Firestoreは不等号+不等号の複合は1フィールドのみ → invoice_date で絞り、statusはクライアントフィルタ
            db.collection('invoices')
                .where('invoice_date', '<=', closingDate)
                .get(),

            // 2. receiptAllocations: status == 'active' (全件。createdAtフィルタはクライアント側)
            db.collection('receiptAllocations')
                .where('status', '==', 'active')
                .get(),

            // 3. receipts: receiptDate <= closingDate, status == 'active'
            //    同様にreceiptDateで絞り、statusはクライアントフィルタ
            db.collection('receipts')
                .where('receiptDate', '<=', closingDate)
                .get(),

            // 4. cases: 全件取得（軽量）
            db.collection('cases').get(),

            // 5. customers: 全件取得（軽量）
            db.collection('customers').get()
        ]);

        // ---- invoices のフィルタリング ----
        const invoices = [];
        invoiceSnap.forEach(doc => {
            const data = doc.data();
            data._docId = doc.id;
            if (data.status === 'cancelled') return; // 取消除外
            invoices.push(data);
        });
        console.log(`[FinancialService] invoices取得: ${invoices.length}件 (cancelled除外済)`);

        // ---- invoice_items の取得（invoiceのinvoice_idでIN検索） ----
        const invoiceIds = invoices.map(inv => inv.invoice_id).filter(id => id !== undefined && id !== null);
        let invoiceItems = [];

        if (invoiceIds.length > 0) {
            const chunks = [];
            for (let i = 0; i < invoiceIds.length; i += 10) {
                chunks.push(invoiceIds.slice(i, i + 10));
            }
            const itemSnaps = await Promise.all(
                chunks.map(ids => db.collection('invoice_items').where('invoice_id', 'in', ids).get())
            );
            itemSnaps.forEach(snap => {
                snap.forEach(doc => {
                    const data = doc.data();
                    data._docId = doc.id;
                    invoiceItems.push(data);
                });
            });
        }
        console.log(`[FinancialService] invoice_items取得: ${invoiceItems.length}件`);

        // ---- allocations のフィルタリング（createdAt <= closingDate） ----
        const allocations = [];
        allocationSnap.forEach(doc => {
            const data = doc.data();
            data._docId = doc.id;
            // createdAt の日付チェック
            const createdDate = timestampToDate(data.createdAt);
            if (createdDate && createdDate <= closingEndOfDay) {
                allocations.push(data);
            }
        });
        console.log(`[FinancialService] allocations取得: ${allocations.length}件 (createdAt <= ${closingDate} フィルタ済)`);

        // ---- receipts のフィルタリング ----
        const receipts = [];
        receiptSnap.forEach(doc => {
            const data = doc.data();
            data._docId = doc.id;
            if (data.status !== 'active') return; // 無効除外
            receipts.push(data);
        });
        console.log(`[FinancialService] receipts取得: ${receipts.length}件`);

        // ---- cases ----
        const cases = [];
        caseSnap.forEach(doc => {
            const data = doc.data();
            data._docId = doc.id;
            cases.push(data);
        });
        console.log(`[FinancialService] cases取得: ${cases.length}件`);

        // ---- customers → Map化 ----
        const customers = {};
        customerSnap.forEach(doc => {
            const data = doc.data();
            customers[data.customer_id] = data;
        });
        console.log(`[FinancialService] customers取得: ${Object.keys(customers).length}件`);

        console.log(`[FinancialService] ====== fetchData 完了 ======`);

        return { invoices, invoiceItems, allocations, receipts, cases, customers };
    }

    // ────────────────────────────────────────
    // 集計ロジック
    // ────────────────────────────────────────

    /**
     * 4分類のスナップショットを計算
     * @param {Object} rawData - fetchData()の戻り値
     * @param {string} closingDate - YYYY-MM-DD
     * @returns {Object} { ar, expenses, advances, prospects, summary }
     */
    function calculateSnapshots(rawData, closingDate) {
        const { invoices, invoiceItems, allocations, receipts, cases, customers } = rawData;

        console.log(`[FinancialService] ====== calculateSnapshots 開始 ======`);

        // ============================================================
        // Step 1: allocations を invoiceId 単位 / receiptId (paymentId) 単位でハッシュマップ化
        // ============================================================
        const allocByInvoice = {};  // { invoiceId: [ allocation, ... ] }
        const allocByReceipt = {};  // { receiptId: [ allocation, ... ] }

        allocations.forEach(a => {
            // Invoice側
            if (a.invoiceId) {
                if (!allocByInvoice[a.invoiceId]) allocByInvoice[a.invoiceId] = [];
                allocByInvoice[a.invoiceId].push(a);
            }
            // Receipt側
            if (a.receiptId) {
                if (!allocByReceipt[a.receiptId]) allocByReceipt[a.receiptId] = [];
                allocByReceipt[a.receiptId].push(a);
            }
        });

        // ============================================================
        // Step 2: invoice_items を invoice_id 単位でグルーピング
        // ============================================================
        const itemsByInvoice = {};  // { invoice_id: [ item, ... ] }
        invoiceItems.forEach(item => {
            const iid = item.invoice_id;
            if (!itemsByInvoice[iid]) itemsByInvoice[iid] = [];
            itemsByInvoice[iid].push(item);
        });

        // ============================================================
        // Step 3: invoices を走査し、売掛金・立替金を判定
        // ============================================================
        const arItems = [];       // 売掛金明細
        const expenseItems = [];  // 立替金明細

        // cases を case_id でMap化（案件名取得用）
        const caseMap = {};
        cases.forEach(c => { caseMap[c.case_id] = c; });

        // invoiceのdoc_idからcase情報を逆引きするマップ
        // invoice_items にはcase_idが含まれるので、最初に見つかったcase_idを使用
        function getInvoiceCaseIds(items) {
            const ids = new Set();
            items.forEach(item => {
                if (item.case_id) ids.add(item.case_id);
            });
            return [...ids];
        }

        invoices.forEach(inv => {
            const docId = inv._docId;
            const iid = inv.invoice_id;
            const items = itemsByInvoice[iid] || [];
            const invAllocations = allocByInvoice[docId] || [];

            // ---- 報酬合計と立替合計を計算 ----
            let rewardTotal = 0;
            let expenseTotal = 0;
            let rewardTax = 0;

            items.forEach(item => {
                const amt = Math.round(Number(item.amount) || 0);
                const type = classifyItemType(item.item_type);
                if (type === 'reward') {
                    rewardTotal += amt;
                    if (item.is_taxable) {
                        rewardTax += Math.round(amt * 0.1);
                    }
                } else {
                    expenseTotal += amt;
                }
            });

            const rewardWithTax = rewardTotal + rewardTax;
            const invoiceGrandTotal = rewardWithTax + expenseTotal;

            if (invoiceGrandTotal === 0) return; // 金額0の請求は対象外

            // ---- allocations の消込額を按分 ----
            const totalAllocated = invAllocations.reduce((sum, a) => sum + (Math.round(Number(a.amount)) || 0), 0);

            let rewardAllocated = 0;
            let expenseAllocated = 0;

            if (totalAllocated > 0) {
                // 按分計算: 報酬と立替の比率に応じて消込額を分配
                if (invoiceGrandTotal > 0) {
                    const rewardRatio = rewardWithTax / invoiceGrandTotal;
                    rewardAllocated = Math.round(totalAllocated * rewardRatio);
                    expenseAllocated = totalAllocated - rewardAllocated; // 残りを立替へ（端数の一致保証）
                }
            }

            // ---- 残高計算 ----
            const rewardBalance = Math.max(0, rewardWithTax - rewardAllocated);
            const expenseBalance = Math.max(0, expenseTotal - expenseAllocated);

            // 案件情報の取得
            const relatedCaseIds = getInvoiceCaseIds(items);
            const primaryCase = relatedCaseIds.length > 0 ? caseMap[relatedCaseIds[0]] : null;
            const customerName = inv.customer_name_snapshot
                || (customers[inv.customer_id]?.customer_name)
                || '不明';
            const caseName = primaryCase
                ? `${primaryCase.procedure_name || ''} (${primaryCase.license_type || ''})`
                : `請求#${inv.invoice_number || iid}`;

            // ---- 売掛金 ----
            if (rewardBalance > 0) {
                arItems.push({
                    invoiceDocId: docId,
                    invoiceId: iid,
                    invoiceNumber: inv.invoice_number || '',
                    customerId: inv.customer_id,
                    customerName: customerName,
                    caseName: caseName,
                    amount: rewardBalance,
                    originalAmount: rewardWithTax,
                    allocatedAmount: rewardAllocated,
                    originDate: inv.invoice_date || '',
                    elapsedDays: calcElapsedDays(inv.invoice_date, closingDate)
                });
            }

            // ---- 立替金 ----
            if (expenseBalance > 0) {
                expenseItems.push({
                    invoiceDocId: docId,
                    invoiceId: iid,
                    invoiceNumber: inv.invoice_number || '',
                    customerId: inv.customer_id,
                    customerName: customerName,
                    caseName: caseName,
                    amount: expenseBalance,
                    originalAmount: expenseTotal,
                    allocatedAmount: expenseAllocated,
                    originDate: inv.invoice_date || '',
                    elapsedDays: calcElapsedDays(inv.invoice_date, closingDate)
                });
            }
        });

        console.log(`[FinancialService] 売掛金: ${arItems.length}件, 立替金: ${expenseItems.length}件`);

        // ============================================================
        // Step 4: receipts を走査し、前受金（未消込入金残高）を判定
        // ============================================================
        const advanceItems = []; // 前受金明細

        receipts.forEach(r => {
            const docId = r._docId || r.receiptId;
            const rAllocations = allocByReceipt[docId] || [];
            const totalAllocatedForReceipt = rAllocations.reduce((sum, a) => sum + (Math.round(Number(a.amount)) || 0), 0);
            const receiptAmount = Math.round(Number(r.amount) || 0);
            const unallocated = receiptAmount - totalAllocatedForReceipt;

            if (unallocated > 0) {
                const customerName = r.payerName
                    || (customers[r.customer_id]?.customer_name)
                    || '不明';

                advanceItems.push({
                    receiptDocId: docId,
                    receiptId: r.receiptId || docId,
                    customerId: r.customer_id,
                    customerName: customerName,
                    caseName: '入金 (未充当)',
                    amount: unallocated,
                    originalAmount: receiptAmount,
                    allocatedAmount: totalAllocatedForReceipt,
                    originDate: r.receiptDate || '',
                    elapsedDays: calcElapsedDays(r.receiptDate, closingDate)
                });
            }
        });

        console.log(`[FinancialService] 前受金: ${advanceItems.length}件`);

        // ============================================================
        // Step 5: 見込（Prospects）を抽出
        //   closingDate時点でプロジェクト(case)が存在し、
        //   且つ紐づく invoices / receipts が closingDate までに1件も存在しないもの
        // ============================================================

        // invoiceに紐づくcase_idの集合
        const invoicedCaseIds = new Set();
        invoiceItems.forEach(item => {
            if (item.case_id) invoicedCaseIds.add(item.case_id);
        });

        // receiptに紐づくcustomer_idの集合（receiptはcase_idがないため、customer単位で判定）
        // → 正確にはcase単位の紐付けがないので、「invoiceが1件もない案件」を見込とする
        const prospectItems = [];

        cases.forEach(c => {
            // 取消は除外
            if (c.status === '取消') return;

            // contract_date (受任日) が closingDate 以降のものは除外
            if (c.contract_date && c.contract_date > closingDate) return;

            // invoiceに紐づくcase_idが1つもなければ「見込」
            if (!invoicedCaseIds.has(c.case_id)) {
                const customerName = c.customer_name
                    || (customers[c.customer_id]?.customer_name)
                    || '不明';
                const expectedAmount = Math.round(Number(c.estimated_fee) || 0);

                prospectItems.push({
                    caseId: c.case_id,
                    customerId: c.customer_id,
                    customerName: customerName,
                    caseName: `${c.procedure_name || ''} (${c.license_type || ''})`,
                    amount: expectedAmount,
                    originalAmount: expectedAmount,
                    allocatedAmount: 0,
                    originDate: c.contract_date || '',
                    elapsedDays: calcElapsedDays(c.contract_date, closingDate),
                    status: c.status || ''
                });
            }
        });

        console.log(`[FinancialService] 見込: ${prospectItems.length}件`);

        // ============================================================
        // Step 6: サマリー集計
        // ============================================================
        const summary = {
            ar: {
                label: '売掛金',
                count: arItems.length,
                total: arItems.reduce((s, i) => s + i.amount, 0)
            },
            expenses: {
                label: '立替金',
                count: expenseItems.length,
                total: expenseItems.reduce((s, i) => s + i.amount, 0)
            },
            advances: {
                label: '前受金',
                count: advanceItems.length,
                total: advanceItems.reduce((s, i) => s + i.amount, 0)
            },
            prospects: {
                label: '見込',
                count: prospectItems.length,
                total: prospectItems.reduce((s, i) => s + i.amount, 0)
            }
        };

        console.log(`[FinancialService] === サマリー ===`);
        console.log(`  売掛金: ${summary.ar.count}件 / ${summary.ar.total}円`);
        console.log(`  立替金: ${summary.expenses.count}件 / ${summary.expenses.total}円`);
        console.log(`  前受金: ${summary.advances.count}件 / ${summary.advances.total}円`);
        console.log(`  見込:   ${summary.prospects.count}件 / ${summary.prospects.total}円`);
        console.log(`[FinancialService] ====== calculateSnapshots 完了 ======`);

        return {
            ar: arItems,
            expenses: expenseItems,
            advances: advanceItems,
            prospects: prospectItems,
            summary: summary
        };
    }

    // ────────────────────────────────────────
    // Public API
    // ────────────────────────────────────────
    return {
        fetchData,
        calculateSnapshots,

        /**
         * ワンショット実行: データ取得 → 計算を一括実行
         * @param {string} closingDate - YYYY-MM-DD
         * @returns {Promise<Object>} calculateSnapshots の戻り値
         */
        async execute(closingDate) {
            if (!closingDate) throw new Error('closingDate is required');
            const rawData = await fetchData(closingDate);
            return calculateSnapshots(rawData, closingDate);
        }
    };
})();
