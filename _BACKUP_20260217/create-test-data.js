(async () => {
    const db = firebase.firestore();
    console.log('🚀 テストデータの作成を開始...');

    try {
        // 1. 顧客を作成
        const customer1Ref = await db.collection('customers').add({
            customer_name: '株式会社サンプル商事',
            postal_code: '100-0001',
            address: '東京都千代田区千代田1-1-1',
            phone: '03-1234-5678',
            created_at: firebase.firestore.FieldValue.serverTimestamp()
        });
        console.log('✅ 顧客1を作成:', customer1Ref.id);

        const customer2Ref = await db.collection('customers').add({
            customer_name: 'テスト株式会社',
            postal_code: '150-0001',
            address: '東京都渋谷区渋谷2-2-2',
            phone: '03-9876-5432',
            created_at: firebase.firestore.FieldValue.serverTimestamp()
        });
        console.log('✅ 顧客2を作成:', customer2Ref.id);

        // 2. 官公庁を作成
        const officeRef = await db.collection('government_offices').add({
            office_name: '東京都',
            created_at: firebase.firestore.FieldValue.serverTimestamp()
        });
        console.log('✅ 官公庁を作成:', officeRef.id);

        // 3. 許認可種別を作成
        const licenseRef = await db.collection('license_types').add({
            license_name: '建設業許可',
            sort_order: 1,
            created_at: firebase.firestore.FieldValue.serverTimestamp()
        });
        console.log('✅ 許認可種別を作成:', licenseRef.id);

        // 4. スタッフIDを取得
        const staffSnapshot = await db.collection('staff')
            .where('email', '==', 'test@example.com')
            .limit(1)
            .get();
        const staffId = staffSnapshot.docs[0].id;
        console.log('✅ スタッフIDを取得:', staffId);

        // 5. 案件1を作成
        const case1Ref = await db.collection('cases').add({
            customer_id: customer1Ref.id,
            customer_name: '株式会社サンプル商事',
            government_office_id: officeRef.id,
            government_office_name: '東京都',
            license_type_id: licenseRef.id,
            license_type_name: '建設業許可',
            procedure_name: '新規申請',
            field_staff_id: staffId,
            document_staff_id: staffId,
            case_status: '完了',
            acceptance_date: '2026-01-15',
            scheduled_application_date: '2026-02-01',
            application_date: '2026-02-01',
            approval_date: '2026-02-10',
            created_at: firebase.firestore.FieldValue.serverTimestamp()
        });
        console.log('✅ 案件1を作成:', case1Ref.id);

        // 6. 案件2を作成
        const case2Ref = await db.collection('cases').add({
            customer_id: customer2Ref.id,
            customer_name: 'テスト株式会社',
            government_office_id: officeRef.id,
            government_office_name: '東京都',
            license_type_id: licenseRef.id,
            license_type_name: '建設業許可',
            procedure_name: '更新申請',
            field_staff_id: staffId,
            document_staff_id: staffId,
            case_status: '完了',
            acceptance_date: '2026-01-20',
            scheduled_application_date: '2026-02-05',
            application_date: '2026-02-05',
            approval_date: '2026-02-15',
            created_at: firebase.firestore.FieldValue.serverTimestamp()
        });
        console.log('✅ 案件2を作成:', case2Ref.id);

        // 7. 請求項目を作成（案件1）
        await db.collection('invoice_items').add({
            case_id: case1Ref.id,
            customer_id: customer1Ref.id,
            customer_name: '株式会社サンプル商事',
            item_name: '建設業許可 新規申請',
            fee_amount: 300000,
            tax_rate: 0.10,
            tax_amount: 30000,
            total_amount: 330000,
            invoice_date: '2026-02-10',
            created_at: firebase.firestore.FieldValue.serverTimestamp()
        });
        console.log('✅ 請求項目1を作成');

        // 8. 請求項目を作成（案件2）
        await db.collection('invoice_items').add({
            case_id: case2Ref.id,
            customer_id: customer2Ref.id,
            customer_name: 'テスト株式会社',
            item_name: '建設業許可 更新申請',
            fee_amount: 200000,
            tax_rate: 0.10,
            tax_amount: 20000,
            total_amount: 220000,
            invoice_date: '2026-02-15',
            created_at: firebase.firestore.FieldValue.serverTimestamp()
        });
        console.log('✅ 請求項目2を作成');

        // 9. 入金情報を作成（案件1）
        await db.collection('payments').add({
            case_id: case1Ref.id,
            customer_id: customer1Ref.id,
            payment_date: '2026-02-20',
            payment_amount: 330000,
            payment_method: '銀行振込',
            created_at: firebase.firestore.FieldValue.serverTimestamp()
        });
        console.log('✅ 入金情報1を作成');

        // 10. 入金情報を作成（案件2）
        await db.collection('payments').add({
            case_id: case2Ref.id,
            customer_id: customer2Ref.id,
            payment_date: '2026-02-25',
            payment_amount: 220000,
            payment_method: '銀行振込',
            created_at: firebase.firestore.FieldValue.serverTimestamp()
        });
        console.log('✅ 入金情報2を作成');

        console.log('🎉 テストデータの作成が完了しました！');
        alert('✅ テストデータの作成が完了しました！\n売上管理画面をリロードしてください。');
    } catch (error) {
        console.error('❌ エラーが発生しました:', error);
        alert('❌ エラー: ' + error.message);
    }
})();
