import { Server as HTTPServer } from 'http';
import { Server, Socket } from 'socket.io';
import { Device, IDevice } from '../models/Device';
import { Location, ILocation } from '../models/Location';
import { geofenceService } from './geofenceService';
import { config } from '../config';
import { IAlert } from '../models/Alert';
import { generateToken } from '../utils/auth';

export interface LocationPayload {
  deviceId: string;
  longitude: number;
  latitude: number;
  altitude?: number;
  speed?: number;
  direction?: number;
  timestamp?: number;
  deviceToken?: string;
}

export class WebSocketService {
  private io: Server;
  private deviceSockets: Map<string, string> = new Map();
  private socketDevices: Map<string, string> = new Map();
  private deviceLastPing: Map<string, number> = new Map();
  private deviceLastReport: Map<string, number> = new Map();
  private offlineCheckInterval: NodeJS.Timeout | null = null;
  private ipConnectionCount: Map<string, number> = new Map();
  private totalConnections: number = 0;

  constructor(httpServer: HTTPServer) {
    this.io = new Server(httpServer, {
      cors: {
        origin: config.corsOrigin,
        methods: ['GET', 'POST']
      }
    });

    this.setupListeners();
    this.startOfflineCheck();
    geofenceService.setIo(this.io);
  }

  private setupListeners(): void {
    this.io.on('connection', (socket: Socket) => {
      console.log(`Client connected: ${socket.id}`);


      if (this.totalConnections >= config.maxConnections) {
        socket.emit('error', { message: 'Server at max capacity' });
        socket.disconnect(true);
        return;
      }
      const rawIp = (socket.handshake.headers && socket.handshake.headers['x-forwarded-for']) ? String(socket.handshake.headers['x-forwarded-for']).split(',')[0].trim() : socket.handshake.address;
      const clientIp = rawIp || 'unknown';
      const ipCount = this.ipConnectionCount.get(clientIp) || 0;
      if (ipCount >= config.maxConnectionsPerIp) {
        socket.emit('error', { message: 'Too many connections from this IP' });
        socket.disconnect(true);
        return;
      }
      this.totalConnections++;
      this.ipConnectionCount.set(clientIp, ipCount + 1);
      (socket as any)._clientIp = clientIp;

      socket.on('device:register', async (payload: { deviceId: string; name?: string; type?: string }) => {
        await this.handleDeviceRegister(socket, payload);
      });

      socket.on('device:location', async (payload: LocationPayload) => {
        await this.handleDeviceLocation(socket, payload);
      });

      socket.on('device:ping', async (payload: { deviceId: string; deviceToken?: string }) => {
        await this.handleDevicePing(socket, payload);
      });

      socket.on('client:subscribe', (rooms: string | string[]) => {
        const roomList = Array.isArray(rooms) ? rooms : [rooms];
        roomList.forEach(room => socket.join(room));
        console.log(`Socket ${socket.id} subscribed to rooms: ${roomList.join(', ')}`);
      });

      socket.on('disconnect', () => {
        this.handleDisconnect(socket);
      });
    });
  }

  private async handleDeviceRegister(
    socket: Socket,
    payload: { deviceId: string; name?: string; type?: string }
  ): Promise<void> {
    const { deviceId, name, type } = payload;

    if (!deviceId) {
      socket.emit('error', { message: 'deviceId is required' });
      return;
    }

    let device = await Device.findOne({ deviceId });
    if (!device) {
      const token = generateToken();
      device = await Device.create({
        deviceId,
        name: name || deviceId,
        type: type || 'truck',
          deviceToken: token,
        status: 'online',
        lastSeen: new Date()
      });
    } else {
      device.status = 'online';
      device.lastSeen = new Date();
      if (name) device.name = name;
      if (type) device.type = type;
        if (!device.deviceToken) device.deviceToken = generateToken();
      await device.save();
    }

    const oldSocketId = this.deviceSockets.get(deviceId);
    if (oldSocketId && oldSocketId !== socket.id) {
      const oldSocket = this.io.sockets.sockets.get(oldSocketId);
      if (oldSocket) {
        oldSocket.disconnect(true);
      }
    }

    this.deviceSockets.set(deviceId, socket.id);
    this.socketDevices.set(socket.id, deviceId);
    this.deviceLastPing.set(deviceId, Date.now());

    socket.join(`device:${deviceId}`);
    socket.emit('device:registered', { deviceId: device.deviceId, status: 'online', token: device.deviceToken });

    this.io.emit('device:status', {
      deviceId: device.deviceId,
      status: 'online',
      timestamp: new Date().toISOString()
    });

    console.log(`Device registered: ${deviceId} (${socket.id})`);
  }

