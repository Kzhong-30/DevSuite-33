import { Request, Response, NextFunction } from 'express';
import { config } from '../config';
export function apiKeyAuth(req: Request, res: Response, next: NextFunction): void {
  if (!config.apiKeyEnabled) return next();
  const publicPaths = ['/api-docs', '/swagger.json', '/health', '/'];
  if (publicPaths.some(p => req.path === p || req.path.startsWith(p + '/'))) return next();
  const key = req.headers['x-api-key'] || req.query.api_key;
  if (!key || key !== config.apiKey) {
    res.status(401).json({ success: false, message: 'Unauthorized: invalid or missing API key' });
    return;
  }
  next();
}
