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
                licenses = licensesSnap.docs.map(d => d.data());

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
                .filter(s => s.status === '有効')
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
                <td><span class="badge ${o.status === '有効' ? 'status-junin' : 'status-torisage'}">${o.status || '-'}</span></td>
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
                <td><span class="badge ${c.status === '有効' ? 'status-junin' : 'status-torisage'}">${c.status || '-'}</span></td>
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
                window.location.href = `license_detail.html?customer_id=${customerId}&id=${l.license_id}`;
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

    // --- Export Functions ---
    function populatePrintTemplate(data) {
        // Basic Info
        document.getElementById('print-now').textContent = new Date().toLocaleString();
        document.getElementById('p-customer-name').textContent = data.customer_name || '-';
        document.getElementById('p-customer-kana').textContent = data.customer_kana || '-';
        document.getElementById('p-rep-name').textContent = data.representative_name || '-';
        document.getElementById('p-corporate-number').textContent = data.corporate_number || '-';
        document.getElementById('p-fiscal').textContent = `${data.fiscal_year_end_month || '-'}月 ${data.fiscal_year_end_day || '-'}日`;

        const staff = staffMembers.find(s => s.staff_id === data.primary_staff_id);
        document.getElementById('p-primary-staff').textContent = staff ? staff.staff_name : '-';

        document.getElementById('p-customer-id').textContent = data.customer_id;
        document.getElementById('p-type').textContent = data.customer_type;
        document.getElementById('p-zip').textContent = data.postal_code || '-';
        document.getElementById('p-address').textContent = (data.address || '') + (data.building_name ? ' ' + data.building_name : '');
        document.getElementById('p-phone').textContent = data.phone || '-';
        document.getElementById('p-main-fax').textContent = data.fax || '-';
        document.getElementById('p-email').textContent = data.email || '-';
        document.getElementById('p-status').textContent = data.status || '-';
        document.getElementById('p-nenga').textContent = data.nenga || '-';
        document.getElementById('p-chugen').textContent = data.chugen || '-';
        document.getElementById('p-fax-ok').textContent = data.fax_ok || '-';
        document.getElementById('p-remarks').textContent = data.remarks || '-';

        // Lists
        const pOffices = document.getElementById('p-offices-body');
        const relatedOffices = offices.filter(o => o.customer_id === data.customer_id);
        pOffices.innerHTML = relatedOffices.map(o => `<tr><td style="border:1px solid #ddd;padding:6px;">${o.office_name}</td><td style="border:1px solid #ddd;padding:6px;">${o.address || '-'}</td><td style="border:1px solid #ddd;padding:6px;">${o.phone || '-'}</td></tr>`).join('') || '<tr><td colspan="3" style="border:1px solid #ddd;padding:6px;">なし</td></tr>';

        const pLicenses = document.getElementById('p-licenses-body');
        const relatedLicenses = licenses.filter(l => l.customer_id === data.customer_id && l.status === '有効');
        pLicenses.innerHTML = relatedLicenses.map(l => {
            const type = licenseTypes.find(lt => lt.license_type_id === l.license_type_id);
            return `<tr><td style="border:1px solid #ddd;padding:6px;">${type ? type.license_type_name : '-'}</td><td style="border:1px solid #ddd;padding:6px;">${formatLicenseNumber(l)}</td><td style="border:1px solid #ddd;padding:6px;">${formatDate(l.expiry_date)}</td></tr>`;
        }).join('') || '<tr><td colspan="3" style="border:1px solid #ddd;padding:6px;">なし</td></tr>';

        const pContacts = document.getElementById('p-contacts-body');
        const relatedContacts = contacts.filter(c => c.customer_id === data.customer_id);
        pContacts.innerHTML = relatedContacts.map(c => `<tr><td style="border:1px solid #ddd;padding:6px;">${c.contact_name}</td><td style="border:1px solid #ddd;padding:6px;">-</td><td style="border:1px solid #ddd;padding:6px;">${c.title || '-'}</td><td style="border:1px solid #ddd;padding:6px;">${c.phone || '-'}</td></tr>`).join('') || '<tr><td colspan="4" style="border:1px solid #ddd;padding:6px;">なし</td></tr>';

        const pCases = document.getElementById('p-cases-body');
        const relatedCasesList = cases.filter(c => c.customer_id === data.customer_id);
        pCases.innerHTML = relatedCasesList.map(c => `<tr><td style="border:1px solid #ddd;padding:6px;">${c.status}</td><td style="border:1px solid #ddd;padding:6px;">${c.license_type}</td><td style="border:1px solid #ddd;padding:6px;">${formatDate(c.contract_date)}</td><td style="border:1px solid #ddd;padding:6px;">-</td></tr>`).join('') || '<tr><td colspan="4" style="border:1px solid #ddd;padding:6px;">なし</td></tr>';
    }

    if (btnExportPdf) {
        btnExportPdf.addEventListener('click', () => {
            if (!currentCustomer) return;
            populatePrintTemplate(currentCustomer);
            const element = document.getElementById('print-template');
            element.style.display = 'block'; // Make visible for capture
            html2pdf(element, {
                margin: 10,
                filename: `顧客情報_${currentCustomer.customer_name}_${new Date().toISOString().split('T')[0]}.pdf`,
                image: { type: 'jpeg', quality: 0.98 },
                html2canvas: { scale: 2 },
                jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
            }).then(() => {
                element.style.display = 'none'; // Hide again
            });
        });
    }

    if (btnExportExcel) {
        btnExportExcel.addEventListener('click', () => {
            if (!currentCustomer) return;
            // Prepare Data
            const id = currentCustomer.customer_id;
            const wb = XLSX.utils.book_new();

            // 1. Basic Info
            const basicData = [[
                "顧客ID", "顧客名", "顧客区分", "代表者名", "郵便番号", "住所", "電話番号", "FAX", "メール", "状態"
            ], [
                id, currentCustomer.customer_name, currentCustomer.customer_type, currentCustomer.representative_name,
                currentCustomer.postal_code, (currentCustomer.address || '') + (currentCustomer.building_name || ''),
                currentCustomer.phone, currentCustomer.fax, currentCustomer.email, currentCustomer.status
            ]];
            const ws1 = XLSX.utils.aoa_to_sheet(basicData);
            XLSX.utils.book_append_sheet(wb, ws1, "基本情報");

            // 2. Licenses
            const relLicenses = licenses.filter(l => l.customer_id === id).map(l => {
                const type = licenseTypes.find(lt => lt.license_type_id === l.license_type_id);
                return {
                    "許認可種別": type ? type.license_type_name : '-',
                    "許可番号": formatLicenseNumber(l),
                    "有効期限": l.expiry_date,
                    "状態": l.status
                };
            });
            if (relLicenses.length) {
                const ws2 = XLSX.utils.json_to_sheet(relLicenses);
                XLSX.utils.book_append_sheet(wb, ws2, "許認可");
            }

            // 3. Cases
            const relCases = cases.filter(c => c.customer_id === id).map(c => ({
                "案件ID": c.case_id,
                "業務内容": c.license_type,
                "ステータス": c.status,
                "受任日": c.contract_date,
                "完了日": c.completion_date
            }));
            if (relCases.length) {
                const ws3 = XLSX.utils.json_to_sheet(relCases);
                XLSX.utils.book_append_sheet(wb, ws3, "関連案件");
            }

            XLSX.writeFile(wb, `顧客台帳_${currentCustomer.customer_name}_${new Date().toISOString().split('T')[0]}.xlsx`);
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
