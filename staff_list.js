console.log('[staff_list.js] Script file loaded');
// Global state
let staffMembers = [];
let filteredData = [];
let currentSort = { column: 'staff_id', direction: 'asc' }; // Default sort by ID

document.addEventListener('DOMContentLoaded', async () => {
    // DOM Elements
    const staffListBody = document.getElementById('staff-list-body');
    const filterStatus = document.getElementById('filter-status'); // Ensure ID matches HTML
    const filterRole = document.getElementById('filter-role');     // Ensure ID matches HTML
    const searchName = document.getElementById('search-name');     // Ensure ID matches HTML
    const btnNew = document.getElementById('btn-new-staff');
    const btnReset = document.getElementById('btn-reset');
    const resultsSection = document.getElementById('results-section-staff');

    // Initialize
    await init();

    async function init() {
        console.log('[staff_list.js] init() called');

        try {
            // Fetch data
            staffMembers = await getAllFromFirestore('staff');

            // Initial filter/sort application
            filterAndRender();

        } catch (error) {
            console.error('Error fetching staff:', error);
            showToast('データの取得に失敗しました', 'error');
        }

        // Event Listeners
        if (filterStatus) filterStatus.addEventListener('change', () => filterAndRender());
        if (filterRole) filterRole.addEventListener('change', () => filterAndRender());
        if (searchName) searchName.addEventListener('input', () => filterAndRender());

        if (btnReset) {
            btnReset.addEventListener('click', () => {
                if (filterStatus) filterStatus.value = '在籍';
                if (filterRole) filterRole.value = '';
                if (searchName) searchName.value = '';
                filterAndRender();
            });
        }

        if (btnNew) {
            btnNew.addEventListener('click', () => {
                window.location.href = 'staff_detail.html?id=new';
            });
        }

        // Sorting
        document.querySelectorAll('#staff-table th.sortable').forEach(th => {
            th.addEventListener('click', () => {
                const column = th.dataset.sort;
                const direction = currentSort.column === column && currentSort.direction === 'asc' ? 'desc' : 'asc';
                currentSort = { column, direction };
                updateSortIndicators('staff-table', column, direction);
                filterAndRender(); // Re-render with new sort
            });
        });
    }

    function filterAndRender() {
        let data = [...staffMembers];

        // 1. Filter
        const sVal = filterStatus ? filterStatus.value : '';
        const rVal = filterRole ? filterRole.value : '';
        const nameVal = searchName ? searchName.value.trim().toLowerCase() : '';

        data = data.filter(item => {
            // Status: If filter is empty, show all. If '在籍', show only '在籍'.
            // Note: If you want specific default behavior (e.g. valid only), handle that in init or here.
            // HTML value should drive this.
            const matchStatus = sVal === '' || item.status === sVal;
            const matchRole = rVal === '' || item.role === rVal;

            const fullName = (item.staff_name || '') + (item.staff_kana || '');
            const matchName = nameVal === '' || fullName.toLowerCase().includes(nameVal);

            return matchStatus && matchRole && matchName;
        });

        // 2. Sort
        // Use handleSort from common.js if available, or local implementation
        // Assuming handleSort supports (tableId, data, column, type, direction)
        // staff_id comes as number usually, but let's be safe
        data = handleSort('staff-table', data, currentSort.column, currentSort.column === 'staff_id' ? 'number' : 'string', currentSort.direction);

        filteredData = data;
        renderTable(data);
    }

    function renderTable(data) {
        if (!staffListBody) return;
        staffListBody.innerHTML = '';

        if (data.length === 0) {
            staffListBody.innerHTML = `<tr><td colspan="7" class="no-data-cell">該当するデータがありません</td></tr>`;
            if (resultsSection) resultsSection.style.display = 'block';
            return;
        }

        data.forEach(item => {
            const row = document.createElement('tr');
            row.style.cursor = 'pointer';
            row.addEventListener('click', () => {
                window.location.href = `staff_detail.html?id=${item.staff_id}`;
            });

            const statusClass = getStaffStatusClass(item.status);
            const lastUpdatedDate = formatDate(item.last_updated); // common.js utility

            row.innerHTML = `
                <td><span style="color: var(--text-muted); font-family: monospace;">${item.staff_id}</span></td>
                <td><span class="badge ${statusClass}">${item.status || '-'}</span></td>
                <td>
                    <strong>${item.staff_name || '-'}</strong>
                    <div style="font-size: 0.8em; color: var(--text-muted);">${item.staff_kana || ''}</div>
                </td>
                <td>${item.department || '-'}</td>
                <td>${item.role || '-'}</td>
                <td>${item.email || '-'}</td>
                <td>${lastUpdatedDate}</td>
            `;
            staffListBody.appendChild(row);
        });

        // filterRole.addEventListener('change', () => renderTable(staffMembers));
        // searchName.addEventListener('input', () => renderTable(staffMembers));

        // Search Button
        document.getElementById('btn-search').addEventListener('click', () => renderTable(staffMembers));

        // Reset Button
        document.getElementById('btn-reset').addEventListener('click', () => {
            filterStatus.value = '在籍'; // Default to Active? Original HTML had first option '在籍', wait let's check
            // Original HTML: <option value="在籍">在籍</option> is first.
            // It's safer to just set to empty if "All" is desired, or '在籍' if checking default. 
            // User didn't specify default, but standard reset usually goes to "All" or "Default".
            // Let's look at `staff_list.html` again.
            // Option 1: '在籍', Option 4: ''.
            // Usually reset means "clear filters".
            // In government_office_list, reset cleared everything.
            filterStatus.value = '在籍';
            filterRole.value = '';
            searchName.value = '';

            // Clear and hide
            staffListBody.innerHTML = '';
            document.getElementById('results-section-staff').style.display = 'none';
        });

        // Enter key support
        [searchName, filterStatus, filterRole].forEach(el => {
            el.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') renderTable(staffMembers);
            });
        });

        btnNewStaff.addEventListener('click', () => {
            window.location.href = 'staff_detail.html?id=new';
        });

        init();
    });
