export const config = {
  port: process.env.PORT ? parseInt(process.env.PORT) : 3000,
  mongoUri: process.env.MONGO_URI || 'mongodb://localhost:27017/logistics_tracking',
  deviceOfflineTimeout: parseInt(process.env.DEVICE_OFFLINE_TIMEOUT || '30000'),
  corsOrigin: process.env.CORS_ORIGIN || '*'
};
