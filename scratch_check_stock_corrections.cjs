const fs = require('fs');
const audit = JSON.parse(fs.readFileSync('cow_milk_audit.json', 'utf8'));
const logs = audit.logsSummary.logs;

const countLogs = logs.filter(l => l.reason === 'Stock Count Correction' || (l.notes && l.notes.includes('Count')));
console.log('Stock Count Correction logs for Cow Milk:', countLogs.length);
countLogs.forEach(l => {
  console.log(`[${l.date}] Diff: ${l.difference} | ${l.old_quantity} -> ${l.new_quantity} | notes: ${l.notes}`);
});
