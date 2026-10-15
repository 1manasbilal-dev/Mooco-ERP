const fs = require('fs');

const audit = JSON.parse(fs.readFileSync('cow_milk_audit.json', 'utf8'));

console.log('=== COW ITEM DETAILS ===');
console.log('ID:', audit.cowItem?.id);
console.log('Name:', audit.cowItem?.name);
console.log('Current DB Stock:', audit.cowItem?.stock);
console.log('Cost Price:', audit.cowItem?.cost_price);
console.log('Selling Price:', audit.cowItem?.selling_price);

console.log('\n=== ALLOCATIONS SUMMARY ===');
let allocToRetail = 0;
let allocToProduction = 0;
let allocToOther = 0;
let unallocatedQty = 0;

audit.allocationsSummary.allocations.forEach(a => {
  const orig = Number(a.original_quantity || 0);
  const rem = Number(a.remaining_quantity || 0);
  const alloc = Number(a.allocated_quantity || 0);
  unallocatedQty += rem;

  // Let's check history or destination
  const dest = a.destination;
  const history = a.details?.allocation_history || [];
  if (history.length > 0) {
    history.forEach(h => {
      if (h.destination === 'Retail') allocToRetail += Number(h.quantity || 0);
      else if (h.destination === 'Production') allocToProduction += Number(h.quantity || 0);
      else allocToOther += Number(h.quantity || 0);
    });
  } else if (alloc > 0) {
    if (dest === 'Retail') allocToRetail += alloc;
    else if (dest === 'Production') allocToProduction += alloc;
    else allocToOther += alloc;
  }
});

console.log('Total Allocated to Retail Counter:', allocToRetail);
console.log('Total Allocated to Production:', allocToProduction);
console.log('Total Allocated to Other:', allocToOther);
console.log('Remaining Unallocated in Tanks:', unallocatedQty);

console.log('\n=== INVENTORY LOGS ANALYSIS ===');
const logs = audit.logsSummary.logs;
console.log('Total Cow Logs count:', logs.length);

const logsByReason = {};
let netDiff = 0;
logs.forEach(l => {
  const reason = l.reason || 'Unknown';
  logsByReason[reason] = (logsByReason[reason] || 0) + Number(l.difference || 0);
  netDiff += Number(l.difference || 0);
});

console.log('Net Difference across all logs:', netDiff);
console.log('Difference grouped by reason:');
Object.entries(logsByReason).forEach(([reason, diff]) => {
  console.log(`  - ${reason}: ${diff.toFixed(3)} L`);
});

// Let's print the latest 20 logs for cow milk
console.log('\n=== LATEST 20 COW INVENTORY LOGS ===');
logs.slice(0, 20).forEach(l => {
  console.log(`[${l.date}] Diff: ${l.difference > 0 ? '+' : ''}${l.difference} (Old: ${l.old_quantity} -> New: ${l.new_quantity}) | Reason: ${l.reason} | Notes: ${l.notes}`);
});

console.log('\n=== OLDEST 10 COW INVENTORY LOGS ===');
logs.slice(-10).forEach(l => {
  console.log(`[${l.date}] Diff: ${l.difference > 0 ? '+' : ''}${l.difference} (Old: ${l.old_quantity} -> New: ${l.new_quantity}) | Reason: ${l.reason} | Notes: ${l.notes}`);
});
