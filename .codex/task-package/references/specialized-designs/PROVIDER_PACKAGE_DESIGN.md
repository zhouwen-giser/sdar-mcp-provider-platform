# Provider Package Registry Design

Provider Package 是仓库内置、版本锁定的描述，不是在线插件市场。字段至少包括 packageId、version、providerType、hostingModes、adapter entry、config schema、migration set、compatible runtime、qualification、test commands。

初始包：UGV、NPC Tank、Home Assistant Climate。Mock Device/MQTT Publisher 仅为 fixtures，不能出现在生产 Provider Package 列表。

`vendor_managed` 是生产默认；`platform_managed` 只用于内置演示、受控部署或明确选择。
