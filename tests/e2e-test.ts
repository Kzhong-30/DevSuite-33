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

async function test1_healthCheck(): Promise<void> {
  console.log('\n📌 测试1: 健康检查与服务状态');
  const res = await httpGet('/health');
  assert(res.status === 200, '健康检查返回200', `实际状态码: ${res.status}`);
  assert(res.data.status === 'healthy', '服务状态为healthy', `实际状态: ${res.data.status}`);
  assert(typeof res.data.timestamp === 'string', '包含timestamp字段', `实际: ${typeof res.data.timestamp}`);
}

async function test2_createGeofences(): Promise<void> {
  console.log('\n📌 测试2: 创建圆形/多边形围栏 + 参数校验');
  const circleRes = await httpPost('/geofences', {
    name: '测试仓库-圆形', description: '圆形围栏覆盖仓库500米范围',
    geofenceType: 'circle', circular: { center: [116.4074, 39.9042], radius: 500 },
    alerts: ['enter', 'exit'], enabled: true,
  });
  assert(circleRes.status === 201, '创建圆形围栏返回201', `实际状态码: ${circleRes.status}`);
  assert(circleRes.data.success === true, '圆形围栏创建成功', `返回: ${JSON.stringify(circleRes.data)}`);
  assert(circleRes.data.data.geofenceType === 'circle', '围栏类型为circle', `实际类型: ${circleRes.data.data?.geofenceType}`);
  assert(circleRes.data.data.circular.radius === 500, '围栏半径为500', `实际半径: ${circleRes.data.data?.circular?.radius}`);
  assert(Array.isArray(circleRes.data.data.circular.center.coordinates), '圆形围栏包含center.coordinates', '');

  const polygonRes = await httpPost('/geofences', {
    name: '配送区域-多边形', geofenceType: 'polygon',
    polygon: { coordinates: [[[116.4, 39.9], [116.42, 39.9], [116.42, 39.92], [116.4, 39.92], [116.4, 39.9]]] },
    alerts: ['enter', 'exit'], enabled: true,
  });
  assert(polygonRes.status === 201, '创建多边形围栏返回201', `实际状态码: ${polygonRes.status}`);
  if (polygonRes.status === 201 && polygonRes.data?.data) {
    assert(polygonRes.data.data.geofenceType === 'polygon', '围栏类型为polygon', `实际类型: ${polygonRes.data.data?.geofenceType}`);
    assert(polygonRes.data.data.polygon?.geometry?.type === 'Polygon', '多边形geometry类型为Polygon', '');
  }
  const missingNameRes = await httpPost('/geofences', { geofenceType: 'circle', circular: { center: [116.4, 39.9], radius: 100 } });
  assert(missingNameRes.status === 400, '缺少name返回400', `实际状态码: ${missingNameRes.status}`);
  const missingTypeRes = await httpPost('/geofences', { name: '无类型围栏' });
  assert(missingTypeRes.status === 400, '缺少geofenceType返回400', `实际状态码: ${missingTypeRes.status}`);
  const invalidTypeRes = await httpPost('/geofences', { name: '无效类型围栏', geofenceType: 'invalid' });
  assert(invalidTypeRes.status === 400, '无效geofenceType返回400', `实际状态码: ${invalidTypeRes.status}`);
  const noRadiusRes = await httpPost('/geofences', { name: '缺半径圆形', geofenceType: 'circle', circular: { center: [116.4, 39.9] } });
  assert(noRadiusRes.status === 400, '圆形围栏缺少radius返回400', `实际状态码: ${noRadiusRes.status}`);
  const noCoordsRes = await httpPost('/geofences', { name: '缺坐标多边形', geofenceType: 'polygon' });
  assert(noCoordsRes.status === 400, '多边形围栏缺少coordinates返回400', `实际状态码: ${noCoordsRes.status}`);
  const negRadiusRes = await httpPost('/geofences', { name: '负半径圆形', geofenceType: 'circle', circular: { center: [116.4, 39.9], radius: -10 } });
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
    socket.on('device:registered', (data: any) => {
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
        socket.emit('device:location', { deviceId: DEVICE_ID, longitude: 116.4074, latitude: 39.9042, altitude: 50, speed: 30, direction: 90 });
      }, 500);
    });
    socket.on('device:registered', () => {});
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
      setTimeout(() => { socket.emit('device:location', { deviceId: DEVICE_ID, longitude: 116.4074, latitude: 39.9042 }); }, 300);
      setTimeout(() => { socket.emit('device:location', { deviceId: DEVICE_ID, longitude: 116.5, latitude: 40.0 }); }, 1500);
    });
    socket.on('device:registered', () => {});
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
    }, 3000);
  });
}

