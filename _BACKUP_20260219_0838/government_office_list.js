console.log('[government_office_list.js] Script file loaded');
document.addEventListener('DOMContentLoaded', () => {
    console.log('[government_office_list.js] DOMContentLoaded fired');
    const listBody = document.getElementById('office-list-body');
    const resultsSection = document.getElementById('results-section');
    const filterPrefecture = document.getElementById('filter-prefecture');
    const filterType = document.getElementById('filter-type');
    const filterOfficeName = document.getElementById('filter-office-name');
    const filterStatusActive = document.getElementById('filter-status-active');

    const btnSearch = document.getElementById('btn-search');
    const btnReset = document.getElementById('btn-reset');
    const btnNewOffice = document.getElementById('btn-new-office');

    let offices = [];
    let filteredData = [];
    let currentSort = { column: 'office_id', direction: 'asc' };

    async function init() {
        try {
            console.log('[government_office_list.js] init() called');
            console.log('Fetching Government Offices from Firestore...');
            offices = await getAllFromFirestore('government_offices');
        } catch (error) {
            console.error('Error fetching offices:', error);
            showToast('データの取得に失敗しました', 'error');
        }

        // Sorting header listeners
        document.querySelectorAll('#office-table th.sortable').forEach(th => {
            th.addEventListener('click', () => {
                const column = th.dataset.sort;
                const direction = currentSort.column === column && currentSort.direction === 'asc' ? 'desc' : 'asc';
                currentSort = { column, direction };

                updateSortIndicators('office-table', column, direction);
                filteredData = handleSort('office-table', filteredData, column, 'string', direction);
                renderTable(true); // skip filtering
            });
        });

        // デフォルトでは一覧を表示しない（検索ボタンを押した時のみ表示）
    }

    function renderTable(isSorted = false) {
        if (!isSorted) {
            const prefVal = filterPrefecture.value;
            const typeVal = filterType.value;
            const nameVal = filterOfficeName ? filterOfficeName.value.trim().toLowerCase() : '';
            const onlyActive = filterStatusActive.checked;


            filteredData = offices.filter(o => {
                const matchPref = prefVal === '' || o.office_prefecture === prefVal;
                const matchType = typeVal === '' || o.office_type === typeVal;
                const matchStatus = !onlyActive || o.status === '有効';

                // 官公庁名の部分一致検索
                const nameLower = (o.office_name || '').toLowerCase();
                const matchName = nameVal === '' || nameLower.includes(nameVal);

                return matchPref && matchType && matchStatus && matchName;
            });

            // Current Sort Apply
            filteredData = handleSort('office-table', filteredData, currentSort.column, 'string', currentSort.direction);
            updateSortIndicators('office-table', currentSort.column, currentSort.direction);
        }

        listBody.innerHTML = '';

        if (filteredData.length === 0) {
            listBody.innerHTML = `<tr><td colspan="5" class="no-data-cell">該当するデータが見つかりませんでした。</td></tr>`;
        } else {
            filteredData.forEach(o => {
                const row = document.createElement('tr');
                row.style.cursor = 'pointer';
                row.addEventListener('click', () => {
                    window.location.href = `government_office_detail.html?id=${o.office_id}`;
                });

                row.innerHTML = `
                    <td style="color: var(--text-muted); font-family: monospace;">#${o.office_id}</td>
                    <td style="font-weight: 600;">${o.office_name}</td>
                    <td>${formatDisplayValue(o.office_prefecture)}</td>
                    <td>${o.office_type}</td>
                    <td><span class="badge ${o.status === '有効' ? 'status-junin' : 'status-torisage'}">${o.status}</span></td>
                `;
                listBody.appendChild(row);
            });
        }

        resultsSection.style.display = 'block';
    }

    // 検索ボタンクリック
    btnSearch.addEventListener('click', () => renderTable());

    // リセットボタンクリック
    btnReset.addEventListener('click', () => {
        filterPrefecture.value = '';
        filterType.value = '';
        filterOfficeName.value = '';
        filterStatusActive.checked = true;
        renderTable(); // Re-render with reset filters
    });

    // Enterキーでも検索できるように設定
    [filterPrefecture, filterType, filterOfficeName].forEach(el => {
        el.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') renderTable();
        });
    });

    btnNewOffice.addEventListener('click', () => {
        window.location.href = 'government_office_detail.html';
    });

    init();
});
