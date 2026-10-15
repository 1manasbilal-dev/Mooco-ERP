// Tabbit setup program: all business API traffic is mocked in this QA browser.
globalThis.qaChecks = [];
globalThis.qaErrors = [];
globalThis.qaOrders = [];
globalThis.qaCheckoutCalls = [];
const fixture = {
  currentUser: { id:'qa-owner', name:'QA Owner', role_id:'role_super_admin', is_active:true },
  currentRole: { id:'role_super_admin',name:'Owner',permissions:['dashboard','pos','customer_orders','customers','sales_history'] },
  users:[],roles:[],isBooting:false,hasLoadedData:true,isDataLoading:false,isUserSwitcherOpen:false,
  sessionError:null,dataLoadError:null,sales:[],purchases:[],suppliers:[],customerTransactions:[],supplierTransactions:[],allocations:[],productionBatches:[],accounts:[{id:'cash',type:'Cash',name:'Counter cash',balance:1000,is_active:true},{id:'bank',type:'Bank',name:'Business bank',balance:2000,is_active:true}],
  customers:[{id:'c1',name:'Ayesha Khan',phone:'03001234567',address:'12 Garden Road, Lahore',balance:100,isActive:true,custom_prices:{milk:210}},{id:'c2',name:'Hassan Bakers',phone:'03001112222',address:'Main Market',balance:0,isActive:true},{id:'inactive',name:'Inactive Customer',phone:'',balance:0,isActive:false}],
  items:[{id:'milk',name:'Buffalo Milk',category:['Milk'],item_type:['Sale product'],unit:'L',selling_price:230,isActive:true,allow_loose_sale:true},{id:'bottle',name:'Bottled Milk',category:['Milk'],item_type:['Sale product'],unit:'L',selling_price:300,isActive:true,allow_loose_sale:false,variants:[{id:'pack',name:'1L bottle',selling_price:300,isActive:true,quantity_in_base_unit:1}]},{id:'inactive-product',name:'Inactive product',category:['Milk'],item_type:['Sale product'],unit:'L',selling_price:100,isActive:false}],
  inventory:[{id:'stock1',item_id:'milk',name:'Buffalo Milk',stock_type:'Retail Stock',unit:'L',quantity:20,price:230},{id:'stock2',item_id:'bottle',name:'Bottled Milk',stock_type:'Retail Stock',unit:'L',quantity:0,variant_stocks:{pack:8}}],
  activeShiftSession:{id:'qa-shift',status:'Active',business_date:new Date().toISOString().slice(0,10),business_day_id:'qa-day',drawer_id:'cash',account_id:'cash',user_id:'qa-owner',user_name:'QA Owner',shift_name:'Morning',opening_float:1000},
  settings:{general:{companyName:'Mooco Dairy',currencySymbol:'Rs',shifts:['Morning','Evening']},financial:{enabledPaymentModes:['Cash','Online','Credit'],visibleAccountIds:['cash','bank'],defaultCashAccountId:'cash',defaultDigitalAccountId:'bank'},sales:{invoicePrefix:'MOO-',enableTax:false,showPosSearch:true,showPosCategories:true},inventory:{allowNegativeStock:false,lowStockThreshold:10,customUnits:[]},production:{}},
  cashInTransit:{count:0,amount:0},expenses:[],expenseVendors:[],expenseVendorTransactions:[],bankTransactions:[],shiftSessions:[],cashDrawers:[],businessDays:[]
};
await context.addInitScript(data => {
  window.__orderFixture = data; window.__ordinarySales = []; window.__qaPermissions = null;
  localStorage.setItem('app_theme','light');localStorage.removeItem('mooco_workspace_tabs');
}, fixture);
await context.route('**/context/DairyContext.tsx*', route => route.fulfill({ contentType:'application/javascript', body:`
  import React from '/node_modules/.vite/deps/react.js';
  const noop=async()=>false;const source={...window.__orderFixture,hasPermission:key=>!window.__qaPermissions||window.__qaPermissions.some(permission=>permission===key||permission.startsWith(key+':')),canPerform:(key,action)=>!window.__qaPermissions||window.__qaPermissions.includes(key)||window.__qaPermissions.includes(key+':'+action),isDayLocked:()=>false,retryLoading:noop,addSale:async(...args)=>{window.__ordinarySales.push(args);return true;},getBusinessDate:()=>new Date().toISOString().slice(0,10),getShiftTotals:()=>({expectedCash:1000,gross_sales:0,cash_sales:0,online_sales:0,credit_sales:0,cash_collections:0,cash_refunds:0,cash_expenses:0,cash_purchases:0,other_cash_in:0,other_cash_out:0,bills_count:0}),getDeleteAssessment:()=>({canDelete:false,relatedRecords:[]})};
  const value=new Proxy(source,{get:(target,key)=>key in target?target[key]:typeof key==='string'&&/^(add|update|delete|set|record|remove|safeDelete|reactivate|reorder|reset|clear|allocate|return|create|cancel|refresh|submit|accept|resolve|close|reopen|perform|start|open|login|switch|logout)/.test(key)?noop:undefined});
  export const DairyProvider=({children})=>children;export const useDairy=()=>value;
` }));
await context.route('**/lib/syncService.ts*', route => route.fulfill({contentType:'application/javascript',body:`export const syncService={getState:()=>({isOnline:true,isSyncing:false,pendingCount:0,failedCount:0}),subscribe:()=>()=>{}};`}));
await context.route(/https:\/\/[^/]*\.supabase\.co\//, async route => {
  const request = route.request(), url = new URL(request.url());
  const objectResult = request.headers().accept?.includes('vnd.pgrst.object');
  const respond = value => route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(value)});
  if (url.pathname.endsWith('/customer_orders')) {
    if(globalThis.qaApiFailure)return route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({message:'Temporary test outage'})});
    const id = url.searchParams.get('id')?.replace(/^eq\./,'');
    if (request.method()==='GET') {
      const records = id ? qaOrders.filter(order=>order.id===id) : qaOrders;
      return respond(objectResult ? records[0] : records);
    }
    const payload = request.postDataJSON();
    if (request.method()==='POST') {
      const row={...payload,revision:1,sale_id:null,created_at:new Date().toISOString(),updated_at:new Date().toISOString()};qaOrders.unshift(row);
      return respond(objectResult?row:[row]);
    }
    if (request.method()==='PATCH') {
      const row=qaOrders.find(order=>order.id===id&&order.revision===Number(url.searchParams.get('revision')?.replace(/^eq\./,'')));
      if(!row)return respond([]);
      Object.assign(row,payload,{revision:row.revision+1,updated_at:new Date().toISOString()});return respond(objectResult?row:[row]);
    }
  }
  if (url.pathname.endsWith('/rpc/checkout_customer_order')) {
    const payload=request.postDataJSON();qaCheckoutCalls.push(payload);
    const order=qaOrders.find(row=>row.id===payload.p_order_id);
    const sale={id:`co_sale_${order.id}`,bill_number:`INV-${order.order_number}`,date:new Date().toISOString(),customer_id:order.customer_id,customer_name:order.customer_name,items:order.items,subtotal:order.subtotal,discount:order.discount,total:order.total,payment_mode:payload.p_payload.payment_mode,status:'Completed',details:{customer_order_id:order.id,customer_phone:order.customer_phone,paid_amount:payload.p_payload.paid_amount,due_amount:order.total-payload.p_payload.paid_amount,cash_given:payload.p_payload.cash_given,change_return:payload.p_payload.change_return}};
    order.status='Completed';order.sale_id=sale.id;order.revision++;return respond(sale);
  }
  // No unmatched request ever reaches real business data.
  return respond([]);
});
page.on('pageerror', error => qaErrors.push(error.message));
await page.goto('http://127.0.0.1:3000/customer-orders',{waitUntil:'domcontentloaded'});
await expect(page.getByRole('button',{name:'New Order',exact:true})).toBeVisible();
return await tabbit.observe({frames:'none',maxChars:6500});
