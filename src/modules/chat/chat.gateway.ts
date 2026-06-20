import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import { z } from 'zod';
import { env } from '../../config/env';
import { verifyToken } from '../../lib/jwt';
import { logger } from '../../lib/logger';
import * as chat from './chat.service';

/**
 * Real-time 1-to-1 chat over Socket.IO.
 *
 * Rooms: each user joins `user:<id>`. Sending to a user = emitting to that room
 * (covers multiple devices/tabs). Messages are persisted before any emit, so
 * delivery survives restarts and offline recipients.
 *
 * Status lifecycle:  sent ──(recipient online / connects)──▶ delivered ──(recipient opens)──▶ read
 * The sender is notified of every transition via `message:status`.
 */

const sendSchema = z.object({
  to: z.string().uuid(),
  body: z.string().trim().min(1).max(4000),
});
const readSchema = z.object({ conversationId: z.string().uuid() });
const historySchema = z.object({
  conversationId: z.string().uuid(),
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(100).default(30),
});

const room = (userId: string) => `user:${userId}`;

export function initChatGateway(httpServer: HttpServer): Server {
  const io = new Server(httpServer, {
    cors: { origin: env.corsOrigin === '*' ? true : env.corsOrigin },
  });

  // --- Handshake auth: a valid JWT is required to open the socket. ---
  io.use((socket, next) => {
    const token =
      (socket.handshake.auth?.token as string | undefined) ||
      (socket.handshake.headers?.authorization?.toString().replace('Bearer ', ''));
    if (!token) return next(new Error('UNAUTHORIZED: missing token'));
    try {
      const payload = verifyToken(token);
      socket.data.userId = payload.sub;
      socket.data.name = payload.name;
      next();
    } catch {
      next(new Error('UNAUTHORIZED: invalid token'));
    }
  });

  io.on('connection', async (socket: Socket) => {
    const userId: string = socket.data.userId;
    socket.join(room(userId));
    logger.info('Socket connected', { userId, socketId: socket.id });

    // On connect, flush messages that were sent while this user was offline:
    // persist as delivered and tell the original senders.
    try {
      const pending = await chat.pendingForRecipient(userId);
      for (const msg of pending) {
        const updated = await chat.markDelivered(msg.id);
        if (updated) {
          socket.emit('message:new', serialize(updated));
          io.to(room(updated.sender_id)).emit('message:status', {
            messageId: updated.id,
            status: 'delivered',
          });
        }
      }
    } catch (err) {
      logger.warn('Failed flushing pending messages', { error: String(err) });
    }

    // --- Send a 1-to-1 message ---
    socket.on('message:send', async (raw, ack?: (resp: unknown) => void) => {
      const parsed = sendSchema.safeParse(raw);
      if (!parsed.success) return ack?.({ ok: false, error: 'Invalid payload' });

      try {
        const saved = await chat.persistMessage({
          senderId: userId,
          recipientId: parsed.data.to,
          body: parsed.data.body,
        });

        ack?.({ ok: true, message: serialize(saved) });

        // Deliver to recipient's room.
        io.to(room(parsed.data.to)).emit('message:new', serialize(saved));

        // If the recipient currently has an open socket, immediately mark delivered.
        const recipientSockets = await io.in(room(parsed.data.to)).fetchSockets();
        if (recipientSockets.length > 0) {
          const updated = await chat.markDelivered(saved.id);
          if (updated) {
            socket.emit('message:status', { messageId: updated.id, status: 'delivered' });
          }
        }
      } catch (err) {
        ack?.({ ok: false, error: err instanceof Error ? err.message : 'send failed' });
      }
    });

    // --- Recipient opened the conversation: mark everything read ---
    socket.on('message:read', async (raw, ack?: (resp: unknown) => void) => {
      const parsed = readSchema.safeParse(raw);
      if (!parsed.success) return ack?.({ ok: false, error: 'Invalid payload' });
      try {
        const affected = await chat.markConversationRead(parsed.data.conversationId, userId);
        ack?.({ ok: true, count: affected.length });

        // Notify each original sender that their messages were read.
        const bySender = new Map<string, string[]>();
        for (const row of affected) {
          const list = bySender.get(row.sender_id) ?? [];
          list.push(row.id);
          bySender.set(row.sender_id, list);
        }
        for (const [senderId, ids] of bySender) {
          io.to(room(senderId)).emit('message:status', {
            conversationId: parsed.data.conversationId,
            messageIds: ids,
            status: 'read',
          });
        }
      } catch (err) {
        ack?.({ ok: false, error: err instanceof Error ? err.message : 'read failed' });
      }
    });

    // --- Fetch persisted history (pagination) ---
    socket.on('messages:history', async (raw, ack?: (resp: unknown) => void) => {
      const parsed = historySchema.safeParse(raw);
      if (!parsed.success) return ack?.({ ok: false, error: 'Invalid payload' });
      try {
        const messages = await chat.getHistory(
          parsed.data.conversationId,
          userId,
          parsed.data.page,
          parsed.data.limit
        );
        ack?.({ ok: true, messages: messages.map(serialize) });
      } catch (err) {
        ack?.({ ok: false, error: err instanceof Error ? err.message : 'history failed' });
      }
    });

    socket.on('disconnect', () => {
      logger.info('Socket disconnected', { userId, socketId: socket.id });
    });
  });

  return io;
}

function serialize(m: chat.MessageRow) {
  return {
    id: m.id,
    conversationId: m.conversation_id,
    senderId: m.sender_id,
    recipientId: m.recipient_id,
    body: m.body,
    status: m.status,
    createdAt: m.created_at,
    deliveredAt: m.delivered_at,
    readAt: m.read_at,
  };
}
