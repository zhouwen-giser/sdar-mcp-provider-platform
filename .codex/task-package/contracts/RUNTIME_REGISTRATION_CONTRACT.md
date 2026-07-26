# Runtime Registration and Heartbeat Contract

注册/心跳包含 providerId、deploymentId、instanceId、runtimeVersion、protocolMode、endpoint、configRevision、readiness、startedAt。PMS Provider ID、Bootstrap PROVIDER_ID、Adapter Manifest providerId 必须相同。注册不创建新的 Provider 身份，只更新预期 Deployment 下的实际实例。
