// unpaid_invoice_list.js
document.addEventListener('DOMContentLoaded', () => {

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

    let currentUnpaidData = [];
    let currentReceiptsData = [];

    let selectedInvoiceData = null;
    let selectedReceiptData = null;

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
            renderUnpaidList();

        } catch (error) {
            console.error('Search error:', error);
            unpaidListBody.innerHTML = `<tr><td colspan="7" class="text-center text-danger py-4">データ取得に失敗しました: ${error.message} <br>※複合インデックスが必要な場合があります(開発者コンソールを確認)</td></tr>`;
        }
    });

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

        if (currentUnpaidData.length === 0) {
            unpaidListBody.innerHTML = '<tr><td colspan="7" class="text-center py-4">該当する未収データはありません。</td></tr>';
            return;
        }

        currentUnpaidData.forEach(item => {
            const row = document.createElement('tr');
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
            unpaidListBody.appendChild(row);
        });
        if (typeof lucide !== 'undefined') lucide.createIcons();
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
        // receipts-emptyの元のHTMLを復元（エラー表示で上書きされている場合）
        receiptsEmpty.innerHTML = `
            <div style="margin-bottom: 12px;">
                <i data-lucide="inbox" style="width: 36px; height: 36px; color: #94a3b8;"></i>
            </div>
            <p style="font-weight: 600; margin-bottom: 8px;">有効な未消込入金がありません</p>
            <p style="font-size: 0.85rem; margin-bottom: 12px;">消込を行うには、先に入金データを登録する必要があります。</p>
            <div style="display: flex; gap: 8px; justify-content: center; flex-wrap: wrap;">
                <button type="button" class="btn btn-sm btn-primary" id="btn-inline-receipt-toggle" style="padding: 6px 16px; font-size: 0.9rem;">
                    ➕ この場で入金を登録
                </button>
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
            allSnap.forEach(d => {
                let data = d.data();
                data.doc_id = d.id;
                
                // Step 1: アクティブかつ未消込残高があるもののみ
                if (data.status !== 'active' || !(data.balance > 0)) {
                    console.log(`[DEBUG] フィルタ除外(ステータス/残高): id=${d.id} status=${data.status} balance=${data.balance}`);
                    return;
                }
                
                // Step 2: 顧客フィルタ — 以下のいずれかに一致するもののみ表示
                // (A) customer_id フィールドが一致
                // (B) payerName が顧客名と一致（既存データ対応）
                // (C) customer_id フィールドが未設定かつpayerNameが顧客名に部分一致
                const hasCustomerId = data.customer_id !== undefined && data.customer_id !== null;
                const customerIdMatch = hasCustomerId && String(data.customer_id) === String(targetCustomerId);
                const exactNameMatch = data.payerName === targetCustomerName;
                const partialNameMatch = !hasCustomerId && targetCustomerName && data.payerName && 
                    (data.payerName.includes(targetCustomerName) || targetCustomerName.includes(data.payerName));
                
                if (customerIdMatch || exactNameMatch || partialNameMatch) {
                    const matchType = customerIdMatch ? 'customerID一致' : (exactNameMatch ? '名前完全一致' : '名前部分一致');
                    console.log(`[DEBUG] 顧客フィルタ通過: id=${d.id} payer=${data.payerName} match=${matchType}`);
                    allReceipts.push(data);
                } else {
                    console.log(`[DEBUG] 顧客フィルタ除外: id=${d.id} payer=${data.payerName} (対象: ${targetCustomerName})`);
                }
            });
            console.log(`[DEBUG] 顧客フィルタ後の有効入金件数: ${allReceipts.length}件`);

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
            const isMatch = r.payerName === preferredName;
            const nameHtml = isMatch ? `<span style="color:#0284c7;font-weight:600;">${r.payerName} (一致)</span>` : r.payerName;

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
            if (String(selectedReceiptData.customer_id) !== String(selectedInvoiceData.customer_id)) {
                console.error('[GUARD] 顧客IDが不一致! receipt.customer_id=' + selectedReceiptData.customer_id + ' invoice.customer_id=' + selectedInvoiceData.customer_id);
                alert('⚠️ データ整合性エラー\n\n選択された入金の顧客IDと、請求先の顧客IDが一致しません。\n誤った消込を防ぐため、処理を中断しました。\n\nモーダルを閉じてやり直してください。');
                return;
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

    // イベント委譲: receiptsEmpty内のボタンはinnerHTML復元で消えるため、親要素で委譲する
    receiptsEmpty.addEventListener('click', (e) => {
        const toggleBtn = e.target.closest('#btn-inline-receipt-toggle');
        if (!toggleBtn) return;
        
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
