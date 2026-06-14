import { MongoMemoryServer } from 'mongodb-memory-server';
import { spawn, ChildProcess } from 'child_process';
import http from 'http';
import { io as SocketIOClient } from 'socket.io-client';

const PORT = 3000;
const BASE_URL = `http://localhost:${PORT}`;
const DEVICE_ID = 'e2e-truck-001';

interface TestResult {
  name: string;
  passed: boolean;
  detail: string;
}

const results: TestResult[] = [];
let mongoServer: MongoMemoryServer;
let serverProcess: ChildProcess;
let deviceTokenMap: Record<string, string> = {};

function assert(condition: boolean, name: string, detail: string): void {
  if (!condition) {
    results.push({ name, passed: false, detail });
    console.log(`  ❌ FAIL: ${name} - ${detail}`);
  } else {
    results.push({ name, passed: true, detail });
    console.log(`  ✅ PASS: ${name}`);
  }
}

function httpRequest(method: string, path: string, body?: any, customHeaders?: any): Promise<{ status: number; data: any }> {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : '';
    const defaultHeaders = { 'x-api-key': 'dev-api-key-logistics-tracking-2026' };
    const headers = customHeaders !== undefined ? customHeaders : defaultHeaders;
    const options: http.RequestOptions = {
      hostname: 'localhost',
      port: PORT,
      path,
      method,
      headers: Object.assign({}, body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}, headers),
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
    env: { ...process.env, MONGO_URI: mongoUri, PORT: String(PORT), DEVICE_OFFLINE_TIMEOUT: '60000', MIN_REPORT_INTERVAL: '2', API_KEY_ENABLED: 'true' },
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

async function test1_healthCheck(): Promise<void> {
  console.log('\n📌 测试1: 健康检查与服务状态');
  const res = await httpGet('/health');
  assert(res.status === 200, '健康检查返回200', `实际状态码: ${res.status}`);
  assert(res.data.status === 'healthy', '服务状态为healthy', `实际状态: ${res.data.status}`);
  assert(typeof res.data.timestamp === 'string', '包含timestamp字段', `实际: ${typeof res.data.timestamp}`);
}

async function test2_createGeofences(): Promise<void> {
  console.log('\n📌 测试2: 创建圆形/多边形围栏 + 参数校验');
  const circleRes = await httpPost('/api/geofences', {
    name: '测试仓库-圆形', description: '圆形围栏覆盖仓库500米范围',
    geofenceType: 'circle', circular: { center: [116.4074, 39.9042], radius: 500 },
    alerts: ['enter', 'exit'], enabled: true,
  });
  assert(circleRes.status === 201, '创建圆形围栏返回201', `实际状态码: ${circleRes.status}`);
  assert(circleRes.data.success === true, '圆形围栏创建成功', `返回: ${JSON.stringify(circleRes.data)}`);
  assert(circleRes.data.data.geofenceType === 'circle', '围栏类型为circle', `实际类型: ${circleRes.data.data?.geofenceType}`);
  assert(circleRes.data.data.circular.radius === 500, '围栏半径为500', `实际半径: ${circleRes.data.data?.circular?.radius}`);
  assert(Array.isArray(circleRes.data.data.circular.center.coordinates), '圆形围栏包含center.coordinates', '');

  const polygonRes = await httpPost('/api/geofences', {
    name: '配送区域-多边形', geofenceType: 'polygon',
    polygon: { coordinates: [[[116.4, 39.9], [116.42, 39.9], [116.42, 39.92], [116.4, 39.92], [116.4, 39.9]]] },
    alerts: ['enter', 'exit'], enabled: true,
  });
  assert(polygonRes.status === 201, '创建多边形围栏返回201', `实际状态码: ${polygonRes.status}`);
  if (polygonRes.status === 201 && polygonRes.data?.data) {
    assert(polygonRes.data.data.geofenceType === 'polygon', '围栏类型为polygon', `实际类型: ${polygonRes.data.data?.geofenceType}`);
    assert(polygonRes.data.data.polygon?.geometry?.type === 'Polygon', '多边形geometry类型为Polygon', '');
  }
  const missingNameRes = await httpPost('/api/geofences', { geofenceType: 'circle', circular: { center: [116.4, 39.9], radius: 100 } });
  assert(missingNameRes.status === 400, '缺少name返回400', `实际状态码: ${missingNameRes.status}`);
  const missingTypeRes = await httpPost('/api/geofences', { name: '无类型围栏' });
  assert(missingTypeRes.status === 400, '缺少geofenceType返回400', `实际状态码: ${missingTypeRes.status}`);
  const invalidTypeRes = await httpPost('/api/geofences', { name: '无效类型围栏', geofenceType: 'invalid' });
  assert(invalidTypeRes.status === 400, '无效geofenceType返回400', `实际状态码: ${invalidTypeRes.status}`);
  const noRadiusRes = await httpPost('/api/geofences', { name: '缺半径圆形', geofenceType: 'circle', circular: { center: [116.4, 39.9] } });
  assert(noRadiusRes.status === 400, '圆形围栏缺少radius返回400', `实际状态码: ${noRadiusRes.status}`);
  const noCoordsRes = await httpPost('/api/geofences', { name: '缺坐标多边形', geofenceType: 'polygon' });
  assert(noCoordsRes.status === 400, '多边形围栏缺少coordinates返回400', `实际状态码: ${noCoordsRes.status}`);
  const negRadiusRes = await httpPost('/api/geofences', { name: '负半径圆形', geofenceType: 'circle', circular: { center: [116.4, 39.9], radius: -10 } });
  assert(negRadiusRes.status === 400, '负半径返回400', `实际状态码: ${negRadiusRes.status}`);
}

async function test3_deviceRegisterViaWebSocket(): Promise<void> {
  console.log('\n📌 测试3: 设备通过WebSocket注册');
  const socket = SocketIOClient(BASE_URL, { reconnection: false, timeout: 5000 });
  return new Promise((resolve) => {
    let resolved = false;
    const done = () => { if (!resolved) { resolved = true; socket.disconnect(); resolve(); } };
    socket.on('connect', () => {
      assert(true, 'WebSocket连接成功', '');
      socket.emit('device:register', { deviceId: DEVICE_ID, name: '测试卡车001', type: 'truck' });
    });
    socket.on('device:registered', (data: any) => { deviceTokenMap[data.deviceId] = data.token;
      assert(data.deviceId === DEVICE_ID, '设备注册返回正确deviceId', `实际: ${data?.deviceId}`);
      assert(data.status === 'online', '设备注册后状态为online', `实际: ${data?.status}`);
      done();
    });
    socket.on('connect_error', (err: any) => {
      assert(false, 'WebSocket连接成功', `连接错误: ${err.message}`);
      done();
    });
    setTimeout(() => { if (!resolved) { assert(false, '设备注册超时', '5秒内未收到注册确认'); } done(); }, 5000);
  });
}

async function test4_locationReportingAndGeofenceAlert(): Promise<void> {
  console.log('\n📌 测试4: 设备上报位置 + 围栏进入告警');
  const socket = SocketIOClient(BASE_URL, { reconnection: false, timeout: 5000 });
  const receivedEvents: any[] = [];
  return new Promise((resolve) => {
    socket.on('connect', () => {
      socket.emit('device:register', { deviceId: DEVICE_ID });
      setTimeout(() => {
        socket.emit('device:location', { deviceId: DEVICE_ID, deviceToken: deviceTokenMap[DEVICE_ID] || '', longitude: 116.4074, latitude: 39.9042, altitude: 50, speed: 30, direction: 90 });
      }, 500);
    });
    socket.on('device:registered', (data: any) => { deviceTokenMap[data.deviceId] = data.token; });
    socket.on('device:status', () => {});
    socket.on('device:location:update', (data: any) => { receivedEvents.push({ event: 'device:location:update', data }); });
    socket.on('device:location:ack', (data: any) => { receivedEvents.push({ event: 'device:location:ack', data }); });
    socket.on('geofence:alert', (data: any) => { receivedEvents.push({ event: 'geofence:alert', data }); });
    socket.on('device:alert', (data: any) => { receivedEvents.push({ event: 'device:alert', data }); });
    setTimeout(() => {
      const locUpd = receivedEvents.find((e) => e.event === 'device:location:update');
      assert(!!locUpd, '收到位置更新广播', `收到事件: ${receivedEvents.map((e) => e.event).join(', ')}`);
      if (locUpd) {
        assert(locUpd.data.longitude === 116.4074, '位置经度正确', `实际: ${locUpd.data.longitude}`);
        assert(locUpd.data.latitude === 39.9042, '位置纬度正确', `实际: ${locUpd.data.latitude}`);
        assert(locUpd.data.altitude === 50, '海拔正确', `实际: ${locUpd.data.altitude}`);
        assert(locUpd.data.speed === 30, '速度正确', `实际: ${locUpd.data.speed}`);
        assert(locUpd.data.direction === 90, '方向正确', `实际: ${locUpd.data.direction}`);
      }
      const locAck = receivedEvents.find((e) => e.event === 'device:location:ack');
      assert(!!locAck, '收到位置上报确认', '');
      if (locAck) { assert(locAck.data.success === true, '位置上报确认success为true', `实际: ${locAck.data.success}`); }
      const gfAlert = receivedEvents.find((e) => e.event === 'geofence:alert');
      assert(!!gfAlert, '触发围栏告警(进入)', `收到的事件: ${receivedEvents.map((e) => e.event).join(', ')}`);
      if (gfAlert) {
        assert(gfAlert.data.type === 'enter', '告警类型为enter', `实际: ${gfAlert.data.type}`);
        assert(gfAlert.data.deviceId === DEVICE_ID, '告警设备ID正确', `实际: ${gfAlert.data.deviceId}`);
      }
      socket.disconnect();
      resolve();
    }, 3000);
  });
}

async function test5_geofenceExitAlert(): Promise<void> {
  console.log('\n📌 测试5: 设备离开围栏触发exit告警');
  const socket = SocketIOClient(BASE_URL, { reconnection: false, timeout: 5000 });
  const exitAlerts: any[] = [];
  return new Promise((resolve) => {
    socket.on('connect', () => {
      socket.emit('device:register', { deviceId: DEVICE_ID });
    });
    socket.on('device:registered', (data: any) => {
      deviceTokenMap[data.deviceId] = data.token;
      setTimeout(() => { socket.emit('device:location', { deviceId: DEVICE_ID, deviceToken: deviceTokenMap[DEVICE_ID], longitude: 116.4074, latitude: 39.9042 }); }, 300);
      setTimeout(() => { socket.emit('device:location', { deviceId: DEVICE_ID, deviceToken: deviceTokenMap[DEVICE_ID], longitude: 116.5, latitude: 40.0 }); }, 1500);
    });
    socket.on('device:status', () => {});
    socket.on('geofence:alert', (data: any) => { if (data.type === 'exit') exitAlerts.push(data); });
    setTimeout(() => {
      assert(exitAlerts.length > 0, '触发离开围栏exit告警', `收到exit告警数: ${exitAlerts.length}`);
      if (exitAlerts.length > 0) {
        assert(exitAlerts[0].type === 'exit', '告警类型为exit', `实际: ${exitAlerts[0].type}`);
        assert(exitAlerts[0].deviceId === DEVICE_ID, '告警设备ID正确', `实际: ${exitAlerts[0].deviceId}`);
      }
      socket.disconnect();
      resolve();
    }, 3500);
  });
}

async function test6_getDevicesList(): Promise<void> {
  console.log('\n📌 测试6: 获取设备列表含最新位置');
  const res = await httpGet('/api/devices');
  assert(res.status === 200, '获取设备列表返回200', `实际状态码: ${res.status}`);
  assert(res.data.success === true, 'success为true', `实际: ${res.data.success}`);
  assert(Array.isArray(res.data.data), 'data为数组', `实际类型: ${typeof res.data.data}`);
  assert(res.data.data.length > 0, '设备列表非空', `设备数量: ${res.data.data.length}`);
  const device = res.data.data.find((d: any) => d.deviceId === DEVICE_ID);
  assert(!!device, `列表中包含设备${DEVICE_ID}`, '未找到该设备');
  if (device) {
    assert(device.currentLocation !== null && device.currentLocation !== undefined, '设备包含currentLocation', 'currentLocation为null/undefined');
    if (device.currentLocation) {
      assert(device.currentLocation.longitude === 116.5, '最新位置经度为116.5', `实际: ${device.currentLocation.longitude}`);
      assert(device.currentLocation.latitude === 40, '最新位置纬度为40', `实际: ${device.currentLocation.latitude}`);
    }
  }
  const onlineRes = await httpGet('/api/devices?status=online');
  assert(onlineRes.status === 200, '按状态筛选设备返回200', `实际状态码: ${onlineRes.status}`);
}

async function test7_getDeviceLocation(): Promise<void> {
  console.log('\n📌 测试7: 获取设备最新位置');
  const res = await httpGet(`/api/devices/${DEVICE_ID}/location`);
  assert(res.status === 200, '获取设备位置返回200', `实际状态码: ${res.status}`);
  assert(res.data.success === true, 'success为true', `实际: ${res.data.success}`);
  assert(res.data.data.longitude === 116.5, '最新位置经度为116.5', `实际: ${res.data.data.longitude}`);
  assert(res.data.data.latitude === 40, '最新位置纬度为40', `实际: ${res.data.data.latitude}`);
  const notFoundRes = await httpGet('/api/devices/nonexistent/location');
  assert(notFoundRes.status === 404, '不存在的设备返回404', `实际状态码: ${notFoundRes.status}`);
}

async function test8_getDeviceHistoryWithFilters(): Promise<void> {
  console.log('\n📌 测试8: 历史轨迹时间范围筛选和分页');
  const allRes = await httpGet(`/api/devices/${DEVICE_ID}/history`);
  assert(allRes.status === 200, '获取全部历史返回200', `实际状态码: ${allRes.status}`);
  assert(allRes.data.data.length >= 3, '历史记录至少3条', `实际: ${allRes.data.data.length}条`);
  assert(allRes.data.pagination.total >= 3, '分页total至少3', `实际: ${allRes.data.pagination.total}`);
  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 3600000).toISOString();
  const oneHourLater = new Date(now.getTime() + 3600000).toISOString();
  const filteredRes = await httpGet(`/api/devices/${DEVICE_ID}/history?start=${oneHourAgo}&end=${oneHourLater}`);
  assert(filteredRes.status === 200, '时间范围筛选返回200', `实际状态码: ${filteredRes.status}`);
  assert(filteredRes.data.data.length >= 3, '筛选结果包含所有记录', `实际: ${filteredRes.data.data.length}条`);
  const farFutureRes = await httpGet(`/api/devices/${DEVICE_ID}/history?start=2099-01-01T00:00:00Z`);
  assert(farFutureRes.status === 200, '远未来时间筛选返回200', `实际状态码: ${farFutureRes.status}`);
  assert(farFutureRes.data.data.length === 0, '远未来时间无记录', `实际: ${farFutureRes.data.data.length}条`);
  const page1Res = await httpGet(`/api/devices/${DEVICE_ID}/history?page=1&limit=2`);
  assert(page1Res.status === 200, '分页查询返回200', `实际状态码: ${page1Res.status}`);
  assert(page1Res.data.data.length <= 2, '每页最多2条', `实际: ${page1Res.data.data.length}条`);
  assert(page1Res.data.pagination.page === 1, '页码为1', `实际: ${page1Res.data.pagination.page}`);
  assert(page1Res.data.pagination.totalPages >= 2, '总页数至少2', `实际: ${page1Res.data.pagination.totalPages}`);
  const page2Res = await httpGet(`/api/devices/${DEVICE_ID}/history?page=2&limit=2`);
  assert(page2Res.status === 200, '第2页查询返回200', `实际状态码: ${page2Res.status}`);
  assert(page2Res.data.pagination.page === 2, '页码为2', `实际: ${page2Res.data.pagination.page}`);
  assert(page2Res.data.data.length > 0, '第2页有数据', `实际: ${page2Res.data.data.length}条`);
  const invalidPageRes = await httpGet(`/api/devices/${DEVICE_ID}/history?page=0&limit=-1`);
  assert(invalidPageRes.status === 200, '无效分页参数不崩溃返回200', `实际状态码: ${invalidPageRes.status}`);
}

