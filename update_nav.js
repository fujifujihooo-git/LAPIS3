const fs = require('fs');
const path = require('path');

const dir = './';
const newNavItem = `                <li class="nav-item">
                    <a href="unpaid_invoice_list.html">
                        <span class="nav-icon">💡</span>
                        <span class="nav-label">未収一覧・消込</span>
                    </a>
                </li>`;

fs.readdirSync(dir).forEach(file => {
    if (file.endsWith('.html') && file !== 'unpaid_invoice_list.html') {
        const filePath = path.join(dir, file);
        let content = fs.readFileSync(filePath, 'utf8');
        
        // 既存のナビゲーションに未収一覧を追加する
        if (content.includes('receipt_list.html') && !content.includes('unpaid_invoice_list.html')) {
            content = content.replace(
                /<li class="nav-item">\s*<a href="receipt_list\.html".*?>\s*<span class="nav-icon">🏦<\/span>\s*<span class="nav-label">入金管理<\/span>\s*<\/a>\s*<\/li>/g,
                `<li class="nav-item">
                    <a href="receipt_list.html">
                        <span class="nav-icon">🏦</span>
                        <span class="nav-label">入金管理</span>
                    </a>
                </li>
${newNavItem}`
            );
            fs.writeFileSync(filePath, content, 'utf8');
            console.log(`Updated nav in ${file}`);
        }
    }
});
