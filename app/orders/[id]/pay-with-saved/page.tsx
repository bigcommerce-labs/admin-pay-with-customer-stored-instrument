'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import {
  Box, Button, Flex, H2, H3, Message, Panel, ProgressCircle, Radio, Small, Text,
} from '@bigcommerce/big-design';

interface OrderSummary {
  id: number; statusId: number; status: string; paymentStatus: string;
  customerId: number; total: string; currency: string; itemsTotal: number;
  dateCreated: string; billing: { name: string; email: string };
}
interface Customer { id: number; first_name: string; last_name: string; email: string }
type Instrument =
  | {
      type: 'stored_card';
      paymentMethodId: string; gatewayName: string; token: string;
      brand: string; last4: string; expiry: string; isDefault: boolean;
    }
  | {
      type: 'stored_paypal_account';
      paymentMethodId: string; gatewayName: string; token: string;
      email: string; isDefault: boolean;
    };

function instrumentLabel(i: Instrument): string {
  if (i.type === 'stored_paypal_account') return `PayPal · ${i.email}`;
  return `${i.brand} ****${i.last4} · exp ${i.expiry}`;
}
type Eligibility =
  | { eligible: true }
  | { eligible: false; reason: 'guest' | 'wrong_status' | 'no_instruments'; statusId?: number; statusName?: string };

interface AggregateResponse {
  order: OrderSummary; customer: Customer | null;
  instruments: Instrument[]; eligibility: Eligibility;
  adminOrderUrl: string;
}

type Phase =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; data: AggregateResponse }
  | { kind: 'submitting'; data: AggregateResponse; selected: Instrument }
  | { kind: 'result'; data: AggregateResponse; ok: true; transaction: { id: string; status: string; transaction_type: string } }
  | { kind: 'result'; data: AggregateResponse; ok: false; error: { status: number; title?: string; detail?: string } };

