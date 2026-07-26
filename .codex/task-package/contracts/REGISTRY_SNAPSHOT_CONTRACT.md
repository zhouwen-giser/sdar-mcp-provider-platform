# Registry Snapshot Contract

按 environment 发布 provider/server projection：providerId/serverId、protocolMode、effectiveEndpoint、catalogRevision、tool projection、可选 resource binding。排除 Secret、PM2、内部 PID/端口映射、Task 数据和测试资格。相同 checksum 不创建 revision；支持 latest/history/diff/watch/bootstrap 和 ETag。
