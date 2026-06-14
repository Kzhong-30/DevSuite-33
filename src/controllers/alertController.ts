import { Request, Response } from 'express';
import { Alert } from '../models/Alert';
import { isValidObjectId } from 'mongoose';

export const alertController = {
  async list(req: Request, res: Response): Promise<void> {
    try {
      const { page = '1', limit = '50', deviceId, read } = req.query;
      const filter: any = {};
      if (deviceId) filter.deviceId = deviceId;
      if (read !== undefined) filter.read = read === 'true';
      const pageNum = Math.max(1, parseInt(page as string));
      const limitNum = Math.min(200, Math.max(1, parseInt(limit as string)));
      const skip = (pageNum - 1) * limitNum;
      const total = await Alert.countDocuments(filter);
      const alerts = await Alert.find(filter).sort({ timestamp: -1 }).skip(skip).limit(limitNum).lean();
      res.json({ success: true, data: alerts, pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) } });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Failed to fetch alerts' });
    }
  },
  async markRead(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      if (!isValidObjectId(id)) { res.status(400).json({ success: false, message: 'Invalid alert ID' }); return; }
      const alert = await Alert.findByIdAndUpdate(id, { read: true }, { new: true });
      if (!alert) { res.status(404).json({ success: false, message: 'Alert not found' }); return; }
      res.json({ success: true, data: alert });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Failed to mark alert as read' });
    }
  },
  async markBatchRead(req: Request, res: Response): Promise<void> {
    try {
      const { ids } = req.body;
      if (!Array.isArray(ids) || ids.length === 0) { res.status(400).json({ success: false, message: 'ids must be non-empty array' }); return; }
      const result = await Alert.updateMany({ _id: { $in: ids } }, { read: true });
      res.json({ success: true, data: { matched: result.matchedCount, modified: result.modifiedCount } });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Failed to mark alerts as read' });
    }
  }
};
