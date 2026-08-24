document.addEventListener('DOMContentLoaded', async () => {
    // --- Selectors ---
    const customerListBody = document.getElementById('customer-list-body');
    const filterStatus = document.getElementById('filter-status');
    const filterSearch = document.getElementById('filter-search');
    const filterPhone = document.getElementById('filter-phone');
    const btnNewCustomer = document.getElementById('btn-new-customer');
    const btnResetFilters = document.getElementById('btn-reset-filters');
    const initialMessage = document.getElementById('initial-message');
    const countDisplayArea = document.getElementById('count-display-area');
    const countDisplay = document.getElementById('count-display');
    const tableWrapper = document.getElementById('table-wrapper');

    // --- State ---
    let customers = [];
    let filteredData = [];
    let currentSort = { column: 'customer_id', direction: 'asc' };

    // --- Functions ---

    async function init() {
        console.log('Customer List Initialized');

        // CSV Import Module Hook
        if (window.CustomerImporter) {
            window.CustomerImporter.init({
                onComplete: (result) => {
                    if (result && result.successCount > 0) {
                        // インポートされた最新データを表示するために検索を実行
                        executeSearch();
                    }
                }
            });
        }

        // Sorting header listeners
        document.querySelectorAll('#customer-table th.sortable').forEach(th => {
            th.addEventListener('click', () => {
                const column = th.dataset.sort;
                const direction = currentSort.column === column && currentSort.direction === 'asc' ? 'desc' : 'asc';
                currentSort = { column, direction };

                updateSortIndicators('customer-table', column, direction);
                filteredData = handleSort('customer-table', filteredData, column, 'string', direction);
                renderTable(filteredData);
            });
        });

        // Search Button Listener
        const btnSearch = document.getElementById('btn-search-execute');
        if (btnSearch) {
            btnSearch.addEventListener('click', executeSearch);
        }

        // Enter key support
        [filterSearch, filterPhone].forEach(input => {
            input.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') executeSearch();
            });
        });

        // Reset Button
        if (btnResetFilters) {
            btnResetFilters.addEventListener('click', () => {
                filterStatus.value = '';
                filterSearch.value = '';
                filterPhone.value = '';
                initialMessage.style.display = 'block';
                tableWrapper.style.display = 'none';
                countDisplayArea.style.display = 'none';
                customers = [];
                filteredData = [];
                customerListBody.innerHTML = '';
            });
        }

        // 全セットアップ完了後にフォーカスを設定
        // 将来的なローディング表示・描画アニメーション追加時も順序を保証するため、init()末尾に配置
        filterSearch.focus();
    }

    async function executeSearch() {
        const sVal = filterStatus.value;
        const searchVal = filterSearch.value.trim();
        const phoneVal = filterPhone.value.trim().replace(/-/g, '');

        if (!searchVal && !phoneVal) {
            alert('顧客名または電話番号を入力してください');
            return;
        }

        initialMessage.style.display = 'none';
        tableWrapper.style.display = 'block';
        countDisplayArea.style.display = 'flex';
        customerListBody.innerHTML = '<tr><td colspan="7" style="text-align:center">検索中...</td></tr>';

        try {
            let results = [];

            if (phoneVal) {
                // 電話番号での検索（部分一致）
                // Firestoreは部分一致(LIKE '%xx%')をサポートしないため、
                // 全件取得しクライアント側でハイフン除去後に部分一致フィルタリング
                // ※ 顧客データが数千件を超える場合はパフォーマンス低下の可能性あり
                const snapshot = await db.collection('customers')
                    .limit(500)
                    .get();
                const allCustomers = snapshot.docs.map(d => d.data());

                // ハイフン除去済み文字列同士で部分一致比較
                results = allCustomers.filter(c => {
                    const targetPhone = (c.phone || '').replace(/-/g, '');
                    return targetPhone.includes(phoneVal);
                });
            } else if (searchVal) {
                // 顧客名での検索：全件取得してクライアント側で部分一致フィルタリング
                // Firestoreは部分一致検索をサポートしていないため、この方法を使用
                const snapshot = await db.collection('customers').get();
                const allCustomers = snapshot.docs.map(d => d.data());

                // 顧客名またはカナで部分一致検索
                const searchLower = searchVal.toLowerCase();
                results = allCustomers.filter(c => {
                    const nameLower = (c.customer_name || '').toLowerCase();
                    const kanaLower = (c.customer_kana || '').toLowerCase();
                    return nameLower.includes(searchLower) || kanaLower.includes(searchLower);
                });

                // 最大50件に制限
                if (results.length > 50) {
                    results = results.slice(0, 50);
                    alert('検索結果が多すぎます。最初の50件のみ表示します。\nより具体的な検索語を入力してください。');
                }
            }

            // ステータスフィルタを適用
            if (sVal) {
                results = results.filter(c => c.status === sVal);
            }

            customers = results;
            filteredData = results;
            renderTable(filteredData);

        } catch (err) {
            console.error('Search error:', err);
            customerListBody.innerHTML = '<tr><td colspan="7" style="text-align:center; color:red">検索エラーが発生しました</td></tr>';
        }
    }

    function getStatusClass(status) {
        switch (status) {
            case '稼働中': return 'status-uketuke'; // グリーンを流用
            case '休眠': return 'status-sakusei'; // オレンジを流用
            case '取引終了': return 'status-torisage'; // グレーを流用
            default: return 'status-torisage';
        }
    }

    function renderTable(data) {
        customerListBody.innerHTML = '';
        countDisplay.textContent = `表示件数：${data.length}件`;

        if (data.length === 0) {
            customerListBody.innerHTML = `<tr><td colspan="7" class="no-data-cell">該当するデータがありません</td></tr>`;
            return;
        }

        data.forEach(item => {
            const row = document.createElement('tr');
            row.style.cursor = 'pointer';
            row.addEventListener('click', () => {
                sessionStorage.setItem('temp_transition_customer', JSON.stringify(item));
                window.location.href = `customer_detail.html?id=${item.customer_id}`;
            });
            row.innerHTML = `
                <td><span style="color: var(--text-muted); font-family: monospace;">${item.customer_id}</span></td>
                <td><span class="badge ${getStatusClass(item.status)}">${item.status}</span></td>
                <td><strong>${item.customer_name}</strong><br><small style="color: #64748b;">${formatDisplayValue(item.customer_kana)}</small></td>
                <td>${item.customer_type}</td>
                <td>${formatDisplayValue(item.representative_name)}</td>
                <td>${formatDisplayValue(item.phone)}</td>
                <td><small>${formatToJST(item.last_updated)}</small></td>
            `;
            customerListBody.appendChild(row);
        });
    }

    function handleFilter() {
        const sVal = filterStatus.value;
        const searchVal = filterSearch.value.toLowerCase();
        const phoneVal = filterPhone.value.replace(/-/g, ''); // 検索語からハイフンを除去

        // 検索条件（名前・カナ、電話番号）が両方空の場合は非表示
        if (searchVal === "" && phoneVal === "") {
            initialMessage.style.display = 'block';
            tableWrapper.style.display = 'none';
            countDisplayArea.style.display = 'none';
            customerListBody.innerHTML = '';
            filteredData = [];
            return;
        }

        initialMessage.style.display = 'none';
        tableWrapper.style.display = 'block';
        countDisplayArea.style.display = 'flex';

        filteredData = customers.filter(c => {
            const matchStatus = sVal === "" || c.status === sVal;

            // 検索名・カナのマッチ
            const matchSearch = searchVal === "" ||
                c.customer_name.toLowerCase().includes(searchVal) ||
                (c.customer_kana && c.customer_kana.toLowerCase().includes(searchVal));

            // 電話番号のマッチ（ハイフン除去して部分一致）
            let matchPhone = true;
            if (phoneVal !== "") {
                const targetPhone = (c.phone || '').replace(/-/g, '');
                matchPhone = targetPhone.includes(phoneVal);
            }

            return matchStatus && matchSearch && matchPhone;
        });

        // Current Sort Apply
        filteredData = handleSort('customer-table', filteredData, currentSort.column, 'string', currentSort.direction);
        updateSortIndicators('customer-table', currentSort.column, currentSort.direction);

        renderTable(filteredData);
    }

    // --- Event Listeners ---
    [filterStatus, filterSearch, filterPhone].forEach(el => {
        el.addEventListener('input', handleFilter);
    });

    btnNewCustomer.addEventListener('click', () => {
        window.location.href = 'customer_detail.html?id=new';
    });

    btnResetFilters.addEventListener('click', () => {
        filterStatus.value = '稼働中';
        filterSearch.value = '';
        filterPhone.value = '';
        handleFilter();
    });

    init();
});
