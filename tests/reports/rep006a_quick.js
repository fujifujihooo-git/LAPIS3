// REP-006A 簡易偵察: エミュレータの顧客件数・名称一覧を確認する
const admin = require('firebase-admin');

process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8085';
if (admin.apps.length === 0) admin.initializeApp({ projectId: 'lapis3-4113e' });
const db = admin.firestore();

(async () => {
    try {
        const custSnap = await db.collection('customers').get();
        console.log('=== LAPIS3 顧客データ実態（エミュレータ接続）===');
        console.log('顧客件数:', custSnap.size, '件');
        console.log('');

        if (custSnap.size === 0) {
            console.log('エミュレータに顧客データがありません。本番データを確認してください。');
            process.exit(0);
        }

        const rows = custSnap.docs.map(d => {
            const data = d.data();
            const name = data.customer_name || '(未設定)';
            const rem = String(data.remarks || '').length;
            const hasNewline = String(data.remarks || '').includes('\n');
            return {
                id: data.customer_id,
                name: name,
                nameLen: name.length,
                remarksLen: rem,
                hasNewline: hasNewline,
                status: data.status || ''
            };
        });

        // 顧客名 長い順
        const sortedByName = [...rows].sort((a, b) => b.nameLen - a.nameLen);
        console.log('--- 顧客名 長い順 ---');
        sortedByName.forEach((r, i) => {
            console.log('  ' + (i+1) + '. [' + r.id + '] ' + r.name + ' (' + r.nameLen + '文字 / 備考' + r.remarksLen + '文字' + (r.hasNewline ? ' / 改行あり' : '') + ')');
        });

        console.log('');
        console.log('--- 統計サマリー ---');
        const maxNameLen = Math.max(...rows.map(r => r.nameLen));
        const maxRemarkLen = Math.max(...rows.map(r => r.remarksLen));
        const withNewline = rows.filter(r => r.hasNewline).length;
        console.log('顧客名 最大: ' + maxNameLen + '文字');
        console.log('備考   最大: ' + maxRemarkLen + '文字');
        console.log('改行入り備考: ' + withNewline + '件');

        process.exit(0);
    } catch(e) {
        console.error('エラー（エミュレータが起動していない可能性）:', e.code || '', e.message.substring(0, 100));
        console.error('→ firebase emulators:start を先に実行してください');
        process.exit(1);
    }
})();