async function test6_getDevicesList(): Promise<void> {
  console.log('\n📌 测试6: 获取设备列表含最新位置');
  const res = await httpGet('/devices');
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
  const onlineRes = await httpGet('/devices?status=online');
  assert(onlineRes.status === 200, '按状态筛选设备返回200', `实际状态码: ${onlineRes.status}`);
}

async function test7_getDeviceLocation(): Promise<void> {
  console.log('\n📌 测试7: 获取设备最新位置');
  const res = await httpGet(`/devices/${DEVICE_ID}/location`);
  assert(res.status === 200, '获取设备位置返回200', `实际状态码: ${res.status}`);
  assert(res.data.success === true, 'success为true', `实际: ${res.data.success}`);
  assert(res.data.data.longitude === 116.5, '最新位置经度为116.5', `实际: ${res.data.data.longitude}`);
  assert(res.data.data.latitude === 40, '最新位置纬度为40', `实际: ${res.data.data.latitude}`);
  const notFoundRes = await httpGet('/devices/nonexistent/location');
  assert(notFoundRes.status === 404, '不存在的设备返回404', `实际状态码: ${notFoundRes.status}`);
}

async function test8_getDeviceHistoryWithFilters(): Promise<void> {
  console.log('\n📌 测试8: 历史轨迹时间范围筛选和分页');
  const allRes = await httpGet(`/devices/${DEVICE_ID}/history`);
  assert(allRes.status === 200, '获取全部历史返回200', `实际状态码: ${allRes.status}`);
  assert(allRes.data.data.length >= 3, '历史记录至少3条', `实际: ${allRes.data.data.length}条`);
  assert(allRes.data.pagination.total >= 3, '分页total至少3', `实际: ${allRes.data.pagination.total}`);
  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 3600000).toISOString();
  const oneHourLater = new Date(now.getTime() + 3600000).toISOString();
  const filteredRes = await httpGet(`/devices/${DEVICE_ID}/history?start=${oneHourAgo}&end=${oneHourLater}`);
  assert(filteredRes.status === 200, '时间范围筛选返回200', `实际状态码: ${filteredRes.status}`);
  assert(filteredRes.data.data.length >= 3, '筛选结果包含所有记录', `实际: ${filteredRes.data.data.length}条`);
  const farFutureRes = await httpGet(`/devices/${DEVICE_ID}/history?start=2099-01-01T00:00:00Z`);
  assert(farFutureRes.status === 200, '远未来时间筛选返回200', `实际状态码: ${farFutureRes.status}`);
  assert(farFutureRes.data.data.length === 0, '远未来时间无记录', `实际: ${farFutureRes.data.data.length}条`);
  const page1Res = await httpGet(`/devices/${DEVICE_ID}/history?page=1&limit=2`);
  assert(page1Res.status === 200, '分页查询返回200', `实际状态码: ${page1Res.status}`);
  assert(page1Res.data.data.length <= 2, '每页最多2条', `实际: ${page1Res.data.data.length}条`);
  assert(page1Res.data.pagination.page === 1, '页码为1', `实际: ${page1Res.data.pagination.page}`);
  assert(page1Res.data.pagination.totalPages >= 2, '总页数至少2', `实际: ${page1Res.data.pagination.totalPages}`);
  const page2Res = await httpGet(`/devices/${DEVICE_ID}/history?page=2&limit=2`);
  assert(page2Res.status === 200, '第2页查询返回200', `实际状态码: ${page2Res.status}`);
  assert(page2Res.data.pagination.page === 2, '页码为2', `实际: ${page2Res.data.pagination.page}`);
  assert(page2Res.data.data.length > 0, '第2页有数据', `实际: ${page2Res.data.data.length}条`);
  const invalidPageRes = await httpGet(`/devices/${DEVICE_ID}/history?page=0&limit=-1`);
  assert(invalidPageRes.status === 200, '无效分页参数不崩溃返回200', `实际状态码: ${invalidPageRes.status}`);
}