  private async handleDeviceLocation(
    socket: Socket,
    payload: LocationPayload
  ): Promise<void> {
    const { deviceId, longitude, latitude, altitude = 0, speed = 0, direction = 0, timestamp, deviceToken } = payload;
    const dev = await Device.findOne({ deviceId });
    if (!deviceToken || dev!.deviceToken !== deviceToken) {
      socket.emit("error", { message: "Invalid or missing token" });
      return;
    }

    const lastReport = this.deviceLastReport.get(deviceId) || 0;
    const now = Date.now();
    if (now - lastReport < config.minReportInterval) {
      socket.emit('error', { message: 'Report too frequent' });
      return;
    }
    this.deviceLastReport.set(deviceId, now);

    if (!deviceId || longitude === undefined || latitude === undefined) {
      socket.emit('error', { message: 'deviceId, longitude and latitude are required' });
      return;
    }

    if (longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) {
      socket.emit('error', { message: 'Invalid coordinates' });
      return;
    }

    if (timestamp !== undefined) {
      if (typeof timestamp !== 'number' || isNaN(timestamp) || timestamp < 0) {
        socket.emit('error', { message: 'Invalid timestamp' });
        return;
      }
    }

    const locationData = {
      deviceId,
      longitude,
      latitude,
      altitude,
      speed,
      direction,
      timestamp: timestamp ? new Date(timestamp) : new Date(),
      coordinates: {
        type: 'Point' as const,
        coordinates: [longitude, latitude]
      }
    };

    const location = await Location.create(locationData);

    await Device.updateOne(
      { deviceId },
      { $set: { status: 'online', lastSeen: new Date() } },
      { upsert: true, setDefaultsOnInsert: true }
    );

    this.deviceLastPing.set(deviceId, Date.now());
    if (!this.deviceSockets.has(deviceId)) {
      this.deviceSockets.set(deviceId, socket.id);
      this.socketDevices.set(socket.id, deviceId);
    }

    const locationBroadcast = {
      deviceId,
      longitude,
      latitude,
      altitude,
      speed,
      direction,
      timestamp: locationData.timestamp.toISOString()
    };

    this.io.emit('device:location:update', locationBroadcast);
    this.io.to(`device:${deviceId}`).emit('device:location:ack', {
      success: true,
      timestamp: locationData.timestamp.toISOString()
    });

    const alerts = await geofenceService.checkGeofences({
      deviceId,
      longitude,
      latitude
    });

    for (const alert of alerts) {
      const alertData = {
        id: alert._id,
        geofenceId: alert.geofenceId,
        deviceId: alert.deviceId,
        type: alert.type,
        message: alert.message,
        location: alert.location,
        timestamp: alert.timestamp.toISOString()
      };
      this.io.emit('geofence:alert', alertData);
      this.io.to(`device:${deviceId}`).emit('device:alert', alertData);
    }
  }


  private async handleDevicePing(socket: Socket, payload: { deviceId: string; deviceToken?: string }): Promise<void> {
    const { deviceId, deviceToken } = payload;
    const dev = await Device.findOne({ deviceId });
    if (!deviceToken || dev!.deviceToken !== deviceToken) {
      socket.emit("error", { message: "Invalid or missing token" });
      return;
    }
    this.deviceLastPing.set(deviceId, Date.now());
  }

  private handleDisconnect(socket: Socket): void {
    if (this.totalConnections > 0) this.totalConnections--;
    const clientIp = (socket as any)._clientIp;
    if (clientIp) {
      const cnt = this.ipConnectionCount.get(clientIp) || 0;
      if (cnt > 1) this.ipConnectionCount.set(clientIp, cnt - 1);
      else this.ipConnectionCount.delete(clientIp);
    }
    const deviceId = this.socketDevices.get(socket.id);
    if (deviceId) {
      this.socketDevices.delete(socket.id);
      this.deviceSockets.delete(deviceId);
      this.deviceLastReport.delete(deviceId);
      console.log(`Socket disconnected for device: ${deviceId}`);
    }
    console.log(`Client disconnected: ${socket.id}`);
  }

  private startOfflineCheck(): void {
    this.offlineCheckInterval = setInterval(async () => {
      const now = Date.now();
      const offlineDevices: string[] = [];

      for (const [deviceId, lastPing] of this.deviceLastPing.entries()) {
        if (now - lastPing > config.deviceOfflineTimeout) {
          const device = await Device.findOne({ deviceId, status: 'online' });
          if (device) {
            device.status = 'offline';
            await device.save();
            offlineDevices.push(deviceId);

            this.deviceLastPing.delete(deviceId);
            this.deviceLastReport.delete(deviceId);
            geofenceService.resetDeviceState(deviceId);
            const socketId = this.deviceSockets.get(deviceId);
            if (socketId) {
              this.deviceSockets.delete(deviceId);
              this.socketDevices.delete(socketId);
            }
          }
        }
      }

      for (const deviceId of offlineDevices) {
        this.io.emit('device:offline', {
          deviceId,
          timestamp: new Date().toISOString()
        });
        console.log(`Device went offline: ${deviceId}`);
      }
    }, config.deviceOfflineTimeout);
  }

  public broadcast(event: string, data: any): void {
    this.io.emit(event, data);
  }

  public getIO(): Server {
    return this.io;
  }

  public isDeviceOnline(deviceId: string): boolean {
    return this.deviceSockets.has(deviceId);
  }

  public shutdown(): void {
    if (this.offlineCheckInterval) {
      clearInterval(this.offlineCheckInterval);
    }
    this.io.close();
  }
}

let webSocketService: WebSocketService | null = null;

export function initWebSocket(server: HTTPServer): WebSocketService {
  webSocketService = new WebSocketService(server);
  return webSocketService;
}

export function getWebSocketService(): WebSocketService {
  if (!webSocketService) {
    throw new Error('WebSocket service not initialized');
  }
  return webSocketService;
}
