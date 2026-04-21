const GRAPHQL_URL = (storeHash: string) =>
  `https://api.bigcommerce.com/stores/${storeHash}/graphql`;

const CREATE_MUTATION = /* GraphQL */ `
  mutation CreateAppExtension($input: CreateAppExtensionInput!) {
    appExtension {
      createAppExtension(input: $input) {
        appExtension {
          id
          context
          model
          url
          label { defaultValue }
        }
      }
    }
  }
`;

const DELETE_MUTATION = /* GraphQL */ `
  mutation DeleteAppExtension($input: DeleteAppExtensionInput!) {
    appExtension {
      deleteAppExtension(input: $input) {
        deletedAppExtensionId
      }
    }
  }
`;

const LIST_QUERY = /* GraphQL */ `
  query AppExtensions {
    store {
      appExtensions {
        edges { node { id model context url label { defaultValue } } }
      }
    }
  }
`;

export type ExtensionContext = 'LINK' | 'PANEL';

interface ExtensionNode {
  id: string;
  model: string;
  context: string;
  url: string;
}

async function gql<T>(storeHash: string, accessToken: string, query: string, variables?: unknown): Promise<T> {
  const res = await fetch(GRAPHQL_URL(storeHash), {
    method: 'POST',
    headers: {
      'X-Auth-Token': accessToken,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`GraphQL HTTP ${res.status}: ${await res.text()}`);
  const body = await res.json();
  if (body.errors) throw new Error(`GraphQL errors: ${JSON.stringify(body.errors)}`);
  return body.data as T;
}

export async function listExtensions(storeHash: string, accessToken: string): Promise<ExtensionNode[]> {
  const data = await gql<{ store: { appExtensions: { edges: { node: ExtensionNode }[] } } }>(
    storeHash, accessToken, LIST_QUERY
  );
  return data.store.appExtensions.edges.map((e) => e.node);
}

export async function deleteExtension(storeHash: string, accessToken: string, id: string): Promise<void> {
  await gql(storeHash, accessToken, DELETE_MUTATION, { input: { id } });
}

export async function createOrdersExtension(args: {
  storeHash: string;
  accessToken: string;
  label: string;
  url: string;
  context: ExtensionContext;
}): Promise<string> {
  const data = await gql<{ appExtension: { createAppExtension: { appExtension: { id: string } } } }>(
    args.storeHash,
    args.accessToken,
    CREATE_MUTATION,
    {
      input: {
        context: args.context,
        model: 'ORDERS',
        url: args.url,
        label: { defaultValue: args.label, locales: [{ value: args.label, localeCode: 'en-US' }] },
      },
    }
  );
  return data.appExtension.createAppExtension.appExtension.id;
}

/**
 * Idempotently register the ORDERS app extension. If any of this app's ORDERS
 * extensions exist that don't match the desired url+context, delete them, then
 * create the desired one. Keeps us at exactly one extension.
 */
export async function ensureOrdersExtension(args: {
  storeHash: string;
  accessToken: string;
  label: string;
  url: string;
  context: ExtensionContext;
}): Promise<string> {
  const all = await listExtensions(args.storeHash, args.accessToken);
  const ours = all.filter((e) => e.model === 'ORDERS');

  const match = ours.find((e) => e.url === args.url && e.context === args.context);
  if (match) return match.id;

  for (const stale of ours) {
    await deleteExtension(args.storeHash, args.accessToken, stale.id);
  }

  return createOrdersExtension(args);
}
