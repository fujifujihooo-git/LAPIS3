const { isTrackableEstimateItem, normalizeEstimateItem, rebuildCaseBillingSummary } = require('../js/billing_summary.js');

console.log('--- Testing billing_summary.js Unit Logic ---');

// 1. isTrackableEstimateItem
const item1 = { estimate_item_id: 'uuid-1', description: 'Item 1' };
const item2 = { estimate_item_id: 'uuid-2', is_legacy: true, description: 'Legacy Item' };
const item3 = { description: 'No ID Item' };
const item4 = null;

console.assert(isTrackableEstimateItem(item1) === true, 'item1 should be trackable');
console.assert(isTrackableEstimateItem(item2) === false, 'item2 (legacy) should not be trackable');
console.assert(isTrackableEstimateItem(item3) === false, 'item3 (no id) should not be trackable');
console.assert(isTrackableEstimateItem(item4) === false, 'item4 (null) should not be trackable');
console.log('✅ isTrackableEstimateItem tests passed.');

// 2. normalizeEstimateItem
const rawItem = {
    estimate_item_id: 'uuid-1',
    description: 'Test',
    unit_price: 1000,
    created_at: '2026-08-01',
    updated_at: '2026-08-02',
    ui_state: 'selected'
};
const normalized = normalizeEstimateItem(rawItem);
console.assert(normalized.estimate_item_id === 'uuid-1', 'ID preserved');
console.assert(normalized.created_at === undefined, 'created_at removed');
console.assert(normalized.updated_at === undefined, 'updated_at removed');
console.assert(normalized.ui_state === undefined, 'ui_state removed');
console.log('✅ normalizeEstimateItem tests passed.');

console.log('All billing_summary unit tests completed successfully.');