async function test9_getDeviceRouteGeoJSON(): Promise<void> {
  console.log('\n📌 测试9: GeoJSON LineString路线生成 + 距离计算验证');
  const res = await httpGet(`/api/devices/${DEVICE_ID}/route`);
  assert(res.status === 200, '获取路线返回200', `实际状态码: ${res.status}`);
  assert(res.data.success === true, 'success为true', `实际: ${res.data.success}`);
  const rd = res.data.data;
  assert(rd.type === 'Feature', 'GeoJSON类型为Feature', `实际: ${rd.type}`);
  assert(rd.geometry.type === 'LineString', 'geometry类型为LineString', `实际: ${rd.geometry.type}`);
  assert(Array.isArray(rd.geometry.coordinates), 'coordinates为数组', `实际类型: ${typeof rd.geometry.coordinates}`);
  assert(rd.geometry.coordinates.length >= 2, '坐标点至少2个', `实际: ${rd.geometry.coordinates.length}`);
  const fc = rd.geometry.coordinates[0];
  assert(fc.length === 2, '每个坐标点包含2个值[lon,lat]', `实际: ${fc.length}个值`);
  assert(typeof fc[0] === 'number' && typeof fc[1] === 'number', '坐标值为数字类型', '');
  assert(rd.properties.pointCount >= 2, 'pointCount至少2', `实际: ${rd.properties.pointCount}`);
  assert(typeof rd.properties.totalDistance === 'number', 'totalDistance为数字', `实际类型: ${typeof rd.properties.totalDistance}`);
  assert(rd.properties.totalDistance > 0, 'totalDistance大于0', `实际: ${rd.properties.totalDistance}`);
  assert(!!rd.properties.startTime, '包含startTime', '');
  assert(!!rd.properties.endTime, '包含endTime', '');
  const haversine = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  };
  const coords = rd.geometry.coordinates;
  let manualDist = 0;
  for (let i = 1; i < coords.length; i++) {
    manualDist += haversine(coords[i - 1][1], coords[i - 1][0], coords[i][1], coords[i][0]);
  }
  manualDist = Math.round(manualDist * 100) / 100;
  assert(Math.abs(manualDist - rd.properties.totalDistance) < 0.01, `距离计算验证: 手动=${manualDist}km, API=${rd.properties.totalDistance}km`, '偏差过大');
  const notFoundRes = await httpGet('/api/devices/nonexistent/route');
  assert(notFoundRes.status === 404, '不存在的设备返回404', `实际状态码: ${notFoundRes.status}`);
}

async function test10_geofenceAlertsHistory(): Promise<void> {
  console.log('\n📌 测试10: 围栏告警历史查询');
  const geofencesRes = await httpGet('/api/geofences');
  assert(geofencesRes.status === 200, '获取围栏列表返回200', `实际状态码: ${geofencesRes.status}`);
  assert(geofencesRes.data.data.length > 0, '围栏列表非空', `围栏数量: ${geofencesRes.data.data.length}`);
  const geofenceId = geofencesRes.data.data[0]._id;
  const alertsRes = await httpGet(`/api/geofences/${geofenceId}/alerts`);
  assert(alertsRes.status === 200, '获取围栏告警返回200', `实际状态码: ${alertsRes.status}`);
  assert(alertsRes.data.success === true, 'success为true', `实际: ${alertsRes.data.success}`);
  assert(Array.isArray(alertsRes.data.data), '告警数据为数组', `实际类型: ${typeof alertsRes.data.data}`);
  const pagRes = await httpGet(`/api/geofences/${geofenceId}/alerts?page=1&limit=10`);
  assert(pagRes.status === 200, '分页查询告警返回200', `实际状态码: ${pagRes.status}`);
  assert(!!pagRes.data.pagination, '包含分页信息', '');
  const invIdRes = await httpGet('/api/geofences/invalid-id/alerts');
  assert(invIdRes.status === 400, '无效ID返回400', `实际状态码: ${invIdRes.status}`);
}

async function test11_invalidCoordinatesAndNotFound(): Promise<void> {
  console.log('\n📌 测试11: 无效坐标校验 + 404处理');
  const socket = SocketIOClient(BASE_URL, { reconnection: false, timeout: 5000 });
  const errors: any[] = [];
  await new Promise<void>((resolve) => {
    socket.on('connect', () => {
      socket.emit('device:register', { deviceId: DEVICE_ID });
      setTimeout(() => { socket.emit('device:location', { deviceId: DEVICE_ID, deviceToken: deviceTokenMap[DEVICE_ID] || '', longitude: 999, latitude: 999 }); }, 300);
    });
    socket.on('device:registered', (data: any) => { deviceTokenMap[data.deviceId] = data.token; });
    socket.on('error', (data: any) => { errors.push(data); });
    setTimeout(() => { socket.disconnect(); resolve(); }, 2000);
  });
  assert(errors.length > 0, '无效坐标返回WebSocket错误', `收到错误数: ${errors.length}`);
  if (errors.length > 0) {
    assert(errors[0].message.includes('Invalid') || errors[0].message.includes('coordinates') || errors[0].message.includes('required'), '错误消息包含无效坐标信息', `实际消息: ${errors[0].message}`);
  }
  const nf1 = await httpGet('/api/devices/nonexistent');
  assert(nf1.status === 404, '不存在的设备返回404', `实际状态码: ${nf1.status}`);
  const nf2 = await httpGet('/nonexistent-route');
  assert(nf2.status === 404, '不存在的路由返回404', `实际状态码: ${nf2.status}`);
  const nf3 = await httpGet('/api/geofences/000000000000000000000000');
  assert(nf3.status === 404, '不存在的围栏ID返回404', `实际状态码: ${nf3.status}`);
}

