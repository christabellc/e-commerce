import { Request, Response } from 'express';
import * as service from './orders.service';

export async function create(req: Request, res: Response) {
  const order = await service.createOrder(req.user!.id, req.body);
  res.status(201).json({ data: order });
}
