document.addEventListener('DOMContentLoaded', () => {
    // --- Selectors ---
    const washoutListBody = document.getElementById('license-list-body');
    const filterLicenseType = document.getElementById('filter-license-type');
    const filterFiscalMonth = document.getElementById('filter-fiscal-month');
    const filterStaff = document.getElementById('filter-staff');
    const filterSearch = document.getElementById('filter-search'); // Was filter-remarks
    const btnSearch = document.getElementById('btn-search-execute');
    const btnReset = document.getElementById('btn-reset-filters');
    const btnExport = document.getElementById('btn-export-excel');
    const btnExportPdf = document.getElementById('btn-export-pdf');
    const countDisplay = document.getElementById('count-display');
    const initialMessage = document.getElementById('initial-message');
    const tableWrapper = document.getElementById('table-wrapper');

    let staffMembers = [];
    let governmentOffices = [];
    let licenseTypes = [];
    let filteredData = [];

    // --- Functions ---

    // 初期化：マスタデータのロード
    async function init() {
        try {

            // マスタデータの並列取得
            const [staffData, officeData, typeData] = await Promise.all([
                getAllFromFirestore('staff'),
                getAllFromFirestore('government_offices'),
                getAllFromFirestore('license_types')
            ]);

            staffMembers = staffData;
            governmentOffices = officeData;
            licenseTypes = typeData;

            console.log(`Debug: Staff loaded: ${staffMembers.length}`);
            console.log(`Debug: Offices loaded: ${governmentOffices.length}`);
            console.log(`Debug: Types loaded: ${licenseTypes.length}`);

            if (staffMembers.length > 0) console.log('Sample Staff:', staffMembers[0]);
            if (licenseTypes.length > 0) console.log('Sample Type:', licenseTypes[0]);

            renderLicenseTypeOptions();
            renderFiscalMonthOptions();
            renderStaffOptions();

            // 初期表示はメッセージのみ（検索待ち）
            initialMessage.style.display = 'block';
            tableWrapper.style.display = 'none';

        } catch (error) {
            console.error('Initialization failed:', error);
            alert('マスタデータの読み込みに失敗しました。');
        }
    }

    function renderLicenseTypeOptions() {
        // sort_order順（同じ場合は名前順）でソート
        // Relaxed filter: Show if '有効' OR 'active' OR status is missing
        const activeTypes = licenseTypes.filter(lt => lt.status === '有効' || lt.status === 'active' || !lt.status);
        activeTypes.sort((a, b) => {
            const orderA = a.sort_order !== undefined ? a.sort_order : 999;
            const orderB = b.sort_order !== undefined ? b.sort_order : 999;
            if (orderA !== orderB) return orderA - orderB;
            return a.license_type_name.localeCompare(b.license_type_name, 'ja');
        });

        filterLicenseType.innerHTML = '<option value="">すべて</option>';
        // 種別名の重複を除去しつつ追加
        const addedNames = new Set();
        activeTypes.forEach(lt => {
            if (lt.license_type_name && !addedNames.has(lt.license_type_name)) {
                const opt = document.createElement('option');
                opt.value = lt.license_type_name; // 名称でフィルタリングするため
                opt.textContent = lt.license_type_name;
                filterLicenseType.appendChild(opt);
                addedNames.add(lt.license_type_name);
            }
        });
    }

    function renderFiscalMonthOptions() {
        filterFiscalMonth.innerHTML = '<option value="">選択してください</option>';
        for (let i = 1; i <= 12; i++) {
            const opt = document.createElement('option');
            opt.value = i;
            opt.textContent = `${i}月`;
            filterFiscalMonth.appendChild(opt);
        }
    }

    function renderStaffOptions() {
        filterStaff.innerHTML = '<option value="">すべて</option>';
        // staff_id順に表示
        // Relaxed filter: Show if '在籍' OR 'active' OR status is missing
        const activeStaff = staffMembers.filter(s => s.status === '在籍' || s.status === 'active' || !s.status)
            .sort((a, b) => (a.staff_id || 0) - (b.staff_id || 0));

        activeStaff.forEach(s => {
            if (s.staff_name) {
                const opt = document.createElement('option');
                opt.value = s.staff_id;
                opt.textContent = s.staff_name;
                filterStaff.appendChild(opt);
            }
        });
    }

    // 検索実行（Firestoreからデータを取得）
    async function searchData() {
        const fmVal = filterFiscalMonth.value;
        const ltVal = filterLicenseType.value;
        const stVal = filterStaff.value;
        const searchVal = filterSearch ? filterSearch.value.trim().toLowerCase() : '';

        // 決算月が未選択の場合、処理を中断してメッセージを表示
        if (fmVal === "") {
            initialMessage.style.display = 'block';
            initialMessage.textContent = '決算月を選択してください';
            tableWrapper.style.display = 'none';
            countDisplay.innerText = '表示件数：0件';
            washoutListBody.innerHTML = '';
            filteredData = [];
            return;
        }

        // UI Loading
        initialMessage.style.display = 'block';
        initialMessage.textContent = 'データを検索中...';
        tableWrapper.style.display = 'none';
        washoutListBody.innerHTML = '';

        try {
            // 1. 顧客の検索 (決算月でフィルタ)
            // Compat Syntax: db.collection(...)
            let customersRef = db.collection('customers');

            const monthNum = parseInt(fmVal);
            // 数値と文字列の両方で検索する (データの揺らぎ対策)
            const customersSnapshot = await customersRef.where('fiscal_year_end_month', 'in', [monthNum, String(monthNum)]).get();

            const customers = [];
            customersSnapshot.forEach(doc => {
                customers.push(doc.data());
            });

            if (customers.length === 0) {
                finishSearch([], fmVal);
                return;
            }

            // 2. 該当顧客の許認可を取得
            // 顧客IDのリストを作成
            const customerIds = customers.map(c => c.customer_id);

            // Firestoreの 'in' クエリは最大30件まで。顧客数が多い場合は分割処理が必要。
            let licenses = [];
            const chunkSize = 30;
            const chunks = [];
            for (let i = 0; i < customerIds.length; i += chunkSize) {
                chunks.push(customerIds.slice(i, i + chunkSize));
            }

            const licensePromises = chunks.map(chunkIds => {
                // Compat Syntax: db.collection(...).where(...)
                return db.collection('customer_licenses').where('customer_id', 'in', chunkIds).get();
            });

            const licenseSnapshots = await Promise.all(licensePromises);
            licenseSnapshots.forEach(snap => {
                snap.forEach(doc => {
                    const lic = doc.data();
                    if (lic.status === '有効' || lic.status === 'active') { // 有効な許認可のみ
                        licenses.push(lic);
                    }
                });
            });

            // 3. データ結合 (Join)
            const joinedData = licenses.map(lic => {
                const customer = customers.find(c => c.customer_id === lic.customer_id);
                const lType = licenseTypes.find(lt => lt.license_type_id === lic.license_type_id);
                const staff = customer ? staffMembers.find(s => s.staff_id === customer.primary_staff_id) : null;
                const office = lic.government_office_id
                    ? governmentOffices.find(o => o.office_id === lic.government_office_id)
                    : null;
                const officeName = office ? office.office_name : (lic.government_office || '-');

                return {
                    license: lic,
                    customer: customer,
                    licenseType: lType,
                    staff: staff,
                    officeName: officeName
                };
            });

            // 4. クライアントサイドフィルタ (種別、担当者、キーワード)
            const finalData = joinedData.filter(item => {
                if (!item.customer) return false;
                if (ltVal !== "" && (!item.licenseType || item.licenseType.license_type_name !== ltVal)) return false;
                if (stVal !== "" && String(item.customer.primary_staff_id) !== stVal) return false;

                if (searchVal !== "") {
                    const custName = (item.customer.customer_name || '').toLowerCase();
                    // const ceoName = (item.customer.ceo_name || '').toLowerCase(); // User requested to exclude CEO from search
                    const remarks = (item.customer.remarks || '').toLowerCase();
                    // Search by Customer Name (Company) or Remarks
                    if (!custName.includes(searchVal) && !remarks.includes(searchVal)) {
                        return false;
                    }
                }
                return true;
            });

            // ソート
            finalData.sort((a, b) => {
                // 決算月・日は同じ（フィルタ済み）なので、顧客名順などで
                return a.customer.customer_name.localeCompare(b.customer.customer_name, 'ja');
            });

            filteredData = finalData;
            finishSearch(filteredData, fmVal);

        } catch (error) {
            console.error('Search failed:', error);
            initialMessage.textContent = 'データの検索中にエラーが発生しました: ' + error.message;
            alert('検索に失敗しました: ' + error.message);
        }
    }

    function finishSearch(data, fmVal) {
        initialMessage.style.display = 'none';
        tableWrapper.style.display = 'block';
        renderTable(data, fmVal);
    }

    function renderTable(data, fmVal) {
        washoutListBody.innerHTML = '';
        const monthLabel = `${fmVal}月決算`;
        countDisplay.textContent = `表示件数：${data.length}件（${monthLabel}）`;

        if (data.length === 0) {
            washoutListBody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding: 20px;">該当するデータはありません。</td></tr>';
            return;
        }

        data.forEach(item => {
            const row = document.createElement('tr');
            // Remove row click event to allow individual links
            // row.style.cursor = 'pointer';
            // row.addEventListener('click', ...);

            const fiscalText = (item.customer.fiscal_year_end_month && item.customer.fiscal_year_end_day)
                ? `${item.customer.fiscal_year_end_month}/${item.customer.fiscal_year_end_day}`
                : '-';

            const licenseName = item.licenseType ? item.licenseType.license_type_name : '不明';
            const licenseNo = formatLicenseNumber(item.license);
            const expiry = formatDate(item.license.expiry_date);

            // 担当者名
            const staffName = item.staff ? item.staff.staff_name : '<span style="color: #94a3b8;">(担当未設定)</span>';

            // 備考の切り詰め (最初の20文字)
            const remarksFull = item.customer.remarks || '';
            const remarksDisplay = remarksFull.length > 20 ? remarksFull.substring(0, 20) + '...' : (remarksFull || '-');

            // HTML Headers: Customer, Fiscal, License, Expiry, Staff, Remarks
            // Note: Representative Name removed. Remarks added at end.
            // Links added to Customer Name and License Type
            row.innerHTML = `
                <td>
                    <a href="customer_detail.html?id=${item.customer.customer_id}" style="text-decoration: none; color: #0d6efd; font-weight: bold;">
                        ${item.customer.customer_name}
                    </a>
                </td>
                <td style="font-weight: 500;">${fiscalText}</td>
                <td>
                    <a href="license_detail.html?id=${item.license.license_id}" style="text-decoration: none; color: #0d6efd;">
                        <div>${licenseName}</div>
                    </a>
                    <div style="font-size: 0.75rem; color: #64748b; margin-top: 2px;">
                        [${item.officeName}] ${licenseNo}
                    </div>
                </td>
                <td>${expiry}</td>
                <td>${staffName}</td>
                <td style="font-size: 0.85rem; color: #64748b;" title="${remarksFull}">${remarksDisplay}</td>
            `;
            washoutListBody.appendChild(row);
        });
    }

    // ============================================================
    // Excel出力（ExcelJS + FileSaver.js）
    // ============================================================

    // --- 定数: Excel書式設定 ---
    const EXCEL_FONT_NAME = 'BIZ UDゴシック';
    const EXCEL_FONT_SIZE = 14;
    const EXCEL_ROW_HEIGHT = 27;
    const EXCEL_HEADER_BG = 'FFD3D3D3'; // 薄いグレー (ARGB)

    // 列定義: [ヘッダー名, 列幅]
    const EXCEL_COLUMNS = [
        { header: '顧客名', width: 35 },
        { header: '外務担当者', width: 15 },
        { header: '決算期', width: 10 },
        { header: '許認可種別', width: 35 },
        { header: '許可番号', width: 40 },
        { header: '満了日', width: 15 },
        { header: '顧客備考', width: 40 },
    ];

    /**
     * 格子罫線（Thin）を生成する
     */
    function createThinBorder() {
        const thinStyle = { style: 'thin' };
        return {
            top: thinStyle,
            left: thinStyle,
            bottom: thinStyle,
            right: thinStyle,
        };
    }

    /**
     * セルに共通書式（フォント・罫線・配置）を適用する
     */
    function applyBaseStyle(cell, isBold = false) {
        // フォント: BIZ UDゴシック, サイズ 14
        cell.font = {
            name: EXCEL_FONT_NAME,
            size: EXCEL_FONT_SIZE,
            bold: isBold,
        };
        // 罫線: 格子（Thin）
        cell.border = createThinBorder();
        // 配置: 上下中央
        cell.alignment = { vertical: 'middle' };
    }

    /**
     * ヘッダー行に書式を適用する（背景色 + 上下左右中央揃え）
     */
    function applyHeaderStyle(cell) {
        applyBaseStyle(cell, true);
        // 背景色: 薄いグレー
        cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: EXCEL_HEADER_BG },
        };
        // 配置: 上下左右中央揃え
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
    }

    /**
     * ExcelJS を使用して書式付き .xlsx を生成・ダウンロードする
     */
    async function exportExcel() {
        if (filteredData.length === 0) {
            alert('出力するデータがありません。');
            return;
        }

        // --- ワークブック & シート作成 ---
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('決算期別一覧');

        // --- 列幅の設定 ---
        worksheet.columns = EXCEL_COLUMNS.map(col => ({
            header: col.header,
            width: col.width,
        }));

        // --- ヘッダー行（1行目）の書式設定 ---
        const headerRow = worksheet.getRow(1);
        headerRow.height = EXCEL_ROW_HEIGHT;
        headerRow.eachCell((cell) => {
            applyHeaderStyle(cell);
        });

        // --- データ行の追加と書式設定 ---
        filteredData.forEach(item => {
            const fiscalText = (item.customer.fiscal_year_end_month && item.customer.fiscal_year_end_day)
                ? `${item.customer.fiscal_year_end_month}/${item.customer.fiscal_year_end_day}`
                : '-';

            const rowData = [
                item.customer.customer_name,
                item.staff ? item.staff.staff_name : '',
                fiscalText,
                item.licenseType ? item.licenseType.license_type_name : '',
                `[${item.officeName}] ${formatLicenseNumber(item.license)}`,
                item.license.expiry_date || '',
                item.customer.remarks || '',
            ];

            const dataRow = worksheet.addRow(rowData);

            // 行の高さ: 27
            dataRow.height = EXCEL_ROW_HEIGHT;

            // 各セルに書式を適用
            dataRow.eachCell({ includeEmpty: true }, (cell) => {
                applyBaseStyle(cell, false);
            });
        });

        // --- 空セルにも罫線を適用（列数が足りない行への対応）---
        const totalCols = EXCEL_COLUMNS.length;
        worksheet.eachRow((row) => {
            for (let col = 1; col <= totalCols; col++) {
                const cell = row.getCell(col);
                if (!cell.border) {
                    applyBaseStyle(cell, row.number === 1);
                    if (row.number === 1) applyHeaderStyle(cell);
                }
            }
        });

        // --- ファイル出力（FileSaver.js）---
        const buffer = await workbook.xlsx.writeBuffer();
        const blob = new Blob([buffer], {
            type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        });
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 10);
        saveAs(blob, `決算期別一覧_${timestamp}.xlsx`);
    }

    // PDF出力
    async function exportPDF() {
        const previewWindow = window.ReportEngine.openPreviewWindow();
        if (!previewWindow) {
            alert('プレビュー画面を開けませんでした。ブラウザのポップアップブロック設定を確認してください。');
            return;
        }

        if (filteredData.length === 0) {
            alert('出力するデータがありません。');
            window.ReportEngine.closePreviewWindow(previewWindow);
            return;
        }

        try {
            const mVal = filterFiscalMonth.value ? `${filterFiscalMonth.value}月` : '全決算月';
            const tVal = filterLicenseType.value || '全許認可';
            const selectedStaffId = filterStaff.value;
            const selectedStaff = staffMembers.find(s => Number(s.staff_id) === Number(selectedStaffId));
            const sVal = selectedStaff ? selectedStaff.staff_name : '全担当者';
            const kVal = (filterSearch && filterSearch.value.trim()) ? `_キ-${filterSearch.value.trim()}` : '';

            const todayStr = new Date().toISOString().slice(0, 10).replace(/-/g, ''); // YYYYMMDD
            const filename = `決算期別一覧_${mVal}_${tVal}_${sVal}${kVal}_${todayStr}.pdf`;

            const report = new window.LicenseWashoutReport();
            const filterOptions = {
                fiscalMonth: filterFiscalMonth.value || '',
                licenseType: filterLicenseType.value || '',
                staffName: selectedStaff ? selectedStaff.staff_name : '',
                keyword: (filterSearch && filterSearch.value.trim()) ? filterSearch.value.trim() : ''
            };

            await report.generate(filteredData, filterOptions);
            report.preview(previewWindow);
        } catch (error) {
            console.error('PDF generation failed:', error);
            alert('PDFの出力中にエラーが発生しました。');
            window.ReportEngine.closePreviewWindow(previewWindow);
        }
    }


    // --- Event Listeners ---
    // 決算月が変更されたら検索を実行
    filterFiscalMonth.addEventListener('change', searchData);

    // その他のフィルタは、すでに取得済みのデータ(filteredData)に対して行う？
    // いえ、searchData内で filterCustomers -> fetchLicenses -> filterClientSide としているので、
    // searchDataを呼べばOK。ただし、クライアントサイドフィルタだけ再実行する方が効率的だが、
    // 実装をシンプルにするため searchData を呼ぶ。
    // (データ量増加時に問題になる場合は、fetch済みデータをcacheしてfilterのみ実行に切り替える)

    filterLicenseType.addEventListener('change', searchData);
    filterStaff.addEventListener('change', searchData);

    // キーワード検索はEnterキーまたはフォーカスアウトで実行
    if (filterSearch) {
        filterSearch.addEventListener('change', searchData);
        filterSearch.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault(); // Prevent form submission if any
                searchData();
            }
        });
    }

    if (btnSearch) {
        btnSearch.addEventListener('click', searchData);
    }

    btnReset.addEventListener('click', () => {
        filterLicenseType.value = '';
        filterFiscalMonth.value = '';
        filterStaff.value = '';
        if (filterSearch) filterSearch.value = '';
        // リセット時はデータをクリアして初期状態へ
        initialMessage.style.display = 'block';
        initialMessage.textContent = '決算月を選択してください';
        tableWrapper.style.display = 'none';
        countDisplay.innerText = '表示件数：0件';
        washoutListBody.innerHTML = '';
        filteredData = [];
    });

    btnExport.addEventListener('click', exportExcel);
    if (btnExportPdf) btnExportPdf.addEventListener('click', exportPDF);

    // Start
    // Initial Start - Robust Auth Check
    const checkAndInit = () => {
        if (typeof firebase !== 'undefined' && firebase.auth) {
            const user = firebase.auth().currentUser;
            if (user) {
                init();
            } else {
                const unsub = firebase.auth().onAuthStateChanged(user => {
                    if (user) {
                        unsub();
                        init();
                    }
                });
            }
        } else {
            console.error('Firebase Auth not ready');
        }
    };
    checkAndInit();
});
