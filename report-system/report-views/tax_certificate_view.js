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

            // 事業年度の分解（令和ベースの和暦変換を想定：2019年=令和元年）と税目の条件付き出力
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
                const periodData = {};
                
                const isResidentTax = formData.taxTypes && formData.taxTypes.includes('法人都民税');
                const isBusinessTax = formData.taxTypes && formData.taxTypes.includes('法人事業税');

                if (isResidentTax) {
                    periodData.tax_checkbox_1 = true;
                    // 法人都民税は Group 2 (period_2_...) へ出力
                    periodData.period_2_start_year = start.year;
                    periodData.period_2_start_month = start.month;
                    periodData.period_2_start_day = start.day;
                    periodData.period_2_end_year = end.year;
                    periodData.period_2_end_month = end.month;
                    periodData.period_2_end_day = end.day;
                    periodData.copies_2 = formData.copies ? String(formData.copies) : '1';
                }

                if (isBusinessTax) {
                    periodData.tax_checkbox_2 = true;
                    // 法人事業税は Group 1 (period_...) へ出力
                    periodData.period_start_year = start.year;
                    periodData.period_start_month = start.month;
                    periodData.period_start_day = start.day;
                    periodData.period_end_year = end.year;
                    periodData.period_end_month = end.month;
                    periodData.period_end_day = end.day;
                    periodData.copies_1 = formData.copies ? String(formData.copies) : '1';
                }

                return periodData;
            })(),
            
            // 提出先は削除済みのため、必要に応じて空文字を設定またはプロパティごと削除
            submitted_to: '',
            
            // 固定マークの出力
            fixed_mark_circle: '○'
        };
        return data;
    }
};
