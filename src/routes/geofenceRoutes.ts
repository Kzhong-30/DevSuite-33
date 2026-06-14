import { Router } from 'express';
import { geofenceController } from '../controllers/geofenceController';

const router = Router();

/**
 * @swagger
 * components:
 *   schemas:
 *     Geofence:
 *       type: object
 *       properties:
 *         _id:
 *           type: string
 *         name:
 *           type: string
 *         description:
 *           type: string
 *         geofenceType:
 *           type: string
 *           enum: [circle, polygon]
 *         circular:
 *           type: object
 *           properties:
 *             center:
 *               type: object
 *               properties:
 *                 type:
 *                   type: string
 *                   enum: [Point]
 *                 coordinates:
 *                   type: array
 *                   items:
 *                     type: number
 *             radius:
 *               type: number
 *         polygon:
 *           type: object
 *           properties:
 *             geometry:
 *               type: object
 *               properties:
 *                 type:
 *                   type: string
 *                   enum: [Polygon]
 *                 coordinates:
 *                   type: array
 *                   items:
 *                     type: array
 *                     items:
 *                       type: array
 *                       items:
 *                         type: number
 *         alerts:
 *           type: array
 *           items:
 *             type: string
 *             enum: [enter, exit]
 *         enabled:
 *           type: boolean
 *         createdAt:
 *           type: string
 *           format: date-time
 *     Alert:
 *       type: object
 *       properties:
 *         _id:
 *           type: string
 *         geofenceId:
 *           type: string
 *         deviceId:
 *           type: string
 *         type:
 *           type: string
 *           enum: [enter, exit]
 *         message:
 *           type: string
 *         location:
 *           type: object
 *           properties:
 *             type:
 *               type: string
 *               enum: [Point]
 *             coordinates:
 *               type: array
 *               items:
 *                 type: number
 *         timestamp:
 *           type: string
 *           format: date-time
 *         read:
 *           type: boolean
 */

/**
 * @swagger
 * /geofences:
 *   post:
 *     summary: 创建地理围栏
 *     tags: [Geofences]
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - geofenceType
 *             properties:
 *               name:
 *                 type: string
 *               description:
 *                 type: string
 *               geofenceType:
 *                 type: string
 *                 enum: [circle, polygon]
 *               circular:
 *                 type: object
 *                 properties:
 *                   center:
 *                     type: array
 *                     items:
 *                       type: number
 *                     description: [longitude, latitude]
 *                   radius:
 *                     type: number
 *               polygon:
 *                 type: object
 *                 properties:
 *                   coordinates:
 *                     type: array
 *                     items:
 *                       type: array
 *                       items:
 *                         type: array
 *                         items:
 *                           type: number
 *               alerts:
 *                 type: array
 *                 items:
 *                   type: string
 *                   enum: [enter, exit]
 *               enabled:
 *                 type: boolean
 *     responses:
 *       201:
 *         description: 围栏创建成功
 *       400:
 *         description: 参数错误
 */
router.post('/', geofenceController.createGeofence);

/**
 * @swagger
 * /geofences:
 *   get:
 *     summary: 获取所有地理围栏
 *     tags: [Geofences]
 *     security:
 *       - ApiKeyAuth: []
 *     responses:
 *       200:
 *         description: 围栏列表
 */
router.get('/', geofenceController.getAllGeofences);

/**
 * @swagger
 * /api/geofences/{id}:
 *   get:
 *     summary: 获取单个地理围栏
 *     tags: [Geofences]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: 围栏信息
 *       404:
 *         description: 围栏不存在
 */
router.get('/:id', geofenceController.getGeofence);

/**
 * @swagger
 * /api/geofences/{id}/alerts:
 *   get:
 *     summary: 获取围栏告警列表
 *     tags: [Geofences]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *     responses:
 *       200:
 *         description: 告警列表
 */
router.get('/:id/alerts', geofenceController.getGeofenceAlerts);

/**
 * @swagger
 * /api/geofences/{id}/toggle:
 *   patch:
 *     summary: 启用/禁用地理围栏
 *     tags: [Geofences]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - enabled
 *             properties:
 *               enabled:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: 切换成功
 *       400:
 *         description: 参数错误
 *       404:
 *         description: 围栏不存在
 */
router.patch('/:id/toggle', geofenceController.toggleGeofence);

/**
 * @swagger
 * /api/geofences/{id}/alerts/{alertId}/read:
 *   patch:
 *     summary: 标记围栏告警为已读
 *     tags: [Geofences]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: 地理围栏ID
 *       - in: path
 *         name: alertId
 *         required: true
 *         schema:
 *           type: string
 *         description: 告警ID
 *     responses:
 *       200:
 *         description: 标记成功
 *       400:
 *         description: 参数错误
 *       404:
 *         description: 告警不存在
 */
router.patch('/:id/alerts/:alertId/read', geofenceController.markAlertRead);

/**
 * @swagger
 * /api/geofences/batch:
 *   post:
 *     summary: 批量创建地理围栏
 *     tags: [Geofences]
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - geofences
 *             properties:
 *               geofences:
 *                 type: array
 *                 items:
 *                   type: object
 *     responses:
 *       201:
 *         description: 批量创建成功
 */
router.post('/batch', geofenceController.batchCreateGeofences);

/**
 * @swagger
 * /api/geofences/batch/toggle:
 *   post:
 *     summary: 批量启用/禁用地理围栏
 *     tags: [Geofences]
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - ids
 *               - enabled
 *             properties:
 *               ids:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: 围栏ID数组
 *               enabled:
 *                 type: boolean
 *                 description: 是否启用
 *     responses:
 *       200:
 *         description: 批量操作成功
 *       400:
 *         description: 参数错误
 */
router.post('/batch/toggle', geofenceController.batchToggleGeofences);

/**
 * @swagger
 * /api/geofences/batch/delete:
 *   post:
 *     summary: 批量删除地理围栏
 *     tags: [Geofences]
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - ids
 *             properties:
 *               ids:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: 围栏ID数组
 *     responses:
 *       200:
 *         description: 批量删除成功
 *       400:
 *         description: 参数错误
 */
router.post('/batch/delete', geofenceController.batchDeleteGeofences);

export default router;
