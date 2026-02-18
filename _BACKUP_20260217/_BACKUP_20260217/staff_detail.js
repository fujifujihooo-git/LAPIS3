document.addEventListener('DOMContentLoaded', () => {
    const staffForm = document.getElementById('staff-form');
    const staffIdInput = document.getElementById('staff_id');
    const staffTitle = document.getElementById('page-title');
    const lastUpdatedDisplay = document.getElementById('last-updated-display');
    const btnBack = document.getElementById('btn-back');
    const btnBackTop = document.getElementById('btn-back-top');

    let staffId = null;
    let currentStaff = null;

    function getStaffIdFromUrl() {
        const params = new URLSearchParams(window.location.search);
        return params.get('id');
    }

    async function init() {
        const idParam = getStaffIdFromUrl();
        if (idParam === 'new') {
            staffId = 'new';
            staffTitle.textContent = '新規担当者登録';
            try {
                const nextId = await getNextSequence('staff');
                staffIdInput.value = nextId;
            } catch (e) {
                console.error("Failed to get next ID", e);
                staffIdInput.value = "";
            }
        } else {
            staffId = parseInt(idParam);
            try {
                const docId = `staff_${staffId}`;
                const doc = await getDocFromFirestore('staff', docId);
                if (doc) {
                    currentStaff = doc;
                    populateForm(currentStaff);
                } else {
                    alert('担当者が見つかりません。');
                    window.location.href = 'staff_list.html';
                    return;
                }
            } catch (error) {
                console.error("Error loading staff:", error);
                alert('データの読み込みに失敗しました。');
                window.location.href = 'staff_list.html';
                return;
            }
        }

        // Delete button setup (after init to have staffId set)
        const btnDelete = document.getElementById('btn-delete');
        if (staffId === 'new') {
            if (btnDelete) btnDelete.style.display = 'none';
        } else {
            if (btnDelete) btnDelete.addEventListener('click', handleDelete);
        }
    }

    function populateForm(data) {
        staffIdInput.value = data.staff_id;
        staffTitle.textContent = `担当者詳細：${data.staff_name}`;
        lastUpdatedDisplay.innerHTML = formatDate(data.last_updated);

        document.getElementById('staff_name').value = data.staff_name || '';
        document.getElementById('staff_kana').value = data.staff_kana || '';
        document.getElementById('phone').value = data.phone || '';
        document.getElementById('email').value = data.email || '';
        document.getElementById('postal_code').value = data.postal_code || '';
        document.getElementById('address').value = data.address || '';

        document.getElementById('department').value = data.department || '';
        document.getElementById('role').value = data.role || '補助者';
        document.getElementById('status').value = data.status || '在籍';
        document.getElementById('remarks').value = data.remarks || '';

        // Trigger button state update
        if (typeof updateSearchButtonState === 'function') {
            updateSearchButtonState();
        } else {
            const btn = document.getElementById('btn-search-address');
            if (btn && document.getElementById('postal_code').value) {
                btn.removeAttribute('disabled');
            }
        }
    }

    async function handleSave(e) {
        e.preventDefault();

        // Validation
        clearInputErrors();
        let hasError = false;

        const staffName = document.getElementById('staff_name').value.trim();
        if (!staffName) {
            showInputError('staff_name', '氏名を入力してください。');
            hasError = true;
        }

        const email = document.getElementById('email').value.trim();
        const emailValidation = validateEmail(email);
        if (!emailValidation.valid) {
            showInputError('email', emailValidation.message);
            hasError = true;
        }

        const zip = document.getElementById('postal_code').value.trim();
        if (zip) {
            const zipValidation = validatePostalCode(zip);
            if (!zipValidation.valid) {
                showInputError('postal_code', zipValidation.message);
                hasError = true;
            } else {
                document.getElementById('postal_code').value = zipValidation.value;
            }
        }

        if (hasError) {
            const firstError = document.querySelector('.error-input');
            if (firstError) firstError.scrollIntoView({ behavior: 'smooth', block: 'center' });
            return;
        }

        const newId = parseInt(staffIdInput.value);
        if (isNaN(newId)) {
            alert('有効なStaff IDを入力してください。');
            return;
        }

        const now = new Date().toISOString();
        const updatedData = {
            staff_id: newId,
            staff_name: document.getElementById('staff_name').value.trim(),
            staff_kana: document.getElementById('staff_kana').value.trim(),
            phone: document.getElementById('phone').value.trim(),
            email: document.getElementById('email').value.trim(),
            postal_code: document.getElementById('postal_code').value.trim(),
            address: document.getElementById('address').value.trim(),
            department: document.getElementById('department').value.trim(),
            role: document.getElementById('role').value,
            status: document.getElementById('status').value,
            remarks: document.getElementById('remarks').value.trim(),
            last_updated: now
        };

        try {
            const docId = `staff_${newId}`;
            if (staffId === 'new') {
                updatedData.created_date = now;
                await saveToFirestore('staff', docId, updatedData);
                showToast('新規登録しました', 'success');
            } else {
                await saveToFirestore('staff', docId, { ...currentStaff, ...updatedData });
                showToast('保存しました', 'success');
            }
            setTimeout(() => {
                window.location.href = 'staff_list.html';
            }, 1000);
        } catch (error) {
            console.error("Save failed:", error);
            showToast('保存に失敗しました', 'error');
        }
    }

    async function handleDelete() {
        if (staffId === 'new') return;

        try {
            // 担当案件があるかチェック (Firestore Query)
            const casesRef = db.collection('cases');
            const snapField = await casesRef.where('field_staff_id', '==', staffId).get();
            const snapDoc = await casesRef.where('document_staff_id', '==', staffId).get();
            const assignedCount = snapField.size + snapDoc.size;

            if (assignedCount > 0) {
                alert(`この担当者は ${assignedCount} 件の案件に割り当てられているため削除できません。\n先に案件の担当者を変更するか、状態を「退職」に変更してください。`);
                return;
            }

            if (confirm('本当に削除しますか？\nこの操作は取り消せません。')) {
                await deleteFromFirestore('staff', `staff_${staffId}`);
                showToast('削除しました', 'success');
                setTimeout(() => {
                    window.location.href = 'staff_list.html';
                }, 1000);
            }
        } catch (error) {
            console.error("Delete check failed:", error);
            alert('削除前チェックに失敗しました');
        }
    }

    staffForm.addEventListener('submit', handleSave);
    btnBack.addEventListener('click', () => window.location.href = 'staff_list.html');
    btnBackTop.addEventListener('click', () => window.location.href = 'staff_list.html');

    const btnSearchAddress = document.getElementById('btn-search-address');
    const inputPostalCode = document.getElementById('postal_code');

    // Zip Code Search Logic
    function updateSearchButtonState() {
        if (inputPostalCode.value.trim().length > 0) {
            btnSearchAddress.removeAttribute('disabled');
        } else {
            btnSearchAddress.setAttribute('disabled', 'true');
        }
    }

    async function fetchAddress() {
        const zipVal = inputPostalCode.value.trim();
        const validation = validatePostalCode(zipVal);

        if (!validation.valid) {
            alert(validation.message);
            return;
        }

        const zip = validation.value;

        try {
            const response = await fetch(`https://zipcloud.ibsnet.co.jp/api/search?zipcode=${zip}`);
            const data = await response.json();

            if (data.status === 200 && data.results) {
                const result = data.results[0];
                const addr = result.address1 + result.address2 + result.address3;
                document.getElementById('address').value = addr;
            } else {
                alert('該当する住所が見つかりませんでした。');
            }
        } catch (error) {
            console.error('ZipCloud API Error:', error);
            alert('住所の取得に失敗しました。');
        }
    }

    inputPostalCode.addEventListener('input', updateSearchButtonState);
    btnSearchAddress.addEventListener('click', fetchAddress);

    init();
});
