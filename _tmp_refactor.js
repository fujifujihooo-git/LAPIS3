const fs = require('fs');
const path = require('path');

const EXCLUDES = ['_BACKUP_BEFORE_REDESIGN', 'node_modules', '.git'];
const EXCLUDE_FILES = ['migrate-data.html', 'start_emulator.bat', '_tmp_refactor.js'];
const TARGET_EXTS = ['.html', '.js', '.css', '.md', '.json'];

function findAndReplace(dir) {
    const files = fs.readdirSync(dir);
    let count = 0;

    for (const file of files) {
        if (EXCLUDES.includes(file)) continue;

        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);

        if (stat.isDirectory()) {
            count += findAndReplace(fullPath);
        } else if (stat.isFile()) {
            if (EXCLUDE_FILES.includes(file)) continue;
            
            const ext = path.extname(file).toLowerCase();
            if (!TARGET_EXTS.includes(ext)) continue;

            const content = fs.readFileSync(fullPath, 'utf8');
            if (content.includes('lapis2') || content.includes('LAPIS2') || content.includes('Lapis2')) {
                let newContent = content
                    .replace(/lapis2/g, 'lapis3')
                    .replace(/LAPIS2/g, 'LAPIS3')
                    .replace(/Lapis2/g, 'Lapis3');
                
                if (content !== newContent) {
                    fs.writeFileSync(fullPath, newContent, 'utf-8');
                    console.log(`Updated: ${fullPath}`);
                    count++;
                }
            }
        }
    }
    return count;
}

const total = findAndReplace(__dirname);
console.log('');
console.log(`Total files replaced: ${total}`);
