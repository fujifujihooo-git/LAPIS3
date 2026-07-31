document.addEventListener('DOMContentLoaded', () => {
    // --- Selectors ---
    const pageTitle = document.getElementById('page-title');
    const btnSave = document.getElementById('btn-save-invoice');
    const btnDelete = document.getElementById('btn-delete-invoice');
    const btnAddItem = document.getElementById('btn-add-item');
    // btnAddPayment は廃止（入金は消込画面で管理）

    const customerInput = document.getElementById('input-customer-search');
    const customerIdInput = document.getElementById('customer_id');
    const customerSelectGroup = document.getElementById('customer-select-group');
    const customerDisplayGroup = document.getElementById('customer-display-group');
    const customerNameDisplay = document.getElementById('customer-name-display');
    const autocompleteList = document.getElementById('autocomplete-list');

    const itemListBody = document.getElementById('item-list-body');
    const paymentListBody = document.getElementById('payment-list-body');

    // Display fields
    const dispSubtotalTaxable = document.getElementById('display-subtotal-taxable');
    const dispTaxAmount = document.getElementById('display-tax-amount');
    const dispSubtotalNontaxable = document.getElementById('display-subtotal-nontaxable');
    const dispTotalAmount = document.getElementById('display-total-amount');
    const dispPaymentTotal = document.getElementById('display-payment-total');
    const dispBalance = document.getElementById('display-balance');

    const createdDateSpan = document.getElementById('created_date');
    const lastUpdatedSpan = document.getElementById('last_updated');

    // Modals
    const itemModal = document.getElementById('item-modal');
    // paymentModal は廃止（入金は消込画面で管理）
    const btnModalAddItem = document.getElementById('btn-modal-add-item');
    // btnModalAddPayment は廃止（入金は消込画面で管理）

    // Import Modal
    const btnImport = document.getElementById('btn-import-estimate');
    const importModal = document.getElementById('import-modal');
    const importCaseSelect = document.getElementById('import-case-select');
    const importItemList = document.getElementById('import-item-list');
    const btnExecuteImport = document.getElementById('btn-execute-import');
    const importCheckAll = document.getElementById('import-check-all');
    // --- Constants ---
    // 案件プルダウンから除外するステータス（完了・取下げは請求不要）
    const EXCLUDED_CASE_STATUSES = ['完了', '取下げ'];

    // PDF出力などに現在の顧客スナップショットを渡すためのGetter
    window.getCurrentCustomerSnapshot = function () {
        return currentCustomerSnapshot;
    };

    // --- State ---
    let isSaving = false;
    let formState = {
        invoice_number: '',
        invoice_date: '',
        due_date: '',
        status: '下書き',
        remarks: ''
    };

    let currentInvoiceId = new URLSearchParams(window.location.search).get('id');
    let currentInvoice = null;
    let currentItems = []; // Work items in memory
    let currentAllocations = []; // 消込履歴（ReadOnly表示用）

    let deletedItemDocIds = []; // Deleted items doc_ids

    // Cache for Customers/Cases (fetched on demand)
    let customersCache = [];
    let casesCache = []; // Cases for current customer
    let currentCustomerSnapshot = null; // Holds the snapshot data

    // Preview DOM Elements
    const btnChangeCustomer = document.getElementById('btn-change-customer');
    const previewZip = document.getElementById('preview-zip');
    const previewAddress = document.getElementById('preview-address');
    const previewBuilding = document.getElementById('preview-building');
    const previewName = document.getElementById('preview-name');
    const previewTitle = document.getElementById('preview-title');
    const btnCustomerSearch = document.getElementById('btn-customer-search');

    let editingItemIndex = -1; // Edit mode state

    // --- Functions ---

    function init() {
        const tPageStart = performance.now();
        console.log("=== init() START ===");
        console.log('Invoice Detail: Phase 1 (Sync UI) starting...');
        console.log("window.location.search: ", window.location.search);
        console.log("currentInvoiceId parsed: ", currentInvoiceId);
        
        loadCustomersForSearch(); // 検索用顧客リストを非同期プリロード
        bindBasicInfoEvents();
        
        if (currentInvoiceId && currentInvoiceId !== 'new' && currentInvoiceId !== 'undefined' && currentInvoiceId !== 'null') {
            console.log("Executing loadInvoice with docId: ", currentInvoiceId);
            // Skeleton UI
            itemListBody.innerHTML = '<tr><td colspan="8"><div class="skeleton-row skeleton-shimmer"></div></td></tr>';
            paymentListBody.innerHTML = '<tr><td colspan="4"><div class="skeleton-row skeleton-shimmer"></div></td></tr>';
            
            const tEndPhase1 = performance.now();
            console.log(`[Perf] Phase 1 completed in ${(tEndPhase1 - tPageStart).toFixed(2)}ms`);
            
            // Phase 2
            console.log('Invoice Detail: Phase 2 (Async Data) starting...');
            loadInvoice(currentInvoiceId).then(() => {
                const tEndPhase2 = performance.now();
                console.log(`[Perf] Phase 2 completed in ${(tEndPhase2 - tEndPhase1).toFixed(2)}ms`);
            });
        } else {
            console.log("Executing initNewInvoice (Fallback)");
            currentInvoiceId = null;
            initNewInvoice();
            const tEndPhase1 = performance.now();
            console.log(`[Perf] Phase 1 completed in ${(tEndPhase1 - tPageStart).toFixed(2)}ms`);
        }
    }

    function bindBasicInfoEvents() {
        // ステートとUIを同期するonChangeハンドラを設定
        const fields = ['invoice_number', 'invoice_date', 'due_date', 'status', 'remarks'];
        fields.forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                const handler = (e) => {
                    formState[id] = e.target.value;
                };
                el.addEventListener('change', handler);
                el.addEventListener('input', handler);
            }
        });
    }

    async function initNewInvoice() {
        pageTitle.textContent = '新規請求作成';
        const today = new Date().toISOString().split('T')[0];

        formState.invoice_date = today;
        formState.invoice_number = '';
        document.getElementById('invoice_number').value = formState.invoice_number;
        document.getElementById('invoice_number').placeholder = '保存時に自動採番（または入力）';

        window.setDateValueById('invoice_date', formState.invoice_date);

        // Setup Autocomplete (Fetch all customers? Or use search?)
        // For scalability, simple search against 'customers' collection.
        setupCustomerAutocomplete();

        // Phase 1: URLパラメータからの顧客自動設定とUIロック
        const urlParams = new URLSearchParams(window.location.search);
        const source = urlParams.get('source');
        const cId = urlParams.get('customerId');
        if ((source === 'customer' || source === 'case') && cId) {
            // Load customer data
            db.collection('customers').where('customer_id', '==', parseInt(cId)).limit(1).get()
                .then(custSnap => {
                    if (!custSnap.empty) {
                        const data = custSnap.docs[0].data();
                        currentCustomerSnapshot = data;
                        customerIdInput.value = data.customer_id;
                        customerSelectGroup.style.display = 'none';
                        customerDisplayGroup.style.display = 'block';
                        renderCustomerPreview(data);
                        
                        // 変更ボタンを隠してロック
                        if (btnChangeCustomer) btnChangeCustomer.style.display = 'none';
                        pageTitle.textContent = `新規請求作成: ${data.customer_name}`;

                        if (source === 'case') {
                            const caseIdStr = urlParams.get('caseId');
                            if (caseIdStr) {
                                loadCaseItemsForNewInvoice(parseInt(caseIdStr));
                            }
                        }
                    }
                }).catch(err => {
                    console.error("顧客データの取得に失敗しました:", err);
                });
        }
    }

    async function loadCaseItemsForNewInvoice(caseIdNum) {
        try {
            const caseSnap = await db.collection('cases').where('case_id', '==', caseIdNum).limit(1).get();
            if (caseSnap.empty) {
                alert('対象の案件データが見つかりません。');
                return;
            }
            const caseData = caseSnap.docs[0].data();
            
            // Record source details
            formState.source_type = 'case';
            formState.source_id = caseIdNum;
            formState.case_id = caseIdNum;
            formState.case_number = caseData.case_number || '';

            const estItems = caseData.estimateItems || [];
            if (estItems.length > 0) {
                currentItems = estItems.map((est, idx) => ({
                    item_type: est.type || '見積', 
                    case_id: caseIdNum,
                    estimate_item_id: null,
                    description: est.description || '',
                    unit_price: Number(est.unit_price) || 0,
                    quantity: Number(est.quantity) || 1,
                    amount: Number(est.amount) || 0,
                    is_taxable: !!est.is_taxable,
                    display_order: idx + 1
                }));
                renderItems();
                calculateTotals();
                autoUpdateStatus();
                if (typeof showToast === 'function') {
                    showToast('案件の見積明細を請求明細にコピーしました', 'info');
                }
            } else {
                alert('対象の案件に見積明細が登録されていません。\n案件画面に戻ります。');
                const returnCaseId = urlParams.get('returnCaseId');
                if (returnCaseId) {
                    window.location.href = `detail.html?id=${returnCaseId}`;
                }
            }
        } catch (error) {
            console.error("案件データの取得・コピーに失敗しました:", error);
        }
    }

    async function loadInvoice(docId) {
        console.log("loadInvoice start. docId:", docId);
        try {
            const invRef = db.collection('invoices').doc(docId);
            const invDoc = await invRef.get();
            console.log("invDoc.exists:", invDoc.exists);

            if (!invDoc.exists) {
                alert('請求データが見つかりません。');
                window.location.href = 'invoice_list.html';
                return;
            }

            currentInvoice = invDoc.data();
            const iId = currentInvoice.invoice_id === undefined ? null : currentInvoice.invoice_id; // Prevent Firebase throw

            // 明細と消込履歴を並列取得（paymentsコレクションは廃止）
            const [itemsSnap, allocSnap] = await Promise.all([
                db.collection('invoice_items').where('invoice_id', '==', iId).get(),
                db.collection('receiptAllocations').where('invoiceId', '==', currentInvoiceId).where('status', '==', 'active').get()
            ]);
            
            deletedItemDocIds = [];

            currentItems = itemsSnap.docs.map(d => {
                const data = d.data();
                return { ...data, doc_id: d.id, _original: { ...data } };
            }).sort((a, b) => (a.display_order || 0) - (b.display_order || 0));
            
            // 消込履歴はReadOnly（receiptAllocationsの表示用フィールドを使用、N+1回避）
            currentAllocations = allocSnap.docs.map(d => {
                const data = d.data();
                return { ...data, doc_id: d.id };
            }).sort((a, b) => {
                const dateA = a.receiptDate || a.createdAt || '';
                const dateB = b.receiptDate || b.createdAt || '';
                return dateA > dateB ? 1 : -1;
            });

            // Fetch Customer Name and Snapshot
            let customerName = '不明';
            const customerId = currentInvoice.customer_id === undefined ? null : currentInvoice.customer_id;

            if (currentInvoice.customer_name_snapshot) {
                // We have a snapshot!
                currentCustomerSnapshot = {
                    customer_name: currentInvoice.customer_name_snapshot,
                    postal_code: currentInvoice.customer_postal_code_snapshot || '',
                    address: currentInvoice.customer_address_snapshot || '',
                    building_name: currentInvoice.customer_building_snapshot || '',
                    title: currentInvoice.customer_title_snapshot || '御中'
                };
                customerName = currentCustomerSnapshot.customer_name;
            } else if (customerId !== null) {
                // Fallback to legacy master fetch
                const custSnap = await db.collection('customers').where('customer_id', '==', customerId).limit(1).get();
                if (!custSnap.empty) {
                    const data = custSnap.docs[0].data();
                    customerName = data.customer_name;
                    currentCustomerSnapshot = data; // Cache master data as snapshot for subsequent saves
                }
            }

            // Populate UI
            customerIdInput.value = currentInvoice.customer_id;
            customerSelectGroup.style.display = 'none';
            customerDisplayGroup.style.display = 'block';
            if (currentCustomerSnapshot) {
                renderCustomerPreview(currentCustomerSnapshot);
            }

            pageTitle.textContent = `請求詳細: ${customerName}`;
            btnDelete.style.display = 'flex';
            // PDF出力ボタンを表示（既存データがある場合のみ）
            const btnPdf = document.getElementById('btn-pdf-export');
            if (btnPdf) btnPdf.style.display = 'inline-flex';

            // Populate formState
            formState.invoice_number = currentInvoice.invoice_number || '';
            formState.invoice_date = currentInvoice.invoice_date || '';
            formState.due_date = currentInvoice.due_date || '';
            formState.status = currentInvoice.status || '下書き';
            formState.remarks = currentInvoice.remarks || '';

            document.getElementById('invoice_number').value = formState.invoice_number;
            document.getElementById('status').value = formState.status;

            const remarksEl = document.getElementById('remarks');
            if (remarksEl) remarksEl.value = formState.remarks;

            window.setDateValueById('invoice_date', formState.invoice_date);
            window.setDateValueById('due_date', formState.due_date);

            createdDateSpan.innerHTML = formatToJST(currentInvoice.created_date);
            lastUpdatedSpan.innerHTML = formatToJST(currentInvoice.last_updated);

            // Need to fetch related cases for display names in Items? 
            // `getCaseName` logic requires cases.
            // Collect unique case_ids from items and fetch them.
            const caseIds = [...new Set(currentItems.map(i => i.case_id).filter(id => id))];
            if (caseIds.length > 0) {
                const chunks = [];
                for (let i = 0; i < caseIds.length; i += 10) chunks.push(caseIds.slice(i, i + 10));

                const caseSnaps = await Promise.all(chunks.map(chunk =>
                    db.collection('cases').where('case_id', 'in', chunk).get()
                ));

                casesCache = [];
                caseSnaps.forEach(snap => {
                    snap.forEach(d => casesCache.push(d.data()));
                });
            }

            renderItems();
            renderAllocations();
            calculateTotals();

        } catch (err) {
            console.error('Load Invoice Error:', err);
            alert('データの読み込みに失敗しました\n' + err.message);
            window.location.href = 'invoice_list.html';
        }
    }

    let allCustomers = []; // 軽量顧客データを保持する配列

    async function loadCustomersForSearch() {
        try {
            // Firestoreから一括ロード（JS側で非アクティブを弾くためstatus関係なくロード）
            const snap = await db.collection('customers').get();
            allCustomers = snap.docs.map(doc => {
                const data = doc.data();
                return {
                    customer_id: data.customer_id,
                    customer_name: data.customer_name || '',
                    customer_kana: data.customer_kana || '',
                    customer_type: data.customer_type || '法人',
                    postal_code: data.postal_code || '',
                    address: data.address || '',
                    building_name: data.building_name || '',
                    status: data.status || '稼働中',
                    // ロード時に事前正規化して保持（パフォーマンス最適化）
                    search_name: typeof normalizeSearchText === 'function' ? normalizeSearchText(data.customer_name || '') : (data.customer_name || '').toLowerCase(),
                    search_kana: typeof normalizeSearchText === 'function' ? normalizeSearchText(data.customer_kana || '') : (data.customer_kana || '').toLowerCase()
                };
            }).filter(c => c.status !== '取引終了'); // 取引終了顧客は除外
            console.log(`[Autocomplete] Loaded ${allCustomers.length} active customers.`);
        } catch (e) {
            console.error("Failed to load customers for autocomplete:", e);
        }
    }

    function getDisplayAddress(customer) {
        if (!customer) return '';
        const parts = [];
        if (customer.postal_code) parts.push(`〒${customer.postal_code}`);
        if (customer.address) parts.push(customer.address);
        if (customer.building_name) parts.push(customer.building_name);
        return parts.join(' ').trim();
    }

    function renderCustomerPreview(data) {
        const previewCustomerId = document.getElementById('preview-customer-id');
        if (previewCustomerId) {
            previewCustomerId.textContent = data.customer_id || '';
        }
        previewZip.textContent = data.postal_code ? `〒${data.postal_code}` : '';
        previewAddress.textContent = data.address || '';
        previewBuilding.textContent = data.building_name || '';
        previewName.textContent = data.customer_name || '';
        previewTitle.textContent = data.title || (data.customer_type === '法人' ? '御中' : '様');
    }

    function setupCustomerAutocomplete() {
        if (btnChangeCustomer) {
            btnChangeCustomer.addEventListener('click', () => {
                customerDisplayGroup.style.display = 'none';
                customerSelectGroup.style.display = 'block';
                customerInput.value = '';
                customerIdInput.value = '';
                currentCustomerSnapshot = null;
                // フォーカスを検索インプットへ戻す
                setTimeout(() => customerInput.focus(), 50);
            });
        }

        let activeIndex = -1; // キーボード選択用のアクティブインデックス
        let currentMatches = [];

        const handleSearch = () => {
            const val = customerInput.value;
            autocompleteList.innerHTML = '';
            activeIndex = -1;
            currentMatches = [];
            if (!val) return;

            // 検索キーワードの正規化
            const keyword = typeof normalizeSearchText === 'function' ? normalizeSearchText(val) : val.toLowerCase();
            if (!keyword) return;

            // 部分一致でフィルタリング（事前正規化されたプロパティを使用）
            currentMatches = allCustomers.filter(c => 
                c.search_name.includes(keyword) || 
                c.search_kana.includes(keyword)
            ).slice(0, 10); // 最大10件

            currentMatches.forEach((m, idx) => {
                const div = document.createElement('div');
                div.className = 'autocomplete-item-row';
                div.style.padding = '8px 12px';
                div.style.borderBottom = '1px solid #e2e8f0';
                div.style.cursor = 'pointer';
                div.dataset.index = idx;

                const addr = getDisplayAddress(m);
                div.innerHTML = `
                    <div style="font-weight: 600; font-size: 11.5pt; color: #1e293b;">
                        <span style="color: #64748b; font-family: monospace; margin-right: 8px;">[${m.customer_id}]</span>${m.customer_name}
                    </div>
                    ${addr ? `<div style="font-size: 9.5pt; color: #64748b; margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${addr}</div>` : ''}
                `;

                div.addEventListener('click', () => selectCustomer(m));
                autocompleteList.appendChild(div);
            });
        };

        const selectCustomer = async (m) => {
            customerInput.value = m.customer_name;
            customerIdInput.value = m.customer_id;
            autocompleteList.innerHTML = '';
            currentCustomerSnapshot = m;
            renderCustomerPreview(m);
            customerSelectGroup.style.display = 'none';
            customerDisplayGroup.style.display = 'block';
            await loadCasesForSelect(m.customer_id);
        };

        const updateActiveItem = () => {
            const items = autocompleteList.querySelectorAll('.autocomplete-item-row');
            items.forEach((item, idx) => {
                if (idx === activeIndex) {
                    item.classList.add('autocomplete-active');
                    item.style.backgroundColor = 'var(--primary)';
                    item.style.color = '#ffffff';
                    // 子要素の文字色も白へ補正
                    const subText = item.querySelector('div:last-child');
                    if (subText) subText.style.color = '#ffffff';
                } else {
                    item.classList.remove('autocomplete-active');
                    item.style.backgroundColor = '';
                    item.style.color = '';
                    const subText = item.querySelector('div:last-child');
                    if (subText) subText.style.color = '#64748b';
                }
            });
        };

        customerInput.addEventListener('input', handleSearch);

        // キーボード操作の制御
        customerInput.addEventListener('keydown', (e) => {
            const items = autocompleteList.querySelectorAll('.autocomplete-item-row');
            if (items.length === 0) return;

            if (e.key === 'ArrowDown') {
                e.preventDefault();
                activeIndex = (activeIndex + 1) % items.length;
                updateActiveItem();
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                activeIndex = (activeIndex - 1 + items.length) % items.length;
                updateActiveItem();
            } else if (e.key === 'Enter') {
                e.preventDefault();
                if (activeIndex >= 0 && activeIndex < currentMatches.length) {
                    selectCustomer(currentMatches[activeIndex]);
                }
            } else if (e.key === 'Escape') {
                autocompleteList.innerHTML = '';
            }
        });

        document.addEventListener('click', (e) => {
            if (e.target !== customerInput) {
                autocompleteList.innerHTML = '';
            }
        });
    }

    async function loadCasesForSelect(custId) {
        if (!custId) return;

        // Firestore から案件を全件取得 ( customer_id に紐づくもの )
        const snap = await db.collection('cases').where('customer_id', '==', Number(custId)).get();
        casesCache = snap.docs.map(d => d.data());

        renderCasesDropdown();
    }

    function renderCasesDropdown() {
        const select = document.getElementById('modal-case-id');
        const filterCheckbox = document.getElementById('modal-filter-billable');
        const showOnlyBillable = filterCheckbox ? filterCheckbox.checked : true;

        select.innerHTML = '<option value="">-- 選択してください --</option>';

        if (casesCache.length === 0) {
            const opt = document.createElement('option');
            opt.value = '';
            opt.textContent = '選択可能な案件がありません';
            opt.disabled = true;
            select.appendChild(opt);
            return;
        }

        let addedCount = 0;

        casesCache.forEach(c => {
            const summary = c.billing_summary;

            // フォールバック条件の判定 (TEST-03, TEST-04, TEST-05)
            const isFallback = !summary || summary.schema_version !== 1 || summary.source_version !== 1;

            if (isFallback) {
                console.warn(`[BillingSummary] Case ${c.case_id} has invalid or missing billing summary. Falling back to default display.`);
            }

            // フィルタリング判定
            if (showOnlyBillable && !isFallback && summary.has_billable_items !== true) {
                return; // スキップ
            }

            // 表示テキストの構築 (仕様 3.2)
            let statusText = '';
            if (isFallback || !summary) {
                statusText = ''; // 未設定・フォールバック
            } else if (summary.has_billable_items === true) {
                statusText = `（未請求 ${summary.unbilled_count}件）`;
            } else if (summary.active_estimate_count > 0) {
                statusText = '（請求完了）';
            } else if (summary.has_legacy_items === true) {
                statusText = '（追跡対象外）';
            } else {
                statusText = '（見積なし）';
            }

            const opt = document.createElement('option');
            opt.value = c.case_id;
            opt.textContent = `${c.procedure_name || `案件 #${c.case_id}`}${statusText}`;
            select.appendChild(opt);
            addedCount++;
        });

        if (addedCount === 0) {
            const opt = document.createElement('option');
            opt.value = '';
            opt.textContent = '該当する案件がありません';
            opt.disabled = true;
            select.appendChild(opt);
        }
    }

    // チェックボックス変更イベントの紐付け
    document.addEventListener('DOMContentLoaded', () => {
        // DOMContentLoaded は外側で設定されているので、この関数内では後ほどイベントをバインドするか、
        // もしくは loadCasesForSelect の外側でイベントバインドする。
    });
    
    // イベントバインドは document.getElementById('modal-filter-billable') の有無を確認し、あればバインド
    setTimeout(() => {
        const filterCheckbox = document.getElementById('modal-filter-billable');
        if (filterCheckbox) {
            filterCheckbox.addEventListener('change', () => {
                renderCasesDropdown();
            });
        }
    }, 100);


    function getCaseName(id) {
        if (!id) return 'ー';
        // Check cache first
        let c = casesCache.find(item => item.case_id === Number(id));
        // If not in cache (e.g. loaded invoice items but case list not re-fetched fully in loadInvoice logic yet properly?), 
        // return ID or wait. `loadInvoice` attempts to fetch needed cases.
        return c ? c.procedure_name : `ID: ${id}`;
    }

    // --- Totals Calculation ---

    function calculateTotals() {
        let taxable = 0;
        let nontaxable = 0;

        currentItems.forEach(item => {
            const amt = Number(item.amount) || 0;
            if (item.is_taxable) {
                taxable += amt;
            } else {
                nontaxable += amt;
            }
        });

        const tax = Math.floor(taxable * 0.1);
        const total = taxable + tax + nontaxable;

        dispSubtotalTaxable.textContent = formatCurrency(taxable);
        dispTaxAmount.textContent = formatCurrency(tax);
        dispSubtotalNontaxable.textContent = formatCurrency(nontaxable);
        dispTotalAmount.textContent = formatCurrency(total);

        // 入金合計・残高はinvoicesドキュメントのallocatedAmount/balanceを使用（SSoT）
        const allocatedAmount = currentInvoice ? (currentInvoice.allocatedAmount || 0) : 0;
        const balance = total - allocatedAmount;

        dispPaymentTotal.textContent = formatCurrency(allocatedAmount);
        dispBalance.textContent = formatCurrency(balance);

        // Balance Color + unpaid highlight
        if (balance <= 0) {
            dispBalance.style.color = '#059669';
            dispBalance.classList.remove('unpaid');
        } else {
            dispBalance.style.color = '#dc2626';
            dispBalance.classList.add('unpaid');
        }

        return { taxable, tax, nontaxable, total, payTotal: allocatedAmount, balance };
    }

    // --- Rendering ---

    function renderItems() {
        itemListBody.innerHTML = '';
        currentItems.forEach((item, index) => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${item.item_type}</td>
                <td>${getCaseName(item.case_id)}</td>
                <td>${item.description}</td>
                <td style="text-align: right;">${formatCurrency(item.unit_price)}</td>
                <td style="text-align: right;">${item.quantity}</td>
                <td style="text-align: right;">${formatCurrency(item.amount)}</td>
                <td style="text-align: center;">${item.is_taxable ? '○' : '×'}</td>
                <td style="text-align: center;"><button class="secondary-btn" style="padding: 4px 8px; font-size: 0.8rem;" onclick="editLocalItem(${index})">編集</button></td>
            `;
            itemListBody.appendChild(row);
        });
    }

    function renderAllocations() {
        paymentListBody.innerHTML = '';
        if (currentAllocations.length === 0) {
            paymentListBody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: #94a3b8; padding: 16px;">消込履歴はありません</td></tr>';
            return;
        }
        currentAllocations.forEach(a => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${formatDate(a.receiptDate || a.createdAt)}</td>
                <td>${formatCurrency(a.amount)}</td>
                <td>${a.payerName || 'ー'}</td>
                <td><span class="badge status-paid" style="font-size: 0.75rem;">消込済</span></td>
            `;
            paymentListBody.appendChild(row);
        });
    }

    // --- Logic ---

    window.editLocalItem = function (index) {
        editingItemIndex = index;
        const item = currentItems[index];

        document.getElementById('modal-item-type').value = item.item_type;
        // Case ID Select needs options. If New Invoice, loaded via Autocomplete select.
        // If Edit Invoice, `loadInvoice` fetched cases? No, `loadInvoice` fetched cases for EXISTING items.
        // If we want to add/change case, we need the dropdown populated.
        // `loadCasesForSelect` should be called with customer_id if not already populated.
        const custId = customerIdInput.value;
        if (document.getElementById('modal-case-id').options.length <= 1 && custId) {
            loadCasesForSelect(custId).then(() => {
                document.getElementById('modal-case-id').value = item.case_id || '';
            });
        } else {
            document.getElementById('modal-case-id').value = item.case_id || '';
        }

        document.getElementById('modal-description').value = item.description;
        document.getElementById('modal-unit-price').value = item.unit_price;
        document.getElementById('modal-quantity').value = item.quantity;
        document.getElementById('modal-is-taxable').checked = item.is_taxable;

        document.querySelector('#item-modal .modal-header h3').textContent = '明細編集';
        document.getElementById('btn-modal-delete-item').style.display = 'block';
        btnModalAddItem.textContent = '保存';

        itemModal.style.display = 'block';
    };

    // deleteLocalPayment は廃止（入金は消込画面で管理）

    // autoUpdateStatus: allocatedAmount ベースのステータス自動判定（ReadOnly参照）
    // ※ 入金ステータスはcommon.jsのトランザクション関数が正規に更新するため、
    //   ここでは明細変更時のtotal_amount変動に対する補助的な再計算に留める
    function autoUpdateStatus() {
        const { total, payTotal, balance } = calculateTotals();
        const statusEl = document.getElementById('status');
        // allocatedAmount（消込画面が正規管理）に基づくステータスは変更しない
        // ただし明細変更で total が変わった場合のみ再計算
        if (currentInvoice && currentInvoice.allocatedAmount > 0) {
            // 消込済みデータがある場合はステータスを自動変更しない
            return;
        }
        // 新規or消込なしの場合のみステータス自動設定
        statusEl.value = formState.status;
    }

    function isItemChanged(item, newOrder) {
        if (!item.doc_id) return true;
        const orig = item._original;
        if (!orig) return true;
        return (
            item.item_type !== orig.item_type ||
            item.case_id !== orig.case_id ||
            item.estimate_item_id !== orig.estimate_item_id ||
            item.description !== orig.description ||
            Number(item.unit_price) !== Number(orig.unit_price) ||
            Number(item.quantity) !== Number(orig.quantity) ||
            Number(item.amount) !== Number(orig.amount) ||
            item.is_taxable !== orig.is_taxable ||
            newOrder !== orig.display_order
        );
    }

    // isPaymentChanged は廃止（payments コレクションへの書き込みは行わない）

    async function handleSave() {
        if (isSaving) return;

        // Explicitly sync formState from current visible inputs right before validating and saving
        formState.invoice_number = document.getElementById('invoice_number').value;
        formState.invoice_date = document.getElementById('invoice_date').value;
        formState.due_date = document.getElementById('due_date').value;
        formState.status = document.getElementById('status').value;
        const remarksEl = document.getElementById('remarks');
        if (remarksEl) formState.remarks = remarksEl.value;

        let custId = parseInt(customerIdInput.value);
        // Phase 1: URLパラメータからの強制上書き (バックエンドロック)
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('source') === 'customer' && urlParams.get('customerId')) {
            custId = parseInt(urlParams.get('customerId'));
            customerIdInput.value = custId; // バリデーション回避用
        }

        if (!customerIdInput.value || isNaN(custId) || custId <= 0) {
            alert('顧客が確定していません。検索候補リストから顧客を選択して確定させてください。');
            if (customerInput) customerInput.focus();
            return;
        }

        if (!formState.invoice_date) {
            alert('請求日を入力してください。');
            return;
        }

        if (currentItems.length === 0) {
            alert('請求明細を1件以上入力してください。');
            return;
        }

        const { taxable, tax, nontaxable, total, payTotal, balance } = calculateTotals();

        const beforeCaseIds = currentItems
            .map(item => (item._original ? item._original.case_id : item.case_id))
            .filter(Boolean);

        isSaving = true;
        btnSave.disabled = true;
        const originalHtml = btnSave.innerHTML;
        btnSave.innerHTML = '<i data-lucide="loader" class="spin"></i> 保存中...';
        if (typeof lucide !== 'undefined') lucide.createIcons();

        try {
            const batch = db.batch();
            let iId;
            let invRef;
            const serverTimestamp = firebase.firestore.FieldValue.serverTimestamp();

            if (currentInvoiceId) {
                invRef = db.collection('invoices').doc(currentInvoiceId);
                const invDoc = await invRef.get();
                if (!invDoc.exists) throw new Error('対象の請求データが見つかりません。');
                iId = invDoc.data().invoice_id;
            } else {
                iId = await getNextSequence('invoices');
                invRef = db.collection('invoices').doc(`inv_${iId}`);
            }

            let invNum = formState.invoice_number;
            if (!invNum) {
                if (currentInvoice && currentInvoice.invoice_number) {
                    invNum = currentInvoice.invoice_number;
                } else {
                    const year = new Date().getFullYear();
                    invNum = `${year}-${String(iId).padStart(3, '0')}`;
                }
            }

            const invoiceData = {
                invoice_id: iId,
                customer_id: custId,
                customer_name_snapshot: currentCustomerSnapshot ? (currentCustomerSnapshot.customer_name || '') : '',
                customer_postal_code_snapshot: currentCustomerSnapshot ? (currentCustomerSnapshot.postal_code || '') : '',
                customer_address_snapshot: currentCustomerSnapshot ? (currentCustomerSnapshot.address || '') : '',
                customer_building_snapshot: currentCustomerSnapshot ? (currentCustomerSnapshot.building_name || '') : '',
                customer_title_snapshot: currentCustomerSnapshot ? (currentCustomerSnapshot.title || '') : '',
                invoice_number: invNum,
                invoice_date: formState.invoice_date,
                due_date: formState.due_date || null,
                subtotal_taxable: taxable,
                tax_amount: tax,
                subtotal_nontaxable: nontaxable,
                total_amount: total ?? 0,
                // paid_amount は廃止（allocatedAmount に統一、common.jsトランザクション関数のみが更新）
                // balance は保存時にtotal_amountベースで初期化（消込がない場合）
                status: formState.status || '下書き',
                remarks: formState.remarks || '',
                last_updated: serverTimestamp
            };

            if (formState.source_type) {
                invoiceData.source_type = formState.source_type;
                invoiceData.source_id = formState.source_id;
                invoiceData.case_id = formState.case_id;
                invoiceData.case_number = formState.case_number;
            }

            if (!currentInvoiceId) {
                invoiceData.created_date = serverTimestamp;
            }

            if (currentInvoiceId) {
                batch.update(invRef, invoiceData);
            } else {
                batch.set(invRef, invoiceData);
            }

            // Save Items (Differential)
            currentItems.forEach((item, idx) => {
                const newOrder = idx + 1;
                if (!isItemChanged(item, newOrder)) return;

                const itemData = {
                    invoice_id: iId,
                    item_type: item.item_type,
                    case_id: item.case_id || null,
                    estimate_item_id: item.estimate_item_id || null,
                    description: item.description || '',
                    unit_price: Number(item.unit_price),
                    quantity: Number(item.quantity),
                    amount: Number(item.amount),
                    is_taxable: !!item.is_taxable,
                    display_order: newOrder
                };

                if (item.doc_id) {
                    itemData.last_updated = serverTimestamp;
                    batch.update(db.collection('invoice_items').doc(item.doc_id), itemData);
                } else {
                    itemData.created_date = serverTimestamp;
                    itemData.last_updated = serverTimestamp;
                    batch.set(db.collection('invoice_items').doc(), itemData);
                }
            });

            // Delete Items
            deletedItemDocIds.forEach(docId => {
                batch.delete(db.collection('invoice_items').doc(docId));
            });

            // payments コレクションへの保存は廃止（入金は消込画面で管理）

            // 新規作成時のみ balance を初期設定（既存請求書のbalanceは消込トランザクションが管理）
            if (!currentInvoiceId) {
                batch.update(invRef, {
                    balance: total ?? 0,
                    allocatedAmount: 0
                });
            }

            await batch.commit();

            const afterCaseIds = currentItems
                .map(item => item.case_id)
                .filter(Boolean);
            const affectedCaseIds = [...new Set([...beforeCaseIds, ...afterCaseIds])].filter(Boolean);
            triggerBillingSummaryRebuild(affectedCaseIds);

            // 成功後にフラグ等のリセット
            deletedItemDocIds = [];

            // 現在のステートを _original として更新（リロードせず継続編集する場合への備え）
            currentItems.forEach((item, idx) => {
                item.display_order = idx + 1;
                item._original = { ...item };
            });

            if (typeof showToast === 'function') {
                showToast('請求データを保存しました', 'success');
            } else {
                showToast('請求データを保存しました', 'success');
            }

            if (!currentInvoiceId) {
                currentInvoiceId = invRef.id;
                history.replaceState(null, '', `?id=${currentInvoiceId}`);
            }

            // Phase 1: 保存成功後の自動復帰
            const returnCustomerId = urlParams.get('returnCustomerId');
            const returnTab = urlParams.get('returnTab');
            const returnCaseId = urlParams.get('returnCaseId');
            if (urlParams.get('source') === 'customer' && returnCustomerId && returnTab) {
                setTimeout(() => {
                    window.location.href = `customer_detail.html?id=${returnCustomerId}&activeTab=${returnTab}`;
                }, 1000);
            } else if (urlParams.get('source') === 'case' && returnCaseId) {
                setTimeout(() => {
                    window.location.href = `detail.html?id=${returnCaseId}`;
                }, 1000);
            }

            // setTimeout(() => {
            //     window.location.href = 'invoice_list.html';
            // }, 1000);

        } catch (err) {
            console.error('Save failed:', err);
            alert('保存に失敗しました。通信環境や権限をご確認ください。\n詳細: ' + err.message);
        } finally {
            isSaving = false;
            btnSave.disabled = false;
            btnSave.innerHTML = originalHtml;
            if (typeof lucide !== 'undefined') lucide.createIcons();
        }
    }

    async function deleteInvoice() {
        if (!currentInvoiceId) return;
        if (!confirm('この請求データを無効化（取消）しますか？\n消込記録等はそのまま残りますが、一覧からは除外（または取消表示）されます。')) return;

        try {
            const invRef = db.collection('invoices').doc(currentInvoiceId);
            const invDoc = await invRef.get();

            if (invDoc.exists) {
                // 論理削除（ステータス変更）として処理
                // 残高は 0 またはそのままにする運用がありますが、今回は無効化として balance=0 にして未収計算から外す処理も考えられます。
                // 安全のため、status のみを cancelled にし、残高ロジックはクエリ側(status != cancelled)で除外する前提とします。
                await invRef.update({
                    status: 'cancelled',
                    last_updated: firebase.firestore.FieldValue.serverTimestamp()
                });

                const affectedCaseIds = currentItems
                    .map(item => item.case_id)
                    .filter(Boolean);
                const uniqueCaseIds = [...new Set(affectedCaseIds)].filter(Boolean);
                triggerBillingSummaryRebuild(uniqueCaseIds);
            }

            showToast('無効化が完了しました', 'success');
            setTimeout(() => {
                window.location.href = 'invoice_list.html';
            }, 1000);
        } catch (err) {
            console.error('Delete/Cancel failed:', err);
            alert('無効化処理に失敗しました');
        }
    }

    // --- Billing Summary Rebuild Hook ---
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

    function triggerBillingSummaryRebuild(affectedCaseIds) {
        if (!affectedCaseIds || affectedCaseIds.length === 0) return;
        
        console.info(`[BillingSummary] Rebuild started for cases: ${affectedCaseIds.join(', ')}`);
        
        Promise.allSettled(
            affectedCaseIds.map(id => rebuildWithRetry(id))
        ).then(results => {
            results.forEach((result, idx) => {
                if (result.status === 'rejected') {
                    const caseId = affectedCaseIds[idx];
                    console.error(`[BillingSummary] Rebuild FAILED for case ${caseId}:`, result.reason);
                    
                    const errorRef = db.collection('billing_summary_errors').doc(`case_${caseId}`);
                    
                    errorRef.get().then(docSnap => {
                        const data = docSnap.exists ? docSnap.data() : null;
                        const isNewError = !data || data.resolved === true;
                        
                        let recentErrors = data && data.recent_errors ? data.recent_errors : [];
                        const errorMsg = String(result.reason);
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
                }
            });
            console.info(`[BillingSummary] Rebuild completed. ${results.filter(r => r.status === 'fulfilled').length}/${results.length} succeeded.`);
        });
    }

    // --- Modal Helpers ---
    window.closeModal = function (id) {
        document.getElementById(id).style.display = 'none';
    };

    btnAddItem.addEventListener('click', async () => {
        const custId = customerIdInput.value;
        if (!custId) {
            alert('先に顧客を選択してください。');
            return;
        }

        // Ensure Cases are loaded
        if (document.getElementById('modal-case-id').options.length <= 1) {
            await loadCasesForSelect(custId);
        }

        // Reset to Add Mode
        editingItemIndex = -1;
        document.querySelector('#item-modal .modal-header h3').textContent = '明細追加';
        document.getElementById('btn-modal-delete-item').style.display = 'none';
        btnModalAddItem.textContent = '追加';

        // Reset fields
        document.getElementById('modal-item-type').value = '手数料';
        document.getElementById('modal-case-id').value = '';
        document.getElementById('modal-description').value = '';
        document.getElementById('modal-unit-price').value = 0;
        document.getElementById('modal-quantity').value = 1;
        document.getElementById('modal-is-taxable').checked = true;

        itemModal.style.display = 'block';
    });

    // btnAddPayment イベントリスナーは廃止（入金は消込画面で管理）

    // Save Item (Add or Update)
    btnModalAddItem.addEventListener('click', () => {
        const type = document.getElementById('modal-item-type').value;
        const caseId = document.getElementById('modal-case-id').value;
        const desc = document.getElementById('modal-description').value;
        const price = Number(document.getElementById('modal-unit-price').value);
        const qty = Number(document.getElementById('modal-quantity').value);
        const taxable = document.getElementById('modal-is-taxable').checked;

        if (!desc) {
            alert('内容を入力してください。');
            return;
        }

        const itemData = {
            item_type: type,
            case_id: caseId ? Number(caseId) : null,
            description: desc,
            unit_price: price,
            quantity: qty,
            amount: price * qty,
            is_taxable: taxable
        };

        if (editingItemIndex >= 0) {
            // Update existing
            currentItems[editingItemIndex] = { ...currentItems[editingItemIndex], ...itemData };
        } else {
            // Add new
            currentItems.push(itemData);
        }

        renderItems();
        calculateTotals();
        closeModal('item-modal');
    });

    // Delete Item (from Modal)
    document.getElementById('btn-modal-delete-item').addEventListener('click', () => {
        if (editingItemIndex >= 0) {
            if (confirm('この明細を削除しますか？')) {
                const item = currentItems[editingItemIndex];
                if (item && item.doc_id) {
                    deletedItemDocIds.push(item.doc_id);
                }
                currentItems.splice(editingItemIndex, 1);
                renderItems();
                calculateTotals();
                closeModal('item-modal');
            }
        }
    });

    // btnModalAddPayment イベントリスナーは廃止（入金は消込画面で管理）

    // --- Estimate Import Logic ---
    const importCandidatesState = { items: [] }; // Using object for reference if needed, or just let var

    if (btnImport) {
        btnImport.addEventListener('click', async () => {
            const custId = customerIdInput.value;
            if (!custId) {
                alert('先に顧客を選択してください。');
                return;
            }

            // Populate Cases
            importCaseSelect.innerHTML = '<option value="">-- 案件を選択してください --</option>';
            importItemList.innerHTML = '<tr><td colspan="5" style="padding: 16px; text-align: center; color: #64748b;">案件を選択してください</td></tr>';
            importCandidatesState.items = [];
            importCheckAll.checked = false;

            // Fetch cases
            const snap = await db.collection('cases').where('customer_id', '==', Number(custId)).get();
            if (snap.empty) {
                alert('この顧客には案件が登録されていません。');
                return;
            }

            casesCache = snap.docs.map(d => d.data()); // Update cache

            casesCache.forEach(c => {
                const opt = document.createElement('option');
                opt.value = c.case_id;
                opt.textContent = c.procedure_name || `案件 #${c.case_id}`;
                importCaseSelect.appendChild(opt);
            });

            importModal.style.display = 'block';
        });
    }

    if (importCaseSelect) {
        importCaseSelect.addEventListener('change', async () => {
            const caseId = Number(importCaseSelect.value);
            if (!caseId) {
                importItemList.innerHTML = '<tr><td colspan="5" style="padding: 16px; text-align: center; color: #64748b;">案件を選択してください</td></tr>';
                importCandidatesState.items = [];
                return;
            }

            const selectedCase = casesCache.find(c => c.case_id === caseId);
            if (!selectedCase) return;

            // 読み込み中表示
            importItemList.innerHTML = '<tr><td colspan="5" style="padding: 16px; text-align: center; color: #64748b;"><i data-lucide="loader" class="spin"></i> 読み込み中...</td></tr>';
            if (typeof lucide !== 'undefined') lucide.createIcons();

            let items = [];
            if (selectedCase.estimate_items && Array.isArray(selectedCase.estimate_items) && selectedCase.estimate_items.length > 0) {
                items = JSON.parse(JSON.stringify(selectedCase.estimate_items));
            } else {
                const fee = Number(selectedCase.estimated_fee) || 0;
                const reimbursement = Number(selectedCase.suspense_receipt_amount) || Number(selectedCase.reimbursement_fee) || 0;
                if (fee > 0) items.push({ type: '手数料', description: '手数料', unit_price: fee, quantity: 1, amount: fee, is_taxable: true });
                if (reimbursement > 0) items.push({ type: '仮受金', description: '仮受金', unit_price: reimbursement, quantity: 1, amount: reimbursement, is_taxable: false });
            }

            // 請求履歴の動的集計
            let billedEstimateItemsMap = new Map();
            try {
                const custId = Number(customerIdInput.value);
                const [invSnap, invItemsSnap] = await Promise.all([
                    db.collection('invoices').where('customer_id', '==', custId).get(),
                    db.collection('invoice_items').where('case_id', '==', caseId).get()
                ]);

                const activeInvoicesMap = new Map();
                invSnap.docs.forEach(d => {
                    const inv = d.data();
                    if (inv.status !== '取消') {
                        activeInvoicesMap.set(inv.invoice_id, inv.invoice_number || `ID:${inv.invoice_id}`);
                    }
                });

                invItemsSnap.docs.forEach(d => {
                    const item = d.data();
                    if (item.estimate_item_id && activeInvoicesMap.has(item.invoice_id)) {
                        billedEstimateItemsMap.set(item.estimate_item_id, activeInvoicesMap.get(item.invoice_id));
                    }
                });
            } catch (e) {
                console.error('Failed to load billing history for import:', e);
            }

            importCandidatesState.items = items;

            importItemList.innerHTML = '';
            if (items.length === 0) {
                importItemList.innerHTML = '<tr><td colspan="5" style="padding: 16px; text-align: center; color: #64748b;">見積明細がありません。</td></tr>';
                return;
            }

            items.forEach((item, index) => {
                const row = document.createElement('tr');
                
                // 状態判定
                let statusText = '';
                let statusStyle = '';
                let rowStyle = '';
                
                if (item.is_legacy === true || !item.estimate_item_id) {
                    statusText = '⚠️ 追跡対象外 (旧データ等)';
                    statusStyle = 'color: #d97706; font-size: 0.85rem; font-weight: bold;';
                } else if (billedEstimateItemsMap.has(item.estimate_item_id)) {
                    const invNum = billedEstimateItemsMap.get(item.estimate_item_id);
                    statusText = `🔄 請求履歴あり (請求書 #${invNum})`;
                    statusStyle = 'color: #2563eb; font-size: 0.85rem; font-weight: bold;';
                    rowStyle = 'background-color: #f8fafc;'; // 薄いグレー背景
                } else {
                    statusText = '未請求';
                    statusStyle = 'color: #10b981; font-size: 0.85rem;';
                }

                if (rowStyle) {
                    row.style.cssText = rowStyle;
                }

                row.innerHTML = `
                    <td style="padding: 8px; border-bottom: 1px solid #e2e8f0; text-align: center;">
                        <input type="checkbox" class="import-checkbox" data-index="${index}" checked>
                    </td>
                    <td style="padding: 8px; border-bottom: 1px solid #e2e8f0;">${item.type}</td>
                    <td style="padding: 8px; border-bottom: 1px solid #e2e8f0;">${item.description}</td>
                    <td style="padding: 8px; border-bottom: 1px solid #e2e8f0; text-align: right;">${formatCurrency(item.amount)}</td>
                    <td style="padding: 8px; border-bottom: 1px solid #e2e8f0; ${statusStyle}">${statusText}</td>
                `;
                importItemList.appendChild(row);
            });
            importCheckAll.checked = true;
        });
    }

    if (btnExecuteImport) {
        btnExecuteImport.addEventListener('click', () => {
            const checkboxes = document.querySelectorAll('.import-checkbox:checked');
            if (checkboxes.length === 0) {
                alert('取り込む明細を選択してください。');
                return;
            }

            const caseId = Number(importCaseSelect.value);

            checkboxes.forEach(cb => {
                const index = Number(cb.dataset.index);
                const srcItem = importCandidatesState.items[index];

                const newItem = {
                    item_type: srcItem.type,
                    case_id: caseId,
                    estimate_item_id: srcItem.estimate_item_id || null,
                    description: srcItem.description,
                    unit_price: srcItem.unit_price,
                    quantity: srcItem.quantity,
                    amount: srcItem.amount,
                    is_taxable: srcItem.is_taxable
                };
                currentItems.push(newItem);
            });

            renderItems();
            calculateTotals();
            closeModal('import-modal');
            alert(`${checkboxes.length}件の明細を取り込みました。`);
        });
    }

    if (importCheckAll) {
        importCheckAll.addEventListener('change', (e) => {
            const checkboxes = document.querySelectorAll('.import-checkbox');
            checkboxes.forEach(cb => cb.checked = e.target.checked);
        });
    }

    // --- Events ---
    btnSave.addEventListener('click', handleSave);
    btnDelete.addEventListener('click', deleteInvoice);

    // 顧客詳細に戻るボタン
    const btnBackToCustomer = document.getElementById('btn-back-to-customer');
    if (btnBackToCustomer) {
        btnBackToCustomer.addEventListener('click', () => {
            const customerIdValue = customerIdInput.value;
            if (!customerIdValue) {
                window.location.href = 'invoice_list.html';
                return;
            }
            window.location.href = `customer_detail.html?id=${customerIdValue}`;
        });
    }

    // Fallback for generic back button if exists and not covered
    const btnBack = document.querySelector('.btn-back');
    // Usually covered by specific IDs, but just in case

    // Start
    init();
});
