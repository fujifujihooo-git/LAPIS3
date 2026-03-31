window.TaxCertificateNationalView = {
    /**
     * フォーム入力データと顧客情報からPDF描画用のデータを構築する
     * @param {Object} currentCustomer 対象顧客データ
     * @param {Object} formData モーダルから取得した入力データ
     * @returns {Object} PDF描画用フラットデータ
     */
    buildData(currentCustomer, formData) {
        if (!currentCustomer) return {};

        const data = {
            // 基本情報
            TAX_PAYER_NAME: currentCustomer.customer_name || '',
            TAX_PAYER_ADDRESS: currentCustomer.address || '',
            REPRESENTATIVE_NAME: currentCustomer.representative_name || '',
            PHONE_NUMBER: currentCustomer.phone || '',
            
            // フォーム入力項目
            COPIES: String(formData.copies || 1),
            PURPOSE: formData.purpose || '',
        };

        // 和暦パース関数 (例: 2026-04-01 -> 令和8, 4, 1)
        const parseDate = (dateStr) => {
            if (!dateStr) return { year: '', month: '', day: '' };
            const parts = dateStr.split('-');
            if (parts.length !== 3) return { year: '', month: '', day: '' };
            const y = parseInt(parts[0], 10);
            const m = parseInt(parts[1], 10);
            const d = parseInt(parts[2], 10);
            
            // 簡単な令和変換 (2019年=令和1だが、表示は令和_)
            let wareki = String(y - 2018);
            if (y === 2019 && m <= 4) {
                wareki = '平成31';
            } else if (y === 2019 && m > 4) {
                wareki = '令和元';
            } else if (wareki === '1') {
                wareki = '元'; // 令和元年
            }
            
            return {
                year: isNaN(parseInt(wareki)) ? wareki : wareki, // 令和の元以外はそのまま数字文字列にするか等
                month: String(m),
                day: String(d)
            };
        };

        const start = parseDate(formData.period_start);
        const end = parseDate(formData.period_end);

        data.PERIOD_START_YEAR = start.year;
        data.PERIOD_START_MONTH = start.month;
        data.PERIOD_START_DAY = start.day;
        
        data.PERIOD_END_YEAR = end.year;
        data.PERIOD_END_MONTH = end.month;
        data.PERIOD_END_DAY = end.day;

        // 税目に応じたチェックの動的バインド
        if (formData.taxType === '法人税') {
            data.TAX_TYPE_CORPORATE = true;
        } else if (formData.taxType === '消費税及地方消費税') {
            data.TAX_TYPE_CONSUMPTION = true;
        } else if (formData.taxType === '源泉所得税') {
            data.TAX_TYPE_WITHHOLDING = true;
        }

        // 代理人の処理
        if (formData.applicantType === '代理人' && formData.staff) {
            data.APPLICANT_NAME = formData.staff.name;
            data.APPLICANT_ADDRESS = formData.staff.address;
            data.APPLICANT_PHONE = formData.staff.tel;
        } else {
            // 本人
            data.APPLICANT_NAME = currentCustomer.representative_name || '';
            data.APPLICANT_ADDRESS = currentCustomer.address || '';
            data.APPLICANT_PHONE = currentCustomer.phone || '';
        }

        return data;
    }
};