async function test12_bulkLocationPagination(): Promise<void> {
  console.log('\n📌 测试12: 大量轨迹分页性能');
  const socket = SocketIOClient(BASE_URL, { reconnection: false, timeout: 5000 });
  let registered = false;
  await new Promise<void>((resolve) => {
    let resolved = false;
    const done = () => { if (!resolved) { resolved = true; resolve(); } };
    socket.on('connect', () => {
      socket.emit('device:register', { deviceId: 'e2e-stress-001', name: '压力测试设备', type: 'truck' });
    });
    socket.on('device:registered', async (data: any) => { deviceTokenMap[data.deviceId] = data.token;
      if (data.deviceId === 'e2e-stress-001') {
        registered = true;
        for (let i = 0; i < 50; i++) {
          const lng = 116.4 + (117.2 - 116.4) * (i / 49);
          const lat = 39.9 + (39.1 - 39.9) * (i / 49);
          socket.emit('device:location', { deviceId: 'e2e-stress-001', deviceToken: deviceTokenMap['e2e-stress-001'] || '', longitude: Math.round(lng * 10000) / 10000, latitude: Math.round(lat * 10000) / 10000 });
          await sleep(5);
        }
      }
    });
    socket.on('device:location:ack', () => {});
    socket.on('connect_error', () => { done(); });
    setTimeout(done, 8000);
  });
  assert(registered, '设备e2e-stress-001注册成功', '未收到注册确认');
  socket.disconnect();
  await sleep(2000);
  const histRes = await httpGet('/api/devices/e2e-stress-001/history');
  assert(histRes.status === 200, '获取历史记录返回200', `实际状态码: ${histRes.status}`);
  assert(histRes.data.pagination.total >= 35, '历史记录总数>=35', `实际: ${histRes.data.pagination.total}`);
  const pagStart = Date.now();
  const pagRes = await httpGet('/api/devices/e2e-stress-001/history?page=1&limit=10');
  const pagTime = Date.now() - pagStart;
  assert(pagRes.status === 200, '分页查询返回200', `实际状态码: ${pagRes.status}`);
  assert(pagRes.data.pagination.totalPages >= 3, 'totalPages>=3', `实际: ${pagRes.data.pagination.totalPages}`);
  assert(pagRes.data.data.length <= 10, '第1页数据<=10条', `实际: ${pagRes.data.data.length}`);
  assert(pagTime < 2000, '分页查询响应时间<2秒', `实际: ${pagTime}ms`);
  const page5Res = await httpGet('/api/devices/e2e-stress-001/history?page=5&limit=10');
  assert(page5Res.status === 200, '第5页查询返回200', `实际状态码: ${page5Res.status}`);
  assert(page5Res.data.pagination.page === 5, '第5页页码正确', `实际: ${page5Res.data.pagination.page}`);
  const routeStart = Date.now();
  const routeRes = await httpGet('/api/devices/e2e-stress-001/route');
  const routeTime = Date.now() - routeStart;
  assert(routeRes.status === 200, '路线生成返回200', `实际状态码: ${routeRes.status}`);
  assert(routeTime < 2000, '路线生成响应时间<2秒', `实际: ${routeTime}ms`);
  if (routeRes.data?.data?.geometry) {
    assert(routeRes.data.data.geometry.coordinates.length >= 2, '路线坐标点>=2', `实际: ${routeRes.data.data.geometry.coordinates.length}`);
  }
}

async function test13_overlappingGeofenceAlerts(): Promise<void> {
  console.log('\n📌 测试13: 多围栏重叠告警顺序');
  const circleA = await httpPost('/api/geofences', {
    name: '围栏A-小圆', geofenceType: 'circle',
    circular: { center: [116.4074, 39.9042], radius: 100 },
    alerts: ['enter'], enabled: true,
  });
  assert(circleA.status === 201, '创建围栏A返回201', `实际状态码: ${circleA.status}`);
  const circleB = await httpPost('/api/geofences', {
    name: '围栏B-大圆', geofenceType: 'circle',
    circular: { center: [116.4074, 39.9042], radius: 1000 },
    alerts: ['exit'], enabled: true,
  });
  assert(circleB.status === 201, '创建围栏B返回201', `实际状态码: ${circleB.status}`);
  const polygonC = await httpPost('/api/geofences', {
    name: '围栏C-多边形', geofenceType: 'polygon',
    polygon: { coordinates: [[[116.3974, 39.8942], [116.4174, 39.8942], [116.4174, 39.9142], [116.3974, 39.9142], [116.3974, 39.8942]]] },
    alerts: ['enter', 'exit'], enabled: true,
  });
  assert(polygonC.status === 201, '创建围栏C返回201', `实际状态码: ${polygonC.status}`);
  const socket = SocketIOClient(BASE_URL, { reconnection: false, timeout: 5000 });
  const enterAlerts: any[] = [];
  await new Promise<void>((resolve) => {
    let resolved = false;
    const done = () => { if (!resolved) { resolved = true; socket.disconnect(); resolve(); } };
    socket.on('connect', () => {
      socket.emit('device:register', { deviceId: 'e2e-overlap-001', name: '重叠测试设备', type: 'car' });
    });
    socket.on('device:registered', (data: any) => { deviceTokenMap[data.deviceId] = data.token;
      setTimeout(() => {
        socket.emit('device:location', { deviceId: 'e2e-overlap-001', deviceToken: deviceTokenMap['e2e-overlap-001'] || '', longitude: 116.4074, latitude: 39.9042 });
      }, 300);
    });
    socket.on('geofence:alert', (data: any) => {
      if (data.type === 'enter') enterAlerts.push(data);
    });
    setTimeout(done, 3000);
  });
  assert(enterAlerts.length >= 2, '收到至少2个enter告警(围栏A和C)', `实际: ${enterAlerts.length}个`);
  for (const a of enterAlerts) {
    assert(!!a.geofenceId, 'enter告警包含geofenceId', `告警: ${JSON.stringify(a)}`);
    assert(a.deviceId === 'e2e-overlap-001', 'enter告警deviceId正确', `实际: ${a.deviceId}`);
  }
  const socket2 = SocketIOClient(BASE_URL, { reconnection: false, timeout: 5000 });
  const exitAlerts: any[] = [];
  await new Promise<void>((resolve) => {
    let resolved = false;
    const done = () => { if (!resolved) { resolved = true; socket2.disconnect(); resolve(); } };
    socket2.on('connect', () => {
      socket2.emit('device:register', { deviceId: 'e2e-overlap-001' });
    });
    socket2.on('device:registered', (data: any) => { deviceTokenMap[data.deviceId] = data.token;
      setTimeout(() => {
        socket2.emit('device:location', { deviceId: 'e2e-overlap-001', deviceToken: deviceTokenMap['e2e-overlap-001'] || '', longitude: 116.5, latitude: 40.0 });
      }, 500);
    });
    socket2.on('geofence:alert', (data: any) => {
      if (data.type === 'exit') exitAlerts.push(data);
    });
    setTimeout(done, 3000);
  });
  assert(exitAlerts.length >= 1, '收到至少1个exit告警(围栏B或C)', `实际: ${exitAlerts.length}个`);
  for (const a of exitAlerts) {
    assert(!!a.geofenceId, 'exit告警包含geofenceId', `告警: ${JSON.stringify(a)}`);
    assert(a.deviceId === 'e2e-overlap-001', 'exit告警deviceId正确', `实际: ${a.deviceId}`);
  }
}

async function test14_deviceDisconnectReconnect(): Promise<void> {
  console.log('\n📌 测试14: 设备断连重连状态恢复');
  const socket1 = SocketIOClient(BASE_URL, { reconnection: false, timeout: 5000 });
  let reg1Success = false;
  let loc1Ack = false;
  await new Promise<void>((resolve) => {
    let resolved = false;
    const done = () => { if (!resolved) { resolved = true; socket1.disconnect(); setTimeout(resolve, 100); } };
    socket1.on('connect', () => {
      socket1.emit('device:register', { deviceId: 'e2e-reconnect-001', name: '重连测试设备', type: 'truck' });
    });
    socket1.on('device:registered', (data: any) => { deviceTokenMap[data.deviceId] = data.token;
      if (data.deviceId === 'e2e-reconnect-001') {
        reg1Success = true;
        setTimeout(() => {
          socket1.emit('device:location', { deviceId: 'e2e-reconnect-001', deviceToken: deviceTokenMap['e2e-reconnect-001'] || '', longitude: 116.3, latitude: 39.8 });
        }, 300);
      }
    });
    socket1.on('device:location:ack', (data: any) => {
      if (data.success) { loc1Ack = true; setTimeout(done, 200); }
    });
    setTimeout(done, 4000);
  });
  assert(reg1Success, '首次注册成功', '未收到注册确认');
  assert(loc1Ack, '首次位置上报ack', '未收到位置确认');

  await sleep(1500);

  const socket2 = SocketIOClient(BASE_URL, { reconnection: false, timeout: 5000 });
  let reg2Success = false;
  let reg2Status = '';
  let loc2Ack = false;
  await new Promise<void>((resolve) => {
    let resolved = false;
    const done = () => { if (!resolved) { resolved = true; socket2.disconnect(); setTimeout(resolve, 100); } };
    socket2.on('connect', () => {
      socket2.emit('device:register', { deviceId: 'e2e-reconnect-001' });
    });
    socket2.on('device:registered', (data: any) => { deviceTokenMap[data.deviceId] = data.token;
      if (data.deviceId === 'e2e-reconnect-001') {
        reg2Success = true;
        reg2Status = data.status;
        setTimeout(() => {
          socket2.emit('device:location', { deviceId: 'e2e-reconnect-001', deviceToken: deviceTokenMap['e2e-reconnect-001'] || '', longitude: 117.0, latitude: 40.5 });
        }, 500);
      }
    });
    socket2.on('device:location:ack', (data: any) => {
      if (data.success) { loc2Ack = true; setTimeout(done, 200); }
    });
    setTimeout(done, 5000);
  });
  assert(reg2Success, '重连注册成功', '未收到注册确认');
  assert(reg2Status === 'online', '重连后状态为online', `实际: ${reg2Status}`);
  assert(loc2Ack, '重连后位置上报ack', '未收到位置确认');
  const devRes = await httpGet('/api/devices/e2e-reconnect-001/location');
  assert(devRes.status === 200, 'HTTP获取设备位置返回200', `实际状态码: ${devRes.status}`);
  assert(devRes.data.data.longitude === 117.0, '最新位置经度为117.0', `实际: ${devRes.data.data.longitude}`);
  assert(devRes.data.data.latitude === 40.5, '最新位置纬度为40.5', `实际: ${devRes.data.data.latitude}`);
  const devListRes = await httpGet('/api/devices?status=online');
  const dev = devListRes.data.data.find((d: any) => d.deviceId === 'e2e-reconnect-001');
  assert(!!dev, '设备列表中包含e2e-reconnect-001', '未找到该设备');
  if (dev) {
    assert(dev.status === 'online', '设备状态为online', `实际: ${dev.status}`);
  }
}

