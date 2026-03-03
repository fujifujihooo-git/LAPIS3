document.addEventListener('DOMContentLoaded', () => {
    console.log('License Type Detail Initialized');

    // --- Selectors ---
    const pageTitle = document.getElementById('page-title');
    const licenseTypeIdInput = document.getElementById('license-type-id');
    const licenseTypeName = document.getElementById('license-type-name');
    const hasExpiry = document.getElementById('has-expiry');
    const noticeDaysGroup = document.getElementById('notice-days-group');
    const defaultNoticeDays = document.getElementById('default-notice-days');
    const category = document.getElementById('category');
    const status = document.getElementById('status');
    const sortOrder = document.getElementById('sort-order');
    const remarks = document.getElementById('remarks');
    const createdDate = document.getElementById('created-date');
    const lastUpdated = document.getElementById('last-updated');
    const btnBack = document.getElementById('btn-back');
    const btnSave = document.getElementById('btn-save');
    const btnDelete = document.getElementById('btn-delete');

    // --- State ---
    let currentIdParam = null;
    let currentData = null;

    // --- Functions ---

    // Get URL Parameter
    function getUrlParameter(name) {
        const urlParams = new URLSearchParams(window.location.search);
        return urlParams.get(name);
    }

    // Initialize
    // Initialize
    let currentDocId = null;

    async function init() {
        currentIdParam = getUrlParameter('id');

        if (currentIdParam === 'new') {
            pageTitle.textContent = '新規許認可種別登録';
            hasExpiry.checked = true;
            try {
                const nextId = await getNextSequence('license_types');
                licenseTypeIdInput.value = nextId;
            } catch (e) {
                console.error('Failed to get next ID', e);
                licenseTypeIdInput.value = '';
            }
            toggleNoticeDaysGroup();
        } else {
            const id = parseInt(currentIdParam);
            try {
                // Find document by numeric license_type_id
                const snapshot = await db.collection('license_types')
                    .where('license_type_id', '==', id)
                    .limit(1)
                    .get();

                if (!snapshot.empty) {
                    const doc = snapshot.docs[0];
                    currentDocId = doc.id; // Store real Firestore Doc ID
                    const data = doc.data();
                    currentData = data;
                    loadData(data);
                    btnDelete.style.display = 'inline-block';
                } else {
                    alert('許認可種別が見つかりません。');
                    window.location.href = 'license_types_list.html';
                }
            } catch (error) {
                console.error('Error loading license type:', error);
                alert('データの読み込みに失敗しました。');
                window.location.href = 'license_types_list.html';
            }
        }
    }

    // Load Data
    function loadData(licenseType) {
        licenseTypeIdInput.value = licenseType.license_type_id;
        licenseTypeName.value = licenseType.license_type_name;
        hasExpiry.checked = licenseType.has_expiry;
        defaultNoticeDays.value = licenseType.default_notice_days || '';
        hasExpiry.checked = licenseType.has_expiry;
        defaultNoticeDays.value = licenseType.default_notice_days || '';
        if (category) category.value = licenseType.category || '';
        status.value = licenseType.status;
        sortOrder.value = (licenseType.sort_order !== undefined && licenseType.sort_order !== null) ? licenseType.sort_order : '';
        remarks.value = licenseType.remarks || '';
        createdDate.textContent = licenseType.created_date || '-';
        lastUpdated.textContent = licenseType.last_updated || '-';
        toggleNoticeDaysGroup();
    }

    // Toggle Notice Days Group
    function toggleNoticeDaysGroup() {
        if (hasExpiry.checked) {
            noticeDaysGroup.style.display = 'block';
        } else {
            noticeDaysGroup.style.display = 'none';
            defaultNoticeDays.value = '';
        }
    }

    // Save Data
    async function saveData() {
        const newId = parseInt(licenseTypeIdInput.value);

        // Validation
        if (isNaN(newId)) {
            alert('有効な種別IDを入力してください。');
            return;
        }

        if (!licenseTypeName.value.trim()) {
            alert('種別名を入力してください。');
            return;
        }

        const now = new Date().toLocaleString();
        const data = {
            license_type_id: newId,
            license_type_name: licenseTypeName.value.trim(),
            category: category ? category.value.trim() : '',
            has_expiry: hasExpiry.checked,
            default_notice_days: hasExpiry.checked && defaultNoticeDays.value ? parseInt(defaultNoticeDays.value) : null,
            status: status.value,
            sort_order: sortOrder.value ? parseInt(sortOrder.value) : 999,
            remarks: remarks.value.trim(),
            last_updated: now
        };

        try {
            if (currentIdParam === 'new') {
                // New: Create with lt_ prefix or auto-ID? Sticking to lt_ prefix for consistency if possible
                const docId = `lt_${newId}`;
                data.created_date = now;
                await saveToFirestore('license_types', docId, data);
                showToast('新規登録しました', 'success');

                // Update internal state and URL
                currentIdParam = newId.toString();
                currentDocId = docId;
                currentData = data;
                history.replaceState(null, '', `?id=${newId}`);
            } else {
                // Update: Use existing Doc ID
                data.created_date = currentData?.created_date || now;
                // If currentDocId is null (shouldn't happen here), fallback
                const docId = currentDocId || `lt_${newId}`;
                await saveToFirestore('license_types', docId, data);
                showToast('保存しました', 'success');
            }
            // setTimeout(() => { window.location.href = 'license_types_list.html'; }, 800);
        } catch (error) {
            console.error('Save failed:', error);
            showToast('保存に失敗しました', 'error');
        }
    }

    // Delete Data
    async function deleteData() {
        if (currentIdParam === 'new') return;

        const oldId = parseInt(currentIdParam);

        // 紐付きチェック（Firestoreから案件を検索）
        try {
            // Optimize: Use limit(1) to check existence
            const casesSnapshot = await db.collection('cases')
                .where('license_type_id', '==', oldId)
                .limit(1)
                .get();
            const casesCount = casesSnapshot.size;

            const licensesSnapshot = await db.collection('customer_licenses')
                .where('license_type_id', '==', oldId)
                .limit(1)
                .get();
            const licensesCount = licensesSnapshot.size;

            if (casesCount > 0 || licensesCount > 0) {
                alert(`この許認可種別は案件または許認可データで使用されているため削除できません。状態を「無効」に変更することを検討してください。`);
                return;
            }
        } catch (error) {
            console.error('Delete check failed:', error);
            alert('削除前チェックに失敗しました');
            return;
        }

        if (!confirm('本当に削除しますか？この操作は取り消せません。')) {
            return;
        }

        try {
            // Use currentDocId for deletion
            if (currentDocId) {
                await db.collection('license_types').doc(currentDocId).delete();
                console.log(`Document deleted: ${currentDocId}`);
                showToast('削除しました', 'success');
                setTimeout(() => { window.location.href = 'license_types_list.html'; }, 800);
            } else {
                throw new Error('Document ID missing');
            }
        } catch (error) {
            console.error('Delete failed:', error);
            showToast('削除に失敗しました', 'error');
        }
    }

    // --- Event Listeners ---
    hasExpiry.addEventListener('change', toggleNoticeDaysGroup);
    btnBack.addEventListener('click', () => window.location.href = 'license_types_list.html');
    btnSave.addEventListener('click', saveData);
    btnDelete.addEventListener('click', deleteData);

    // Start
    init();
});
