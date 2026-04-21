import { NextRequest, NextResponse } from 'next/server';
import { requireContext, UnauthorizedError } from '@/lib/session';
import { BcApiError } from '@/lib/bigcommerce';
import { processStoredCardPayment } from '@/lib/payments';

export async function POST(
  req: NextRequest,
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

  const body = (await req.json()) as { paymentMethodId?: string; instrumentToken?: string };
  if (!body.paymentMethodId || !body.instrumentToken) {
    return NextResponse.json({ error: 'paymentMethodId and instrumentToken required' }, { status: 400 });
  }

  // Re-verify order eligibility + instrument ownership server-side (defense in depth).
  try {
    const order = await context.client.getOrder(orderId);
    if (order.customer_id === 0) return NextResponse.json({ error: 'Guest order' }, { status: 400 });
    if (order.status_id !== 0) {
      return NextResponse.json({ error: `Order status ${order.status} is not eligible` }, { status: 400 });
    }

    const methods = await context.client.getPaymentMethodsForOrder(orderId);
    const method = methods.find((m) => m.id === body.paymentMethodId);
    const instrumentMatch = method?.stored_instruments?.find((i) => i.token === body.instrumentToken);
    if (!method || !instrumentMatch) {
      return NextResponse.json({ error: 'Instrument not available for this order' }, { status: 400 });
    }

    const pat = await context.client.createPaymentAccessToken(orderId);
    const result = await processStoredCardPayment({
      storeHash: context.session.storeHash,
      pat,
      instrumentToken: body.instrumentToken,
      paymentMethodId: body.paymentMethodId,
    });

    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: 422 });
    }

    return NextResponse.json({
      ok: true,
      transaction: result.data,
      adminOrderUrl: `https://store-${context.session.storeHash}.mybigcommerce.com/manage/orders/${orderId}`,
    });
  } catch (err) {
    if (err instanceof BcApiError) {
      return NextResponse.json({ error: err.message, detail: err.body }, { status: err.status });
    }
    throw err;
  }
}
