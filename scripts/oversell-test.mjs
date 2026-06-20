const BASE = process.env.BASE_URL || 'http://127.0.0.1:4000';

async function main() {
  // Register a fresh buyer
  const email = `buyer_${Date.now()}@buckets.co.tz`;
  let r = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Race Tester', email, password: 'Password123!' }),
  });
  const { token } = await r.json();

  // Find the single-unit product (stock = 1)
  r = await fetch(`${BASE}/api/products?limit=100`);
  const list = await r.json();
  const target = list.data.find(p => Number(p.stock) === 1);
  if (!target) throw new Error('No stock=1 product found');
  console.log(`Target product: "${target.title}"  id=${target.id}  stock=${target.stock}`);

  // Fire N concurrent orders for the LAST unit
  const N = 1000;
  const auth = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  const body = JSON.stringify({ items: [{ productId: target.id, quantity: 1 }] });

  const t0 = Date.now();
  const results = await Promise.all(
    Array.from({ length: N }, () =>
      fetch(`${BASE}/api/orders`, { method: 'POST', headers: auth, body })
        .then(res => res.status)
        .catch(() => 0)
    )
  );
  const ms = Date.now() - t0;

  const ok = results.filter(s => s === 201).length;
  const conflict = results.filter(s => s === 409).length;
  const other = results.filter(s => s !== 201 && s !== 409).length;

  // Verify final stock from the API
  r = await fetch(`${BASE}/api/products/${target.id}`);
  const finalStock = (await r.json()).data.stock;

  console.log('--------------------------------------------------');
  console.log(`Concurrent attempts : ${N}`);
  console.log(`Succeeded (201)     : ${ok}`);
  console.log(`Rejected  (409)     : ${conflict}`);
  console.log(`Other statuses      : ${other}`);
  console.log(`Final stock in DB   : ${finalStock}`);
  console.log(`Elapsed             : ${ms} ms`);
  console.log('--------------------------------------------------');

  const pass = ok === 1 && Number(finalStock) === 0 && conflict === N - 1;
  console.log(pass ? 'RESULT: PASS — exactly one buyer won, no overselling.'
                   : 'RESULT: FAIL');
  process.exit(pass ? 0 : 1);
}
main().catch(e => { console.error(e); process.exit(1); });
