document.addEventListener('DOMContentLoaded', () => {
    // Check if user is logged in (basic check)
    firebase.auth().onAuthStateChanged(user => {
        if (!user) {
            alert('ログインしてください。');
            window.location.href = 'index.html';
        }
    });

    const db = firebase.firestore();
    const btnScan = document.getElementById('btn-scan');
    const resultsArea = document.getElementById('results-area');
    const statusMsg = document.getElementById('status-message');

    // --- State ---
    let duplicatesMap = new Map(); // Name -> Array of Staff Objects

    // --- Scan Logic ---
    async function scanDuplicates() {
        btnScan.disabled = true;
        statusMsg.textContent = 'スキャン中...';
        resultsArea.innerHTML = '';
        duplicatesMap.clear();

        try {
            // 1. Get All Staff
            const snap = await db.collection('staff').get();
            const allStaff = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

            // 2. Group by Name
            const groups = {};
            allStaff.forEach(s => {
                const name = (s.staff_name || '').trim();
                if (!name) return;
                if (!groups[name]) groups[name] = [];
                groups[name].push(s);
            });

            // 3. Filter Duplicates
            const duplicateNames = Object.keys(groups).filter(name => groups[name].length > 1);

            if (duplicateNames.length === 0) {
                statusMsg.textContent = '重複する担当者は見つかりませんでした。';
                btnScan.disabled = false;
                return;
            }

            statusMsg.textContent = `${duplicateNames.length} 組の重複が見つかりました。案件数を調査中...`;

            // 4. Check Case Counts for each duplicate
            for (const name of duplicateNames) {
                const staffList = groups[name];

                // Fetch counts in parallel
                await Promise.all(staffList.map(async (s) => {
                    const fieldCases = await db.collection('cases').where('field_staff_id', '==', s.id).get();
                    const docCases = await db.collection('cases').where('document_staff_id', '==', s.id).get();
                    // Note: A case might have same staff as both field and doc, but count is for impact estimation.
                    // Precise merging handles fields separately.
                    s.caseCount = fieldCases.size + docCases.size;
                }));

                duplicatesMap.set(name, staffList);
            }

            renderResults();
            statusMsg.textContent = 'スキャン完了';

        } catch (err) {
            console.error(err);
            statusMsg.textContent = 'エラーが発生しました: ' + err.message;
        } finally {
            btnScan.disabled = false;
        }
    }

    // --- Render Logic ---
    function renderResults() {
        resultsArea.innerHTML = '';

        duplicatesMap.forEach((staffList, name) => {
            const groupDiv = document.createElement('div');
            groupDiv.className = 'duplicate-group';

            const header = document.createElement('h3');
            header.textContent = `氏名: ${name}`;
            groupDiv.appendChild(header);

            // Determine default keep (e.g. one with most cases, or oldest)
            // Sort by caseCount desc, then created_at asc
            staffList.sort((a, b) => b.caseCount - a.caseCount); // Simple sort

            const formInfo = document.createElement('div');
            formInfo.innerHTML = '<p>残すデータを選択してください（他方は削除され、案件は統合されます）</p>';
            groupDiv.appendChild(formInfo);

            staffList.forEach((s, index) => {
                const card = document.createElement('div');
                card.className = 'staff-card';
                if (index === 0) card.classList.add('selected-keep'); // Default select first

                const radio = document.createElement('input');
                radio.type = 'radio';
                radio.name = `keep_${name}`; // Group by name
                radio.value = s.id;
                radio.checked = index === 0;
                radio.onchange = () => updateSelectionStyles(groupDiv, s.id);

                const info = document.createElement('div');
                info.className = 'staff-info';
                info.innerHTML = `
                    <strong>${s.staff_name}</strong> (${s.staff_kana || 'カナなし'})<br>
                    <span style="font-family:monospace; color:#666;">ID: ${s.id}</span>
                    <span class="badge" style="margin-left:5px;">${s.role || '役割不明'}</span>
                `;

                const countBadge = document.createElement('div');
                countBadge.className = 'case-count';
                countBadge.textContent = `関連案件: ${s.caseCount}件`;

                card.appendChild(radio);
                card.appendChild(info);
                card.appendChild(countBadge);
                groupDiv.appendChild(card);
            });

            const actionArea = document.createElement('div');
            actionArea.className = 'action-area';

            const btnMerge = document.createElement('button');
            btnMerge.className = 'primary-btn';
            btnMerge.textContent = 'このグループを統合して解決';
            btnMerge.onclick = () => executeMerge(name);

            actionArea.appendChild(btnMerge);
            groupDiv.appendChild(actionArea);

            resultsArea.appendChild(groupDiv);
        });
    }

    function updateSelectionStyles(groupDiv, keepId) {
        const cards = groupDiv.querySelectorAll('.staff-card');
        cards.forEach(card => {
            const radio = card.querySelector('input[type="radio"]');
            if (radio.value === keepId) {
                card.classList.add('selected-keep');
                card.classList.remove('selected-remove');
            } else {
                card.classList.remove('selected-keep');
                card.classList.add('selected-remove');
            }
        });
    }

    // --- Merge Logic ---
    async function executeMerge(name) {
        const staffList = duplicatesMap.get(name);
        if (!staffList || staffList.length < 2) return;

        // Find selected keep ID
        const radio = document.querySelector(`input[name="keep_${name}"]:checked`);
        if (!radio) {
            alert('残すデータを選択してください。');
            return;
        }
        const keepId = radio.value;
        const removeStaffs = staffList.filter(s => s.id !== keepId);

        if (!confirm(`【確認】\n氏名: ${name}\n\nID: ${keepId} を残し、\n他の ${removeStaffs.length} 件を削除します。\n削除されるIDに紐づく案件は、自動的に ${keepId} に付け替えられます。\n\n実行してよろしいですか？`)) {
            return;
        }

        try {
            const batch = db.batch();
            let opCount = 0;

            // 1. Update Cases for each staff to be removed
            for (const removeStats of removeStaffs) {
                const removeId = removeStats.id;

                // Find cases where field_staff_id == removeId
                const fieldCases = await db.collection('cases').where('field_staff_id', '==', removeId).get();
                fieldCases.forEach(doc => {
                    batch.update(doc.ref, { field_staff_id: keepId });
                    opCount++;
                });

                // Find cases where document_staff_id == removeId
                const docCases = await db.collection('cases').where('document_staff_id', '==', removeId).get();
                docCases.forEach(doc => {
                    batch.update(doc.ref, { document_staff_id: keepId });
                    opCount++;
                });

                // 2. Delete the Staff document
                batch.delete(db.collection('staff').doc(removeId));
                opCount++;
            }

            await batch.commit();
            alert(`完了しました。\n統合された案件数など: ${opCount} 件の操作を実行しました。`);

            // Re-scan or remove UI element
            const groupDiv = radio.closest('.duplicate-group');
            groupDiv.remove(); // Remove from UI

            // Check if no more duplicates
            if (document.querySelectorAll('.duplicate-group').length === 0) {
                resultsArea.innerHTML = '<p>すべての重複が解消されました！🎉</p>';
            }

        } catch (err) {
            console.error(err);
            alert('統合処理に失敗しました: ' + err.message);
        }
    }

    btnScan.addEventListener('click', scanDuplicates);
});