async function test9_getDeviceRouteGeoJSON(): Promise<void> {
  console.log('\n📌 测试9: GeoJSON LineString路线生成 + 距离计算验证');
  const res = await httpGet(`/devices/${DEVICE_ID}/route`);
  assert(res.status === 200, '获取路线返回200', `实际状态码: ${res.status}`);
  assert(res.data.success === true, 'success为true', `实际: ${res.data.success}`);
  const rd = res.data.data;
  assert(rd.type === 'Feature', 'GeoJSON类型为Feature', `实际: ${rd.type}`);
  assert(rd.geometry.type === 'LineString', 'geometry类型为LineString', `实际: ${rd.geometry.type}`);
  assert(Array.isArray(rd.geometry.coordinates), 'coordinates为数组', `实际类型: ${typeof rd.geometry.coordinates}`);
  assert(rd.geometry.coordinates.length >= 3, '坐标点至少3个', `实际: ${rd.geometry.coordinates.length}`);
  const fc = rd.geometry.coordinates[0];
  assert(fc.length === 2, '每个坐标点包含2个值[lon,lat]', `实际: ${fc.length}个值`);
  assert(typeof fc[0] === 'number' && typeof fc[1] === 'number', '坐标值为数字类型', '');
  assert(rd.properties.pointCount >= 3, 'pointCount至少3', `实际: ${rd.properties.pointCount}`);
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
  const notFoundRes = await httpGet('/devices/nonexistent/route');
  assert(notFoundRes.status === 404, '不存在的设备返回404', `实际状态码: ${notFoundRes.status}`);
}

async function test10_geofenceAlertsHistory(): Promise<void> {
  console.log('\n📌 测试10: 围栏告警历史查询');
  const geofencesRes = await httpGet('/geofences');
  assert(geofencesRes.status === 200, '获取围栏列表返回200', `实际状态码: ${geofencesRes.status}`);
  assert(geofencesRes.data.data.length > 0, '围栏列表非空', `围栏数量: ${geofencesRes.data.data.length}`);
  const geofenceId = geofencesRes.data.data[0]._id;
  const alertsRes = await httpGet(`/geofences/${geofenceId}/alerts`);
  assert(alertsRes.status === 200, '获取围栏告警返回200', `实际状态码: ${alertsRes.status}`);
  assert(alertsRes.data.success === true, 'success为true', `实际: ${alertsRes.data.success}`);
  assert(Array.isArray(alertsRes.data.data), '告警数据为数组', `实际类型: ${typeof alertsRes.data.data}`);
  const pagRes = await httpGet(`/geofences/${geofenceId}/alerts?page=1&limit=10`);
  assert(pagRes.status === 200, '分页查询告警返回200', `实际状态码: ${pagRes.status}`);
  assert(!!pagRes.data.pagination, '包含分页信息', '');
  const invIdRes = await httpGet('/geofences/invalid-id/alerts');
  assert(invIdRes.status === 400, '无效ID返回400', `实际状态码: ${invIdRes.status}`);
}

