// End-to-end WebSocket chat test: verifies sent -> delivered -> read.
// Usage: start the server, then `node scripts/chat-test.mjs`
import { io } from 'socket.io-client';
const BASE = process.env.BASE_URL || 'http://127.0.0.1:4000';

async function token(name, email) {
  const r = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, email, password: 'Password123!' }),
  });
  const j = await r.json();
  return { token: j.token, id: j.user.id };
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const ts = Date.now();
  const alice = await token('Alice', `alice_${ts}@b.co.tz`);
  const bob = await token('Bob', `bob_${ts}@b.co.tz`);

  const sAlice = io(BASE, { auth: { token: alice.token } });
  const sBob = io(BASE, { auth: { token: bob.token } });
  await wait(400);

  const statuses = [];
  sAlice.on('message:status', (s) => statuses.push(s.status));
  let convId = null;
  sBob.on('message:new', (m) => (convId = m.conversationId));

  const ack = await sAlice.emitWithAck('message:send', { to: bob.id, body: 'Habari Bob!' });
  console.log('send ack ok:', ack.ok, '| initial status:', ack.message.status);
  await wait(500);

  await sBob.emitWithAck('message:read', { conversationId: convId });
  await wait(500);

  console.log('Statuses Alice received:', statuses.join(' -> '));
  const pass = ack.message.status === 'sent' && statuses.includes('delivered') && statuses.includes('read');
  console.log(pass ? 'RESULT: PASS — sent -> delivered -> read verified.' : 'RESULT: FAIL');
  sAlice.close();
  sBob.close();
  process.exit(pass ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
