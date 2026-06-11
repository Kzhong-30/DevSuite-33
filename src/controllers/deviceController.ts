import { Request, Response } from 'express';
import { Device } from '../models/Device';
import { Location } from '../models/Location';
import { getWebSocketService } from '../services/websocketService';

export const deviceController = {
  async getAllDevices(req: Request, res: Response): Promise<void> {
    try {
      const { status } = req.query;
      const filter: any = {};
      if (status && typeof status === 'string') {
        filter.status = status;
      }

      const devices = await Device.find(filter).sort({ lastSeen: -1 }).lean();

      const enrichedDevices = await Promise.all(
        devices.map(async (device) => {
          const latestLocation = await Location.findOne({ deviceId: device.deviceId })
            .sort({ timestamp: -1 })
            .limit(1)
            .lean();

          return {
            ...device,
            currentLocation: latestLocation
              ? {
                  longitude: latestLocation.longitude,
                  latitude: latestLocation.latitude,
                  altitude: latestLocation.altitude,
                  speed: latestLocation.speed,
                  direction: latestLocation.direction,
                  timestamp: latestLocation.timestamp
                }
              : null
          };
        })
      );

      res.json({
        success: true,
        count: enrichedDevices.length,
        data: enrichedDevices
      });
    } catch (error) {
      console.error('Error fetching devices:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch devices',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  },

  async getDevice(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const device = await Device.findOne({ deviceId: id }).lean();

      if (!device) {
        res.status(404).json({
          success: false,
          message: 'Device not found'
        });
        return;
      }

      const latestLocation = await Location.findOne({ deviceId: id })
        .sort({ timestamp: -1 })
        .limit(1)
        .lean();

      const wsService = getWebSocketService();
      const isOnline = wsService.isDeviceOnline(id);

      res.json({
        success: true,
        data: {
          ...device,
          status: isOnline ? 'online' : device.status,
          currentLocation: latestLocation
            ? {
                longitude: latestLocation.longitude,
                latitude: latestLocation.latitude,
                altitude: latestLocation.altitude,
                speed: latestLocation.speed,
                direction: latestLocation.direction,
                timestamp: latestLocation.timestamp
              }
            : null
        }
      });
    } catch (error) {
      console.error('Error fetching device:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch device',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  },

  async getDeviceLocation(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;

      const device = await Device.findOne({ deviceId: id }).lean();
      if (!device) {
        res.status(404).json({
          success: false,
          message: 'Device not found'
        });
        return;
      }

      const latestLocation = await Location.findOne({ deviceId: id })
        .sort({ timestamp: -1 })
        .limit(1)
        .lean();

      if (!latestLocation) {
        res.status(404).json({
          success: false,
          message: 'No location data found for this device'
        });
        return;
      }

      res.json({
        success: true,
        data: {
          deviceId: id,
          longitude: latestLocation.longitude,
          latitude: latestLocation.latitude,
          altitude: latestLocation.altitude,
          speed: latestLocation.speed,
          direction: latestLocation.direction,
          timestamp: latestLocation.timestamp
        }
      });
    } catch (error) {
      console.error('Error fetching device location:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch device location',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  },

  async getDeviceHistory(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const { start, end, page = '1', limit = '100' } = req.query;

      const device = await Device.findOne({ deviceId: id }).lean();
      if (!device) {
        res.status(404).json({
          success: false,
          message: 'Device not found'
        });
        return;
      }

      const filter: any = { deviceId: id };
      if (start || end) {
        filter.timestamp = {};
        if (start) filter.timestamp.$gte = new Date(start as string);
        if (end) filter.timestamp.$lte = new Date(end as string);
      }

      const pageNum = Math.max(1, parseInt(page as string));
      const limitNum = Math.min(1000, Math.max(1, parseInt(limit as string)));
      const skip = (pageNum - 1) * limitNum;

      const total = await Location.countDocuments(filter);
      const history = await Location.find(filter)
        .sort({ timestamp: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean();

      res.json({
        success: true,
        data: history.map((loc) => ({
          deviceId: loc.deviceId,
          longitude: loc.longitude,
          latitude: loc.latitude,
          altitude: loc.altitude,
          speed: loc.speed,
          direction: loc.direction,
          timestamp: loc.timestamp
        })),
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum)
        }
      });
    } catch (error) {
      console.error('Error fetching device history:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch device history',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  },

  async getDeviceRoute(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const { start, end } = req.query;

      const device = await Device.findOne({ deviceId: id }).lean();
      if (!device) {
        res.status(404).json({
          success: false,
          message: 'Device not found'
        });
        return;
      }

      const filter: any = { deviceId: id };
      if (start || end) {
        filter.timestamp = {};
        if (start) filter.timestamp.$gte = new Date(start as string);
        if (end) filter.timestamp.$lte = new Date(end as string);
      }

      const locations = await Location.find(filter)
        .sort({ timestamp: 1 })
        .lean();

      if (locations.length === 0) {
        res.status(404).json({
          success: false,
          message: 'No route data found for the specified time range'
        });
        return;
      }

      const coordinates: number[][] = locations.map((loc) => [
        loc.longitude,
        loc.latitude
      ]);

      let coords = deduplicateCoordinates(coordinates);
      const tolerance = req.query.tolerance ? parseFloat(req.query.tolerance as string) : 0.0001;
      if (!isNaN(tolerance) && tolerance >= 0) {
        coords = douglasPeucker(coords, tolerance);
      }
      const simplified = coords.length < coordinates.length;

      const lineString = {
        type: 'LineString',
        coordinates: coords
      };

      res.json({
        success: true,
        data: {
          deviceId: id,
          type: 'Feature',
          geometry: lineString,
          properties: {
            pointCount: coords.length,
            startTime: locations[0].timestamp,
            endTime: locations[locations.length - 1].timestamp,
            totalDistance: calculateTotalDistance(coords),
            deduplicated: coordinates.length - coords.length,
            simplified,
            originalPointCount: coordinates.length
          }
        }
      });
    } catch (error) {
      console.error('Error fetching device route:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch device route',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
};

function calculateTotalDistance(coordinates: number[][]): number {
  let totalDistance = 0;

  for (let i = 1; i < coordinates.length; i++) {
    const [lon1, lat1] = coordinates[i - 1];
    const [lon2, lat2] = coordinates[i];
    totalDistance += haversineDistance(lat1, lon1, lat2, lon2);
  }

  return Math.round(totalDistance * 100) / 100;
}

function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRad(value: number): number {
  return (value * Math.PI) / 180;
}
function deduplicateCoordinates(coords: number[][]): number[][] {
  if (coords.length < 2) return coords;
  const result = [coords[0]];
  for (let i = 1; i < coords.length; i++) {
    const [lon1, lat1] = result[result.length - 1];
    const [lon2, lat2] = coords[i];
    if (lon1 !== lon2 || lat1 !== lat2) result.push(coords[i]);
  }
  return result;
}

function perpendicularDistance(point: number[], lineStart: number[], lineEnd: number[]): number {
  const [x, y] = point;
  const [x1, y1] = lineStart;
  const [x2, y2] = lineEnd;
  if (x1 === x2 && y1 === y2) {
    const dx = x - x1, dy = y - y1;
    return Math.sqrt(dx * dx + dy * dy);
  }
  const dx = x2 - x1, dy = y2 - y1;
  const num = Math.abs(dy * x - dx * y + x2 * y1 - y2 * x1);
  const den = Math.sqrt(dy * dy + dx * dx);
  return num / den;
}

function douglasPeucker(coords: number[][], tolerance: number): number[][] {
  if (coords.length < 3) return coords;
  let maxDist = 0, index = 0;
  for (let i = 1; i < coords.length - 1; i++) {
    const dist = perpendicularDistance(coords[i], coords[0], coords[coords.length - 1]);
    if (dist > maxDist) { maxDist = dist; index = i; }
  }
  if (maxDist > tolerance) {
    const left = douglasPeucker(coords.slice(0, index + 1), tolerance);
    const right = douglasPeucker(coords.slice(index), tolerance);
    return left.slice(0, -1).concat(right);
  }
  return [coords[0], coords[coords.length - 1]];
}

