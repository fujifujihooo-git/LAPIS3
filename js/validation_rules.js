/**
 * LAPIS3 共通入力バリデーションルール (v2)
 * 
 * 使い方:
 *   HTML側: <input data-validate="tel" ...>
 *   JS側:   DOMContentLoaded で自動初期化（initAll）
 * 
 * 改善点（v2）:
 *   - IME対応: compositionstart/end でフリガナ変換中のフィルタをスキップ
 *   - スペース対応: フリガナに全角・半角スペースを許可
 *   - カーソル補正: フィルタ後のカーソル位置を正確に計算
 *   - エラー表示位置: closest('.form-group') の末尾に挿入
 *   - エラー即時解除: 正しい値に修正した時点でエラーを即座にクリア
 */

const ValidationRules = {

    // ========================================
    // バリデーション種別ごとのルール定義
    // ========================================
    rules: {
        /**
         * 電話番号 / 携帯番号 / FAX番号
         * 半角数字とハイフンのみ
         */
        tel: {
            validate: (val) => !val || /^[0-9-]*$/.test(val),
            message: '半角数字とハイフンのみ入力可能です。',
            filter: (val) => val.replace(/[^0-9-]/g, ''),
            useIME: false
        },

        /**
         * フリガナ
         * 全角カタカナ・長音符・全角/半角スペースのみ
         * ※IME入力が必要なためcomposition対応あり
         */
        kana: {
            validate: (val) => !val || /^[ァ-ヶー　 ]*$/.test(val),
            message: '全角カタカナで入力してください。',
            filter: (val) => val.replace(/[^ァ-ヶー　 ]/g, ''),
            useIME: true  // ★ IME対応が必要
        },

        /**
         * 郵便番号
         * 入力中: 半角数字とハイフンのみ
         * 確定時: 空欄 or 7桁(ハイフンなし) or 3桁-4桁(ハイフンあり)
         */
        zip: {
            validate: (val) => !val || /^(\d{3}-?\d{4})$/.test(val),
            message: '正しい郵便番号形式で入力してください（例: 123-4567）。',
            filter: (val) => val.replace(/[^0-9-]/g, ''),
            useIME: false
        },

        /**
         * メールアドレス
         * 入力中のフィルタはなし（途中で@の前後の文字が消えるため）
         * 確定時のみ形式チェック
         */
        email: {
            validate: (val) => !val || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val),
            message: '正しいメールアドレス形式で入力してください。',
            filter: null,  // リアルタイムフィルタなし
            useIME: false
        },

        /**
         * 半角英数字（許認可番号2 など）
         */
        alphanumeric: {
            validate: (val) => !val || /^[a-zA-Z0-9]*$/.test(val),
            message: '半角英数字のみ入力可能です。',
            filter: (val) => val.replace(/[^a-zA-Z0-9]/g, ''),
            useIME: false
        },

        /**
         * 法人番号（13桁の半角数字）
         * 入力中: 数字以外を除去
         * 確定時: 空欄 or ちょうど13桁
         */
        corporate_num: {
            validate: (val) => !val || /^\d{13}$/.test(val),
            message: '13桁の半角数字で入力してください。',
            filter: (val) => val.replace(/[^0-9]/g, ''),
            useIME: false
        }
    },

    // ========================================
    // バリデーション実行
    // ========================================

    /**
     * 単一フィールドの値をチェックする
     * @param {string} value - 入力値
     * @param {string} type - バリデーション種別
     * @returns {{ valid: boolean, message: string }}
     */
    validateField: function (value, type) {
        const rule = this.rules[type];
        if (!rule) {
            return { valid: true, message: '' };
        }
        const isValid = rule.validate(value);
        return {
            valid: isValid,
            message: isValid ? '' : rule.message
        };
    },

    // ========================================
    // イベントリスナー付与
    // ========================================

    /**
     * 指定のinput要素にバリデーション用イベントを付与する
     * @param {HTMLElement} el - 対象のinput要素
     * @param {string} type - バリデーション種別
     */
    attachValidation: function (el, type) {
        const rule = this.rules[type];
        if (!el || !rule) return;

        // IME変換中フラグ（クロージャで要素ごとに独立管理）
        let isComposing = false;

        // --------------------------------------------------
        // 1. IME対応（kana等、useIME: true の種別のみ）
        // --------------------------------------------------
        if (rule.useIME) {
            el.addEventListener('compositionstart', function () {
                isComposing = true;
            });

            el.addEventListener('compositionend', function () {
                isComposing = false;
                // IME確定後にフィルタを適用
                if (rule.filter) {
                    var filtered = rule.filter(el.value);
                    if (el.value !== filtered) {
                        el.value = filtered;
                    }
                }
                // IME確定後にエラー状態もリフレッシュ
                refreshErrorState(el, type);
            });
        }

        // --------------------------------------------------
        // 2. リアルタイム入力フィルタ（filter が定義されている場合）
        // --------------------------------------------------
        if (rule.filter) {
            el.addEventListener('input', function () {
                // IME変換中はスキップ（確定後にcompositionendで処理）
                if (isComposing) return;

                var pos = el.selectionStart;
                var before = el.value;
                var after = rule.filter(before);

                if (before !== after) {
                    el.value = after;
                    // カーソル位置を正確に補正
                    var newPos = Math.max(0, pos - (before.length - after.length));
                    el.setSelectionRange(newPos, newPos);
                }

                // エラー状態のリフレッシュ（修正入力でエラー即解除）
                refreshErrorState(el, type);
            });
        } else {
            // フィルタなし（email等）でも、入力時にエラー解除は行う
            el.addEventListener('input', function () {
                refreshErrorState(el, type);
            });
        }

        // --------------------------------------------------
        // 3. blur時の最終チェックとエラー表示
        // --------------------------------------------------
        el.addEventListener('blur', function () {
            var result = ValidationRules.validateField(el.value, type);
            showError(el, result);
        });

        // ==========================================================
        // 内部ヘルパー関数
        // ==========================================================

        /**
         * エラー状態をリフレッシュする（入力中にエラーが解消されたら即座にクリア）
         */
        function refreshErrorState(element, validationType) {
            if (element.classList.contains('invalid')) {
                var result = ValidationRules.validateField(element.value, validationType);
                if (result.valid) {
                    showError(element, result);  // エラー解除
                }
            }
        }

        /**
         * エラーの表示/非表示を切り替える
         * エラーメッセージは closest('.form-group') の末尾に挿入
         */
        function showError(element, result) {
            var formGroup = element.closest('.form-group');
            var errorSpan = formGroup
                ? formGroup.querySelector('.validation-error')
                : null;

            if (!result.valid) {
                // --- エラー表示 ---
                element.classList.add('invalid');
                if (formGroup && !errorSpan) {
                    errorSpan = document.createElement('span');
                    errorSpan.className = 'validation-error';
                    formGroup.appendChild(errorSpan);
                }
                if (errorSpan) {
                    errorSpan.textContent = result.message;
                }
            } else {
                // --- エラー解除 ---
                element.classList.remove('invalid');
                if (errorSpan) {
                    errorSpan.remove();
                }
            }
        }
    },

    // ========================================
    // 一括初期化
    // ========================================

    /**
     * ページ内の全 [data-validate] 属性を持つ要素にイベントを登録する
     */
    initAll: function () {
        var elements = document.querySelectorAll('[data-validate]');
        for (var i = 0; i < elements.length; i++) {
            var el = elements[i];
            var type = el.getAttribute('data-validate');
            this.attachValidation(el, type);
        }
    }
};

// ページ読み込み完了時に自動初期化
document.addEventListener('DOMContentLoaded', function () {
    ValidationRules.initAll();
});
