/**
 * LAPIS3 Detail Page Common Module
 * 全詳細画面で共通するUI/データ取得パターンを提供
 * 
 * 標準ルール:
 *   R1: init禁止 — await init() で全処理をブロッキングする設計を禁止
 *   R2: マスタキャッシュ必須 — MasterDataManager 経由でマスタデータを取得
 *   R3: スケルトン必須 — データ取得中はスケルトンUIを表示
 *   R4: エラーUI必須 — 失敗時は再試行ボタン付きエラーUIを表示
 *   R5: 並列化必須 — 独立したFirestoreリクエストはPromise.allで並列化
 */
window.DetailPageHelper = {

    // ===== R3: スケルトンUI =====

    /**
     * コンテナにスケルトンローディングUIを表示
     * @param {string} containerId - 対象コンテナのID
     * @param {Object} options - オプション
     * @param {number} [options.rows=3] - スケルトン行数
     * @param {number} [options.cols=1] - tbodyの場合のcolspan数
     * @param {string} [options.type='table'] - 'table' | 'form' | 'text'
     */
    renderSkeleton(containerId, options = {}) {
        const el = document.getElementById(containerId);
        if (!el) return;

        const { rows = 3, cols = 1, type = 'table' } = options;

        if (type === 'table' || el.tagName === 'TBODY') {
            el.innerHTML = Array(rows).fill(
                `<tr><td colspan="${cols}"><div class="skeleton-row skeleton-shimmer"></div></td></tr>`
            ).join('');
        } else if (type === 'form') {
            el.innerHTML = Array(rows).fill(
                '<div class="skeleton-input skeleton-shimmer" style="margin-bottom: 16px;"></div>'
            ).join('');
        } else {
            el.innerHTML = Array(rows).fill(
                '<div class="skeleton-text skeleton-shimmer"></div>'
            ).join('');
        }
    },

    /**
     * スケルトン表示を解除（コンテナ内のスケルトン要素を削除）
     * @param {string} containerId
     */
    clearSkeleton(containerId) {
        const el = document.getElementById(containerId);
        if (!el) return;
        const skeletons = el.querySelectorAll('.skeleton-shimmer');
        skeletons.forEach(s => {
            const parent = s.closest('tr') || s;
            parent.remove();
        });
    },


    // ===== R4: エラーUI =====

    /**
     * エラーUIを表示（再試行ボタン付き）
     * @param {string} containerId - 対象コンテナのID
     * @param {Function} retryCallback - 再試行時に呼ぶ関数
     * @param {Object} options
     * @param {boolean} [options.isTbody=true] - tbodyの場合はtrue
     * @param {string} [options.message] - カスタムメッセージ
     */
    renderErrorUI(containerId, retryCallback, options = {}) {
        const el = document.getElementById(containerId);
        if (!el) return;

        const { isTbody = true, message = 'データの取得に失敗しました' } = options;

        const inner = `<div class="section-error-ui">
            ⚠️ ${message}<br>
            <button type="button" class="btn-retry">再試行</button>
        </div>`;

        if (isTbody || el.tagName === 'TBODY') {
            el.innerHTML = `<tr><td colspan="10">${inner}</td></tr>`;
        } else {
            el.innerHTML = inner;
        }

        const btn = el.querySelector('.btn-retry');
        if (btn) btn.addEventListener('click', retryCallback);
    },


    // ===== R2: キャッシュ付きフェッチ =====

    /**
     * AppCacheを利用したデータ取得
     * @param {string} cacheKey - キャッシュキー
     * @param {Function} fetchFn - キャッシュミス時に実行する非同期関数
     * @returns {Promise<*>}
     */
    async fetchWithCache(cacheKey, fetchFn) {
        if (window.AppCache) {
            const cached = window.AppCache.get(cacheKey);
            if (cached) return cached;
        }
        const data = await fetchFn();
        if (window.AppCache && data) {
            window.AppCache.set(cacheKey, data);
        }
        return data;
    },


    // ===== R2: マスタデータのセレクトボックスPopulate =====

    /**
     * MasterDataManagerからマスタデータを取得し、セレクトボックスをPopulateする
     * @param {Array<Object>} config - 設定配列
     * @param {string} config[].selectId - select要素のID
     * @param {string} config[].collection - 'staff' | 'license_types' | 'government_offices'
     * @param {Function} [config[].filterFn] - フィルタ関数
     * @param {Function} [config[].sortFn] - ソート関数
     * @param {Function} config[].mapFn - { value, label } を返す関数
     * @param {string} [config[].emptyLabel] - 空選択肢のラベル
     * @returns {Promise<void>}
     */
    async populateMasterSelects(config) {
        await window.MasterDataManager.loadAll();

        for (const c of config) {
            const el = document.getElementById(c.selectId);
            if (!el) continue;

            // 既存のoptionを保持（選択中の値を復元するため）
            const currentValue = el.value;

            el.innerHTML = `<option value="">${c.emptyLabel || '選択してください'}</option>`;

            let items = [];
            if (c.collection === 'staff') items = window.MasterDataManager.getStaff();
            else if (c.collection === 'license_types') items = window.MasterDataManager.getLicenseTypes();
            else if (c.collection === 'government_offices') items = window.MasterDataManager.getGovernmentOffices();

            if (c.filterFn) items = items.filter(c.filterFn);
            if (c.sortFn) items.sort(c.sortFn);

            items.forEach(item => {
                const opt = document.createElement('option');
                const mapped = c.mapFn(item);
                opt.value = mapped.value;
                opt.textContent = mapped.label;
                el.appendChild(opt);
            });

            // 元の値を復元
            if (currentValue) el.value = currentValue;
        }
    },


    // ===== R5: セクション読み込みラッパー =====

    /**
     * セクション単位のデータ取得・描画を一括管理する
     * スケルトン → データ取得 → 描画 or エラーUIの流れを自動化
     * @param {Object} config
     * @param {string} config.name - セクション名（ログ用）
     * @param {string} config.containerId - コンテナ要素のID
     * @param {Function} config.fetchFn - データ取得の非同期関数
     * @param {Function} config.renderFn - 描画関数（fetchFnの結果を引数に受ける）
     * @param {Object} [config.skeletonOptions] - renderSkeletonのオプション
     * @param {boolean} [config.showSkeleton=true] - スケルトン表示するか
     * @returns {Promise<*>} fetchFnの戻り値
     */
    async loadSection(config) {
        console.log('[DEBUG] DPH.loadSection config:', JSON.stringify(config, (k, v) => typeof v === 'function' ? '[Function]' : v));
        const { name, containerId, fetchFn, renderFn, skeletonOptions = {}, showSkeleton = true } = config;
        const tStart = performance.now();

        // スケルトン表示
        if (showSkeleton) {
            this.renderSkeleton(containerId, skeletonOptions);
        }

        try {
            const data = await fetchFn();
            renderFn(data);
            console.log(`[Perf] ${name} loaded in ${(performance.now() - tStart).toFixed(1)}ms`);
            return data;
        } catch (err) {
            console.error(`Failed to load ${name}:`, err);
            this.renderErrorUI(containerId, () => this.loadSection(config), {
                isTbody: (skeletonOptions.type !== 'form' && skeletonOptions.type !== 'text')
            });
            return null;
        }
    },


    // ===== 一覧→詳細のデータ引き継ぎ =====

    /**
     * 一覧画面から詳細画面への遷移データを保存
     * @param {string} key - データキー
     * @param {Object} data - 保存するデータ
     */
    saveTransitionData(key, data) {
        try {
            sessionStorage.setItem(`temp_transition_${key}`, JSON.stringify(data));
        } catch (e) {
            console.warn('Transition data save failed', e);
        }
    },

    /**
     * 一覧画面から詳細画面への遷移データを取得（取得後削除）
     * @param {string} key - データキー
     * @returns {Object|null}
     */
    getTransitionData(key) {
        try {
            const str = sessionStorage.getItem(`temp_transition_${key}`);
            if (str) {
                // 使い回し防止のため取得後は削除しない（リロード対応）
                return JSON.parse(str);
            }
            return null;
        } catch (e) {
            return null;
        }
    },

    /**
     * 遷移データをクリア
     * @param {string} key
     */
    clearTransitionData(key) {
        try {
            sessionStorage.removeItem(`temp_transition_${key}`);
        } catch (e) { /* ignore */ }
    },


    // ===== ユーティリティ =====

    /**
     * URLパラメータからIDを取得するヘルパー
     * @param {string} paramName - パラメータ名（デフォルト: 'id'）
     * @returns {{ id: string|null, isNew: boolean }}
     */
    getIdFromUrl(paramName = 'id') {
        const params = new URLSearchParams(window.location.search);
        const id = params.get(paramName);
        return {
            id: id,
            isNew: id === 'new',
            numericId: id && id !== 'new' ? parseInt(id) : null
        };
    },

    /**
     * URLパラメータを一括取得するヘルパー
     * @param {string[]} paramNames - パラメータ名の配列
     * @returns {Object} パラメータ名をキー、値を値としたオブジェクト
     */
    getParamsFromUrl(paramNames) {
        const params = new URLSearchParams(window.location.search);
        const result = {};
        paramNames.forEach(name => {
            result[name] = params.get(name);
        });
        return result;
    }
};

