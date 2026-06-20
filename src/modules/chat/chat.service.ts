import { query, withTransaction } from '../../config/db';
import { AppError } from '../../lib/AppError';

export interface MessageRow {
  id: string;
  conversation_id: string;
  sender_id: string;
  recipient_id: string;
  body: string;
  status: 'sent' | 'delivered' | 'read';
  created_at: string;
  delivered_at: string | null;
  read_at: string | null;
}

/** Conversations are keyed by the sorted user pair, guaranteeing one per pair. */
function orderPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

export async function getOrCreateConversation(userA: string, userB: string): Promise<string> {
  if (userA === userB) throw AppError.badRequest('Cannot start a conversation with yourself');
  const [low, high] = orderPair(userA, userB);

  const res = await query<{ id: string }>(
    `INSERT INTO conversations (user_low, user_high)
     VALUES ($1, $2)
     ON CONFLICT (user_low, user_high) DO UPDATE SET user_low = EXCLUDED.user_low
     RETURNING id`,
    [low, high]
  );
  return res.rows[0].id;
}

export async function persistMessage(params: {
  senderId: string;
  recipientId: string;
  body: string;
}): Promise<MessageRow> {
  const recipient = await query('SELECT id FROM users WHERE id = $1', [params.recipientId]);
  if (!recipient.rowCount) throw AppError.notFound('Recipient does not exist');

  const conversationId = await getOrCreateConversation(params.senderId, params.recipientId);
  const res = await query<MessageRow>(
    `INSERT INTO messages (conversation_id, sender_id, recipient_id, body, status)
     VALUES ($1, $2, $3, $4, 'sent')
     RETURNING *`,
    [conversationId, params.senderId, params.recipientId, params.body]
  );
  return res.rows[0];
}

/** Transition a single message sent -> delivered (idempotent). */
export async function markDelivered(messageId: string): Promise<MessageRow | null> {
  const res = await query<MessageRow>(
    `UPDATE messages
        SET status = 'delivered', delivered_at = now()
      WHERE id = $1 AND status = 'sent'
    RETURNING *`,
    [messageId]
  );
  return res.rows[0] ?? null;
}

/**
 * Mark every message the reader received in this conversation as read.
 * Returns the affected message ids grouped by their original sender so the
 * gateway can notify that sender of the status change.
 */
export async function markConversationRead(conversationId: string, readerId: string) {
  return withTransaction(async (client) => {
    const res = await client.query<{ id: string; sender_id: string }>(
      `UPDATE messages
          SET status = 'read', read_at = now(),
              delivered_at = COALESCE(delivered_at, now())
        WHERE conversation_id = $1 AND recipient_id = $2 AND status <> 'read'
      RETURNING id, sender_id`,
      [conversationId, readerId]
    );
    return res.rows;
  });
}

/** Any undelivered messages waiting for a user who just came online. */
export async function pendingForRecipient(recipientId: string): Promise<MessageRow[]> {
  const res = await query<MessageRow>(
    `SELECT * FROM messages
      WHERE recipient_id = $1 AND status = 'sent'
      ORDER BY created_at ASC`,
    [recipientId]
  );
  return res.rows;
}

export async function getHistory(
  conversationId: string,
  userId: string,
  page = 1,
  limit = 30
) {
  // Authorisation: the requester must be a participant in the conversation.
  const conv = await query<{ user_low: string; user_high: string }>(
    'SELECT user_low, user_high FROM conversations WHERE id = $1',
    [conversationId]
  );
  if (!conv.rowCount) throw AppError.notFound('Conversation not found');
  const { user_low, user_high } = conv.rows[0];
  if (userId !== user_low && userId !== user_high) {
    throw AppError.forbidden('Not a participant in this conversation');
  }

  const offset = (page - 1) * limit;
  const rows = await query<MessageRow>(
    `SELECT * FROM messages
      WHERE conversation_id = $1
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3`,
    [conversationId, limit, offset]
  );
  return rows.rows.reverse(); // chronological for display
}
