import { query } from '../../config/db';
import { AppError } from '../../lib/AppError';
import { Pagination, toOffset, buildMeta } from '../../lib/pagination';
import { CreatePostInput } from './posts.schemas';

export async function createPost(authorId: string, input: CreatePostInput) {
  // If a product is linked, verify it exists for a clean 404 rather than an FK error.
  if (input.productId) {
    const p = await query('SELECT id FROM products WHERE id = $1', [input.productId]);
    if (!p.rowCount) throw AppError.badRequest('Linked product does not exist');
  }

  const res = await query(
    `INSERT INTO posts (author_id, caption, product_id)
     VALUES ($1, $2, $3)
     RETURNING id, author_id, caption, product_id, created_at`,
    [authorId, input.caption, input.productId ?? null]
  );
  return res.rows[0];
}

export async function listFeed(p: Pagination) {
  const { limit, offset } = toOffset(p);

  // Join author + linked product so the feed is renderable in one round trip.
  const rows = await query(
    `SELECT
       po.id, po.caption, po.created_at,
       json_build_object('id', u.id, 'name', u.name) AS author,
       CASE WHEN pr.id IS NULL THEN NULL ELSE
         json_build_object('id', pr.id, 'title', pr.title, 'price', pr.price, 'stock', pr.stock)
       END AS product
     FROM posts po
     JOIN users u ON u.id = po.author_id
     LEFT JOIN products pr ON pr.id = po.product_id
     ORDER BY po.created_at DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );

  const count = await query<{ count: number }>('SELECT COUNT(*)::int AS count FROM posts');
  const total = Number(count.rows[0]?.count ?? 0);

  return { data: rows.rows, meta: buildMeta(p.page, p.limit, total) };
}
