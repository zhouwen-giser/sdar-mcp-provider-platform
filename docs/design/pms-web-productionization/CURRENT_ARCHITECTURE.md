# Current Architecture

原型由 `App.tsx`、自研 Router、集中式 Mock DataSource、页面 Feature 与原型操作引擎组成。其优势是业务原型覆盖广、场景数据集中、五条流程已有可点击基础。主要工程缺陷是页面分发集中、路由不具备正式错误边界和嵌套语义、Query 状态自维护、DataSource 领域边界不清、生产模式与原型模式隔离不足。
