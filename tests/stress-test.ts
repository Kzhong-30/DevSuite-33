import { MongoMemoryServer } from 'mongodb-memory-server';
import { spawn, ChildProcess } from 'child_process';
import http from 'http';
import { io as SocketIOClient, Socket as ClientSocket } from 'socket.io-client';

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

function httpRequest(method: string, path: string, body?: any): Promise<{ status: number; data: any; responseTime: number }> {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : '';
    const options: http.RequestOptions = {
      hostname: 'localhost',
      port: PORT,
      path,
      method,
      headers: body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {},
      timeout: 30000,
    };
    const startTime = Date.now();
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        const responseTime = Date.now() - startTime;
        try { resolve({ status: res.statusCode || 0, data: JSON.parse(data), responseTime }); }
        catch { resolve({ status: res.statusCode || 0, data, responseTime }); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
    if (body) req.write(payload);
    req.end();
  });
}

function httpGet(path: string): Promise<{ status: number; data: any; responseTime: number }> {
  return httpRequest('GET', path);
}

function httpPost(path: string, body: any): Promise<{ status: number; data: any; responseTime: number }> {
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

async function startInfrastructure(deviceOfflineTimeout: string = '30000'): Promise<void> {
  console.log('\n🚀 启动测试基础设施...');
  mongoServer = await MongoMemoryServer.create();
  const mongoUri = mongoServer.getUri();
  console.log(`  内存 MongoDB 已启动: ${mongoUri}`);
  serverProcess = spawn(NODE_PATH, ['dist/server.js'], {
    cwd: process.cwd(),
    env: { ...process.env, MONGO_URI: mongoUri, PORT: String(PORT), DEVICE_OFFLINE_TIMEOUT: deviceOfflineTimeout },
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

function toRad(deg: number): number {
  return deg * Math.PI / 180;
}

function toDeg(rad: number): number {
  return rad * 180 / Math.PI;
}

function pointAtDistance(centerLon: number, centerLat: number, distanceMeters: number, bearingDeg: number = 0): [number, number] {
  const R = 6371000;
  const d = distanceMeters / R;
  const bearing = toRad(bearingDeg);
  const lat1 = toRad(centerLat);
  const lon1 = toRad(centerLon);

  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(bearing));
  const lon2 = lon1 + Math.atan2(Math.sin(bearing) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));

  return [toDeg(lon2), toDeg(lat2)];
}

async function test1_largePaginationPerformance(): Promise<void> {
  console.log('\n📌 测试1: 大量轨迹分页性能测试');
  const deviceId = 'stress-device-001';

  const socket: ClientSocket = SocketIOClient(BASE_URL, { transports: ['websocket'] });
  await new Promise<void>((resolve, reject) => {
    socket.on('connect', resolve);
    socket.on('connect_error', reject);
  });
  console.log('  WebSocket 已连接');

  socket.emit('device:register', { deviceId });
  await new Promise<void>((resolve) => {
    socket.once('device:registered', () => resolve());
  });
  console.log(`  设备 ${deviceId} 已注册`);

  const baseTs = Date.now();
  console.log('  开始上报 1500 个位置点...');
  for (let i = 0; i < 1500; i++) {
    socket.emit('device:location', {
      deviceId,
      location: {
        type: 'Point',
        coordinates: [116.4074 + i * 0.00001, 39.9042 + i * 0.00001],
      },
      timestamp: baseTs + i * 1000,
    });
    if (i % 200 === 0) {
      await sleep(20);
    }
  }

  await sleep(2000);
  console.log('  位置上报完成，等待数据库写入...');

  const page1 = await httpGet(`/devices/${deviceId}/history?page=1&limit=100`);
  assert(page1.status === 200, '第1页请求返回200', `实际: ${page1.status}`);
  assert(page1.responseTime < 500, `第1页响应时间 < 500ms`, `实际: ${page1.responseTime}ms`);
  assert(Array.isArray(page1.data.data) && page1.data.data.length === 100, '第1页返回100条记录', `实际: ${page1.data.data?.length}`);
  assert(page1.data.pagination?.total === 1500, `pagination.total === 1500`, `实际: ${page1.data.pagination?.total}`);
  assert(page1.data.pagination?.page === 1, `pagination.page === 1`, `实际: ${page1.data.pagination?.page}`);
  assert(page1.data.pagination?.limit === 100, `pagination.limit === 100`, `实际: ${page1.data.pagination?.limit}`);
  assert(page1.data.pagination?.totalPages === 15, `pagination.totalPages === 15`, `实际: ${page1.data.pagination?.totalPages}`);

  const page15 = await httpGet(`/devices/${deviceId}/history?page=15&limit=100`);
  assert(page15.status === 200, '第15页请求返回200', `实际: ${page15.status}`);
  assert(page15.responseTime < 500, `第15页响应时间 < 500ms`, `实际: ${page15.responseTime}ms`);
  assert(Array.isArray(page15.data.data) && page15.data.data.length === 100, '第15页返回100条记录', `实际: ${page15.data.data?.length}`);
  assert(page15.data.pagination?.page === 15, `第15页 pagination.page === 15`, `实际: ${page15.data.pagination?.page}`);

  const route = await httpGet(`/devices/${deviceId}/route`);
  assert(route.status === 200, '路线查询返回200', `实际: ${route.status}`);
  assert(route.data.type === 'LineString', '返回 GeoJSON LineString', `实际: ${route.data.type}`);
  assert(Array.isArray(route.data.coordinates) && route.data.coordinates.length === 1500, 'LineString 包含 1500 个坐标点', `实际: ${route.data.coordinates?.length}`);

  socket.disconnect();
  console.log('  WebSocket 已断开');
}

async function test2_geofenceOverlapAlertOrder(): Promise<void> {
  console.log('\n📌 测试2: 多围栏重叠告警触发顺序');
  const deviceId = 'stress-device-002';
  const centerLon = 116.4074;
  const centerLat = 39.9042;

  const gfInner = await httpPost('/geofences', {
    name: 'gf-inner',
    type: 'circle',
    center: { type: 'Point', coordinates: [centerLon, centerLat] },
    radius: 200,
  });
  assert(gfInner.status === 201, '创建内部围栏 gf-inner', `实际: ${gfInner.status}`);

  const gfMiddle = await httpPost('/geofences', {
    name: 'gf-middle',
    type: 'circle',
    center: { type: 'Point', coordinates: [centerLon, centerLat] },
    radius: 500,
  });
  assert(gfMiddle.status === 201, '创建中间围栏 gf-middle', `实际: ${gfMiddle.status}`);

  const gfOuter = await httpPost('/geofences', {
    name: 'gf-outer',
    type: 'circle',
    center: { type: 'Point', coordinates: [centerLon, centerLat] },
    radius: 1000,
  });
  assert(gfOuter.status === 201, '创建外部围栏 gf-outer', `实际: ${gfOuter.status}`);

  const socket: ClientSocket = SocketIOClient(BASE_URL, { transports: ['websocket'] });
  await new Promise<void>((resolve, reject) => {
    socket.on('connect', resolve);
    socket.on('connect_error', reject);
  });
  console.log('  WebSocket 已连接');

  const alerts: { geofenceName: string; event: string }[] = [];
  socket.on('geofence:alert', (data: any) => {
    console.log(`  [ALERT] ${data.event} ${data.geofenceName}`);
    alerts.push({ geofenceName: data.geofenceName, event: data.event });
  });

  socket.emit('device:register', { deviceId });
  await new Promise<void>((resolve) => {
    socket.once('device:registered', () => resolve());
  });
  console.log(`  设备 ${deviceId} 已注册`);

  const positions: [number, number][] = [
    pointAtDistance(centerLon, centerLat, 2000, 0),
    pointAtDistance(centerLon, centerLat, 800, 0),
    pointAtDistance(centerLon, centerLat, 300, 0),
    pointAtDistance(centerLon, centerLat, 100, 0),
    pointAtDistance(centerLon, centerLat, 300, 0),
    pointAtDistance(centerLon, centerLat, 800, 0),
    pointAtDistance(centerLon, centerLat, 2000, 0),
  ];

  const posNames = ['2000m外', '800m(outer内)', '300m(middle内)', '100m(inner内)', '300m(出inner)', '800m(出middle)', '2000m(出outer)'];
  for (let i = 0; i < positions.length; i++) {
    const [lon, lat] = positions[i];
    console.log(`  移动到位置${i + 1}: ${posNames[i]} (${lon.toFixed(6)}, ${lat.toFixed(6)})`);
    socket.emit('device:location', {
      deviceId,
      location: { type: 'Point', coordinates: [lon, lat] },
      timestamp: Date.now() + i * 1000,
    });
    await sleep(300);
  }

  await sleep(500);

  const enterEvents = alerts.filter(a => a.event === 'enter');
  const exitEvents = alerts.filter(a => a.event === 'exit');

  console.log(`  总告警数: ${alerts.length}, enter: ${enterEvents.length}, exit: ${exitEvents.length}`);
  console.log(`  告警详情:`, alerts);

  assert(alerts.length === 6, `总告警数 === 6`, `实际: ${alerts.length}`);
  assert(enterEvents.length === 3, `进入告警数 === 3`, `实际: ${enterEvents.length}`);
  assert(exitEvents.length === 3, `离开告警数 === 3`, `实际: ${exitEvents.length}`);

  const enterOrder = enterEvents.map(e => e.geofenceName);
  const exitOrder = exitEvents.map(e => e.geofenceName);
  console.log(`  进入顺序: ${enterOrder.join(' → ')}`);
  console.log(`  离开顺序: ${exitOrder.join(' → ')}`);

  const enterValidOuterFirst = enterOrder[0] === 'gf-outer' && enterOrder[1] === 'gf-middle' && enterOrder[2] === 'gf-inner';
  const enterValidInnerFirst = enterOrder[0] === 'gf-inner' && enterOrder[1] === 'gf-middle' && enterOrder[2] === 'gf-outer';
  assert(enterValidOuterFirst || enterValidInnerFirst, `进入顺序正确 (outer→middle→inner 或 inner→middle→outer)`, `实际: ${enterOrder.join(' → ')}`);

  const exitValidInnerFirst = exitOrder[0] === 'gf-inner' && exitOrder[1] === 'gf-middle' && exitOrder[2] === 'gf-outer';
  const exitValidOuterFirst = exitOrder[0] === 'gf-outer' && exitOrder[1] === 'gf-middle' && exitOrder[2] === 'gf-inner';
  assert(exitValidInnerFirst || exitValidOuterFirst, `离开顺序正确 (inner→middle→outer 或 outer→middle→inner)`, `实际: ${exitOrder.join(' → ')}`);

  socket.disconnect();
  console.log('  WebSocket 已断开');
}

async function test3_deviceReconnectStateRecovery(): Promise<void> {
  console.log('\n📌 测试3: 设备断连重连状态恢复');
  const deviceId = 'stress-device-003';

  const socket1: ClientSocket = SocketIOClient(BASE_URL, { transports: ['websocket'] });
  const statusEvents: { status: string; event: string }[] = [];

  await new Promise<void>((resolve, reject) => {
    socket1.on('connect', resolve);
    socket1.on('connect_error', reject);
  });
  console.log('  WebSocket 连接1已建立');

  socket1.on('device:registered', (data: any) => {
    console.log(`  [EVENT] device:registered status=${data.status}`);
    statusEvents.push({ event: 'device:registered', status: data.status });
  });
  socket1.on('device:status', (data: any) => {
    console.log(`  [EVENT] device:status status=${data.status}`);
    statusEvents.push({ event: 'device:status', status: data.status });
  });
  socket1.on('device:offline', (data: any) => {
    console.log(`  [EVENT] device:offline deviceId=${data.deviceId}`);
    statusEvents.push({ event: 'device:offline', status: 'offline' });
  });

  socket1.emit('device:register', { deviceId });
  await sleep(500);

  const registeredEvent = statusEvents.find(e => e.event === 'device:registered');
  assert(!!registeredEvent, '收到 device:registered 事件', '未收到事件');
  assert(registeredEvent?.status === 'online', '注册后 status=online', `实际: ${registeredEvent?.status}`);

  const httpCheck1 = await httpGet(`/devices/${deviceId}`);
  assert(httpCheck1.status === 200, 'HTTP 查询设备返回200', `实际: ${httpCheck1.status}`);
  assert(httpCheck1.data.status === 'online', 'HTTP 查询 status=online', `实际: ${httpCheck1.data.status}`);

  console.log('  断开 WebSocket 连接...');
  socket1.disconnect();
  await sleep(100);

  console.log('  等待设备离线检测 (DEVICE_OFFLINE_TIMEOUT=2000ms)...');
  await sleep(3500);

  const offlineEvent = statusEvents.find(e => e.event === 'device:offline');
  assert(!!offlineEvent, '收到 device:offline 事件', '未收到 device:offline 事件');

  const httpCheck2 = await httpGet(`/devices/${deviceId}`);
  assert(httpCheck2.status === 200, '离线后 HTTP 查询返回200', `实际: ${httpCheck2.status}`);
  assert(httpCheck2.data.status === 'offline', '离线后 HTTP 查询 status=offline', `实际: ${httpCheck2.data.status}`);

  console.log('  重新建立 WebSocket 连接并注册...');
  const socket2: ClientSocket = SocketIOClient(BASE_URL, { transports: ['websocket'] });
  const statusEvents2: { status: string; event: string }[] = [];

  await new Promise<void>((resolve, reject) => {
    socket2.on('connect', resolve);
    socket2.on('connect_error', reject);
  });

  socket2.on('device:registered', (data: any) => {
    console.log(`  [EVENT2] device:registered status=${data.status}`);
    statusEvents2.push({ event: 'device:registered', status: data.status });
  });
  socket2.on('device:status', (data: any) => {
    console.log(`  [EVENT2] device:status status=${data.status}`);
    statusEvents2.push({ event: 'device:status', status: data.status });
  });

  socket2.emit('device:register', { deviceId });
  await sleep(500);

  const registeredEvent2 = statusEvents2.find(e => e.event === 'device:registered');
  assert(!!registeredEvent2, '重连后收到 device:registered 事件', '未收到事件');
  assert(registeredEvent2?.status === 'online', '重连注册后 status=online', `实际: ${registeredEvent2?.status}`);

  const hasStatusOnline = statusEvents2.some(e => e.event === 'device:status' && e.status === 'online');
  assert(hasStatusOnline, '重连后广播 device:status online 事件', '未收到 device:status online');

  const httpCheck3 = await httpGet(`/devices/${deviceId}`);
  assert(httpCheck3.status === 200, '重连后 HTTP 查询返回200', `实际: ${httpCheck3.status}`);
  assert(httpCheck3.data.status === 'online', '重连后 HTTP 查询 status=online', `实际: ${httpCheck3.data.status}`);

  socket2.disconnect();
  console.log('  WebSocket 已断开');
}

async function test4_highConcurrencyLocationReporting(): Promise<void> {
  console.log('\n📌 测试4: 高并发位置上报压力');

  const deviceIds: string[] = [];
  for (let i = 1; i <= 10; i++) {
    deviceIds.push(`stress-concurrent-${String(i).padStart(3, '0')}`);
  }

  const sockets: ClientSocket[] = [];
  console.log('  建立 10 个 WebSocket 连接...');
  for (let i = 0; i < 10; i++) {
    const socket: ClientSocket = SocketIOClient(BASE_URL, { transports: ['websocket'] });
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => {
      socket.on('connect', resolve);
      socket.on('connect_error', reject);
    });

    socket.emit('device:register', { deviceId: deviceIds[i] });
    await new Promise<void>((resolve) => {
      socket.once('device:registered', () => resolve());
    });
  }
  console.log('  所有 10 个设备已注册');

  console.log('  开始并发上报 100 个位置点/设备...');
  const baseTs = Date.now();
  const sendPromises: Promise<void>[] = [];

  for (let i = 0; i < 10; i++) {
    const socket = sockets[i];
    const deviceId = deviceIds[i];

    const sendOneDevice = async (): Promise<void> => {
      for (let j = 0; j < 100; j++) {
        socket.emit('device:location', {
          deviceId,
          location: {
            type: 'Point',
            coordinates: [116.4074 + j * 0.00001, 39.9042 + j * 0.00001],
          },
          timestamp: baseTs + i * 100000 + j * 1000,
        });
        await sleep(5);
      }
    };
    sendPromises.push(sendOneDevice());
  }

  await Promise.all(sendPromises);
  console.log('  所有位置上报已发送，等待数据库写入...');
  await sleep(3000);

  const allDevices = await httpGet('/devices');
  assert(allDevices.status === 200, '获取所有设备返回200', `实际: ${allDevices.status}`);
  assert(Array.isArray(allDevices.data), '返回设备列表为数组', `实际类型: ${typeof allDevices.data}`);

  for (let i = 0; i < 10; i++) {
    const found = allDevices.data.find((d: any) => d.deviceId === deviceIds[i]);
    assert(!!found, `设备 ${deviceIds[i]} 在列表中`, `未找到设备`);
    assert(found?.status === 'online', `设备 ${deviceIds[i]} status=online`, `实际: ${found?.status}`);
  }

  const checkDevices = [deviceIds[0], deviceIds[4], deviceIds[9]];
  for (const devId of checkDevices) {
    const history = await httpGet(`/devices/${devId}/history?page=1&limit=200`);
    assert(history.status === 200, `查询 ${devId} 历史返回200`, `实际: ${history.status}`);
    assert(history.data.pagination?.total === 100, `${devId} 历史记录总数 === 100`, `实际: ${history.data.pagination?.total}`);
    assert(Array.isArray(history.data.data) && history.data.data.length === 100, `${devId} 返回100条记录`, `实际: ${history.data.data?.length}`);
  }

  for (const s of sockets) {
    s.disconnect();
  }
  console.log('  所有 WebSocket 已断开');
}

async function runAllTests(): Promise<void> {
  console.log('='.repeat(60));
  console.log('物流追踪服务 - 边界/压力测试');
  console.log('='.repeat(60));

  try {
    await startInfrastructure('2000');

    const tests: { name: string; fn: () => Promise<void> }[] = [
      { name: '大量轨迹分页性能测试', fn: test1_largePaginationPerformance },
      { name: '多围栏重叠告警触发顺序', fn: test2_geofenceOverlapAlertOrder },
      { name: '设备断连重连状态恢复', fn: test3_deviceReconnectStateRecovery },
      { name: '高并发位置上报压力', fn: test4_highConcurrencyLocationReporting },
    ];

    for (const test of tests) {
      try {
        await test.fn();
      } catch (err: any) {
        console.log(`  ❌ TEST EXCEPTION: ${test.name} - ${err.message}`);
        results.push({ name: test.name, passed: false, detail: `Exception: ${err.message}` });
      }
    }
  } catch (err: any) {
    console.error('基础设施启动失败:', err);
  } finally {
    await stopInfrastructure();
  }

  console.log('\n' + '='.repeat(60));
  console.log('测试结果汇总');
  console.log('='.repeat(60));
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  for (const r of results) {
    const icon = r.passed ? '✅' : '❌';
    console.log(`${icon} ${r.name}${r.passed ? '' : ' - ' + r.detail}`);
  }
  console.log('='.repeat(60));
  console.log(`总计: ${results.length} 项, 通过: ${passed}, 失败: ${failed}`);
  console.log(`整体结果: ${failed === 0 ? '✅ ALL PASSED' : '❌ SOME FAILED'}`);
  console.log('='.repeat(60));
}

runAllTests().catch(console.error);
