const fs = require('fs');
const audit = JSON.parse(fs.readFileSync('cow_milk_audit.json', 'utf8'));
const logs = audit.logsSummary.logs;

const retailToProdLogs = logs.filter(l => 
  (l.notes && l.notes.toLowerCase().includes('leftover')) ||
  (l.notes && l.notes.toLowerCase().includes('production'))
);
console.log('Cow Milk Retail to Production logs count:', retailToProdLogs.length);
retailToProdLogs.forEach(l => {
  console.log(`[${l.date}] Diff: ${l.difference} | ${l.old_quantity} -> ${l.new_quantity} | notes: ${l.notes}`);
});
