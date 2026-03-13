// unpaid_invoice_list.js
document.addEventListener('DOMContentLoaded', () => {

    // --- Access Control Guard ---
    if (typeof canAccessAccounting === 'function' && !canAccessAccounting()) {
        alert('アクセス権限がありません。');
        window.location.href = 'index.html';
        return;
    }

    const customerInput = document.getElementById('input-customer-search');
    const customerIdInput = document.getElementById('filter-customer-id');
    const autocompleteList = document.getElementById('autocomplete-list');
    const filterStatus = document.getElementById('filter-status');
    const btnSearch = document.getElementById('btn-search-execute');
    const btnReset = document.getElementById('btn-reset-filters');
    
    const tableWrapper = document.getElementById('table-wrapper');
    const unpaidListBody = document.getElementById('unpaid-list-body');
    const countDisplay = document.getElementById('count-display');
    const initialMessage = document.getElementById('initial-message');

    // Modal elements
    const allocationModal = document.getElementById('allocation-modal');
    const allocInvoiceId = document.getElementById('alloc-invoice-id');
    const allocCustomerId = document.getElementById('alloc-customer-id');
    const allocSelectedReceiptId = document.getElementById('alloc-selected-receipt-id');
    const dispCustomer = document.getElementById('alloc-disp-customer');
    const dispTotal = document.getElementById('alloc-disp-total');
    const dispBalance = document.getElementById('alloc-disp-balance');
    
    const receiptsLoading = document.getElementById('receipts-loading');
    const receiptsEmpty = document.getElementById('receipts-empty');
    const receiptsListBody = document.getElementById('receipts-list-body');
    
    const actionArea = document.getElementById('alloc-action-area');
    const dispSelectedReceiptBalance = document.getElementById('alloc-selected-receipt-balance');
    const inputAmount = document.getElementById('alloc-input-amount');
    const btnSetMax = document.getElementById('btn-set-max-balance');
    const dispAfterBalance = document.getElementById('alloc-after-balance');
    const btnExecuteAllocation = document.getElementById('btn-execute-allocation');

    const historyContainer = document.getElementById('allocation-history-container');
    const allocOverlay = document.getElementById('alloc-overlay');

    const toggleShowAllReceipts = document.getElementById('toggle-show-all-receipts');
    const btnInlineReceiptToggleHeader = document.getElementById('btn-inline-receipt-toggle-header');

    let currentUnpaidData = [];
    let currentReceiptsData = [];

    let selectedInvoiceData = null;
    let selectedReceiptData = null;

    // --- Batch Mode State ---
    let isBatchMode = false;
    let batchInputValues = {}; // { doc_id: amount }
    
    const tabModeDetail = document.getElementById('tab-mode-detail');
    const tabModeBatch = document.getElementById('tab-mode-batch');
    const batchDateSelector = document.getElementById('batch-date-selector');
    const batchReceiptDate = document.getElementById('batch-receipt-date');
    const batchActionBar = document.getElementById('batch-action-bar');
    const btnBatchExecute = document.getElementById('btn-batch-execute');
    const batchSelectedCount = document.getElementById('batch-selected-count');
    const batchTotalAmount = document.getElementById('batch-total-amount');

    if (batchReceiptDate) {
        batchReceiptDate.value = new Date().toISOString().split('T')[0];
    }

    // --- Autocomplete for Customer ---
    function setupCustomerAutocomplete() {
        const handleSearch = async () => {
            const val = customerInput.value;
            autocompleteList.innerHTML = '';
            if (!val) {
                customerIdInput.value = '';
                return;
            }

            try {
                const snap = await db.collection('customers')
                    .orderBy('customer_name')
                    .startAt(val)
                    .endAt(val + '\uf8ff')
                    .limit(10)
                    .get();

                snap.forEach(doc => {
                    const m = doc.data();
                    const div = document.createElement('div');
                    div.textContent = m.customer_name;
                    div.addEventListener('click', () => {
                        customerInput.value = m.customer_name;
                        customerIdInput.value = m.customer_id;
                        autocompleteList.innerHTML = '';
                    });
                    autocompleteList.appendChild(div);
                });
            } catch (e) {
                console.error('Autocomplete Error:', e);
            }
        };

        let debounceTimer;
        customerInput.addEventListener('input', () => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(handleSearch, 300);
            if(customerInput.value === '') customerIdInput.value = '';
        });

        document.addEventListener('click', (e) => {
            if (e.target !== customerInput) {
                autocompleteList.innerHTML = '';
            }
        });
    }

    setupCustomerAutocomplete();

    // --- Main Search ---
    btnSearch.addEventListener('click', async () => {
        initialMessage.style.display = 'none';
        tableWrapper.style.display = 'block';
        unpaidListBody.innerHTML = '<tr><td colspan="7" class="text-center py-4"><i data-lucide="loader" class="spin"></i> 検索中...</td></tr>';
        if (typeof lucide !== 'undefined') lucide.createIcons();

        try {
            const custId = customerIdInput.value;
            const statusVal = filterStatus.value;

            // 基本は「balance > 0」かつ「status != cancelled」の請求データ
            // ※ Firestoreは不等号クエリ(balance > 0)を一つしか持てない（または複合インデックス依存）。
            // 今回はstatusが限定的でデータ量もそこまで膨大ではない業務システム想定のため、
            // 複合インデックス要件を緩和するために「status != 'cancelled'」をベースにbalance > 0はフロントで絞るか、
            // 「balance > 0」でクエリしてフロントで絞るかの二択。
            // ここでは『balance > 0』をFirestoreでクエリし、status等はフロントフィルタリングする。

            // 複合インデックスを回避するため、Firestoreクエリを単純化
            let snap;
            if (custId) {
                // 選択された顧客IDで検索
                snap = await db.collection('invoices').where('customer_id', '==', Number(custId)).get();
            } else {
                // 顧客指定がない場合は残高ありを全件検索
                snap = await db.collection('invoices').where('balance', '>', 0).orderBy('balance').get();
            }

            let results = [];
            const searchStr = customerInput.value.trim();

            snap.forEach(doc => {
                const data = doc.data();
                data.doc_id = doc.id;
                
                // フロントエンドでのフィルタリング
                if (data.status === 'cancelled') return;
                if (statusVal && data.status !== statusVal) return;
                
                // 顧客IDで絞った場合は balance の確認が必要
                if (custId && (data.balance === undefined || data.balance <= 0)) return;
                
                // オートコンプリートを選択せず文字列だけ入力されている場合のテキスト絞り込み
                if (!custId && searchStr && data.customer_name_snapshot) {
                    if (!data.customer_name_snapshot.includes(searchStr)) return;
                }

                results.push(data);
            });

            // Sort by invoice_date desc visually
            results.sort((a, b) => {
                const dateA = a.invoice_date || '';
                const dateB = b.invoice_date || '';
                return dateA > dateB ? -1 : 1;
            });

            currentUnpaidData = results;
            batchInputValues = {}; // 検索時にリセット
            renderUnpaidList();

        } catch (error) {
            console.error('Search error:', error);
            unpaidListBody.innerHTML = `<tr><td colspan="7" class="text-center text-danger py-4">データ取得に失敗しました: ${error.message} <br>※複合インデックスが必要な場合があります(開発者コンソールを確認)</td></tr>`;
        }
    });

    // --- Tab Toggle Logic ---
    if (tabModeDetail && tabModeBatch) {
        tabModeDetail.addEventListener('click', () => {
            isBatchMode = false;
            tabModeDetail.style.background = '#fff';
            tabModeDetail.style.color = '#0f172a';
            tabModeDetail.style.boxShadow = '0 1px 3px rgba(0,0,0,0.1)';
            
            tabModeBatch.style.background = 'transparent';
            tabModeBatch.style.color = '#64748b';
            tabModeBatch.style.boxShadow = 'none';
            
            document.getElementById('table-wrapper')?.classList.remove('batch-mode-active');
            
            batchDateSelector.style.display = 'none';
            batchActionBar.style.display = 'none';
            renderUnpaidList();
        });

        tabModeBatch.addEventListener('click', () => {
            isBatchMode = true;
            tabModeBatch.style.background = '#fff';
            tabModeBatch.style.color = '#0f172a';
            tabModeBatch.style.boxShadow = '0 1px 3px rgba(0,0,0,0.1)';
            
            tabModeDetail.style.background = 'transparent';
            tabModeDetail.style.color = '#64748b';
            tabModeDetail.style.boxShadow = 'none';
            
            document.getElementById('table-wrapper')?.classList.add('batch-mode-active');
            
            batchDateSelector.style.display = 'flex';
            batchActionBar.style.display = 'flex';
            updateBatchSummary();
            renderUnpaidList();
        });
    }

    btnReset.addEventListener('click', () => {
        customerInput.value = '';
        customerIdInput.value = '';
        filterStatus.value = '';
        tableWrapper.style.display = 'none';
        initialMessage.style.display = 'block';
        currentUnpaidData = [];
    });

    function getStatusBadgeClass(status) {
        if (!status) return 'badge-warning';
        if (status === '延滞') return 'badge-danger';
        if (status === '一部入金') return 'badge-success'; // assuming progress is good
        return 'badge-warning';
    }

    function renderUnpaidList() {
        countDisplay.textContent = `表示件数：${currentUnpaidData.length}件`;
        unpaidListBody.innerHTML = '';
        
        const theadTr = document.querySelector('#unpaid-table thead tr');
        if (isBatchMode) {
            theadTr.innerHTML = `
                <th>請求日</th>
                <th>請求先</th>
                <th class="text-right">請求総額</th>
                <th class="text-right">未収残高</th>
                <th class="text-right" style="width:180px;">今回消込額</th>
                <th class="text-right">消込後残高</th>
            `;
        } else {
            theadTr.innerHTML = `
                <th class="sortable" data-sort="invoice_date">請求日</th>
                <th class="sortable" data-sort="customer_name_snapshot">請求先</th>
                <th class="sortable" data-sort="total_amount">請求総額</th>
                <th class="sortable" data-sort="balance">未収残高</th>
                <th class="sortable" data-sort="due_date">支払期限</th>
                <th class="sortable" data-sort="status">ステータス</th>
                <th>操作</th>
            `;
        }

        if (currentUnpaidData.length === 0) {
            const colspan = isBatchMode ? 6 : 7;
            unpaidListBody.innerHTML = `<tr><td colspan="${colspan}" class="text-center py-4">該当する未収データはありません。</td></tr>`;
            return;
        }

        currentUnpaidData.forEach((item, index) => {
            const row = document.createElement('tr');
            
            if (isBatchMode) {
                // Spreadsheet Mode
                const currentInput = batchInputValues[item.doc_id] || '';
                const displayBalanceAfter = currentInput ? (item.balance - currentInput) : item.balance;
                
                row.innerHTML = `
                    <td>${formatDate(item.invoice_date)}</td>
                    <td style="font-weight: 500;">${item.customer_name_snapshot || '不明'}</td>
                    <td class="text-right">${formatCurrency(item.total_amount || 0)}</td>
                    <td class="text-right text-danger" style="font-weight:bold;">${formatCurrency(item.balance || 0)}</td>
                    <td class="text-right" style="padding: 4px 8px;">
                        <input type="number" class="form-control batch-amount-input" data-index="${index}" data-id="${item.doc_id}" data-balance="${item.balance}" value="${currentInput}" min="0" max="${item.balance}" placeholder="金額を入力" style="text-align:right; font-weight:bold; color:#0284c7; min-height:36px; height:36px; padding:4px 8px;">
                    </td>
                    <td class="text-right batch-after-balance" style="font-weight:bold; color: ${displayBalanceAfter === 0 ? '#059669' : '#d97706'};">${formatCurrency(displayBalanceAfter)}</td>
                `;
            } else {
                // Detail Mode (Original)
                row.innerHTML = `
                    <td>${formatDate(item.invoice_date)}</td>
                    <td style="font-weight: 500;">
                        <a href="customer_detail.html?id=${item.customer_id}" class="text-link" title="顧客詳細へ">${item.customer_name_snapshot || '不明'}</a>
                    </td>
                    <td class="text-right">${formatCurrency(item.total_amount || 0)}</td>
                    <td class="text-right text-danger" style="font-weight:bold;">${formatCurrency(item.balance || 0)}</td>
                    <td class="${item.status === '延滞' ? 'text-danger' : ''}">${formatDate(item.due_date)}</td>
                    <td><span class="status-badge ${getStatusBadgeClass(item.status)}">${item.status || '未定義'}</span></td>
                    <td>
                        <button class="btn btn-sm btn-primary" onclick='openAllocationModal(${JSON.stringify(item).replace(/'/g, "&#39;")})' style="padding: 4px 12px; font-size: 0.85rem;">
                            消込を行う
                        </button>
                        <a href="invoice_detail.html?id=${item.doc_id}" class="btn btn-sm btn-secondary" style="padding: 4px 12px; font-size: 0.85rem; margin-left: 4px;" target="_blank">請求詳細</a>
                    </td>
                `;
            }
            unpaidListBody.appendChild(row);
        });
        
        if (isBatchMode) {
            setupBatchInputs();
        }
        
        if (typeof lucide !== 'undefined') lucide.createIcons();
    }
    
    // --- Batch Mode Logic ---
    function setupBatchInputs() {
        const inputs = document.querySelectorAll('.batch-amount-input');
        
        inputs.forEach((input, index) => {
            // Update balance after allocation dynamically
            input.addEventListener('input', (e) => {
                const val = e.target.value;
                const id = e.target.getAttribute('data-id');
                const balance = Number(e.target.getAttribute('data-balance'));
                const tdAfter = e.target.closest('tr').querySelector('.batch-after-balance');
                
                let numVal = parseInt(val, 10);
                if (isNaN(numVal) || numVal < 0) {
                    delete batchInputValues[id];
                    tdAfter.textContent = formatCurrency(balance);
                    tdAfter.style.color = '#d97706';
                } else {
                    if (numVal > balance) {
                        e.target.value = balance; // Capping at balance
                        numVal = balance;
                    }
                    batchInputValues[id] = numVal;
                    const afterBal = balance - numVal;
                    tdAfter.textContent = formatCurrency(afterBal);
                    tdAfter.style.color = afterBal === 0 ? '#059669' : '#d97706';
                }
                updateBatchSummary();
            });

            // Keyboard Navigation (Excel-like)
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === 'ArrowDown') {
                    e.preventDefault();
                    if (index < inputs.length - 1) {
                        inputs[index + 1].focus();
                        inputs[index + 1].select();
                    }
                } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    if (index > 0) {
                        inputs[index - 1].focus();
                        inputs[index - 1].select();
                    }
                } else if (e.key === ' ' || e.key.toLowerCase() === 'z') {
                    // ワン発コピーショートカット (Space または Z) : 未収残高を一発で入力
                    if (e.target.value === '') {
                        e.preventDefault();
                        const balance = e.target.getAttribute('data-balance');
                        e.target.value = balance;
                        // dispatch event to recalculate
                        e.target.dispatchEvent(new Event('input'));
                        
                        // Automatically move down
                        if (index < inputs.length - 1) {
                            setTimeout(() => {
                                inputs[index + 1].focus();
                                inputs[index + 1].select();
                            }, 50);
                        }
                    }
                }
            });
            
            // Highlight row on focus
            input.addEventListener('focus', (e) => {
                e.target.closest('tr').classList.add('selected-row');
                e.target.select(); // Select all text for easy overwrite
            });
            input.addEventListener('blur', (e) => {
                e.target.closest('tr').classList.remove('selected-row');
            });
        });
    }

    function updateBatchSummary() {
        let count = 0;
        let total = 0;
        
        for (const [id, amount] of Object.entries(batchInputValues)) {
            if (amount > 0) {
                count++;
                total += amount;
            }
        }
        
        batchSelectedCount.textContent = count;
        batchTotalAmount.textContent = formatCurrency(total);
        btnBatchExecute.disabled = count === 0;
    }

    if (btnBatchExecute) {
        btnBatchExecute.addEventListener('click', async () => {
            const entries = Object.entries(batchInputValues).filter(([id, amt]) => amt > 0);
            if (entries.length === 0) return;
            
            if (entries.length > 50) {
                alert('Firebase Sparkプランのリソース制限のため、1回の一括消込は最大50件までとしてください。\n現在 ' + entries.length + ' 件選択されています。');
                return;
            }

            const rDate = document.getElementById('batch-receipt-date').value;
            if (!rDate) {
                alert('「一括入金日」を指定してください。');
                return;
            }

            if (!confirm(`${entries.length}件、総額 ${batchTotalAmount.textContent} の一括消込処理を実行します。よろしいですか？`)) {
                return;
            }

            const originalText = btnBatchExecute.innerHTML;
            btnBatchExecute.disabled = true;
            btnBatchExecute.innerHTML = '<i data-lucide="loader" class="spin"></i> 処理中...';
            if(typeof lucide !== 'undefined') lucide.createIcons();

            try {
                // 1回のバッチ制約（500 writesまで）に収まるよう、まとめて処理
                // 各消込ごとに:
                // 1. receipt ドキュメントを新規作成 (登録時即消込完了状態とする)
                // 2. invoice を更新
                // 3. receiptAllocations を作成
                // つまり1件あたり 3 writes. 50件なら 150 writes < 500 で安全。
                
                const batch = db.batch();
                const serverTimestamp = firebase.firestore.FieldValue.serverTimestamp();
                
                // Map of doc_id to dataset for easy retrieval
                const invoiceMap = {};
                currentUnpaidData.forEach(inv => invoiceMap[inv.doc_id] = inv);

                for (const [invId, amount] of entries) {
                    const inv = invoiceMap[invId];
                    if (!inv) continue;
                    
                    const receiptRef = db.collection('receipts').doc();
                    const allocRef = db.collection('receiptAllocations').doc();
                    const invoiceRef = db.collection('invoices').doc(invId);
                    
                    const resolvedCustomerId = inv.customer_id || inv.customerId || null;
                    
                    // 1. レシート作成 (即時消込済として扱う)
                    batch.set(receiptRef, {
                        receiptId: receiptRef.id,
                        receiptDate: rDate, // ユーザー指定の一括入金日
                        payerName: inv.customer_name_snapshot || '一括消込', // 請求先名または一括消込を使用
                        amount: amount,
                        allocatedAmount: amount, // 全額消込済
                        balance: 0,
                        memo: '一括消込処理',
                        status: 'active',
                        customer_id: resolvedCustomerId,
                        createdAt: serverTimestamp,
                        lastUpdatedAt: serverTimestamp
                    });
                    
                    // 2. 請求書更新
                    const currentInvoiceBalance = inv.balance !== undefined ? inv.balance : (inv.totalAmount || 0);
                    const newAllocated = (inv.allocatedAmount || 0) + amount;
                    const newBalance = currentInvoiceBalance - amount;
                    
                    let newStatus = inv.status;
                    if (newStatus === 'issued' || newStatus === '一部入金' || newStatus === '発行済' || newStatus === '延滞') {
                        if (newBalance === 0) {
                            newStatus = '入金済';
                        } else if (newAllocated > 0) {
                            newStatus = '一部入金';
                        }
                    }
                    
                    batch.update(invoiceRef, {
                        allocatedAmount: newAllocated,
                        balance: newBalance,
                        status: newStatus,
                        lastUpdatedAt: serverTimestamp
                    });
                    
                    // 3. 消込履歴作成
                    batch.set(allocRef, {
                        allocationId: allocRef.id,
                        receiptId: receiptRef.id,
                        invoiceId: invId,
                        amount: amount,
                        status: 'active',
                        customerId: resolvedCustomerId,
                        createdAt: serverTimestamp,
                        lastUpdatedAt: serverTimestamp
                    });
                }
                
                await batch.commit();
                
                console.log('[DEBUG] 🎊 バッチ一括消込完了: ' + entries.length + '件');
                showToast(`${entries.length}件の消込処理が完了しました。`, 'success');
                
                // Reset State
                batchInputValues = {};
                btnBatchExecute.innerHTML = originalText;
                
                // 再検索
                btnSearch.click();

            } catch (error) {
                console.error('Batch Allocation Error:', error);
                alert('一括処理中のエラー: ' + error.message);
                btnBatchExecute.disabled = false;
                btnBatchExecute.innerHTML = originalText;
                if(typeof lucide !== 'undefined') lucide.createIcons();
            }
        });
    }


    // --- Allocation Flow ---

    window.openAllocationModal = async function(invoiceStr) {
        let invoice;
        if(typeof invoiceStr === 'string') {
            invoice = JSON.parse(invoiceStr);
        } else {
            invoice = invoiceStr;
        }

        selectedInvoiceData = invoice;
        selectedReceiptData = null;
        currentReceiptsData = [];

        // === 完全ステートリセット ===
        // Hidden inputs
        allocInvoiceId.value = invoice.doc_id;
        allocCustomerId.value = invoice.customer_id || '';
        allocSelectedReceiptId.value = '';

        // 請求情報ヘッダ
        dispCustomer.textContent = invoice.customer_name_snapshot || `CustomerID: ${invoice.customer_id}`;
        dispTotal.textContent = formatCurrency(invoice.total_amount || 0);
        dispBalance.textContent = formatCurrency(invoice.balance || 0);

        // 右ペイン: 完全リセット（オーバーレイ表示、アクションエリア非表示）
        if (allocOverlay) allocOverlay.style.display = 'flex';
        actionArea.style.display = 'none';
        btnExecuteAllocation.disabled = true;
        inputAmount.value = '';
        dispSelectedReceiptBalance.textContent = '-';
        dispAfterBalance.textContent = '-';
        dispAfterBalance.style.color = '#10b981';

        // 左ペイン: リストと状態をクリア
        receiptsEmpty.style.display = 'none';
        // receipts-emptyの元のHTMLを復元
        receiptsEmpty.innerHTML = `
            <div style="margin-bottom: 12px;">
                <i data-lucide="inbox" style="width: 36px; height: 36px; color: #94a3b8;"></i>
            </div>
            <p style="font-weight: 600; margin-bottom: 8px;">有効な未消込入金がありません</p>
            <p style="font-size: 0.85rem; margin-bottom: 12px;">消込を行うには、先に入金データを登録する必要があります。</p>
            <div style="display: flex; gap: 8px; justify-content: center; flex-wrap: wrap;">
                <a href="receipt_list.html" target="_blank" class="btn btn-sm btn-secondary" style="padding: 6px 16px; font-size: 0.9rem;">
                    🏦 入金管理画面を開く
                </a>
            </div>`;

        receiptsListBody.innerHTML = '';
        receiptsLoading.style.display = 'block';

        // インライン入金登録フォームを非表示
        const inlineFormEl = document.getElementById('inline-receipt-form');
        if (inlineFormEl) inlineFormEl.style.display = 'none';

        // 消込履歴を非同期でロード
        loadHistory(invoice.doc_id);

        allocationModal.style.display = 'block';

        try {
            // === クエリフィルタ: 顧客IDまたは振込人名でマッチする入金のみ表示 ===
            // Firestore Sparkプランでは複合インデックスを避けるため、日付順で取得しフロントエンドで顧客フィルタを適用
            const targetCustomerId = invoice.customer_id;
            const targetCustomerName = invoice.customer_name_snapshot || '';
            console.log(`[DEBUG] receipts 取得開始: customerId=${targetCustomerId} customerName=${targetCustomerName}`);
            
            const allSnap = await db.collection('receipts')
                .orderBy('receiptDate', 'desc')
                .limit(200)
                .get();
            
            console.log(`[DEBUG] receipts 取得件数: ${allSnap.size}件 (フィルタ前)`);

            let allReceipts = [];
            const showAll = toggleShowAllReceipts ? toggleShowAllReceipts.checked : false;

            allSnap.forEach(d => {
                let data = d.data();
                data.doc_id = d.id;
                
                // Step 1: アクティブかつ未消込残高があるもののみ
                if (data.status !== 'active' || !(data.balance > 0)) {
                    // console.log(`[DEBUG] フィルタ除外(ステータス/残高): id=${d.id}`);
                    return;
                }
                
                // Step 2: 顧客フィルタ
                if (showAll) {
                    // 全表示モード: すべての未消込入金を許可
                    allReceipts.push(data);
                } else {
                    // 通常モード: 現在の顧客と一致するもののみ
                    const hasCustomerId = data.customer_id !== undefined && data.customer_id !== null;
                    const customerIdMatch = hasCustomerId && String(data.customer_id) === String(targetCustomerId);
                    const exactNameMatch = data.payerName === targetCustomerName;
                    const partialNameMatch = !hasCustomerId && targetCustomerName && data.payerName && 
                        (data.payerName.includes(targetCustomerName) || targetCustomerName.includes(data.payerName));
                    
                    if (customerIdMatch || exactNameMatch || partialNameMatch) {
                        allReceipts.push(data);
                    }
                }
            });
            console.log(`[DEBUG] 顧客フィルタ後の有効入金件数: ${allReceipts.length}件 (全表示: ${showAll})`);

            receiptsLoading.style.display = 'none';
            currentReceiptsData = allReceipts;

            if (allReceipts.length === 0) {
                receiptsEmpty.style.display = 'block';
                // 入金0件: 右パネルを完全無効化
                actionArea.style.display = 'none';
                if (allocOverlay) allocOverlay.style.display = 'flex';
                btnExecuteAllocation.disabled = true;
                if (typeof lucide !== 'undefined') lucide.createIcons();
            } else {
                renderModalReceiptsList(invoice.customer_name_snapshot);
            }

        } catch (e) {
            console.error('Failed to load receipts:', e);
            receiptsLoading.style.display = 'none';
            receiptsEmpty.style.display = 'block';
            receiptsEmpty.innerHTML = `<div style="color:#ef4444; padding:16px;">
                <p style="font-weight:600; margin-bottom:8px;">⚠️ 入金データの取得に失敗しました</p>
                <p style="font-size:0.85rem; margin-bottom:8px;">${e.message}</p>
                <p style="font-size:0.85rem;">ページを再読み込みしてもう一度お試しください。</p>
            </div>`;
            // エラー時も右パネルを無効化
            actionArea.style.display = 'none';
            if (allocOverlay) allocOverlay.style.display = 'flex';
            btnExecuteAllocation.disabled = true;
        }
    };

    function renderModalReceiptsList(preferredName) {
        receiptsListBody.innerHTML = '';
        
        // Sort: preferred name match first, then by date desc
        currentReceiptsData.sort((a, b) => {
            const matchA = a.payerName === preferredName ? 1 : 0;
            const matchB = b.payerName === preferredName ? 1 : 0;
            if (matchA !== matchB) return matchB - matchA;
            return a.receiptDate > b.receiptDate ? -1 : 1;
        });

        currentReceiptsData.forEach(r => {
            const tr = document.createElement('tr');
            tr.className = 'selectable-row';
            tr.setAttribute('data-id', r.doc_id);
            
            // Highlight preferred
            // 他社かどうかを判定（customer_idが自身と異なる、または名前が全然違う場合等）
            // ※既存の完全・部分一致ロジックを流用して判定
            const hasCustomerId = r.customer_id !== undefined && r.customer_id !== null;
            const customerIdMatch = hasCustomerId && selectedInvoiceData && String(r.customer_id) === String(selectedInvoiceData.customer_id);
            const exactNameMatch = r.payerName === preferredName;
            const partialNameMatch = !hasCustomerId && preferredName && r.payerName && 
                (r.payerName.includes(preferredName) || preferredName.includes(r.payerName));
            
            const isMatch = customerIdMatch || exactNameMatch || partialNameMatch;

            let nameHtml = r.payerName;
            if (isMatch) {
                nameHtml = `<span style="color:#0284c7;font-weight:600;">${r.payerName} (一致)</span>`;
            } else {
                // 他社データの場合は背景色とラベルを変更
                tr.style.backgroundColor = '#fefce8'; // 薄い黄色
                nameHtml = `<span style="color:#71717a;">${r.payerName} <span style="font-size:0.8em;">(他社)</span></span>`;
            }

            tr.innerHTML = `
                <td style="padding: 8px;">${formatDate(r.receiptDate)}</td>
                <td style="padding: 8px;">${nameHtml}</td>
                <td style="padding: 8px; text-align: right; font-weight:600; color:#059669;">${formatCurrency(r.balance || 0)}</td>
            `;

            tr.addEventListener('click', () => {
                console.log('[DEBUG] 入金行がクリックされました: id=' + r.doc_id + ' payer=' + r.payerName + ' balance=' + r.balance);
                // UI update
                document.querySelectorAll('#receipts-list-body tr').forEach(el => el.classList.remove('selected-row'));
                tr.classList.add('selected-row');
                
                // Logic update
                allocSelectedReceiptId.value = r.doc_id;
                selectedReceiptData = r;
                
                // Enable right pane: オーバーレイを非表示にし、アクションエリアを表示
                if (allocOverlay) allocOverlay.style.display = 'none';
                actionArea.style.display = 'block';
                
                dispSelectedReceiptBalance.textContent = formatCurrency(r.balance || 0);
                console.log('[DEBUG] 右パネル有効化: selectedReceiptData=', r.doc_id, 'balance=', r.balance);
                
                // Calculate default input amount
                const maxAllocatable = Math.min(selectedInvoiceData.balance, r.balance);
                inputAmount.value = maxAllocatable;
                
                calculateAfterBalance();
            });

            receiptsListBody.appendChild(tr);
        });
    }

    inputAmount.addEventListener('input', calculateAfterBalance);
    inputAmount.addEventListener('change', calculateAfterBalance);

    btnSetMax.addEventListener('click', () => {
        if (!selectedReceiptData || !selectedInvoiceData) return;
        const maxAllocatable = Math.min(selectedInvoiceData.balance, selectedReceiptData.balance);
        inputAmount.value = maxAllocatable;
        calculateAfterBalance();
    });

    function calculateAfterBalance() {
        if (!selectedReceiptData || !selectedInvoiceData) return;
        
        let amount = Number(inputAmount.value);
        if (isNaN(amount) || amount < 0) amount = 0;

        const maxAllowed = Math.min(selectedInvoiceData.balance, selectedReceiptData.balance);
        btnExecuteAllocation.disabled = true;

        if (amount > maxAllowed) {
            dispAfterBalance.textContent = `エラー: 消込可能額 (${formatCurrency(maxAllowed)}) を超えています`;
            dispAfterBalance.style.color = '#ef4444';
        } else if (amount === 0) {
            dispAfterBalance.textContent = '-';
            dispAfterBalance.style.color = '#10b981';
        } else {
            const afterBalance = selectedInvoiceData.balance - amount;
            dispAfterBalance.textContent = `${formatCurrency(afterBalance)}`;
            dispAfterBalance.style.color = afterBalance === 0 ? '#059669' : '#d97706';
            btnExecuteAllocation.disabled = false;
        }
    }

    btnExecuteAllocation.addEventListener('click', async () => {
        if (!selectedInvoiceData || !selectedReceiptData) return;
        
        // === バリデーションガード: 顧客ID整合性チェック ===
        if (selectedReceiptData.customer_id && selectedInvoiceData.customer_id) {
            // トグルOFFで「他社入金」を選択する操作は「仕様」となるため、完全ブロックはせず確認ダイアログに変更する
            if (String(selectedReceiptData.customer_id) !== String(selectedInvoiceData.customer_id)) {
                if(!confirm('⚠️ 確認\n\n選択された入金の顧客IDと、請求先の顧客IDが一致していません。\n他社（別顧客）の入金を使用して消込を行いますが、本当によろしいですか？')) {
                    return;
                }
            }
        }

        const amount = Number(inputAmount.value);
        if (isNaN(amount) || amount <= 0) {
            alert('正しい金額を入力してください。');
            return;
        }

        const maxAllowed = Math.min(selectedInvoiceData.balance, selectedReceiptData.balance);
        if (amount > maxAllowed) {
            alert(`消込金額は ${formatCurrency(maxAllowed)} 以下にしてください。`);
            return;
        }

        if (!confirm(`請求先: ${selectedInvoiceData.customer_name_snapshot}\n入金者: ${selectedReceiptData.payerName}\n\n上記の組み合わせで ${formatCurrency(amount)} の消込処理を実行します。よろしいですか？`)) {
            return;
        }

        const originalText = btnExecuteAllocation.innerHTML;
        btnExecuteAllocation.disabled = true;
        btnExecuteAllocation.innerHTML = '<i data-lucide="loader" class="spin"></i> 処理中...';
        if(typeof lucide !== 'undefined') lucide.createIcons();

        try {
            console.log('[DEBUG] Transaction Start: receiptId=' + selectedReceiptData.doc_id + ' invoiceId=' + selectedInvoiceData.doc_id + ' amount=' + amount);
            // common.jsのトランザクション関数を使用 (引数: receiptId, invoiceId, amount の3つ)
            await window.allocateReceiptToInvoice(
                selectedReceiptData.doc_id, 
                selectedInvoiceData.doc_id, 
                amount
            );
            console.log('[DEBUG] Transaction Success!');

            showToast('消込処理が完了しました。', 'success');
            closeModal('allocation-modal');
            
            // Refresh list
            btnSearch.click(); 

        } catch (error) {
            console.error('Allocation Error:', error);
            alert(`消込処理に失敗しました。\n${error.message}`);
        } finally {
            btnExecuteAllocation.disabled = false;
            btnExecuteAllocation.innerHTML = originalText;
            if(typeof lucide !== 'undefined') lucide.createIcons();
        }
    });

    // --- History Loading ---
    async function loadHistory(invoiceDocId) {
        historyContainer.innerHTML = '<div class="text-center py-2"><i data-lucide="loader" class="spin"></i></div>';
        try {
            // 複合インデックスを回避するため invoiceId だけで取得し、JSで絞り込み・ソート
            const snap = await db.collection('receiptAllocations')
                .where('invoiceId', '==', invoiceDocId)
                .get();

            let allocations = [];
            snap.forEach(doc => {
                const d = doc.data();
                if (d.status === 'active') {
                    d.id = doc.id;
                    allocations.push(d);
                }
            });

            if (allocations.length === 0) {
                historyContainer.innerHTML = '<p style="font-size: 0.9rem; color: var(--text-muted);">消込履歴データはありません。</p>';
                return;
            }

            // JavaScript側で日付降順ソート
            allocations.sort((a, b) => {
                const timeA = a.createdAt ? a.createdAt.toMillis() : 0;
                const timeB = b.createdAt ? b.createdAt.toMillis() : 0;
                return timeB - timeA;
            });

            let html = '<table class="table-modern" style="margin:0; font-size: 0.9rem;"><thead><tr><th>処理日時</th><th>充当先入金データ</th><th class="text-right">消込金額</th><th>操作</th></tr></thead><tbody>';
            
            allocations.forEach(d => {
                const dStr = d.createdAt ? formatToJST(d.createdAt) : '不明';
                html += `
                    <tr>
                        <td>${dStr}</td>
                        <td>入金ID: ${d.receiptId.substring(0, 8)}...</td>
                        <td class="text-right font-weight-bold text-success">${formatCurrency(d.amount)}</td>
                        <td>
                            <button class="btn btn-sm btn-outline-danger" onclick="cancelAllocation('${d.id}', '${d.receiptId}', '${d.invoiceId}', ${d.amount})" style="padding: 2px 8px; font-size: 0.8rem;">取消</button>
                        </td>
                    </tr>
                `;
            });
            html += '</tbody></table>';
            historyContainer.innerHTML = html;
            if(typeof lucide !== 'undefined') lucide.createIcons();

        } catch(e) {
            console.error('History load error:', e);
            historyContainer.innerHTML = '<span class="text-danger">履歴の取得に失敗しました。</span>';
        }
    }

    // Export cancel func to window
    window.cancelAllocation = async function(allocationId, receiptId, invoiceId, amount) {
        if (!confirm(`この消込(${formatCurrency(amount)})を取り消します。残高は元に戻ります。よろしいですか？`)) return;
        
        try {
            console.log('[DEBUG] Cancel Transaction Start: allocationId=' + allocationId);
            // common.jsの取消関数を使用 (引数: allocationId の1つのみ)
            await window.cancelReceiptAllocation(allocationId);
            console.log('[DEBUG] Cancel Transaction Success!');
            showToast('消込の取消が完了しました。', 'success');
            
            // Reload context
            allocationModal.style.display = 'none';
            btnSearch.click();

        } catch (error) {
            console.error('Cancel Error:', error);
            alert(`取消処理に失敗しました。\n${error.message}`);
        }
    };

    // --- インライン入金登録 ---
    const inlineForm = document.getElementById('inline-receipt-form');
    const btnInlineCancel = document.getElementById('btn-inline-receipt-cancel');
    const btnInlineSave = document.getElementById('btn-inline-receipt-save');

    // ヘッダーの常設ボタンでフォームを展開
    if (btnInlineReceiptToggleHeader) {
        btnInlineReceiptToggleHeader.addEventListener('click', () => {
            inlineForm.style.display = 'block';
            // 顧客名を自動セット
            const payerInput = document.getElementById('inline-receipt-payer');
            if (selectedInvoiceData && selectedInvoiceData.customer_name_snapshot) {
                payerInput.value = selectedInvoiceData.customer_name_snapshot;
            }
            // 今日の日付をセット
            const dateInput = document.getElementById('inline-receipt-date');
            dateInput.value = new Date().toISOString().split('T')[0];
            // 金額を未収残高でセット
            const amtInput = document.getElementById('inline-receipt-amount');
            if (selectedInvoiceData) amtInput.value = selectedInvoiceData.balance || '';
        });
    }

    // トグルの変更時にリストを再取得
    if (toggleShowAllReceipts) {
        toggleShowAllReceipts.addEventListener('change', () => {
            if (selectedInvoiceData) {
                // Modalの再描画を呼び出す（現在の請求情報でロードし直す）
                window.openAllocationModal(selectedInvoiceData);
            }
        });
    }

    if (btnInlineCancel) {
        btnInlineCancel.addEventListener('click', () => {
            inlineForm.style.display = 'none';
        });
    }

    if (btnInlineSave) {
        btnInlineSave.addEventListener('click', async () => {
            const date = document.getElementById('inline-receipt-date').value;
            const payer = document.getElementById('inline-receipt-payer').value.trim();
            const amt = parseInt(document.getElementById('inline-receipt-amount').value, 10);
            const memo = document.getElementById('inline-receipt-memo').value.trim();

            if (!date || !payer || isNaN(amt) || amt <= 0) {
                alert('入金日、振込人名、金額（0より大きい値）を正しく入力してください。');
                return;
            }

            btnInlineSave.disabled = true;
            btnInlineSave.textContent = '保存中...';

            try {
                const serverTimestamp = firebase.firestore.FieldValue.serverTimestamp();
                const docRef = db.collection('receipts').doc();
                await docRef.set({
                    receiptId: docRef.id,
                    receiptDate: date,
                    payerName: payer,
                    amount: amt,
                    allocatedAmount: 0,
                    balance: amt,
                    memo: memo,
                    status: 'active',
                    // 顧客IDを保存してフィルタリングに使用
                    customer_id: selectedInvoiceData ? selectedInvoiceData.customer_id : null,
                    createdAt: serverTimestamp,
                    lastUpdatedAt: serverTimestamp
                });

                console.log('[DEBUG] インライン入金登録成功: id=' + docRef.id);
                showToast('入金を登録しました！', 'success');

                // フォームを非表示にし、モーダル内の入金リストをリフレッシュ
                inlineForm.style.display = 'none';
                
                // モーダルの入金リストを再取得
                if (selectedInvoiceData) {
                    await window.openAllocationModal(selectedInvoiceData);
                }

            } catch (e) {
                console.error('インライン入金登録エラー:', e);
                alert('入金登録に失敗しました: ' + e.message);
            } finally {
                btnInlineSave.disabled = false;
                btnInlineSave.textContent = '保存して選択';
            }
        });
    }

    // --- タブ復帰時の自動リフレッシュ ---
    // 別タブで入金管理画面を開いて登録した後、このタブに戻ったら自動でモーダル内の入金リストを更新
    let lastRefreshTime = 0;
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && allocationModal.style.display === 'block' && selectedInvoiceData) {
            const now = Date.now();
            // 3秒以内の連続リフレッシュを防止（デバウンス）
            if (now - lastRefreshTime < 3000) {
                console.log('[DEBUG] タブ復帰: デバウンスによりスキップ');
                return;
            }
            lastRefreshTime = now;
            console.log('[DEBUG] タブ復帰検知: 入金リストを自動リフレッシュします...');
            window.openAllocationModal(selectedInvoiceData);
        }
    });

});