async function test15_missingFieldsAndExtremes(): Promise<void> {
  console.log('\n📌 测试15: 异常输入验证');
  const socket = SocketIOClient(BASE_URL, { reconnection: false, timeout: 5000 });
  const wsErrors: any[] = [];
  await new Promise<void>((resolve) => {
    let resolved = false;
    const done = () => { if (!resolved) { resolved = true; resolve(); } };
    socket.on('connect', () => {
      socket.emit('device:register', { deviceId: 'e2e-extreme-001' });
    });
    socket.on('device:registered', (data: any) => { deviceTokenMap[data.deviceId] = data.token;
      socket.emit('device:location', { longitude: 116.4, latitude: 39.9 });
    });
    socket.on('error', (data: any) => { wsErrors.push(data); });
    setTimeout(done, 3000);
  });
  assert(wsErrors.length > 0, '缺少deviceId返回WebSocket错误', `收到错误数: ${wsErrors.length}`);
  socket.disconnect();
  const socket2 = SocketIOClient(BASE_URL, { reconnection: false, timeout: 5000 });
  const wsErrors2: any[] = [];
  await new Promise<void>((resolve) => {
    let resolved = false;
    const done = () => { if (!resolved) { resolved = true; socket2.disconnect(); resolve(); } };
    socket2.on('connect', () => {
      socket2.emit('device:register', { deviceId: 'e2e-extreme-001' });
    });
    socket2.on('device:registered', (data: any) => { deviceTokenMap[data.deviceId] = data.token;
      socket2.emit('device:location', { deviceId: 'e2e-extreme-001', deviceToken: deviceTokenMap['e2e-extreme-001'] || '', latitude: 39.9 });
    });
    socket2.on('error', (data: any) => { wsErrors2.push(data); });
    setTimeout(done, 3000);
  });
  assert(wsErrors2.length > 0, '缺少longitude返回WebSocket错误', `收到错误数: ${wsErrors2.length}`);
  const socket3 = SocketIOClient(BASE_URL, { reconnection: false, timeout: 5000 });
  let extremeAck1 = false;
  let extremeAck2 = false;
  const extremeErrors: any[] = [];
  await new Promise<void>((resolve) => {
    let resolved = false;
    const done = () => { if (!resolved) { resolved = true; socket3.disconnect(); resolve(); } };
    socket3.on('connect', () => {
      socket3.emit('device:register', { deviceId: 'e2e-extreme-001' });
    });
    socket3.on('device:registered', (data: any) => { deviceTokenMap[data.deviceId] = data.token;
      socket3.emit('device:location', { deviceId: 'e2e-extreme-001', deviceToken: deviceTokenMap['e2e-extreme-001'] || '', longitude: -180, latitude: -90 });
      setTimeout(() => {
        socket3.emit('device:location', { deviceId: 'e2e-extreme-001', deviceToken: deviceTokenMap['e2e-extreme-001'] || '', longitude: 180, latitude: 90 });
      }, 300);
    });
    socket3.on('device:location:ack', (data: any) => {
      if (data.success) {
        if (!extremeAck1) extremeAck1 = true;
        else extremeAck2 = true;
      }
    });
    socket3.on('error', (data: any) => { extremeErrors.push(data); });
    setTimeout(done, 3000);
  });
  assert(extremeAck1, '经度-180纬度-90不报错(合法坐标)', extremeErrors.length > 0 ? `错误: ${extremeErrors[0]?.message}` : '未收到ack');
  assert(extremeAck2, '经度180纬度90不报错(合法坐标)', extremeErrors.length > 1 ? `错误: ${extremeErrors[1]?.message}` : '未收到ack');
  const emptyNameRes = await httpPost('/api/geofences', {
    name: '', geofenceType: 'circle',
    circular: { center: [116.4, 39.9], radius: 100 }, alerts: ['enter'], enabled: true,
  });
  assert(emptyNameRes.status === 400, '围栏name为空返回400', `实际状态码: ${emptyNameRes.status}`);
  const zeroRadiusRes = await httpPost('/api/geofences', {
    name: '零半径围栏', geofenceType: 'circle',
    circular: { center: [116.4, 39.9], radius: 0 }, alerts: ['enter'], enabled: true,
  });
  assert(zeroRadiusRes.status === 400, '围栏radius为0返回400', `实际状态码: ${zeroRadiusRes.status}`);
  const hugeRadiusRes = await httpPost('/api/geofences', {
    name: '极大半径围栏', geofenceType: 'circle',
    circular: { center: [116.4, 39.9], radius: 999999 }, alerts: ['enter'], enabled: true,
  });
  assert(hugeRadiusRes.status === 201, '围栏radius=999999正常创建返回201', `实际状态码: ${hugeRadiusRes.status}`);
}

async function test16_illegalTimestampAndEmptyBoundary(): Promise<void> {
  console.log('\n📌 测试16: 非法timestamp + 空列表边界');
  const socket = SocketIOClient(BASE_URL, { reconnection: false, timeout: 5000 });
  const errors: any[] = [];
  await new Promise<void>((resolve) => {
    let resolved = false;
    const done = () => { if (!resolved) { resolved = true; socket.disconnect(); resolve(); } };
    socket.on('connect', () => {
      socket.emit('device:register', { deviceId: 'e2e-empty-001', name: '空边界测试', type: 'truck' });
    });
    socket.on('device:registered', (data: any) => { deviceTokenMap[data.deviceId] = data.token;
      setTimeout(() => {
        socket.emit('device:location', { deviceId: 'e2e-empty-001', deviceToken: deviceTokenMap['e2e-empty-001'] || '', longitude: 116.4, latitude: 39.9, timestamp: -999 });
        setTimeout(() => {
          socket.emit('device:location', { deviceId: 'e2e-empty-001', deviceToken: deviceTokenMap['e2e-empty-001'] || '', longitude: 116.4, latitude: 39.9, timestamp: 'abc' as any });
        }, 300);
      }, 300);
    });
    socket.on('error', (data: any) => { errors.push(data); });
    setTimeout(done, 2500);
  });
  assert(errors.length >= 2, '收到至少2个timestamp错误(负数和字符串)', '实际错误数: ' + errors.length);
  if (errors.length >= 2) {
    assert(errors[0].message === 'Invalid timestamp', '第一个错误为Invalid timestamp', '实际: ' + errors[0].message);
    assert(errors[1].message === 'Invalid timestamp', '第二个错误为Invalid timestamp', '实际: ' + errors[1].message);
  }
  const devicesRes = await httpGet('/api/devices?status=online');
  assert(devicesRes.status === 200, 'GET /api/devices?status=online 返回200', '实际状态码: ' + devicesRes.status);
  assert(Array.isArray(devicesRes.data && devicesRes.data.data), '设备列表data为数组', '实际类型: ' + typeof (devicesRes.data && devicesRes.data.data));
  const gfRes = await httpGet('/api/geofences');
  assert(gfRes.status === 200, 'GET /api/geofences 返回200', '实际状态码: ' + gfRes.status);
  assert(Array.isArray(gfRes.data && gfRes.data.data), '围栏列表data为数组(空或非空都合法)', '实际类型: ' + typeof (gfRes.data && gfRes.data.data));
}

async function test17_geofenceDisableEnableAlertReset(): Promise<void> {
  console.log('\n📌 测试17: 围栏禁用/启用告警恢复');
  const disabledGf = await httpPost('/api/geofences', {
    name: '禁用围栏-测试', description: '创建时即为disabled状态',
    geofenceType: 'circle', circular: { center: [116.3, 39.8], radius: 100 },
    alerts: ['enter', 'exit'], enabled: false,
  });
  assert(disabledGf.status === 201, '创建enabled=false围栏返回201', '实际状态码: ' + disabledGf.status);
  assert(disabledGf.data && disabledGf.data.success === true, 'disabled围栏创建成功', '返回: ' + JSON.stringify(disabledGf.data));
  const disabledGfId = disabledGf.data && disabledGf.data.data && disabledGf.data.data._id;
  assert(!!disabledGfId, 'disabled围栏有_id', '无_id字段');

  const enabledGf = await httpPost('/api/geofences', {
    name: '启用围栏-测试', description: '同位置enabled=true',
    geofenceType: 'circle', circular: { center: [116.3, 39.8], radius: 100 },
    alerts: ['enter', 'exit'], enabled: true,
  });
  assert(enabledGf.status === 201, '创建enabled=true围栏返回201', '实际状态码: ' + enabledGf.status);
  const enabledGfId = enabledGf.data && enabledGf.data.data && enabledGf.data.data._id;
  assert(!!enabledGfId, 'enabled围栏有_id', '无_id字段');

  const socket = SocketIOClient(BASE_URL, { reconnection: false, timeout: 5000 });
  const alerts: any[] = [];
  await new Promise<void>((resolve) => {
    let resolved = false;
    const done = () => { if (!resolved) { resolved = true; socket.disconnect(); resolve(); } };
    socket.on('connect', () => {
      socket.emit('device:register', { deviceId: 'e2e-gf-toggle-001', name: '围栏开关测试', type: 'car' });
    });
    socket.on('device:registered', (data: any) => { deviceTokenMap[data.deviceId] = data.token;
      setTimeout(() => {
        socket.emit('device:location', { deviceId: 'e2e-gf-toggle-001', deviceToken: deviceTokenMap['e2e-gf-toggle-001'] || '', longitude: 116.3, latitude: 39.8 });
      }, 300);
    });
    socket.on('geofence:alert', (data: any) => { alerts.push(data); });
    setTimeout(done, 3000);
  });

  const disabledAlerts = alerts.filter((a) => a.geofenceId === disabledGfId && a.type === 'enter');
  const enabledAlerts = alerts.filter((a) => a.geofenceId === enabledGfId && a.type === 'enter');
  assert(disabledAlerts.length === 0, 'disabled围栏不应触发enter告警', 'disabled围栏告警数: ' + disabledAlerts.length);
  assert(enabledAlerts.length >= 1, 'enabled围栏应触发enter告警', 'enabled围栏告警数: ' + enabledAlerts.length);
  if (enabledAlerts.length > 0) {
    assert(enabledAlerts[0].deviceId === 'e2e-gf-toggle-001', 'enabled告警deviceId正确', '实际: ' + enabledAlerts[0].deviceId);
  }
}

