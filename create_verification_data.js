(async () => {
    const db = firebase.firestore();
    console.log('Starting comprehensive test data generation...');

    const timestamp = firebase.firestore.Timestamp.now();
    const futureDate = firebase.firestore.Timestamp.fromDate(new Date('2026-04-01'));

    // 1. Staff Data (5 records)
    const staffList = [
        { id: '101', name: '鈴木 太郎', role: '行政書士' },
        { id: '102', name: '佐藤 花子', role: '補助者' },
        { id: '103', name: '田中 次郎', role: '行政書士' },
        { id: '104', name: '山田 建太', role: '営業' },
        { id: '105', name: '高橋 事務', role: '事務' }
    ];

    for (const s of staffList) {
        await db.collection('staff').doc(`staff_${s.id}`).set({
            staff_id: s.id,
            staff_name: s.name,
            role: s.role,
            status: '在籍',
            joined_date: timestamp
        });
    }
    console.log('Staff data created.');

    // 2. Government Offices (5 records)
    const offices = [
        { id: 1, name: '東京法務局', pref: '東京都', type: '国' },
        { id: 2, name: '東京都庁 建設業課', pref: '東京都', type: '都道府県' },
        { id: 3, name: '神奈川県庁', pref: '神奈川県', type: '都道府県' },
        { id: 4, name: '新宿区役所', pref: '東京都', type: '市区町村' },
        { id: 5, name: '横浜市役所', pref: '神奈川県', type: '市区町村' }
    ];

    for (const o of offices) {
        await db.collection('government_offices').doc(`gov_${o.id}`).set({
            office_id: o.id,
            office_name: o.name,
            office_prefecture: o.pref,
            office_type: o.type,
            status: '有効'
        });
    }
    console.log('Government Office data created.');

    // 3. Customers (10 records)
    const customers = [];
    for (let i = 1; i <= 10; i++) {
        const id = (10000 + i).toString();
        const name = i % 2 === 0 ? `株式会社 サンプル建設${i}` : `有限会社 テスト興業${i}`;
        customers.push({ id, name });
        await db.collection('customers').doc(`cust_${i.toString().padStart(3, '0')}`).set({
            customer_id: id,
            customer_name: name,
            customer_kana: 'カブシキガイシャ サンプル',
            status: '稼働中',
            representative_name: `代表 ${i}郎`,
            phone: `03-1234-${i.toString().padStart(4, '0')}`,
            created_at: timestamp
        });
    }
    console.log('Customer data created.');

    // 4. Cases (20 records)
    const licenseTypes = ['建設業許可', '宅建業免許', '産廃収集運搬', '古物商許可'];
    const statuses = ['受任', '作成中', '申請準備完了', '完了', '請求済'];

    for (let i = 1; i <= 20; i++) {
        const cust = customers[i % 10];
        const StaffId = staffList[i % 5].id;
        const status = statuses[i % 5];
        // 管轄官公庁のテストパターン（マスタID紐付け、直接入力、未設定）
        const officePattern = i % 3;
        let govOfficeId = null;
        let govOfficeName = '';
        if (officePattern === 0) {
            govOfficeId = offices[i % offices.length].id;
        } else if (officePattern === 1) {
            govOfficeName = '埼玉県知事（直接入力）';
        } // officePattern === 2 は未設定（空）

        await db.collection('cases').doc(`case_${i.toString().padStart(3, '0')}`).set({
            case_id: `C${20000 + i}`,
            customer_id: cust.id,
            customer_name: cust.name,
            license_type: licenseTypes[i % 4],
            procedure_name: '新規申請',
            status: status,
            government_office_id: govOfficeId,
            government_office: govOfficeName,
            field_staff_id: StaffId, // Store as string to match schema update
            document_staff_id: StaffId,
            contract_date: '2026-08-01',
            application_scheduled_date: futureDate,
            created_date: timestamp,
            updated_date: timestamp,
            fee: 150000 + (i * 1000)
        });
    }
    console.log('Case data created.');

    // 5. Sales (linked to Cases)
    // Create sales for '完了' or '請求済' cases
    const completedCases = await db.collection('cases').where('status', 'in', ['完了', '請求済']).get();

    let saleId = 1;
    for (const doc of completedCases.docs) {
        const c = doc.data();
        await db.collection('sales').doc(`sale_${saleId}`).set({
            sales_id: `S${30000 + saleId}`,
            case_id: c.case_id,
            customer_id: c.customer_id,
            customer_name: c.customer_name,
            sales_amount: c.fee,
            recorded_date: timestamp,
            status: '売上確定'
        });
        saleId++;
    }
    console.log('Sales data created.');

    return 'All comprehensive test data generated successfully.';
})();
