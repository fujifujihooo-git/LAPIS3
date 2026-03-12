/**
 * receipt_list.js
 * 入金一覧画面の制御スクリプト
 */

document.addEventListener('DOMContentLoaded', () => {
    // --- Elements ---
    const btnSearch = document.getElementById('btn-search-execute');
    const btnReset = document.getElementById('btn-reset-filters');
    const btnNew = document.getElementById('btn-new-receipt');

    const filterPayer = document.getElementById('filter-payer');
    const filterStatus = document.getElementById('filter-status');
    const filterDateStart = document.getElementById('filter-date-start');
    const filterDateEnd = document.getElementById('filter-date-end');
    const filterUnallocated = document.getElementById('filter-unallocated');

    const initialMessage = document.getElementById('initial-message');
    const tableWrapper = document.getElementById('table-wrapper');
    const tableBody = document.getElementById('receipt-list-body');
    const countDisplay = document.getElementById('count-display');

    // Modal Elements
    const receiptModal = document.getElementById('receipt-modal');
    const modalTitle = document.getElementById('modal-title');
    const modalReceiptId = document.getElementById('modal-receipt-id');
    const modalReceiptDate = document.getElementById('modal-receipt-date');
    const modalPayerName = document.getElementById('modal-payer-name');
    const modalAmount = document.getElementById('modal-amount');
    const modalMemo = document.getElementById('modal-memo');
    const modalCancelledWarning = document.getElementById('modal-cancelled-warning');
    const btnSaveModal = document.getElementById('btn-modal-save-receipt');
    const btnCancelModal = document.getElementById('btn-modal-cancel-receipt');

    let currentResults = [];

    // --- Loading Spinner Helper (common.jsに未定義の場合のフォールバック) ---
    function _showLoading(btn) {
        if (typeof showLoadingSpinner === 'function') {
            showLoadingSpinner(btn);
        } else if (btn) {
            btn._origHtml = btn.innerHTML;
            btn.disabled = true;
            btn.innerHTML = '<i data-lucide="loader" class="spin"></i> 検索中...';
            if (typeof lucide !== 'undefined') lucide.createIcons();
        }
    }
    function _hideLoading(btn, label) {
        if (typeof hideLoadingSpinner === 'function') {
            hideLoadingSpinner(btn, label);
        } else if (btn) {
            btn.disabled = false;
            btn.innerHTML = btn._origHtml || label || '検索';
            if (typeof lucide !== 'undefined') lucide.createIcons();
        }
    }

    // --- Events ---
    btnSearch.addEventListener('click', executeSearch);
    
    btnReset.addEventListener('click', () => {
        filterPayer.value = '';
        filterStatus.value = 'active';
        filterDateStart.value = '';
        filterDateEnd.value = '';
        filterUnallocated.checked = true;
        
        // Reset Datepickers if flatpickr exists
        if (filterDateStart._flatpickr) filterDateStart._flatpickr.clear();
        if (filterDateEnd._flatpickr) filterDateEnd._flatpickr.clear();
        
        tableWrapper.style.display = 'none';
        initialMessage.style.display = 'block';
        currentResults = [];
    });

    btnNew.addEventListener('click', () => {
        openModal();
    });

    btnSaveModal.addEventListener('click', saveReceipt);
    btnCancelModal.addEventListener('click', cancelReceipt);

    // If Date objects exist via DatePicker
    if (typeof initDatepickers === 'function') {
        const dpStart = document.getElementById('filter-date-start');
        const dpEnd = document.getElementById('filter-date-end');
        if(dpStart && !dpStart._flatpickr) initDatepicker('#filter-date-start');
        if(dpEnd && !dpEnd._flatpickr) initDatepicker('#filter-date-end');
        
        initDatepicker('#modal-receipt-date');
    }

    // Auth Change (Check user session before actions)
    firebase.auth().onAuthStateChanged(user => {
        if (!user) {
            window.location.href = 'login.html';
        } else {
            // Automatically execute search on load if needed
            executeSearch();
        }
    });

    // --- Functions ---
    async function executeSearch() {
        console.log('[receipt_list] executeSearch 開始');
        _showLoading(btnSearch);
        
        const payer = filterPayer.value.trim().toLowerCase();
        const status = filterStatus.value;
        const dStart = filterDateStart.value;
        const dEnd = filterDateEnd.value;
        const onlyUnallocated = filterUnallocated ? filterUnallocated.checked : false;

        console.log(`[receipt_list] 検索条件: payer="${payer}" status="${status}" dateStart="${dStart}" dateEnd="${dEnd}" onlyUnallocated=${onlyUnallocated}`);

        try {
            // 複合インデックスエラー回避: 常に単一orderByでフェッチし、クライアントサイドでフィルタ
            const snap = await db.collection('receipts')
                .orderBy('receiptDate', 'desc')
                .limit(300)
                .get();

            console.log(`[receipt_list] Firestoreから${snap.size}件取得`);

            let results = [];

            snap.forEach(doc => {
                const data = doc.data();
                data.id = doc.id;
                results.push(data);
            });

            // Client-side filtering
            if (status !== '') {
                results = results.filter(r => r.status === status);
                console.log(`[receipt_list] status="${status}"フィルタ後: ${results.length}件`);
            }
            if (payer) {
                results = results.filter(r => (r.payerName || '').toLowerCase().includes(payer));
                console.log(`[receipt_list] payer="${payer}"フィルタ後: ${results.length}件`);
            }
            if (dStart) {
                results = results.filter(r => r.receiptDate >= dStart);
                console.log(`[receipt_list] dateStart="${dStart}"フィルタ後: ${results.length}件`);
            }
            if (dEnd) {
                results = results.filter(r => r.receiptDate <= dEnd);
                console.log(`[receipt_list] dateEnd="${dEnd}"フィルタ後: ${results.length}件`);
            }
            if (onlyUnallocated) {
                results = results.filter(r => (r.balance || 0) > 0 && r.status === 'active');
                console.log(`[receipt_list] 未消込のみフィルタ後: ${results.length}件`);
            }

            console.log(`[receipt_list] 最終結果: ${results.length}件`);
            currentResults = results;
            renderTable(results);

            initialMessage.style.display = 'none';
            tableWrapper.style.display = 'block';

        } catch (e) {
            console.error('[receipt_list] Search failed:', e);
            // 複合インデックスエラーの場合、URLをコンソールに表示
            if (e.message && e.message.includes('index')) {
                console.error('[receipt_list] → Firestore複合インデックスが必要です。エラーメッセージ内のURLをクリックしてインデックスを作成してください。');
            }
            alert('検索に失敗しました: ' + e.message);
        } finally {
            _hideLoading(btnSearch, '<i data-lucide="search" style="margin-right: 8px;"></i> 検索');
            if (typeof lucide !== 'undefined') lucide.createIcons();
        }
    }

    function renderTable(data) {
        tableBody.innerHTML = '';
        countDisplay.textContent = `表示件数：${data.length}件`;

        if (data.length === 0) {
            tableBody.innerHTML = '<tr><td colspan="7" class="text-center" style="padding: 30px;">該当する入金データがありません</td></tr>';
            return;
        }

        data.forEach((r, idx) => {
            const tr = document.createElement('tr');
            
            // Highlight cancelled style
            const isCancelled = r.status === 'cancelled';
            if (isCancelled) tr.style.opacity = '0.6';

            const statusLabel = isCancelled ? '<span style="color:#ef4444;font-weight:600;">取消済</span>' : 
                                (r.balance === 0 ? '<span style="color:#10b981;font-weight:600;">消込完了</span>' : '<span style="color:#3b82f6;font-weight:600;">未消込あり</span>');

            tr.innerHTML = `
                <td>${formatDate(r.receiptDate)}</td>
                <td>${r.payerName || ''}</td>
                <td style="text-align:right;">${formatCurrency(r.amount)}</td>
                <td style="text-align:right;">${formatCurrency(r.allocatedAmount)}</td>
                <td style="text-align:right; font-weight:600;">${formatCurrency(r.balance)}</td>
                <td style="text-align:center;">${statusLabel}</td>
                <td style="text-align:center;">
                    <button class="btn btn-sm btn-secondary" onclick="editReceipt('${r.id}')">
                        詳細/編集
                    </button>
                </td>
            `;
            tableBody.appendChild(tr);
        });
    }

    window.editReceipt = function(docId) {
        const r = currentResults.find(x => x.id === docId);
        if(!r) return;
        openModal(r);
    }

    function openModal(data = null) {
        // Reset 
        modalReceiptId.value = '';
        modalAmount.value = '';
        modalPayerName.value = '';
        modalMemo.value = '';
        
        // Defaults to today
        const todayStr = new Date().toISOString().split('T')[0];
        if (modalReceiptDate._flatpickr) {
            modalReceiptDate._flatpickr.setDate(todayStr);
        } else {
            modalReceiptDate.value = todayStr;
        }

        modalCancelledWarning.style.display = 'none';
        btnCancelModal.style.display = 'none';
        btnSaveModal.disabled = false;
        modalAmount.disabled = false; // Cannot change amount if partially allocated

        if (data) {
            modalTitle.textContent = '入金編集';
            modalReceiptId.value = data.id;
            
            if (modalReceiptDate._flatpickr) modalReceiptDate._flatpickr.setDate(data.receiptDate);
            else modalReceiptDate.value = data.receiptDate;
            
            modalAmount.value = data.amount;
            modalPayerName.value = data.payerName || '';
            modalMemo.value = data.memo || '';

            // If already allocated partially, disable amount changing
            if ((data.allocatedAmount || 0) > 0) {
                modalAmount.disabled = true;
            }

            // Can only cancel if active and no allocations are made (or warn the user deeply later, for now block cancelling if allocated)
            if (data.status === 'active') {
                if ((data.allocatedAmount || 0) === 0) {
                    btnCancelModal.style.display = 'inline-flex';
                }
            } else if (data.status === 'cancelled') {
                modalCancelledWarning.style.display = 'block';
                btnSaveModal.disabled = true; // Cannot edit cancelled
            }
        } else {
            modalTitle.textContent = '新規入金登録';
        }

        receiptModal.style.display = 'block';
    }

    async function saveReceipt() {
        const id = modalReceiptId.value;
        const date = modalReceiptDate.value;
        const payer = modalPayerName.value.trim();
        const amt = parseInt(modalAmount.value, 10);
        const memo = modalMemo.value.trim();

        if (!date || !payer || isNaN(amt) || amt <= 0) {
            alert('入金日、振込人名、金額（0より大きい値）を正しく入力してください。');
            return;
        }

        if(!confirm('この内容で保存しますか？')) return;

        _showLoading(btnSaveModal);
        const serverTimestamp = firebase.firestore.FieldValue.serverTimestamp();

        try {
            if (id) {
                // Update
                const ref = db.collection('receipts').doc(id);
                // We don't update allocatedAmount/balance here directly because they are controlled by Transaction,
                // but if someone edits `amount`, we need to recalculate `balance`.
                // amount changing is only allowed if allocatedAmount === 0 based on UI limits.
                
                const docSnap = await ref.get();
                if(!docSnap.exists) throw new Error("Document not found");
                const currentData = docSnap.data();

                let updateDoc = {
                    receiptDate: date,
                    payerName: payer,
                    memo: memo,
                    lastUpdatedAt: serverTimestamp
                };

                // Update amount only if allowed
                if ((currentData.allocatedAmount || 0) === 0) {
                    updateDoc.amount = amt;
                    updateDoc.balance = amt; // balance is full amount since nothing is allocated
                }

                await ref.update(updateDoc);

            } else {
                // Create
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
                    createdAt: serverTimestamp,
                    lastUpdatedAt: serverTimestamp
                });
            }

            closeModal('receipt-modal');
            showToast('保存しました', 'success');
            setTimeout(executeSearch, 500);

        } catch (e) {
            console.error('Save receipt failed:', e);
            alert('保存に失敗しました: ' + e.message);
        } finally {
            _hideLoading(btnSaveModal, '保存');
        }
    }

    async function cancelReceipt() {
        const id = modalReceiptId.value;
        if (!id) return;

        if (!confirm('この入金データを取消処理（無効化）しますか？\n消込に使用されていない場合のみ可能です。')) return;

        try {
            const ref = db.collection('receipts').doc(id);
            const snap = await ref.get();
            const data = snap.data();

            if (!data) throw new Error('Data not found');
            if ((data.allocatedAmount || 0) > 0) {
               alert('既に消込に使用されているため取消できません。先に消込データを解除してください。');
               return;
            }

            await ref.update({
                status: 'cancelled',
                balance: 0, // balance becomes 0 when cancelled conceptually, or kept for records. Better kept conceptually as unusable. Let's make it 0.
                lastUpdatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });

            closeModal('receipt-modal');
            showToast('入金を取消しました', 'success');
            setTimeout(executeSearch, 500);

        } catch (e) {
            console.error('Cancel failed', e);
            alert('取消に失敗しました: ' + e.message);
        }
    }
});
