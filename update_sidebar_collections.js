const fs = require('fs');
const path = require('path');

const dir = './';

const newSidebarNavTemplate = (activeHref) => `            <ul class="sidebar-nav">
                <li class="nav-header">Main</li>
                <li class="nav-item">
                    <a href="index.html"${activeHref === 'index.html' ? ' class="active"' : ''}>
                        <span class="nav-icon">📊</span>
                        <span class="nav-label">案件管理</span>
                    </a>
                </li>

                <li class="nav-header">Management</li>
                <li class="nav-item">
                    <a href="customer_list.html"${activeHref === 'customer_list.html' ? ' class="active"' : ''}>
                        <span class="nav-icon">🏢</span>
                        <span class="nav-label">顧客管理</span>
                    </a>
                </li>
                <li class="nav-item">
                    <a href="license_list.html"${activeHref === 'license_list.html' ? ' class="active"' : ''}>
                        <span class="nav-icon">📜</span>
                        <span class="nav-label">許認可管理</span>
                    </a>
                </li>
                <li class="nav-item">
                    <a href="license_washout.html"${activeHref === 'license_washout.html' ? ' class="active"' : ''}>
                        <span class="nav-icon">📅</span>
                        <span class="nav-label">決算期別一覧</span>
                    </a>
                </li>

                <li class="nav-header">COLLECTIONS</li>
                <li class="nav-item">
                    <a href="invoice_list.html"${activeHref === 'invoice_list.html' ? ' class="active"' : ''}>
                        <span class="nav-icon">💰</span>
                        <span class="nav-label">請求管理</span>
                    </a>
                </li>
                <li class="nav-item">
                    <a href="receipt_list.html"${activeHref === 'receipt_list.html' ? ' class="active"' : ''}>
                        <span class="nav-icon">🏦</span>
                        <span class="nav-label">入金管理</span>
                    </a>
                </li>
                <li class="nav-item">
                    <a href="unpaid_invoice_list.html"${activeHref === 'unpaid_invoice_list.html' ? ' class="active"' : ''}>
                        <span class="nav-icon">💡</span>
                        <span class="nav-label">未収一覧・消込</span>
                    </a>
                </li>
                <li class="nav-item">
                    <a href="sales_list.html"${activeHref === 'sales_list.html' ? ' class="active"' : ''}>
                        <span class="nav-icon">📈</span>
                        <span class="nav-label">売上管理</span>
                    </a>
                </li>

                <li class="nav-header">Settings</li>
                <li class="nav-item">
                    <a href="staff_list.html"${activeHref === 'staff_list.html' ? ' class="active"' : ''}>
                        <span class="nav-icon">👥</span>
                        <span class="nav-label">担当者管理</span>
                    </a>
                </li>
                <li class="nav-item">
                    <a href="government_office_list.html"${activeHref === 'government_office_list.html' ? ' class="active"' : ''}>
                        <span class="nav-icon">🏛️</span>
                        <span class="nav-label">官公庁マスタ</span>
                    </a>
                </li>
                <li class="nav-item">
                    <a href="license_types_list.html"${activeHref === 'license_types_list.html' ? ' class="active"' : ''}>
                        <span class="nav-icon">📋</span>
                        <span class="nav-label">許認可マスタ</span>
                    </a>
                </li>
                <li class="nav-item">
                    <a href="import.html" class="nav-link${activeHref === 'import.html' ? ' active' : ''}">
                        <i data-lucide="upload-cloud"></i>
                        <span class="nav-label">インポート（復元）</span>
                    </a>
                </li>
                <li class="nav-item">
                    <a href="backup.html"${activeHref === 'backup.html' ? ' class="active"' : ''}>
                        <span class="nav-icon">💾</span>
                        <span class="nav-label">バックアップ管理</span>
                    </a>
                </li>
            </ul>`;

fs.readdirSync(dir).forEach(file => {
    if (file.endsWith('.html')) {
        const filePath = path.join(dir, file);
        let content = fs.readFileSync(filePath, 'utf8');
        
        const regex = /<ul class="sidebar-nav">[\s\S]*?<\/ul>/;
        
        if (regex.test(content)) {
            const activeMatch = content.match(/<a\s+href="([^"]+)"[^>]*class="[^"]*\bactive\b[^"]*"[^>]*>/);
            let activeHref = '';
            if (activeMatch) {
               activeHref = activeMatch[1];
            } else {
               // Fallback if no active link found
               if (file.includes('detail') || file.includes('edit')) {
                   const prefix = file.split('_')[0];
                   activeHref = prefix + '_list.html';
               } else {
                   activeHref = file;
               }
            }
            
            content = content.replace(regex, newSidebarNavTemplate(activeHref));
            fs.writeFileSync(filePath, content, 'utf8');
            console.log(`Updated nav in ${file} (active: ${activeHref})`);
        }
    }
});