console.log('[LAPIS3] DetailPageHelper loaded');

// ========================================
// 操作メニュー（三点ドロップダウン）共通制御
// ========================================
window.toggleActionDropdown = function (event) {
    if (event) {
        event.stopPropagation();
        event.preventDefault();
    }
    const container = event.currentTarget ? event.currentTarget.closest('.action-dropdown') : null;
    if (!container) return;
    const menu = container.querySelector('.action-dropdown-menu');
    if (!menu) return;

    // 他の開いているメニューをすべて閉じる
    document.querySelectorAll('.action-dropdown-menu.show').forEach(m => {
        if (m !== menu) m.classList.remove('show');
    });

    menu.classList.toggle('show');
};

// 重複登録防止ガード付きイベントリスナー（外部クリック・Escapeキーで閉じる）
if (!window.actionDropdownInitialized) {
    window.actionDropdownInitialized = true;

    // 外部クリックで閉じる
    document.addEventListener('click', (event) => {
        if (!event.target.closest('.action-dropdown')) {
            document.querySelectorAll('.action-dropdown-menu.show').forEach(m => {
                m.classList.remove('show');
            });
        }
    });

    // Escapeキーで閉じる
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            document.querySelectorAll('.action-dropdown-menu.show').forEach(m => {
                m.classList.remove('show');
            });
        }
    });
}
