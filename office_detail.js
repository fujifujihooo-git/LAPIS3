document.addEventListener('DOMContentLoaded', () => {
    const tPageStart = performance.now();
    console.log('Office Detail: Phase 1 (Sync UI) starting...');

    function debugLog(msg) {
        const el = document.getElementById('debug-log');
        if (el) el.innerHTML += msg + '<br>';
        console.log(msg);
    }

    // --- Selectors ---
    const form = document.getElementById('office-form');
    if (!form) debugLog('<span style="color:red">Critical Error: form not found</span>');

    const officeIdDisplay = document.getElementById('office-id-display');
    const officeTitle = document.getElementById('page-title');
    const createdDateDisplay = document.getElementById('created-date-display');
    const lastUpdatedDisplay = document.getElementById('last-updated-display');
    const btnBack = document.getElementById('btn-back');
    const btnBackTop = document.getElementById('btn-back-top');
    const btnDelete = document.getElementById('btn-delete');
    const btnHeaderSave = document.querySelector('button[form="office-form"]');
    const btnSave = document.getElementById('btn-save');
    const btnLookupZip = document.getElementById('btn-lookup-zip');

    // --- State ---
    let currentOffice = null;
    let officeIdParam = null;
    let customerId = null;

    // =========================================================
    //  Phase 1: 同期UI初期化 — ブロッキングなし、即時描画
    // =========================================================

    const params = new URLSearchParams(window.location.search);
    officeIdParam = params.get('id');
    customerId = parseInt(params.get('customer_id'));

    if (!customerId) {
        debugLog('<span style="color:red">Error: customer_id is missing in URL</span>');
        alert('顧客IDが指定されていません。');
    } else {
        const backUrl = `customer_detail.html?id=${customerId}`;
        if (btnBack) btnBack.onclick = () => window.location.href = backUrl;
        if (btnBackTop) btnBackTop.onclick = () => window.location.href = backUrl;
    }

    if (officeIdParam === 'new') {
        if (officeTitle) officeTitle.textContent = '新規拠点登録';
        if (officeIdDisplay) officeIdDisplay.textContent = '(採番中...)';
        if (createdDateDisplay) createdDateDisplay.textContent = '保存時に設定';
        if (lastUpdatedDisplay) lastUpdatedDisplay.textContent = '保存時に設定';
        if (btnDelete) btnDelete.style.display = 'none';
    } else {
        if (btnDelete) btnDelete.addEventListener('click', handleDelete);
    }

    // --- Event Listeners ---
    if (form) form.addEventListener('submit', handleSave);
    if (btnSave) btnSave.addEventListener('click', handleSave);
    if (btnHeaderSave) btnHeaderSave.addEventListener('click', handleSave);

    if (btnLookupZip) {
        btnLookupZip.addEventListener('click', async () => {
            const zip = document.getElementById('postal_code').value.replace(/[^0-9]/g, '');
            if (!/^\d{7}$/.test(zip)) {
                alert('郵便番号は7桁で入力してください。');
                return;
            }
            try {
                const response = await fetch(`https://zipcloud.ibsnet.co.jp/api/search?zipcode=${zip}`);
                const data = await response.json();
                if (data.status === 200 && data.results) {
                    const result = data.results[0];
                    const address = result.address1 + result.address2 + result.address3;
                    document.getElementById('address').value = address;
                } else {
                    alert('該当する住所が見つかりませんでした。');
                }
            } catch (error) {
                console.error('ZipCloud API Error:', error);
                alert('住所の取得に失敗しました。');
            }
        });
    }

    console.log(`[Perf] Phase 1 (Sync UI) completed in ${(performance.now() - tPageStart).toFixed(1)}ms`);

    // =========================================================
    //  Phase 2: 非同期データ取得 — Fire & Forget
    // =========================================================
    if (customerId) {
        loadAllData();
    }

    async function loadAllData() {
        const t2Start = performance.now();

        if (officeIdParam === 'new') {
            try {
                const nextId = await getNextSequence('offices');
                if (officeIdDisplay) officeIdDisplay.textContent = `Office ID: ${nextId}`;
                if (form) form.dataset.newId = nextId;
            } catch (e) {
                console.error('Failed to fetch next sequence', e);
            }
        } else {
            const oId = parseInt(officeIdParam);
            try {
                const docSnap = await db.collection('offices').doc(`office_${oId}`).get();
                if (docSnap.exists) {
                    currentOffice = docSnap.data();
                    populateForm(currentOffice);
                } else {
                    debugLog('拠点が見つかりません。');
                    alert('拠点情報が見つかりませんでした。');
                }
            } catch (err) {
                console.error(err);
                debugLog('データ読み込みエラー');
            }
        }
        console.log(`[Perf] Phase 2 data loaded in ${(performance.now() - t2Start).toFixed(1)}ms`);
    }

    // --- Helpers ---
    function populateForm(data) {
        if (officeIdDisplay) officeIdDisplay.textContent = `Office ID: ${data.office_id}`;
        if (officeTitle) officeTitle.textContent = `拠点詳細：${data.office_name}`;
        if (createdDateDisplay) createdDateDisplay.textContent = data.created_date ? new Date(data.created_date).toLocaleString() : '-';
        if (lastUpdatedDisplay) lastUpdatedDisplay.textContent = formatToJST(data.last_updated);

        const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };

        setVal('office_name', data.office_name || '');
        const isMainEl = document.getElementById('is_main');
        if (isMainEl) isMainEl.checked = !!data.is_main;
        setVal('postal_code', data.postal_code || '');
        setVal('address', data.address || '');
        setVal('building_name', data.building_name || '');
        setVal('phone', data.phone || '');
        setVal('fax', data.fax || '');
        setVal('status', data.status || '有効');
        setVal('remarks', data.remarks || '');
    }

    async function handleSave(e) {
        if (e) e.preventDefault();

        const isMainEl = document.getElementById('is_main');
        const isMain = isMainEl ? isMainEl.checked : false;
        const now = new Date().toISOString();

        const updatedData = {
            customer_id: customerId,
            office_name: document.getElementById('office_name').value.trim(),
            is_main: isMain,
            postal_code: document.getElementById('postal_code').value.trim(),
            address: document.getElementById('address').value.trim(),
            building_name: document.getElementById('building_name').value.trim(),
            phone: document.getElementById('phone').value.trim(),
            fax: document.getElementById('fax').value.trim(),
            status: document.getElementById('status').value,
            remarks: document.getElementById('remarks').value.trim(),
            last_updated: now
        };

        try {
            debugLog(`Saving: OfficeID=${officeIdParam}, CustomerID=${customerId}, Name=${updatedData.office_name}`);

            if (isMain) {
                const snapshot = await db.collection('offices')
                    .where('customer_id', '==', customerId)
                    .where('is_main', '==', true)
                    .get();

                const batch = db.batch();
                let hasUpdates = false;
                snapshot.forEach(doc => {
                    const isSelf = officeIdParam !== 'new' && doc.id === `office_${officeIdParam}`;
                    if (!isSelf) {
                        batch.update(doc.ref, { is_main: false });
                        hasUpdates = true;
                    }
                });
                if (hasUpdates) {
                    await batch.commit();
                }
            }

            if (officeIdParam === 'new') {
                let newId = parseInt(form ? form.dataset.newId : 0);
                if (!newId) newId = await getNextSequence('offices');

                updatedData.office_id = newId;
                updatedData.created_date = now;
                await saveToFirestore('offices', `office_${newId}`, updatedData);

                officeIdParam = newId.toString();
                currentOffice = updatedData;
                history.replaceState(null, '', `?customer_id=${customerId}&id=${newId}`);
            } else {
                const oId = parseInt(officeIdParam);
                updatedData.office_id = oId;
                await saveToFirestore('offices', `office_${oId}`, { ...currentOffice, ...updatedData });
            }

            showToast('保存しました', 'success');
        } catch (err) {
            console.error(err);
            debugLog('<span style="color:red">保存失敗: ' + err.message + '</span>');
        }
    }

    async function handleDelete() {
        if (officeIdParam === 'new') return;
        if (!confirm('この拠点を削除してもよろしいですか？')) return;

        try {
            const oId = parseInt(officeIdParam);
            await db.collection('offices').doc(`office_${oId}`).delete();
            alert('削除しました。');
            window.location.href = `customer_detail.html?id=${customerId}`;
        } catch (err) {
            console.error(err);
            alert('削除失敗: ' + err.message);
        }
    }
});
