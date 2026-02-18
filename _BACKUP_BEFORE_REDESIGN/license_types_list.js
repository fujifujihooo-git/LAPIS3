document.addEventListener('DOMContentLoaded', () => {
    console.log('License Types List Initialized');

    // --- Selectors ---
    const licenseTypesBody = document.getElementById('license-types-body');
    const filterStatus = document.getElementById('filter-status');
    const btnNewLicenseType = document.getElementById('btn-new-license-type');

    // --- State ---
    let licenseTypes = [];

    // --- Functions ---

    // Initialize Data
    async function init() {
        try {
            licenseTypes = await getAllFromFirestore('license_types');
            console.log(`Loaded ${licenseTypes.length} license types from Firestore`);
        } catch (error) {
            console.error('Error fetching license types:', error);
            showToast('データの取得に失敗しました', 'error');
        }
        handleFilter();
    }

    // Get Status Class
    function getStatusClass(status) {
        return status === '有効' ? 'status-junin' : 'status-sodan';
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
                <td><span class="badge ${getStatusClass(item.status)}">${item.status}</span></td>
            `;
            licenseTypesBody.appendChild(row);
        });
    }

    // Filter Logic
    function handleFilter() {
        const statusVal = filterStatus.value;
        const filtered = licenseTypes.filter(item => {
            return statusVal === '' || item.status === statusVal;
        });

        // Sort by sort_order ascending
        filtered.sort((a, b) => (a.sort_order || 999) - (b.sort_order || 999));

        renderTable(filtered);
    }

    // --- Event Listeners ---
    filterStatus.addEventListener('change', handleFilter);

    btnNewLicenseType.addEventListener('click', () => {
        window.location.href = 'license_type_detail.html?id=new';
    });

    // Start
    init();
});
