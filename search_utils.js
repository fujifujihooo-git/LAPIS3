/**
 * LAPIS3 検索ユーティリティ
 * 
 * 顧客検索用の正規化・検索フィールド生成ロジック。
 * ブラウザ（<script src="search_utils.js">）と
 * Node.js（require('./search_utils')）の双方で利用可能。
 * 
 * 法人格一覧やロジックの修正は本ファイルのみで完結する。
 */

// --- 法人格マスタ定義（将来の追加時はここだけ修正する） ---

var CORPORATE_PREFIXES = [
    '株式会社', '有限会社', '合同会社', 'NPO法人',
    '一般社団法人', '一般財団法人', '合資会社', '合名会社',
    '医療法人', '社団法人', '学校法人', '社会福祉法人'
];

var CORPORATE_KANA_PREFIXES = [
    'カブシキガイシャ', 'ユウゲンガイシャ', 'ゴウドウガイシャ', 'エヌピーオーホウジン',
    'イッパンシャダンホウジン', 'イッパンザイダンホウジン', 'ゴウシガイシャ', 'ゴウメイガイシャ',
    'イリョウホウジン', 'シャダンホウジン', 'ガッコウホウジン', 'シャカイフクシホウジン'
];

// --- 正規化・生成ロジック ---

/**
 * 文字列を検索用に正規化する。
 * ・全角英数字 → 半角小文字
 * ・全角/半角スペース、記号（・-&()）を除去
 */
function normalizeSearchText(str) {
    if (!str) return '';
    // 全角英数字を半角に変換し英字を小文字化
    var val = str.replace(/[Ａ-Ｚａ-ｚ０-９]/g, function(s) {
        return String.fromCharCode(s.charCodeAt(0) - 0xFEE0);
    }).toLowerCase();
    // ひらがなを全角カタカナに変換
    val = val.replace(/[\u3041-\u3096]/g, function(ch) {
        return String.fromCharCode(ch.charCodeAt(0) + 0x60);
    });
    // スペース・記号を除去
    val = val.replace(/[\s\u3000\u30FB\-\uFF0D\&\uFF06\(\)\uFF08\uFF09]/g, '');
    return val;
}

/**
 * customer_name から検索用フィールド search_name を生成する。
 * 法人格プレフィックスを除去し、正規化を適用する。
 * @param {string} name - customer_name の値
 * @returns {string} 正規化された検索名
 */
function generateSearchName(name) {
    if (!name) return '';
    var val = name;
    var regex = new RegExp('^(' + CORPORATE_PREFIXES.join('|') + ')\\s*');
    val = val.replace(regex, '');
    return normalizeSearchText(val);
}

/**
 * customer_kana から検索用フィールド search_kana を生成する。
 * カナ法人格プレフィックスを除去し、正規化を適用する。
 * @param {string} kana - customer_kana の値
 * @returns {string} 正規化されたカナ検索名
 */
function generateSearchKana(kana) {
    if (!kana) return '';
    var val = kana;
    var regex = new RegExp('^(' + CORPORATE_KANA_PREFIXES.join('|') + ')\\s*');
    val = val.replace(regex, '');
    return normalizeSearchText(val);
}

// --- 環境別エクスポート ---
if (typeof module !== 'undefined' && module.exports) {
    // Node.js
    module.exports = {
        CORPORATE_PREFIXES: CORPORATE_PREFIXES,
        CORPORATE_KANA_PREFIXES: CORPORATE_KANA_PREFIXES,
        normalizeSearchText: normalizeSearchText,
        generateSearchName: generateSearchName,
        generateSearchKana: generateSearchKana
    };
} else {
    // ブラウザ
    window.CORPORATE_PREFIXES = CORPORATE_PREFIXES;
    window.CORPORATE_KANA_PREFIXES = CORPORATE_KANA_PREFIXES;
    window.normalizeSearchText = normalizeSearchText;
    window.generateSearchName = generateSearchName;
    window.generateSearchKana = generateSearchKana;
}
