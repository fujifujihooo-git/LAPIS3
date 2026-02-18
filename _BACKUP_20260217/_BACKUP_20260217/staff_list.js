console.log('[staff_list.js] Script file loaded');
document.addEventListener('DOMContentLoaded', async () => {
    console.log('[staff_list.js] DOMContentLoaded fired');
    const staffListBody = document.getElementById('staff-list-body');
    const filterStatus = document.getElementById('filter-status');
    const filterRole = document.getElementById('filter-role');
    const searchName = document.getElementById('search-name');
    const btnNewStaff = document.getElementById('btn-new-staff');

    let staffMembers = [];
    let filteredData = [];
    let currentSort = { column: 'staff_id', direction: 'asc' };

    async function init() {
        console.log('[staff_list.js] init() called');
        console.log('Fetching Staff Data from Firestore...');
        try {
            staffMembers = await getAllFromFirestore('staff');
        } catch (error) {
            console.error('Error fetching staff:', error);
            showToast('データの取得に失敗しました', 'error');
        }

        // Sorting header listeners
        document.querySelectorAll('#staff-table th.sortable').forEach(th => {
            th.addEventListener('click', () => {
                const column = th.dataset.sort;
                const direction = currentSort.column === column && currentSort.direction === 'asc' ? 'desc' : 'asc';
                currentSort = { column, direction };

                updateSortIndicators('staff-table', column, direction);
                filteredData = handleSort('staff-table', filteredData, column, 'string', direction);
                renderTable(filteredData, true); // true means skip filtering because we just sorted
            });
        });

        renderTable(staffMembers);
    }

    function renderTable(data, isSorted = false) {
        staffListBody.innerHTML = '';

        if (!isSorted) {
            // フィルタリング
            const sVal = filterStatus.value;
            const rVal = filterRole.value;
            const nameVal = searchName.value.toLowerCase();

            filteredData = data.filter(s => {
                const matchStatus = sVal === "" || s.status === sVal;
                const matchRole = rVal === "" || s.role === rVal;
                const nameStr = (s.staff_name + (s.staff_kana || '')).toLowerCase();
                const matchName = nameVal === "" || nameStr.includes(nameVal);
                return matchStatus && matchRole && matchName;
            });

            // Current Sort Apply
            filteredData = handleSort('staff-table', filteredData, currentSort.column, 'string', currentSort.direction);
            updateSortIndicators('staff-table', currentSort.column, currentSort.direction);
        }

        if (filteredData.length === 0) {
            staffListBody.innerHTML = `<tr><td colspan="7" class="no-data-cell">該当するデータがありません</td></tr>`;
            return;
        }

        filteredData.forEach(item => {
            const row = document.createElement('tr');
            row.style.cursor = 'pointer';
            row.addEventListener('click', () => {
                window.location.href = `staff_detail.html?id=${item.staff_id}`;
            });

            const statusClass = getStatusClass(item.status);

            row.innerHTML = `
                <td><span style="color: var(--text-muted); font-family: monospace;">${item.staff_id}</span></td>
                <td><span class="badge ${statusClass}">${item.status}</span></td>
                <td><strong>${item.staff_name}</strong> <small style="color:var(--text-muted)">(${formatDisplayValue(item.staff_kana)})</small></td>
                <td>${formatDisplayValue(item.department)}</td>
                <td>${item.role}</td>
                <td>${formatDisplayValue(item.email)}</td>
                <td>${formatDate(item.last_updated)}</td>
            `;
            staffListBody.appendChild(row);
        });
    }

    function getStatusClass(status) {
        switch (status) {
            case '在籍': return 'status-uketuke'; // グリーン
            case '休職': return 'status-sakusei'; // オレンジ
            case '退職': return 'status-torisage'; // グレー
            default: return '';
        }
    }

    // Events
    filterStatus.addEventListener('change', () => renderTable(staffMembers));
    filterRole.addEventListener('change', () => renderTable(staffMembers));
    searchName.addEventListener('input', () => renderTable(staffMembers));

    btnNewStaff.addEventListener('click', () => {
        window.location.href = 'staff_detail.html?id=new';
    });

    init();
});