async function test11_invalidCoordinatesAndNotFound(): Promise<void> {
  console.log('\n📌 测试11: 无效坐标校验 + 404处理');
  const socket = SocketIOClient(BASE_URL, { reconnection: false, timeout: 5000 });
  const errors: any[] = [];
  await new Promise<void>((resolve) => {
    socket.on('connect', () => {
      socket.emit('device:register', { deviceId: DEVICE_ID });
      setTimeout(() => { socket.emit('device:location', { deviceId: DEVICE_ID, longitude: 999, latitude: 999 }); }, 300);
    });
    socket.on('device:registered', () => {});
    socket.on('error', (data: any) => { errors.push(data); });
    setTimeout(() => { socket.disconnect(); resolve(); }, 2000);
  });
  assert(errors.length > 0, '无效坐标返回WebSocket错误', `收到错误数: ${errors.length}`);
  if (errors.length > 0) {
    assert(errors[0].message.includes('Invalid') || errors[0].message.includes('coordinates') || errors[0].message.includes('required'), '错误消息包含无效坐标信息', `实际消息: ${errors[0].message}`);
  }
  const nf1 = await httpGet('/devices/nonexistent');
  assert(nf1.status === 404, '不存在的设备返回404', `实际状态码: ${nf1.status}`);
  const nf2 = await httpGet('/nonexistent-route');
  assert(nf2.status === 404, '不存在的路由返回404', `实际状态码: ${nf2.status}`);
  const nf3 = await httpGet('/geofences/000000000000000000000000');
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
    socket.on('device:registered', (data: any) => {
      if (data.deviceId === 'e2e-stress-001') {
        registered = true;
        for (let i = 0; i < 50; i++) {
          const lng = 116.4 + (117.2 - 116.4) * (i / 49);
          const lat = 39.9 + (39.1 - 39.9) * (i / 49);
          socket.emit('device:location', { deviceId: 'e2e-stress-001', longitude: Math.round(lng * 10000) / 10000, latitude: Math.round(lat * 10000) / 10000 });
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
  const histRes = await httpGet('/devices/e2e-stress-001/history');
  assert(histRes.status === 200, '获取历史记录返回200', `实际状态码: ${histRes.status}`);
  assert(histRes.data.pagination.total >= 50, '历史记录总数>=50', `实际: ${histRes.data.pagination.total}`);
  const pagStart = Date.now();
  const pagRes = await httpGet('/devices/e2e-stress-001/history?page=1&limit=10');
  const pagTime = Date.now() - pagStart;
  assert(pagRes.status === 200, '分页查询返回200', `实际状态码: ${pagRes.status}`);
  assert(pagRes.data.pagination.totalPages >= 5, 'totalPages>=5', `实际: ${pagRes.data.pagination.totalPages}`);
  assert(pagRes.data.data.length <= 10, '第1页数据<=10条', `实际: ${pagRes.data.data.length}`);
  assert(pagTime < 2000, '分页查询响应时间<2秒', `实际: ${pagTime}ms`);
  const page5Res = await httpGet('/devices/e2e-stress-001/history?page=5&limit=10');
  assert(page5Res.status === 200, '第5页查询返回200', `实际状态码: ${page5Res.status}`);
  assert(page5Res.data.pagination.page === 5, '第5页页码正确', `实际: ${page5Res.data.pagination.page}`);
  const routeStart = Date.now();
  const routeRes = await httpGet('/devices/e2e-stress-001/route');
  const routeTime = Date.now() - routeStart;
  assert(routeRes.status === 200, '路线生成返回200', `实际状态码: ${routeRes.status}`);
  assert(routeTime < 2000, '路线生成响应时间<2秒', `实际: ${routeTime}ms`);
  if (routeRes.data?.data?.geometry) {
    assert(routeRes.data.data.geometry.coordinates.length >= 50, '路线坐标点>=50', `实际: ${routeRes.data.data.geometry.coordinates.length}`);
  }
}

async function test13_overlappingGeofenceAlerts(): Promise<void> {
  console.log('\n📌 测试13: 多围栏重叠告警顺序');
  const circleA = await httpPost('/geofences', {
    name: '围栏A-小圆', geofenceType: 'circle',
    circular: { center: [116.4074, 39.9042], radius: 100 },
    alerts: ['enter'], enabled: true,
  });
  assert(circleA.status === 201, '创建围栏A返回201', `实际状态码: ${circleA.status}`);
  const circleB = await httpPost('/geofences', {
    name: '围栏B-大圆', geofenceType: 'circle',
    circular: { center: [116.4074, 39.9042], radius: 1000 },
    alerts: ['exit'], enabled: true,
  });
  assert(circleB.status === 201, '创建围栏B返回201', `实际状态码: ${circleB.status}`);
  const polygonC = await httpPost('/geofences', {
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
    socket.on('device:registered', () => {
      setTimeout(() => {
        socket.emit('device:location', { deviceId: 'e2e-overlap-001', longitude: 116.4074, latitude: 39.9042 });
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
    socket2.on('device:registered', () => {
      setTimeout(() => {
        socket2.emit('device:location', { deviceId: 'e2e-overlap-001', longitude: 116.5, latitude: 40.0 });
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
    const done = () => { if (!resolved) { resolved = true; resolve(); } };
    socket1.on('connect', () => {
      socket1.emit('device:register', { deviceId: 'e2e-reconnect-001', name: '重连测试设备', type: 'truck' });
    });
    socket1.on('device:registered', (data: any) => {
      if (data.deviceId === 'e2e-reconnect-001') {
        reg1Success = true;
        setTimeout(() => {
          socket1.emit('device:location', { deviceId: 'e2e-reconnect-001', longitude: 116.3, latitude: 39.8 });
        }, 300);
      }
    });
    socket1.on('device:location:ack', (data: any) => {
      if (data.success) loc1Ack = true;
    });
    setTimeout(done, 3000);
  });
  assert(reg1Success, '首次注册成功', '未收到注册确认');
  assert(loc1Ack, '首次位置上报ack', '未收到位置确认');
  socket1.disconnect();
  await sleep(1000);
  const socket2 = SocketIOClient(BASE_URL, { reconnection: false, timeout: 5000 });
  let reg2Success = false;
  let reg2Status = '';
  let loc2Ack = false;
  await new Promise<void>((resolve) => {
    let resolved = false;
    const done = () => { if (!resolved) { resolved = true; socket2.disconnect(); resolve(); } };
    socket2.on('connect', () => {
      socket2.emit('device:register', { deviceId: 'e2e-reconnect-001' });
    });
    socket2.on('device:registered', (data: any) => {
      if (data.deviceId === 'e2e-reconnect-001') {
        reg2Success = true;
        reg2Status = data.status;
        setTimeout(() => {
          socket2.emit('device:location', { deviceId: 'e2e-reconnect-001', longitude: 117.0, latitude: 40.5 });
        }, 300);
      }
    });
    socket2.on('device:location:ack', (data: any) => {
      if (data.success) loc2Ack = true;
    });
    setTimeout(done, 3000);
  });
  assert(reg2Success, '重连注册成功', '未收到注册确认');
  assert(reg2Status === 'online', '重连后状态为online', `实际: ${reg2Status}`);
  assert(loc2Ack, '重连后位置上报ack', '未收到位置确认');
  const devRes = await httpGet('/devices/e2e-reconnect-001/location');
  assert(devRes.status === 200, 'HTTP获取设备位置返回200', `实际状态码: ${devRes.status}`);
  assert(devRes.data.data.longitude === 117.0, '最新位置经度为117.0', `实际: ${devRes.data.data.longitude}`);
  assert(devRes.data.data.latitude === 40.5, '最新位置纬度为40.5', `实际: ${devRes.data.data.latitude}`);
  const devListRes = await httpGet('/devices?status=online');
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
    socket.on('device:registered', () => {
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
    socket2.on('device:registered', () => {
      socket2.emit('device:location', { deviceId: 'e2e-extreme-001', latitude: 39.9 });
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
    socket3.on('device:registered', () => {
      socket3.emit('device:location', { deviceId: 'e2e-extreme-001', longitude: -180, latitude: -90 });
      setTimeout(() => {
        socket3.emit('device:location', { deviceId: 'e2e-extreme-001', longitude: 180, latitude: 90 });
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
  const emptyNameRes = await httpPost('/geofences', {
    name: '', geofenceType: 'circle',
    circular: { center: [116.4, 39.9], radius: 100 }, alerts: ['enter'], enabled: true,
  });
  assert(emptyNameRes.status === 400, '围栏name为空返回400', `实际状态码: ${emptyNameRes.status}`);
  const zeroRadiusRes = await httpPost('/geofences', {
    name: '零半径围栏', geofenceType: 'circle',
    circular: { center: [116.4, 39.9], radius: 0 }, alerts: ['enter'], enabled: true,
  });
  assert(zeroRadiusRes.status === 400, '围栏radius为0返回400', `实际状态码: ${zeroRadiusRes.status}`);
  const hugeRadiusRes = await httpPost('/geofences', {
    name: '极大半径围栏', geofenceType: 'circle',
    circular: { center: [116.4, 39.9], radius: 999999 }, alerts: ['enter'], enabled: true,
  });
  assert(hugeRadiusRes.status === 201, '围栏radius=999999正常创建返回201', `实际状态码: ${hugeRadiusRes.status}`);
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
