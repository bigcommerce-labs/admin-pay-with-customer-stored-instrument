const API_BASE = 'https://api.bigcommerce.com';

export interface BcOrder {
  id: number;
  status_id: number;
  status: string;
  customer_id: number;
  total_inc_tax: string;
  currency_code: string;
  payment_status: string;
  date_created: string;
  billing_address: { first_name: string; last_name: string; email: string };
  items_total: number;
}

export interface BcCustomer {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
}

export interface BcStoredCard {
  type: 'stored_card';
  token: string;
  brand: string;
  last_4: string;
  expiry_month: number;
  expiry_year: number;
  issuer_identification_number?: string;
  is_default: boolean;
}

export interface BcStoredPaypal {
  type: 'stored_paypal_account';
  token: string;
  email: string;
  is_default: boolean;
}

export type BcPaymentMethodInstrument = BcStoredCard | BcStoredPaypal;

export interface BcPaymentMethod {
  id: string; // gateway id, e.g. 'braintree.card' — the payment_method_id
  name: string;
  type: string;
  test_mode: boolean;
  stored_instruments: BcPaymentMethodInstrument[];
}

export class BigCommerceClient {
  constructor(private readonly storeHash: string, private readonly accessToken: string) {}

  private async fetch(path: string, init: RequestInit = {}): Promise<Response> {
    const url = path.startsWith('http') ? path : `${API_BASE}/stores/${this.storeHash}${path}`;
    const res = await fetch(url, {
      ...init,
      headers: {
        'X-Auth-Token': this.accessToken,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    });
    return res;
  }

  async getOrder(orderId: number): Promise<BcOrder> {
    const res = await this.fetch(`/v2/orders/${orderId}`);
    if (!res.ok) throw new BcApiError(`getOrder(${orderId}) failed`, res.status, await res.text());
    return res.json();
  }

  async getCustomer(customerId: number): Promise<BcCustomer | null> {
    const res = await this.fetch(`/v3/customers?id:in=${customerId}`);
    if (!res.ok) throw new BcApiError(`getCustomer(${customerId}) failed`, res.status, await res.text());
    const body = await res.json();
    return body?.data?.[0] ?? null;
  }

  async getPaymentMethodsForOrder(orderId: number): Promise<BcPaymentMethod[]> {
    const res = await this.fetch(`/v3/payments/methods?order_id=${orderId}`);
    if (!res.ok) throw new BcApiError(`getPaymentMethods(${orderId}) failed`, res.status, await res.text());
    const body = await res.json();
    return body?.data ?? [];
  }

  async createPaymentAccessToken(orderId: number): Promise<string> {
    const res = await this.fetch(`/v3/payments/access_tokens`, {
      method: 'POST',
      body: JSON.stringify({ order: { id: orderId } }),
    });
    if (!res.ok) throw new BcApiError(`createPaymentAccessToken(${orderId}) failed`, res.status, await res.text());
    const body = await res.json();
    return body?.data?.id;
  }
}

export class BcApiError extends Error {
  constructor(message: string, public status: number, public body: string) {
    super(`${message} [${status}]`);
  }
}
