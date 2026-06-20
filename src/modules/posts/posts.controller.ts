import { Request, Response } from 'express';
import * as service from './posts.service';

export async function create(req: Request, res: Response) {
  const post = await service.createPost(req.user!.id, req.body);
  res.status(201).json({ data: post });
}

export async function list(req: Request, res: Response) {
  const result = await service.listFeed(req.query as any);
  res.status(200).json(result);
}
