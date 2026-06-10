import mongoose from 'mongoose';
import { config } from '../config';
import { MongoMemoryServer } from 'mongodb-memory-server';

let mongod: MongoMemoryServer | null = null;

async function getMongoUri(): Promise<string> {
  if (process.env.USE_MEMORY_MONGO === 'true' || !config.mongoUri.includes('localhost')) {
    return config.mongoUri;
  }

  try {
    await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 3000 });
    await mongoose.disconnect();
    return config.mongoUri;
  } catch {
    console.log('本地 MongoDB 不可用，启动内存 MongoDB...');
    mongod = await MongoMemoryServer.create();
    const uri = mongod.getUri();
    console.log(`内存 MongoDB 已启动: ${uri}`);
    return uri;
  }
}

export async function connectDatabase(): Promise<void> {
  try {
    const uri = await getMongoUri();
    await mongoose.connect(uri);
    console.log('Connected to MongoDB successfully');
  } catch (error) {
    console.error('MongoDB connection error:', error);
    process.exit(1);
  }

  mongoose.connection.on('error', (err) => {
    console.error('MongoDB error:', err);
  });

  mongoose.connection.on('disconnected', () => {
    console.warn('MongoDB disconnected');
  });
}

export async function shutdownDatabase(): Promise<void> {
  await mongoose.disconnect();
  if (mongod) {
    await mongod.stop();
    console.log('内存 MongoDB 已关闭');
  }
}
