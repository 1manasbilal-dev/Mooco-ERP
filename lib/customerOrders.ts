import { supabase } from './supabase';
import { loadRead } from './loadRequest';
import { CustomerOrder, CustomerOrderLine } from '../types';
import { roundCurrency, roundQuantity } from './db';

export const orderIsOpen = (order: CustomerOrder) => !['Completed', 'Cancelled'].includes(order.status);
export const localOrderDate = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
export function orderAmounts(lines: CustomerOrderLine[], discount = 0, advancePaid = 0) {
  const subtotal = roundCurrency(lines.reduce((sum, line) => sum + roundCurrency(line.qty * line.price), 0));
  const total = roundCurrency(subtotal - roundCurrency(discount));
  const advance = roundCurrency(Math.max(0, Math.min(total > 0 ? total : 0, Number(advancePaid) || 0)));
  const remaining = roundCurrency(Math.max(0, total - advance));
  const payment_status = total <= 0 || (advance >= total && total > 0) ? 'Paid' : advance > 0 ? 'Partial' : 'Unpaid';
  return { subtotal, discount: roundCurrency(discount), total, advance_paid: advance, remaining, payment_status };
}
export function validateOrder(order: Partial<CustomerOrder>) {
  if (!order.customer_id) throw new Error('Select a customer for this order.');
  if (!order.due_date || !/^\d{4}-\d{2}-\d{2}$/.test(order.due_date)) throw new Error('Choose a pickup or delivery date.');
  if (order.fulfillment === 'Delivery' && !order.address?.trim()) throw new Error('Enter the delivery address.');
  if (!order.items?.length) throw new Error('Add at least one product.');
  for (const line of order.items) {
    if (!line.itemId || !Number.isFinite(line.qty) || roundQuantity(line.qty) <= 0 || !Number.isFinite(line.price) || line.price < 0) throw new Error('Each product needs a valid quantity and rate.');
    if (line.variantId && !Number.isInteger(line.qty)) throw new Error('Pack quantities must be whole numbers.');
  }
  const { subtotal, total } = orderAmounts(order.items, Number(order.discount) || 0);
  if (!Number.isFinite(order.discount) || order.discount! < 0 || order.discount! > subtotal) throw new Error('Discount must be between zero and the subtotal.');
  if (order.advance_paid !== undefined && order.advance_paid !== null) {
    if (!Number.isFinite(order.advance_paid) || order.advance_paid < 0) throw new Error('Advance payment cannot be negative.');
    if (order.advance_paid > total && total > 0) throw new Error('Advance payment cannot exceed the total order amount.');
  }
}
function checkOnline() {
  if (!navigator.onLine) throw new Error('Connect to the internet to manage customer orders.');
}
function fail(error: any) {
  if (error.code === 'PGRST205' || error.code === '42P01') throw new Error('Customer Orders is not connected yet. Ask the owner to finish setup, then refresh.');
  throw new Error(error.message || 'Customer order could not be saved.');
}
export async function listCustomerOrders(): Promise<CustomerOrder[]> {
  checkOnline();
  const records: CustomerOrder[] = [];
  // Explicit paging avoids silently losing orders at the API's row limit.
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await loadRead(supabase.from('customer_orders').select('*').order('created_at', { ascending: false }).order('id').range(offset, offset + 499));
    if (error) fail(error);
    records.push(...data);
    if (data.length < 500) break;
  }
  return records;
}
export async function getCustomerOrder(id: string): Promise<CustomerOrder> {
  checkOnline();
  const { data, error } = await loadRead(supabase.from('customer_orders').select('*').eq('id', id).single());
  if (error) fail(error);
  return data;
}
export async function saveCustomerOrder(order: Partial<CustomerOrder>, existing?: CustomerOrder): Promise<CustomerOrder> {
  checkOnline(); validateOrder(order);
  const query = existing
    ? supabase.from('customer_orders').update(order).eq('id', existing.id).eq('revision', existing.revision)
    : supabase.from('customer_orders').insert(order);
  const { data, error } = await loadRead(query.select('*').maybeSingle());
  if (error?.code === '23505' && !existing && order.id) {
    const saved = await getCustomerOrder(order.id);
    window.dispatchEvent(new Event('mooco-customer-orders-changed'));
    return saved;
  }
  if (error) fail(error);
  if (!data) throw new Error('This order changed at another counter. Refresh and try again.');
  window.dispatchEvent(new Event('mooco-customer-orders-changed'));
  return data;
}
export async function changeCustomerOrderStatus(order: CustomerOrder, status: CustomerOrder['status']) {
  checkOnline();
  const { data, error } = await loadRead(supabase.from('customer_orders').update({ status }).eq('id', order.id).eq('revision', order.revision).select('*').maybeSingle());
  if (error) fail(error);
  if (!data) throw new Error('This order changed at another counter. Refresh and try again.');
  window.dispatchEvent(new Event('mooco-customer-orders-changed'));
  return data as CustomerOrder;
}
/** Posts the not-yet-posted part of the order's advance as a khata payment into the receiving account. */
export async function postCustomerOrderAdvance(order: CustomerOrder, payload: { tx_id: string; account_id: string; business_day_id?: string | null; shift_session_id?: string | null; drawer_id?: string | null; cashier_id?: string | null }): Promise<CustomerOrder> {
  checkOnline();
  const { data, error } = await loadRead(supabase.rpc('post_customer_order_advance', {
    p_order_id: order.id,
    p_tx_id: payload.tx_id,
    p_account_id: payload.account_id,
    p_business_day_id: payload.business_day_id || null,
    p_shift_session_id: payload.shift_session_id || null,
    p_drawer_id: payload.drawer_id || null,
    p_cashier_id: payload.cashier_id || null
  }));
  if (error) fail(error);
  window.dispatchEvent(new Event('mooco-customer-orders-changed'));
  return data as CustomerOrder;
}
export const unpostedAdvance = (order: CustomerOrder) => roundCurrency(Math.max(0, Number(order.advance_paid || 0) - Number(order.advance_posted || 0)));
export async function checkoutCustomerOrder(order: CustomerOrder, payload: Record<string, unknown>) {
  checkOnline();
  const { data, error } = await loadRead(supabase.rpc('checkout_customer_order', { p_order_id: order.id, p_revision: order.revision, p_payload: payload }));
  if (error) fail(error);
  window.dispatchEvent(new Event('mooco-customer-orders-changed'));
  return data;
}
