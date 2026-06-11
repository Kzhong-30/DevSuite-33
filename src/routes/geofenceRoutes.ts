import { Router } from 'express';
import { geofenceController } from '../controllers/geofenceController';

const router = Router();

/**
 * @swagger
 * components:
 *   schemas:
 *     Geofence:
 *       type: object
 *       required:
 *         - name
 *         - geofenceType
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
 *             type:
 *               type: string
 *               enum: [circle]
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
 *             type:
 *               type: string
 *               enum: [polygon]
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
 *         updatedAt:
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
 *           enum: [enter, exit, offline]
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
 *                     description: '[longitude, latitude]'
 *                   radius:
 *                     type: number
 *                     description: '半径(米)'
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
 *                     description: 'GeoJSON Polygon 坐标数组'
 *               alerts:
 *                 type: array
 *                 items:
 *                   type: string
 *                   enum: [enter, exit]
 *                 description: '触发告警的事件类型'
 *               enabled:
 *                 type: boolean
 *                 default: true
 *           examples:
 *             circleExample:
 *               summary: 圆形围栏示例
 *               value:
 *                 name: "仓库入口"
 *                 description: "主仓库入口区域"
 *                 geofenceType: "circle"
 *                 circular:
 *                   center: [116.4074, 39.9042]
 *                   radius: 500
 *                 alerts: ["enter", "exit"]
 *                 enabled: true
 *             polygonExample:
 *               summary: 多边形围栏示例
 *               value:
 *                 name: "配送区域A"
 *                 description: "城市A区配送范围"
 *                 geofenceType: "polygon"
 *                 polygon:
 *                   coordinates: [
 *                     [[116.40, 39.90], [116.42, 39.90], [116.42, 39.92], [116.40, 39.92], [116.40, 39.90]]
 *                   ]
 *                 alerts: ["enter", "exit"]
 *                 enabled: true
 *     responses:
 *       201:
 *         description: 地理围栏创建成功
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/Geofence'
 *       400:
 *         description: 请求参数错误
 */
router.post('/', geofenceController.createGeofence);

/**
 * @swagger
 * /geofences:
 *   get:
 *     summary: 获取所有地理围栏列表
 *     tags: [Geofences]
 *     responses:
 *       200:
 *         description: 地理围栏列表
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 count:
 *                   type: integer
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Geofence'
 */
router.get('/', geofenceController.getAllGeofences);

/**
 * @swagger
 * /geofences/{id}:
 *   get:
 *     summary: 获取单个地理围栏详情
 *     tags: [Geofences]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: 地理围栏ID
 *     responses:
 *       200:
 *         description: 地理围栏详情
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/Geofence'
 *       404:
 *         description: 地理围栏不存在
 */
router.get('/:id', geofenceController.getGeofence);

/**
 * @swagger
 * /geofences/{id}/alerts:
 *   get:
 *     summary: 获取围栏告警历史
 *     tags: [Geofences]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: 地理围栏ID
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: 页码
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *         description: 每页数量 (最大200)
 *     responses:
 *       200:
 *         description: 告警历史列表
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Alert'
 *                 pagination:
 *                   type: object
 *                   properties:
 *                     page:
 *                       type: integer
 *                     limit:
 *                       type: integer
 *                     total:
 *                       type: integer
 *                     totalPages:
 *                       type: integer
 *       404:
 *         description: 地理围栏不存在
 */
router.get('/:id/alerts', geofenceController.getGeofenceAlerts);
router.patch('/:id/toggle', geofenceController.toggleGeofence);

export default router;
