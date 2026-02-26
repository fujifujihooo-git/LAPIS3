document.addEventListener('DOMContentLoaded', async () => {
    // --- Selectors ---
    const form = document.getElementById('customer-form');
    const customerIdInput = document.getElementById('customer_id');
    const lastUpdatedDisplay = document.getElementById('last-updated-display');
    const relatedCasesBody = document.getElementById('related-cases-body');
    const officesListBody = document.getElementById('offices-list-body');
    const contactsListBody = document.getElementById('contacts-list-body');
    const licensesListBody = document.getElementById('licenses-list-body');
    const btnBack = document.getElementById('btn-back');
    const btnBackTop = document.getElementById('btn-back-top');
    const btnDelete = document.getElementById('btn-delete');
    const btnExportPdf = document.getElementById('btn-export-pdf');
    const btnExportExcel = document.getElementById('btn-export-excel');

    // --- State ---
    let customers = [];
    let cases = [];
    let offices = [];
    let contacts = [];
    let licenses = [];
    let licenseTypes = [];
    let staffMembers = [];
    let currentCustomer = null;
    let customerIdParam = null;

    // --- Functions ---
    function getCustomerIdFromUrl() {
        return new URLSearchParams(window.location.search).get('id');
    }

    async function init() {
        console.log('Fetching data for Customer Detail (Firestore Mode)...');
        customerIdParam = getCustomerIdFromUrl();

        try {
            // Always fetch master data
            [licenseTypes, staffMembers] = await Promise.all([
                getAllFromFirestore('license_types'),
                getAllFromFirestore('staff')
            ]);

            if (customerIdParam === 'new') {
                // New Customer: No need to fetch related data
                customers = [];
                cases = [];
                offices = [];
                contacts = [];
                licenses = [];

                initAdditionalDropdowns();

                const nextId = await getNextSequence('customers');
                customerIdInput.value = nextId;
                document.getElementById('page-title').textContent = '新規顧客登録';
                if (btnDelete) btnDelete.style.display = 'none';
                hideListSections();

            } else {
                // Existing Customer: Fetch specific data
                const cId = parseInt(customerIdParam);

                // Fetch Customer by ID
                const custDoc = await db.collection('customers').doc(`cust_${cId}`).get();
                if (!custDoc.exists) {
                    alert('顧客が見つかりません');
                    window.location.href = 'customer_list.html';
                    return;
                }
                currentCustomer = custDoc.data();
                customers = [currentCustomer]; // For compatibility if needed

                // Fetch Related Data by customer_id
                const [casesSnap, officesSnap, contactsSnap, licensesSnap] = await Promise.all([
                    db.collection('cases').where('customer_id', '==', cId).get(),
                    db.collection('offices').where('customer_id', '==', cId).get(),
                    db.collection('contacts').where('customer_id', '==', cId).get(),
                    db.collection('customer_licenses').where('customer_id', '==', cId).get()
                ]);

                cases = casesSnap.docs.map(d => d.data());
                offices = officesSnap.docs.map(d => d.data());
                contacts = contactsSnap.docs.map(d => d.data());
                licenses = licensesSnap.docs.map(d => ({ ...d.data(), _docId: d.id }));

                initAdditionalDropdowns();

                populateForm(currentCustomer);
                renderRelatedCases(cId);
                renderOffices(cId);
                renderContacts(cId);
                renderLicenses(cId);
            }
        } catch (err) {
            console.error('Init failed:', err);
            // alert('初期化エラー: ' + err.message); 
        }
    }

    function hideListSections() {
        // 新規登録時はリストセクションを非表示
        ['offices-table', 'contacts-table', 'licenses-table', 'related-cases-table'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.closest('.form-section').style.display = 'none';
        });
    }

    function initAdditionalDropdowns() {
        // 決算期（月）
        const monthSel = document.getElementById('fiscal_year_end_month');
        if (monthSel && monthSel.options.length <= 1) {
            for (let i = 1; i <= 12; i++) {
                const opt = document.createElement('option');
                opt.value = i;
                opt.textContent = `${i}月`;
                monthSel.appendChild(opt);
            }
        }
        // 決算期（日）
        const daySel = document.getElementById('fiscal_year_end_day');
        if (daySel && daySel.options.length <= 1) {
            for (let i = 1; i <= 31; i++) {
                const opt = document.createElement('option');
                opt.value = i;
                opt.textContent = `${i}日`;
                daySel.appendChild(opt);
            }
        }
        // 外務担当者
        const staffSel = document.getElementById('primary_staff_id');
        if (staffSel) {
            const activeStaff = staffMembers
                .filter(s => s.status === '在籍')
                .sort((a, b) => (a.staff_id || 0) - (b.staff_id || 0));
            activeStaff.forEach(s => {
                const opt = document.createElement('option');
                opt.value = s.staff_id;
                opt.textContent = s.staff_name;
                staffSel.appendChild(opt);
            });
        }
    }

    function populateForm(c) {
        document.getElementById('customer_name').value = c.customer_name || '';
        document.getElementById('customer_kana').value = c.customer_kana || '';
        document.getElementById('representative_name').value = c.representative_name || '';
        document.getElementById('customer_type').value = c.customer_type || '法人';
        document.getElementById('postal_code').value = c.postal_code || '';
        document.getElementById('address').value = c.address || '';
        document.getElementById('building_name').value = c.building_name || '';
        document.getElementById('phone').value = c.phone || '';
        document.getElementById('fax').value = c.fax || '';
        document.getElementById('email').value = c.email || '';
        document.getElementById('status').value = c.status || '稼働中';
        document.getElementById('nenga').value = c.nenga || 'なし';
        document.getElementById('chugen').value = c.chugen || 'なし';
        document.getElementById('fax_ok').value = c.fax_ok || '送信OK';
        document.getElementById('remarks').value = c.remarks || '';
        customerIdInput.value = c.customer_id;

        if (c.fiscal_year_end_month) document.getElementById('fiscal_year_end_month').value = c.fiscal_year_end_month;
        if (c.fiscal_year_end_day) document.getElementById('fiscal_year_end_day').value = c.fiscal_year_end_day;
        if (c.corporate_number) document.getElementById('corporate_number').value = c.corporate_number;
        if (c.primary_staff_id) document.getElementById('primary_staff_id').value = c.primary_staff_id;

        if (lastUpdatedDisplay) lastUpdatedDisplay.textContent = c.last_updated || '-';
    }

    function getStatusKey(status) {
        const map = {
            '相談': 'sodan', '受任': 'junin', '作成中': 'sakusei',
            '作成完了': 'ready', '受付（受理）': 'uketuke', '補正': 'hosei',
            '完了': 'kanryo', '取下げ': 'torisage', '返却（県局）': 'henkyoku'
        };
        return map[status] || 'sodan';
    }

    function renderRelatedCases(customerId) {
        if (!relatedCasesBody) return;
        const related = cases.filter(c => Number(c.customer_id) === customerId);
        relatedCasesBody.innerHTML = '';

        if (related.length === 0) {
            relatedCasesBody.innerHTML = '<tr><td colspan="6" class="no-data-cell">関連する案件はありません</td></tr>';
            return;
        }

        related.sort((a, b) => {
            const daysA = calculateRemainingDays(a.application_scheduled_date);
            const daysB = calculateRemainingDays(b.application_scheduled_date);
            if (daysA !== null && daysB !== null) return daysA - daysB;
            if (daysA !== null) return -1;
            if (daysB !== null) return 1;
            return new Date(b.acceptance_date) - new Date(a.acceptance_date);
        });

        related.forEach(c => {
            const tr = document.createElement('tr');
            const days = calculateRemainingDays(c.application_scheduled_date);
            const daysClass = getRemainingDaysClass(days);
            const fieldStaff = staffMembers.find(s => s.staff_id === Number(c.field_staff_id))?.staff_name || '-';
            const docStaff = staffMembers.find(s => s.staff_id === Number(c.document_staff_id))?.staff_name || '-';

            tr.innerHTML = `
                <td><span class="badge status-${getStatusKey(c.status)}">${c.status || '-'}</span></td>
                <td>${c.acceptance_date || '-'}</td>
                <td>
                    <div style="font-weight: 600;">${c.license_type || '-'}</div>
                    <div style="font-size: 0.8rem; color: var(--text-muted);">${c.procedure_name || '-'}</div>
                </td>
                <td>${c.application_scheduled_date || '-'}</td>
                <td>
                    <span class="days-badge ${daysClass}">${formatRemainingDays(days)}</span>
                </td>
                <td>
                    <div>${fieldStaff}</div>
                    <div style="font-size: 0.8rem; color: var(--text-muted);">${docStaff}</div>
                </td>
            `;
            tr.style.cursor = 'pointer';
            tr.addEventListener('click', () => {
                window.location.href = `detail.html?id=${c.case_id}`;
            });
            relatedCasesBody.appendChild(tr);
        });
    }

    function renderOffices(customerId) {
        if (!officesListBody) return;
        const related = offices.filter(o => Number(o.customer_id) === customerId);
        officesListBody.innerHTML = '';

        if (related.length === 0) {
            officesListBody.innerHTML = '<tr><td colspan="4" class="no-data-cell">拠点データがありません</td></tr>';
            return;
        }

        related.forEach(o => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td style="font-weight: 600;">${o.office_name || '-'}</td>
                <td>${o.address || '-'}</td>
                <td>${o.phone || '-'}</td>
                <td><span class="badge ${o.status === 'active' ? 'status-junin' : 'status-torisage'}">${o.status === 'active' ? '有効' : (o.status === 'inactive' ? '無効' : (o.status || '-'))}</span></td>
            `;
            tr.style.cursor = 'pointer';
            tr.addEventListener('click', () => {
                window.location.href = `office_detail.html?customer_id=${customerId}&id=${o.office_id}`;
            });
            officesListBody.appendChild(tr);
        });
    }

    function renderContacts(customerId) {
        if (!contactsListBody) return;
        const related = contacts.filter(c => Number(c.customer_id) === customerId);
        contactsListBody.innerHTML = '';

        if (related.length === 0) {
            contactsListBody.innerHTML = '<tr><td colspan="5" class="no-data-cell">担当者データがありません</td></tr>';
            return;
        }

        related.forEach(c => {
            const officeName = offices.find(o => o.office_id === c.office_id && Number(o.customer_id) === customerId)?.office_name || '-';
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td style="font-weight: 600;">${c.contact_name || '-'}</td>
                <td>${officeName}</td>
                <td>${c.title || '-'}</td>
                <td>${c.phone || '-'}</td>
                <td><span class="badge ${(c.status === 'active' || c.status === '在籍') ? 'status-junin' : 'status-torisage'}">${c.status === 'active' ? '有効' : (c.status === 'inactive' ? '無効' : (c.status || '-'))}</span></td>
            `;
            tr.style.cursor = 'pointer';
            tr.addEventListener('click', () => {
                window.location.href = `contact_detail.html?customer_id=${customerId}&id=${c.contact_id}`;
            });
            contactsListBody.appendChild(tr);
        });
    }

    function renderLicenses(customerId) {
        if (!licensesListBody) return;
        const related = licenses.filter(l => Number(l.customer_id) === customerId);
        licensesListBody.innerHTML = '';

        if (related.length === 0) {
            licensesListBody.innerHTML = '<tr><td colspan="5" class="no-data-cell">許認可データがありません</td></tr>';
            return;
        }

        related.forEach(l => {
            const type = licenseTypes.find(lt => lt.license_type_id === l.license_type_id);
            const typeName = type ? type.license_type_name : (l.license_type || '-');
            const licenseNum = typeof formatLicenseNumber === 'function' ? formatLicenseNumber(l) : (l.license_number || '-');

            // 残り日数（期限まで）
            const days = calculateRemainingDays(l.expiry_date);
            const daysClass = getRemainingDaysClass(days);

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td style="font-weight: 600;">${typeName}</td>
                <td>${licenseNum}</td>
                <td>${l.expiry_date || '-'}</td>
                <td><span class="days-badge ${daysClass}">${formatRemainingDays(days)}</span></td>
                <td><span class="badge ${l.status === '有効' ? 'status-junin' : 'status-torisage'}">${l.status || '-'}</span></td>
            `;
            tr.style.cursor = 'pointer';
            tr.addEventListener('click', () => {
                window.location.href = `license_detail.html?docId=${l._docId}&customer_id=${customerId}&id=${l.license_id}`;
            });
            licensesListBody.appendChild(tr);
        });
    }

    async function handleSave(e) {
        if (e) e.preventDefault();

        let newId;
        const cIdInput = document.getElementById('customer_id');
        if (cIdInput) {
            newId = parseInt(cIdInput.value);
        } else {
            // Fallback for cases where element might be missing or renamed
            newId = parseInt(customerIdParam);
        }

        if (isNaN(newId)) { alert('有効なIDを入力してください'); return; }

        // Helper to safely get values
        const getVal = (id) => {
            const el = document.getElementById(id);
            return el ? el.value.trim() : '';
        };
        const getNum = (id) => {
            const el = document.getElementById(id);
            return el ? (parseInt(el.value) || null) : null;
        };

        const now = new Date().toISOString();
        const updatedCustomer = {
            customer_id: newId,
            customer_name: getVal('customer_name'),
            customer_kana: getVal('customer_kana'),
            customer_type: getVal('customer_type'),
            representative_name: getVal('representative_name'),
            postal_code: getVal('postal_code'),
            address: getVal('address'),
            building_name: getVal('building_name'),
            phone: getVal('phone'),
            fax: getVal('fax'),
            email: getVal('email'),
            status: getVal('status'),
            nenga: getVal('nenga'),
            chugen: getVal('chugen'),
            fax_ok: getVal('fax_ok'),
            remarks: getVal('remarks'),
            fiscal_year_end_month: getNum('fiscal_year_end_month'),
            fiscal_year_end_day: getNum('fiscal_year_end_day'),
            corporate_number: getVal('corporate_number'),
            primary_staff_id: getNum('primary_staff_id'),
            last_updated: now
        };

        try {
            // Debug: 保存直前のデータを表示
            const debugMsg = `保存データの確認:\nID: ${newId}\n名前: ${updatedCustomer.customer_name}\nDocID: cust_${newId}`;
            if (!confirm(debugMsg + '\n\nこの内容で保存しますか？')) return;

            if (customerIdParam === 'new') {
                updatedCustomer.created_date = now;
                await saveToFirestore('customers', `cust_${newId}`, updatedCustomer);
            } else {
                await saveToFirestore('customers', `cust_${newId}`, { ...currentCustomer, ...updatedCustomer });
            }
            showToast('保存しました', 'success');
            // setTimeout(() => window.location.href = 'customer_list.html', 1000); // 一旦コメントアウトして確認
            alert('保存完了しました。OKを押すと一覧に戻ります。');
            window.location.href = 'customer_list.html';
        } catch (err) {
            console.error(err);
            alert('保存失敗: ' + err.message);
        }
    }

    async function handleDelete() {
        if (customerIdParam === 'new') return;
        if (confirm('本当に削除しますか？')) {
            try {
                const cId = parseInt(customerIdParam);
                await deleteFromFirestore('customers', `cust_${cId}`);
                showToast('削除しました', 'success');
                setTimeout(() => window.location.href = 'customer_list.html', 1000);
            } catch (err) { alert('削除失敗'); }
        }
    }

    // --- Export Utility ---
    // HTMLタグを除去してプレーンテキストを返す（Excel/PDF出力用）
    function plainText(val) {
        if (val === undefined || val === null || val === '') return '';
        if (typeof val === 'string' && val.includes('<')) {
            return val.replace(/<[^>]*>/g, '').trim() || '';
        }
        return val;
    }
    // 日付をプレーンテキストで返す（HTML不可のExcel/PDF用）
    function plainDate(dateStr) {
        if (!dateStr || dateStr === 'null') return '';
        if (dateStr && typeof dateStr.toDate === 'function') {
            const d = dateStr.toDate();
            return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
        }
        if (typeof dateStr === 'string') return dateStr.replace(/-/g, '/');
        return '';
    }
    // 許可番号をプレーンテキストで返す
    function plainLicenseNumber(license) {
        if (!license) return '';
        const n1 = license.license_number_1 || '';
        const n2 = license.license_number_2 || '';
        if (!n1 && !n2) return '';
        return `${n1}${n2 ? '-' + n2 : ''}`;
    }

    // --- Export Functions ---
    function buildPrintHTML(data) {
        const staff = staffMembers.find(s => s.staff_id === data.primary_staff_id);
        const staffName = staff ? staff.staff_name : '-';
        const now = new Date().toLocaleString('ja-JP');

        // --- デザイン定数（Excel と統一） ---
        const NAVY = '#1B2A4A';
        const SUB_HEADER = '#3D5A80';
        const LABEL_BG = '#E8ECF0';
        const LIGHT_BG = '#F0F4F8';
        const BORDER = '#B0B8C4';

        const sectionHeader = (title) => `
            <tr><td colspan="6" style="background:${NAVY};color:#fff;font-weight:bold;font-size:13px;padding:6px 10px;border:1px solid ${BORDER};">${title}</td></tr>`;

        const kvRow = (pairs, isAlt) => {
            let html = '<tr>';
            for (let i = 0; i < 6; i += 2) {
                const label = pairs[i] || '';
                const value = pairs[i + 1] || '';
                html += `<td style="background:${LABEL_BG};font-weight:bold;padding:4px 8px;border:1px solid ${BORDER};font-size:11px;width:15%;">${label}</td>`;
                html += `<td style="${isAlt ? 'background:' + LIGHT_BG + ';' : ''}padding:4px 8px;border:1px solid ${BORDER};font-size:11px;width:18%;">${value}</td>`;
            }
            html += '</tr>';
            return html;
        };

        const tableHeader = (headers) => {
            let html = '<tr>';
            headers.forEach(h => {
                html += `<td style="background:${SUB_HEADER};color:#fff;font-weight:bold;text-align:center;padding:4px 8px;border:1px solid ${BORDER};font-size:11px;">${h}</td>`;
            });
            html += '</tr>';
            return html;
        };

        const tableRow = (values, colCount, isAlt) => {
            let html = '<tr>';
            values.forEach(v => {
                html += `<td style="${isAlt ? 'background:' + LIGHT_BG + ';' : ''}padding:4px 8px;border:1px solid ${BORDER};font-size:11px;">${v || '-'}</td>`;
            });
            html += '</tr>';
            return html;
        };

        const emptyRow = (colCount) => `<tr><td colspan="${colCount}" style="text-align:center;color:#999;font-style:italic;padding:4px 8px;border:1px solid ${BORDER};font-size:11px;">なし</td></tr>`;

        // --- 各セクション生成 ---
        // ■ 基本情報
        let basicInfo = sectionHeader('■ 基本情報');
        basicInfo += kvRow(['顧客名', data.customer_name || '-', 'フリガナ', data.customer_kana || '-', '顧客区分', data.customer_type || '-'], false);
        basicInfo += kvRow(['代表者名', data.representative_name || '-', '外務担当', staffName, '状態', data.status || '-'], false);
        basicInfo += kvRow(['法人番号', data.corporate_number || '-', '決算期', `${data.fiscal_year_end_month || '-'}月 ${data.fiscal_year_end_day || '-'}日`, '', ''], false);

        // ■ 連絡先・住所
        let contactInfo = sectionHeader('■ 連絡先・住所');
        // 住所行: D:F結合（住所値を広く表示）
        contactInfo += `<tr>
            <td style="background:${LABEL_BG};font-weight:bold;padding:4px 8px;border:1px solid ${BORDER};font-size:11px;width:15%;">〒</td>
            <td style="padding:4px 8px;border:1px solid ${BORDER};font-size:11px;width:18%;">${data.postal_code || '-'}</td>
            <td style="background:${LABEL_BG};font-weight:bold;padding:4px 8px;border:1px solid ${BORDER};font-size:11px;width:15%;">住所</td>
            <td colspan="3" style="padding:4px 8px;border:1px solid ${BORDER};font-size:11px;">${(data.address || '') + (data.building_name ? ' ' + data.building_name : '') || '-'}</td>
        </tr>`;
        contactInfo += kvRow(['電話番号', data.phone || '-', 'FAX', data.fax || '-', 'メール', data.email || '-'], false);
        contactInfo += kvRow(['年賀状', data.nenga || '-', '中元', data.chugen || '-', 'FAX可否', data.fax_ok || '-'], false);
        // 備考行: B:F結合（備考値を広く表示）
        contactInfo += `<tr>
            <td style="background:${LABEL_BG};font-weight:bold;padding:4px 8px;border:1px solid ${BORDER};font-size:11px;width:15%;">備考</td>
            <td colspan="5" style="padding:4px 8px;border:1px solid ${BORDER};font-size:11px;">${data.remarks || '-'}</td>
        </tr>`;

        // ■ 拠点一覧
        const relatedOffices = offices.filter(o => Number(o.customer_id) === data.customer_id);
        let officeSection = sectionHeader('■ 拠点一覧');
        officeSection += '<tr>' + ['拠点名', '住所', '電話番号'].map(h => `<td colspan="2" style="background:${SUB_HEADER};color:#fff;font-weight:bold;text-align:center;padding:4px 8px;border:1px solid ${BORDER};font-size:11px;">${h}</td>`).join('') + '</tr>';
        if (relatedOffices.length === 0) {
            officeSection += `<tr><td colspan="6" style="text-align:center;color:#999;font-style:italic;padding:4px 8px;border:1px solid ${BORDER};font-size:11px;">なし</td></tr>`;
        } else {
            relatedOffices.forEach((o, idx) => {
                const bg = idx % 2 === 1 ? `background:${LIGHT_BG};` : '';
                officeSection += `<tr><td colspan="2" style="${bg}padding:4px 8px;border:1px solid ${BORDER};font-size:11px;">${o.office_name || '-'}</td><td colspan="2" style="${bg}padding:4px 8px;border:1px solid ${BORDER};font-size:11px;">${o.address || '-'}</td><td colspan="2" style="${bg}padding:4px 8px;border:1px solid ${BORDER};font-size:11px;">${o.phone || '-'}</td></tr>`;
            });
        }

        // ■ 有効な許認可
        const relatedLicenses = licenses.filter(l => l.customer_id === data.customer_id && l.status === '有効');
        let licenseSection = sectionHeader('■ 有効な許認可');
        licenseSection += '<tr>' + ['許認可種別', '許可番号', '有効期限'].map(h => `<td colspan="2" style="background:${SUB_HEADER};color:#fff;font-weight:bold;text-align:center;padding:4px 8px;border:1px solid ${BORDER};font-size:11px;">${h}</td>`).join('') + '</tr>';
        if (relatedLicenses.length === 0) {
            licenseSection += `<tr><td colspan="6" style="text-align:center;color:#999;font-style:italic;padding:4px 8px;border:1px solid ${BORDER};font-size:11px;">なし</td></tr>`;
        } else {
            relatedLicenses.forEach((l, idx) => {
                const type = licenseTypes.find(lt => lt.license_type_id === l.license_type_id);
                const bg = idx % 2 === 1 ? `background:${LIGHT_BG};` : '';
                licenseSection += `<tr><td colspan="2" style="${bg}padding:4px 8px;border:1px solid ${BORDER};font-size:11px;">${type ? type.license_type_name : '-'}</td><td colspan="2" style="${bg}padding:4px 8px;border:1px solid ${BORDER};font-size:11px;">${plainLicenseNumber(l) || '-'}</td><td colspan="2" style="${bg}padding:4px 8px;border:1px solid ${BORDER};font-size:11px;">${plainDate(l.expiry_date) || '-'}</td></tr>`;
            });
        }

        // ■ 担当者一覧
        const relatedContacts = contacts.filter(c => Number(c.customer_id) === data.customer_id);
        let contactSection = sectionHeader('■ 担当者一覧');
        contactSection += '<tr><td style="background:' + SUB_HEADER + ';color:#fff;font-weight:bold;text-align:center;padding:4px 8px;border:1px solid ' + BORDER + ';font-size:11px;">氏名</td><td colspan="2" style="background:' + SUB_HEADER + ';color:#fff;font-weight:bold;text-align:center;padding:4px 8px;border:1px solid ' + BORDER + ';font-size:11px;">所属拠点</td><td style="background:' + SUB_HEADER + ';color:#fff;font-weight:bold;text-align:center;padding:4px 8px;border:1px solid ' + BORDER + ';font-size:11px;">役職</td><td colspan="2" style="background:' + SUB_HEADER + ';color:#fff;font-weight:bold;text-align:center;padding:4px 8px;border:1px solid ' + BORDER + ';font-size:11px;">電話番号</td></tr>';
        if (relatedContacts.length === 0) {
            contactSection += `<tr><td colspan="6" style="text-align:center;color:#999;font-style:italic;padding:4px 8px;border:1px solid ${BORDER};font-size:11px;">なし</td></tr>`;
        } else {
            relatedContacts.forEach((c, idx) => {
                const officeName = offices.find(o => o.office_id === c.office_id && Number(o.customer_id) === data.customer_id)?.office_name || '-';
                const bg = idx % 2 === 1 ? `background:${LIGHT_BG};` : '';
                contactSection += `<tr><td style="${bg}padding:4px 8px;border:1px solid ${BORDER};font-size:11px;">${c.contact_name || '-'}</td><td colspan="2" style="${bg}padding:4px 8px;border:1px solid ${BORDER};font-size:11px;">${officeName}</td><td style="${bg}padding:4px 8px;border:1px solid ${BORDER};font-size:11px;">${c.title || '-'}</td><td colspan="2" style="${bg}padding:4px 8px;border:1px solid ${BORDER};font-size:11px;">${c.phone || '-'}</td></tr>`;
            });
        }

        // ■ 関連案件
        const relatedCases = cases.filter(c => c.customer_id === data.customer_id);
        let caseSection = sectionHeader('■ 関連案件');
        caseSection += '<tr><td style="background:' + SUB_HEADER + ';color:#fff;font-weight:bold;text-align:center;padding:4px 8px;border:1px solid ' + BORDER + ';font-size:11px;">ステータス</td><td colspan="2" style="background:' + SUB_HEADER + ';color:#fff;font-weight:bold;text-align:center;padding:4px 8px;border:1px solid ' + BORDER + ';font-size:11px;">業務内容</td><td style="background:' + SUB_HEADER + ';color:#fff;font-weight:bold;text-align:center;padding:4px 8px;border:1px solid ' + BORDER + ';font-size:11px;">受任日</td><td colspan="2" style="background:' + SUB_HEADER + ';color:#fff;font-weight:bold;text-align:center;padding:4px 8px;border:1px solid ' + BORDER + ';font-size:11px;">完了日</td></tr>';
        if (relatedCases.length === 0) {
            caseSection += `<tr><td colspan="6" style="text-align:center;color:#999;font-style:italic;padding:4px 8px;border:1px solid ${BORDER};font-size:11px;">なし</td></tr>`;
        } else {
            relatedCases.forEach((c, idx) => {
                const bg = idx % 2 === 1 ? `background:${LIGHT_BG};` : '';
                caseSection += `<tr><td style="${bg}padding:4px 8px;border:1px solid ${BORDER};font-size:11px;">${c.status || '-'}</td><td colspan="2" style="${bg}padding:4px 8px;border:1px solid ${BORDER};font-size:11px;">${c.license_type || '-'}</td><td style="${bg}padding:4px 8px;border:1px solid ${BORDER};font-size:11px;">${plainDate(c.contract_date) || '-'}</td><td colspan="2" style="${bg}padding:4px 8px;border:1px solid ${BORDER};font-size:11px;">${plainDate(c.completion_date) || '-'}</td></tr>`;
            });
        }

        // --- 全体HTML ---
        return `
        <div style="padding:30px;font-family:'BIZ UDPGothic','Hiragino Kaku Gothic ProN',sans-serif;color:#333;line-height:1.4;background:#fff;">
            <div style="margin-bottom:12px;">
                <div style="font-size:22px;font-weight:bold;color:${NAVY};margin-bottom:4px;">顧客詳細：${data.customer_name || ''}</div>
                <div style="display:flex;justify-content:space-between;font-size:10px;color:#666;">
                    <span>顧客ID: ${data.customer_id}</span>
                    <span>出力日: ${new Date().toLocaleDateString('ja-JP')}</span>
                </div>
            </div>
            <table style="width:100%;border-collapse:collapse;margin-bottom:8px;">${basicInfo}</table>
            <div style="height:6px;"></div>
            <table style="width:100%;border-collapse:collapse;margin-bottom:8px;">${contactInfo}</table>
            <div style="height:6px;"></div>
            <table style="width:100%;border-collapse:collapse;margin-bottom:8px;">${officeSection}</table>
            <div style="height:6px;"></div>
            <table style="width:100%;border-collapse:collapse;margin-bottom:8px;">${licenseSection}</table>
            <div style="height:6px;"></div>
            <table style="width:100%;border-collapse:collapse;margin-bottom:8px;">${contactSection}</table>
            <div style="height:6px;"></div>
            <table style="width:100%;border-collapse:collapse;margin-bottom:8px;">${caseSection}</table>
            <div style="margin-top:24px;text-align:center;font-size:9px;color:#999;border-top:1px dashed #ccc;padding-top:8px;">LAPIS2 案件管理システム - 顧客詳細出力</div>
        </div>`;
    }

    if (btnExportPdf) {
        btnExportPdf.addEventListener('click', () => {
            if (!currentCustomer) return;
            const element = document.getElementById('print-template');
            element.innerHTML = buildPrintHTML(currentCustomer);
            element.style.display = 'block';
            html2pdf(element, {
                margin: 8,
                filename: `顧客詳細_${currentCustomer.customer_name}_${new Date().toISOString().split('T')[0]}.pdf`,
                image: { type: 'jpeg', quality: 0.98 },
                html2canvas: { scale: 2 },
                jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
            }).then(() => {
                element.style.display = 'none';
            });
        });
    }

    if (btnExportExcel) {
        btnExportExcel.addEventListener('click', async () => {
            if (!currentCustomer) return;
            try {
                btnExportExcel.disabled = true;
                btnExportExcel.textContent = '生成中...';

                const wb = new ExcelJS.Workbook();
                wb.creator = 'LAPIS2';
                const ws = wb.addWorksheet('顧客詳細', {
                    pageSetup: {
                        paperSize: 9, // A4
                        orientation: 'portrait',
                        fitToPage: true,
                        fitToWidth: 1,
                        fitToHeight: 0,
                        margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.4, header: 0.2, footer: 0.2 }
                    }
                });

                // ===== デザイン定数 =====
                const NAVY = '1B2A4A';
                const SUB_HEADER = '3D5A80';
                const LIGHT_BG = 'F0F4F8';
                const LABEL_BG = 'E8ECF0';
                const WHITE = 'FFFFFF';
                const FONT_NAME = 'BIZ UDPゴシック';
                const FONT_SIZE = 11;
                const BORDER_COLOR = 'B0B8C4';

                const thinBorder = {
                    top: { style: 'thin', color: { argb: BORDER_COLOR } },
                    left: { style: 'thin', color: { argb: BORDER_COLOR } },
                    bottom: { style: 'thin', color: { argb: BORDER_COLOR } },
                    right: { style: 'thin', color: { argb: BORDER_COLOR } }
                };
                const shrinkAlign = { vertical: 'middle', shrinkToFit: true };
                const shrinkAlignWrap = { vertical: 'middle', shrinkToFit: true, wrapText: false };

                const headerFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
                const subHeaderFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SUB_HEADER } };
                const labelFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LABEL_BG } };
                const lightFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LIGHT_BG } };
                const headerFont = { name: FONT_NAME, size: FONT_SIZE, bold: true, color: { argb: WHITE } };
                const dataFont = { name: FONT_NAME, size: FONT_SIZE };
                const labelFont = { name: FONT_NAME, size: FONT_SIZE, bold: true };

                // ===== カラム幅設定（A4縦に合わせて6列） =====
                ws.columns = [
                    { width: 14 }, // A: label
                    { width: 22 }, // B: value
                    { width: 14 }, // C: label
                    { width: 22 }, // D: value
                    { width: 14 }, // E: label
                    { width: 22 }, // F: value
                ];

                // ===== ヘルパー関数 =====
                const COLS = ['A', 'B', 'C', 'D', 'E', 'F'];

                function addSectionHeader(ws, row, title) {
                    ws.mergeCells(`A${row}:F${row}`);
                    const cell = ws.getCell(`A${row}`);
                    cell.value = title;
                    cell.font = { name: FONT_NAME, size: FONT_SIZE + 1, bold: true, color: { argb: WHITE } };
                    cell.fill = headerFill;
                    cell.alignment = { vertical: 'middle' };
                    cell.border = thinBorder;
                    COLS.forEach(c => { ws.getCell(`${c}${row}`).fill = headerFill; ws.getCell(`${c}${row}`).border = thinBorder; });
                    ws.getRow(row).height = 26;
                    return row + 1;
                }

                function addKeyValueRow(ws, row, pairs, isAlt) {
                    const r = ws.getRow(row);
                    r.height = 22;
                    for (let i = 0; i < 3; i++) {
                        const lCol = COLS[i * 2];     // A, C, E
                        const vCol = COLS[i * 2 + 1]; // B, D, F
                        const lCell = ws.getCell(`${lCol}${row}`);
                        const vCell = ws.getCell(`${vCol}${row}`);
                        lCell.value = pairs[i * 2] || '';
                        lCell.font = labelFont;
                        lCell.fill = labelFill;
                        lCell.border = thinBorder;
                        lCell.alignment = shrinkAlign;
                        vCell.value = pairs[i * 2 + 1] || '';
                        vCell.font = dataFont;
                        vCell.border = thinBorder;
                        vCell.alignment = shrinkAlign;
                        if (isAlt) vCell.fill = lightFill;
                    }
                    return row + 1;
                }

                function addTableHeader(ws, row, headers, colGroups) {
                    if (colGroups) {
                        colGroups.forEach((cols, i) => {
                            ws.mergeCells(`${cols[0]}${row}:${cols[1]}${row}`);
                            const cell = ws.getCell(`${cols[0]}${row}`);
                            cell.value = headers[i];
                            cell.font = { ...headerFont, size: FONT_SIZE };
                            cell.fill = subHeaderFill;
                            cell.border = thinBorder;
                            cell.alignment = { ...shrinkAlign, horizontal: 'center' };
                            ws.getCell(`${cols[1]}${row}`).border = thinBorder;
                            ws.getCell(`${cols[1]}${row}`).fill = subHeaderFill;
                        });
                    } else {
                        headers.forEach((h, i) => {
                            const cell = ws.getCell(`${COLS[i]}${row}`);
                            cell.value = h;
                            cell.font = { ...headerFont, size: FONT_SIZE };
                            cell.fill = subHeaderFill;
                            cell.border = thinBorder;
                            cell.alignment = { ...shrinkAlign, horizontal: 'center' };
                        });
                    }
                    ws.getRow(row).height = 22;
                    return row + 1;
                }

                function addTableRow(ws, row, values, colGroups, isAlt) {
                    if (colGroups) {
                        colGroups.forEach((cols, i) => {
                            ws.mergeCells(`${cols[0]}${row}:${cols[1]}${row}`);
                            const cell = ws.getCell(`${cols[0]}${row}`);
                            cell.value = values[i] || '-';
                            cell.font = dataFont;
                            cell.border = thinBorder;
                            cell.alignment = shrinkAlign;
                            if (isAlt) cell.fill = lightFill;
                            ws.getCell(`${cols[1]}${row}`).border = thinBorder;
                            if (isAlt) ws.getCell(`${cols[1]}${row}`).fill = lightFill;
                        });
                    } else {
                        values.forEach((v, i) => {
                            const cell = ws.getCell(`${COLS[i]}${row}`);
                            cell.value = v || '-';
                            cell.font = dataFont;
                            cell.border = thinBorder;
                            cell.alignment = shrinkAlign;
                            if (isAlt) cell.fill = lightFill;
                        });
                    }
                    ws.getRow(row).height = 20;
                    return row + 1;
                }

                function addEmptyRow(ws, row, msg) {
                    ws.mergeCells(`A${row}:F${row}`);
                    const cell = ws.getCell(`A${row}`);
                    cell.value = msg || 'なし';
                    cell.font = { ...dataFont, italic: true, color: { argb: '999999' } };
                    cell.border = thinBorder;
                    cell.alignment = { ...shrinkAlign, horizontal: 'center' };
                    ws.getRow(row).height = 20;
                    return row + 1;
                }

                let row = 1;

                // ===== タイトル =====
                ws.mergeCells(`A${row}:F${row}`);
                const titleCell = ws.getCell(`A${row}`);
                titleCell.value = `顧客詳細：${currentCustomer.customer_name || ''}`;
                titleCell.font = { name: FONT_NAME, size: 18, bold: true, color: { argb: NAVY } };
                titleCell.alignment = shrinkAlign;
                ws.getRow(row).height = 32;
                row++;

                // 出力日・顧客ID行
                ws.mergeCells(`A${row}:C${row}`);
                ws.getCell(`A${row}`).value = `顧客ID: ${currentCustomer.customer_id}`;
                ws.getCell(`A${row}`).font = { name: FONT_NAME, size: 10, color: { argb: '666666' } };
                ws.getCell(`A${row}`).alignment = shrinkAlign;
                ws.mergeCells(`D${row}:F${row}`);
                ws.getCell(`D${row}`).value = `出力日: ${new Date().toLocaleDateString('ja-JP')}`;
                ws.getCell(`D${row}`).font = { name: FONT_NAME, size: 10, color: { argb: '666666' } };
                ws.getCell(`D${row}`).alignment = { ...shrinkAlign, horizontal: 'right' };
                ws.getRow(row).height = 18;
                row += 2;

                // ===== ■ 基本情報 =====
                const staff = staffMembers.find(s => s.staff_id === currentCustomer.primary_staff_id);
                row = addSectionHeader(ws, row, '■ 基本情報');
                row = addKeyValueRow(ws, row, ['顧客名', currentCustomer.customer_name || '-', 'フリガナ', currentCustomer.customer_kana || '-', '顧客区分', currentCustomer.customer_type || '-'], false);
                row = addKeyValueRow(ws, row, ['代表者名', currentCustomer.representative_name || '-', '外務担当', staff ? staff.staff_name : '-', '状態', currentCustomer.status || '-'], false);
                row = addKeyValueRow(ws, row, ['法人番号', currentCustomer.corporate_number || '-', '決算期', `${currentCustomer.fiscal_year_end_month || '-'}月 ${currentCustomer.fiscal_year_end_day || '-'}日`, '', ''], false);
                row++;

                // ===== ■ 連絡先・住所 =====
                row = addSectionHeader(ws, row, '■ 連絡先・住所');
                // 住所行: D:F結合（住所値を広く表示）
                const addrRow = row;
                row = addKeyValueRow(ws, row, ['〒', currentCustomer.postal_code || '-', '住所', (currentCustomer.address || '') + (currentCustomer.building_name ? ' ' + currentCustomer.building_name : ''), '', ''], false);
                // E,Fのラベル/値をクリアしてD:Fを結合
                ws.getCell(`E${addrRow}`).value = '';
                ws.getCell(`E${addrRow}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF' } };
                ws.getCell(`F${addrRow}`).value = '';
                ws.getCell(`F${addrRow}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF' } };
                ws.mergeCells(`D${addrRow}:F${addrRow}`);
                ws.getCell(`D${addrRow}`).border = thinBorder;
                ws.getCell(`D${addrRow}`).alignment = shrinkAlign;

                row = addKeyValueRow(ws, row, ['電話番号', currentCustomer.phone || '-', 'FAX', currentCustomer.fax || '-', 'メール', currentCustomer.email || '-'], false);
                row = addKeyValueRow(ws, row, ['年賀状', currentCustomer.nenga || '-', '中元', currentCustomer.chugen || '-', 'FAX可否', currentCustomer.fax_ok || '-'], false);

                // 備考行: B:F結合（備考値を広く表示）
                const remarksRow = row;
                row = addKeyValueRow(ws, row, ['備考', currentCustomer.remarks || '-', '', '', '', ''], false);
                // C-Fのラベル/値をクリアしてB:Fを結合
                ['C', 'D', 'E', 'F'].forEach(c => {
                    ws.getCell(`${c}${remarksRow}`).value = '';
                    ws.getCell(`${c}${remarksRow}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF' } };
                });
                ws.mergeCells(`B${remarksRow}:F${remarksRow}`);
                ws.getCell(`B${remarksRow}`).value = currentCustomer.remarks || '-';
                ws.getCell(`B${remarksRow}`).font = dataFont;
                ws.getCell(`B${remarksRow}`).border = thinBorder;
                ws.getCell(`B${remarksRow}`).alignment = shrinkAlign;
                row++;

                // ===== ■ 拠点一覧 =====
                row = addSectionHeader(ws, row, '■ 拠点一覧');
                const officeColGroups = [['A', 'B'], ['C', 'D'], ['E', 'F']];
                row = addTableHeader(ws, row, ['拠点名', '住所', '電話番号'], officeColGroups);

                const relatedOffices = offices.filter(o => Number(o.customer_id) === currentCustomer.customer_id);
                if (relatedOffices.length === 0) {
                    row = addEmptyRow(ws, row);
                } else {
                    relatedOffices.forEach((o, idx) => {
                        row = addTableRow(ws, row, [o.office_name, o.address, o.phone], officeColGroups, idx % 2 === 1);
                    });
                }
                row++;

                // ===== ■ 有効な許認可 =====
                row = addSectionHeader(ws, row, '■ 有効な許認可');
                const licColGroups = [['A', 'B'], ['C', 'D'], ['E', 'F']];
                row = addTableHeader(ws, row, ['許認可種別', '許可番号', '有効期限'], licColGroups);

                const relatedLicenses = licenses.filter(l => l.customer_id === currentCustomer.customer_id && l.status === '有効');
                if (relatedLicenses.length === 0) {
                    row = addEmptyRow(ws, row);
                } else {
                    relatedLicenses.forEach((l, idx) => {
                        const type = licenseTypes.find(lt => lt.license_type_id === l.license_type_id);
                        const licNum = plainLicenseNumber(l) || '-';
                        const expiry = plainDate(l.expiry_date) || '-';
                        row = addTableRow(ws, row, [type ? type.license_type_name : '-', licNum, expiry], licColGroups, idx % 2 === 1);
                    });
                }
                row++;

                // ===== ■ 担当者一覧 =====
                row = addSectionHeader(ws, row, '■ 担当者一覧');
                row = addTableHeader(ws, row, ['氏名', '所属拠点', '役職', '電話番号'], [['A', 'A'], ['B', 'C'], ['D', 'D'], ['E', 'F']]);

                const relatedContacts = contacts.filter(c => Number(c.customer_id) === currentCustomer.customer_id);
                if (relatedContacts.length === 0) {
                    row = addEmptyRow(ws, row);
                } else {
                    relatedContacts.forEach((c, idx) => {
                        const officeName = offices.find(o => o.office_id === c.office_id && Number(o.customer_id) === currentCustomer.customer_id)?.office_name || '-';
                        row = addTableRow(ws, row, [c.contact_name, officeName, c.title, c.phone], [['A', 'A'], ['B', 'C'], ['D', 'D'], ['E', 'F']], idx % 2 === 1);
                    });
                }
                row++;

                // ===== ■ 関連案件 =====
                row = addSectionHeader(ws, row, '■ 関連案件');
                row = addTableHeader(ws, row, ['ステータス', '業務内容', '受任日', '完了日'], [['A', 'A'], ['B', 'C'], ['D', 'D'], ['E', 'F']]);

                const relatedCases = cases.filter(c => c.customer_id === currentCustomer.customer_id);
                if (relatedCases.length === 0) {
                    row = addEmptyRow(ws, row);
                } else {
                    relatedCases.forEach((c, idx) => {
                        const contractDate = plainDate(c.contract_date) || '-';
                        const completionDate = plainDate(c.completion_date) || '-';
                        row = addTableRow(ws, row, [c.status, c.license_type, contractDate, completionDate], [['A', 'A'], ['B', 'C'], ['D', 'D'], ['E', 'F']], idx % 2 === 1);
                    });
                }

                // ===== ファイル保存 =====
                const buffer = await wb.xlsx.writeBuffer();
                const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
                saveAs(blob, `顧客詳細_${currentCustomer.customer_name}_${new Date().toISOString().split('T')[0]}.xlsx`);

            } catch (err) {
                console.error('Excel export failed:', err);
                alert('Excel出力に失敗しました: ' + err.message);
            } finally {
                btnExportExcel.disabled = false;
                btnExportExcel.innerHTML = '<span>📊</span> Excel出力';
            }
        });
    }

    form.addEventListener('submit', handleSave);

    // Explicitly attach to header save button to ensure it works
    const btnHeaderSave = document.querySelector('button[form="customer-form"]');
    if (btnHeaderSave) {
        btnHeaderSave.addEventListener('click', handleSave);
    }

    if (btnDelete) btnDelete.addEventListener('click', handleDelete);
    [btnBack, btnBackTop].forEach(btn => btn?.addEventListener('click', () => { if (confirm('戻りますか？')) window.location.href = 'customer_list.html'; }));

    // Buttons for adding related data (Ensure CIDs are passed)
    document.getElementById('btn-add-office')?.addEventListener('click', () => {
        if (!customerIdParam || customerIdParam === 'new') { alert('先に顧客情報を保存してください'); return; }
        window.location.href = `office_detail.html?customer_id=${customerIdParam}&id=new`;
    });
    document.getElementById('btn-add-contact')?.addEventListener('click', () => {
        if (!customerIdParam || customerIdParam === 'new') { alert('先に顧客情報を保存してください'); return; }
        window.location.href = `contact_detail.html?customer_id=${customerIdParam}&id=new`;
    });
    document.getElementById('btn-add-license')?.addEventListener('click', () => {
        if (!customerIdParam || customerIdParam === 'new') { alert('先に顧客情報を保存してください'); return; }
        window.location.href = `license_detail.html?customer_id=${customerIdParam}&id=new`;
    });
    document.getElementById('btn-add-related-case')?.addEventListener('click', () => {
        if (!customerIdParam || customerIdParam === 'new') { alert('先に顧客情報を保存してください'); return; }
        window.location.href = `detail.html?customer_id=${customerIdParam}&id=new`;
    });

    // --- Postal code address lookup ---
    const btnLookupZip = document.getElementById('btn-lookup-zip');
    const postalCodeInput = document.getElementById('postal_code');
    if (btnLookupZip && postalCodeInput) {
        btnLookupZip.addEventListener('click', async () => {
            const zip = postalCodeInput.value.trim().replace(/-/g, '');
            if (!/^\d{7}$/.test(zip)) {
                alert('7桁の郵便番号を入力してください（例：1234567）');
                return;
            }
            try {
                const response = await fetch(`https://zipcloud.ibsnet.co.jp/api/search?zipcode=${zip}`);
                const data = await response.json();
                if (data.status === 200 && data.results) {
                    const result = data.results[0];
                    const addr = result.address1 + result.address2 + result.address3;
                    document.getElementById('address').value = addr;
                    showToast('住所を入力しました', 'success');
                } else {
                    alert('該当する住所が見つかりませんでした。');
                }
            } catch (error) {
                console.error('ZipCloud API Error:', error);
                alert('住所の取得に失敗しました。');
            }
        });
    }

    await init();
});
