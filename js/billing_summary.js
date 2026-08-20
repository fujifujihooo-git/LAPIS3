/**
 * js/billing_summary.js
 * 
 * 案件選択モーダルの検索高速化のためのキャッシュ (billing_summary) 関連ロジック
 */

const SOURCE_VERSION = 1;
const IMMUTABLE_IGNORE_FIELDS = ['updated_at', 'created_at', 'ui_state'];

/**
 * 見積明細が請求追跡対象かを判定する。
 * 条件変更時は SOURCE_VERSION を引き上げること。
 */
function isTrackableEstimateItem(item) {
    if (!item) return false;
    return item.is_legacy !== true && !!item.estimate_item_id;
}

/**
 * 見積明細オブジェクトを比較用に正規化する（システム項目を除外）。
 */
function normalizeEstimateItem(item) {
    if (!item) return {};
    const normalized = { ...item };
    IMMUTABLE_IGNORE_FIELDS.forEach(field => {
        delete normalized[field];
    });
    return normalized;
}

/**
 * 案件の billing_summary を再集計し、キャッシュを更新する。
 * 
 * @param {string|number} caseId - 案件ID
 * @param {object} [customDb] - 外部の db インスタンス (Node.js環境用)
 * @param {object} [customFirestore] - 外部の firestore モジュール (Node.js環境用)
 * @returns {Promise<void>}
 */
async function rebuildCaseBillingSummary(caseId, customDb, customFirestore) {
    // 依存関係の解決
    const _db = customDb || (typeof db !== 'undefined' ? db : null);
    const _firestore = customFirestore || (typeof firebase !== 'undefined' ? firebase.firestore : null);

    if (!_db) {
        throw new Error('[BillingSummary] Database instance (db) is not initialized.');
    }
    if (!_firestore) {
        throw new Error('[BillingSummary] Firestore module (firebase.firestore) is not resolved.');
    }

    const serverTimestamp = _firestore.FieldValue.serverTimestamp();
    const docIdField = _firestore.FieldPath.documentId();

    const caseRef = _db.collection('cases').doc('case_' + String(caseId));
    const caseDoc = await caseRef.get();

    // 案件ドキュメント不存在時の警告正常終了
    if (!caseDoc.exists) {
        console.warn(`[BillingSummary] Case ${caseId} does not exist. Skipping rebuild.`);
        return;
    }

    const caseData = caseDoc.data();
    const estimateItems = caseData.estimate_items || [];

    // 1. 有効見積明細の抽出
    const activeEstimateItems = estimateItems.filter(isTrackableEstimateItem);
    const activeEstimateCount = activeEstimateItems.length;

    // 2. legacy 明細が存在するか判定
    const hasLegacyItems = estimateItems.some(item => item.is_legacy === true);

    // 3. 案件に紐づく請求明細を case_id で取得
    // 制約: invoice_items.case_id の不整合がある場合、本来請求済みである明細が
    // ここで引っかからず、UI上で「未請求」と誤判定される制約が存在します。
    // この整合性の完全な担保は毎日夜間の監査スクリプト実行に依存します。
    const invoiceItemsSnapshot = await _db.collection('invoice_items')
        .where('case_id', '==', Number(caseId))
        .get();

    const invoiceItems = [];
    invoiceItemsSnapshot.forEach(doc => {
        invoiceItems.push({ id: doc.id, ...doc.data() });
    });

    // 4. invoice_id リストを抽出・重複排除
    const invoiceIds = [...new Set(invoiceItems.map(item => item.invoice_id))].filter(Boolean);

    // 5. 関連請求書（有効なもの status !== '取消'）の取得（30件チャンク分割対策）
    const activeInvoices = new Set();
    const chunkSize = 30;
    for (let i = 0; i < invoiceIds.length; i += chunkSize) {
        const chunk = invoiceIds.slice(i, i + chunkSize).map(id => 'inv_' + String(id));
        const invoicesSnapshot = await _db.collection('invoices')
            .where(docIdField, 'in', chunk)
            .get();
        
        invoicesSnapshot.forEach(doc => {
            const invData = doc.data();
            if (invData.status !== '取消') {
                activeInvoices.add(Number(invData.invoice_id));
            }
        });
    }

    // 6. 有効な請求書に紐づく invoice_items のうち、estimate_item_id が activeEstimateItems に実在するもののみカウント（SSoT再検証）
    const activeEstimateItemIds = new Set(activeEstimateItems.map(item => item.estimate_item_id));
    const billedEstimateItemIds = new Set();

    invoiceItems.forEach(item => {
        if (activeInvoices.has(item.invoice_id)) {
            if (activeEstimateItemIds.has(item.estimate_item_id)) {
                billedEstimateItemIds.add(item.estimate_item_id);
            } else {
                console.warn(`[BillingSummary][Integrity] InvoiceItem ${item.id} has estimate_item_id ${item.estimate_item_id} not belonging to case ${caseId}`);
            }
        }
    });

    // 7. unbilled_count, has_billable_items の算出
    const unbilledCount = activeEstimateCount - billedEstimateItemIds.size;
    const hasBillableItems = unbilledCount > 0; // UI検索用フラグ。Phase 2 では unbilled_amount > 0 判定に拡張

    // 8. billing_summary の更新 (last_updated 汚染を防ぐため、billing_summary フィールドのみを update)
    await caseRef.update({
        billing_summary: {
            has_billable_items: hasBillableItems,
            unbilled_count: unbilledCount,
            active_estimate_count: activeEstimateCount,
            has_legacy_items: hasLegacyItems,
            rebuilt_at: serverTimestamp,
            schema_version: 1,
            source_version: SOURCE_VERSION
        }
    });

    // 9. エラー状態の自動解消
    const errorRef = _db.collection('billing_summary_errors').doc(`case_${caseId}`);
    const errorDoc = await errorRef.get();
    if (errorDoc.exists) {
        const errData = errorDoc.data();
        const autoResolvableTypes = ['CACHE_MISSING', 'CACHE_MISMATCH', 'REBUILD_FAILED'];
        if (autoResolvableTypes.includes(errData.error_type) && errData.resolved !== true) {
            await errorRef.set({
                resolved: true,
                resolved_at: serverTimestamp,
                last_success_at: serverTimestamp
            }, { merge: true });
        }
    }
}

// CommonJS とブラウザ環境の両対応
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        SOURCE_VERSION,
        IMMUTABLE_IGNORE_FIELDS,
        isTrackableEstimateItem,
        normalizeEstimateItem,
        rebuildCaseBillingSummary
    };
}
