export const today = '2026-10-01';
const bill = (id, date, name, total, mode = 'Cash', product = 'Buffalo Milk') => ({ id, date, bill_number:`MOO-${id}`, customer_name:name, subtotal:total, total, discount:0, payment_mode:mode, status:'Completed', paid_amount:mode === 'Credit' ? 1000 : total, items:[{itemId:product === 'Buffalo Milk' ? 'milk-b' : 'ghee', name:product, qty:total/(product === 'Buffalo Milk' ? 230 : 2500), price:product === 'Buffalo Milk' ? 230 : 2500, total}] });
export const sales = [
 bill('101','2026-09-30T21:15:00Z','Walk-in customer',18200),
 bill('102',`${today}T07:20:00+05:00`,'Al Rehman Sweets',26750,'Online'),
 bill('103',`${today}T09:45:00+05:00`,'Walk-in customer',23100),
 bill('104',`${today}T12:30:00+05:00`,'Green Valley Cafe',18600,'Credit'),
 bill('105',`${today}T15:10:00+05:00`,'Walk-in customer',22500,'Cash','Desi Ghee'),
 bill('106',`${today}T18:15:00+05:00`,'Hassan Bakers',19300,'Online','Fresh Yogurt'),
 ...Array.from({length:13}, (_,i)=>bill(`prev${i}`, `2026-09-${String(30-i).padStart(2,'0')}T${String(7+i%6*2).padStart(2,'0')}:30:00+05:00`, 'Daily counter',85000+i*4500, i%3===0?'Online':'Cash')),
 {...bill('return', `${today}T15:00:00+05:00`, 'Returned order',9000), status:'Returned'},
];
const purchases = [
 {id:'p1',date:`${today}T06:30:00+05:00`,supplier_id:'farmer1',supplier_name:'Rashid Dairy Farm',quantity:360,total_amount:61200,milk_type:'Buffalo',fat:6.5,paid_amount:30000,status:'Completed',rate_per_liter:170,shift:'Morning'},
 {id:'p2',date:`${today}T08:30:00+05:00`,supplier_id:'farmer2',supplier_name:'Ahmed Milk Supply',quantity:220,total_amount:30800,milk_type:'Cow',fat:3.8,paid_amount:20000,status:'Completed',rate_per_liter:140,shift:'Morning'},
 ...Array.from({length:13},(_,i)=>({id:`pp${i}`,date:`2026-09-${String(30-i).padStart(2,'0')}`,supplier_id:'farmer1',supplier_name:'Rashid Dairy Farm',quantity:420+i*10,total_amount:(420+i*10)*160,milk_type:'Buffalo',paid_amount:20000,status:'Completed',shift:'Morning'})),
];
export const fixture = {
 currentUser:{id:'qa-owner',name:'Anas Bilal',role_id:'role_super_admin',is_active:true}, currentRole:{id:'role_super_admin',name:'Owner',permissions:['dashboard']},
 users:[],roles:[],isBooting:false,hasLoadedData:true,isDataLoading:false,isUserSwitcherOpen:false,
 sales,purchases,
 expenses:[{id:'e1',date:today,category:'Staff salaries',description:'Counter team · October',amount:8500,paidAmount:8500,paymentStatus:'Paid',paymentMode:'Cash'}, {id:'e2',date:today,category:'Electricity',description:'Chilling & refrigeration',amount:6200,paidAmount:0,paymentStatus:'Unpaid',paymentMode:'Online'}, {id:'e3',date:today,category:'Packaging',description:'Bottles and carry bags',amount:1200,paidAmount:1200,paymentStatus:'Paid',paymentMode:'Cash'}, {id:'e4',date:today,category:'Transport',description:'Morning collection route',amount:1800,paidAmount:1800,paymentStatus:'Paid',paymentMode:'Cash'}],
 inventory:[{id:'stock1',item_id:'milk-b',name:'Buffalo Milk',category:'Milk',stock_type:'Retail Stock',unit:'L',quantity:165,price:230},{id:'stock2',item_id:'milk-c',name:'Cow Milk',category:'Milk',stock_type:'Retail Stock',unit:'L',quantity:70,price:200},{id:'stock3',item_id:'ghee',name:'Desi Ghee',category:'Products',stock_type:'Finished Goods',unit:'kg',quantity:3,price:2500}],
 items:[{id:'milk-b',name:'Buffalo Milk',category:['Milk'],item_type:['Sale product'],unit:'L',selling_price:230,reorder_level:20,isActive:true},{id:'milk-c',name:'Cow Milk',category:['Milk'],item_type:['Sale product'],unit:'L',selling_price:200,reorder_level:20,isActive:true},{id:'ghee',name:'Desi Ghee',category:['Dairy'],item_type:['Sale product'],unit:'kg',selling_price:2500,reorder_level:5,isActive:true}],
 allocations:[{id:'a1',date:today,original_quantity:360,allocated_quantity:190,remaining_quantity:170,status:'Partially Allocated',destination:'Retail Counter'},{id:'a2',date:today,original_quantity:220,allocated_quantity:220,remaining_quantity:0,status:'Fully Allocated',destination:'Retail Counter'}],
 inventoryLogs:[{date:today,reason:'Allocation',item_name:'Buffalo Milk',difference:300}],
 productionBatches:[{id:'batch1',batch_number:'B-001',product_name:'Desi Ghee',start_date:today,status:'Processing',quantity_input:110}],
 accounts:[{id:'cash',type:'Cash',balance:84500},{id:'bank',type:'Bank',balance:285750},{id:'wallet',type:'Wallet',balance:18700},{id:'asset',type:'Asset',balance:999999}],
 cashInTransit:{count:1,amount:12500},
 customers:[{id:'c1',name:'Al Rehman Sweets',balance:48500,route:'Main market',credit_limit:40000},{id:'c2',name:'Green Valley Cafe',balance:28600,route:'Town centre'},{id:'c3',name:'Hassan Bakers',balance:15200,route:'North route'},{id:'c4',name:'City Restaurant',balance:8700,route:'Main market'}],
 suppliers:[{id:'farmer1',name:'Rashid Dairy Farm',pending_balance:64500,phone:'',village:'Lahore'},{id:'farmer2',name:'Ahmed Milk Supply',pending_balance:18000,phone:'',village:'Lahore'}],
 materialPurchases:[], expenseVendors:[],expenseVendorTransactions:[],customerTransactions:[],supplierTransactions:[],
 activeShiftSession:{status:'Active',business_date:today,shift_name:'Evening counter'},settings:{general:{companyName:'Mooco Dairy'}},
};

