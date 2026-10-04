---
{"title":"备份的验收标准，是一次成功的恢复","category":"数据与可靠性","kind":"实践笔记","date":"2026-10-04","summary":"以 PostgreSQL 逻辑备份为例，把备份完整性、恢复演练与 RPO / RTO 连成闭环。","tags":["PostgreSQL","备份","恢复演练"]}
---
备份任务显示成功，只能证明一次任务结束。还需要确认备份覆盖范围、可读取性、恢复耗时以及恢复后的业务一致性。本文是隔离测试环境中的逻辑备份示例，不替代生产备份方案。

## 01 / 先写明两个目标

- RPO：可接受丢失多久的数据，决定备份频率及是否需要连续日志归档。
- RTO：可接受恢复多久，决定恢复资源、流程与演练要求。

例如“最多丢失 15 分钟数据、2 小时内恢复”是一个目标示例。每日一次逻辑备份通常不能单独满足这样的 RPO，需要设计其他保护机制。

## 02 / 生成备份并验证文件可读取

假设本地测试数据库为 `demo`，已通过受控的 PostgreSQL 认证配置获得权限。不要把数据库密码写入脚本或提交到仓库。

```sh
umask 077
pg_dump --format=custom --file=demo.dump demo
pg_restore --list demo.dump
sha256sum demo.dump > demo.dump.sha256
sha256sum --check demo.dump.sha256
```

macOS 可使用 `shasum -a 256`。校验和发现文件字节变化，但不能证明数据完整或业务一致。`pg_dump` 处理单个数据库；角色、表空间、外部对象和密钥需另行纳入保护范围。确认客户端与服务端版本兼容。

## 03 / 在隔离环境真正恢复

下面操作会创建测试数据库并导入数据，仅在专用测试实例执行。运行前确认连接目标、可用磁盘和数据库名，不要指向生产实例。

```sh
createdb demo_restore_check
pg_restore --exit-on-error --single-transaction \
  --dbname=demo_restore_check demo.dump
```

恢复所需角色、扩展或权限缺失时，演练可能失败。应把这些前置条件记录成步骤，避免在事故时临时猜测。不要用忽略所有错误的方式让演练“通过”。

## 04 / 验证与演练记录

- 核对关键表数量、必要索引与应用关键查询，使用只读业务校验。
- 记录备份时间、恢复开始与结束、文件体积和错误信息。
- 验证备份所在账号或存储失效时是否仍能恢复，并按策略加密及限制访问。
- 定期演练，跟踪恢复速度与数据规模的变化，直到实际结果满足 RPO 和 RTO。

## 参考资料

- [PostgreSQL：SQL Dump](https://www.postgresql.org/docs/current/backup-dump.html)
- [PostgreSQL：pg_restore](https://www.postgresql.org/docs/current/app-pgrestore.html)
