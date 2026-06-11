import { MongoMemoryServer } from 'mongodb-memory-server';
import { spawn, ChildProcess } from 'child_process';
import http from 'http';
import { io as SocketIOClient } from 'socket.io-client';

const PORT = 3000;
const BASE_URL = `http://localhost:${PORT}`;
const NODE_PATH = '/Users/koillinjag/node-v20.11.0-darwin-arm64/bin/node';

interface TestResult {
  name: string;
  passed: boolean;
  detail: string;
}

const results: TestResult[] = [];
let mongoServer: MongoMemoryServer;
let serverProcess: ChildProcess;

function assert(condition: boolean, name: string, detail: string): void {
  if (!condition) {
    results.push({ name, passed: false, detail });
    console.log(`  ❌ FAIL: ${name} - ${detail}`);
  } else {
    results.push({ name, passed: true, detail });
    console.log(`  ✅ PASS: ${name}`);
  }
}

function httpRequest(method: string, path: string, body?: any): Promise<{ status: number; data: any }> {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : '';
    const options: http.RequestOptions = {
      hostname: 'localhost',
      port: PORT,
      path,
      method,
      headers: body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {},
      timeout: 10000,
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode || 0, data: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode || 0, data }); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
    if (body) req.write(payload);
    req.end();
  });
}

function httpGet(path: string): Promise<{ status: number; data: any }> {
  return httpRequest('GET', path);
}

function httpPost(path: string, body: any): Promise<{ status: number; data: any }> {
  return httpRequest('POST', path, body);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer(maxRetries = 30, interval = 1000): Promise<void> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await httpGet('/health');
      if (res.status === 200 && res.data.status === 'healthy') {
        console.log('  服务已就绪');
        return;
      }
    } catch { /* not ready */ }
    await sleep(interval);
  }
  throw new Error('服务启动超时');
}

async function startInfrastructure(): Promise<void> {
  console.log('\n🚀 启动测试基础设施...');
  mongoServer = await MongoMemoryServer.create();
  const mongoUri = mongoServer.getUri();
  console.log(`  内存 MongoDB 已启动: ${mongoUri}`);
  serverProcess = spawn('node', ['dist/server.js'], {
    cwd: process.cwd(),
    env: { ...process.env, MONGO_URI: mongoUri, PORT: String(PORT), DEVICE_OFFLINE_TIMEOUT: '60000' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  serverProcess.stdout?.on('data', (chunk: Buffer) => { process.stdout.write(chunk); });
  serverProcess.stderr?.on('data', (chunk: Buffer) => { process.stderr.write(chunk); });
  console.log('  等待服务就绪...');
  await waitForServer();
}

async function stopInfrastructure(): Promise<void> {
  console.log('\n🧹 清理测试基础设施...');
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill('SIGTERM');
    await sleep(1000);
    if (!serverProcess.killed) { serverProcess.kill('SIGKILL'); }
    console.log('  服务子进程已终止');
  }
  if (mongoServer) {
    await mongoServer.stop();
    console.log('  内存 MongoDB 已停止');
  }
}