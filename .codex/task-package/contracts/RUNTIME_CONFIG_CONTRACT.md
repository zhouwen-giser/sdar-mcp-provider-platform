# Runtime Config Contract

Runtime 获取 Published Effective Config：身份字段、revision、checksum、generatedAt、config groups、restart requirements，不包含明文 Secret。支持 `If-None-Match` 和 304。Ack：instanceId、deploymentId、revision、status、activeRevision、checksum、appliedAt、errorCode/details。status 为 applied/rejected/restart_required/stale/unavailable。
