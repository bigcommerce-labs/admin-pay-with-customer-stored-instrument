import { NextRequest, NextResponse } from 'next/server';
import { requireContext, UnauthorizedError } from '@/lib/session';
import { BcApiError } from '@/lib/bigcommerce';

interface AggregatedInstrument {
  paymentMethodId: string;
  gatewayName: string;
  token: string;
  brand: string;
  last4: string;
  expiry: string;
  isDefault: boolean;
}

type Eligibility =
  | { eligible: true }
  | { eligible: false; reason: 'guest' | 'wrong_status' | 'no_instruments'; statusId?: number; statusName?: string };

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  let context;
  try {
    context = await requireContext();
  } catch (err) {
    if (err instanceof UnauthorizedError) return NextResponse.json({ error: err.message }, { status: 401 });
    throw err;
  }

  const orderId = Number((await ctx.params).id);
  if (!Number.isFinite(orderId)) return NextResponse.json({ error: 'Invalid order id' }, { status: 400 });

  try {
    const order = await context.client.getOrder(orderId);
    const adminOrderUrl = `https://store-${context.session.storeHash}.mybigcommerce.com/manage/orders/${orderId}`;

    // Guest check first — no customer data to fetch.
    if (order.customer_id === 0) {
      return NextResponse.json({
        order: summarizeOrder(order),
        customer: null,
        instruments: [],
        eligibility: { eligible: false, reason: 'guest' } as Eligibility,
        adminOrderUrl,
      });
    }

    // Status check — app only works on Incomplete (0).
    if (order.status_id !== 0) {
      const customer = await context.client.getCustomer(order.customer_id);
      return NextResponse.json({
        order: summarizeOrder(order),
        customer,
        instruments: [],
        eligibility: {
          eligible: false,
          reason: 'wrong_status',
          statusId: order.status_id,
          statusName: order.status,
        } as Eligibility,
        adminOrderUrl,
      });
    }

    const [customer, methods] = await Promise.all([
      context.client.getCustomer(order.customer_id),
      context.client.getPaymentMethodsForOrder(orderId),
    ]);

    const instruments: AggregatedInstrument[] = methods.flatMap((m) =>
      (m.stored_instruments ?? []).map((i) => ({
        paymentMethodId: m.id,
        gatewayName: m.name,
        token: i.token,
        brand: i.brand,
        last4: i.last_4,
        expiry: `${String(i.expiry_month).padStart(2, '0')}/${i.expiry_year}`,
        isDefault: i.is_default,
      }))
    );

    const eligibility: Eligibility = instruments.length > 0
      ? { eligible: true }
      : { eligible: false, reason: 'no_instruments' };

    return NextResponse.json({
      order: summarizeOrder(order),
      customer,
      instruments,
      eligibility,
      adminOrderUrl,
    });
  } catch (err) {
    if (err instanceof BcApiError) {
      return NextResponse.json({ error: err.message, detail: err.body }, { status: err.status });
    }
    throw err;
  }
}

function summarizeOrder(o: Awaited<ReturnType<import('@/lib/bigcommerce').BigCommerceClient['getOrder']>>) {
  return {
    id: o.id,
    statusId: o.status_id,
    status: o.status,
    paymentStatus: o.payment_status,
    customerId: o.customer_id,
    total: o.total_inc_tax,
    currency: o.currency_code,
    itemsTotal: o.items_total,
    dateCreated: o.date_created,
    billing: {
      name: `${o.billing_address.first_name} ${o.billing_address.last_name}`.trim(),
      email: o.billing_address.email,
    },
  };
}
