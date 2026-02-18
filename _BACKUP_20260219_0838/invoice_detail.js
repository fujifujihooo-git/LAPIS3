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

    // --- State ---
    let currentInvoiceId = new URLSearchParams(window.location.search).get('id');
    let currentInvoice = null;
    let currentItems = []; // Work items in memory
    let currentPayments = []; // Work payments in memory

    // Cache for Customers/Cases (fetched on demand)
    let customersCache = [];
    let casesCache = []; // Cases for current customer

    let editingItemIndex = -1; // Edit mode state

    // --- Functions ---

    async function init() {
        if (currentInvoiceId) {
            currentInvoiceId = parseInt(currentInvoiceId);
            await loadInvoice(currentInvoiceId);
        } else {
            await initNewInvoice();
        }
    }

    async function initNewInvoice() {
        pageTitle.textContent = '新規請求作成';
        document.getElementById('invoice_date').value = new Date().toISOString().split('T')[0];
        // Note: Invoice ID is generated on save for Firestore usually, 
        // but if we want to show a tentative number, we can attempt to guess or just show "保存時に採番"
        // Existing logic used `generateNextInvoiceNumber` from loaded invoices.
        // We will show "新規" in display or leave blank.
        document.getElementById('invoice_number').value = '';
        document.getElementById('invoice_number').placeholder = '保存時に自動採番（または入力）';

        // Setup Autocomplete (Fetch all customers? Or use search?)
        // For scalability, simple search against 'customers' collection.
        setupCustomerAutocomplete();
    }

    async function loadInvoice(id) {
        try {
            const [invSnap, itemsSnap, paysSnap] = await Promise.all([
                db.collection('invoices').where('invoice_id', '==', id).limit(1).get(),
                db.collection('invoice_items').where('invoice_id', '==', id).get(),
                db.collection('payments').where('invoice_id', '==', id).get()
            ]);

            if (invSnap.empty) {
                alert('請求データが見つかりません。');
                window.location.href = 'invoice_list.html';
                return;
            }

            currentInvoice = invSnap.docs[0].data();
            currentItems = itemsSnap.docs.map(d => d.data()).sort((a, b) => (a.display_order || 0) - (b.display_order || 0));
            currentPayments = paysSnap.docs.map(d => d.data());

            // Fetch Customer Name
            const custSnap = await db.collection('customers').where('customer_id', '==', currentInvoice.customer_id).limit(1).get();
            const customerName = custSnap.empty ? '不明' : custSnap.docs[0].data().customer_name;

            // Populate UI
            customerIdInput.value = currentInvoice.customer_id;
            customerSelectGroup.style.display = 'none';
            customerDisplayGroup.style.display = 'block';
            customerNameDisplay.textContent = customerName;

            pageTitle.textContent = `請求詳細: ${customerName}`;
            btnDelete.style.display = 'flex';

            document.getElementById('invoice_number').value = currentInvoice.invoice_number;
            document.getElementById('invoice_date').value = currentInvoice.invoice_date;
            document.getElementById('due_date').value = currentInvoice.due_date || '';
            document.getElementById('status').value = currentInvoice.status;
            document.getElementById('remarks').value = currentInvoice.remarks || '';
            createdDateSpan.innerHTML = formatDate(currentInvoice.created_date);
            lastUpdatedSpan.innerHTML = formatDate(currentInvoice.last_updated);

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
            alert('データの読み込みに失敗しました');
        }
    }

    function setupCustomerAutocomplete() {
        customerInput.addEventListener('input', async function () {
            const val = this.value;
            autocompleteList.innerHTML = '';
            if (!val) return;

            // Simple prefix search or fetch all? 
            // Firestore doesn't support substring search well. 
            // For now, let's fetch all customers (if < 1000) or use `startAt`.
            // Assuming small dataset, fetching active customers is okay-ish, or just rely on exact match? 
            // Let's try `startAt` strategy for name? Or `orderBy('customer_name').startAt(val).endAt(val + '\uf8ff')`

            try {
                const snap = await db.collection('customers')
                    .orderBy('customer_name')
                    .startAt(val)
                    .endAt(val + '\uf8ff')
                    .limit(5)
                    .get();

                // Also check Kana? Firestore requires separate query. Skipping for simplicity.

                snap.forEach(doc => {
                    const m = doc.data();
                    const div = document.createElement('div');
                    div.textContent = m.customer_name;
                    div.addEventListener('click', async () => {
                        customerInput.value = m.customer_name;
                        customerIdInput.value = m.customer_id;
                        autocompleteList.innerHTML = '';
                        await loadCasesForSelect(m.customer_id);
                    });
                    autocompleteList.appendChild(div);
                });
            } catch (e) {
                console.error('Autocomplete Error:', e);
            }
        });

        document.addEventListener('click', (e) => {
            if (e.target !== customerInput) autocompleteList.innerHTML = '';
        });
    }

    async function loadCasesForSelect(custId) {
        if (!custId) return;
        const select = document.getElementById('modal-case-id');
        select.innerHTML = '<option value="">-- 選択してください --</option>';

        const snap = await db.collection('cases').where('customer_id', '==', Number(custId)).get();
        // Update cache
        casesCache = snap.docs.map(d => d.data());

        casesCache.forEach(c => {
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

        // Balance Color
        if (balance <= 0) {
            dispBalance.style.color = '#059669';
        } else {
            dispBalance.style.color = '#dc2626';
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
                <td>${formatCurrency(item.unit_price)}</td>
                <td>${item.quantity}</td>
                <td>${formatCurrency(item.amount)}</td>
                <td>${item.is_taxable ? '○' : '×'}</td>
                <td><button class="secondary-btn" style="padding: 4px 8px; font-size: 0.8rem;" onclick="editLocalItem(${index})">編集</button></td>
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
        const dueDate = document.getElementById('due_date').value;
        const statusEl = document.getElementById('status');
        const today = new Date().toISOString().split('T')[0];

        // Only auto-update if not manually changed to specific override? 
        // Usually safer to just suggest. But let's keep logic simple.
        if (payTotal >= total && total > 0) {
            statusEl.value = '入金済';
        } else if (payTotal > 0) {
            statusEl.value = '一部入金';
        } else {
            statusEl.value = '発行済'; // Default
        }

        if (dueDate && dueDate < today && balance > 0) {
            statusEl.value = '延滞';
        }
    }

    async function saveInvoice() {
        const custId = Number(customerIdInput.value);
        if (!custId) {
            alert('顧客を選択してください。');
            return;
        }

        let invNum = document.getElementById('invoice_number').value;
        const invDate = document.getElementById('invoice_date').value;
        if (!invNumberWait && !invNum) {
            // New invoice might not have number yet if auto-generated
        }
        if (!invDate) {
            alert('請求日を入力してください。');
            return;
        }

        const { taxable, tax, nontaxable, total } = calculateTotals();

        try {
            const batch = db.batch();

            let iId;
            let invRef;

            if (currentInvoiceId) {
                iId = currentInvoiceId;
                const snap = await db.collection('invoices').where('invoice_id', '==', iId).limit(1).get();
                if (snap.empty) throw new Error('Target invoice not found');
                invRef = snap.docs[0].ref;

                // For update, keep existing number if set
                if (!invNum) invNum = currentInvoice.invoice_number;

            } else {
                iId = await getNextSequence('invoices');
                // Generate Number if empty
                if (!invNum) {
                    const year = new Date().getFullYear();
                    invNum = `${year}-${String(iId).padStart(3, '0')}`;
                }

                invRef = db.collection('invoices').doc(`inv_${iId}`);
            }

            const invoiceData = {
                invoice_id: iId,
                customer_id: custId,
                invoice_number: invNum,
                invoice_date: invDate,
                due_date: document.getElementById('due_date').value,
                subtotal_taxable: taxable,
                tax_amount: tax,
                subtotal_nontaxable: nontaxable,
                total_amount: total,
                status: document.getElementById('status').value,
                remarks: document.getElementById('remarks').value,
                last_updated: new Date().toISOString()
            };

            if (!currentInvoiceId) {
                invoiceData.created_date = new Date().toISOString();
            }

            // Save Invoice
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
                    created_date: new Date().toISOString()
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
                    created_date: new Date().toISOString()
                });
            });

            await batch.commit();
            showToast('請求データを保存しました', 'success');
            setTimeout(() => {
                window.location.href = 'invoice_list.html';
            }, 1000);

        } catch (err) {
            console.error('Save failed:', err);
            alert('保存に失敗しました: ' + err.message);
        }
    }

    async function deleteInvoice() {
        if (!currentInvoiceId) return;
        if (!confirm('この請求データを削除しますか？付随する明細と入金記録も削除されます。')) return;

        try {
            const batch = db.batch();
            const iId = currentInvoiceId;

            // Invoice
            const snap = await db.collection('invoices').where('invoice_id', '==', iId).limit(1).get();
            if (!snap.empty) batch.delete(snap.docs[0].ref);

            // Items
            const itemsSnap = await db.collection('invoice_items').where('invoice_id', '==', iId).get();
            itemsSnap.forEach(d => batch.delete(d.ref));

            // Payments
            const paySnap = await db.collection('payments').where('invoice_id', '==', iId).get();
            paySnap.forEach(d => batch.delete(d.ref));

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
    btnSave.addEventListener('click', saveInvoice);
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
