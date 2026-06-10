import express, { Request, Response } from 'express';
import cors from 'cors';
import http from 'http';
import { config } from './config';
import { connectDatabase } from './database';
import { initWebSocket } from './services/websocketService';
import { setupSwagger } from './swagger';
import deviceRoutes from './routes/deviceRoutes';
import geofenceRoutes from './routes/geofenceRoutes';

async function bootstrap(): Promise<void> {
  await connectDatabase();

  const app = express();
  const server = http.createServer(app);

  app.use(cors({ origin: config.corsOrigin }));
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));

  app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    next();
  });

  app.get('/', (req: Request, res: Response) => {
    res.json({
      name: '物流实时位置追踪服务',
      version: '1.0.0',
      status: 'running',
      docs: `/api-docs`,
      swagger: `/swagger.json`,
      websocket: {
        endpoint: '/',
        description: 'Socket.io endpoint for real-time tracking'
      }
    });
  });

  app.get('/health', (req: Request, res: Response) => {
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString()
    });
  });

  app.use('/devices', deviceRoutes);
  app.use('/geofences', geofenceRoutes);

  setupSwagger(app);

  app.use((err: any, req: Request, res: Response, next: express.NextFunction) => {
    console.error('Unhandled error:', err);
    res.status(err.status || 500).json({
      success: false,
      message: err.message || 'Internal Server Error',
      error: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  });

  app.use((req: Request, res: Response) => {
    res.status(404).json({
      success: false,
      message: 'Route not found',
      path: req.path,
      method: req.method
    });
  });

  initWebSocket(server);

  server.listen(config.port, () => {
    console.log(`\n========================================`);
    console.log(`  物流实时位置追踪服务已启动`);
    console.log(`========================================`);
    console.log(`  HTTP Server:     http://localhost:${config.port}`);
    console.log(`  API 文档:        http://localhost:${config.port}/api-docs`);
    console.log(`  Swagger JSON:    http://localhost:${config.port}/swagger.json`);
    console.log(`  MongoDB:         ${config.mongoUri}`);
    console.log(`  设备离线超时:    ${config.deviceOfflineTimeout}ms`);
    console.log(`========================================\n`);
  });

  const shutdownSignals = ['SIGINT', 'SIGTERM', 'SIGQUIT'];
  shutdownSignals.forEach((signal) => {
    process.on(signal, async () => {
      console.log(`\nReceived ${signal}, shutting down gracefully...`);
      server.close(() => {
        console.log('HTTP server closed');
        process.exit(0);
      });
    });
  });
}

bootstrap().catch((error) => {
  console.error('Failed to start application:', error);
  process.exit(1);
});

export { bootstrap };
