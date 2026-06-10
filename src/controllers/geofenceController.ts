import { Request, Response } from 'express';
import { geofenceService } from '../services/geofenceService';
import { isValidObjectId } from 'mongoose';

export const geofenceController = {
  async createGeofence(req: Request, res: Response): Promise<void> {
    try {
      const { name, description, geofenceType, circular, polygon, alerts, enabled } = req.body;

      if (!name || !geofenceType) {
        res.status(400).json({
          success: false,
          message: 'name and geofenceType are required'
        });
        return;
      }

      if (!['circle', 'polygon'].includes(geofenceType)) {
        res.status(400).json({
          success: false,
          message: 'geofenceType must be either "circle" or "polygon"'
        });
        return;
      }

      if (geofenceType === 'circle') {
        if (!circular || !circular.center || !circular.radius) {
          res.status(400).json({
            success: false,
            message: 'circular with center and radius is required for circle type'
          });
          return;
        }
        if (!Array.isArray(circular.center) || circular.center.length !== 2) {
          res.status(400).json({
            success: false,
            message: 'center must be [longitude, latitude] array'
          });
          return;
        }
        if (circular.radius <= 0) {
          res.status(400).json({
            success: false,
            message: 'radius must be positive number'
          });
          return;
        }
      }

      if (geofenceType === 'polygon') {
        if (!polygon || !polygon.coordinates) {
          res.status(400).json({
            success: false,
            message: 'polygon with coordinates is required for polygon type'
          });
          return;
        }
        if (!Array.isArray(polygon.coordinates) || polygon.coordinates.length === 0) {
          res.status(400).json({
            success: false,
            message: 'polygon coordinates must be valid GeoJSON Polygon format'
          });
          return;
        }
      }

      if (alerts && (!Array.isArray(alerts) || !alerts.every((a: string) => ['enter', 'exit'].includes(a)))) {
        res.status(400).json({
          success: false,
          message: 'alerts must be array containing "enter" and/or "exit"'
        });
        return;
      }

      const geofence = await geofenceService.createGeofence({
        name,
        description,
        geofenceType,
        circular: circular ? { center: circular.center, radius: circular.radius } : undefined,
        polygon: polygon ? { coordinates: polygon.coordinates } : undefined,
        alerts,
        enabled
      });

      res.status(201).json({
        success: true,
        data: geofence
      });
    } catch (error) {
      console.error('Error creating geofence:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to create geofence',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  },

  async getAllGeofences(req: Request, res: Response): Promise<void> {
    try {
      const geofences = await geofenceService.getAllGeofences();
      res.json({
        success: true,
        count: geofences.length,
        data: geofences
      });
    } catch (error) {
      console.error('Error fetching geofences:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch geofences',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  },

  async getGeofence(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;

      if (!isValidObjectId(id)) {
        res.status(400).json({
          success: false,
          message: 'Invalid geofence ID'
        });
        return;
      }

      const geofence = await geofenceService.getGeofenceById(id);

      if (!geofence) {
        res.status(404).json({
          success: false,
          message: 'Geofence not found'
        });
        return;
      }

      res.json({
        success: true,
        data: geofence
      });
    } catch (error) {
      console.error('Error fetching geofence:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch geofence',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  },

  async getGeofenceAlerts(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const { page = '1', limit = '50' } = req.query;

      if (!isValidObjectId(id)) {
        res.status(400).json({
          success: false,
          message: 'Invalid geofence ID'
        });
        return;
      }

      const geofence = await geofenceService.getGeofenceById(id);
      if (!geofence) {
        res.status(404).json({
          success: false,
          message: 'Geofence not found'
        });
        return;
      }

      const pageNum = Math.max(1, parseInt(page as string));
      const limitNum = Math.min(200, Math.max(1, parseInt(limit as string)));

      const result = await geofenceService.getGeofenceAlerts(id, pageNum, limitNum);

      res.json({
        success: true,
        data: result.alerts,
        pagination: {
          page: result.page,
          limit: result.limit,
          total: result.total,
          totalPages: Math.ceil(result.total / result.limit)
        }
      });
    } catch (error) {
      console.error('Error fetching geofence alerts:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch geofence alerts',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
};
