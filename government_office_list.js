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
        console.log('[government_office_list.js] init() called');
        // 初期データ読み込みは行わない（検索ボタン押下時のみ）

        // Sorting header listeners
        document.querySelectorAll('#office-table th.sortable').forEach(th => {
            th.addEventListener('click', () => {
                const column = th.dataset.sort;
                const direction = currentSort.column === column && currentSort.direction === 'asc' ? 'desc' : 'asc';
                currentSort = { column, direction };

                filteredData = handleSort('office-table', filteredData, column, 'string', direction);
                renderTable(true); // skip filtering
            });
        });

        // 検索条件未入力時のメッセージ表示
        listBody.innerHTML = `<tr><td colspan="5" class="no-data-cell" style="text-align: center; padding: 20px; color: var(--text-muted);">検索条件を入力して検索ボタンを押してください。</td></tr>`;
        resultsSection.style.display = 'block';
    }

    async function searchOffices() {
        const prefVal = filterPrefecture.value;
        const typeVal = filterType.value;
        const nameVal = filterOfficeName ? filterOfficeName.value.trim() : '';
        const onlyActive = filterStatusActive.checked;

        // クエリ発行条件のチェック（全件取得防止）
        if (!prefVal && !typeVal && !nameVal) {
            showToast('検索条件（都道府県、種別、または官公庁名）を少なくとも1つ指定してください', 'error');
            return;
        }

        try {
            console.log('Searching Government Offices...');
            let query = db.collection('government_offices');

            // 複合クエリにはインデックスが必要になる場合があるため、
            // 簡易的にクライアントサイドフィルタリングと組み合わせるか、可能な範囲でクエリ絞り込みを行う。
            // ここでは等価条件を優先して適用する。

            if (prefVal) {
                query = query.where('office_prefecture', '==', prefVal);
            }
            if (typeVal) {
                if (typeVal === '市町村') {
                    // DB上は「市区町村」となっているため、それを検索
                    query = query.where('office_type', '==', '市区町村');
                } else {
                    query = query.where('office_type', '==', typeVal);
                }
            }
            // ステータスでの絞り込みはインデックスが必要になる可能性が高いため、クライアントサイドで行うか、
            // インデックス作成を許容して .where('status', '==', '有効') を追加する。
            // 今回は既存実装に合わせてクライアントサイドフィルタリングを併用するが、
            // データ量が多い場合はインデックスを作成してサーバーサイドで絞り込むべき。

            const snapshot = await query.get();
            let results = snapshot.docs.map(doc => doc.data());

            // 官公庁名の部分一致検索（Firestoreは前方一致のみ標準対応だが、ここではJSで柔軟にフィルタする）
            if (nameVal) {
                const searchLower = nameVal.toLowerCase();
                results = results.filter(o => (o.office_name || '').toLowerCase().includes(searchLower));
            }

            // ステータスフィルタ
            if (onlyActive) {
                results = results.filter(o => o.status === '有効');
            }

            offices = results; // 保存してソート等で再利用
            filteredData = results;

            // Default Sort
            filteredData = handleSort('office-table', filteredData, currentSort.column, 'string', currentSort.direction);
            updateSortIndicators('office-table', currentSort.column, currentSort.direction);

            renderTable(true); // データは既にフィルタ済みなのでそのまま描画
            showToast(`${filteredData.length}件のデータが見つかりました`);

        } catch (error) {
            console.error('Error searching offices:', error);
            showToast('検索中にエラーが発生しました', 'error');
        }
    }

    function renderTable(isSorted = false) {
        // searchOfficesでデータは絞り込み済みだが、ソート時などに呼ばれることがある
        // ここではfilteredDataを描画するだけにする

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
    btnSearch.addEventListener('click', () => searchOffices());

    // リセットボタンクリック
    btnReset.addEventListener('click', () => {
        filterPrefecture.value = '';
        filterType.value = '';
        filterOfficeName.value = '';
        filterStatusActive.checked = true;

        // リセット時はクリアしてメッセージを表示
        offices = [];
        filteredData = [];
        listBody.innerHTML = `<tr><td colspan="5" class="no-data-cell">検索条件を入力して検索ボタンを押してください。</td></tr>`;
    });

    // Enterキーでも検索できるように設定
    [filterPrefecture, filterType, filterOfficeName].forEach(el => {
        el.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') searchOffices();
        });
    });

    // btnNewOffice はHTMLから削除されている可能性があるが、もし存在すれば維持
    if (btnNewOffice) {
        btnNewOffice.addEventListener('click', () => {
            window.location.href = 'government_office_detail.html';
        });
    }

    init();
});
