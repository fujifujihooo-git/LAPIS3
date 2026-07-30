document.addEventListener('DOMContentLoaded', async () => {
    const tPageStart = performance.now();
    console.log('Case Detail: Phase 1 (Sync UI) starting...');
    const DPH = window.DetailPageHelper;

    // --- Selectors ---
    const form = document.getElementById('case-form');
    const caseIdDisplay = document.getElementById('case-id-display');
    const lastUpdatedDisplay = document.getElementById('last-updated-display');
    const statusSelect = document.getElementById('status');
    const statusBadgePreview = document.getElementById('status-badge-preview');
    const btnBack = document.getElementById('btn-back');
    const btnBackTop = document.getElementById('btn-back-top');
    const btnBackToCustomer = document.getElementById('btn-back-to-customer');

    // Autocomplete Selectors
    const governmentOfficeSearch = document.getElementById('government_office_search');
    const governmentOfficeId = document.getElementById('government_office_id');
    const autocompleteList = document.getElementById('office-autocomplete-list');

    // --- State ---
    let cases = [];
    let customers = [];
    let selectedCustomer = null;  // オートコンプリートで選択された顧客
    let staffMembers = [];
    let statusHistory = [];
    let currentCase = null;
    let caseId = null;
    let governmentOffices = [];
    let estimateItems = [];
    let invoices = [];
    let invoiceItems = [];
    let payments = [];
    let autoUpdatedDatesTracker = [];
    let usedEstimateIds = new Set();

    // --- Selectors (Estimate Modal) ---
    const estimateItemTableBody = document.getElementById('estimate-item-list-body');
    const btnAddItem = document.getElementById('btn-add-item');
    const btnExportEstimatePdf = document.getElementById('btn-export-estimate-pdf');
    const itemModal = document.getElementById('estimate-item-modal');
    const btnCloseModal = document.getElementById('btn-close-modal');
    const btnCancelModal = document.getElementById('btn-cancel-modal');
    const btnModalSaveItem = document.getElementById('btn-modal-save-item');
    const btnModalDeleteItem = document.getElementById('btn-modal-delete-item');
    const modalTitle = document.querySelector('#estimate-item-modal .modal-header h3');

    // --- Selectors (History Modal) ---
    const historyModal = document.getElementById('history-edit-modal');
    const btnCloseHistoryModal = document.getElementById('btn-close-history-modal');
    const btnCancelHistoryModal = document.getElementById('btn-cancel-history-modal');
    const btnSaveHistory = document.getElementById('btn-save-history');

    // --- Pure Functions (no async, no side effects) ---

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

    function getUrlParameter(name) {
        return new URLSearchParams(window.location.search).get(name);
    }

    // Initialize Estimates
    function initEstimates(data) {
        if (data.estimate_items && Array.isArray(data.estimate_items)) {
            estimateItems = JSON.parse(JSON.stringify(data.estimate_items));
        } else {
            estimateItems = [];
        }
        renderEstimateItems();
        calculateEstimateTotals();
    }

    // Render Estimate Items
    function renderEstimateItems() {
        if (!estimateItemTableBody) return;
        estimateItemTableBody.innerHTML = '';
        estimateItems.forEach((item, index) => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${item.type}</td>
                <td>${item.description}</td>
                <td>${formatCurrency(item.unit_price)}</td>
                <td>${item.quantity}</td>
                <td>${formatCurrency(item.amount)}</td>
                <td>${item.is_taxable ? '○' : '-'}</td>
                <td><button type="button" class="secondary-btn" style="padding: 4px 8px; font-size: 0.8rem;" onclick="editEstimateItem(${index})">編集</button></td>
            `;
            estimateItemTableBody.appendChild(row);
        });
    }

    // Calculate Estimate Totals
    function calculateEstimateTotals() {
        let taxable = 0;
        let nontaxable = 0;
        estimateItems.forEach(item => {
            if (item.is_taxable) taxable += item.amount;
            else nontaxable += item.amount;
        });
        const tax = Math.floor(taxable * 0.1);
        const total = taxable + tax + nontaxable;

        document.getElementById('disp_taxable_amount').textContent = formatCurrency(taxable);
        document.getElementById('disp_tax_amount').textContent = formatCurrency(tax);
        document.getElementById('disp_nontaxable_amount').textContent = formatCurrency(nontaxable);
        document.getElementById('disp_total_estimate').textContent = formatCurrency(total);

        const elEstimated = document.getElementById('estimated_fee');
        const elSuspenseReceipt = document.getElementById('suspense_receipt_amount');
        if (elEstimated) elEstimated.value = taxable;
        if (elSuspenseReceipt) elSuspenseReceipt.value = nontaxable;
    }

    let editingEstimateIndex = -1;
    window.editEstimateItem = function (index) {
        editingEstimateIndex = index;
        const item = estimateItems[index];
        document.getElementById('modal-item-type').value = item.type;
        document.getElementById('modal-description').value = item.description;
        document.getElementById('modal-unit-price').value = formatAmount(item.unit_price);
        document.getElementById('modal-quantity').value = formatAmount(item.quantity);
        document.getElementById('modal-is-taxable').checked = item.is_taxable;
        modalTitle.textContent = '見積明細編集';
        btnModalDeleteItem.style.display = 'block';

        if (item.estimate_item_id && typeof usedEstimateIds !== 'undefined' && usedEstimateIds.has(item.estimate_item_id)) {
            btnModalDeleteItem.disabled = true;
            btnModalDeleteItem.title = '請求履歴が存在する見積明細は削除できません。';
            btnModalDeleteItem.style.opacity = '0.5';
            btnModalDeleteItem.style.cursor = 'not-allowed';
        } else {
            btnModalDeleteItem.disabled = false;
            btnModalDeleteItem.title = '';
            btnModalDeleteItem.style.opacity = '1.0';
            btnModalDeleteItem.style.cursor = 'pointer';
        }

        btnModalSaveItem.textContent = '保存';
        itemModal.style.display = 'block';
    };

    function openModal() {
        editingEstimateIndex = -1;
        document.getElementById('modal-item-type').value = '手数料';
        document.getElementById('modal-description').value = '';
        document.getElementById('modal-unit-price').value = '0';
        document.getElementById('modal-quantity').value = '1';
        document.getElementById('modal-is-taxable').checked = true;
        modalTitle.textContent = '見積明細追加';
        btnModalDeleteItem.style.display = 'none';
        btnModalDeleteItem.disabled = false;
        btnModalDeleteItem.style.opacity = '1.0';
        btnModalDeleteItem.style.cursor = 'pointer';
        btnModalSaveItem.textContent = '追加';
        itemModal.style.display = 'block';
    }

    function closeModal() {
        itemModal.style.display = 'none';
    }

    function closeHistoryModal() {
        if (historyModal) historyModal.style.display = 'none';
    }
    window.closeHistoryModal = closeHistoryModal;

    function generateUUID() {
        if (typeof self !== 'undefined' && self.crypto && typeof self.crypto.randomUUID === 'function') {
            return self.crypto.randomUUID();
        }
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    function saveEstimateItem() {
        const type = document.getElementById('modal-item-type').value;
        const desc = document.getElementById('modal-description').value;
        const price = Number(unformatAmount(document.getElementById('modal-unit-price').value));
        const qty = Number(unformatAmount(document.getElementById('modal-quantity').value));
        const isTaxable = document.getElementById('modal-is-taxable').checked;

        if (!desc) {
            alert('内容を入力してください。');
            return;
        }

        const existingItem = editingEstimateIndex >= 0 ? estimateItems[editingEstimateIndex] : null;
        const itemId = existingItem && existingItem.estimate_item_id ? existingItem.estimate_item_id : generateUUID();
        const isLegacy = existingItem && existingItem.is_legacy ? existingItem.is_legacy : undefined;

        // 警告ダイアログのガード（請求済明細の金額・内容などの変更時）
        if (existingItem && existingItem.estimate_item_id && typeof usedEstimateIds !== 'undefined' && usedEstimateIds.has(existingItem.estimate_item_id)) {
            const isChanged = existingItem.type !== type || 
                              existingItem.description !== desc || 
                              Number(existingItem.unit_price) !== price || 
                              Number(existingItem.quantity) !== qty || 
                              existingItem.is_taxable !== isTaxable;
            
            if (isChanged) {
                const proceed = confirm('【警告】この見積明細は既に請求書で使用されています。\n変更すると請求履歴との整合性が失われる可能性があります。本当に変更しますか？');
                if (!proceed) return;
            }
        }

        const itemData = {
            estimate_item_id: itemId,
            type,
            description: desc,
            unit_price: price,
            quantity: qty,
            amount: price * qty,
            is_taxable: isTaxable
        };

        if (isLegacy) {
            itemData.is_legacy = true;
        }

        if (editingEstimateIndex >= 0) estimateItems[editingEstimateIndex] = itemData;
        else estimateItems.push(itemData);

        renderEstimateItems();
        calculateEstimateTotals();
        closeModal();
    }

    function deleteEstimateItemFromModal() {
        if (editingEstimateIndex >= 0) {
            const item = estimateItems[editingEstimateIndex];
            if (item && item.estimate_item_id && typeof usedEstimateIds !== 'undefined' && usedEstimateIds.has(item.estimate_item_id)) {
                alert('この見積明細は既に請求に使用されているため削除できません。');
                return;
            }
            if (confirm('本当に削除しますか？')) {
                estimateItems.splice(editingEstimateIndex, 1);
                renderEstimateItems();
                calculateEstimateTotals();
                closeModal();
            }
        }
    }

    // =========================================================
    //  Phase 1: 同期UI初期化 — ブロッキングなし、即時描画
    // =========================================================

    const idParam = getUrlParameter('id');
    const preCustomerId = getUrlParameter('customer_id');

    if (idParam === 'new') {
        caseId = 'new';
        if (caseIdDisplay) caseIdDisplay.textContent = '新規案件登録';
        if (lastUpdatedDisplay) lastUpdatedDisplay.textContent = '保存時に設定';
        renderCustomerSelection(preCustomerId ? parseInt(preCustomerId) : null, true); // initial render
    } else {
        caseId = parseInt(idParam);
        // スケルトンUIの表示
        if (DPH) {
            DPH.renderSkeleton('status-history-body', { rows: 3, cols: 5, type: 'table' });
            DPH.renderSkeleton('billing-list-body', { rows: 2, cols: 6, type: 'table' });
        }
    }

    // --- イベントリスナーの登録 ---
    if (btnAddItem) btnAddItem.addEventListener('click', openModal);
    if (btnCloseModal) btnCloseModal.addEventListener('click', closeModal);
    if (btnCancelModal) btnCancelModal.addEventListener('click', closeModal);
    if (btnModalSaveItem) btnModalSaveItem.addEventListener('click', saveEstimateItem);
    if (btnModalDeleteItem) btnModalDeleteItem.addEventListener('click', deleteEstimateItemFromModal);

    if (btnExportEstimatePdf) {
        btnExportEstimatePdf.addEventListener('click', async () => {
            if (!estimateItems || estimateItems.length === 0) {
                alert('明細がありません。明細を追加してからPDF出力してください。');
                return;
            }

            const customerName = document.getElementById('customer_name')?.value || '';
            const customerTitle = document.getElementById('customer_title')?.value || '様';
            const caseNumber = document.getElementById('case_number')?.value || '';
            
            let assignees = [];
            const fieldStaffSelect = document.getElementById('field_staff_id');
            const documentStaffSelect = document.getElementById('document_staff_id');
            
            if (fieldStaffSelect && fieldStaffSelect.selectedIndex > 0) {
                assignees.push(fieldStaffSelect.options[fieldStaffSelect.selectedIndex].text);
            }
            if (documentStaffSelect && documentStaffSelect.selectedIndex > 0 && documentStaffSelect.value !== fieldStaffSelect?.value) {
                assignees.push(documentStaffSelect.options[documentStaffSelect.selectedIndex].text);
            }
            const assigneeText = assignees.length > 0 ? assignees.join(' / ') : '';

            const pdfData = {
                customerName: customerName,
                customerTitle: customerTitle,
                caseNumber: caseNumber,
                assignee: assigneeText,
                estimateItems: estimateItems
            };

            try {
                if (typeof generateEstimatePdf !== 'function') {
                    throw new Error('見積書PDF生成モジュールが見つかりません。');
                }
                await generateEstimatePdf(pdfData, btnExportEstimatePdf);
            } catch (err) {
                console.error('PDF生成エラー:', err);
                alert('PDFの生成中にエラーが発生しました。\\n' + err.message);
                if (btnExportEstimatePdf) {
                    btnExportEstimatePdf.innerHTML = '<i data-lucide="file-text" class="icon-sm"></i> 見積書PDF';
                    if (typeof lucide !== 'undefined') lucide.createIcons();
                }
            }
        });
    }

    const btnCreateInvoiceFromCase = document.getElementById('btn-create-invoice-from-case');
    if (btnCreateInvoiceFromCase) {
        btnCreateInvoiceFromCase.addEventListener('click', () => {
            if (!estimateItems || estimateItems.length === 0) {
                alert('見積明細がありません。明細を追加してから請求書を作成してください。');
                return;
            }
            if (!currentCaseId || currentCaseId === 'new') {
                alert('案件情報が保存されていません。案件を保存してから請求書を作成してください。');
                return;
            }
            // 顧客IDの取得
            const customerId = document.getElementById('customer_id')?.value;
            if (!customerId) {
                alert('顧客情報が設定されていません。');
                return;
            }
            const url = `invoice_detail.html?id=new&source=case&caseId=${currentCaseId}&customerId=${customerId}&returnCaseId=${currentCaseId}`;
            window.location.href = url;
        });
    }
    if (btnCloseHistoryModal) btnCloseHistoryModal.addEventListener('click', closeHistoryModal);
    if (btnCancelHistoryModal) btnCancelHistoryModal.addEventListener('click', closeHistoryModal);
    if (btnSaveHistory) btnSaveHistory.addEventListener('click', saveHistoryChanges);

    const btnDelete = document.getElementById('btn-delete');
    if (caseId === 'new') {
        if (btnDelete) btnDelete.style.display = 'none';
    } else {
        if (btnDelete) btnDelete.addEventListener('click', handleDelete);
    }

    if (form) {
        form.addEventListener('submit', handleSave);
    }

    const saveBtn = document.querySelector('button[type="submit"].btn-save');
    if (saveBtn) {
        saveBtn.addEventListener('click', (e) => {
            if (form && typeof form.reportValidity === 'function') {
                if (!form.reportValidity()) {
                    e.preventDefault();
                    return;
                }
            }
            handleSave(e);
        });
    }

    if (statusSelect) {
        statusSelect.addEventListener('change', (e) => {
            const newStatus = e.target.value;
            updateStatusPreview(newStatus);

            const today = new Date().toISOString().split('T')[0];
            let updatedField = null;
            let fieldLabel = '';

            if (newStatus === '受任') {
                const el = document.getElementById('contract_date');
                if (el && !el.value) {
                    window.setDateValueById('contract_date', today);
                    updatedField = 'contract_date'; fieldLabel = '受任日';
                }
            } else if (newStatus === '受付（受理）') {
                const el = document.getElementById('acceptance_date');
                if (el && !el.value) {
                    window.setDateValueById('acceptance_date', today);
                    updatedField = 'acceptance_date'; fieldLabel = '受付日';
                }
            } else if (newStatus === '完了') {
                const el = document.getElementById('completion_date');
                if (el && !el.value) {
                    window.setDateValueById('completion_date', today);
                    updatedField = 'completion_date'; fieldLabel = '完了日';
                }
            }

            if (updatedField) {
                showToast(`【自動入力】${newStatus}への変更に伴い、${fieldLabel}に本日日付を設定しました`, 'success');
                if (!autoUpdatedDatesTracker.includes(fieldLabel)) {
                    autoUpdatedDatesTracker.push(fieldLabel);
                }
            }
        });
    }

    [btnBack, btnBackTop].forEach(btn => {
        if (btn) {
            btn.addEventListener('click', () => { if (confirm('一覧に戻りますか？')) window.location.href = 'index.html'; });
        }
    });

    if (btnBackToCustomer) {
        btnBackToCustomer.addEventListener('click', () => {
            const cId = currentCase?.customer_id || parseInt(document.getElementById('customer_id')?.value);
            if (cId) {
                window.location.href = `customer_detail.html?id=${cId}`;
            } else {
                alert('紐付いている顧客の詳細情報が見つかりません。顧客一覧へ移動します。');
                window.location.href = 'customer_list.html';
            }
        });

        if (caseId === 'new' && !preCustomerId) {
            btnBackToCustomer.disabled = true;
            btnBackToCustomer.style.opacity = '0.5';
            btnBackToCustomer.style.cursor = 'not-allowed';
            btnBackToCustomer.title = '顧客が未紐付けのため使用できません';
        }
    }

    console.log(`[Perf] Phase 1 (Sync UI) completed in ${(performance.now() - tPageStart).toFixed(1)}ms`);

    // =========================================================
    //  Phase 2: 非同期データ取得 — Fire & Forget
    // =========================================================
    loadAllData();

    async function loadAllData() {
        const t2Start = performance.now();

        // 1. マスタデータのロード
        const masterPromise = window.MasterDataManager.loadAll().then(() => {
            staffMembers = window.MasterDataManager.getStaff();
            governmentOffices = window.MasterDataManager.getGovernmentOffices();
            const allLicenseTypes = window.MasterDataManager.getLicenseTypes();

            populateMasterDropdowns(allLicenseTypes);
            initAutocomplete();
            console.log(`[Perf] Master data loaded in ${(performance.now() - t2Start).toFixed(1)}ms`);
        }).catch(err => console.error('Master data load failed:', err));


        if (caseId === 'new') {
            await masterPromise; // マスタを待つ

            // Phase3-1: 顧客全件ロード廃止 → オートコンプリート検索に変更
            // preCustomerIdが指定されている場合のみ1件取得（Read 1）
            if (preCustomerId) {
                try {
                    const cDoc = await db.collection('customers').doc(`cust_${preCustomerId}`).get();
                    if (cDoc.exists) {
                        selectedCustomer = cDoc.data();
                        customers = [selectedCustomer];
                    }
                } catch (err) {
                    console.error('Pre-selected customer fetch failed', err);
                }
            }
            renderCustomerSelection(preCustomerId ? parseInt(preCustomerId) : null, false);

        } else {
            // 既存案件の並列データ取得
            try {
                const caseDoc = await db.collection('cases').doc(`case_${caseId}`).get();
                if (!caseDoc.exists) {
                    alert('案件が見つかりません');
                    window.location.href = 'index.html';
                    return;
                }
                currentCase = caseDoc.data();

                // 関連データの並列取得
                const relatedPromises = Promise.all([
                    db.collection('case_status_history').where('case_id', '==', caseId).get(),
                    db.collection('invoices').where('case_id', '==', caseId).get(),
                    db.collection('invoice_items').where('case_id', '==', caseId).get()
                ]).then(([historySnap, invSnap, invItemSnap]) => {
                    statusHistory = historySnap.docs.map(d => d.data());
                    invoices = invSnap.docs.map(d => d.data());
                    invoiceItems = invItemSnap.docs.map(d => d.data());

                    // 有効な（'取消'以外の）請求書IDを取得
                    const activeInvoiceIds = new Set(
                        invoices
                            .filter(inv => inv.status !== '取消')
                            .map(inv => inv.invoice_id)
                    );

                    // 有効な請求書に紐付いている invoice_items から estimate_item_id を抽出し、使用済IDのSetを構築
                    usedEstimateIds = new Set(
                        invoiceItems
                            .filter(item => item.estimate_item_id && activeInvoiceIds.has(item.invoice_id))
                            .map(item => item.estimate_item_id)
                    );
                });

                const customerPromise = currentCase.customer_id
                    ? db.collection('customers').doc(`cust_${currentCase.customer_id}`).get().then(cDoc => {
                        if (cDoc.exists) {
                            selectedCustomer = cDoc.data();
                            customers = [selectedCustomer];
                        }
                    })
                    : Promise.resolve();

                await Promise.all([masterPromise, relatedPromises, customerPromise]);

                // UIにデータを反映
                if (caseIdDisplay) caseIdDisplay.textContent = `Case ID: ${currentCase.case_id}`;
                if (lastUpdatedDisplay) lastUpdatedDisplay.textContent = formatToJST(currentCase.last_updated);

                renderCustomerSelection(currentCase.customer_id, false);
                populateForm(currentCase);

                console.log(`[Perf] All Phase 2 data loaded in ${(performance.now() - t2Start).toFixed(1)}ms`);
            } catch (err) {
                console.error('Data load failed:', err);
                if (DPH) {
                    DPH.renderErrorUI('status-history-body', () => loadAllData(), { isTbody: true });
                }
            }
        }
    }


    // --- Phase 2 Helpers ---

    function populateMasterDropdowns(allLicenseTypes) {
        // Populate Staff Selects
        const sFields = [document.getElementById('field_staff_id'), document.getElementById('document_staff_id'), document.getElementById('status_changed_by')];
        const activeStaff = staffMembers.filter(s => s.status === '在籍').sort((a, b) => {
            const nameA = a.staff_name || '';
            const nameB = b.staff_name || '';
            return nameA.localeCompare(nameB, 'ja');
        });
        sFields.forEach(select => {
            if (!select) return;
            const currentVal = select.value;
            select.innerHTML = '<option value="">未設定</option>';
            activeStaff.forEach(s => {
                const opt = document.createElement('option');
                opt.value = s.staff_id;
                opt.textContent = s.staff_name;
                select.appendChild(opt);
            });
            if (currentVal) select.value = currentVal;
        });

        // Populate License Type Select
        const ltSelect = document.getElementById('license_type');
        if (ltSelect) {
            const currentVal = ltSelect.value;
            ltSelect.innerHTML = '<option value="">選択してください</option>';
            const filteredLT = allLicenseTypes.filter(lt => lt.status === '有効' || lt.status === 'active');
            filteredLT.sort((a, b) => (a.sort_order || 999) - (b.sort_order || 999)).forEach(lt => {
                const opt = document.createElement('option');
                opt.value = lt.license_type_name;
                opt.textContent = lt.license_type_name;
                ltSelect.appendChild(opt);
            });
            if (currentVal) ltSelect.value = currentVal;
        }
    }

    function initAutocomplete() {
        if (!governmentOfficeSearch) return;
        governmentOfficeSearch.addEventListener('input', function () {
            const val = this.value.trim().toLowerCase();
            autocompleteList.innerHTML = '';
            if (!val) {
                governmentOfficeId.value = '';
                return;
            }
            const results = governmentOffices.filter(o => o.status === '有効' && o.office_name.toLowerCase().includes(val)).slice(0, 10);
            results.forEach(o => {
                const item = document.createElement('div');
                item.textContent = o.office_name;
                item.addEventListener('click', () => {
                    governmentOfficeSearch.value = o.office_name;
                    governmentOfficeId.value = o.office_id;
                    autocompleteList.innerHTML = '';
                });
                autocompleteList.appendChild(item);
            });
        });
        document.addEventListener('click', (e) => { if (e.target !== governmentOfficeSearch && autocompleteList) autocompleteList.innerHTML = ''; });
    }

    function renderCustomerSelection(selectedId, isInitialRender) {
        const titleArea = document.getElementById('detail-title-area');
        if (!titleArea) return;

        if (caseId === 'new' && isInitialRender) {
            titleArea.innerHTML = `新規案件登録：<span style="color: var(--text-muted);">（顧客データ読み込み中...）</span>`;
            return;
        }

        const cust = selectedCustomer || customers.find(c => c.customer_id === selectedId);
        const name = cust ? cust.customer_name : (caseId === 'new' ? '' : '不明な顧客');

        if (caseId === 'new' && !selectedId) {
            // Phase3-1: オートコンプリート検索UIに変更
            titleArea.innerHTML = `新規案件登録：
                <div style="display:inline-block; position:relative; width:320px; vertical-align:middle;">
                    <input type="text" id="customer_search_input" class="form-control" placeholder="顧客名 or カナで検索（2文字以上）" autocomplete="off" style="width:100%;">
                    <input type="hidden" id="customer_id" value="">
                    <div id="customer-autocomplete-list" class="autocomplete-items" style="position:absolute; z-index:99; width:100%; max-height:240px; overflow-y:auto; background:#fff; border:1px solid #e2e8f0; border-top:none; border-radius:0 0 8px 8px; box-shadow:0 4px 12px rgba(0,0,0,0.1); display:none;"></div>
                </div>`;
            initCustomerAutocomplete();
        } else {
            titleArea.innerHTML = `${caseId === 'new' ? '新規案件登録' : '案件詳細'}：<span style="color: var(--text-main); font-weight: 600;">${name}</span><input type="hidden" id="customer_id" value="${selectedId}">`;
            if (selectedId && caseId !== 'new') {
                titleArea.innerHTML += `<a href="customer_detail.html?id=${selectedId}" class="action-link" style="margin-left:12px">→ 顧客詳細</a>`;
            }
        }
    }

    // Phase3-1: 顧客オートコンプリート検索
    function initCustomerAutocomplete() {
        const searchInput = document.getElementById('customer_search_input');
        const hiddenId = document.getElementById('customer_id');
        const listEl = document.getElementById('customer-autocomplete-list');
        if (!searchInput || !listEl) return;

        let debounceTimer = null;

        searchInput.addEventListener('input', function() {
            const raw = this.value.trim();
            clearTimeout(debounceTimer);
            listEl.innerHTML = '';
            listEl.style.display = 'none';

            if (raw.length < 2) {
                hiddenId.value = '';
                selectedCustomer = null;
                return;
            }

            debounceTimer = setTimeout(async () => {
                const query = normalizeSearchText(raw);
                if (!query) return;

                try {
                    // search_name 前方一致検索
                    const nameSnap = await db.collection('customers')
                        .where('status', '==', '稼働中')
                        .where('search_name', '>=', query)
                        .where('search_name', '<=', query + '\uf8ff')
                        .limit(10)
                        .get();

                    // search_kana 前方一致検索
                    const kanaSnap = await db.collection('customers')
                        .where('status', '==', '稼働中')
                        .where('search_kana', '>=', query)
                        .where('search_kana', '<=', query + '\uf8ff')
                        .limit(10)
                        .get();

                    // 重複排除してマージ
                    const seen = new Set();
                    const results = [];
                    [nameSnap, kanaSnap].forEach(snap => {
                        snap.docs.forEach(d => {
                            if (!seen.has(d.id)) {
                                seen.add(d.id);
                                results.push(d.data());
                            }
                        });
                    });

                    listEl.innerHTML = '';
                    if (results.length === 0) {
                        const noResult = document.createElement('div');
                        noResult.style.cssText = 'padding:10px 12px; color:#94a3b8; font-size:0.9rem;';
                        noResult.textContent = '該当する顧客が見つかりません';
                        listEl.appendChild(noResult);
                    } else {
                        results.forEach(c => {
                            const item = document.createElement('div');
                            item.style.cssText = 'padding:10px 12px; cursor:pointer; border-bottom:1px solid #f1f5f9; transition:background 0.15s;';
                            item.innerHTML = `<strong>${c.customer_name}</strong> <span style="color:#94a3b8; font-size:0.85rem; margin-left:8px;">${c.customer_kana || ''}</span>`;
                            item.addEventListener('mouseenter', () => item.style.background = '#f1f5f9');
                            item.addEventListener('mouseleave', () => item.style.background = '#fff');
                            item.addEventListener('click', () => {
                                searchInput.value = c.customer_name;
                                hiddenId.value = c.customer_id;
                                selectedCustomer = c;
                                customers = [c];
                                listEl.innerHTML = '';
                                listEl.style.display = 'none';
                            });
                            listEl.appendChild(item);
                        });
                    }
                    listEl.style.display = 'block';
                } catch (err) {
                    console.error('Customer autocomplete search failed:', err);
                }
            }, 300); // 300msデバウンス
        });

        // リスト外クリックで閉じる
        document.addEventListener('click', (e) => {
            if (e.target !== searchInput && listEl) {
                listEl.innerHTML = '';
                listEl.style.display = 'none';
            }
        });
    }

    function populateForm(data) {
        initEstimates(data);
        renderBillingSection(data.case_id);
        const fields = ['license_type', 'procedure_name', 'field_staff_id', 'document_staff_id', 'status', 'acceptance_date', 'contract_date', 'application_scheduled_date', 'application_date', 'completion_date', 'return_date', 'application_method', 'application_number', 'remarks'];
        fields.forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                if (el.type === 'date' || el._udp || el._flatpickr) {
                    window.setDateControlValue(el, data[id] || '');
                } else {
                    el.value = data[id] || '';
                }
            }
        });
        const corr = document.getElementById('correction_flag');
        if (corr) corr.checked = !!data.correction_flag;

        if (data.government_office_id) {
            const off = governmentOffices.find(o => o.office_id === data.government_office_id);
            if (off) { governmentOfficeSearch.value = off.office_name; governmentOfficeId.value = off.office_id; }
        } else { governmentOfficeSearch.value = data.government_office || ''; }

        updateStatusPreview(data.status || '作成中');
        renderHistory(data.case_id);
    }

    function updateStatusPreview(status) {
        if (!statusBadgePreview) return;
        statusBadgePreview.textContent = status;
        statusBadgePreview.className = 'badge';
        const map = { '相談': 'status-sodan', '作成中': 'status-sakusei', '受付（受理）': 'status-uketuke', '完了': 'status-kanryo' };
        statusBadgePreview.classList.add(map[status] || 'status-sodan');
    }

    function renderHistory(cId) {
        const body = document.getElementById('status-history-body');
        if (!body) return;
        body.innerHTML = '';
        const history = statusHistory.filter(h => h.case_id === cId).sort((a, b) => new Date(b.changed_date) - new Date(a.changed_date));
        if (history.length === 0) { body.innerHTML = '<tr><td colspan="5" style="text-align:center">履歴なし</td></tr>'; return; }
        history.forEach((h, index) => {
            const tr = document.createElement('tr');
            const isLatest = index === 0;
            tr.innerHTML = `
                <td>${formatToJST(h.changed_date)}</td>
                <td>${h.old_status} → ${h.new_status}</td>
                <td>${h.changed_by}</td>
                <td>${h.comment || ''}</td>
                <td style="text-align:center;">
                    <button type="button" class="secondary-btn" style="padding: 4px 8px; font-size: 0.8rem; margin-right: 4px;" onclick="handleEditHistory('${h.history_id}', ${isLatest})">編集</button>
                    <button type="button" class="btn-delete" style="padding: 4px 8px; font-size: 0.8rem; background: #fee2e2; color: #ef4444; border: 1px solid #fca5a5;" onclick="handleDeleteHistory('${h.history_id}')">削除</button>
                </td>
            `;
            body.appendChild(tr);
        });
    }

    // --- History Modal Functions ---
    window.handleEditHistory = function (hId, isLatest) {
        const hist = statusHistory.find(h => h.history_id.toString() === hId.toString());
        if (!hist) return;
        document.getElementById('modal-history-id').value = hist.history_id;
        const dateObj = new Date(hist.changed_date);
        const tzoffset = (new Date()).getTimezoneOffset() * 60000;
        const localISOTime = (new Date(dateObj - tzoffset)).toISOString().slice(0, 16);
        document.getElementById('modal-history-date').value = localISOTime;
        document.getElementById('modal-history-status').value = hist.new_status;
        document.getElementById('modal-history-comment').value = hist.comment || '';
        document.getElementById('modal-history-link-flag').checked = isLatest;
        if (historyModal) historyModal.style.display = 'block';
    };

    async function saveHistoryChanges() {
        const hId = document.getElementById('modal-history-id').value;
        const hist = statusHistory.find(h => h.history_id.toString() === hId.toString());
        if (!hist) return;

        const newDateStr = document.getElementById('modal-history-date').value;
        const newDateIso = new Date(newDateStr).toISOString();
        const newStatus = document.getElementById('modal-history-status').value;
        const newComment = document.getElementById('modal-history-comment').value;
        const doLink = document.getElementById('modal-history-link-flag').checked;

        try {
            const batch = db.batch();
            const histRef = db.collection('case_status_history').doc(`hist_${hist.history_id}`);

            const updatedHist = { ...hist, changed_date: newDateIso, new_status: newStatus, comment: newComment };
            batch.set(histRef, updatedHist, { merge: true });

            if (doLink) {
                const caseRef = db.collection('cases').doc(`case_${caseId}`);
                const caseUpdates = { status: newStatus };
                const dateVal = newDateIso.split('T')[0];
                if (newStatus === '受任') caseUpdates.contract_date = dateVal;
                else if (newStatus === '受付（受理）') caseUpdates.acceptance_date = dateVal;
                else if (newStatus === '完了') caseUpdates.completion_date = dateVal;
                batch.update(caseRef, caseUpdates);
            }

            await batch.commit();

            const idx = statusHistory.findIndex(h => h.history_id.toString() === hId.toString());
            if (idx !== -1) statusHistory[idx] = updatedHist;

            if (doLink) {
                currentCase.status = newStatus;
                statusSelect.value = newStatus;
                updateStatusPreview(newStatus);
                const dateVal = newDateIso.split('T')[0];
                if (newStatus === '受任') window.setDateValueById('contract_date', dateVal);
                else if (newStatus === '受付（受理）') window.setDateValueById('acceptance_date', dateVal);
                else if (newStatus === '完了') window.setDateValueById('completion_date', dateVal);
            }

            renderHistory(caseId);
            closeHistoryModal();
            showToast('履歴を更新しました', 'success');
        } catch (err) {
            console.error('History update failed', err);
            alert('履歴の更新に失敗しました');
        }
    }

    window.handleDeleteHistory = async function (hId) {
        if (!confirm('この履歴を削除しますか？\n(最新履歴を削除する場合、案件のステータスは一つ前の状態に戻ります)')) return;

        try {
            const historyList = statusHistory.filter(h => h.case_id === caseId).sort((a, b) => new Date(b.changed_date) - new Date(a.changed_date));
            const histToDelete = historyList.find(h => h.history_id.toString() === hId.toString());
            if (!histToDelete) return;

            const isLatest = (historyList[0].history_id.toString() === hId.toString());
            const batch = db.batch();

            const histRef = db.collection('case_status_history').doc(`hist_${histToDelete.history_id}`);
            batch.delete(histRef);

            let rollbackStatus = null;
            if (isLatest && historyList.length > 1) {
                rollbackStatus = historyList[1].new_status;
                const caseRef = db.collection('cases').doc(`case_${caseId}`);
                batch.update(caseRef, { status: rollbackStatus });
            }

            await batch.commit();

            statusHistory = statusHistory.filter(h => h.history_id.toString() !== hId.toString());
            renderHistory(caseId);

            if (rollbackStatus) {
                currentCase.status = rollbackStatus;
                statusSelect.value = rollbackStatus;
                updateStatusPreview(rollbackStatus);
                showToast(`履歴を削除し、ステータスを「${rollbackStatus}」に戻しました`, 'success');
            } else {
                showToast('履歴を削除しました', 'success');
            }
        } catch (err) {
            console.error('History delete failed', err);
            alert('履歴の削除に失敗しました');
        }
    };

    // Billing Section (Simplified copy for now)
    function renderBillingSection(cId) {
        const billingListBody = document.getElementById('billing-list-body');
        if (!billingListBody) return;
        
        const relatedItems = invoiceItems.filter(item => item.case_id === cId);
        if (relatedItems.length === 0) {
            billingListBody.innerHTML = '<tr><td colspan="6" style="text-align:center">データなし</td></tr>';
            return;
        }
        billingListBody.innerHTML = '<tr><td colspan="6" style="text-align:center">請求連携機能は Firestore 版へ順次移行中です。</td></tr>';
    }

    // --- Save & Delete ---

    async function handleSave(e) {
        if (e) e.preventDefault();
        console.log("Save button clicked! function handleSave started.");

        try {
            const customerEl = document.getElementById('customer_id');
            if (!customerEl) {
                alert("エラー: 顧客情報欄が見つかりません。");
                return;
            }
            const customerIdVal = parseInt(customerEl?.value);
            if (isNaN(customerIdVal)) { alert('顧客を選択してください'); return; }

            const updatedData = {
                customer_id: customerIdVal,
                customer_name: (selectedCustomer && selectedCustomer.customer_id === customerIdVal) ? selectedCustomer.customer_name : (customers.find(c => c.customer_id === customerIdVal)?.customer_name || ''),
                license_type: document.getElementById('license_type')?.value || '',
                procedure_name: document.getElementById('procedure_name')?.value || '',
                government_office_id: parseInt(governmentOfficeId?.value) || null,
                government_office: governmentOfficeSearch?.value || '',
                field_staff_id: parseInt(document.getElementById('field_staff_id')?.value) || null,
                document_staff_id: parseInt(document.getElementById('document_staff_id')?.value) || null,
                status: statusSelect?.value || '相談',
                contract_date: document.getElementById('contract_date')?.value || '',
                application_scheduled_date: document.getElementById('application_scheduled_date')?.value || '',
                acceptance_date: document.getElementById('acceptance_date')?.value || '',
                completion_date: document.getElementById('completion_date')?.value || '',
                application_method: document.getElementById('application_method')?.value || '',
                application_number: document.getElementById('application_number')?.value || '',
                correction_flag: document.getElementById('correction_flag')?.checked || false,
                remarks: document.getElementById('remarks')?.value || '',
                return_date: document.getElementById('return_date')?.value || '',
                last_updated: new Date().toISOString(),
                estimate_items: estimateItems,
                estimated_fee: Number(document.getElementById('estimated_fee')?.value) || 0,
                suspense_receipt_amount: Number(document.getElementById('suspense_receipt_amount')?.value) || 0
            };

            // --- estimate_items バリデーション開始 ---
            const afterEstimateItems = updatedData.estimate_items || [];

            // 1. 同一案件内での estimate_item_id 重複保存の永久禁止
            const activeIds = afterEstimateItems
                .map(item => item.estimate_item_id)
                .filter(Boolean);
            if (new Set(activeIds).size !== activeIds.length) {
                throw new Error('同一案件内に同じ見積明細IDを複数登録することはできません。');
            }

            // 2. ID必須・空文字/未設定バリデーション
            for (const item of afterEstimateItems) {
                if (isTrackableEstimateItem(item) && (!item.estimate_item_id || item.estimate_item_id.trim() === '')) {
                    throw new Error('見積明細IDが未設定または空文字です。一意なIDが必要です。');
                }
            }

            // 3. 請求済み見積明細の完全不変（Immutable）原則のチェック
            if (caseId !== 'new' && currentCase && currentCase.estimate_items) {
                const beforeEstimateItems = currentCase.estimate_items || [];
                for (const beforeItem of beforeEstimateItems) {
                    if (beforeItem.estimate_item_id && typeof usedEstimateIds !== 'undefined' && usedEstimateIds.has(beforeItem.estimate_item_id)) {
                        const targetId = beforeItem.estimate_item_id;
                        const afterItem = afterEstimateItems.find(x => x.estimate_item_id === targetId);
                        if (!afterItem) {
                            throw new Error(`請求書に登録済みの見積明細「${beforeItem.description}」を削除することはできません。`);
                        }
                        const normalizedBefore = normalizeEstimateItem(beforeItem);
                        const normalizedAfter = normalizeEstimateItem(afterItem);
                        if (!deepEqual(normalizedBefore, normalizedAfter)) {
                            throw new Error(`請求書に登録済みの見積明細「${beforeItem.description}」の内容を変更することはできません。`);
                        }
                    }
                }
            }
            // --- estimate_items バリデーション終了 ---

            const batch = db.batch();

            if (caseId === 'new') {
                const nextId = await getNextSequence('cases');
                
                // 新規案件登録時（複製コピー時を含む）に、見積明細のIDをすべて新規UUIDに再生成し、is_legacyをクリアする
                if (estimateItems && estimateItems.length > 0) {
                    estimateItems = estimateItems.map(item => {
                        const copy = { ...item };
                        copy.estimate_item_id = generateUUID();
                        delete copy.is_legacy; // 複製された明細は新規扱い（追跡対象）とする
                        return copy;
                    });
                }
                updatedData.estimate_items = estimateItems;

                updatedData.case_id = nextId;
                updatedData.created_date = new Date().toISOString();
                currentCase = updatedData;
                caseId = nextId; 
                const caseRef = db.collection('cases').doc(`case_${nextId}`);
                batch.set(caseRef, updatedData);

                history.replaceState(null, '', `?id=${nextId}`);
                if (caseIdDisplay) caseIdDisplay.textContent = `Case ID: ${nextId}`;
            } else {
                updatedData.case_id = caseId;
                const caseRef = db.collection('cases').doc(`case_${caseId}`);
                batch.set(caseRef, { ...currentCase, ...updatedData }, { merge: true });

                if (currentCase.status !== updatedData.status) {
                    const changedById = parseInt(document.getElementById('status_changed_by')?.value);
                    const changedByName = staffMembers.find(s => s.staff_id === changedById)?.staff_name || '不明';
                    const hId = Date.now();

                    let comment = document.getElementById('status_change_comment')?.value || '';
                    if (autoUpdatedDatesTracker && autoUpdatedDatesTracker.length > 0) {
                        const autoMsg = `[日付自動設定: ${autoUpdatedDatesTracker.join(', ')}]`;
                        comment = comment ? `${comment} ${autoMsg}` : autoMsg;
                    }

                    const historyObj = { history_id: hId, case_id: caseId, old_status: currentCase.status, new_status: updatedData.status, changed_date: new Date().toISOString(), changed_by: changedByName, comment: comment };
                    const histRef = db.collection('case_status_history').doc(`hist_${hId}`);
                    batch.set(histRef, historyObj);
                }
            }

            console.log("Committing batch to Firestore...");
            await batch.commit();
            console.log("Batch commit successful.");

            triggerBillingSummaryRebuild(caseId);

            currentCase = { ...currentCase, ...updatedData };
            showToast('保存しました', 'success');
            renderHistory(caseId);
        } catch (error) {
            console.error('Save failed:', error);
            alert('保存中にエラーが発生しました: ' + (error.message || '不明なエラー'));
        }
    }

    async function handleDelete() {
        if (caseId === 'new') return;
        if (confirm('本当に削除しますか？')) {
            try {
                await deleteFromFirestore('cases', `case_${caseId}`);
                showToast('削除しました', 'success');
                setTimeout(() => { window.location.href = 'index.html'; }, 1000);
            } catch (err) { alert('削除に失敗しました'); }
        }
    }

    // --- Helper Functions for Estimate Items & Rebuild ---
    function deepEqual(x, y) {
        if (x === y) {
            return true;
        } else if ((typeof x == "object" && x != null) && (typeof y == "object" && y != null)) {
            if (Object.keys(x).length != Object.keys(y).length) return false;
            for (var prop in x) {
                if (y.hasOwnProperty(prop)) {
                    if (!deepEqual(x[prop], y[prop])) return false;
                } else {
                    return false;
                }
            }
            return true;
        } else {
            return false;
        }
    }

    async function rebuildWithRetry(caseId, maxRetries = 3) {
        for (let i = 0; i < maxRetries; i++) {
            try {
                await rebuildCaseBillingSummary(caseId);
                return;
            } catch (err) {
                if (i === maxRetries - 1) throw err;
                console.warn(`[BillingSummary] Retry ${i + 1}/${maxRetries} for case ${caseId}`);
                await new Promise(r => setTimeout(r, 1000 * (i + 1)));
            }
        }
    }

    function triggerBillingSummaryRebuild(caseId) {
        console.info(`[BillingSummary] Rebuild started for case: ${caseId}`);
        rebuildWithRetry(caseId)
            .then(() => {
                console.info(`[BillingSummary] Rebuild completed for case: ${caseId}`);
            })
            .catch(err => {
                console.error(`[BillingSummary] Rebuild FAILED for case ${caseId}:`, err);
                
                const errorRef = db.collection('billing_summary_errors').doc(`case_${caseId}`);
                errorRef.get().then(docSnap => {
                    const data = docSnap.exists ? docSnap.data() : null;
                    const isNewError = !data || data.resolved === true;
                    
                    let recentErrors = data && data.recent_errors ? data.recent_errors : [];
                    const errorMsg = String(err.message || err);
                    recentErrors = [errorMsg, ...recentErrors].slice(0, 5);

                    const updateData = {
                        case_id: caseId,
                        error_type: 'REBUILD_FAILED',
                        last_error: errorMsg,
                        last_error_at: firebase.firestore.FieldValue.serverTimestamp(),
                        recent_errors: recentErrors,
                        total_error_count: firebase.firestore.FieldValue.increment(1),
                        resolved: false
                    };
                    if (isNewError) {
                        updateData.first_error_at = firebase.firestore.FieldValue.serverTimestamp();
                    }
                    return errorRef.set(updateData, { merge: true });
                }).catch(logErr => console.error('[BillingSummary] Failed to write error log:', logErr));
            });
    }
});
