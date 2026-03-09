document.addEventListener('DOMContentLoaded', () => {
    // const staffForm = document.getElementById('staff-form'); // Removed as we use button click
    const staffIdInput = document.getElementById('staff_id');
    const staffTitle = document.getElementById('page-title');
    // const lastUpdatedDisplay = document.getElementById('last-updated-display'); // Wrong ID in HTML
    const lastUpdatedDisplay = document.getElementById('updated_at'); // Correct ID
    const createdDateDisplay = document.getElementById('created_at'); // Added
    const btnBack = document.getElementById('btn-back');
    const btnBackTop = document.getElementById('btn-back-top');

    let staffId = null;
    let currentStaff = null;
    let currentDocId = null; // Store the actual Firestore Document ID

    function getStaffIdFromUrl() {
        const params = new URLSearchParams(window.location.search);
        return params.get('id');
    }

    async function init() {
        const idParam = getStaffIdFromUrl();
        if (idParam === 'new') {
            staffId = 'new';
            staffTitle.textContent = '新規担当者登録';
            currentDocId = null; // New doc will be created
            try {
                const nextId = await getNextSequence('staff');
                if (staffIdInput) staffIdInput.value = nextId;
            } catch (e) {
                console.error("Failed to get next ID", e);
                if (staffIdInput) staffIdInput.value = "";
            }
        } else {
            staffId = parseInt(idParam);
            try {
                // Use Query instead of Direct Doc ID fetch to handle any Doc ID format
                const snapshot = await db.collection('staff').where('staff_id', '==', staffId).get();

                if (!snapshot.empty) {
                    const doc = snapshot.docs[0];
                    currentStaff = doc.data();
                    currentDocId = doc.id; // Capture the real Doc ID
                    populateForm(currentStaff);
                } else {
                    // Fallback: Try string query if number failed (just in case)
                    const snapshotStr = await db.collection('staff').where('staff_id', '==', String(staffId)).get();
                    if (!snapshotStr.empty) {
                        const doc = snapshotStr.docs[0];
                        currentStaff = doc.data();
                        currentDocId = doc.id;
                        populateForm(currentStaff);
                    } else {
                        console.warn(`Staff not found for ID: ${staffId}`);
                        alert('担当者が見つかりません。');
                        // window.location.href = 'staff_list.html'; // Optional: Redirect or stay to debug
                        return;
                    }
                }
            } catch (error) {
                console.error("Error loading staff:", error);
                alert('データの読み込みに失敗しました。');
                return;
            }
        }

        // Delete button setup
        const btnDelete = document.getElementById('btn-delete');
        if (staffId === 'new') {
            if (btnDelete) btnDelete.style.display = 'none';
        } else {
            if (btnDelete) btnDelete.addEventListener('click', handleDelete);
        }
    }

    function populateForm(data) {
        if (staffIdInput) staffIdInput.value = data.staff_id;
        staffTitle.textContent = `担当者詳細：${data.staff_name}`;
        // 更新日時等の表示
        if (lastUpdatedDisplay) lastUpdatedDisplay.innerHTML = formatToJST(data.last_updated);
        if (createdDateDisplay) createdDateDisplay.innerHTML = formatToJST(data.created_date || data.created_at); // Handle both checks

        document.getElementById('staff_name').value = data.staff_name || '';
        document.getElementById('staff_name_kana').value = data.staff_kana || ''; // Fixed ID
        document.getElementById('mobile_phone').value = data.phone || ''; // Fixed ID
        document.getElementById('email').value = data.email || '';
        document.getElementById('postal_code').value = data.postal_code || '';
        document.getElementById('address').value = data.address || '';
        document.getElementById('building_name').value = data.building_name || ''; // Added

        document.getElementById('department').value = data.department || '';

        // Role (Job Title)
        document.getElementById('role').value = data.role || '補助者';

        document.getElementById('authority').value = data.authority || 'staff';

        document.getElementById('qualification').value = data.qualification || ''; // Added
        document.getElementById('hire_date').value = formatDateForInput(data.hire_date); // Added & Formatted

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
            staff_kana: document.getElementById('staff_name_kana').value.trim(), // Fixed ID
            phone: document.getElementById('mobile_phone').value.trim(), // Fixed ID
            email: document.getElementById('email').value.trim(),
            postal_code: document.getElementById('postal_code').value.trim(),
            address: document.getElementById('address').value.trim(),
            building_name: document.getElementById('building_name').value.trim(), // Added
            department: document.getElementById('department').value.trim(),
            role: document.getElementById('role').value, // Job Title
            authority: document.getElementById('authority').value, // System Permission
            qualification: document.getElementById('qualification').value.trim(), // Added
            hire_date: document.getElementById('hire_date').value, // Added
            status: document.getElementById('status').value,
            remarks: document.getElementById('remarks').value.trim(),
            last_updated: now
        };

        try {
            let docId = currentDocId;

            if (staffId === 'new') {
                docId = `staff_${newId}`; // Generate new ID pattern for new records
                updatedData.created_date = now;

                // Check if ID already exists to prevent overwrite (Optional safety)
                const check = await db.collection('staff').doc(docId).get();
                if (check.exists) {
                    if (!confirm(`Staff ID ${newId} already exists. Overwrite?`)) return;
                }

                await saveToFirestore('staff', docId, updatedData);
                showToast('新規登録しました', 'success');

                // Update URL for new item without reloading
                staffId = newId.toString();
                currentDocId = docId;
                currentStaff = updatedData;
                history.replaceState(null, '', `?id=${newId}`);
            } else {
                // Update existing document using its REAL ID
                if (!docId) docId = `staff_${newId}`; // Fallback if somehow null

                await saveToFirestore('staff', docId, { ...currentStaff, ...updatedData });
                showToast('保存しました', 'success');
            }

            // --- Update Local Session if editing own profile ---
            const sessionData = localStorage.getItem('lapis2_session');
            if (sessionData) {
                const session = JSON.parse(sessionData);
                if (session.email === updatedData.email) {
                    session.authority = updatedData.authority;
                    session.staff_name = updatedData.staff_name;
                    localStorage.setItem('lapis2_session', JSON.stringify(session));
                    // Reflect changes in UI immediately
                    if (typeof renderUserStatus === 'function') renderUserStatus(session);
                    if (typeof applyPermissions === 'function') applyPermissions(session);
                }
            }
            // setTimeout(() => {
            //     window.location.href = 'staff_list.html';
            // }, 1000);
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
                // Use currentDocId for deletion
                const targetDocId = currentDocId || `staff_${staffId}`;
                await deleteFromFirestore('staff', targetDocId);

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

    // staffForm.addEventListener('submit', handleSave); 
    // Form element might not exist, use button click
    const btnSave = document.getElementById('btn-save');
    if (btnSave) {
        btnSave.addEventListener('click', handleSave);
    }

    if (btnBack) btnBack.addEventListener('click', () => window.location.href = 'staff_list.html');
    if (btnBackTop) btnBackTop.addEventListener('click', () => window.location.href = 'staff_list.html');

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
