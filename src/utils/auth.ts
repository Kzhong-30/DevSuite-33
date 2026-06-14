import { Request, Response, NextFunction } from 'express';

function generateToken(length = 32): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

const API_KEYS = new Set<string>(process.env.API_KEYS ? process.env.API_KEYS.split(',') : ['logistics-api-key-2024']);

function apiKeyAuth(req: Request, res: Response, next: NextFunction): void {
  const apiKey = (req.headers['x-api-key'] as string) || (req.query.apiKey as string);
  if (!apiKey || !API_KEYS.has(apiKey)) {
    res.status(401).json({ success: false, message: 'Invalid or missing API key. Provide x-api-key header or apiKey query param.' });
    return;
  }
  next();
}

export { generateToken, apiKeyAuth, API_KEYS };
