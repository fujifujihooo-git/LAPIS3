document.addEventListener('DOMContentLoaded', () => {
    const tPageStart = performance.now();
    console.log('Government Office Detail: Phase 1 (Sync UI) starting...');

    const officeForm = document.getElementById('office-form');
    const pageTitle = document.getElementById('page-title');
    const officeIdDisplay = document.getElementById('office-id-display');
    const officeIdInput = document.getElementById('office_id_input');
    const btnBack = document.getElementById('btn-back');
    const btnDelete = document.getElementById('btn-delete');
    
    const btnSearchAddress = document.getElementById('btn-search-address');
    const postalCodeInput = document.getElementById('postal_code');
    const addressInput = document.getElementById('address');

    let officeId = null;
    let currentOffice = null;
    let currentDocId = null;

    // =========================================================
    //  Phase 1: 同期UI初期化 — ブロッキングなし、即時描画
    // =========================================================
    const urlParams = new URLSearchParams(window.location.search);
    const officeIdParam = urlParams.get('id');

    if (officeIdParam && officeIdParam !== 'new') {
        if (/^\d+$/.test(officeIdParam)) {
            officeId = parseInt(officeIdParam);
        } else {
            officeId = officeIdParam;
        }
        
        pageTitle.textContent = '官公庁詳細';
        if (btnDelete) {
            btnDelete.style.display = isUserAdmin() ? 'block' : 'none';
            btnDelete.addEventListener('click', handleDelete);
        }
    } else {
        pageTitle.textContent = '官公庁新規登録';
        if (btnDelete) btnDelete.style.display = 'none';
        if (officeIdDisplay) officeIdDisplay.textContent = '(採番中...)';
    }

    // --- Event Listeners ---
    if (btnBack) {
        btnBack.addEventListener('click', () => {
            window.location.href = 'government_office_list.html';
        });
    }

    if (officeForm) {
        officeForm.addEventListener('submit', handleSave);
    }

    if (btnSearchAddress && postalCodeInput && addressInput) {
        btnSearchAddress.addEventListener('click', async () => {
            const zip = postalCodeInput.value.trim().replace(/-/g, '');
            if (!/^\d{7}$/.test(zip)) {
                alert('7桁の郵便番号を入力してください（例：1000001）');
                return;
            }

            try {
                btnSearchAddress.disabled = true;
                btnSearchAddress.textContent = '検索中...';

                const response = await fetch(`https://zipcloud.ibsnet.co.jp/api/search?zipcode=${zip}`);
                if (!response.ok) throw new Error('Network response was not ok');

                const data = await response.json();

                if (data.status === 200 && data.results) {
                    const result = data.results[0];
                    const fullAddress = result.address1 + result.address2 + result.address3;
                    addressInput.value = fullAddress;
                } else {
                    alert('該当する住所が見つかりませんでした。');
                }
            } catch (error) {
                console.error('Address search error:', error);
                alert('住所の取得に失敗しました。');
            } finally {
                btnSearchAddress.disabled = false;
                btnSearchAddress.textContent = '検索';
            }
        });
    }

    console.log(`[Perf] Phase 1 (Sync UI) completed in ${(performance.now() - tPageStart).toFixed(1)}ms`);

    // =========================================================
    //  Phase 2: 非同期データ取得 — Fire & Forget
    // =========================================================
    loadAllData();

    async function loadAllData() {
        const t2Start = performance.now();

        if (officeIdParam && officeIdParam !== 'new') {
            try {
                let foundDoc = null;
                const fetchId = officeId;

                console.log(`[Detail] Strategy A: Querying office_id == ${Number(fetchId)} (Number)`);
                let snapshot = await db.collection('government_offices').where('office_id', '==', Number(fetchId)).get();

                if (snapshot.empty) {
                    console.log(`[Detail] Strategy A failed. Strategy B: Querying office_id == "${String(fetchId)}" (String)`);
                    snapshot = await db.collection('government_offices').where('office_id', '==', String(fetchId)).get();
                }

                if (!snapshot.empty) {
                    foundDoc = snapshot.docs[0];
                    currentOffice = foundDoc.data();
                    currentDocId = foundDoc.id;
                } else {
                    const docIdTry = String(fetchId).startsWith('off_') ? String(fetchId) : `off_${fetchId}`;
                    console.log(`[Detail] Strategy B failed. Strategy C: Fetching Doc ID "${docIdTry}"...`);
                    const docRef = await db.collection('government_offices').doc(docIdTry).get();
                    if (docRef.exists) {
                        foundDoc = docRef;
                        currentOffice = docRef.data();
                        currentDocId = docRef.id;
                    } else {
                        console.log(`[Detail] Strategy C failed. Strategy D: Fetching Doc ID "${fetchId}"...`);
                        const rawDocRef = await db.collection('government_offices').doc(String(fetchId)).get();
                        if (rawDocRef.exists) {
                            foundDoc = rawDocRef;
                            currentOffice = rawDocRef.data();
                            currentDocId = rawDocRef.id;
                        }
                    }
                }

                if (currentOffice) {
                    officeId = currentOffice.office_id;
                    populateForm(currentOffice);
                } else {
                    alert('官公庁が見つかりません。');
                    window.location.href = 'government_office_list.html';
                }
            } catch (error) {
                console.error("Error loading office:", error);
                alert('データの読み込みに失敗しました。');
                window.location.href = 'government_office_list.html';
            }
        } else {
            try {
                const nextId = await getNextSequence('government_offices');
                if (officeIdInput) officeIdInput.value = nextId;
                if (officeIdDisplay) officeIdDisplay.textContent = `New ID: ${nextId}`;
            } catch (e) {
                console.error("Failed to get next ID", e);
                if (officeIdInput) officeIdInput.value = "";
                if (officeIdDisplay) officeIdDisplay.textContent = "";
            }
        }
        console.log(`[Perf] Phase 2 data loaded in ${(performance.now() - t2Start).toFixed(1)}ms`);
    }

    // --- Helpers ---
    function populateForm(data) {
        if (officeIdInput) officeIdInput.value = data.office_id;
        if (officeIdDisplay) officeIdDisplay.textContent = `Office ID: ${data.office_id}`;

        const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };

        setVal('office_name', data.office_name || '');
        setVal('office_prefecture', data.office_prefecture || '');
        setVal('office_type', data.office_type || '');
        setVal('status', data.status || '有効');
        setVal('postal_code', data.postal_code || '');
        setVal('address', data.address || '');

        const createdDateDisplay = document.getElementById('created-date-display');
        const lastUpdatedDisplay = document.getElementById('last-updated-display');
        if (createdDateDisplay) createdDateDisplay.innerHTML = formatToJST(data.created_date);
        if (lastUpdatedDisplay) lastUpdatedDisplay.innerHTML = formatToJST(data.last_updated);
    }

    async function handleSave(e) {
        e.preventDefault();

        const newId = parseInt(officeIdInput.value);
        const name = document.getElementById('office_name').value.trim();

        if (isNaN(newId)) {
            alert('有効なIDを入力してください。');
            return;
        }

        if (!name) {
            alert('官公庁名を入力してください。');
            return;
        }

        const now = new Date().toISOString();
        const officeData = {
            office_id: newId,
            office_name: name,
            office_prefecture: document.getElementById('office_prefecture').value,
            office_type: document.getElementById('office_type').value,
            status: document.getElementById('status').value,
            postal_code: document.getElementById('postal_code') ? document.getElementById('postal_code').value.trim() : '',
            address: document.getElementById('address') ? document.getElementById('address').value.trim() : '',
            last_updated: now
        };

        try {
            const docId = currentDocId || `off_${newId}`;

            if (currentOffice) {
                await saveToFirestore('government_offices', docId, { ...currentOffice, ...officeData });
                showToast('保存しました', 'success');
            } else {
                officeData.created_date = now;
                await saveToFirestore('government_offices', docId, officeData);
                showToast('新規登録しました', 'success');

                currentOffice = officeData;
                currentDocId = docId;
                officeId = newId;
                pageTitle.textContent = '官公庁詳細';
                if (btnDelete) btnDelete.style.display = isUserAdmin() ? 'block' : 'none';
                history.replaceState(null, '', `?id=${newId}`);
            }
        } catch (error) {
            console.error("Save failed:", error);
            showToast('保存に失敗しました', 'error');
        }
    }

    async function handleDelete() {
        if (!isUserAdmin()) {
            alert('削除権限がありません。');
            return;
        }
        if (!officeId) return;

        try {
            const casesRef = db.collection('cases');
            const licensesRef = db.collection('customer_licenses');

            const snapCases = await casesRef.where('government_office_id', '==', officeId).get();
            const snapLicenses = await licensesRef.where('government_office_id', '==', officeId).get();

            if (snapCases.size > 0 || snapLicenses.size > 0) {
                alert('この官公庁は既に案件または許認可データで使用されているため削除できません。\n状態を「無効」に変更することを検討してください。');
                return;
            }

            if (confirm('本当に削除しますか？\nこの操作は取り消せません。')) {
                const targetDocId = currentDocId || `off_${officeId}`;
                await deleteFromFirestore('government_offices', targetDocId);
                showToast('削除しました', 'success');
                setTimeout(() => {
                    window.location.href = 'government_office_list.html';
                }, 1000);
            }

        } catch (error) {
            console.error("Delete check failed:", error);
            alert('削除前チェックに失敗しました');
        }
    }
});
