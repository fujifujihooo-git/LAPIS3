document.addEventListener('DOMContentLoaded', () => {
    console.log('License Types List Initialized');

    // --- Selectors ---
    const licenseTypesBody = document.getElementById('license-types-body');
    const filterStatus = document.getElementById('filter-status');
    const btnNewLicenseType = document.getElementById('btn-add-type');
    const searchInput = document.getElementById('search-input');
    const categorySearch = document.getElementById('category-search'); // Added
    const btnSearch = document.getElementById('btn-search'); // Added
    const btnReset = document.getElementById('btn-reset'); // Added

    // --- State ---
    let licenseTypes = [];

    // --- Functions ---

    // Initialize Data
    async function init() {
        try {
            console.log('Init start - fetching data');
            licenseTypesBody.innerHTML = `<tr><td colspan="6" class="no-data-cell" style="padding: 40px 0; color: #888;">検索条件を入力して検索ボタンを押してください。</td></tr>`;

            // Race condition protection: Timeout if fetch takes too long (e.g. persistence lock)
            const fetchPromise = getAllFromFirestore('license_types');
            const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Firestore fetch timed out (persistence blocked?)')), 5000)
            );

            licenseTypes = await Promise.race([fetchPromise, timeoutPromise]);

            console.log(`Loaded ${licenseTypes.length} license types from Firestore`);
            // Do NOT render table automatically (Search on demand)
        } catch (error) {
            console.error('Error fetching license types:', error);
            showToast('データの取得に失敗しました', 'error');
        }
    }

    // Get Status Class
    function getStatusClass(status) {
        return (status === '有効' || status === 'active') ? 'status-junin' : 'status-sodan';
    }

    // Render Table
    function renderTable(data) {
        licenseTypesBody.innerHTML = '';

        if (data.length === 0) {
            licenseTypesBody.innerHTML = `<tr><td colspan="6" class="no-data-cell">該当するデータが見つかりませんでした。</td></tr>`;
            return;
        }

        data.forEach(item => {
            const row = document.createElement('tr');
            row.style.cursor = 'pointer';
            row.addEventListener('click', () => {
                window.location.href = `license_type_detail.html?id=${item.license_type_id}`;
            });

            const expiryText = item.has_expiry ? '期限あり' : '期限なし';
            const noticeText = item.has_expiry && item.default_notice_days
                ? `${item.default_notice_days}日前`
                : 'ー';

            row.innerHTML = `
                <td><span style="color: var(--text-muted); font-family: monospace;">${item.license_type_id}</span></td>
                <td><strong>${item.license_type_name}</strong></td>
                <td><span style="color: var(--text-muted);">${item.sort_order || 999}</span></td>
                <td>${expiryText}</td>
                <td>${noticeText}</td>
                <td><span class="badge ${getStatusClass(item.status)}">${item.status === 'active' || item.status === '有効' ? '有効' : '無効'}</span></td>
            `;
            licenseTypesBody.appendChild(row);
        });
    }

    // Search Logic
    function handleSearch() {
        const keyword = searchInput.value.trim().toLowerCase();
        const category = categorySearch.value.trim().toLowerCase();
        const status = filterStatus.value;

        const filtered = licenseTypes.filter(item => {
            // Keyword Match (Name)
            const nameMatch = !keyword || (item.license_type_name && item.license_type_name.toLowerCase().includes(keyword));

            // Category Match
            const categoryMatch = !category || (item.category && item.category.toLowerCase().includes(category));

            // Status Match (Exact)
            // Note: item.status might be 'active'/'inactive' or '有効'/'無効' depending on how it was saved.
            // Using normalization for robust matching.
            let itemStatus = item.status;
            if (itemStatus === '有効') itemStatus = 'active';
            if (itemStatus === '無効') itemStatus = 'inactive';

            const statusMatch = !status || itemStatus === status;

            return nameMatch && categoryMatch && statusMatch;
        });

        // Sort by sort_order ascending
        filtered.sort((a, b) => (a.sort_order || 999) - (b.sort_order || 999));

        renderTable(filtered);
    }

    // Reset Logic
    function handleReset() {
        searchInput.value = '';
        categorySearch.value = '';
        filterStatus.value = '';
        licenseTypesBody.innerHTML = `<tr><td colspan="6" class="no-data-cell" style="padding: 40px 0; color: #888;">検索条件を入力して検索ボタンを押してください。</td></tr>`;
    }

    // --- Event Listeners ---
    // Remove auto-filter listeners
    // if (filterStatus) filterStatus.addEventListener('change', handleFilter);
    // if (searchInput) searchInput.addEventListener('input', debounce(handleFilter, 300));

    if (btnSearch) btnSearch.addEventListener('click', handleSearch);
    if (btnReset) btnReset.addEventListener('click', handleReset);
    // Enter key support for search inputs
    if (searchInput) searchInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') handleSearch(); });
    if (categorySearch) categorySearch.addEventListener('keypress', (e) => { if (e.key === 'Enter') handleSearch(); });

    btnNewLicenseType.addEventListener('click', () => {
        window.location.href = 'license_type_detail.html?id=new';
    });

    // Start
    // Initial Start - Robust Auth Check
    const checkAndInit = () => {
        if (firebase.auth().currentUser) {
            // Small delay to allow Firestore to settle
            setTimeout(init, 500);
        } else {
            console.log('Waiting for Auth...');
            const unsub = firebase.auth().onAuthStateChanged(user => {
                if (user) {
                    unsub();
                    setTimeout(init, 500);
                }
            });
        }
    };
    checkAndInit();
});
