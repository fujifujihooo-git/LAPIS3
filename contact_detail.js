document.addEventListener('DOMContentLoaded', async () => {
    // --- Selectors ---
    const form = document.getElementById('contact-form');
    const contactTitle = document.getElementById('page-title');
    const btnBack = document.getElementById('btn-back');
    const btnBackTop = document.getElementById('btn-back-top');
    const btnDelete = document.getElementById('btn-delete');
    const btnSave = document.getElementById('btn-save');
    const officeSelect = document.getElementById('office_id');
    const customerLink = document.getElementById('customer-link');

    // --- State ---
    let currentContact = null;
    let currentDocId = null; // Firestoreドキュメントのactual ID
    let contactIdParam = null;
    let customerId = null;

    // --- Functions ---
    function getParamsFromUrl() {
        const params = new URLSearchParams(window.location.search);
        return {
            id: params.get('id'),
            customer_id: params.get('customer_id')
        };
    }

    async function init() {
        const params = getParamsFromUrl();
        contactIdParam = params.id;
        customerId = parseInt(params.customer_id);

        if (!customerId) {
            alert('顧客IDが指定されていません。');
            window.location.href = 'customer_list.html';
            return;
        }

        // パンくずの顧客詳細リンクを設定
        const backUrl = `customer_detail.html?id=${customerId}`;
        if (customerLink) customerLink.href = backUrl;

        try {
            // 1. 拠点の取得（この顧客に紐づく拠点のみ）
            if (officeSelect) {
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
            }

            // 2. 担当者データの取得
            if (contactIdParam === 'new') {
                // 新規登録
                if (contactTitle) contactTitle.textContent = '新規担当者登録';
                if (btnDelete) btnDelete.style.display = 'none';
            } else {
                // 既存データの編集
                const cId = parseInt(contactIdParam);
                const snap = await db.collection('contacts')
                    .where('contact_id', '==', cId)
                    .limit(1)
                    .get();

                if (snap.empty) {
                    alert('担当者が見つかりません。');
                    window.location.href = backUrl;
                    return;
                }

                currentDocId = snap.docs[0].id; // ドキュメントIDを保持
                currentContact = snap.docs[0].data();
                populateForm(currentContact);
                if (btnDelete) btnDelete.style.display = '';
            }

        } catch (error) {
            console.error('Init failed:', error);
            alert('データの読み込みに失敗しました。');
        }
    }

    function populateForm(data) {
        if (contactTitle) contactTitle.textContent = `担当者詳細：${data.contact_name || ''}`;

        const setVal = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.value = val;
        };

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

        // ヘッダーの担当者名表示
        const headerName = document.getElementById('header-contact-name');
        if (headerName) headerName.textContent = data.contact_name || '';

        // Assuming these elements exist in the HTML to display dates
        const createdDateDisplay = document.getElementById('created-date-display');
        const lastUpdatedDisplay = document.getElementById('last-updated-display');
        if (createdDateDisplay) createdDateDisplay.textContent = data.created_date ? new Date(data.created_date).toLocaleString() : '-';
        if (lastUpdatedDisplay) lastUpdatedDisplay.textContent = formatToJST(data.last_updated);
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
            // 二重送信防止
            if (btnSave) btnSave.disabled = true;

            const batch = db.batch();

            // 主担当フラグの排他制御
            if (isPrimary) {
                const otherPrimarySnap = await db.collection('contacts')
                    .where('customer_id', '==', customerId)
                    .where('is_primary', '==', true)
                    .get();

                otherPrimarySnap.forEach(doc => {
                    const d = doc.data();
                    if (contactIdParam === 'new' || d.contact_id !== parseInt(contactIdParam)) {
                        batch.update(doc.ref, { is_primary: false });
                    }
                });
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
                const nextId = await getNextSequence('contacts');
                updatedData.contact_id = nextId;
                updatedData.created_date = now;
                const docRef = db.collection('contacts').doc(`cnt_${nextId}`);
                batch.set(docRef, updatedData);

                // Update local state for new creation
                currentDocId = `cnt_${nextId}`;
                contactIdParam = nextId.toString();
                history.replaceState(null, '', `?customer_id=${customerId}&id=${nextId}`);
            } else {
                // 保持済みのドキュメントIDを使用（再クエリ不要）
                if (currentDocId) {
                    const docRef = db.collection('contacts').doc(currentDocId);
                    batch.update(docRef, updatedData);
                } else {
                    throw new Error('保存対象のデータが見つかりません');
                }
            }

            await batch.commit();
            showToast('保存しました', 'success');
            // setTimeout(() => {
            //     window.location.href = `customer_detail.html?id=${customerId}`;
            // }, 1000);

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
                // フォールバック: クエリで検索
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

    // --- Event Listeners ---
    // フォームsubmit
    if (form) {
        form.addEventListener('submit', handleSave);
    }

    // 保存ボタン直接クリック（form外からでも動作）
    if (btnSave) {
        btnSave.addEventListener('click', handleSave);
    }

    // 戻るボタン
    [btnBack, btnBackTop].forEach(btn => {
        btn?.addEventListener('click', () => {
            window.location.href = `customer_detail.html?id=${customerId}`;
        });
    });

    // 削除ボタン
    if (btnDelete) btnDelete.addEventListener('click', handleDelete);

    // 初期化
    init();
});
