console.log('[staff_list.js] Script file loaded');

// Global state
let currentSort = { column: 'staff_id', direction: 'asc' }; // Default sort by ID

document.addEventListener('DOMContentLoaded', async () => {
    // DOM Elements
    const staffListBody = document.getElementById('staff-list-body');
    const filterStatus = document.getElementById('filter-status');
    const filterRole = document.getElementById('filter-role');
    const searchName = document.getElementById('search-name');
    const btnSearch = document.getElementById('btn-search');
    const btnReset = document.getElementById('btn-reset');
    const btnNew = document.getElementById('btn-new-staff');
    const resultsSection = document.getElementById('results-section-staff');

    // Initialize
    await init();

    async function init() {
        console.log('[staff_list.js] init() called');

        // Note: No auto-fetch on load (Constraint: Reduce quota/initial load)
        // User must click Search to see data.

        // Event Listeners
        if (btnSearch) {
            btnSearch.addEventListener('click', executeSearch);
        }

        if (btnReset) {
            btnReset.addEventListener('click', () => {
                if (filterStatus) filterStatus.value = '在籍';
                if (filterRole) filterRole.value = '';
                if (searchName) searchName.value = '';

                // Clear results
                if (staffListBody) staffListBody.innerHTML = '';
                if (resultsSection) resultsSection.style.display = 'none';
            });
        }

        if (btnNew) {
            btnNew.addEventListener('click', () => {
                window.location.href = 'staff_detail.html?id=new';
            });
        }

        // Enter key support
        [searchName, filterStatus, filterRole].forEach(el => {
            if (el) {
                el.addEventListener('keypress', (e) => {
                    if (e.key === 'Enter') executeSearch();
                });
            }
        });

        // Sorting
        document.querySelectorAll('#staff-table th.sortable').forEach(th => {
            th.addEventListener('click', () => {
                const column = th.dataset.sort;
                // Toggle direction
                const direction = currentSort.column === column && currentSort.direction === 'asc' ? 'desc' : 'asc';
                currentSort = { column, direction };
                updateSortIndicators('staff-table', column, direction);

                // Re-sort currently displayed rows (Client-side sort of current results)
                sortCurrentTable();
            });
        });
    }

    async function executeSearch() {
        console.log('Execute Search');

        // 1. Build Query
        let query = db.collection('staff');

        const sVal = filterStatus ? filterStatus.value : '';
        const rVal = filterRole ? filterRole.value : '';
        const nameVal = searchName ? searchName.value.trim() : '';

        // Apply Filters (Server-side)
        if (sVal) {
            query = query.where('status', '==', sVal);
        }
        if (rVal) {
            query = query.where('role', '==', rVal);
        }

        try {
            if (resultsSection) resultsSection.style.display = 'block';
            if (staffListBody) staffListBody.innerHTML = '<tr><td colspan="7" class="loading-cell">検索中...</td></tr>';

            const snapshot = await query.get();

            if (snapshot.empty) {
                renderTable([]);
                return;
            }

            let data = snapshot.docs.map(doc => doc.data());

            // 2. Client-side Filter (for Name/ID)
            // Firestore cannot easily do "contains" for strings.
            if (nameVal) {
                const lowerName = nameVal.toLowerCase();
                data = data.filter(item => {
                    const fullName = (item.staff_name || '') + (item.staff_kana || '');
                    const strId = String(item.staff_id || '');

                    // Match Name or ID
                    return fullName.toLowerCase().includes(lowerName) || strId.includes(lowerName);
                });
            }

            // 3. Initial Sort
            data = handleSort('staff-table', data, currentSort.column, currentSort.column === 'staff_id' ? 'number' : 'string', currentSort.direction);

            renderTable(data);

        } catch (error) {
            console.error('Search Error:', error);

            let errorMsg = '検索中にエラーが発生しました。';
            // Index Error Detection
            if (error.message && error.message.includes('requires an index')) {
                errorMsg = '複合クエリのインデックスが必要です。コンソールを確認してください。';
                console.warn('Click the link in the error above to create the index in Firebase Console.');
            }

            if (staffListBody) {
                staffListBody.innerHTML = `<tr><td colspan="7" class="error-cell">${errorMsg}</td></tr>`;
            }
        }
    }

    function sortCurrentTable() {
        // Retrieve current data from DOM or state? 
        // Since we don't keep global state of "current results" easily without fetching again or parsing DOM,
        // let's parse DOM or keep a temp variable.
        // For simplicity and robustness, let's re-trigger search? No, that costs reads.
        // Let's use the common.js sortTable which sorts the DOM.

        // Determine column index based on dataset-sort
        const th = document.querySelector(`th[data-sort="${currentSort.column}"]`);
        if (!th) return;

        // Get index
        const headers = Array.from(th.parentNode.children);
        const index = headers.indexOf(th);

        if (index >= 0) {
            sortTable(document.getElementById('staff-table'), index, currentSort.direction === 'asc');
        }
    }

    function renderTable(data) {
        if (!staffListBody) return;
        staffListBody.innerHTML = '';

        if (data.length === 0) {
            staffListBody.innerHTML = `<tr><td colspan="7" class="no-data-cell">該当するデータがありません</td></tr>`;
            return;
        }

        data.forEach(item => {
            const row = document.createElement('tr');
            row.style.cursor = 'pointer';
            row.addEventListener('click', () => {
                window.location.href = `staff_detail.html?id=${item.staff_id}`;
            });

            const statusClass = getStaffStatusClass(item.status);
            const lastUpdatedDate = formatToJST(item.last_updated);

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

        // Update indicators
        updateSortIndicators('staff-table', currentSort.column, currentSort.direction);
    }

    // Helper for Status Class (Local or Common?)
    // If common.js doesn't have it, define here.
    function getStaffStatusClass(status) {
        if (status === '在籍') return 'status-active'; // You might need to add CSS for this
        if (status === '休職') return 'status-warning';
        if (status === '退職') return 'status-inactive';
        return '';
    }
});
