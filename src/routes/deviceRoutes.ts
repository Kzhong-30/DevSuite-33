import { Router } from 'express';
import { deviceController } from '../controllers/deviceController';

const router = Router();

/**
 * @swagger
 * components:
 *   schemas:
 *     Location:
 *       type: object
 *       properties:
 *         deviceId:
 *           type: string
 *         longitude:
 *           type: number
 *         latitude:
 *           type: number
 *         altitude:
 *           type: number
 *         speed:
 *           type: number
 *         direction:
 *           type: number
 *         timestamp:
 *           type: string
 *           format: date-time
 *     Device:
 *       type: object
 *       properties:
 *         _id:
 *           type: string
 *         deviceId:
 *           type: string
 *         name:
 *           type: string
 *         type:
 *           type: string
 *         status:
 *           type: string
 *           enum: [online, offline]
 *         lastSeen:
 *           type: string
 *           format: date-time
 *         currentLocation:
 *           $ref: '#/components/schemas/Location'
 */

/**
 * @swagger
 * /devices:
 *   get:
 *     summary: 获取所有追踪设备列表
 *     tags: [Devices]
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [online, offline]
 *         description: 按状态筛选设备
 *     responses:
 *       200:
 *         description: 设备列表获取成功
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 count:
 *                   type: number
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Device'
 */
router.get('/', deviceController.getAllDevices);

/**
 * @swagger
 * /devices/{id}:
 *   get:
 *     summary: 获取单个设备信息
 *     tags: [Devices]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: 设备ID
 *     responses:
 *       200:
 *         description: 设备信息获取成功
 *       404:
 *         description: 设备不存在
 */
router.get('/:id', deviceController.getDevice);

/**
 * @swagger
 * /devices/{id}/location:
 *   get:
 *     summary: 获取设备最新位置
 *     tags: [Devices]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: 设备ID
 *     responses:
 *       200:
 *         description: 设备最新位置
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/Location'
 *       404:
 *         description: 设备或位置数据不存在
 */
router.get('/:id/location', deviceController.getDeviceLocation);

/**
 * @swagger
 * /devices/{id}/history:
 *   get:
 *     summary: 获取设备历史轨迹
 *     tags: [Devices]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: 设备ID
 *       - in: query
 *         name: start
 *         schema:
 *           type: string
 *           format: date-time
 *         description: 开始时间 (ISO格式)
 *       - in: query
 *         name: end
 *         schema:
 *           type: string
 *           format: date-time
 *         description: 结束时间 (ISO格式)
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
 *           default: 100
 *         description: 每页数量 (最大1000)
 *     responses:
 *       200:
 *         description: 历史轨迹数据
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
 *                     $ref: '#/components/schemas/Location'
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
 *         description: 设备不存在
 */
router.get('/:id/history', deviceController.getDeviceHistory);

/**
 * @swagger
 * /devices/{id}/route:
 *   get:
 *     summary: 获取两点间行驶路线 (GeoJSON LineString)
 *     tags: [Devices]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: 设备ID
 *       - in: query
 *         name: start
 *         schema:
 *           type: string
 *           format: date-time
 *         description: 开始时间 (ISO格式)
 *       - in: query
 *         name: end
 *         schema:
 *           type: string
 *           format: date-time
 *         description: 结束时间 (ISO格式)
 *     responses:
 *       200:
 *         description: 路线数据 (GeoJSON Feature)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     deviceId:
 *                       type: string
 *                     type:
 *                       type: string
 *                       enum: [Feature]
 *                     geometry:
 *                       type: object
 *                       properties:
 *                         type:
 *                           type: string
 *                           enum: [LineString]
 *                         coordinates:
 *                           type: array
 *                           items:
 *                             type: array
 *                             items:
 *                               type: number
 *                     properties:
 *                       type: object
 *                       properties:
 *                         pointCount:
 *                           type: integer
 *                         startTime:
 *                           type: string
 *                           format: date-time
 *                         endTime:
 *                           type: string
 *                           format: date-time
 *                         totalDistance:
 *                           type: number
 *       404:
 *         description: 设备或路线数据不存在
 */
router.get('/:id/route', deviceController.getDeviceRoute);

export default router;
