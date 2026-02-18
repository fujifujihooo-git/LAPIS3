document.addEventListener('DOMContentLoaded', async () => {
    function debugLog(msg) {
        const el = document.getElementById('debug-log');
        if (el) el.innerHTML += msg + '<br>';
        console.log(msg);
    }

    // Debug: Script start
    debugLog('office_detail.js loaded (debug3)');

    // --- Selectors ---
    const form = document.getElementById('office-form');
    if (!form) debugLog('<span style="color:red">Critical Error: form not found</span>');
    else debugLog('Form found');

    const officeIdDisplay = document.getElementById('office-id-display');
    const officeTitle = document.getElementById('page-title');
    const createdDateDisplay = document.getElementById('created-date-display');
    const lastUpdatedDisplay = document.getElementById('last-updated-display');
    const btnBack = document.getElementById('btn-back');
    const btnBackTop = document.getElementById('btn-back-top');
    const btnDelete = document.getElementById('btn-delete');
    const btnHeaderSave = document.querySelector('button[form="office-form"]');
    if (!btnHeaderSave) debugLog('<span style="color:orange">Warning: Header save button not found</span>');
    else debugLog('Header save button found');

    // --- State ---
    let currentOffice = null;
    let officeIdParam = null;
    let customerId = null;

    // --- Functions ---
    async function init() {
        const params = new URLSearchParams(window.location.search);
        officeIdParam = params.get('id');
        customerId = parseInt(params.get('customer_id'));

        if (!customerId) {
            debugLog('<span style="color:red">Error: customer_id is missing in URL</span>');
            return;
        }

        // Set back button links
        const backUrl = `customer_detail.html?id=${customerId}`;
        if (btnBack) btnBack.onclick = () => window.location.href = backUrl;
        if (btnBackTop) btnBackTop.onclick = () => window.location.href = backUrl;

        if (officeIdParam === 'new') {
            officeTitle.textContent = '新規拠点登録';
            officeIdDisplay.textContent = '新規登録';
            createdDateDisplay.textContent = '保存時に設定';
            lastUpdatedDisplay.textContent = '保存時に設定';
            if (btnDelete) btnDelete.style.display = 'none';

            // Generate next ID preview (optional, or do on save)
            try {
                const nextId = await getNextSequence('offices');
                officeIdDisplay.textContent = `New Office ID: ${nextId}`;
                document.getElementById('office-form').dataset.newId = nextId;
            } catch (e) {
                console.error(e);
            }
        } else {
            const oId = parseInt(officeIdParam);
            try {
                // Optimize: query directly by ID
                // const offices = await getAllFromFirestore('offices');
                // currentOffice = offices.find(o => Number(o.office_id) === oId);
                const docSnap = await db.collection('offices').doc(`office_${oId}`).get();
                if (docSnap.exists) {
                    currentOffice = docSnap.data();
                } else {
                    currentOffice = null;
                }

                if (!currentOffice) {
                    debugLog('拠点が見つかりません。');
                    return;
                }
                populateForm(currentOffice);
            } catch (err) {
                console.error(err);
                debugLog('データ読み込みエラー');
            }
        }
    }

    function populateForm(data) {
        officeIdDisplay.textContent = `Office ID: ${data.office_id}`;
        officeTitle.textContent = `拠点詳細：${data.office_name}`;
        createdDateDisplay.textContent = data.created_date || '-';
        lastUpdatedDisplay.textContent = data.last_updated || '-';

        const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };

        setVal('office_name', data.office_name || '');
        document.getElementById('is_main').checked = !!data.is_main;
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

        const isMain = document.getElementById('is_main').checked;
        const now = new Date().toISOString();

        // Prepare data
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
            // Debug: 保存直前のデータを表示
            debugLog(`Saving: OfficeID=${officeIdParam}, CustomerID=${customerId}, Name=${updatedData.office_name}`);

            // 排他制御: 本社(main)にする場合、この顧客の他の拠点のis_mainを下げる
            if (isMain) {
                // Optimize: query only relevant docs
                const snapshot = await db.collection('offices')
                    .where('customer_id', '==', customerId)
                    .where('is_main', '==', true)
                    .get();

                const batch = db.batch();
                let hasUpdates = false;
                snapshot.forEach(doc => {
                    // 自分自身以外を false に更新
                    // 新規作成時は自分自身はまだ存在しないので全ての既存mainをfalseへ
                    // 更新時は、自分自身のdocIdと比較
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
                // Use pre-fetched ID or fetch new one
                let newId = parseInt(document.getElementById('office-form').dataset.newId);
                if (!newId) newId = await getNextSequence('offices');

                updatedData.office_id = newId;
                updatedData.created_date = now;
                await saveToFirestore('offices', `office_${newId}`, updatedData);
            } else {
                const oId = parseInt(officeIdParam);
                updatedData.office_id = oId;
                await saveToFirestore('offices', `office_${oId}`, { ...currentOffice, ...updatedData });
            }

            showToast('保存しました', 'success');
            setTimeout(() => {
                window.location.href = `customer_detail.html?id=${customerId}`;
            }, 1000);
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

    // --- Event Listeners ---
    form.addEventListener('submit', handleSave);
    if (btnHeaderSave) btnHeaderSave.addEventListener('click', handleSave);
    if (btnDelete) btnDelete.addEventListener('click', handleDelete);

    const btnLookupZip = document.getElementById('btn-lookup-zip');
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

    init();
});
