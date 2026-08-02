# PMS Web 产品设计

PMS Web 是 SMPP Provider 生命周期、Runtime 运行治理、配置与 Registry 发布的控制面前端。原型只访问 `PmsWebDataSource`，不直接访问 Runtime、PM2、数据库或 Secret 后端。核心链路统一为 Subject → Operation → Worker Job → Observed State → Audit/Incident。
