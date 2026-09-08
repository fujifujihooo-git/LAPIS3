/**
 * レターパック宛名印刷 モーダル制御モジュール (Shipping Label Modal)
 * 顧客カルテからのレターパック（及び将来の発送方法）宛名印刷モーダルのUI表示、
 * 担当者選択ルール（御中・様変換）、書類選択ソート、customer_histories 履歴保存を担当します。
 */

(function () {
    'use strict';

    class ShippingLabelModal {
        constructor() {
            this.modalElement = null;
            this.currentCustomer = null;
            this.contactsList = [];
            this.staffList = [];
            this.officesList = [];
            this.onSuccessCallback = null;
        }

        /**
         * モーダルを開く
         * @param {Object} customer - 顧客情報
         * @param {Array} contacts - 顧客担当者リスト
         * @param {Array} staffMembers - 事務所スタッフリスト
         * @param {Function} onSuccess - 保存＆生成完了コールバック
         */
        open(customer, contacts = [], staffMembers = [], onSuccess = null, offices = []) {
            if (!customer) {
                alert('顧客情報が取得できません。');
                return;
            }
            this.currentCustomer = customer;
            this.contactsList = contacts || [];
            this.staffList = staffMembers || [];
            this.officesList = offices || [];
            this.onSuccessCallback = onSuccess;

            this.ensureModalDOM();
            this.setupContactsDropdown();
            this.setupStaffDropdown();
            this.resetForm();
            this.bindEvents();

            this.modalElement.style.display = 'flex';
        }

        close() {
            if (this.modalElement) {
                this.modalElement.style.display = 'none';
            }
        }

        /**
         * モーダルDOMを動的に生成（存在しない場合）
         */
        ensureModalDOM() {
            if (document.getElementById('shipping-label-modal')) {
                this.modalElement = document.getElementById('shipping-label-modal');
                return;
            }

            const html = `
            <div id="shipping-label-modal" class="modal-overlay" style="display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.5); z-index:9999; align-items:center; justify-content:center; overflow-y:auto; padding:20px;">
                <div class="modal-dialog" style="width:100%; max-width:620px; background:#fff; border-radius:10px; box-shadow:0 10px 25px rgba(0,0,0,0.2); padding:24px; max-height:90vh; overflow-y:auto;">
                    <div class="modal-header" style="display:flex; justify-content:space-between; align-items:center; border-bottom:2px solid #e2e8f0; padding-bottom:12px; margin-bottom:20px;">
                        <h3 style="margin:0; font-size:1.3rem; color:#1e293b; font-weight:700; display:flex; align-items:center; gap:8px;">
                            ✉️ レターパック宛名印刷
                        </h3>
                        <button type="button" class="btn-close-modal" id="ship-label-btn-close" style="background:none; border:none; font-size:1.6rem; cursor:pointer; color:#64748b; transition:color 0.2s;">&times;</button>
                    </div>

                    <form id="ship-label-form" style="display:flex; flex-direction:column; gap:16px;">
                        <!-- 顧客概要 -->
                        <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:12px 16px;">
                            <div style="font-size:0.95rem; color:#334155;">
                                <strong>送信先顧客:</strong> <span id="ship-label-customer-name" style="font-size:1.05rem; font-weight:700; color:#0f172a;">―</span>
                            </div>
                            <div style="font-size:0.85rem; color:#64748b; margin-top:4px;" id="ship-label-customer-addr">―</div>
                        </div>

                        <!-- 宛先担当者 -->
                        <div class="form-group">
                            <label style="display:block; font-weight:600; margin-bottom:6px; color:#334155;">宛先担当者（顧客担当者）</label>
                            <select id="ship-label-contact-select" class="form-control" style="width:100%; padding:9px 12px; border:1px solid #cbd5e1; border-radius:6px; background:#fff; font-size:0.95rem;">
                                <option value="">-- 担当者未選択（会社宛・御中） --</option>
                            </select>
                            <small style="color:#64748b; font-size:0.8rem; display:block; margin-top:4px;">※未選択の場合は自動的に「会社名 御中」となります。選択時は「部署 役職 氏名 様」を印字します。</small>
                        </div>

                        <!-- 差出人担当者 -->
                        <div class="form-group">
                            <label style="display:block; font-weight:600; margin-bottom:6px; color:#334155;">差出人担当者（当事務所） <span style="color:#ef4444;">*</span></label>
                            <select id="ship-label-sender-staff" class="form-control" style="width:100%; padding:9px 12px; border:1px solid #cbd5e1; border-radius:6px; background:#fff; font-size:0.95rem;" required>
                                <option value="担当者">担当者 (デフォルト)</option>
                            </select>
                        </div>

                        <!-- 書類種別 (複数選択) -->
                        <div class="form-group" style="background:#f1f5f9; border-radius:8px; padding:14px; border:1px solid #cbd5e1;">
                            <label style="display:block; font-weight:700; margin-bottom:8px; color:#1e293b;">書類種別（同送資料・複数選択可）</label>
                            <div id="ship-label-docs-checkboxes" style="display:grid; grid-template-columns: repeat(2, 1fr); gap:10px;">
                                <label style="display:flex; align-items:center; gap:6px; font-size:0.95rem; cursor:pointer;"><input type="checkbox" name="ship_label_doc" value="届出控え"> 届出控え</label>
                                <label style="display:flex; align-items:center; gap:6px; font-size:0.95rem; cursor:pointer;"><input type="checkbox" name="ship_label_doc" value="請求書"> 請求書</label>
                                <label style="display:flex; align-items:center; gap:6px; font-size:0.95rem; cursor:pointer;"><input type="checkbox" name="ship_label_doc" value="領収書"> 領収書</label>
                                <label style="display:flex; align-items:center; gap:6px; font-size:0.95rem; cursor:pointer;"><input type="checkbox" name="ship_label_doc" value="許可通知書"> 許可通知書</label>
                                <label style="display:flex; align-items:center; gap:6px; font-size:0.95rem; cursor:pointer;"><input type="checkbox" name="ship_label_doc" value="登録証"> 登録証</label>
                                <label style="display:flex; align-items:center; gap:6px; font-size:0.95rem; cursor:pointer;"><input type="checkbox" name="ship_label_doc" value="契約書"> 契約書</label>
                                <label style="display:flex; align-items:center; gap:6px; font-size:0.95rem; cursor:pointer;"><input type="checkbox" name="ship_label_doc" value="申請書"> 申請書</label>
                                <label style="display:flex; align-items:center; gap:6px; font-size:0.95rem; cursor:pointer;"><input type="checkbox" name="ship_label_doc" value="その他" id="chk-ship-label-other"> その他</label>
                            </div>
                            <small style="color:#475569; font-size:0.8rem; display:block; margin-top:8px;">※どのような順序でチェックしても規定のビジネス順（届出控え、請求書...）で整理されて印字されます。</small>

                            <!-- その他 自由入力欄 -->
                            <div id="ship-label-other-container" style="display:none; margin-top:12px; padding-top:12px; border-top:1px dashed #cbd5e1;">
                                <label style="display:block; font-size:0.85rem; font-weight:600; color:#334155; margin-bottom:4px;">「その他」の自由入力名称</label>
                                <input type="text" id="ship-label-other-input" class="form-control" placeholder="例: 変更届一式" style="width:100%; padding:8px 10px; border:1px solid #cbd5e1; border-radius:6px; font-size:0.9rem;">
                            </div>
                        </div>

                        <!-- 追跡番号 (任意) -->
                        <div class="form-group">
                            <label style="display:block; font-weight:600; margin-bottom:6px; color:#334155;">追跡番号（お問い合わせ番号・任意）</label>
                            <input type="text" id="ship-label-tracking-input" class="form-control" placeholder="例: 3906-1259-5800" style="width:100%; padding:9px 12px; border:1px solid #cbd5e1; border-radius:6px; background:#fff; font-size:0.95rem;">
                            <small style="color:#64748b; font-size:0.8rem; display:block; margin-top:4px;">※レターパックの追跡番号をあらかじめ記録する場合は入力してください。</small>
                        </div>

                        <!-- 返信用レターパック オプション -->
                        <div class="form-group" style="border:2px solid #6366f1; border-radius:8px; padding:12px 16px; background:#eff6ff;">
                            <label style="display:flex; align-items:center; gap:10px; font-size:1.0rem; font-weight:700; color:#1e3a8a; cursor:pointer;">
                                <input type="checkbox" id="ship-label-return-chk" style="width:18px; height:18px; accent-color:#4f46e5;" checked>
                                返信用レターパックを出力する（初期値: ON）
                            </label>
                            <small style="color:#334155; font-size:0.85rem; display:block; margin-top:4px; margin-left:28px;">※ONの場合、往信用・返信用および品名ラベル合計5面を一挙に出力します。カット線に沿って快適にご利用いただけます。</small>
                        </div>

                        <!-- 履歴自動登録オプション (推奨) -->
                        <div style="margin-bottom:4px; padding:10px 14px; background:#eff6ff; border:1px solid #bfdbfe; border-radius:6px;">
                            <label style="display:flex; align-items:center; gap:8px; font-weight:600; font-size:0.95rem; color:#1e40af; cursor:pointer; margin:0;">
                                <input type="checkbox" id="ship-label-save-history-chk" style="width:16px; height:16px; accent-color:#1e40af;" checked>
                                対応履歴に記録する（推奨）
                            </label>
                            <small style="display:block; margin-left:24px; color:#475569; font-size:0.8rem; margin-top:2px;">
                                ※チェックONの場合、発行日時や発送詳細（宛先・追跡番号等）を顧客カルテの対応履歴へ自動保存します。
                            </small>
                        </div>

                        <!-- ボタン群 -->
                        <div style="display:flex; justify-content:flex-end; gap:12px; border-top:1px solid #e2e8f0; padding-top:16px; margin-top:4px;">
                            <button type="button" class="btn btn-secondary" id="ship-label-btn-cancel" style="padding:10px 18px; border-radius:6px; background:#64748b; color:#fff; border:none; cursor:pointer; font-weight:600;">キャンセル</button>
                            <button type="submit" class="btn btn-primary" id="ship-label-btn-submit" style="padding:10px 22px; border-radius:6px; background:#4f46e5; color:#fff; border:none; cursor:pointer; font-weight:700; display:flex; align-items:center; gap:6px;">
                                🖨️ PDFプレビュー & 履歴保存
                            </button>
                        </div>
                    </form>
                </div>
            </div>`;

            const wrapper = document.createElement('div');
            wrapper.innerHTML = html;
            document.body.appendChild(wrapper.firstElementChild);
            this.modalElement = document.getElementById('shipping-label-modal');
        }

        /** 担当者プルダウン構築 */
        setupContactsDropdown() {
            const select = document.getElementById('ship-label-contact-select');
            if (!select) return;
            select.innerHTML = '<option value="">-- 担当者未選択（会社宛・御中） --</option>';

            this.contactsList.forEach(c => {
                const opt = document.createElement('option');
                opt.value = c.contact_id || c.id;
                const deptPos = [c.department, c.position].filter(Boolean).join(' ');
                opt.textContent = `${c.contact_name || '-'}${deptPos ? ` (${deptPos})` : ''}`;
                opt.dataset.name = c.contact_name || '';
                opt.dataset.dept = c.department || '';
                opt.dataset.position = c.position || '';
                opt.dataset.officeId = c.office_id || '';
                select.appendChild(opt);
            });
        }

        /** 事務所スタッフプルダウン構築 */
        setupStaffDropdown() {
            const select = document.getElementById('ship-label-sender-staff');
            if (!select) return;
            select.innerHTML = '<option value="">-- 選択してください --</option>';

            const activeStaff = this.staffList
                .filter(s => s.status === '在籍' || s.status === '有効' || !s.status)
                .sort((a, b) => (a.staff_id || 0) - (b.staff_id || 0));

            if (activeStaff.length === 0) {
                const opt = document.createElement('option');
                opt.value = '藤田 宏明';
                opt.textContent = '藤田 宏明';
                select.appendChild(opt);
                select.value = '藤田 宏明';
                return;
            }

            activeStaff.forEach(s => {
                const opt = document.createElement('option');
                opt.value = s.staff_name;
                opt.textContent = s.staff_name;
                select.appendChild(opt);
            });

            // セッション担当者をデフォルト選択
            try {
                const session = JSON.parse(localStorage.getItem('lapis3_session')) || {};
                if (session && session.staff_name && Array.from(select.options).some(o => o.value === session.staff_name)) {
                    select.value = session.staff_name;
                } else if (activeStaff.length > 0) {
                    select.value = activeStaff[0].staff_name;
                }
            } catch (e) {
                if (activeStaff.length > 0) select.value = activeStaff[0].staff_name;
            }
        }

        /** フォーム初期化 */
        resetForm() {
            const custNameEl = document.getElementById('ship-label-customer-name');
            if (custNameEl) custNameEl.textContent = this.currentCustomer.customer_name || '―';

            const custAddrEl = document.getElementById('ship-label-customer-addr');
            if (custAddrEl) {
                const postal = this.currentCustomer.postal_code || '';
                const addr = this.currentCustomer.address || '';
                const build = this.currentCustomer.building_name || '';
                custAddrEl.textContent = `${postal ? `〒${postal} ` : ''}${addr} ${build}`.trim() || '住所情報なし';
            }

            const contactSel = document.getElementById('ship-label-contact-select');
            if (contactSel) contactSel.value = '';

            const returnChk = document.getElementById('ship-label-return-chk');
            if (returnChk) returnChk.checked = true; // 規定値ON

            // 書類初期値：届出控え・請求書をチェック
            const chks = document.querySelectorAll('input[name="ship_label_doc"]');
            chks.forEach(chk => {
                chk.checked = (chk.value === '届出控え' || chk.value === '請求書');
            });
            
            const otherCont = document.getElementById('ship-label-other-container');
            if (otherCont) otherCont.style.display = 'none';
            const otherInp = document.getElementById('ship-label-other-input');
            if (otherInp) otherInp.value = '';

            const trackingInp = document.getElementById('ship-label-tracking-input');
            if (trackingInp) trackingInp.value = '';

            const historyChk = document.getElementById('ship-label-save-history-chk');
            if (historyChk) {
                historyChk.checked = true;
                const submitBtn = document.getElementById('ship-label-btn-submit');
                if (submitBtn) {
                    submitBtn.innerHTML = '🖨️ PDFプレビュー & 履歴保存';
                }
            }
        }

        /** イベント接続 */
        bindEvents() {
            const closeBtn = document.getElementById('ship-label-btn-close');
            const cancelBtn = document.getElementById('ship-label-btn-cancel');
            const form = document.getElementById('ship-label-form');
            const otherChk = document.getElementById('chk-ship-label-other');
            const otherCont = document.getElementById('ship-label-other-container');
            const otherInp = document.getElementById('ship-label-other-input');

            const removeListener = (el, type, handler) => {
                if (el && el._hand) el.removeEventListener(type, el._hand);
            };

            // クローズ処理
            const closeHandler = () => this.close();
            if (closeBtn) {
                removeListener(closeBtn, 'click');
                closeBtn.addEventListener('click', closeHandler);
                closeBtn._hand = closeHandler;
            }
            if (cancelBtn) {
                removeListener(cancelBtn, 'click');
                cancelBtn.addEventListener('click', closeHandler);
                cancelBtn._hand = closeHandler;
            }

            // 「その他」チェック時の切り替え
            const otherHandler = (e) => {
                if (otherCont) {
                    otherCont.style.display = e.target.checked ? 'block' : 'none';
                    if (e.target.checked && otherInp) {
                        otherInp.focus();
                    }
                }
            };
            if (otherChk) {
                removeListener(otherChk, 'change');
                otherChk.addEventListener('change', otherHandler);
                otherChk._hand = otherHandler;
            }

            // 担当者変更時のモーダルプレビュー住所動的更新
            const contactSelect = document.getElementById('ship-label-contact-select');
            if (contactSelect) {
                const contactChangeHandler = () => {
                    this.updatePreviewAddress();
                };
                removeListener(contactSelect, 'change');
                contactSelect.addEventListener('change', contactChangeHandler);
                contactSelect._hand = contactChangeHandler;
            }

            // 履歴保存チェック時のボタン文言切り替え
            const historyChk = document.getElementById('ship-label-save-history-chk');
            const submitBtn = document.getElementById('ship-label-btn-submit');
            if (historyChk && submitBtn) {
                const historyChangeHandler = () => {
                    submitBtn.innerHTML = historyChk.checked ? '🖨️ PDFプレビュー & 履歴保存' : '🖨️ PDFプレビュー発行のみ';
                };
                removeListener(historyChk, 'change');
                historyChk.addEventListener('change', historyChangeHandler);
                historyChk._hand = historyChangeHandler;
            }

            // フォーム実行
            const submitHandler = async (e) => {
                e.preventDefault();
                await this.handleSubmit();
            };
            if (form) {
                removeListener(form, 'submit');
                form.addEventListener('submit', submitHandler);
                form._hand = submitHandler;
            }
        }

        /**
         * 担当者変更時にモーダル上の送信先住所プレビューを動的更新する
         * ユーザーはPDF出力前にモーダルで住所を確認するため、選択した担当者の所属拠点住所を即時反映する
         */
        updatePreviewAddress() {
            const contactSel = document.getElementById('ship-label-contact-select');
            const custAddrEl = document.getElementById('ship-label-customer-addr');
            if (!custAddrEl) return;

            // デフォルト: 顧客の代表連絡先（本店）住所
            let postal = this.currentCustomer.postal_code || '';
            let addr = this.currentCustomer.address || '';
            let build = this.currentCustomer.building_name || '';

            if (contactSel && contactSel.value && contactSel.selectedIndex > 0) {
                const selectedOption = contactSel.options[contactSel.selectedIndex];
                const officeId = selectedOption.dataset.officeId || '';

                if (officeId && this.officesList.length > 0) {
                    const contactOffice = this.officesList.find(
                        o => String(o.office_id) === String(officeId)
                    );
                    if (contactOffice) {
                        postal = contactOffice.postal_code || postal;
                        addr = contactOffice.address || addr;
                        build = contactOffice.building_name || '';
                    }
                }
            }

            custAddrEl.textContent = `${postal ? `〒${postal} ` : ''}${addr} ${build}`.trim() || '住所情報なし';
        }

        /** 実行・履歴保存処理 */
        async handleSubmit() {
            const submitBtn = document.getElementById('ship-label-btn-submit');
            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.innerText = '⏳ 生成・保存中...';
            }

            try {
                // 1. 選択書類の抽出
                const selectedDocs = [];
                document.querySelectorAll('input[name="ship_label_doc"]:checked').forEach(chk => {
                    selectedDocs.push(chk.value);
                });
                const otherText = document.getElementById('ship-label-other-input') ? document.getElementById('ship-label-other-input').value.trim() : '';

                // 同一変数の保証
                const buildFn = window.buildDocumentNames || ((docs, oth) => docs.join('、') || '書類一式');
                const documentText = buildFn(selectedDocs, otherText);

                // 2. 顧客および担当者情報の構築
                const contactSel = document.getElementById('ship-label-contact-select');
                const targetCustomer = Object.assign({}, this.currentCustomer);

                if (contactSel && contactSel.value && contactSel.selectedIndex >= 0) {
                    const selectedOption = contactSel.options[contactSel.selectedIndex];
                    targetCustomer.contact_name = selectedOption.dataset.name || '';
                    targetCustomer.department = selectedOption.dataset.dept || '';
                    targetCustomer.position = selectedOption.dataset.position || '';

                    // ★ 担当者の所属拠点から住所を逆引き（担当者→office_id→拠点→住所のチェーン復元）
                    const officeId = selectedOption.dataset.officeId || '';
                    if (officeId && this.officesList.length > 0) {
                        const contactOffice = this.officesList.find(
                            o => String(o.office_id) === String(officeId)
                        );
                        if (contactOffice) {
                            targetCustomer.postal_code = contactOffice.postal_code || targetCustomer.postal_code;
                            targetCustomer.address = contactOffice.address || targetCustomer.address;
                            targetCustomer.building_name = contactOffice.building_name || '';
                            targetCustomer.phone = contactOffice.phone || targetCustomer.phone;
                        } else {
                            console.warn(`⚠️ 担当者の所属拠点(office_id: ${officeId})が拠点リストに見つかりません。代表連絡先の住所を使用します。`);
                        }
                    } else if (!officeId) {
                        console.warn('⚠️ 担当者に所属拠点(office_id)が設定されていません。代表連絡先の住所を使用します。');
                    }
                } else {
                    delete targetCustomer.contact_name;
                    delete targetCustomer.department;
                    delete targetCustomer.position;
                }

                // 3. 差出人担当者の取得
                const staffSel = document.getElementById('ship-label-sender-staff');
                const senderStaffName = staffSel ? (staffSel.value || '担当者') : '担当者';
                const senderInfo = {
                    officeName: '行政書士 中村事務所',
                    postalCode: '〒160-0023',
                    buildingName: 'サンローゼ新宿',
                    address: '東京都新宿区西新宿7-19-7-402',
                    staffName: senderStaffName,
                    phone: '03-5386-3001'
                };

                const returnChk = document.getElementById('ship-label-return-chk');
                const includeReturn = returnChk ? returnChk.checked : true;

                // 履歴保存フラグの取得
                const historyChk = document.getElementById('ship-label-save-history-chk');
                const shouldSaveHistory = historyChk ? historyChk.checked : true;

                // 追跡番号の取得
                const trackingInp = document.getElementById('ship-label-tracking-input');
                const trackingNumber = trackingInp ? trackingInp.value.trim() : '';

                // 発行日時の自動生成 (YYYY/MM/DD HH:mm)
                const now = new Date();
                const pad = (n) => String(n).padStart(2, '0');
                const issuedAtStr = `${now.getFullYear()}/${pad(now.getMonth() + 1)}/${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;

                // 宛先担当者表示の整形
                const contactDisplay = targetCustomer.contact_name ? `${targetCustomer.contact_name} 様` : '（会社宛・御中）';

                // 同封書類リストのテキスト化
                const docsListStr = selectedDocs.map(doc => {
                    if (doc === 'その他' && otherText) return `・その他（${otherText}）`;
                    return `・${doc}`;
                }).join('\n');

                // 履歴本文（content）: 発送の事実が100%再現できる完全フォーマット
                const contentLines = [
                    `発行日時：${issuedAtStr}`,
                    `発送方法：レターパック（返信用同封: ${includeReturn ? 'あり' : 'なし'}）`,
                    trackingNumber ? `追跡番号：${trackingNumber}` : null,
                    `発送先：${targetCustomer.customer_name || '―'}`,
                    `宛先担当者：${contactDisplay}`,
                    '',
                    '同封書類：',
                    docsListStr
                ];
                const fullContent = contentLines.filter(line => line !== null).join('\n');

                // 4. customer_histories への発送履歴レコード構築 (第1弾: history_typeは「その他」を維持)
                const customerId = targetCustomer.customer_id || targetCustomer.id || 0;
                let createdBy = '担当者';
                try {
                    const session = JSON.parse(localStorage.getItem('lapis3_session')) || {};
                    createdBy = session.staff_name || senderStaffName;
                } catch (e) {}

                const historyRecord = {
                    customer_id: Number(customerId),
                    history_type: "書類発送",
                    history_category: "document_shipping",
                    subject: "✉️ レターパック宛名印刷",
                    content: fullContent,
                    tracking_number: trackingNumber || null,
                    staff_name: senderStaffName || createdBy,
                    response_date: (window.firebase && window.firebase.firestore) ? window.firebase.firestore.Timestamp.fromDate(new Date()) : new Date(),
                    created_at: (window.firebase && window.firebase.firestore) ? window.firebase.firestore.FieldValue.serverTimestamp() : new Date(),
                    created_by_name: createdBy,
                    deleted_at: null
                };

                if (shouldSaveHistory) {
                    if (window.db) {
                        try {
                            await window.db.collection('customer_histories').add(historyRecord);
                            console.log('✅ customer_histories への発送履歴保存完了:', historyRecord);
                        } catch (dbErr) {
                            console.error('⚠️ 履歴保存でエラー:', dbErr);
                        }
                    } else {
                        console.warn('⚠️ window.db 未接続のため、Firestore履歴保存はスキップしPDF生成を進めます。');
                    }
                } else {
                    console.log('ℹ️ 「対応履歴に記録する」がOFFのため、履歴保存はスキップされました。');
                }

                // 5. PDF 帳票発行
                const report = new window.ShippingLabelReport();
                await report.generate({
                    customer: targetCustomer,
                    sender: senderInfo,
                    documents: selectedDocs,
                    otherText: otherText,
                    includeReturnEnvelope: includeReturn,
                    carrier: 'letterpack'
                });

                report.preview();

                if (shouldSaveHistory) {
                    alert('レターパック宛名PDFを発行し、発送履歴を登録しました。');
                } else {
                    alert('レターパック宛名PDFを発行しました。（※対応履歴の保存はスキップされました）');
                }

                this.close();
                if (this.onSuccessCallback && shouldSaveHistory) {
                    this.onSuccessCallback(historyRecord);
                }

            } catch (err) {
                console.error('レターパック宛名印刷処理エラー:', err);
                alert(`処理エラーが発生しました: ${err.message}`);
            } finally {
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.innerText = '🖨️ PDFプレビュー & 履歴保存';
                }
            }
        }
    }

    window.ShippingLabelModal = ShippingLabelModal;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { ShippingLabelModal };
    }
})();
