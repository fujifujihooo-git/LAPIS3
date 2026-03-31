/**
 * LAPIS2 帳票ビュー (Tax Certificate View)
 * Firestoreの顧客データとUIからの入力値を結合し、
 * マッピングJSONに合わせたフラットなデータ構造へ整形する。
 */

window.TaxCertificateView = {
    /**
     * @param {Object} customer - Firestoreから取得した顧客データ
     * @param {Object} formData - 印刷モーダルからの入力値
     * @returns {Object} PDFバインド用のフラットなデータ
     */
    buildData(customer, formData) {
        // 現在の日付を取得（申請日用）
        const today = new Date();
        const yyyy = today.getFullYear();
        const mm = String(today.getMonth() + 1).padStart(2, '0');
        const dd = String(today.getDate()).padStart(2, '0');

        // ① 申請者の判定（本人 vs 代理人）
        let applicantName = '';
        let applicantKana = '';
        let applicantPhone = '';

        if (formData.applicantType === '代理人' && formData.staff) {
            applicantName = formData.staff.name || '';
            applicantKana = formData.staff.kana || '';
            applicantPhone = formData.staff.tel || '';
        } else {
            // 本人
            applicantName = customer.customer_name || '';
            applicantKana = customer.customer_kana || '';
            applicantPhone = customer.phone || '';
        }

        // 住所の結合（改行を入れるか、空白で繋ぐか）
        const customerAddress = [customer.address, customer.building_name]
            .filter(v => v)
            .join(' '); // 簡易結合（長い場合はEngine側でフォント縮小される想定）

        // ② 基本データの構築
        const data = {
            request_year: String(yyyy),
            request_month: mm,
            request_day: dd,

            taxpayer_address: customerAddress,
            taxpayer_kana: customer.customer_kana || '',
            taxpayer_name: customer.customer_name || '',
            taxpayer_rep_name: customer.representative_name || '',
            taxpayer_phone: customer.phone || '',

            // 代理人の場合、選択された担当者(staff)の住所を使用。登録がない場合は空文字をフォールバック。
            applicant_address: formData.applicantType === '代理人' 
                ? (formData.staff && formData.staff.address ? formData.staff.address : '') 
                : customerAddress,
            applicant_name: applicantName,
            applicant_kana: applicantKana,
            applicant_phone: applicantPhone,

            // 事業年度の分解（令和ベースの和暦変換を想定：2019年=令和元年）
            ...(() => {
                const parseDate = (dateStr) => {
                    if (!dateStr) return { year: '', month: '', day: '' };
                    const parts = dateStr.split('-');
                    if (parts.length !== 3) return { year: '', month: '', day: '' };
                    const y = parseInt(parts[0], 10);
                    let wareki = y >= 2019 ? String(y - 2018) : String(y);
                    if (wareki === '1') wareki = '元';
                    return {
                        year: wareki,
                        month: parseInt(parts[1], 10).toString(),
                        day: parseInt(parts[2], 10).toString()
                    };
                };
                const start = parseDate(formData.period_start);
                const end = parseDate(formData.period_end);
                return {
                    period_start_year: start.year,
                    period_start_month: start.month,
                    period_start_day: start.day,
                    period_end_year: end.year,
                    period_end_month: end.month,
                    period_end_day: end.day,

                    period_2_start_year: start.year,
                    period_2_start_month: start.month,
                    period_2_start_day: start.day,
                    period_2_end_year: end.year,
                    period_2_end_month: end.month,
                    period_2_end_day: end.day
                };
            })(),
            copies_1: formData.copies ? String(formData.copies) : '1',
            copies_2: formData.copies ? String(formData.copies) : '1',
            // 提出先は削除済みのため、必要に応じて空文字を設定またはプロパティごと削除
            submitted_to: '',
            
            // 固定マークの出力
            fixed_mark_circle: '○'
        };

        // ③ 税目のチェックボックス用フラグ
        // taxTypes配列のチェック状態を個別のbooleanフラグに展開
        // ※PDF書式のチェックボックス項目に合わせて定義を修正可能
        if (formData.taxTypes && Array.isArray(formData.taxTypes)) {
            data.tax_checkbox_1 = formData.taxTypes.includes('法人都民税');
            data.tax_checkbox_2 = formData.taxTypes.includes('法人事業税');
            data.tax_checkbox_3 = formData.taxTypes.includes('固定資産税');
            data.tax_checkbox_4 = formData.taxTypes.includes('自動車税');
        }

        return data;
    }
};
