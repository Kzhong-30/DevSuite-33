import { Router } from "express";
import { alertController } from "../controllers/alertController";
const router = Router();

/**
 * @swagger
 * /api/alerts:
 *   get:
 *     summary: 获取告警列表
 *     tags: [Alerts]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
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
 *       - in: query
 *         name: deviceId
 *         schema:
 *           type: string
 *       - in: query
 *         name: read
 *         schema:
 *           type: string
 *           enum: ["true", "false"]
 *     responses:
 *       200:
 *         description: 告警列表
 */
router.get("/", alertController.list);

/**
 * @swagger
 * /api/alerts/{id}/read:
 *   patch:
 *     summary: 标记告警为已读
 *     tags: [Alerts]
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
 *         description: 标记成功
 *       400:
 *         description: 无效告警ID
 *       404:
 *         description: 告警不存在
 */
router.patch("/:id/read", alertController.markRead);

/**
 * @swagger
 * /api/alerts/batch-read:
 *   post:
 *     summary: 批量标记告警为已读
 *     tags: [Alerts]
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
 *     responses:
 *       200:
 *         description: 批量标记成功
 *       400:
 *         description: 参数错误
 */
router.post("/batch-read", alertController.markBatchRead);
export default router;
