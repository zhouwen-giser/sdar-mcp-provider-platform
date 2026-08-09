# Architecture boundary review

- Status: **passed**

| Authority         | Responsibility                                                  |
| ----------------- | --------------------------------------------------------------- |
| PMS               | provider/config/deployment/catalog/registry/audit/desired state |
| MCP Tasks Runtime | Task/Command/Scheduler/Recovery/Notification/MCP data plane     |
| Provider Adapter  | Home Assistant connection/resource facts/side effects/safety    |
| Home Assistant    | actual climate/light state                                      |

- Frozen protocol changes: **none**
- Runtime/PMS Home Assistant imports: **none**
- Direct PMS Home Assistant calls: **none**
- Direct Runtime Home Assistant calls: **none**
- Runtime Task Authority preserved: **Runtime remains the Task Authority; no tasks/result call was introduced.**
