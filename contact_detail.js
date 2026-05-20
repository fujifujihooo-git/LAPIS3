document.addEventListener('DOMContentLoaded', () => {
    const tPageStart = performance.now();
    console.log('Contact Detail: Phase 1 (Sync UI) starting...');

    // --- Selectors ---
    const form = document.getElementById('contact-form');
    const contactTitle = document.getElementById('page-title');
    const btnBack = document.getElementById('btn-back');
    const btnBackTop = document.getElementById('btn-back-top');
    const btnDelete = document.getElementById('btn-delete');
    const btnSave = document.getElementById('btn-save');
    const officeSelect = document.getElementById('office_id');
    const customerLink = document.getElementById('customer-link');
    const headerName = document.getElementById('header-contact-name');
    const createdDateDisplay = document.getElementById('created-date-display');
    const lastUpdatedDisplay = document.getElementById('last-updated-display');

    // --- State ---
    let currentContact = null;
    let currentDocId = null; 
    let contactIdParam = null;
    let customerId = null;

    // =========================================================
    //  Phase 1: 同期UI初期化 — ブロッキングなし、即時描画
    // =========================================================
    const params = new URLSearchParams(window.location.search);
    contactIdParam = params.get('id');
    customerId = parseInt(params.get('customer_id'));

    if (!customerId) {
        alert('顧客IDが指定されていません。');
        window.location.href = 'customer_list.html';
        return;
    }

    const backUrl = `customer_detail.html?id=${customerId}`;
    if (customerLink) customerLink.href = backUrl;

    [btnBack, btnBackTop].forEach(btn => {
        if (btn) btn.addEventListener('click', () => window.location.href = backUrl);
    });

    if (contactIdParam === 'new') {
        if (contactTitle) contactTitle.textContent = '新規担当者登録';
        if (headerName) headerName.textContent = '新規登録';
        if (createdDateDisplay) createdDateDisplay.textContent = '保存時に設定';
        if (lastUpdatedDisplay) lastUpdatedDisplay.textContent = '保存時に設定';
        if (btnDelete) btnDelete.style.display = 'none';
    } else {
        if (btnDelete) btnDelete.addEventListener('click', handleDelete);
    }

    // --- Event Listeners ---
    if (form) form.addEventListener('submit', handleSave);
    if (btnSave) btnSave.addEventListener('click', handleSave);

    console.log(`[Perf] Phase 1 (Sync UI) completed in ${(performance.now() - tPageStart).toFixed(1)}ms`);

    // =========================================================
    //  Phase 2: 非同期データ取得 — Fire & Forget
    // =========================================================
    loadAllData();

    async function loadAllData() {
        const t2Start = performance.now();

        try {
            // 並列で拠点リストと担当者データを取得
            const promises = [fetchOffices()];

            if (contactIdParam === 'new') {
                promises.push(getNextSequence('contacts').catch(e => {
                    console.error('Failed to get next contact ID', e);
                    return null;
                }));
            } else {
                promises.push(fetchContactData());
            }

            const [officesLoaded, contactResult] = await Promise.all(promises);

            if (contactIdParam === 'new') {
                // contactResult is nextId
                if (contactResult) {
                    // We don't have a visible ID field for contact usually, but we could set it
                    form.dataset.newId = contactResult;
                }
            } else {
                // contactResult is the contact document data
                if (contactResult) {
                    populateForm(contactResult);
                }
            }

        } catch (error) {
            console.error('Data load failed:', error);
            alert('データの読み込みに失敗しました。');
        }

        console.log(`[Perf] Phase 2 data loaded in ${(performance.now() - t2Start).toFixed(1)}ms`);
    }

    async function fetchOffices() {
        if (!officeSelect) return true;
        const officesSnap = await db.collection('offices')
            .where('customer_id', '==', customerId)
            .get();

        officesSnap.docs.forEach(doc => {
            const o = doc.data();
            const opt = document.createElement('option');
            opt.value = o.office_id;
            opt.textContent = o.office_name + (o.status !== 'active' ? ' (無効)' : '');
            officeSelect.appendChild(opt);
        });
        return true;
    }

    async function fetchContactData() {
        const cId = parseInt(contactIdParam);
        const snap = await db.collection('contacts')
            .where('contact_id', '==', cId)
            .limit(1)
            .get();

        if (snap.empty) {
            alert('担当者が見つかりません。');
            window.location.href = `customer_detail.html?id=${customerId}`;
            return null;
        }

        currentDocId = snap.docs[0].id;
        currentContact = snap.docs[0].data();
        return currentContact;
    }

    // --- Helpers ---
    function populateForm(data) {
        if (contactTitle) contactTitle.textContent = `担当者詳細：${data.contact_name || ''}`;
        if (headerName) headerName.textContent = data.contact_name || '';

        if (createdDateDisplay) createdDateDisplay.textContent = data.created_date ? new Date(data.created_date).toLocaleString() : '-';
        if (lastUpdatedDisplay) lastUpdatedDisplay.textContent = formatToJST(data.last_updated);

        const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };

        setVal('contact_name', data.contact_name || '');
        setVal('contact_kana', data.contact_kana || '');
        setVal('department', data.department || '');
        setVal('title', data.title || '');
        setVal('office_id', data.office_id || '');
        setVal('phone', data.phone || '');
        setVal('mobile', data.mobile || '');
        setVal('fax', data.fax || '');
        setVal('email', data.email || '');
        setVal('status', data.status || '在籍');
        setVal('remarks', data.remarks || '');

        const isPrimaryEl = document.getElementById('is_primary');
        if (isPrimaryEl) isPrimaryEl.checked = !!data.is_primary;
    }

    async function handleSave(e) {
        if (e) e.preventDefault();

        // --- バリデーション ---
        const contactName = (document.getElementById('contact_name')?.value || '').trim();
        if (!contactName) {
            showToast('氏名は必須です。', 'error');
            document.getElementById('contact_name')?.focus();
            return;
        }

        const isPrimaryEl = document.getElementById('is_primary');
        const isPrimary = isPrimaryEl ? isPrimaryEl.checked : false;
        const now = new Date().toISOString();

        try {
            if (btnSave) btnSave.disabled = true;
            const batch = db.batch();

            // 主担当フラグの排他制御
            if (isPrimary) {
                const otherPrimarySnap = await db.collection('contacts')
                    .where('customer_id', '==', customerId)
                    .where('is_primary', '==', true)
                    .get();

                let existingPrimaryNames = [];
                let existingPrimaryDocs = [];

                otherPrimarySnap.forEach(doc => {
                    const d = doc.data();
                    if (contactIdParam === 'new' || d.contact_id !== parseInt(contactIdParam)) {
                        existingPrimaryNames.push(d.contact_name || '名称未設定');
                        existingPrimaryDocs.push(doc);
                    }
                });

                if (existingPrimaryNames.length > 0) {
                    const confirmMsg = `現在の主担当：\n${existingPrimaryNames.join(', ')}\n\n${contactName}へ変更しますか？`;
                    if (!confirm(confirmMsg)) {
                        if (btnSave) btnSave.disabled = false;
                        return; // キャンセル時は保存処理を中断
                    }
                    // 承認されたら一括解除
                    existingPrimaryDocs.forEach(doc => {
                        batch.update(doc.ref, { is_primary: false });
                    });
                }
            }

            const updatedData = {
                customer_id: customerId,
                contact_name: contactName,
                contact_kana: (document.getElementById('contact_kana')?.value || '').trim(),
                department: (document.getElementById('department')?.value || '').trim(),
                title: (document.getElementById('title')?.value || '').trim(),
                office_id: parseInt(document.getElementById('office_id')?.value) || null,
                is_primary: isPrimary,
                phone: (document.getElementById('phone')?.value || '').trim(),
                mobile: (document.getElementById('mobile')?.value || '').trim(),
                fax: (document.getElementById('fax')?.value || '').trim(),
                email: (document.getElementById('email')?.value || '').trim(),
                status: document.getElementById('status')?.value || '在籍',
                remarks: (document.getElementById('remarks')?.value || '').trim(),
                last_updated: now
            };

            if (contactIdParam === 'new') {
                let nextId = parseInt(form ? form.dataset.newId : 0);
                if (!nextId) nextId = await getNextSequence('contacts');

                updatedData.contact_id = nextId;
                updatedData.created_date = now;
                const docRef = db.collection('contacts').doc(`cnt_${nextId}`);
                batch.set(docRef, updatedData);

                currentDocId = `cnt_${nextId}`;
                contactIdParam = nextId.toString();
                history.replaceState(null, '', `?customer_id=${customerId}&id=${nextId}`);
            } else {
                if (currentDocId) {
                    const docRef = db.collection('contacts').doc(currentDocId);
                    batch.update(docRef, updatedData);
                } else {
                    throw new Error('保存対象のデータが見つかりません');
                }
            }

            await batch.commit();
            showToast('保存しました', 'success');
        } catch (error) {
            console.error('Save failed:', error);
            showToast('保存に失敗しました: ' + error.message, 'error');
        } finally {
            if (btnSave) btnSave.disabled = false;
        }
    }

    async function handleDelete() {
        if (contactIdParam === 'new') return;
        if (!confirm('この担当者を削除してもよろしいですか？')) return;

        try {
            if (currentDocId) {
                await db.collection('contacts').doc(currentDocId).delete();
            } else {
                const cId = parseInt(contactIdParam);
                const snap = await db.collection('contacts').where('contact_id', '==', cId).limit(1).get();
                if (!snap.empty) {
                    await snap.docs[0].ref.delete();
                } else {
                    alert('削除対象が見つかりません。');
                    return;
                }
            }
            showToast('削除しました', 'success');
            setTimeout(() => {
                window.location.href = `customer_detail.html?id=${customerId}`;
            }, 1000);
        } catch (error) {
            console.error('Delete failed:', error);
            showToast('削除に失敗しました: ' + error.message, 'error');
        }
    }
});
