import swaggerJsdoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';
import { Express } from 'express';
import { config } from './config';

const swaggerOptions: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: '物流实时位置追踪服务 API',
      version: '1.0.0',
      description: `
物流系统实时位置追踪服务 API 文档

## 功能特性
- 设备通过 WebSocket 上报 GPS 坐标
- MongoDB 2dsphere 索引支持地理空间查询
- 地理围栏告警（进入/离开）
- 历史轨迹查询与 GeoJSON 路线生成
- 实时 WebSocket 推送

## WebSocket 接口

### 连接地址
\`ws://host:port\`

### 设备事件
- \`device:register\` - 设备注册
  \`\`\`json
  { "deviceId": "dev001", "name": "卡车A", "type": "truck" }
  \`\`\`
- \`device:location\` - 上报位置
  \`\`\`json
  {
    "deviceId": "dev001",
    "longitude": 116.4074,
    "latitude": 39.9042,
    "altitude": 0,
    "speed": 60,
    "direction": 90,
    "timestamp": 1700000000000
  }
  \`\`\`
- \`device:ping\` - 心跳保活
  \`\`\`json
  { "deviceId": "dev001" }
  \`\`\`

### 客户端事件
- \`client:subscribe\` - 订阅房间（可接收指定设备/围栏更新）
  \`\`\`json
  "device:dev001" 或 ["device:dev001", "geofence:gf001"]
  \`\`\`

### 服务端推送事件
- \`device:location:update\` - 设备位置更新
- \`device:registered\` - 设备注册成功
- \`device:status\` - 设备状态变更
- \`device:offline\` - 设备离线通知
- \`device:location:ack\` - 位置上报确认
- \`device:alert\` - 设备告警通知
- \`geofence:alert\` - 围栏告警通知
      `,
      contact: {
        name: 'API Support'
      }
    },
    servers: [
      {
        url: `http://localhost:${config.port}`,
        description: '开发服务器'
      }
    ],
    tags: [
      {
        name: 'Devices',
        description: '设备管理与位置追踪'
      },
      {
        name: 'Geofences',
        description: '地理围栏与告警管理'
      },
      {
        name: 'Alerts',
        description: '告警管理'
      }
    ],
    paths: {}
  },
  apis: ['./src/routes/*.ts']
};

const swaggerSpec = swaggerJsdoc(swaggerOptions);

export function setupSwagger(app: Express): void {
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
    explorer: true,
    customCss: '.swagger-ui .topbar { display: none }',
    customSiteTitle: '物流追踪 API 文档'
  }));

  app.get('/swagger.json', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(swaggerSpec);
  });
}

export { swaggerSpec };