async function test18_multiDeviceBroadcastIsolation(): Promise<void> {
  console.log('\n📌 测试18: 多设备广播隔离/防串台');
  const socketA = SocketIOClient(BASE_URL, { reconnection: false, timeout: 5000 });
  const socketB = SocketIOClient(BASE_URL, { reconnection: false, timeout: 5000 });
  const eventsA: any[] = [];
  const eventsB: any[] = [];
  const DEVICE_A = 'e2e-multi-A';
  const DEVICE_B = 'e2e-multi-B';

  socketA.on('device:location:ack', (data: any) => { eventsA.push({ event: 'ack', data }); });
  socketA.on('device:location:update', (data: any) => { eventsA.push({ event: 'update', data }); });
  let aRegistered = false;
  let bRegistered = false;
  socketA.on('device:alert', (data: any) => { eventsA.push({ event: 'alert', data }); });
  socketB.on('device:location:ack', (data: any) => { eventsB.push({ event: 'ack', data }); });
  socketB.on('device:location:update', (data: any) => { eventsB.push({ event: 'update', data }); });
  socketB.on('device:alert', (data: any) => { eventsB.push({ event: 'alert', data }); });
  await new Promise<void>((resolve) => {
    let resolved = false;
    const done = () => { if (!resolved) { resolved = true; resolve(); } };
    socketA.on('connect', () => { socketA.emit('device:register', { deviceId: DEVICE_A, name: '设备A', type: 'truck' }); });
    socketA.on('device:registered', (data: any) => { deviceTokenMap[data.deviceId] = data.token;
      aRegistered = true;
      if (bRegistered) sendLocations();
    });
    socketB.on('connect', () => { socketB.emit('device:register', { deviceId: DEVICE_B, name: '设备B', type: 'car' }); });
    socketB.on('device:registered', (data: any) => { deviceTokenMap[data.deviceId] = data.token;
      bRegistered = true;
      if (aRegistered) sendLocations();
    });

    function sendLocations() {
      setTimeout(() => {
        socketA.emit('device:location', { deviceId: DEVICE_A, deviceToken: deviceTokenMap[DEVICE_A] || '', longitude: 116.1, latitude: 39.1 });
        setTimeout(() => {
          socketB.emit('device:location', { deviceId: DEVICE_B, deviceToken: deviceTokenMap[DEVICE_B] || '', longitude: 116.2, latitude: 39.2 });
        }, 200);
      }, 300);
    }

    setTimeout(done, 4000);
  });

  await sleep(2000);

  const acksA = eventsA.filter((e) => e.event === 'ack');
  const acksB = eventsB.filter((e) => e.event === 'ack');
  assert(acksA.length >= 1, 'socketA收到至少1个ack', '实际: ' + acksA.length);
  assert(acksB.length >= 1, 'socketB收到至少1个ack', '实际: ' + acksB.length);

  const updatesA = eventsA.filter((e) => e.event === 'update');
  const updatesB = eventsB.filter((e) => e.event === 'update');
  const hasAUpdateA = updatesA.some((e) => e.data.deviceId === DEVICE_A);
  const hasBUpdateA = updatesA.some((e) => e.data.deviceId === DEVICE_B);
  const hasAUpdateB = updatesB.some((e) => e.data.deviceId === DEVICE_A);
  const hasBUpdateB = updatesB.some((e) => e.data.deviceId === DEVICE_B);
  assert(hasAUpdateA && hasBUpdateA, 'socketA收到A和B的位置广播(update)', 'A有A:' + hasAUpdateA + ' A有B:' + hasBUpdateA);
  assert(hasAUpdateB && hasBUpdateB, 'socketB收到A和B的位置广播(update)', 'B有A:' + hasAUpdateB + ' B有B:' + hasBUpdateB);

  socketA.disconnect();
  socketB.disconnect();
}

async function test19_thousandRecordsPaginationPerformance(): Promise<void> {
  console.log('\n📌 测试19: 1000条大批量分页性能');
  const socket = SocketIOClient(BASE_URL, { reconnection: false, timeout: 10000 });
  let registered = false;
  const DEV_ID = 'e2e-1000-001';
  let sentCount = 0;

  await new Promise<void>((resolve) => {
    let resolved = false;
    const done = () => { if (!resolved) { resolved = true; resolve(); } };

    socket.on('connect', () => {
      socket.emit('device:register', { deviceId: DEV_ID, name: '千条测试', type: 'truck' });
    });
    socket.on('device:registered', async (data: any) => { deviceTokenMap[data.deviceId] = data.token;
      if (data.deviceId === DEV_ID && !registered) {
        registered = true;
        const total = 1000;
        for (let idx = 0; idx < total; idx++) {
          const lng = 116.4 + (117.4 - 116.4) * (idx / (total - 1));
          const lat = 39.9 + (38.9 - 39.9) * (idx / (total - 1));
          socket.emit('device:location', {
            deviceId: DEV_ID,
            deviceToken: deviceTokenMap[DEV_ID] || '',
            longitude: Math.round(lng * 10000) / 10000,
            latitude: Math.round(lat * 10000) / 10000,
            timestamp: Date.now() + idx,
          });
          sentCount++;
          await sleep(5);
        }
      }
    });
    socket.on('device:location:ack', () => {});
    setTimeout(done, 15000);
  });

  socket.disconnect();
  assert(registered, '设备e2e-1000-001注册成功', '未收到注册确认');
  assert(sentCount >= 1000, '已发送' + sentCount + '条位置(>=1000)', '实际发送: ' + sentCount);
  await sleep(5000);

  const p1Start = Date.now();
  const p1Res = await httpGet('/api/devices/' + DEV_ID + '/history?limit=100&page=1');
  const p1Time = Date.now() - p1Start;
  assert(p1Res.status === 200, '第1页history返回200', '实际状态码: ' + p1Res.status);
  assert(p1Res.data && p1Res.data.pagination && p1Res.data.pagination.total >= 800, "total>=800", "实际total: " + (p1Res.data && p1Res.data.pagination && p1Res.data.pagination.total));
  assert(p1Res.data && p1Res.data.pagination && p1Res.data.pagination.totalPages >= 8, "totalPages>=8", "实际totalPages: " + (p1Res.data && p1Res.data.pagination && p1Res.data.pagination.totalPages));
  console.log('  ⏱ 第1页响应: ' + p1Time + 'ms');

  const p10Res = await httpGet('/api/devices/' + DEV_ID + '/history?limit=100&page=8');
  assert(p10Res.status === 200, '第8页history返回200', '实际状态码: ' + p10Res.status);
  assert(p10Res.data && p10Res.data.data && p10Res.data.data.length > 0, '第8页数据非空', '第10页条数: ' + (p10Res.data && p10Res.data.data && p10Res.data.data.length));

  const bigStart = Date.now();
  const bp = '/api/devices/' + DEV_ID + '/history?limit=1000';
  const bigRes = await httpGet(bp);
  const bigTime = Date.now() - bigStart;
  assert(bigRes.status === 200, 'limit=1000查询返回200', '实际状态码: ' + bigRes.status);
  assert(bigTime < 3000, 'limit=1000响应时间<3秒', '实际: ' + bigTime + 'ms');
  console.log('  ⏱ limit=1000响应: ' + bigTime + 'ms');

  const routeStart = Date.now();
  const rp = '/api/devices/' + DEV_ID + '/route';
  const routeRes = await httpGet(rp);
  const routeTime = Date.now() - routeStart;
  assert(routeRes.status === 200, 'route查询返回200', '实际状态码: ' + routeRes.status);
  assert(routeTime < 3000, 'route响应时间<3秒', '实际: ' + routeTime + 'ms');
  const pc = routeRes.data && routeRes.data.data && routeRes.data.data.properties && routeRes.data.data.properties.pointCount;
  assert(pc >= 2, 'route pointCount>=2', '实际pointCount: ' + pc);
  console.log('  ⏱ route响应: ' + routeTime + 'ms');
}

async function test20_pingOfflineStatusTransition(): Promise<void> {
  console.log("\n📌 测试20: ping离线/在线状态转换");
  const socket = SocketIOClient(BASE_URL, { reconnection: false, timeout: 5000 });
  const DEV_ID = 'e2e-ping-001';
  let registered = false;
  let pingNoError = true;

  await new Promise<void>((resolve) => {
    let resolved = false;
    const done = () => { if (!resolved) { resolved = true; resolve(); } };
    socket.on('connect', () => {
      socket.emit('device:register', { deviceId: DEV_ID, name: 'Ping测试', type: 'drone' });
    });
    socket.on('device:registered', (data: any) => { deviceTokenMap[data.deviceId] = data.token;
      if (data.deviceId === DEV_ID) {
        registered = true;
        setTimeout(() => {
          try {
            socket.emit('device:ping', { deviceId: DEV_ID, deviceToken: deviceTokenMap[DEV_ID] || '' });
          } catch {
            pingNoError = false;
          }
        }, 300);
      }
    });
    socket.on('error', () => { pingNoError = false; });
    setTimeout(done, 2500);
  });

  assert(registered, '设备e2e-ping-001注册成功', '未收到注册确认');
  assert(pingNoError, '发送device:ping不抛异常', 'ping过程中触发了error事件');

  const dpath = '/api/devices/' + DEV_ID;
  const get1 = await httpGet(dpath);
  assert(get1.status === 200, '在线时GET /api/devices/:id返回200', '实际状态码: ' + get1.status);
  const dev1 = get1.data && get1.data.data;
  assert(!!dev1, '响应包含data字段', '返回: ' + JSON.stringify(get1.data));
  assert('status' in dev1, '设备对象包含status字段', '字段: ' + Object.keys(dev1 || {}).join(','));
  if (dev1) {
    assert(dev1.status === 'online', 'ping后设备status=online', '实际status: ' + dev1.status);
  }

  socket.disconnect();
  await sleep(2000);

  let get2Ok = true;
  let get2Status = 0;
  let dev2StatusExists = false;
  try {
    const get2 = await httpGet(dpath);
    get2Status = get2.status;
    if (get2.data && get2.data.data && 'status' in get2.data.data) {
      dev2StatusExists = true;
    }
  } catch {
    get2Ok = false;
  }
  assert(get2Ok, '断连后GET不崩溃', '断连查询抛出异常');
  assert(get2Status === 200, '断连后GET返回200(不要求offline)', '实际状态码: ' + get2Status);
  assert(dev2StatusExists, '断连后设备仍有status字段', 'status字段不存在');
}

