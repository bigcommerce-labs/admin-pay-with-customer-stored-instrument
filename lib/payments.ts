const PAYMENTS_BASE = 'https://payments.bigcommerce.com';

export type StoredInstrumentType = 'stored_card' | 'stored_paypal_account';

export interface ProcessPaymentResult {
  id: string;
  status: 'success' | 'failed' | string;
  transaction_type: 'authorization' | 'purchase' | string;
}

export interface ProcessPaymentFailure {
  status: number;
  title?: string;
  detail?: string;
  errors?: unknown;
}

export async function processStoredInstrumentPayment(args: {
  storeHash: string;
  pat: string;
  instrumentType: StoredInstrumentType;
  instrumentToken: string;
  paymentMethodId: string;
}): Promise<{ ok: true; data: ProcessPaymentResult } | { ok: false; error: ProcessPaymentFailure }> {
  const res = await fetch(`${PAYMENTS_BASE}/stores/${args.storeHash}/payments`, {
    method: 'POST',
    headers: {
      Authorization: `PAT ${args.pat}`,
      Accept: 'application/vnd.bc.v1+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      payment: {
        instrument: { type: args.instrumentType, token: args.instrumentToken },
        payment_method_id: args.paymentMethodId,
      },
    }),
  });

  const text = await res.text();
  let body: unknown;
  try { body = JSON.parse(text); } catch { body = text; }

  if (!res.ok) {
    const b = body as { title?: string; detail?: string; errors?: unknown } | string;
    return {
      ok: false,
      error: {
        status: res.status,
        ...(typeof b === 'object' ? b : { detail: b }),
      },
    };
  }
  return { ok: true, data: (body as { data: ProcessPaymentResult }).data };
}
