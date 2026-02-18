document.addEventListener('DOMContentLoaded', () => {
    const officeForm = document.getElementById('office-form');
    const pageTitle = document.getElementById('page-title');
    const officeIdDisplay = document.getElementById('office-id-display');
    const officeIdInput = document.getElementById('office_id_input');
    const btnBack = document.getElementById('btn-back');
    const btnDelete = document.getElementById('btn-delete');

    const urlParams = new URLSearchParams(window.location.search);
    const officeIdParam = urlParams.get('id');
    let officeId = null;
    let currentOffice = null;

    async function init() {
        let fetchId = null;

        // 1. Determine ID to search for
        if (officeIdParam) {
            // Check if param is purely numeric
            if (/^\d+$/.test(officeIdParam)) {
                fetchId = parseInt(officeIdParam); // Use number for query
                officeId = fetchId;
            } else {
                fetchId = officeIdParam; // Use string (rare case but possible)
                officeId = fetchId; // Temporary handling
            }
            console.log(`[Detail] Init with ID: ${fetchId} (Type: ${typeof fetchId})`);
        }

        if (officeId) {
            try {
                let foundDoc = null;

                // Strategy A: Query by Number 'office_id'
                let snapshot = await db.collection('government_offices').where('office_id', '==', Number(officeId)).get();

                if (snapshot.empty) {
                    // Strategy B: Query by String 'office_id'
                    console.log('[Detail] Strategy A failed. Trying Strategy B (String ID)...');
                    snapshot = await db.collection('government_offices').where('office_id', '==', String(officeId)).get();
                }

                if (!snapshot.empty) {
                    foundDoc = snapshot.docs[0];
                    currentOffice = foundDoc.data();
                    currentOffice._docId = foundDoc.id;
                    console.log('[Detail] Document found:', foundDoc.id);
                } else {
                    // Strategy C: Try fetching by Document ID direct (fallback for legacy links)
                    // e.g. param 'off_123' or '123' treated as doc ID
                    const docIdTry = String(officeId).startsWith('off_') ? String(officeId) : `off_${officeId}`;
                    console.log(`[Detail] Strategy B failed. Trying Strategy C (Doc ID: ${docIdTry})...`);
                    const docRef = await db.collection('government_offices').doc(docIdTry).get();
                    if (docRef.exists) {
                        foundDoc = docRef;
                        currentOffice = docRef.data();
                        currentOffice._docId = docRef.id;
                        console.log('[Detail] Document found by Doc ID:', docRef.id);
                    }
                }

                if (currentOffice) {
                    // Ensure officeId is correctly set from the found document's office_id
                    officeId = currentOffice.office_id;
                    pageTitle.textContent = '官公庁編集';
                    officeIdDisplay.textContent = `Office ID: ${currentOffice.office_id}`;
                    populateForm(currentOffice);
                    btnDelete.style.display = 'block';
                    btnDelete.addEventListener('click', handleDelete);
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
            pageTitle.textContent = '官公庁新規登録';
            // 新規登録時は次のIDをデフォルトでセット
            try {
                const nextId = await getNextSequence('government_offices');
                officeIdInput.value = nextId;
            } catch (e) {
                console.error("Failed to get next ID", e);
                officeIdInput.value = "";
            }
        }
    }

    function populateForm(data) {
        officeIdInput.value = data.office_id;
        document.getElementById('office_name').value = data.office_name;
        document.getElementById('office_prefecture').value = data.office_prefecture || '';
        document.getElementById('office_type').value = data.office_type;
        document.getElementById('status').value = data.status;
        document.getElementById('created-date-display').innerHTML = formatDate(data.created_date);
        document.getElementById('last-updated-display').innerHTML = formatDate(data.last_updated);
    }

    officeForm.addEventListener('submit', async (e) => {
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

        // Duplicate check if strictly needed, but Firestore write will overwrite or we can check existence first.
        // Skipping strict client-side unique ID check as it's complex without reading all. 
        // Reliance on auto-increment reduces collision risk for new items.

        const now = new Date().toISOString();
        const officeData = {
            office_id: newId,
            office_name: name,
            office_prefecture: document.getElementById('office_prefecture').value,
            office_type: document.getElementById('office_type').value,
            status: document.getElementById('status').value,
            last_updated: now
        };

        try {
            const docId = `off_${newId}`;

            if (currentOffice) {
                const oldId = currentOffice.office_id;
                // If ID changed (which shouldn't happen often in this UI), we need to handle it.
                // For now, assume ID doesn't change or if it does, it's treated as new doc if we used docId logic purely.
                // We keep it simple: update existing doc.
                await saveToFirestore('government_offices', docId, { ...currentOffice, ...officeData });
                showToast('保存しました', 'success');
            } else {
                // Create
                officeData.created_date = now;
                await saveToFirestore('government_offices', docId, officeData);
                showToast('新規登録しました', 'success');
            }

            setTimeout(() => {
                window.location.href = 'government_office_list.html';
            }, 1000);

        } catch (error) {
            console.error("Save failed:", error);
            showToast('保存に失敗しました', 'error');
        }
    });

    /**
     * ID変更時に案件および許認可データの官公庁IDを一括更新する
     * Note: This is difficult to implement purely client-side with Firestore efficiently.
     * Skipped for now as ID changing is rare.
     */
    // function updateRelatedData(oldId, newId) { ... }

    async function handleDelete() {
        if (!officeId) return;

        // F1. Deletion Restrictions - Query Firestore
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
                await deleteFromFirestore('government_offices', `off_${officeId}`);
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

    btnBack.addEventListener('click', () => {
        window.location.href = 'government_office_list.html';
    });

    init();
});
