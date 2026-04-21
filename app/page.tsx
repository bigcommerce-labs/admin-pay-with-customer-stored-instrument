export default function Home() {
  return (
    <main style={{ padding: '3rem', fontFamily: 'sans-serif', maxWidth: 720 }}>
      <h1>Pay with customer saved payments</h1>
      <p>
        This app is launched from the BigCommerce admin panel via the app extension on an order.
        Open an order in <b>Incomplete</b> status and click <b>Pay with customer saved payments</b>.
      </p>
    </main>
  );
}