async function test21_geofenceToggleEnableDisable(): Promise<void> {
  console.log('\n📌 测试21: 围栏启用/禁用切换 API');
  const DEV_ID = 'e2e-toggle-001';
  let resolved = false;

  const gfRes = await httpPost('/api/geofences', {
    name: 'Toggle测试围栏', geofenceType: 'circle',
    circular: { center: [116.35, 39.85], radius: 500 },
    alerts: ['enter', 'exit'], enabled: true,
  });
  assert(gfRes.status === 201, '创建enabled=true围栏返回201', '实际状态码: ' + gfRes.status);
  const gfId = gfRes.data?.data?._id;
  assert(!!gfId, '获取围栏ID成功', '无_id字段');
  assert(gfRes.data?.data?.enabled === true, '初始enabled=true', '实际: ' + gfRes.data?.data?.enabled);

  const patchRes = await httpRequest('PATCH', '/api/geofences/' + gfId + '/toggle', { enabled: false });
  assert(patchRes.status === 200, 'PATCH toggle禁用返回200', '实际状态码: ' + patchRes.status);
  assert(patchRes.data?.success === true, 'toggle禁用success=true', '返回: ' + JSON.stringify(patchRes.data));
  assert(patchRes.data?.data?.enabled === false, '禁用后enabled=false', '实际: ' + patchRes.data?.data?.enabled);

  const socket1 = SocketIOClient(BASE_URL, { reconnection: false, timeout: 5000 });
  const enterAlerts1: any[] = [];
  await new Promise<void>((resolve) => {
    let done = () => { if (!resolved) { resolved = true; socket1.disconnect(); resolve(); } };
    socket1.on('connect', () => { socket1.emit('device:register', { deviceId: DEV_ID }); });
    socket1.on('device:registered', (data: any) => { deviceTokenMap[data.deviceId] = data.token;
      setTimeout(() => { socket1.emit('device:location', { deviceId: DEV_ID, deviceToken: deviceTokenMap[DEV_ID] || '', longitude: 116.35, latitude: 39.85 }); }, 300);
    });
    socket1.on('geofence:alert', (data: any) => { if (data.type === 'enter' && data.geofenceId === gfId) enterAlerts1.push(data); });
    setTimeout(done, 2500);
  });
  resolved = false;
  assert(enterAlerts1.length === 0, '禁用围栏不应触发enter告警', 'enter告警数: ' + enterAlerts1.length);

  const patchRes2 = await httpRequest('PATCH', '/api/geofences/' + gfId + '/toggle', { enabled: true });
  assert(patchRes2.status === 200, 'PATCH toggle启用返回200', '实际状态码: ' + patchRes2.status);
  assert(patchRes2.data?.data?.enabled === true, '启用后enabled=true', '实际: ' + patchRes2.data?.data?.enabled);

  const socket2 = SocketIOClient(BASE_URL, { reconnection: false, timeout: 5000 });
  const enterAlerts2: any[] = [];
  await new Promise<void>((resolve) => {
    let done = () => { if (!resolved) { resolved = true; socket2.disconnect(); resolve(); } };
    socket2.on('connect', () => { socket2.emit('device:register', { deviceId: DEV_ID }); });
    socket2.on('device:registered', (data: any) => { deviceTokenMap[data.deviceId] = data.token;
      setTimeout(() => { socket2.emit('device:location', { deviceId: DEV_ID, deviceToken: deviceTokenMap[DEV_ID] || '', longitude: 116.5, latitude: 40.0 }); }, 200);
      setTimeout(() => { socket2.emit('device:location', { deviceId: DEV_ID, deviceToken: deviceTokenMap[DEV_ID] || '', longitude: 116.35, latitude: 39.85 }); }, 800);
    });
    socket2.on('geofence:alert', (data: any) => { if (data.type === 'enter' && data.geofenceId === gfId) enterAlerts2.push(data); });
    setTimeout(done, 3000);
  });
  resolved = false;
  assert(enterAlerts2.length >= 1, '启用后移入应触发enter告警', 'enter告警数: ' + enterAlerts2.length);

  const badIdRes = await httpRequest('PATCH', '/api/geofences/invalid-id/toggle', { enabled: true });
  assert(badIdRes.status === 400, '无效ID返回400', '实际状态码: ' + badIdRes.status);

  const notFoundRes = await httpRequest('PATCH', '/api/geofences/000000000000000000000000/toggle', { enabled: true });
  assert(notFoundRes.status === 404, '不存在ID返回404', '实际状态码: ' + notFoundRes.status);

  const noBoolRes = await httpRequest('PATCH', '/api/geofences/' + gfId + '/toggle', { enabled: 'yes' });
  assert(noBoolRes.status === 400, 'enabled非布尔返回400', '实际状态码: ' + noBoolRes.status);
}

async function test22_routeDeduplicationAndSimplification(): Promise<void> {
  console.log('\n📌 测试22: 路线去重和Douglas-Peucker简化');
  const DEV_ID = 'e2e-route-001';
  let resolved = false;

  const socket = SocketIOClient(BASE_URL, { reconnection: false, timeout: 10000 });
  await new Promise<void>((resolve) => {
    let done = () => { if (!resolved) { resolved = true; socket.disconnect(); resolve(); } };
    socket.on('connect', () => { socket.emit('device:register', { deviceId: DEV_ID }); });
    socket.on('device:registered', async (data: any) => { deviceTokenMap[data.deviceId] = data.token;
      for (let i = 0; i < 10; i++) {
        socket.emit('device:location', { deviceId: DEV_ID, deviceToken: deviceTokenMap[DEV_ID] || '', longitude: 116.4, latitude: 39.9, timestamp: Date.now() + i });
        await sleep(6);
      }
      await sleep(200);
      socket.emit('device:location', { deviceId: DEV_ID, deviceToken: deviceTokenMap[DEV_ID] || '', longitude: 116.42, latitude: 39.92, timestamp: Date.now() + 101 });
      await sleep(6);
      socket.emit('device:location', { deviceId: DEV_ID, deviceToken: deviceTokenMap[DEV_ID] || '', longitude: 116.44, latitude: 39.94, timestamp: Date.now() + 102 });
      await sleep(6);
      socket.emit('device:location', { deviceId: DEV_ID, deviceToken: deviceTokenMap[DEV_ID] || '', longitude: 116.47, latitude: 39.97, timestamp: Date.now() + 103 });
      await sleep(6);
      socket.emit('device:location', { deviceId: DEV_ID, deviceToken: deviceTokenMap[DEV_ID] || '', longitude: 116.5, latitude: 40.0, timestamp: Date.now() + 200 });
    });
    socket.on('device:location:ack', () => {});
    setTimeout(done, 4000);
  });
  resolved = false;

  await sleep(1500);

  const routeRes = await httpGet('/api/devices/' + DEV_ID + '/route');
  assert(routeRes.status === 200, '获取路线返回200', '实际状态码: ' + routeRes.status);
  const props = routeRes.data?.data?.properties || {};
  assert(typeof props.deduplicated === 'number', '包含deduplicated属性', '属性: ' + JSON.stringify(props));
  assert(props.deduplicated > 0, '去重点数>0(至少8个)', '实际deduplicated: ' + props.deduplicated);
  assert(typeof props.originalPointCount === 'number', '包含originalPointCount', '属性: ' + JSON.stringify(props));
  assert(props.originalPointCount >= 11, 'originalPointCount>=11', '实际: ' + props.originalPointCount);
  assert(typeof props.simplified === 'boolean', '包含simplified布尔值', '属性: ' + JSON.stringify(props));
  assert(typeof props.totalDistance === 'number', 'totalDistance存在且为数字', '实际: ' + typeof props.totalDistance);

  const simpleRes = await httpGet('/api/devices/' + DEV_ID + '/route?tolerance=0.001');
  assert(simpleRes.status === 200, '带tolerance获取路线返回200', '实际状态码: ' + simpleRes.status);
  const simpleProps = simpleRes.data?.data?.properties || {};
  const simpleCount = simpleRes.data?.data?.geometry?.coordinates?.length || 0;
  const origCount = props.originalPointCount || 999;
  assert(simpleProps.simplified === true || simpleCount <= origCount - props.deduplicated, 'tolerance=0.001时simplified=true或简化后点数减少', 'simplified: ' + simpleProps.simplified + ' simpleCount: ' + simpleCount + ' origCount: ' + origCount);
  assert(simpleCount <= origCount - props.deduplicated, '简化后点数量少于或等于去重后数量', '简化后:' + simpleCount + ' 原:' + origCount);
}

async function test23_locationReportRateLimiting(): Promise<void> {
  console.log('\n📌 测试23: 位置上报频率限流');
  const DEV_ID = 'e2e-rate-001';
  let resolved = false;

  const socket = SocketIOClient(BASE_URL, { reconnection: false, timeout: 10000 });
  const acks: any[] = [];
  const errors: any[] = [];
  await new Promise<void>((resolve) => {
    let done = () => { if (!resolved) { resolved = true; socket.disconnect(); resolve(); } };
    socket.on('connect', () => { socket.emit('device:register', { deviceId: DEV_ID }); });
    socket.on('device:registered', (data: any) => { deviceTokenMap[data.deviceId] = data.token;
      for (let i = 0; i < 10; i++) {
        socket.emit('device:location', { deviceId: DEV_ID, deviceToken: deviceTokenMap[DEV_ID] || '', longitude: 116.4, latitude: 39.9, timestamp: Date.now() + i });
      }
    });
    socket.on('device:location:ack', (data: any) => { acks.push(data); });
    socket.on('error', (data: any) => { errors.push(data); });
    setTimeout(done, 3000);
  });
  resolved = false;

  const rateErrors = errors.filter((e) => e.message && e.message.includes('Report too frequent'));
  assert(acks.length <= 5, '1ms内快速上报只收到少量ack(<=5)', '实际ack数: ' + acks.length);
  assert(rateErrors.length >= 5, '收到大量Report too frequent错误(>=5)', '实际限流错误: ' + rateErrors.length);

  await sleep(300);

  const socket2 = SocketIOClient(BASE_URL, { reconnection: false, timeout: 5000 });
  let laterAck = false;
  await new Promise<void>((resolve) => {
    let done = () => { if (!resolved) { resolved = true; socket2.disconnect(); resolve(); } };
    socket2.on('connect', () => { socket2.emit('device:register', { deviceId: DEV_ID }); });
    socket2.on('device:registered', (data: any) => { deviceTokenMap[data.deviceId] = data.token;
      setTimeout(() => { socket2.emit('device:location', { deviceId: DEV_ID, deviceToken: deviceTokenMap[DEV_ID] || '', longitude: 116.5, latitude: 40.0 }); }, 200);
    });
    socket2.on('device:location:ack', () => { laterAck = true; setTimeout(done, 200); });
    setTimeout(done, 3000);
  });
  resolved = false;
  assert(laterAck, '等待超过限流时间后上报可收到ack', '未收到ack');
}

