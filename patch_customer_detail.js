const fs = require('fs');
const path = 'd:/Antigravity/LAPIS3/customer_detail.js';
let content = fs.readFileSync(path, 'utf8').split('\n');

function patchFunction(funcName, name, containerId, collection, resultKey) {
    const lineIndex = content.findIndex(line => line.includes(`async function ${funcName}(cId) {`));
    if (lineIndex !== -1) {
        let endLineIndex = -1;
        let braceCount = 0;
        for (let i = lineIndex; i < content.length; i++) {
            if (content[i].includes('{')) braceCount++;
            if (content[i].includes('}')) braceCount--;
            if (braceCount === 0 && i > lineIndex) {
                endLineIndex = i;
                break;
            }
        }
        if (endLineIndex !== -1) {
            content.splice(lineIndex, endLineIndex - lineIndex + 1, 
`    async function ${funcName}(cId) {
        const queryId = !isNaN(cId) ? Number(cId) : cId;
        await DetailPageHelper.loadSection({
            name: '${name}',
            containerId: '${containerId}',
            fetchFn: async () => {
                await executeTestHook();
                const snap = await db.collection('${collection}')
                    .where('customer_id', '==', queryId)
                    .orderBy('updated_at', 'desc')
                    .limit(20)
                    .get();
                return {
                    data: snap.docs.map(d => d.data({ serverTimestamps: 'estimate' })),
                    lastDoc: snap.docs.length === 20 ? snap.docs[snap.docs.length - 1] : null
                };
            },
            renderFn: (result) => {
                ${resultKey} = result.data;
                lastVisibleDoc.${resultKey} = result.lastDoc;
                render${name}(cId);
            }
        });
    }`
            );
            console.log(`Patched ${funcName}`);
            return true;
        }
    }
    return false;
}

// 1. Fix init cId
const initLineIndex = content.findIndex(line => line.includes('const cId = parseInt(customerIdParam);'));
if (initLineIndex !== -1) {
    content[initLineIndex] = content[initLineIndex].replace('const cId = parseInt(customerIdParam);', 'const cId = !isNaN(customerIdParam) ? Number(customerIdParam) : customerIdParam;');
}

// 2. Patch all sections
patchFunction('loadCases', 'RelatedCases', 'related-cases-body', 'cases', 'cases');
// Note: Other sections have slightly different names/keys, but loadCases is the priority.
// For RelatedCases, the function name is renderRelatedCases, but the name in config is 'RelatedCases'.
// Let's adjust slightly for others if needed.

// Wait, I'll just do loadCases for now to be safe, as it's the most complex one.
// Actually, let's fix the name for loadCases.
content = content.join('\n');
content = content.replace("renderRelatedCases(cId);", "renderRelatedCases(cId);"); // No change needed

fs.writeFileSync(path, content);
console.log('Patch complete');
