# Configuration Center Detailed Design

配置定义同时驱动 Zod、JSON Schema、PMS 表单元数据、默认值、Secret Paths、Apply Mode。生命周期：Draft → Validate → Publish → Pull/Watch → Stage → Apply → Ack → LKG。发布使用 canonical JSON + SHA-256；相同内容 no-op。

Runtime Client 需要 ETag/304、SSE revision hint、断线后 latest 恢复、原子本地写入、拒绝错误结构、LKG、restart_required。冷启动无需 PMS 在线。
