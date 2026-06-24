document.addEventListener('DOMContentLoaded', () => {
    const tPageStart = performance.now();
    console.log('Staff Detail: Phase 1 (Sync UI) starting...');

    const staffIdInput = document.getElementById('staff_id');
    const staffTitle = document.getElementById('page-title');
    const lastUpdatedDisplay = document.getElementById('updated_at');
    const createdDateDisplay = document.getElementById('created_at');
    const btnBack = document.getElementById('btn-back');
    const btnBackTop = document.getElementById('btn-back-top');
    const btnSearchAddress = document.getElementById('btn-search-address');
    const inputPostalCode = document.getElementById('postal_code');
    const btnSave = document.getElementById('btn-save');
    const btnDelete = document.getElementById('btn-delete');

    let staffId = null;
    let currentStaff = null;
    let currentDocId = null; // Store the actual Firestore Document ID

    function getStaffIdFromUrl() {
        const params = new URLSearchParams(window.location.search);
        return params.get('id');
    }

    // =========================================================
    //  Phase 1: 同期UI初期化 — ブロッキングなし、即時描画
    // =========================================================

    const idParam = getStaffIdFromUrl();
    if (idParam === 'new') {
        staffId = 'new';
        if (staffTitle) staffTitle.textContent = '新規担当者登録';
        currentDocId = null; 
        if (btnDelete) btnDelete.style.display = 'none';
        if (staffIdInput) staffIdInput.value = '(採番中...)';
    } else {
        staffId = parseInt(idParam);
        if (btnDelete) btnDelete.addEventListener('click', handleDelete);
    }

    // --- イベントリスナーの登録 ---
    if (btnSave) btnSave.addEventListener('click', handleSave);
    if (btnBack) btnBack.addEventListener('click', () => window.location.href = 'staff_list.html');
    if (btnBackTop) btnBackTop.addEventListener('click', () => window.location.href = 'staff_list.html');

    if (inputPostalCode && btnSearchAddress) {
        inputPostalCode.addEventListener('input', updateSearchButtonState);
        btnSearchAddress.addEventListener('click', fetchAddress);
    }

    console.log(`[Perf] Phase 1 (Sync UI) completed in ${(performance.now() - tPageStart).toFixed(1)}ms`);

    // =========================================================
    //  Phase 2: 非同期データ取得 — Fire & Forget
    // =========================================================
    loadAllData();

    async function loadAllData() {
        const t2Start = performance.now();
        if (staffId === 'new') {
            try {
                const nextId = await getNextSequence('staff');
                if (staffIdInput) staffIdInput.value = nextId;
            } catch (e) {
                console.error("Failed to get next ID", e);
                if (staffIdInput) staffIdInput.value = "";
            }
        } else {
            try {
                // Use Query instead of Direct Doc ID fetch to handle any Doc ID format
                const snapshot = await db.collection('staff').where('staff_id', '==', staffId).get();

                if (!snapshot.empty) {
                    const doc = snapshot.docs[0];
                    currentStaff = doc.data();
                    currentDocId = doc.id; 
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
                        return;
                    }
                }
            } catch (error) {
                console.error("Error loading staff:", error);
                alert('データの読み込みに失敗しました。');
                return;
            }
        }
        console.log(`[Perf] Phase 2 data loaded in ${(performance.now() - t2Start).toFixed(1)}ms`);
    }

    function populateForm(data) {
        if (staffIdInput) staffIdInput.value = data.staff_id;
        if (staffTitle) staffTitle.textContent = `担当者詳細：${data.staff_name}`;
        
        if (lastUpdatedDisplay) lastUpdatedDisplay.innerHTML = formatToJST(data.last_updated);
        if (createdDateDisplay) createdDateDisplay.innerHTML = formatToJST(data.created_date || data.created_at);

        document.getElementById('staff_name').value = data.staff_name || '';
        document.getElementById('staff_name_kana').value = data.staff_kana || '';
        document.getElementById('mobile_phone').value = data.phone || '';
        document.getElementById('email').value = data.email || '';
        document.getElementById('postal_code').value = data.postal_code || '';
        document.getElementById('address').value = data.address || '';
        document.getElementById('building_name').value = data.building_name || '';
        document.getElementById('department').value = data.department || '';
        document.getElementById('role').value = data.role || '補助者';
        document.getElementById('authority').value = data.authority || 'staff';
        document.getElementById('qualification').value = data.qualification || '';
        window.setDateValueById('hire_date', formatDateForInput(data.hire_date));
        document.getElementById('status').value = data.status || '在籍';
        document.getElementById('remarks').value = data.remarks || '';

        updateSearchButtonState();

        // --- Role Permission Control (UI) ---
        const sessionData = localStorage.getItem('lapis3_session');
        if (sessionData) {
            const session = JSON.parse(sessionData);
            const authSelect = document.getElementById('authority');
            if (session.authority !== 'admin') {
                if (authSelect) {
                    authSelect.setAttribute('disabled', 'disabled');
                    authSelect.title = "権限の変更は管理者のみ可能です";
                }
            } else {
                if (authSelect) {
                    authSelect.removeAttribute('disabled');
                    authSelect.removeAttribute('title');
                }
            }

            // --- Privacy Masking Control (案B) ---
            const isSelf = session.email === data.email;
            const isAdmin = session.authority === 'admin';

            if (!isSelf && !isAdmin && staffId !== 'new') {
                const privateFields = [
                    'postal_code', 'address', 'building_name',
                    'qualification', 'hire_date', 'status', 'remarks'
                ];

                privateFields.forEach(fieldId => {
                    const el = document.getElementById(fieldId);
                    if (el) {
                        if (el.type === 'date' || el._udp) {
                            window.setDateControlValue(el, '');
                        } else if (el.tagName === 'SELECT') {
                            el.value = '';
                        } else {
                            el.value = '********';
                        }
                        el.setAttribute('disabled', 'disabled');
                        el.style.color = "transparent";
                        el.style.textShadow = "0 0 5px rgba(0,0,0,0.5)";
                    }
                });

                if (btnSearchAddress) btnSearchAddress.style.display = 'none';
                if (btnSave) btnSave.style.display = 'none';
                if (btnDelete) btnDelete.style.display = 'none';
            } else {
                if (btnSave) btnSave.style.display = 'inline-flex';
            }
        }
    }

    async function handleSave(e) {
        if(e) e.preventDefault();

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
        const selectedAuthority = document.getElementById('authority').value;

        // --- Self Lockout Prevention ---
        const sessionData = localStorage.getItem('lapis3_session');
        if (sessionData) {
            const session = JSON.parse(sessionData);
            if (session.email === document.getElementById('email').value.trim() && session.authority === 'admin' && selectedAuthority === 'staff') {
                const confirmMsg = "⚠️ 警告\n\nあなた自身の権限を「一般」に変更しようとしています。\n実行すると以降、管理者メニュー（インポートやバックアップ等）にアクセスできなくなります。\n\n本当に自身の権限を変更して保存しますか？";
                if (!confirm(confirmMsg)) return;
            }
        }

        const updatedData = {
            staff_id: newId,
            staff_name: staffName,
            staff_kana: document.getElementById('staff_name_kana').value.trim(),
            phone: document.getElementById('mobile_phone').value.trim(),
            email: email,
            postal_code: document.getElementById('postal_code').value.trim(),
            address: document.getElementById('address').value.trim(),
            building_name: document.getElementById('building_name').value.trim(),
            department: document.getElementById('department').value.trim(),
            role: document.getElementById('role').value,
            authority: selectedAuthority,
            qualification: document.getElementById('qualification').value.trim(),
            hire_date: document.getElementById('hire_date').value,
            status: document.getElementById('status').value,
            remarks: document.getElementById('remarks').value.trim(),
            last_updated: now
        };

        try {
            let docId = currentDocId;

            if (staffId === 'new') {
                docId = `staff_${newId}`; 
                updatedData.created_date = now;

                const check = await db.collection('staff').doc(docId).get();
                if (check.exists) {
                    if (!confirm(`Staff ID ${newId} already exists. Overwrite?`)) return;
                }

                await saveToFirestore('staff', docId, updatedData);
                showToast('新規登録しました', 'success');

                staffId = newId.toString();
                currentDocId = docId;
                currentStaff = updatedData;
                history.replaceState(null, '', `?id=${newId}`);
            } else {
                if (!docId) docId = `staff_${newId}`;
                await saveToFirestore('staff', docId, { ...currentStaff, ...updatedData });
                showToast('保存しました', 'success');
            }

            // --- Update Local Session if editing own profile ---
            if (sessionData) {
                const session = JSON.parse(sessionData);
                if (session.email === updatedData.email) {
                    session.authority = updatedData.authority;
                    session.staff_name = updatedData.staff_name;
                    localStorage.setItem('lapis3_session', JSON.stringify(session));
                    if (typeof renderUserStatus === 'function') renderUserStatus(session);
                    if (typeof applyPermissions === 'function') applyPermissions(session);
                }
            }
        } catch (error) {
            console.error("Save failed:", error);
            showToast('保存に失敗しました', 'error');
        }
    }

    async function handleDelete() {
        if (staffId === 'new') return;

        try {
            const casesRef = db.collection('cases');
            const snapField = await casesRef.where('field_staff_id', '==', staffId).get();
            const snapDoc = await casesRef.where('document_staff_id', '==', staffId).get();
            const assignedCount = snapField.size + snapDoc.size;

            if (assignedCount > 0) {
                alert(`この担当者は ${assignedCount} 件の案件に割り当てられているため削除できません。\n先に案件の担当者を変更するか、状態を「退職」に変更してください。`);
                return;
            }

            if (confirm('本当に削除しますか？\nこの操作は取り消せません。')) {
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

    function updateSearchButtonState() {
        if (!inputPostalCode || !btnSearchAddress) return;
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
});
