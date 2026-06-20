import { Request, Response } from 'express';
import * as service from './products.service';

export async function create(req: Request, res: Response) {
  const product = await service.createProduct(req.user!.id, req.body);
  res.status(201).json({ data: product });
}

export async function list(req: Request, res: Response) {
  const result = await service.listProducts(req.query as any);
  res.status(200).json(result);
}

export async function getOne(req: Request, res: Response) {
  const product = await service.getProduct((req.params as any).id);
  res.status(200).json({ data: product });
}
