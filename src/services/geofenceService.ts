import { Geofence, IGeofence } from '../models/Geofence';
import { Alert as AlertModel, IAlert, AlertEventType } from '../models/Alert';
import { Types } from 'mongoose';

export interface LocationPoint {
  longitude: number;
  latitude: number;
  deviceId: string;
}

export class GeofenceService {
  private deviceLastStates: Map<string, Set<string>> = new Map();

  private toRadians(degrees: number): number {
    return degrees * (Math.PI / 180);
  }

  private calculateDistance(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number
  ): number {
    const earthRadius = 6371000;
    const dLat = this.toRadians(lat2 - lat1);
    const dLon = this.toRadians(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRadians(lat1)) *
        Math.cos(this.toRadians(lat2)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return earthRadius * c;
  }

  private isPointInCircle(
    point: LocationPoint,
    center: [number, number],
    radius: number
  ): boolean {
    const distance = this.calculateDistance(
      point.latitude,
      point.longitude,
      center[1],
      center[0]
    );
    return distance <= radius;
  }

  private isPointInPolygon(
    point: LocationPoint,
    polygonCoordinates: number[][][]
  ): boolean {
    const ring = polygonCoordinates[0];
    if (!ring || ring.length < 3) return false;

    let inside = false;
    const x = point.longitude;
    const y = point.latitude;

    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0];
      const yi = ring[i][1];
      const xj = ring[j][0];
      const yj = ring[j][1];

      const intersect =
        yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
      if (intersect) inside = !inside;
    }

    return inside;
  }

  private isDeviceInGeofence(
    point: LocationPoint,
    geofence: IGeofence
  ): boolean {
    if (!geofence.enabled) return false;

    if (geofence.geofenceType === 'circle' && geofence.circular) {
      return this.isPointInCircle(
        point,
        geofence.circular.center.coordinates as [number, number],
        geofence.circular.radius
      );
    }

    if (geofence.geofenceType === 'polygon' && geofence.polygon) {
      return this.isPointInPolygon(
        point,
        geofence.polygon.geometry.coordinates
      );
    }

    return false;
  }

  async checkGeofences(point: LocationPoint): Promise<IAlert[]> {
    const alerts: IAlert[] = [];
    const geofences = await Geofence.find({ enabled: true });

    const currentInside = new Set<string>();

    for (const geofence of geofences) {
      const inside = this.isDeviceInGeofence(point, geofence);
      if (inside) {
        currentInside.add(geofence._id.toString());
      }

      const lastStates = this.deviceLastStates.get(point.deviceId) || new Set<string>();
      const wasInside = lastStates.has(geofence._id.toString());

      if (inside && !wasInside && geofence.alerts.includes('enter')) {
        const alert = await AlertModel.create({
          geofenceId: geofence._id as Types.ObjectId,
          deviceId: point.deviceId,
          type: 'enter' as AlertEventType,
          message: `设备 ${point.deviceId} 进入围栏 ${geofence.name}`,
          location: {
            type: 'Point',
            coordinates: [point.longitude, point.latitude]
          },
          timestamp: new Date(),
          read: false
        });
        alerts.push(alert);
      }

      if (!inside && wasInside && geofence.alerts.includes('exit')) {
        const alert = await AlertModel.create({
          geofenceId: geofence._id as Types.ObjectId,
          deviceId: point.deviceId,
          type: 'exit' as AlertEventType,
          message: `设备 ${point.deviceId} 离开围栏 ${geofence.name}`,
          location: {
            type: 'Point',
            coordinates: [point.longitude, point.latitude]
          },
          timestamp: new Date(),
          read: false
        });
        alerts.push(alert);
      }
    }

    this.deviceLastStates.set(point.deviceId, currentInside);

    return alerts;
  }

  async createGeofence(data: {
    name: string;
    description?: string;
    geofenceType: 'circle' | 'polygon';
    circular?: {
      center: [number, number];
      radius: number;
    };
    polygon?: {
      coordinates: number[][][];
    };
    alerts?: ('enter' | 'exit')[];
    enabled?: boolean;
  }): Promise<IGeofence> {
    const geofenceData: any = {
      name: data.name,
      description: data.description,
      geofenceType: data.geofenceType,
      alerts: data.alerts || ['enter', 'exit'],
      enabled: data.enabled !== undefined ? data.enabled : true
    };

    if (data.geofenceType === 'circle' && data.circular) {
      geofenceData.circular = {
        type: 'circle',
        center: {
          type: 'Point',
          coordinates: data.circular.center
        },
        radius: data.circular.radius
      };
    }

    if (data.geofenceType === 'polygon' && data.polygon) {
      geofenceData.polygon = {
        type: 'polygon',
        geometry: {
          type: 'Polygon',
          coordinates: data.polygon.coordinates
        }
      };
    }

    const geofence = new Geofence(geofenceData);
    return await geofence.save();
  }

  async getAllGeofences(): Promise<IGeofence[]> {
    return await Geofence.find().sort({ createdAt: -1 });
  }

  async getGeofenceById(id: string): Promise<IGeofence | null> {
    return await Geofence.findById(id);
  }

  async getGeofenceAlerts(
    geofenceId: string,
    page: number = 1,
    limit: number = 50
  ): Promise<{ alerts: IAlert[]; total: number; page: number; limit: number }> {
    const skip = (page - 1) * limit;
    const total = await AlertModel.countDocuments({ geofenceId });
    const alerts = await AlertModel.find({ geofenceId })
      .sort({ timestamp: -1 })
      .skip(skip)
      .limit(limit)
      .populate('geofenceId', 'name');

    return { alerts, total, page, limit };
  }
  async toggleGeofence(id: string, enabled: boolean): Promise<IGeofence | null> {
    return await Geofence.findByIdAndUpdate(id, { enabled }, { new: true });
  }

  resetDeviceState(deviceId: string): void {
    this.deviceLastStates.delete(deviceId);
  }
}

export const geofenceService = new GeofenceService();
