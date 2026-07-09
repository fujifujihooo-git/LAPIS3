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
            CORPORATE_NUMBER: currentCustomer.corporate_number || '',
        };

        // 使用目的チェックボックスおよび「その他」のテキスト
        const purpose = formData.purpose || '';
        if (purpose === '資金借入') {
            data.PURPOSE_BANK = true;
        } else if (purpose === '入札参加指名願' || purpose === '入札参加資格審査用') {
            data.PURPOSE_BID = true;
        } else if (purpose === '登録申請(更新)' || purpose === '登録申請' || purpose === '登録申請（更新）') {
            data.PURPOSE_LICENSE = true;
        } else if (purpose === '保証人') {
            data.PURPOSE_GUARANTOR = true;
        } else if (purpose) {
            data.PURPOSE_OTHER = true;
        }

        // 和暦パース関数 (例: 2026-04-01 -> 令和8, 4, 1)
        const parseDate = (dateStr) => {
            if (!dateStr) return { year: '', month: '', day: '' };
            const parts = dateStr.split('-');
            if (parts.length !== 3) return { year: '', month: '', day: '' };
            const y = parseInt(parts[0], 10);
            const m = parseInt(parts[1], 10);
            const d = parseInt(parts[2], 10);
            
            let wareki = String(y - 2018);
            if (y === 2019 && m <= 4) {
                wareki = '平成31';
            } else if (y === 2019 && m > 4) {
                wareki = '令和元';
            } else if (wareki === '1') {
                wareki = '元'; // 令和元年
            }
            
            return {
                year: isNaN(parseInt(wareki)) ? wareki : wareki,
                month: String(m),
                day: String(d)
            };
        };

        // 種類ごとの処理に振り分け
        const types = formData.certificateTypes || {};
        
        if (types.sono1 && types.sono1.enabled) {
            data.TYPE_SONO_1 = true;
            this.buildSono1Data(types.sono1, data, parseDate);
        }
        if (types.sono2 && types.sono2.enabled) {
            data.TYPE_SONO_2 = true;
            this.buildSono2Data(types.sono2, data, parseDate);
        }
        if (types.sono33 && types.sono33.enabled) {
            data.TYPE_SONO_3_3 = true;
            this.buildSono33Data(types.sono33, data);
        }

        // 代理人の処理
        if (formData.applicantType === '代理人' && formData.staff) {
            data.APPLICANT_NAME = formData.staff.name;
            data.APPLICANT_ADDRESS = formData.staff.address;
        } else {
            // 本人
            data.APPLICANT_NAME = currentCustomer.representative_name || '';
            data.APPLICANT_ADDRESS = currentCustomer.address || '';
        }

        return data;
    },

    /**
     * その1のデータを構築
     */
    buildSono1Data(sono1, data, parseDate) {
        // 税目
        const taxes = sono1.taxes || [];
        if (taxes.includes('所得税')) data.SONO_1_TAX_INCOME = true;
        if (taxes.includes('法人税')) data.SONO_1_TAX_CORPORATE = true;
        if (taxes.includes('消費税')) data.SONO_1_TAX_CONSUMPTION = true;

        // 期間
        const start = parseDate(sono1.startDate);
        const end = parseDate(sono1.endDate);

        data.SONO_1_PERIOD_START_YEAR = start.year;
        data.SONO_1_PERIOD_START_MONTH = start.month;
        data.SONO_1_PERIOD_START_DAY = start.day;
        
        data.SONO_1_PERIOD_END_YEAR = end.year;
        data.SONO_1_PERIOD_END_MONTH = end.month;
        data.SONO_1_PERIOD_END_DAY = end.day;

        // 枚数
        data.SONO_1_COPIES = String(sono1.copies || 1);
    },

    /**
     * その2のデータを構築
     */
    buildSono2Data(sono2, data, parseDate) {
        // 税目
        const taxes = sono2.taxes || [];
        if (taxes.includes('所得税')) data.SONO_2_TAX_INCOME = true;
        if (taxes.includes('法人税')) data.SONO_2_TAX_CORPORATE = true;

        // 期間
        const start = parseDate(sono2.startDate);
        const end = parseDate(sono2.endDate);

        data.SONO_2_PERIOD_START_YEAR = start.year;
        data.SONO_2_PERIOD_START_MONTH = start.month;
        data.SONO_2_PERIOD_START_DAY = start.day;
        
        data.SONO_2_PERIOD_END_YEAR = end.year;
        data.SONO_2_PERIOD_END_MONTH = end.month;
        data.SONO_2_PERIOD_END_DAY = end.day;

        // 枚数
        data.SONO_2_COPIES = String(sono2.copies || 1);
    },

    /**
     * その3の3のデータを構築
     */
    buildSono33Data(sono33, data) {
        // 枚数のみ
        data.SONO_3_3_COPIES = String(sono33.copies || 1);
    }
};