export default function PayWithSavedPage() {
  const params = useParams<{ id: string }>();
  const orderId = params.id;
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [selectedToken, setSelectedToken] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/orders/${orderId}`);
      if (!res.ok) {
        const body = await res.text();
        if (!cancelled) setPhase({ kind: 'error', message: `Failed to load order (${res.status}): ${body}` });
        return;
      }
      const data = (await res.json()) as AggregateResponse;
      if (!cancelled) {
        setPhase({ kind: 'ready', data });
        const def = data.instruments.find((i) => i.isDefault) ?? data.instruments[0];
        if (def) setSelectedToken(def.token);
      }
    })();
    return () => { cancelled = true; };
  }, [orderId]);

  useEffect(() => {
    if (phase.kind !== 'result' || !phase.ok) return;
    try {
      window.parent.postMessage(
        { type: 'bc-app-extension:order-updated', orderId: Number(orderId) },
        '*'
      );
    } catch { /* cross-origin — best effort */ }
  }, [phase.kind, phase.kind === 'result' && phase.ok, orderId]);

  if (phase.kind === 'loading') {
    return (
      <Box padding="large"><Flex justifyContent="center"><ProgressCircle size="medium" /></Flex></Box>
    );
  }
  if (phase.kind === 'error') {
    return <Box padding="large"><Message type="error" messages={[{ text: phase.message }]} /></Box>;
  }

  const data = phase.data;
  const submitting = phase.kind === 'submitting';

  const selected = data.instruments.find((i) => i.token === selectedToken) ?? null;

  async function submit() {
    if (!selected) return;
    setPhase({ kind: 'submitting', data, selected });
    const res = await fetch(`/api/orders/${orderId}/pay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paymentMethodId: selected.paymentMethodId, instrumentToken: selected.token }),
    });
    const body = await res.json();
    if (res.ok && body.ok) {
      setPhase({ kind: 'result', data, ok: true, transaction: body.transaction });
    } else {
      setPhase({ kind: 'result', data, ok: false, error: body.error ?? { status: res.status, detail: 'Payment failed' } });
    }
  }

  if (phase.kind === 'result') {
    return (
      <Box padding="large">
        <OrderSummaryPanel order={data.order} customer={data.customer} />
        {phase.ok ? (
          <Message
            type="success"
            header="Payment authorized"
            messages={[{ text: `Transaction ${phase.transaction.id} — ${phase.transaction.transaction_type} (${phase.transaction.status}). Close this panel to return to the order page, then refresh it to see the updated payment status.` }]}
          />
        ) : (
          <>
            <Message
              type="error"
              header="Payment failed"
              messages={[{ text: `${phase.error.title ?? 'Error'}: ${phase.error.detail ?? `HTTP ${phase.error.status}`}` }]}
            />
            <Box marginTop="medium">
              <Button variant="secondary" onClick={() => setPhase({ kind: 'ready', data })}>
                Try another payment method
              </Button>
            </Box>
          </>
        )}
      </Box>
    );
  }

  return (
    <Box padding="large">
      <H2>Pay with customer saved payments</H2>
      <OrderSummaryPanel order={data.order} customer={data.customer} />

      {!data.eligibility.eligible && (
        <Panel>
          {data.eligibility.reason === 'guest' && (
            <Message type="warning" header="Guest order" messages={[{ text: 'This order has no customer associated (guest checkout). No stored payment methods are available.' }]} />
          )}
          {data.eligibility.reason === 'wrong_status' && (
            <Message type="warning" header="Order not eligible" messages={[{ text: `Order status is "${data.eligibility.statusName}". This app only applies payment to orders in "Incomplete" status.` }]} />
          )}
          {data.eligibility.reason === 'no_instruments' && (
            <Message type="warning" header="No stored payment methods" messages={[{ text: 'This customer has no stored payment methods on file. Add one via the admin panel or complete checkout with a new card.' }]} />
          )}
        </Panel>
      )}

      {data.eligibility.eligible && (
        <Panel header="Select a stored payment method">
          <Flex flexDirection="column">
            {data.instruments.map((i) => (
              <Box key={i.token} paddingVertical="xSmall">
                <Radio
                  name="instrument"
                  checked={selectedToken === i.token}
                  onChange={() => setSelectedToken(i.token)}
                  label={`${instrumentLabel(i)}${i.isDefault ? ' · default' : ''}`}
                  description={`Gateway: ${i.gatewayName} (${i.paymentMethodId})`}
                />
              </Box>
            ))}
          </Flex>
          <Box marginTop="medium">
            <Button variant="primary" onClick={submit} disabled={!selected || submitting} isLoading={submitting}>
              Apply payment · {data.order.currency} {data.order.total}
            </Button>
          </Box>
        </Panel>
      )}
    </Box>
  );
}

function OrderSummaryPanel({ order, customer }: { order: OrderSummary; customer: Customer | null }) {
  return (
    <Panel header={`Order #${order.id}`}>
      <Flex flexDirection="column" flexGap="medium">
        <Box>
          <H3>Order</H3>
          <Text>Status: <b>{order.status}</b></Text>
          <Text>Payment: <b>{order.paymentStatus || '—'}</b></Text>
          <Text>Total: <b>{order.currency} {order.total}</b></Text>
          <Small>Items: {order.itemsTotal} · Created {new Date(order.dateCreated).toLocaleString()}</Small>
        </Box>
        <Box>
          <H3>Customer</H3>
          {order.customerId === 0 ? (
            <Text>Guest order</Text>
          ) : customer ? (
            <>
              <Text><b>{customer.first_name} {customer.last_name}</b></Text>
              <Text>{customer.email}</Text>
              <Small>Customer ID: {customer.id}</Small>
            </>
          ) : (
            <Text>Customer {order.customerId}</Text>
          )}
        </Box>
      </Flex>
    </Panel>
  );
}
