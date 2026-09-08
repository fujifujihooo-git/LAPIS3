/**
 * 書類返却通知書 モーダル制御モジュール (Document Return Modal)
 * 成果物返却管理のモーダル表示、動的入力切り替え、customer_histories 拡張保存、PDF発行を担当します。
 */

(function () {
    'use strict';

    // 履歴カテゴリ定数
    const HISTORY_CATEGORIES = {
        DOCUMENT_RETURN: 'document_return',
        INVOICE:         'invoice',
        PAYMENT:         'payment',
        PERMIT:          'permit',
        RENEWAL_NOTICE:  'renewal_notice'
    };

    // 送付理由テンプレート定義
    const BODY_TEMPLATES = {
        complete: {
            label: '完了返却',
            shipping: (shipDateStr, methodName) => `いつも大変お世話になっております。\n届出・申請の手続きが完了致しましたので、お預かり書類等を${shipDateStr}発送の${methodName}にてお送り致しました。`,
            handDelivery: (shipDateStr) => `いつも大変お世話になっております。\n届出・申請の手続きが完了致しましたので、${shipDateStr}にお手渡しにて書類をお渡し致しました。`
        },
        under_review: {
            label: '審査中返却',
            shipping: (shipDateStr, methodName) => `いつも大変お世話になっております。\n届出・申請の手続きを行い、現在審査中となりましたので、お預かり書類等を${shipDateStr}発送の${methodName}にてお送り致しました。`,
            handDelivery: (shipDateStr) => `いつも大変お世話になっております。\n届出・申請の手続きを行い、現在審査中となりましたので、${shipDateStr}にお手渡しにて書類をお渡し致しました。`
        },
        original_return: {
            label: '原本返却',
            shipping: (shipDateStr, methodName) => `いつも大変お世話になっております。\n原本確認・申請手続きが完了致しましたので、お預かりしておりました原本書類等を${shipDateStr}発送の${methodName}にて返却・お送り致しました。`,
            handDelivery: (shipDateStr) => `いつも大変お世話になっております。\n原本確認・申請手続きが完了致しましたので、お預かりしておりました原本書類等を${shipDateStr}にお手渡しにて返却・お渡し致しました。`
        },
        custom: {
            label: '自由入力',
            shipping: () => `いつも大変お世話になっております。\n`,
            handDelivery: () => `いつも大変お世話になっております。\n`
        }
    };

    class DocumentReturnModal {
        constructor() {
            this.modalElement = null;
            this.currentCustomer = null;
            this.onSuccessCallback = null;
            this.isBodyDirty = false;
            this.isProgrammaticUpdate = false;
        }

        /**
         * モーダルダイアログを開く
         * @param {Object} customer - 顧客オブジェクト
         * @param {Array} contacts - 担当者リスト
         * @param {Function} onSuccess - 完了時コールバック
         */
        open(customer, contacts = [], onSuccess = null) {
            this.currentCustomer = customer;
            this.contactsList = contacts || [];
            this.onSuccessCallback = onSuccess;

            this.ensureModalDOM();
            this.setupContactsDropdown();
            this.resetForm();
            this.bindEvents();

            this.modalElement.style.display = 'block';
        }

        close() {
            if (this.modalElement) {
                this.modalElement.style.display = 'none';
            }
        }

        /**
         * モーダルのHTML構造が存在しない場合、動的にDOMへ挿入
         */
        ensureModalDOM() {
            if (document.getElementById('document-return-modal')) {
                this.modalElement = document.getElementById('document-return-modal');
                return;
            }

            const html = `
            <div id="document-return-modal" class="modal-overlay" style="display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.5); z-index:9999; overflow-y:auto;">
                <div class="modal-dialog" style="max-width:620px; margin:40px auto; background:#fff; border-radius:8px; box-shadow:0 4px 15px rgba(0,0,0,0.2); padding:24px;">
                    <div class="modal-header" style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #e2e8f0; padding-bottom:12px; margin-bottom:16px;">
                        <h3 style="margin:0; font-size:1.25rem; color:#1e293b;">📄 書類返却通知書 出力・返却記録登録</h3>
                        <button type="button" class="btn-close-modal" id="doc-return-btn-close" style="background:none; border:none; font-size:1.5rem; cursor:pointer; color:#64748b;">&times;</button>
                    </div>

                    <form id="doc-return-form">
                        <!-- 顧客情報表示 -->
                        <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:6px; padding:10px 14px; margin-bottom:16px; font-size:0.9rem;">
                            <div><strong>対象顧客:</strong> <span id="doc-return-customer-name">―</span></div>
                        </div>



                        <!-- 宛先担当者 (任意) -->
                        <div id="doc-return-contact-container" class="form-group" style="margin-bottom:16px;">
                            <label style="display:block; font-weight:600; margin-bottom:4px; font-size:0.9rem;">宛先担当者 <span style="color:#64748b; font-size:0.8rem;">(任意)</span></label>
                            <select id="doc-return-contact-select" class="form-control" style="width:100%; padding:8px 12px; border:1px solid #cbd5e1; border-radius:6px;">
                                <option value="">-- 指定なし (会社宛) --</option>
                            </select>
                            <small style="color:#64748b; font-size:0.8rem; display:block; margin-top:2px;">PDFの宛先に顧客担当者名を印字する場合は選択してください。</small>
                        </div>

                        <!-- 返却方法 & その他名称 -->
                        <div style="display:flex; gap:12px; margin-bottom:16px;">
                            <div style="flex:1;">
                                <label style="display:block; font-weight:600; margin-bottom:4px; font-size:0.9rem;">返却方法 <span style="color:#ef4444;">*</span></label>
                                <select id="doc-return-method-select" class="form-control" style="width:100%; padding:8px 12px; border:1px solid #cbd5e1; border-radius:6px;" required>
                                    <option value="takkyubin">宅急便</option>
                                    <option value="letterpack_plus">レターパックプラス</option>
                                    <option value="letterpack_light">レターパックライト</option>
                                    <option value="kani_kakitome">簡易書留</option>
                                    <option value="ordinary_mail">普通郵便</option>
                                    <option value="hand_delivery">直接手渡し</option>
                                    <option value="other">その他</option>
                                </select>
                            </div>
                            <div id="doc-return-method-other-container" style="flex:1; display:none;">
                                <label style="display:block; font-weight:600; margin-bottom:4px; font-size:0.9rem;">その他名称 <span style="color:#ef4444;">*</span></label>
                                <input type="text" id="doc-return-method-other-input" class="form-control" placeholder="例: バイク便" style="width:100%; padding:8px 12px; border:1px solid #cbd5e1; border-radius:6px;">
                            </div>
                        </div>

                        <!-- 発送日 & 到着予定日 -->
                        <div style="display:flex; gap:12px; margin-bottom:16px;">
                            <div style="flex:1;">
                                <label style="display:block; font-weight:600; margin-bottom:4px; font-size:0.9rem;">発送日 / 受渡日 <span style="color:#ef4444;">*</span></label>
                                <input type="date" id="doc-return-ship-date" class="form-control" style="width:100%; padding:8px 12px; border:1px solid #cbd5e1; border-radius:6px;" required>
                            </div>
                            <div id="doc-return-arrival-container" style="flex:1;">
                                <label style="display:block; font-weight:600; margin-bottom:4px; font-size:0.9rem;">到着予定日</label>
                                <input type="date" id="doc-return-arrival-date" class="form-control" style="width:100%; padding:8px 12px; border:1px solid #cbd5e1; border-radius:6px;">
                            </div>
                        </div>

                        <!-- 追跡番号 -->
                        <div id="doc-return-tracking-container" class="form-group" style="margin-bottom:16px;">
                            <label style="display:block; font-weight:600; margin-bottom:4px; font-size:0.9rem;">追跡番号 (送り状・お問い合わせ番号)</label>
                            <input type="text" id="doc-return-tracking-input" class="form-control" placeholder="例: 3906-1259-5800" style="width:100%; padding:8px 12px; border:1px solid #cbd5e1; border-radius:6px;">
                        </div>

                        <!-- 送付理由テンプレート選択 -->
                        <div class="form-group" style="margin-bottom:16px;">
                            <label style="display:block; font-weight:600; margin-bottom:6px; font-size:0.9rem;">送付理由テンプレート</label>
                            <div style="background:#f8fafc; padding:10px 14px; border:1px solid #e2e8f0; border-radius:6px; display:flex; flex-wrap:wrap; gap:14px;">
                                <label style="cursor:pointer;"><input type="radio" name="doc_return_template" value="complete" checked> 完了返却</label>
                                <label style="cursor:pointer;"><input type="radio" name="doc_return_template" value="under_review"> 審査中返却</label>
                                <label style="cursor:pointer;"><input type="radio" name="doc_return_template" value="original_return"> 原本返却</label>
                                <label style="cursor:pointer;"><input type="radio" name="doc_return_template" value="custom"> 自由入力</label>
                            </div>
                        </div>

                        <!-- 通知書本文テキストエリア -->
                        <div class="form-group" style="margin-bottom:16px; position:relative;">
                            <label style="display:block; font-weight:600; margin-bottom:4px; font-size:0.9rem;">通知書本文</label>
                            <textarea id="doc-return-body-input" class="form-control" rows="4" placeholder="通知書に印字される本文" style="width:100%; padding:8px 12px; border:1px solid #cbd5e1; border-radius:6px; font-size:0.9rem; resize:vertical;"></textarea>
                            <div style="display:flex; justify-content:space-between; align-items:center; margin-top:3px;">
                                <small style="color:#64748b; font-size:0.78rem;">※テンプレート選択後に手続き名や一言を自由に加筆・修正できます。編集内容はPDFおよび履歴にそのまま反映されます。</small>
                                <small id="doc-return-body-counter" style="color:#94a3b8; font-size:0.78rem; white-space:nowrap;">0文字</small>
                            </div>
                        </div>

                        <!-- 返却物・同封物 チェックボックス群 -->
                        <div class="form-group" style="margin-bottom:16px;">
                            <label style="display:block; font-weight:600; margin-bottom:6px; font-size:0.9rem;">ご返却書類・同封物 <span style="color:#ef4444;">*</span></label>
                            <div style="background:#f8fafc; padding:10px 14px; border:1px solid #e2e8f0; border-radius:6px;">
                                <div style="display:flex; flex-wrap:wrap; gap:14px; margin-bottom:8px;">
                                    <label style="cursor:pointer;"><input type="checkbox" name="doc_return_items" value="copy" checked> 副本</label>
                                    <label style="cursor:pointer;"><input type="checkbox" name="doc_return_items" value="invoice" checked> 請求書</label>
                                    <label style="cursor:pointer;"><input type="checkbox" name="doc_return_items" value="permit_notice"> 許可通知書</label>
                                </div>
                                <div style="border-top:1px dashed #cbd5e1; padding-top:8px;">
                                    <label style="cursor:pointer;"><input type="checkbox" name="doc_return_items" value="other" id="doc-return-item-other-chk"> その他</label>
                                </div>
                            </div>
                            <div id="doc-return-items-other-container" style="margin-top:6px; display:none;">
                                <input type="text" id="doc-return-items-other-input" class="form-control" placeholder="その他の返却書類名を入力" style="width:100%; padding:6px 10px; border:1px solid #cbd5e1; border-radius:6px; font-size:0.85rem;">
                            </div>
                        </div>

                        <!-- 担当者 -->
                        <div class="form-group" style="margin-bottom:16px;">
                            <label style="display:block; font-weight:600; margin-bottom:4px; font-size:0.9rem;">担当者名</label>
                            <input type="text" id="doc-return-staff-input" class="form-control" placeholder="例: 藤田 宏明" style="width:100%; padding:8px 12px; border:1px solid #cbd5e1; border-radius:6px;">
                        </div>

                        <!-- 備考 -->
                        <div class="form-group" style="margin-bottom:20px;">
                            <label style="display:block; font-weight:600; margin-bottom:4px; font-size:0.9rem;">備考・伝達事項</label>
                            <textarea id="doc-return-remarks-input" class="form-control" rows="2" placeholder="お客様への伝達事項（通知書本文とは別に記録されます）" style="width:100%; padding:8px 12px; border:1px solid #cbd5e1; border-radius:6px; font-size:0.9rem;"></textarea>
                        </div>

                        <!-- 履歴自動登録オプション (推奨) -->
                        <div style="margin-bottom:16px; padding:10px 14px; background:#eff6ff; border:1px solid #bfdbfe; border-radius:6px;">
                            <label style="display:flex; align-items:center; gap:8px; font-weight:600; font-size:0.9rem; color:#1e40af; cursor:pointer; margin:0;">
                                <input type="checkbox" id="doc-return-save-history-chk" style="width:16px; height:16px; accent-color:#1e40af;" checked>
                                対応履歴に記録する（推奨）
                            </label>
                            <small style="display:block; margin-left:24px; color:#475569; font-size:0.8rem; margin-top:2px;">
                                ※チェックONの場合、発行日時や発送詳細（宛先・追跡番号等）を顧客カルテの対応履歴へ自動保存します。
                            </small>
                        </div>

                        <!-- ボタン類 -->
                        <div style="display:flex; justify-content:flex-end; gap:10px; border-top:1px solid #e2e8f0; padding-top:14px;">
                            <button type="button" id="doc-return-btn-cancel" class="btn btn-secondary" style="padding:8px 16px; background:#e2e8f0; color:#334155; border:none; border-radius:6px; cursor:pointer;">キャンセル</button>
                            <button type="submit" id="doc-return-btn-submit" class="btn btn-primary" style="padding:8px 20px; background:#1e40af; color:#fff; border:none; border-radius:6px; cursor:pointer; font-weight:600;">💾 保存 & 帳票PDF発行</button>
                        </div>
                    </form>
                </div>
            </div>
            `;

            document.body.insertAdjacentHTML('beforeend', html);
            this.modalElement = document.getElementById('document-return-modal');
        }



        /**
         * 宛先担当者ドロップダウンの構築（任意選択）
         */
        setupContactsDropdown() {
            const select = document.getElementById('doc-return-contact-select');
            const container = document.getElementById('doc-return-contact-container');

            select.innerHTML = '<option value="">-- 指定なし (会社宛) --</option>';

            const custId = this.currentCustomer ? (this.currentCustomer.customer_id || this.currentCustomer.id) : null;
            const targetContacts = this.contactsList ? this.contactsList.filter(c => Number(c.customer_id) === Number(custId)) : [];

            if (targetContacts.length === 0) {
                container.style.display = 'none';
            } else {
                container.style.display = 'block';
                targetContacts.forEach(c => {
                    const opt = document.createElement('option');
                    opt.value = c.contact_id || c.id;
                    opt.textContent = c.contact_name;
                    if (c.is_primary) opt.selected = true;
                    select.appendChild(opt);
                });
            }
        }

        /**
         * フォームの初期値セット
         */
        resetForm() {
            const custNameSpan = document.getElementById('doc-return-customer-name');
            if (this.currentCustomer) {
                custNameSpan.innerText = this.currentCustomer.customer_name || '―';
            }

            const today = new Date();
            const tomorrow = new Date(today);
            tomorrow.setDate(tomorrow.getDate() + 1);

            const formatDateInput = (d) => {
                const yyyy = d.getFullYear();
                const mm = String(d.getMonth() + 1).padStart(2, '0');
                const dd = String(d.getDate()).padStart(2, '0');
                return `${yyyy}-${mm}-${dd}`;
            };

            document.getElementById('doc-return-ship-date').value = formatDateInput(today);
            document.getElementById('doc-return-arrival-date').value = formatDateInput(tomorrow);
            document.getElementById('doc-return-tracking-input').value = '';
            document.getElementById('doc-return-method-select').value = 'takkyubin';
            document.getElementById('doc-return-method-other-input').value = '';
            document.getElementById('doc-return-remarks-input').value = '';

            let staffName = '';
            try {
                const session = JSON.parse(localStorage.getItem('lapis3_session')) || {};
                staffName = session.staff_name || '';
            } catch (e) {}
            document.getElementById('doc-return-staff-input').value = staffName;

            const chks = document.querySelectorAll('input[name="doc_return_items"]');
            chks.forEach(chk => {
                if (chk.value === 'copy' || chk.value === 'invoice') {
                    chk.checked = true;
                } else {
                    chk.checked = false; // permit_notice, other
                }
            });
            document.getElementById('doc-return-items-other-input').value = '';
            document.getElementById('doc-return-items-other-container').style.display = 'none';

            const historyChk = document.getElementById('doc-return-save-history-chk');
            if (historyChk) {
                historyChk.checked = true;
                const submitBtn = document.getElementById('doc-return-btn-submit');
                if (submitBtn) submitBtn.innerText = '💾 保存 & 帳票PDF発行';
            }

            // テンプレート種別のlocalStorage復元（種別のみ。本文は保存しない = 証跡汚染防止）
            const lastTpl = localStorage.getItem('lapis3_doc_return_last_tpl');
            const validTpls = ['complete', 'under_review', 'original_return', 'custom'];
            const tplToRestore = (lastTpl && validTpls.includes(lastTpl)) ? lastTpl : 'complete';
            const tplRadio = document.querySelector(`input[name="doc_return_template"][value="${tplToRestore}"]`);
            if (tplRadio) tplRadio.checked = true;

            // isBodyDirty リセット
            this.isBodyDirty = false;
            this.isProgrammaticUpdate = false;

            this.handleMethodChange();
            // テンプレート本文を初期生成
            this.generateAndSetBody();
        }

        /**
         * 返却方法変更に応じた動的UI切り替え
         */
        handleMethodChange() {
            const method = document.getElementById('doc-return-method-select').value;
            const otherContainer = document.getElementById('doc-return-method-other-container');
            const arrivalContainer = document.getElementById('doc-return-arrival-container');
            const trackingContainer = document.getElementById('doc-return-tracking-container');
            const methodOtherInput = document.getElementById('doc-return-method-other-input');

            if (method === 'other') {
                otherContainer.style.display = 'block';
                methodOtherInput.setAttribute('required', 'true');
            } else {
                otherContainer.style.display = 'none';
                methodOtherInput.removeAttribute('required');
            }

            if (method === 'ordinary_mail' || method === 'hand_delivery') {
                arrivalContainer.style.display = 'none';
                trackingContainer.style.display = 'none';
            } else {
                arrivalContainer.style.display = 'block';
                trackingContainer.style.display = 'block';
            }

            // リアルタイム本文更新（isBodyDirty === false の場合のみ）
            if (!this.isBodyDirty) {
                this.generateAndSetBody();
            }
        }

        /**
         * 現在のテンプレート種別・発送方法・発送日から本文テキストを生成
         */
        generateBodyText() {
            const tplRadio = document.querySelector('input[name="doc_return_template"]:checked');
            const tplKey = tplRadio ? tplRadio.value : 'complete';
            const tpl = BODY_TEMPLATES[tplKey];
            if (!tpl) return '';

            const method = document.getElementById('doc-return-method-select').value;
            const methodOther = document.getElementById('doc-return-method-other-input').value.trim();
            const shipDateRaw = document.getElementById('doc-return-ship-date').value;

            // 発送方法名取得
            const deliveryMethodNames = {
                takkyubin:        '宅急便',
                letterpack_plus:  'レターパックプラス',
                letterpack_light: 'レターパックライト',
                kani_kakitome:    '簡易書留',
                ordinary_mail:    '普通郵便',
                hand_delivery:    '直接手渡し',
                other:            methodOther || 'その他'
            };
            const methodName = deliveryMethodNames[method] || 'その他';

            // 発送日テキスト
            let shipDateStr = '本日';
            if (shipDateRaw) {
                const parts = shipDateRaw.split('-');
                if (parts.length >= 3) {
                    shipDateStr = `${parseInt(parts[1], 10)}月${parseInt(parts[2], 10)}日`;
                }
            }

            if (method === 'hand_delivery') {
                return tpl.handDelivery(shipDateStr);
            } else {
                return tpl.shipping(shipDateStr, methodName);
            }
        }

        /**
         * テキストエリアに本文をプログラム的にセット（isProgrammaticUpdate保護付き）
         */
        generateAndSetBody() {
            const bodyInput = document.getElementById('doc-return-body-input');
            if (!bodyInput) return;

            const text = this.generateBodyText();
            this.isProgrammaticUpdate = true;
            bodyInput.value = text;
            this.isProgrammaticUpdate = false;
            this.updateBodyCounter();
        }

        /**
         * 文字数カウンタ更新
         */
        updateBodyCounter() {
            const bodyInput = document.getElementById('doc-return-body-input');
            const counter = document.getElementById('doc-return-body-counter');
            if (bodyInput && counter) {
                counter.textContent = `${bodyInput.value.length}文字`;
            }
        }

        /**
         * イベントリスナーのバインド
         */
        bindEvents() {
            const closeBtn = document.getElementById('doc-return-btn-close');
            const cancelBtn = document.getElementById('doc-return-btn-cancel');
            const methodSelect = document.getElementById('doc-return-method-select');
            const itemOtherChk = document.getElementById('doc-return-item-other-chk');
            const form = document.getElementById('doc-return-form');
            const bodyInput = document.getElementById('doc-return-body-input');
            const shipDateInput = document.getElementById('doc-return-ship-date');

            closeBtn.onclick = () => this.close();
            cancelBtn.onclick = () => this.close();

            methodSelect.onchange = () => this.handleMethodChange();

            // 発送日変更 → リアルタイム本文更新（isBodyDirty保護）
            if (shipDateInput) {
                shipDateInput.onchange = () => {
                    if (!this.isBodyDirty) {
                        this.generateAndSetBody();
                    }
                };
            }

            // テンプレートラジオ変更 → isBodyDirtyリセット + 本文再生成
            const tplRadios = document.querySelectorAll('input[name="doc_return_template"]');
            tplRadios.forEach(radio => {
                radio.onchange = () => {
                    this.isBodyDirty = false;
                    this.generateAndSetBody();
                };
            });

            // 本文テキストエリア入力 → isProgrammaticUpdate保護 + isBodyDirty + 自由入力切替
            if (bodyInput) {
                bodyInput.addEventListener('input', () => {
                    if (this.isProgrammaticUpdate) return;
                    this.isBodyDirty = true;
                    // 自由入力ラジオへ自動切替
                    const customRadio = document.querySelector('input[name="doc_return_template"][value="custom"]');
                    if (customRadio) customRadio.checked = true;
                    this.updateBodyCounter();
                });
            }

            itemOtherChk.onchange = (e) => {
                const container = document.getElementById('doc-return-items-other-container');
                const otherInput = document.getElementById('doc-return-items-other-input');
                if (e.target.checked) {
                    container.style.display = 'block';
                    otherInput.setAttribute('required', 'true');
                } else {
                    container.style.display = 'none';
                    otherInput.removeAttribute('required');
                }
            };

            form.onsubmit = async (e) => {
                e.preventDefault();
                await this.handleSubmit();
            };
        }

        /**
         * 動的タイトルの生成
         */
        getDynamicSubject(method, methodOther) {
            const map = {
                takkyubin:        '📦 宅急便で発送',
                letterpack_plus:  '📦 レターパックプラスで発送',
                letterpack_light: '📦 レターパックライトで発送',
                kani_kakitome:    '📦 簡易書留で発送',
                ordinary_mail:    '📦 普通郵便で発送',
                hand_delivery:    '📦 直接手渡しでお渡し',
                other:            `📦 ${methodOther || 'その他'}で発送`
            };
            return map[method] || '📦 書類返却通知';
        }

        /**
         * 保存 & 帳票PDF発行フォーム送信処理
         */
        async handleSubmit() {
            const submitBtn = document.getElementById('doc-return-btn-submit');
            submitBtn.disabled = true;
            submitBtn.innerText = '処理中...';

            try {
                // 1. 返却物チェックボックス値の収集
                const chks = document.querySelectorAll('input[name="doc_return_items"]:checked');
                const returnedItems = Array.from(chks).map(c => c.value);

                if (returnedItems.length === 0) {
                    alert('返却物・同封物を少なくとも1つ選択してください。');
                    submitBtn.disabled = false;
                    submitBtn.innerText = '💾 保存 & 帳票PDF発行';
                    return;
                }



                // 3. 入力値の取得
                const method = document.getElementById('doc-return-method-select').value;
                const methodOther = document.getElementById('doc-return-method-other-input').value.trim();
                const shipDateRaw = document.getElementById('doc-return-ship-date').value;
                const shipDate = shipDateRaw ? shipDateRaw.replace(/-/g, '/') : '';
                const arrivalDate = (method === 'ordinary_mail' || method === 'hand_delivery')
                    ? ''
                    : document.getElementById('doc-return-arrival-date').value.replace(/-/g, '/');
                const trackingNumber = (method === 'ordinary_mail' || method === 'hand_delivery')
                    ? ''
                    : document.getElementById('doc-return-tracking-input').value.trim();
                const staffName = document.getElementById('doc-return-staff-input').value.trim();
                const remarks = document.getElementById('doc-return-remarks-input').value.trim();
                const itemsOther = document.getElementById('doc-return-items-other-input').value.trim();
                const bodyMessage = document.getElementById('doc-return-body-input').value.trim();

                const customerId = this.currentCustomer ? (this.currentCustomer.customer_id || this.currentCustomer.id) : '';

                let createdBy = '担当者';
                try {
                    const session = JSON.parse(localStorage.getItem('lapis3_session')) || {};
                    createdBy = session.staff_name || session.user_id || '担当者';
                } catch (e) {}

                // 動的タイトル
                const subject = this.getDynamicSubject(method, methodOther);

                // 返却物の日本語名要約 (内容生成用)
                const itemLabels = returnedItems.map(k => {
                    if (k === 'permit_notice') return '許可通知書';
                    if (k === 'copy') return '副本';
                    if (k === 'invoice') return '請求書';
                    if (k === 'other') return itemsOther ? `その他(${itemsOther})` : 'その他';
                    return k;
                });

                // 配送方法の日本語名を取得
                const deliveryMethodNames = {
                    takkyubin:        '宅急便',
                    letterpack_plus:  'レターパックプラス',
                    letterpack_light: 'レターパックライト',
                    kani_kakitome:    '簡易書留',
                    ordinary_mail:    '普通郵便',
                    hand_delivery:    '直接手渡し',
                    other:            methodOther || 'その他'
                };
                const deliveryMethodName = deliveryMethodNames[method] || 'その他';

                // 履歴保存フラグの取得
                const historyChk = document.getElementById('doc-return-save-history-chk');
                const shouldSaveHistory = historyChk ? historyChk.checked : true;

                // 宛先担当者名の取得
                const contactSelect = document.getElementById('doc-return-contact-select');
                let selectedContactName = null;
                if (contactSelect && contactSelect.value) {
                    const foundContact = this.contactsList.find(c => String(c.contact_id || c.id) === String(contactSelect.value));
                    if (foundContact) selectedContactName = foundContact.contact_name;
                }
                const contactDisplay = selectedContactName ? `${selectedContactName} 様` : '（会社宛）';

                // 発行日時の自動生成 (YYYY/MM/DD HH:mm)
                const now = new Date();
                const pad = (n) => String(n).padStart(2, '0');
                const issuedAtStr = `${now.getFullYear()}/${pad(now.getMonth() + 1)}/${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;

                // 返却書類リストのテキスト化
                const itemsListStr = itemLabels.map(item => `・${item}`).join('\n');

                // 履歴本文（content）: 発送の事実が100%再現できる完全フォーマット
                const contentLines = [
                    `発行日時：${issuedAtStr}`,
                    `発送方法：${deliveryMethodName}`,
                    trackingNumber ? `追跡番号：${trackingNumber}` : null,
                    `宛先担当者：${contactDisplay}`,
                    shipDate ? `発送日：${shipDate}` : null,
                    arrivalDate ? `到着予定日：${arrivalDate}` : null,
                    '',
                    '通知文：',
                    bodyMessage || '（通知文なし）',
                    '',
                    '返却書類：',
                    itemsListStr
                ];
                if (remarks) {
                    contentLines.push('', `伝達事項：\n${remarks}`);
                }
                const fullContent = contentLines.filter(line => line !== null).join('\n');

                // レコードオブジェクト
                const record = {
                    customer_id: Number(customerId),

                    history_type: "書類発送",
                    history_category: HISTORY_CATEGORIES.DOCUMENT_RETURN,

                    subject: subject,
                    content: fullContent,
                    body_message: bodyMessage || null,  // 通知文を独立保存（スネークケース統一）

                    delivery_method: method,
                    delivery_method_other: method === 'other' ? methodOther : null,

                    ship_date: shipDate,
                    arrival_date: arrivalDate || null,
                    tracking_number: trackingNumber || null,

                    returned_items: returnedItems,
                    returned_items_other: returnedItems.includes('other') ? itemsOther : null,

                    staff_name: staffName || '担当者',
                    remarks: null
                };

                // localStorage にテンプレート種別のみ保存（本文は保存しない = 証跡汚染防止）
                const selectedTpl = document.querySelector('input[name="doc_return_template"]:checked');
                if (selectedTpl) {
                    localStorage.setItem('lapis3_doc_return_last_tpl', selectedTpl.value);
                }

                // 4. customer_histories コレクションへの保存 (チェックON時のみ実行)
                if (shouldSaveHistory) {
                    if (window.db) {
                        const shipDateObj = shipDateRaw ? new Date(shipDateRaw) : new Date();
                        
                        const docData = Object.assign({}, record, {
                            response_date: firebase.firestore.Timestamp.fromDate(shipDateObj),
                            created_at: firebase.firestore.FieldValue.serverTimestamp(),
                            created_by_name: createdBy,
                            deleted_at: null
                        });

                        await window.db.collection('customer_histories').add(docData);
                        console.log('✅ customer_histories への書類返却履歴保存が完了しました。', docData);
                    } else {
                        console.warn('⚠️ window.db が未定義のため、Firestore保存をスキップしてPDF生成を実行します。');
                    }
                } else {
                    console.log('ℹ️ 「対応履歴に記録する」がOFFのため、履歴保存はスキップされました。');
                }

                // 5. PDF 帳票発行（body_messageをrecordに含めて渡す → PDFが動的本文を使用）
                const printCustomer = Object.assign({}, this.currentCustomer);
                printCustomer.contact_name = selectedContactName || '';

                const report = new window.DocumentReturnReport();
                await report.generate(printCustomer, record);

                report.preview();

                if (shouldSaveHistory) {
                    alert('書類返却履歴を登録し、返却通知書PDFを発行しました。');
                } else {
                    alert('返却通知書PDFを発行しました。（※対応履歴の保存はスキップされました）');
                }

                this.close();

                if (this.onSuccessCallback && shouldSaveHistory) {
                    this.onSuccessCallback(record);
                }
            } catch (err) {
                console.error('書類返却通知書の発行・保存処理でエラーが発生しました:', err);
                alert(`エラーが発生しました: ${err.message}`);
            } finally {
                submitBtn.disabled = false;
                submitBtn.innerText = '💾 保存 & 帳票PDF発行';
            }
        }
    }

    window.DocumentReturnModal = DocumentReturnModal;
    window.HISTORY_CATEGORIES = HISTORY_CATEGORIES;
})();
