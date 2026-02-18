document.addEventListener('DOMContentLoaded', () => {
    // --- Selectors ---
    const form = document.getElementById('contact-form');
    const contactIdDisplay = document.getElementById('contact-id-display');
    const contactTitle = document.getElementById('page-title');
    const createdDateDisplay = document.getElementById('created-date-display');
    const lastUpdatedDisplay = document.getElementById('last-updated-display');
    const btnBack = document.getElementById('btn-back');
    const btnBackTop = document.getElementById('btn-back-top');
    const btnDelete = document.getElementById('btn-delete');
    const officeSelect = document.getElementById('office_id');

    // --- State ---
    let currentContact = null;
    let contactIdParam = null;
    let customerId = null;
    let offices = []; // 拠点の選択肢用

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

        try {
            // 1. 拠点の取得（この顧客に紐づく拠点のみ）
            const officesSnap = await db.collection('offices')
                .where('customer_id', '==', customerId)
                .where('status', '==', '有効') // 有効な拠点のみ選択肢に出す
                .get();

            offices = officesSnap.docs.map(doc => doc.data());

            // 拠点をプルダウンに追加
            offices.forEach(o => {
                const opt = document.createElement('option');
                opt.value = o.office_id;
                opt.textContent = o.office_name;
                officeSelect.appendChild(opt);
            });

            // 2. 担当者データの取得
            if (contactIdParam === 'new') {
                // 新規登録
                contactTitle.textContent = '新規担当者登録';
                contactIdDisplay.textContent = '新規登録';
                createdDateDisplay.textContent = '保存時に設定';
                lastUpdatedDisplay.textContent = '保存時に設定';
                btnDelete.style.display = 'none';

                // 次のIDを取得して表示だけしておく（保存時に確定）
                const nextId = await getNextSequence('contacts');
                // contactIdDisplay.textContent = `(Next ID: ${nextId})`; 
            } else {
                // 既存データの編集
                const cId = parseInt(contactIdParam);
                // ドキュメントIDのパターンは `contact_{id}` または `cnt_{id}` とする
                // migrate-data.html 等の経緯が不明だが、customer_detail.js では where で取得しているため
                // クエリで取得するのが確実。
                // ただし、ID指定詳細画面なので、doc IDを知りたい。
                // ここでは `cust_` に倣って `cnt_` とするが、既存データがどうなっているか...
                // 安全のため、contactsコレクションを `contact_id` で検索する。

                const snap = await db.collection('contacts').where('contact_id', '==', cId).limit(1).get();

                if (snap.empty) {
                    alert('担当者が見つかりません。');
                    window.location.href = `customer_detail.html?id=${customerId}`;
                    return;
                }

                currentContact = snap.docs[0].data();
                populateForm(currentContact);
            }

        } catch (error) {
            console.error('Init failed:', error);
            alert('データの読み込みに失敗しました。');
        }
    }

    function populateForm(data) {
        contactIdDisplay.textContent = `Contact ID: ${data.contact_id}`;
        contactTitle.textContent = `担当者詳細：${data.contact_name}`;
        createdDateDisplay.textContent = data.created_date || '-';
        lastUpdatedDisplay.textContent = data.last_updated || '-';

        document.getElementById('contact_name').value = data.contact_name || '';
        document.getElementById('contact_kana').value = data.contact_kana || '';
        document.getElementById('department').value = data.department || '';
        document.getElementById('title').value = data.title || '';
        document.getElementById('office_id').value = data.office_id || '';
        document.getElementById('is_primary').checked = !!data.is_primary;
        document.getElementById('phone').value = data.phone || '';
        document.getElementById('mobile').value = data.mobile || '';
        document.getElementById('fax').value = data.fax || '';
        document.getElementById('email').value = data.email || '';
        document.getElementById('status').value = data.status || '在籍';
        document.getElementById('remarks').value = data.remarks || '';
    }

    async function handleSave(e) {
        e.preventDefault();

        const isPrimary = document.getElementById('is_primary').checked;

        // 主担当フラグの排他制御：Firestoreのトランザクションを使うか、
        // 簡易的に「自分を保存する前に、他を更新する」か。
        // ここでは簡易実装：もし自分がPrimaryなら、同顧客の他のPrimaryを下ろすバッチ処理を入れる。

        try {
            const batch = db.batch();

            if (isPrimary) {
                // 同じ顧客の他の「主担当」担当者を検索
                const otherPrimarySnap = await db.collection('contacts')
                    .where('customer_id', '==', customerId)
                    .where('is_primary', '==', true)
                    .get();

                otherPrimarySnap.forEach(doc => {
                    // 自分自身以外（新規の場合はIDがないので全て、編集の場合はID不一致）
                    const d = doc.data();
                    if (contactIdParam === 'new' || d.contact_id !== parseInt(contactIdParam)) {
                        batch.update(doc.ref, { is_primary: false });
                    }
                });
            }

            const updatedData = {
                customer_id: customerId,
                contact_name: document.getElementById('contact_name').value.trim(),
                contact_kana: document.getElementById('contact_kana').value.trim(),
                department: document.getElementById('department').value.trim(),
                title: document.getElementById('title').value.trim(),
                office_id: parseInt(document.getElementById('office_id').value) || null,
                is_primary: isPrimary,
                phone: document.getElementById('phone').value.trim(),
                mobile: document.getElementById('mobile').value.trim(),
                fax: document.getElementById('fax').value.trim(),
                email: document.getElementById('email').value.trim(),
                status: document.getElementById('status').value,
                remarks: document.getElementById('remarks').value.trim(),
                last_updated: new Date().toLocaleString()
            };

            let docRef;
            if (contactIdParam === 'new') {
                const nextId = await getNextSequence('contacts');
                updatedData.contact_id = nextId;
                updatedData.created_date = new Date().toLocaleDateString();

                docRef = db.collection('contacts').doc(`cnt_${nextId}`);
                batch.set(docRef, updatedData);
            } else {
                const cId = parseInt(contactIdParam);
                // 文書IDを特定する必要がある（contact_idから逆引き済みならcurrentContactから取れるが...）
                // initでcurrentContactを取っていれば、そのIDを使う。
                // ただし、doc.id を init で保持していないので、もう一度検索するか、
                // initで docId を保持するように修正する方がきれい。
                // ここではクエリして取得する（頻度は低いので許容）
                const snap = await db.collection('contacts').where('contact_id', '==', cId).limit(1).get();
                if (!snap.empty) {
                    docRef = snap.docs[0].ref;
                    batch.update(docRef, updatedData);
                } else {
                    throw new Error('保存対象のデータが見つかりません');
                }
            }

            await batch.commit();
            alert('保存しました。');
            window.location.href = `customer_detail.html?id=${customerId}`;

        } catch (error) {
            console.error('Save failed:', error);
            alert('保存に失敗しました: ' + error.message);
        }
    }

    async function handleDelete() {
        if (contactIdParam === 'new') return;

        if (confirm('この担当者を削除してもよろしいですか？')) {
            try {
                const cId = parseInt(contactIdParam);
                const snap = await db.collection('contacts').where('contact_id', '==', cId).limit(1).get();

                if (!snap.empty) {
                    await snap.docs[0].ref.delete();
                    alert('削除しました。');
                    window.location.href = `customer_detail.html?id=${customerId}`;
                } else {
                    alert('削除対象が見つかりません。');
                }
            } catch (error) {
                console.error('Delete failed:', error);
                alert('削除に失敗しました。');
            }
        }
    }

    // --- Event Listeners ---
    form.addEventListener('submit', handleSave);

    [btnBack, btnBackTop].forEach(btn => {
        btn?.addEventListener('click', () => {
            if (confirm('変更内容は保存されません。戻りますか？')) {
                window.location.href = `customer_detail.html?id=${customerId}`;
            }
        });
    });

    if (btnDelete) btnDelete.addEventListener('click', handleDelete);

    init();
});
