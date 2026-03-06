document.addEventListener('DOMContentLoaded', () => {
    // --- Selectors ---
    const pageTitle = document.getElementById('page-title');
    const btnSave = document.getElementById('btn-save-invoice');
    const btnDelete = document.getElementById('btn-delete-invoice');
    const btnAddItem = document.getElementById('btn-add-item');
    const btnAddPayment = document.getElementById('btn-add-payment');

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
    const paymentModal = document.getElementById('payment-modal');
    const btnModalAddItem = document.getElementById('btn-modal-add-item');
    const btnModalAddPayment = document.getElementById('btn-modal-add-payment');

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
    let currentPayments = []; // Work payments in memory

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

    async function init() {
        console.log("=== init() START ===");
        console.log("window.location.search: ", window.location.search);
        console.log("currentInvoiceId parsed: ", currentInvoiceId);
        bindBasicInfoEvents();
        if (currentInvoiceId && currentInvoiceId !== 'new' && currentInvoiceId !== 'undefined' && currentInvoiceId !== 'null') {
            console.log("Executing loadInvoice with docId: ", currentInvoiceId);
            await loadInvoice(currentInvoiceId);
        } else {
            console.log("Executing initNewInvoice (Fallback)");
            currentInvoiceId = null;
            await initNewInvoice();
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

        const iDateEl = document.getElementById('invoice_date');
        if (iDateEl) {
            if (iDateEl._flatpickr) iDateEl._flatpickr.setDate(formState.invoice_date);
            else iDateEl.value = formState.invoice_date;
        }

        // Setup Autocomplete (Fetch all customers? Or use search?)
        // For scalability, simple search against 'customers' collection.
        setupCustomerAutocomplete();
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

            const [itemsSnap, paysSnap] = await Promise.all([
                db.collection('invoice_items').where('invoice_id', '==', iId).get(),
                db.collection('payments').where('invoice_id', '==', iId).get()
            ]);
            currentItems = itemsSnap.docs.map(d => d.data()).sort((a, b) => (a.display_order || 0) - (b.display_order || 0));
            currentPayments = paysSnap.docs.map(d => d.data());

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

            const iDateEl = document.getElementById('invoice_date');
            if (iDateEl) {
                if (iDateEl._flatpickr) iDateEl._flatpickr.setDate(formState.invoice_date);
                else iDateEl.value = formState.invoice_date;
            }

            const dDateEl = document.getElementById('due_date');
            if (dDateEl) {
                if (dDateEl._flatpickr) dDateEl._flatpickr.setDate(formState.due_date);
                else dDateEl.value = formState.due_date;
            }

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
            renderPayments();
            calculateTotals();

        } catch (err) {
            console.error('Load Invoice Error:', err);
            alert('データの読み込みに失敗しました\n' + err.message);
            window.location.href = 'invoice_list.html';
        }
    }

    function renderCustomerPreview(data) {
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
            });
        }

        const handleSearch = async () => {
            const val = customerInput.value;
            autocompleteList.innerHTML = '';
            if (!val) return;

            try {
                const snap = await db.collection('customers')
                    .orderBy('customer_name')
                    .startAt(val)
                    .endAt(val + '\uf8ff')
                    .limit(5)
                    .get();

                snap.forEach(doc => {
                    const m = doc.data();
                    const div = document.createElement('div');
                    div.textContent = m.customer_name;
                    div.addEventListener('click', async () => {
                        customerInput.value = m.customer_name;
                        customerIdInput.value = m.customer_id;
                        autocompleteList.innerHTML = '';
                        currentCustomerSnapshot = m;
                        renderCustomerPreview(m);
                        customerSelectGroup.style.display = 'none';
                        customerDisplayGroup.style.display = 'block';
                        await loadCasesForSelect(m.customer_id);
                    });
                    autocompleteList.appendChild(div);
                });
            } catch (e) {
                console.error('Autocomplete Error:', e);
            }
        };

        customerInput.addEventListener('input', handleSearch);
        if (btnCustomerSearch) btnCustomerSearch.addEventListener('click', handleSearch);

        document.addEventListener('click', (e) => {
            if (e.target !== customerInput && e.target !== btnCustomerSearch) {
                autocompleteList.innerHTML = '';
            }
        });
    }

    async function loadCasesForSelect(custId) {
        if (!custId) return;
        const select = document.getElementById('modal-case-id');
        select.innerHTML = '<option value="">-- 選択してください --</option>';

        const snap = await db.collection('cases').where('customer_id', '==', Number(custId)).get();
        // Update cache (全件保持：getCaseName等で使用)
        casesCache = snap.docs.map(d => d.data());

        // 完了・取下げを除外した請求可能な案件のみプルダウンに表示
        const billableCases = casesCache.filter(c => !EXCLUDED_CASE_STATUSES.includes(c.status));

        if (billableCases.length === 0) {
            const opt = document.createElement('option');
            opt.value = '';
            opt.textContent = '選択可能な未請求案件がありません';
            opt.disabled = true;
            select.appendChild(opt);
            return;
        }

        billableCases.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c.case_id;
            opt.textContent = c.procedure_name || `案件 #${c.case_id}`;
            select.appendChild(opt);
        });
    }

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

        // Payments
        const payTotal = currentPayments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
        const balance = total - payTotal;

        dispPaymentTotal.textContent = formatCurrency(payTotal);
        dispBalance.textContent = formatCurrency(balance);

        // Balance Color + unpaid highlight
        if (balance <= 0) {
            dispBalance.style.color = '#059669';
            dispBalance.classList.remove('unpaid');
        } else {
            dispBalance.style.color = '#dc2626';
            dispBalance.classList.add('unpaid');
        }

        return { taxable, tax, nontaxable, total, payTotal, balance };
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

    function renderPayments() {
        paymentListBody.innerHTML = '';
        currentPayments.forEach((p, index) => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${formatDate(p.payment_date)}</td>
                <td>${formatCurrency(p.amount)}</td>
                <td>${p.payment_method}</td>
                <td>${p.remarks || ''}</td>
                <td><button class="danger-btn" style="padding: 4px 8px; font-size: 0.8rem;" onclick="deleteLocalPayment(${index})">×</button></td>
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

    window.deleteLocalPayment = function (index) {
        currentPayments.splice(index, 1);
        renderPayments();
        calculateTotals();
        autoUpdateStatus();
    };

    function autoUpdateStatus() {
        const { total, payTotal, balance } = calculateTotals();
        const dueDate = document.getElementById('due_date').value; // Read directly from DOM
        const statusEl = document.getElementById('status');
        const today = new Date().toISOString().split('T')[0];

        // Only auto-update if not manually changed to specific override? 
        // Usually safer to just suggest. But let's keep logic simple.
        if (payTotal >= total && total > 0) {
            formState.status = '入金済';
        } else if (payTotal > 0) {
            formState.status = '一部入金';
        } else {
            formState.status = '発行済'; // Default
        }

        if (dueDate && dueDate < today && balance > 0) {
            formState.status = '延滞';
        }

        statusEl.value = formState.status;
    }

    async function handleSave() {
        if (isSaving) return;

        // Explicitly sync formState from current visible inputs right before validating and saving
        formState.invoice_number = document.getElementById('invoice_number').value;
        formState.invoice_date = document.getElementById('invoice_date').value;
        formState.due_date = document.getElementById('due_date').value;
        formState.status = document.getElementById('status').value;
        const remarksEl = document.getElementById('remarks');
        if (remarksEl) formState.remarks = remarksEl.value;

        const custId = Number(customerIdInput.value);
        if (!custId) {
            alert('顧客を選択してください。');
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

        const { taxable, tax, nontaxable, total } = calculateTotals();

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
                total_amount: total,
                status: formState.status,
                remarks: formState.remarks,
                last_updated: serverTimestamp
            };

            if (!currentInvoiceId) {
                invoiceData.created_date = serverTimestamp;
            }

            if (currentInvoiceId) {
                batch.update(invRef, invoiceData);

                // Cleanup old Sub-collections
                const oldItems = await db.collection('invoice_items').where('invoice_id', '==', iId).get();
                oldItems.forEach(d => batch.delete(d.ref));

                const oldPays = await db.collection('payments').where('invoice_id', '==', iId).get();
                oldPays.forEach(d => batch.delete(d.ref));

            } else {
                batch.set(invRef, invoiceData);
            }

            // Save Items
            currentItems.forEach((item, idx) => {
                const itemRef = db.collection('invoice_items').doc(); // Auto
                batch.set(itemRef, {
                    invoice_id: iId,
                    item_type: item.item_type,
                    case_id: item.case_id || null,
                    description: item.description,
                    unit_price: Number(item.unit_price),
                    quantity: Number(item.quantity),
                    amount: Number(item.amount),
                    is_taxable: item.is_taxable,
                    display_order: idx + 1,
                    created_date: serverTimestamp
                });
            });

            // Save Payments
            currentPayments.forEach(p => {
                const payRef = db.collection('payments').doc(); // Auto
                batch.set(payRef, {
                    invoice_id: iId,
                    payment_date: p.payment_date,
                    amount: Number(p.amount),
                    payment_method: p.payment_method,
                    remarks: p.remarks || '',
                    created_date: serverTimestamp
                });
            });

            await batch.commit();

            if (typeof showToast === 'function') {
                showToast('請求データを保存しました', 'success');
            } else {
                showToast('請求データを保存しました', 'success');
            }

            if (!currentInvoiceId) {
                currentInvoiceId = invRef.id;
                history.replaceState(null, '', `?id=${currentInvoiceId}`);
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
        if (!confirm('この請求データを削除しますか？付随する明細と入金記録も削除されます。')) return;

        try {
            const batch = db.batch();
            const invRef = db.collection('invoices').doc(currentInvoiceId);
            const invDoc = await invRef.get();

            if (invDoc.exists) {
                const iId = invDoc.data().invoice_id;
                batch.delete(invRef);

                // Items
                const itemsSnap = await db.collection('invoice_items').where('invoice_id', '==', iId).get();
                itemsSnap.forEach(d => batch.delete(d.ref));

                // Payments
                const paySnap = await db.collection('payments').where('invoice_id', '==', iId).get();
                paySnap.forEach(d => batch.delete(d.ref));
            }

            await batch.commit();
            showToast('削除が完了しました', 'success');
            setTimeout(() => {
                window.location.href = 'invoice_list.html';
            }, 1000);
        } catch (err) {
            console.error('Delete failed:', err);
            alert('削除に失敗しました');
        }
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
        document.getElementById('modal-item-type').value = '報酬';
        document.getElementById('modal-case-id').value = '';
        document.getElementById('modal-description').value = '';
        document.getElementById('modal-unit-price').value = 0;
        document.getElementById('modal-quantity').value = 1;
        document.getElementById('modal-is-taxable').checked = true;

        itemModal.style.display = 'block';
    });

    btnAddPayment.addEventListener('click', () => {
        document.getElementById('modal-payment-date').value = new Date().toISOString().split('T')[0];
        paymentModal.style.display = 'block';
    });

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
                currentItems.splice(editingItemIndex, 1);
                renderItems();
                calculateTotals();
                closeModal('item-modal');
            }
        }
    });

    btnModalAddPayment.addEventListener('click', () => {
        const date = document.getElementById('modal-payment-date').value;
        const amount = Number(document.getElementById('modal-payment-amount').value);
        const method = document.getElementById('modal-payment-method').value;
        const remarks = document.getElementById('modal-payment-remarks').value;

        if (!date || amount <= 0) {
            alert('正しい日付と金額を入力してください。');
            return;
        }

        const newPayment = {
            payment_date: date,
            amount: amount,
            payment_method: method,
            remarks: remarks
        };

        currentPayments.push(newPayment);
        renderPayments();
        autoUpdateStatus();
        closeModal('payment-modal');

        // Reset fields
        document.getElementById('modal-payment-amount').value = 0;
        document.getElementById('modal-payment-remarks').value = '';
    });

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
            importItemList.innerHTML = '<tr><td colspan="4" style="padding: 16px; text-align: center; color: #64748b;">案件を選択してください</td></tr>';
            importCandidatesState.items = [];
            importCheckAll.checked = false;

            // Fetch cases
            const snap = await db.collection('cases').where('customer_id', '==', Number(custId)).get();
            if (snap.empty) {
                alert('この顧客には案件が登録されていません。');
                return;
            }

            casesCache = snap.docs.map(d => d.data()); // Update cache

            // 完了・取下げを除外した請求可能な案件のみ表示
            const billableCases = casesCache.filter(c => !EXCLUDED_CASE_STATUSES.includes(c.status));
            if (billableCases.length === 0) {
                alert('選択可能な未請求案件がありません。\nすべての案件が完了または取下げ済みです。');
                return;
            }

            billableCases.forEach(c => {
                const opt = document.createElement('option');
                opt.value = c.case_id;
                opt.textContent = c.procedure_name || `案件 #${c.case_id}`;
                importCaseSelect.appendChild(opt);
            });

            importModal.style.display = 'block';
        });
    }

    if (importCaseSelect) {
        importCaseSelect.addEventListener('change', () => {
            const caseId = Number(importCaseSelect.value);
            if (!caseId) {
                importItemList.innerHTML = '<tr><td colspan="4" style="padding: 16px; text-align: center; color: #64748b;">案件を選択してください</td></tr>';
                importCandidatesState.items = [];
                return;
            }

            const selectedCase = casesCache.find(c => c.case_id === caseId);
            if (!selectedCase) return;

            let items = [];
            if (selectedCase.estimate_items && Array.isArray(selectedCase.estimate_items) && selectedCase.estimate_items.length > 0) {
                items = JSON.parse(JSON.stringify(selectedCase.estimate_items));
            } else {
                const fee = Number(selectedCase.estimated_fee) || 0;
                const reimbursement = Number(selectedCase.reimbursement_fee) || 0;
                if (fee > 0) items.push({ type: '報酬', description: '報酬', unit_price: fee, quantity: 1, amount: fee, is_taxable: true });
                if (reimbursement > 0) items.push({ type: '立替金', description: '立替金', unit_price: reimbursement, quantity: 1, amount: reimbursement, is_taxable: false });
            }

            importCandidatesState.items = items;

            importItemList.innerHTML = '';
            if (items.length === 0) {
                importItemList.innerHTML = '<tr><td colspan="4" style="padding: 16px; text-align: center; color: #64748b;">見積明細がありません。</td></tr>';
                return;
            }

            items.forEach((item, index) => {
                const row = document.createElement('tr');
                row.innerHTML = `
                    <td style="padding: 8px; border-bottom: 1px solid #e2e8f0; text-align: center;">
                        <input type="checkbox" class="import-checkbox" data-index="${index}" checked>
                    </td>
                    <td style="padding: 8px; border-bottom: 1px solid #e2e8f0;">${item.type}</td>
                    <td style="padding: 8px; border-bottom: 1px solid #e2e8f0;">${item.description}</td>
                    <td style="padding: 8px; border-bottom: 1px solid #e2e8f0; text-align: right;">${formatCurrency(item.amount)}</td>
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
