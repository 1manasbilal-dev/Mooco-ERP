const fs = require('fs');

const audit = JSON.parse(fs.readFileSync('cow_milk_audit.json', 'utf8'));
const logs = audit.logsSummary.logs;

// Sort logs chronologically (ascending)
const sortedLogs = [...logs].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

console.log('Total logs:', sortedLogs.length);
console.log('First log date:', sortedLogs[0]?.date);
console.log('Last log date:', sortedLogs[sortedLogs.length - 1]?.date);

// Let's filter all non-sale logs, or large changes (> 5 L)
console.log('\n=== ALL NON-SALE LOGS OR MAJOR CHANGES FOR COW MILK ===');
sortedLogs.forEach((l, idx) => {
  if (l.reason !== 'Sale' || Math.abs(Number(l.difference)) >= 10) {
    console.log(`[${l.date}] (${l.reason}) diff: ${l.difference > 0 ? '+' : ''}${l.difference} | ${l.old_quantity} -> ${l.new_quantity} | notes: ${l.notes || ''}`);
  }
});

// Let's check daily net sales of cow milk
console.log('\n=== DAILY SALES TOTALS FOR COW MILK (Liters) ===');
const salesByDay = {};
audit.salesSummary.cowSales.forEach(s => {
  const day = (s.date || '').slice(0, 10);
  salesByDay[day] = (salesByDay[day] || 0) + Number(s.qty || 0);
});
Object.entries(salesByDay).sort().forEach(([d, qty]) => {
  console.log(`${d}: sold ${qty.toFixed(2)} L`);
});

// Let's check daily allocations to Retail Counter for cow milk
console.log('\n=== DAILY ALLOCATIONS TO COUNTER FOR COW MILK (Liters) ===');
const allocByDay = {};
sortedLogs.filter(l => l.reason === 'Allocation').forEach(l => {
  const day = (l.date || '').slice(0, 10);
  allocByDay[day] = (allocByDay[day] || 0) + Number(l.difference || 0);
});
Object.entries(allocByDay).sort().forEach(([d, qty]) => {
  console.log(`${d}: allocated ${qty.toFixed(2)} L`);
});
