import { Router } from 'express';
import authRoutes from './modules/auth/auth.routes';
import productRoutes from './modules/products/products.routes';
import postRoutes from './modules/posts/posts.routes';
import orderRoutes from './modules/orders/orders.routes';

const api = Router();

api.use('/auth', authRoutes);
api.use('/products', productRoutes);
api.use('/posts', postRoutes);
api.use('/orders', orderRoutes);

export default api;