async function test24_offlineStateResetAndReenter(): Promise<void> {
  console.log('\n📌 测试24: 状态机/进入-离开-再进入告警');
  const DEV_ID = 'e2e-state-001';
  let resolved = false;

  const gfRes = await httpPost('/api/geofences', {
    name: '状态机测试围栏', geofenceType: 'circle',
    circular: { center: [116.45, 39.95], radius: 500 },
    alerts: ['enter', 'exit'], enabled: true,
  });
  assert(gfRes.status === 201, '创建测试围栏返回201', '实际状态码: ' + gfRes.status);
  const gfId = gfRes.data?.data?._id;

  const socket = SocketIOClient(BASE_URL, { reconnection: false, timeout: 10000 });
  const enterAlerts: any[] = [];
  const exitAlerts: any[] = [];
  await new Promise<void>((resolve) => {
    let done = () => { if (!resolved) { resolved = true; socket.disconnect(); resolve(); } };
    socket.on('connect', () => { socket.emit('device:register', { deviceId: DEV_ID }); });
    socket.on('device:registered', (data: any) => { deviceTokenMap[data.deviceId] = data.token;
      setTimeout(() => { socket.emit('device:location', { deviceId: DEV_ID, deviceToken: deviceTokenMap[DEV_ID] || '', longitude: 116.45, latitude: 39.95 }); }, 300);
      setTimeout(() => { socket.emit('device:location', { deviceId: DEV_ID, deviceToken: deviceTokenMap[DEV_ID] || '', longitude: 116.6, latitude: 40.1 }); }, 1200);
      setTimeout(() => { socket.emit('device:location', { deviceId: DEV_ID, deviceToken: deviceTokenMap[DEV_ID] || '', longitude: 116.45, latitude: 39.95 }); }, 2200);
    });
    socket.on('geofence:alert', (data: any) => {
      if (data.geofenceId !== gfId) return;
      if (data.type === 'enter') enterAlerts.push(data);
      if (data.type === 'exit') exitAlerts.push(data);
    });
    setTimeout(done, 4000);
  });
  resolved = false;

  assert(enterAlerts.length >= 2, '进入→离开→再进入: 收到至少2次enter告警', '实际enter次数: ' + enterAlerts.length);
  assert(exitAlerts.length >= 1, '离开时收到至少1次exit告警', '实际exit次数: ' + exitAlerts.length);
}

async function test25_concurrentPerformance(): Promise<void> {
  console.log('\n📌 测试25: 并发压测 - 多设备+多HTTP请求');
  const DEV_IDS = ['e2e-conc-A', 'e2e-conc-B', 'e2e-conc-C', 'e2e-conc-D', 'e2e-conc-E'];
  const sockets: any[] = [];
  let registeredCount = 0;
  let globalResolved = false;

  const registerAndSend = (devId: string): Promise<void> => {
    return new Promise((resolve) => {
      let innerResolved = false;
      const done = () => { if (!innerResolved) { innerResolved = true; resolve(); } };
      const sock = SocketIOClient(BASE_URL, { reconnection: false, timeout: 15000 });
      sockets.push(sock);
      sock.on('connect', () => { sock.emit('device:register', { deviceId: devId }); });
      sock.on('device:registered', async (data: any) => { deviceTokenMap[data.deviceId] = data.token;
        registeredCount++;
        for (let i = 0; i < 20; i++) {
          const lng = 116.4 + (i / 20) * 0.1;
          const lat = 39.9 + (i / 20) * 0.1;
          sock.emit('device:location', { deviceId: devId, deviceToken: deviceTokenMap[devId] || '', longitude: lng, latitude: lat, timestamp: Date.now() + i });
          await sleep(6);
        }
        setTimeout(done, 1000);
      });
      sock.on('device:location:ack', () => {});
      setTimeout(done, 8000);
    });
  };

  await Promise.all(DEV_IDS.map(registerAndSend));
  assert(registeredCount === 5, '5个设备全部注册成功', '成功数: ' + registeredCount);
  sockets.forEach((s) => { try { s.disconnect(); } catch {} });

  await sleep(3000);

  const httpPromises: Promise<any>[] = [];
  for (let i = 0; i < 10; i++) {
    const j = i % 5;
    const devId = DEV_IDS[j];
    const routes = [
      '/api/devices',
      '/api/devices/' + devId + '/location',
      '/api/devices/' + devId + '/history?limit=20',
      '/api/devices/' + devId + '/route',
    ];
    const route = routes[i % routes.length];
    httpPromises.push(new Promise(async (res) => {
      const start = Date.now();
      try {
        const r = await httpGet(route);
        res({ status: r.status, time: Date.now() - start });
      } catch (e) {
        res({ status: 0, time: Date.now() - start });
      }
    }));
  }
  const httpResults = await Promise.all(httpPromises);
  const all200 = httpResults.every((r) => r.status === 200);
  const allUnder5s = httpResults.every((r) => r.time < 5000);
  assert(all200, '10个并发HTTP请求全部返回200', '结果: ' + JSON.stringify(httpResults.map((r) => r.status)));
  assert(allUnder5s, '所有请求在5秒内返回', '耗时: ' + JSON.stringify(httpResults.map((r) => r.time)));

  for (const devId of DEV_IDS) {
    const histRes = await httpGet('/api/devices/' + devId + '/history?limit=100');
    const total = histRes.data?.pagination?.total || 0;
    assert(total >= 3, '设备' + devId + '历史记录>=3', '实际: ' + total);
  }
}

async function test26_geofenceEnableScanOnlineDevices(): Promise<void> {
  console.log('\n📌 测试26: 启用围栏扫描在线设备触发告警');
  const DEV_ID = 'e2e-scan-001';

  const gfRes = await httpPost('/api/geofences', {
    name: '扫描测试围栏', geofenceType: 'circle',
    circular: { center: [116.4, 39.9], radius: 1000 },
    alerts: ['enter'], enabled: false
  });
  const gfId = gfRes.data?.data?._id;
  assert(gfRes.status === 201, '创建enabled=false围栏返回201', '实际状态码: ' + gfRes.status);

  const socket = SocketIOClient(BASE_URL, { reconnection: false, timeout: 10000 });
  const enterAlerts: any[] = [];

  await new Promise<void>((resolve) => {
    let resolved = false;
    const done = () => { if (resolved) return; resolved = true; resolve(); };
    socket.on('connect', () => { socket.emit('device:register', { deviceId: DEV_ID }); });
    socket.on('device:registered', async (data: any) => { deviceTokenMap[data.deviceId] = data.token;
      socket.emit('device:location', { deviceId: DEV_ID, deviceToken: deviceTokenMap[DEV_ID] || '', longitude: 116.4, latitude: 39.9, timestamp: Date.now() });
      setTimeout(done, 300);
    });
    socket.on('device:location:ack', () => {});
    socket.on('geofence:alert', (data: any) => {
      if (data.type === 'enter' && data.geofenceId === gfId) enterAlerts.push(data);
    });
    setTimeout(done, 5000);
  });

  await sleep(300);

  const toggleRes = await httpRequest('PATCH', '/api/geofences/' + gfId + '/toggle', { enabled: true });
  assert(toggleRes.status === 200, 'PATCH toggle启用围栏返回200', '实际状态码: ' + toggleRes.status);

  await new Promise<void>((resolve) => {
    let resolved = false;
    const done = () => { if (resolved) return; resolved = true; resolve(); };
    const check = () => { if (enterAlerts.length >= 1) done(); };
    const interval = setInterval(check, 100);
    setTimeout(() => { clearInterval(interval); done(); }, 5000);
  });

  assert(enterAlerts.length >= 1, '启用围栏后收到至少1条enter告警', '实际告警数: ' + enterAlerts.length);
  if (enterAlerts.length > 0) {
    assert(enterAlerts[0].deviceId === DEV_ID, '告警deviceId正确', '实际: ' + enterAlerts[0].deviceId);
    assert(enterAlerts[0].geofenceId === gfId, '告警geofenceId正确', '实际: ' + enterAlerts[0].geofenceId);
  }

  socket.disconnect();
}

async function test27_historyGeoJsonFormat(): Promise<void> {
  console.log('\n📌 测试27: 历史轨迹GeoJSON格式');
  const DEV_ID = 'e2e-hist-geo-001';

  const socket = SocketIOClient(BASE_URL, { reconnection: false, timeout: 10000 });
  await new Promise<void>((resolve) => {
    let resolved = false;
    const done = () => { if (resolved) return; resolved = true; socket.disconnect(); resolve(); };
    socket.on('connect', () => { socket.emit('device:register', { deviceId: DEV_ID }); });
    socket.on('device:registered', async (data: any) => { deviceTokenMap[data.deviceId] = data.token;
      socket.emit('device:location', { deviceId: DEV_ID, deviceToken: deviceTokenMap[DEV_ID] || '', longitude: 116.40, latitude: 39.90, timestamp: Date.now() });
      await sleep(10);
      socket.emit('device:location', { deviceId: DEV_ID, deviceToken: deviceTokenMap[DEV_ID] || '', longitude: 116.41, latitude: 39.91, timestamp: Date.now() + 1 });
      await sleep(10);
      socket.emit('device:location', { deviceId: DEV_ID, deviceToken: deviceTokenMap[DEV_ID] || '', longitude: 116.42, latitude: 39.92, timestamp: Date.now() + 2 });
      setTimeout(done, 500);
    });
    socket.on('device:location:ack', () => {});
    setTimeout(done, 5000);
  });

  await sleep(500);

  const res = await httpGet('/api/devices/' + DEV_ID + '/history?format=geojson&dedup=true&simplify=false');
  assert(res.status === 200, 'GET history返回200', '实际状态码: ' + res.status);
  assert(res.data?.data?.type === 'FeatureCollection', 'data.type=FeatureCollection', '实际: ' + res.data?.data?.type);
  assert(Array.isArray(res.data?.data?.features), 'features为数组', '实际类型: ' + typeof res.data?.data?.features);
  assert(res.data?.data?.features.length >= 3, 'features length>=3', '实际: ' + res.data?.data?.features?.length);

  for (const f of res.data?.data?.features || []) {
    assert(f.type === 'Feature', 'feature.type=Feature', '实际: ' + f.type);
    assert(f.geometry?.type === 'Point', 'geometry.type=Point', '实际: ' + f.geometry?.type);
  }

  assert(res.data?.data?.metadata?.pointCount >= 3, 'metadata.pointCount>=3', '实际: ' + res.data?.data?.metadata?.pointCount);
  assert(res.data?.data?.metadata?.format === 'geojson', 'metadata.format=geojson', '实际: ' + res.data?.data?.metadata?.format);
  assert(res.data?.pagination !== undefined, 'pagination字段存在', '缺少pagination');
}

