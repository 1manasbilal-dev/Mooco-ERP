const fs = require('fs');
const audit = JSON.parse(fs.readFileSync('cow_milk_audit.json', 'utf8'));
const logs = audit.logsSummary.logs;

const oct6Logs = logs.filter(l => l.date && l.date.startsWith('2026-10-06'));
console.log('Total Oct 6 logs for Cow Milk:', oct6Logs.length);
oct6Logs.forEach(l => {
  console.log(`[${l.date}] (${l.reason}) diff: ${l.difference} | ${l.old_quantity} -> ${l.new_quantity} | ${l.notes}`);
});
