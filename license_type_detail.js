/**
 * license_type_detail.js
 * 許認可種別詳細画面
 *
 * 設計原則:
 * - UI初期化(initUI)とデータ初期化(initData)を分離し、UI不整合が業務ロジックに影響しない構造
 * - DOM要素取得は safeGet() を通じ、null時はwarn出力＋処理スキップ（無言失敗の撲滅）
 * - IDはシステムが採番する責務。ユーザー入力に依存しない
 * - バリデーションはユーザー入力項目（種別名等）のみに限定
 */
document.addEventListener('DOMContentLoaded', () => {
    console.log('License Type Detail Initialized');

    // =========================================================================
    // Safe DOM Access Helper
    // =========================================================================
    /**
     * DOM要素を安全に取得する。見つからない場合はconsole.warnを出力しnullを返す。
     * @param {string} id - 要素のID
     * @param {string} [label] - ログ出力用のラベル（省略時はidを使用）
     * @returns {HTMLElement|null}
     */
    function safeGetById(id, label) {
        const el = document.getElementById(id);
        if (!el) {
            console.warn(`[DOM] 要素が見つかりません: #${id} (${label || id})`);
        }
        return el;
    }

    function safeQuery(selector, label) {
        const el = document.querySelector(selector);
        if (!el) {
            console.warn(`[DOM] 要素が見つかりません: ${selector} (${label || selector})`);
        }
        return el;
    }

    /**
     * DOM要素に安全に値をセットする。要素がnullの場合はスキップ。
     */
    function safeSetValue(el, value) {
        if (el) el.value = value;
    }

    function safeSetText(el, text) {
        if (el) el.textContent = text;
    }

    function safeSetChecked(el, checked) {
        if (el) el.checked = checked;
    }

    // =========================================================================
    // DOM References（全てnull安全）
    // =========================================================================
    const dom = {
        pageTitle:        safeQuery('#page-content h2', 'ページタイトル'),
        licenseTypeId:    safeGetById('license-type-id', 'ID入力'),
        licenseTypeName:  safeGetById('license-type-name', '種別名'),
        hasExpiry:        safeGetById('has-expiry', '有効期限チェック'),
        noticeDaysGroup:  safeGetById('notice-days-group', '案内日数グループ'),
        defaultNoticeDays:safeGetById('default-notice-days', 'デフォルト案内日数'),
        category:         safeGetById('category', 'カテゴリ'),
        status:           safeGetById('status', '状態'),
        sortOrder:        safeGetById('sort-order', '表示順'),
        remarks:          safeGetById('remarks', '備考'),
        createdDate:      safeGetById('created-date', '登録日表示'),
        lastUpdated:      safeGetById('last-updated', '最終更新日表示'),
        btnBack:          safeGetById('btn-back', '戻るボタン'),
        btnSave:          safeGetById('btn-save', '保存ボタン'),
        btnDelete:        safeGetById('btn-delete', '削除ボタン'),
    };

    // =========================================================================
    // State
    // =========================================================================
    let currentIdParam = null;  // URLパラメータ: 'new' or 数値文字列
    let currentDocId = null;    // Firestore Document ID (例: 'lt_1000')
    let currentData = null;     // 現在読み込み済のドキュメントデータ

    // =========================================================================
    // Utility
    // =========================================================================
    function getUrlParameter(name) {
        return new URLSearchParams(window.location.search).get(name);
    }

    function isNewMode() {
        return currentIdParam === 'new';
    }

    // =========================================================================
    // ① init処理の分離: initUI() + initData()
    // =========================================================================

    /**
     * UI初期化（表示制御のみ）。失敗してもデータ処理に影響しない。
     */
    function initUI() {
        try {
            if (isNewMode()) {
                safeSetText(dom.pageTitle, '新規許認可種別登録');
                safeSetChecked(dom.hasExpiry, true);
                // 削除ボタンは新規時は非表示
                if (dom.btnDelete) dom.btnDelete.style.display = 'none';
            }
            toggleNoticeDaysGroup();
        } catch (error) {
            console.warn('[initUI] UI初期化で非致命的エラー:', error.message);
            // UI初期化の失敗はデータ処理をブロックしない
        }
    }

    /**
     * データ初期化（Firestoreからの読込 or ID採番）。
     * これが業務の中核であり、必ず実行される。
     */
    async function initData() {
        if (isNewMode()) {
            // --- 新規モード: ID自動採番 ---
            try {
                const nextId = await getNextSequence('license_types');
                safeSetValue(dom.licenseTypeId, nextId);
                console.log(`[initData] 新規ID採番完了: ${nextId}`);
            } catch (error) {
                console.error('[initData] ID採番に失敗:', error);
                showToast('IDの自動採番に失敗しました。保存時に再試行します。', 'error');
                // IDは空欄のまま。saveData()でフォールバック採番を行う
            }
        } else {
            // --- 編集モード: 既存データ読込 ---
            const id = parseInt(currentIdParam);
            if (isNaN(id)) {
                showToast('無効なIDパラメータです', 'error');
                console.error(`[initData] 無効なURLパラメータ: ${currentIdParam}`);
                return;
            }

            try {
                const snapshot = await db.collection('license_types')
                    .where('license_type_id', '==', id)
                    .limit(1)
                    .get();

                if (!snapshot.empty) {
                    const doc = snapshot.docs[0];
                    currentDocId = doc.id;
                    currentData = doc.data();
                    loadData(currentData);

                    // 削除ボタン表示制御（管理者のみ）
                    if (dom.btnDelete) {
                        dom.btnDelete.style.display = isUserAdmin() ? 'inline-block' : 'none';
                    }
                    console.log(`[initData] データ読込完了: docId=${currentDocId}`);
                } else {
                    alert('許認可種別が見つかりません。');
                    window.location.href = 'license_types_list.html';
                }
            } catch (error) {
                console.error('[initData] データ読込エラー:', error);
                showToast('データの読み込みに失敗しました', 'error');
            }
        }
    }

    /**
     * メインエントリーポイント。
     * initUI → initData の順で実行。UIの失敗がデータに波及しない。
     */
    function init() {
        const tPageStart = performance.now();
        try {
            currentIdParam = getUrlParameter('id');

            if (!currentIdParam) {
                alert('パラメータが不正です。一覧に戻ります。');
                window.location.href = 'license_types_list.html';
                return;
            }

            // Phase 1: UI初期化（非致命的）
            initUI();
            console.log(`[Perf] Phase 1 (Sync UI) completed in ${(performance.now() - tPageStart).toFixed(1)}ms`);

            // Phase 2: データ初期化（中核処理） - Fire & Forget
            loadAllData();

        } catch (error) {
            // ⑤ 最外殻のエラーハンドリング: 想定外の例外を捕捉
            console.error('[init] 初期化中に予期しないエラーが発生:', error);
            showToast('画面の初期化に失敗しました。ページを再読込してください。', 'error');
        }
    }

    async function loadAllData() {
        const t2Start = performance.now();
        await initData();
        console.log(`[Perf] Phase 2 data loaded in ${(performance.now() - t2Start).toFixed(1)}ms`);
    }

    // =========================================================================
    // Load Data（編集モード用）
    // =========================================================================
    function loadData(licenseType) {
        safeSetValue(dom.licenseTypeId, licenseType.license_type_id);
        safeSetValue(dom.licenseTypeName, licenseType.license_type_name);
        safeSetChecked(dom.hasExpiry, licenseType.has_expiry);
        safeSetValue(dom.defaultNoticeDays, licenseType.default_notice_days || '');
        safeSetValue(dom.category, licenseType.category || '');
        safeSetValue(dom.status, licenseType.status);
        safeSetValue(dom.sortOrder,
            (licenseType.sort_order !== undefined && licenseType.sort_order !== null)
                ? licenseType.sort_order : '');
        safeSetValue(dom.remarks, licenseType.remarks || '');
        safeSetText(dom.createdDate, licenseType.created_date || '-');
        safeSetText(dom.lastUpdated, formatToJST(licenseType.last_updated));
        toggleNoticeDaysGroup();
    }

    // =========================================================================
    // Toggle Notice Days Group
    // =========================================================================
    function toggleNoticeDaysGroup() {
        if (!dom.hasExpiry || !dom.noticeDaysGroup) return;

        if (dom.hasExpiry.checked) {
            dom.noticeDaysGroup.style.display = 'block';
        } else {
            dom.noticeDaysGroup.style.display = 'none';
            safeSetValue(dom.defaultNoticeDays, '');
        }
    }

    // =========================================================================
    // ③④ Save Data — IDは生成する責務、バリデーションはユーザー入力のみ
    // =========================================================================
    async function saveData() {
        // 二重送信防止
        if (dom.btnSave) dom.btnSave.disabled = true;

        try {
            // --- ④ バリデーション: ユーザー入力項目のみ ---
            const typeName = dom.licenseTypeName ? dom.licenseTypeName.value.trim() : '';
            if (!typeName) {
                alert('種別名を入力してください。');
                return;
            }

            // --- ③ ID採番の強制保証 ---
            let numericId = dom.licenseTypeId ? parseInt(dom.licenseTypeId.value) : NaN;

            if (isNaN(numericId)) {
                // IDが未設定 → 保存前に必ず getNextSequence() でフォールバック採番
                console.warn('[saveData] IDが未設定のため、保存前に自動採番を実行します');
                try {
                    numericId = await getNextSequence('license_types');
                    safeSetValue(dom.licenseTypeId, numericId);
                    console.log(`[saveData] フォールバック採番完了: ${numericId}`);
                } catch (seqError) {
                    console.error('[saveData] ID自動採番に失敗:', seqError);
                    showToast('IDの自動採番に失敗しました。再度お試しください。', 'error');
                    return;
                }
            }

            // --- データ構築 ---
            const now = new Date().toLocaleString();
            const data = {
                license_type_id: numericId,
                license_type_name: typeName,
                category: dom.category ? dom.category.value.trim() : '',
                has_expiry: dom.hasExpiry ? dom.hasExpiry.checked : false,
                default_notice_days: (dom.hasExpiry && dom.hasExpiry.checked && dom.defaultNoticeDays && dom.defaultNoticeDays.value)
                    ? parseInt(dom.defaultNoticeDays.value)
                    : null,
                status: dom.status ? dom.status.value : 'active',
                sort_order: (dom.sortOrder && dom.sortOrder.value) ? parseInt(dom.sortOrder.value) : 999,
                remarks: dom.remarks ? dom.remarks.value.trim() : '',
                last_updated: now
            };

            // --- Firestore書き込み ---
            if (isNewMode()) {
                const docId = `lt_${numericId}`;
                data.created_date = now;
                await saveToFirestore('license_types', docId, data);
                showToast('新規登録しました', 'success');

                // 内部状態更新: 新規 → 編集モードへ遷移
                currentIdParam = numericId.toString();
                currentDocId = docId;
                currentData = data;
                history.replaceState(null, '', `?id=${numericId}`);

                // 削除ボタン表示（管理者のみ）
                if (dom.btnDelete) {
                    dom.btnDelete.style.display = isUserAdmin() ? 'inline-block' : 'none';
                }
                // タイトル更新
                safeSetText(dom.pageTitle, '許認可種別詳細');

                console.log(`[saveData] 新規登録完了: docId=${docId}, id=${numericId}`);
            } else {
                data.created_date = currentData?.created_date || now;
                const docId = currentDocId || `lt_${numericId}`;
                await saveToFirestore('license_types', docId, data);
                currentData = data;
                showToast('保存しました', 'success');
                console.log(`[saveData] 更新完了: docId=${docId}`);
            }
        } catch (error) {
            console.error('[saveData] 保存処理でエラー:', error);
            showToast('保存に失敗しました。再度お試しください。', 'error');
        } finally {
            // 二重送信防止解除
            if (dom.btnSave) dom.btnSave.disabled = false;
        }
    }

    // =========================================================================
    // Delete Data
    // =========================================================================
    async function deleteData() {
        if (!isUserAdmin()) {
            alert('削除権限がありません。');
            return;
        }
        if (isNewMode()) return;

        const oldId = parseInt(currentIdParam);

        // 紐付きチェック
        try {
            const [casesSnapshot, licensesSnapshot] = await Promise.all([
                db.collection('cases').where('license_type_id', '==', oldId).limit(1).get(),
                db.collection('customer_licenses').where('license_type_id', '==', oldId).limit(1).get()
            ]);

            if (casesSnapshot.size > 0 || licensesSnapshot.size > 0) {
                alert('この許認可種別は案件または許認可データで使用されているため削除できません。\n状態を「無効」に変更することを検討してください。');
                return;
            }
        } catch (error) {
            console.error('[deleteData] 紐付きチェックエラー:', error);
            showToast('削除前チェックに失敗しました', 'error');
            return;
        }

        if (!confirm('本当に削除しますか？この操作は取り消せません。')) {
            return;
        }

        try {
            if (!currentDocId) {
                throw new Error('Firestore Document IDが取得できていません');
            }
            await db.collection('license_types').doc(currentDocId).delete();
            console.log(`[deleteData] ドキュメント削除完了: ${currentDocId}`);
            showToast('削除しました', 'success');
            setTimeout(() => { window.location.href = 'license_types_list.html'; }, 800);
        } catch (error) {
            console.error('[deleteData] 削除処理エラー:', error);
            showToast('削除に失敗しました', 'error');
        }
    }

    // =========================================================================
    // Event Listeners（null安全）
    // =========================================================================
    if (dom.hasExpiry) dom.hasExpiry.addEventListener('change', toggleNoticeDaysGroup);
    if (dom.btnBack)  dom.btnBack.addEventListener('click', () => window.location.href = 'license_types_list.html');
    if (dom.btnSave)  dom.btnSave.addEventListener('click', saveData);
    if (dom.btnDelete) dom.btnDelete.addEventListener('click', deleteData);

    // =========================================================================
    // Start
    // =========================================================================
    init();
});