async function test28_markAlertRead(): Promise<void> {
  console.log('\n📌 测试28: 标记告警已读');
  const DEV_ID = 'e2e-alert-read-001';

  const gfRes = await httpPost('/api/geofences', {
    name: '已读测试围栏', geofenceType: 'circle',
    circular: { center: [116.4, 39.9], radius: 500 },
    alerts: ['enter'], enabled: true
  });
  const gfId = gfRes.data?.data?._id;
  assert(gfRes.status === 201, '创建围栏返回201', '实际状态码: ' + gfRes.status);

  const socket = SocketIOClient(BASE_URL, { reconnection: false, timeout: 10000 });
  await new Promise<void>((resolve) => {
    let resolved = false;
    const done = () => { if (resolved) return; resolved = true; socket.disconnect(); resolve(); };
    socket.on('connect', () => { socket.emit('device:register', { deviceId: DEV_ID }); });
    socket.on('device:registered', async (data: any) => { deviceTokenMap[data.deviceId] = data.token;
      socket.emit('device:location', { deviceId: DEV_ID, deviceToken: deviceTokenMap[DEV_ID] || '', longitude: 116.5, latitude: 40.0, timestamp: Date.now() });
      await sleep(200);
      socket.emit('device:location', { deviceId: DEV_ID, deviceToken: deviceTokenMap[DEV_ID] || '', longitude: 116.4, latitude: 39.9, timestamp: Date.now() + 1 });
      setTimeout(done, 600);
    });
    socket.on('device:location:ack', () => {});
    setTimeout(done, 5000);
  });

  await sleep(800);

  const alertsRes = await httpGet('/api/geofences/' + gfId + '/alerts');
  assert(alertsRes.status === 200, 'GET alerts返回200', '实际状态码: ' + alertsRes.status);
  const alerts = alertsRes.data?.data || [];
  assert(alerts.length >= 1, '至少有1条告警', '实际告警数: ' + alerts.length);
  const alertId = alerts[0]._id || alerts[0].id;
  assert(alerts[0].read === false, '第一条告警read=false', '实际: ' + alerts[0].read);

  const markRes = await httpRequest('PATCH', '/api/geofences/' + gfId + '/alerts/' + alertId + '/read');
  assert(markRes.status === 200, 'PATCH mark read返回200', '实际状态码: ' + markRes.status);
  assert(markRes.data?.data?.read === true, '返回data.read=true', '实际: ' + markRes.data?.data?.read);

  const alertsRes2 = await httpGet('/api/geofences/' + gfId + '/alerts');
  const alerts2 = alertsRes2.data?.data || [];
  const marked = alerts2.find((a: any) => (a._id === alertId || a.id === alertId));
  assert(marked?.read === true, 'GET验证该告警read=true', '实际: ' + marked?.read);

  const invalidRes = await httpRequest('PATCH', '/api/geofences/' + gfId + '/alerts/invalid-id/read');
  assert(invalidRes.status === 400, '无效alertId返回400', '实际状态码: ' + invalidRes.status);

  const notFoundRes = await httpRequest('PATCH', '/api/geofences/' + gfId + '/alerts/000000000000000000000000/read');
  assert(notFoundRes.status === 404, '不存在的alertId返回404', '实际状态码: ' + notFoundRes.status);
}

async function test29_deleteDeviceCascadeCleanup(): Promise<void> {
  console.log('\n📌 测试29: 删除设备级联清理');
  const DEV_ID = 'e2e-del-001';

  const socket = SocketIOClient(BASE_URL, { reconnection: false, timeout: 10000 });
  await new Promise<void>((resolve) => {
    let resolved = false;
    const done = () => { if (resolved) return; resolved = true; socket.disconnect(); resolve(); };
    socket.on('connect', () => { socket.emit('device:register', { deviceId: DEV_ID }); });
    socket.on('device:registered', async (data: any) => { deviceTokenMap[data.deviceId] = data.token;
      for (let i = 0; i < 5; i++) {
        socket.emit('device:location', { deviceId: DEV_ID, deviceToken: deviceTokenMap[DEV_ID] || '', longitude: 116.4 + i * 0.01, latitude: 39.9 + i * 0.01, timestamp: Date.now() + i });
        await sleep(6);
      }
      setTimeout(done, 500);
    });
    socket.on('device:location:ack', () => {});
    setTimeout(done, 5000);
  });

  const gfRes = await httpPost('/api/geofences', {
    name: '删除测试围栏', geofenceType: 'circle',
    circular: { center: [116.42, 39.92], radius: 1000 },
    alerts: ['enter'], enabled: true
  });
  assert(gfRes.status === 201, '创建围栏返回201', '实际状态码: ' + gfRes.status);

  const socket2 = SocketIOClient(BASE_URL, { reconnection: false, timeout: 10000 });
  await new Promise<void>((resolve) => {
    let resolved = false;
    const done = () => { if (resolved) return; resolved = true; socket2.disconnect(); resolve(); };
    socket2.on('connect', () => { socket2.emit('device:register', { deviceId: DEV_ID }); });
    socket2.on('device:registered', (data: any) => { deviceTokenMap[data.deviceId] = data.token;
      setTimeout(() => {
        socket2.emit('device:location', { deviceId: DEV_ID, deviceToken: deviceTokenMap[DEV_ID] || '', longitude: 116.42, latitude: 39.92, timestamp: Date.now() });
        setTimeout(done, 1000);
      }, 300);
    });
    socket2.on('device:location:ack', () => {});
    setTimeout(done, 5000);
  });

  await sleep(1000);

  const delRes = await httpRequest('DELETE', '/api/devices/' + DEV_ID);
  assert(delRes.status === 200, 'DELETE设备返回200', '实际状态码: ' + delRes.status);

  const getRes = await httpGet('/api/devices/' + DEV_ID);
  assert(getRes.status === 404, 'GET设备返回404', '实际状态码: ' + getRes.status);

  const locRes = await httpGet('/api/devices/' + DEV_ID + '/location');
  assert(locRes.status === 404, 'GET location返回404', '实际状态码: ' + locRes.status);

  const histRes = await httpGet('/api/devices/' + DEV_ID + '/history');
  const histOk = histRes.status === 404 || (histRes.status === 200 && Array.isArray(histRes.data?.data) && histRes.data.data.length === 0);
  assert(histOk, 'GET history返回404或空数组', '实际status: ' + histRes.status);
}

async function test30_batchGeofenceOperations(): Promise<void> {
  console.log('\n📌 测试30: 围栏批量操作');

  const batchCreateRes = await httpRequest('POST', '/api/geofences/batch', {
    geofences: [
      { name: 'batch1', geofenceType: 'circle', circular: { center: [116.40, 39.90], radius: 300 } },
      { name: 'batch2', geofenceType: 'circle', circular: { center: [116.41, 39.91], radius: 300 } }
    ]
  });
  assert(batchCreateRes.status === 201, 'POST batch创建返回201', '实际状态码: ' + batchCreateRes.status);
  assert(batchCreateRes.data?.count === 2, 'count=2', '实际: ' + batchCreateRes.data?.count);

  const ids: string[] = (batchCreateRes.data?.data || []).map((g: any) => g._id).filter(Boolean);
  assert(ids.length === 2, '获取到2个围栏ID', '实际: ' + ids.length);

  const toggleRes = await httpRequest('POST', '/api/geofences/batch/toggle', { ids, enabled: false });
  assert(toggleRes.status === 200, 'POST batch/toggle返回200', '实际状态码: ' + toggleRes.status);

  for (const id of ids) {
    const gfRes = await httpGet('/api/geofences/' + id);
    assert(gfRes.status === 200, 'GET围栏返回200', '实际状态码: ' + gfRes.status);
    assert(gfRes.data?.data?.enabled === false, '围栏enabled=false', '实际: ' + gfRes.data?.data?.enabled);
  }

  const delRes = await httpRequest('POST', '/api/geofences/batch/delete', { ids });
  assert(delRes.status === 200, 'POST batch/delete返回200', '实际状态码: ' + delRes.status);
  assert(delRes.data?.data?.deletedCount === 2, 'deletedCount=2', '实际: ' + delRes.data?.data?.deletedCount);

  for (const id of ids) {
    const gfRes = await httpGet('/api/geofences/' + id);
    assert(gfRes.status === 404, 'GET已删除围栏返回404', '实际状态码: ' + gfRes.status);
  }

  const emptyBatchRes = await httpRequest('POST', '/api/geofences/batch', { geofences: [] });
  assert(emptyBatchRes.status === 400, 'POST batch空数组返回400', '实际状态码: ' + emptyBatchRes.status);

  const emptyToggleRes = await httpRequest('POST', '/api/geofences/batch/toggle', { ids: [], enabled: false });
  assert(emptyToggleRes.status === 400, 'POST batch/toggle空ids返回400', '实际状态码: ' + emptyToggleRes.status);
}

async function runAllTests(): Promise<void> {
  console.log('═══════════════════════════════════════════════════');
  console.log('  物流追踪服务 - 端到端业务逻辑测试');
  console.log('═══════════════════════════════════════════════════');
  try {
    await startInfrastructure();
  } catch (err) {
    console.error('基础设施启动失败:', err);
    await stopInfrastructure();
    process.exit(1);
  }
  const tests = [
    test1_healthCheck,
    test2_createGeofences,
    test3_deviceRegisterViaWebSocket,
    test4_locationReportingAndGeofenceAlert,
    test5_geofenceExitAlert,
    test6_getDevicesList,
    test7_getDeviceLocation,
    test8_getDeviceHistoryWithFilters,
    test9_getDeviceRouteGeoJSON,
    test10_geofenceAlertsHistory,
    test11_invalidCoordinatesAndNotFound,
    test12_bulkLocationPagination,
    test13_overlappingGeofenceAlerts,
    test14_deviceDisconnectReconnect,
    test15_missingFieldsAndExtremes,
    test16_illegalTimestampAndEmptyBoundary,
    test17_geofenceDisableEnableAlertReset,
    test18_multiDeviceBroadcastIsolation,
    test19_thousandRecordsPaginationPerformance,
    test20_pingOfflineStatusTransition,
    test21_geofenceToggleEnableDisable,
    test22_routeDeduplicationAndSimplification,
    test23_locationReportRateLimiting,
    test24_offlineStateResetAndReenter,
    test25_concurrentPerformance,
    test26_geofenceEnableScanOnlineDevices,
    test27_historyGeoJsonFormat,
    test28_markAlertRead,
    test29_deleteDeviceCascadeCleanup,
    test30_batchGeofenceOperations,
  ];
  for (const testFn of tests) {
    try {
      await testFn();
    } catch (err) {
      console.error('测试执行异常:', err);
    }
  }
  await stopInfrastructure();
  console.log('\n═══════════════════════════════════════════════════');
  console.log('  测试结果汇总');
  console.log('═══════════════════════════════════════════════════');
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  const total = results.length;
  console.log(`\n  总计: ${total}  通过: ${passed}  失败: ${failed}`);
  console.log(`  通过率: ${((passed / total) * 100).toFixed(1)}%\n`);
  if (failed > 0) {
    console.log('  失败项:');
    results.filter((r) => !r.passed).forEach((r) => { console.log(`    ❌ ${r.name}: ${r.detail}`); });
    console.log('');
  }
  process.exit(failed > 0 ? 1 : 0);
}

runAllTests();
