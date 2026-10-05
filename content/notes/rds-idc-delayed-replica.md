---
{"title":"RDS 备份恢复到 IDC：建立延迟 4 小时的 MySQL 从库","category":"数据与可靠性","kind":"实践笔记","date":"2026-10-05","summary":"下载阿里云 RDS MySQL 物理备份，在 IDC 恢复一致性基线，核对 GTID 后接续复制并设置 14400 秒延迟，覆盖日志保留、TLS、验收和误操作后的冻结流程。","tags":["阿里云 RDS","MySQL","备份恢复","延迟复制","IDC"]}
---
延迟从库把源库的新事务先接收到 IDC，再延后执行，为发现误删、误更新争取处置时间。本文以 RDS MySQL 8.0、高可用系列、高性能本地盘的全实例物理备份为主线，目标为全新、专用的 IDC MySQL 8.0.26 或更新的兼容 8.0 小版本。两端已启用 GTID，目标与源库的版本、数据格式和插件已经验证兼容。资料核对于 2026-10-05；本文只提供通用步骤，没有下载实际备份或操作任何数据库。

## 01 / 确认备份类型与 4 小时延迟的含义

先在 RDS 基本信息页确认引擎、版本、实例系列和存储类型。本文的物理恢复步骤仅用于满足条件的 MySQL 本地盘实例；不能直接套用于 PostgreSQL、SQL Server、MySQL 8.4 或云盘快照。[RDS 物理备份恢复条件](https://help.aliyun.com/zh/rds/apsaradb-rds-for-mysql/restore-the-data-of-an-apsaradb-rds-for-mysql-instance-from-a-physical-backup-file-to-a-self-managed-mysql-database)。

云盘快照的高级下载可以导出 CSV / SQL，恢复方式、对象覆盖和字段限制均不同；下载页若提供其他格式，也需按该格式的官方恢复方案核对，不能直接套用下面两个本地盘解包分支。仅有数据文件导出，不足以证明拥有一致的复制基线；还要取得与导出数据对应的完整 GTID 集或源端 Binlog 位点。拿不到这个对应关系时，先使用经过验证的一致性全量初始化方案，不能从源库“当前位点”开始拼接。DTS 的全量与实时增量同步也不会自动成为本文的 4 小时延迟通道。[快照备份恢复说明](https://help.aliyun.com/zh/rds/apsaradb-rds-for-mysql/restore-the-data-of-an-apsaradb-rds-for-mysql-instance-to-a-self-managed-mysql-instance-by-using-a-csv-file-or-an-sql-file/)。

```text
RDS MySQL primary / VPC 10.60.0.0/16
       |
       +-- Full backup --> secure transfer --> IDC restore baseline
       |
       +-- Private endpoint / TCP 3306 / TLS --> replica receiver
                                                    |
                                               relay logs
                                                    |
                                      applier: SOURCE_DELAY = 14400
                                                    |
                                    IDC replica: 10.20.10.30

Source endpoint: replace with the actual RDS primary private endpoint
Replica server_id: 203001 (example; must be unique)
Archive:  /srv/rds-restore/archive
Work:     /srv/rds-restore/work
Metadata: /srv/rds-restore/metadata
Datadir:  /srv/mysql-idc-delay
```

`14400` 秒等于 4 小时，是事务相对直接源库提交时间的最小执行延迟。接收线程继续拉日志，执行线程等待；实际落后可能因故障、积压或大事务超过 4 小时。它不保证数据库每时每刻恰好处于“四小时前”的状态，也不能撤销已包含在初始备份中的误操作。[MySQL 延迟复制](https://dev.mysql.com/doc/refman/8.0/en/replication-delayed.html)。

## 02 / 先打通网络、权限和日志保留

通过已验收的专线 / BGP 或其他受控私网路径访问 RDS 主实例的私网连接地址，核对 IDC 到 VPC 的去程与回程。RDS 白名单只加入实际看到的 IDC 来源地址；防火墙允许该来源访问 RDS 端口。使用主实例连接地址作为复制源，避免把读写分离代理或任意只读实例当作同一个 Binlog 来源。

在 RDS 上使用高权限账号创建专用复制账号。示例地址必须替换为 RDS 实际看到的来源 IP，密码占位符必须替换；先确认账号名称尚未使用。复制账号具有读取整个复制日志的能力，应专用并限制来源，不复用应用账号。[RDS 账号权限](https://help.aliyun.com/zh/rds/apsaradb-rds-for-mysql/account-permissions)。

```sql
CREATE USER 'idc_repl'@'10.20.10.30'
  IDENTIFIED BY 'REPLACE_WITH_REPLICATION_SECRET' REQUIRE SSL;
GRANT REPLICATION SLAVE, REPLICATION CLIENT ON *.*
  TO 'idc_repl'@'10.20.10.30';
SHOW GRANTS FOR 'idc_repl'@'10.20.10.30';
```

源库检查：

```sql
SELECT VERSION(), @@GLOBAL.server_id, @@GLOBAL.server_uuid,
       @@GLOBAL.gtid_mode, @@GLOBAL.enforce_gtid_consistency,
       @@GLOBAL.log_bin, @@GLOBAL.binlog_format;
SHOW MASTER STATUS;
SHOW BINARY LOGS;
```

GTID 主线要求 `gtid_mode=ON`、`enforce_gtid_consistency=ON` 且 Binlog 开启。修改源库参数应按现网变更流程处理，不能为套用教程直接修改运行中的复制拓扑。这里的当前状态用于盘点，不能替代备份自己的位点。

在 RDS“备份恢复 / 备份策略”中核对本地日志保留策略。需要在线 Binlog 覆盖备份基线到首次接入的时间，以及 `4 小时延迟 + 最长中断/重启恢复时间 + 余量`；例如评估后选择 72 小时只是容量规划示例，不是固定要求。还要检查空间占有率、文件数量和可用空间触发的清理规则，设置保留时长并不排除其他清理条件。[管理本地 Binlog](https://help.aliyun.com/zh/rds/apsaradb-rds-for-mysql/view-and-delete-the-binary-log-files-of-an-apsaradb-rds-for-mysql-instance)。

日志备份 / OSS 保留期与在线 Binlog 保留期分别核对。标准复制连接不会自动去 OSS 读取已清理的历史日志。缺少基线之后的日志时，应重新建立一致性基线或制定经过验证的离线补齐方案，不能跳到最新位点。

## 03 / 导出全量备份并安全传到 IDC

在 RDS 的备份恢复页选择已完成的全实例物理备份，记录备份集、起止时间、源实例、大小、加密状态和下载格式；需要时按维护计划手动创建全量备份。本文解包示例要求备份未加密；加密备份需按官方方案取得解密能力，TDE 还需验证目标的密钥和格式兼容性，不能用解压失败作为删除加密标记的理由。

下载链接是临时凭证，不写入 Git、网站内容、工单公开附件或命令历史。在 IDC 上使用允许访问的外网下载链接；专线能够访问 RDS 私网地址，不代表备份内网下载链接对 IDC 开放。官方内网下载条件是同地域、同 VPC 的 ECS；也可在满足条件的 ECS 下载后，通过已验收的安全通道传到 IDC。[下载备份](https://help.aliyun.com/zh/rds/apsaradb-rds-for-mysql/download-the-backup-files-of-an-apsaradb-rds-for-mysql-instance-download-the-backup-files-of-an-apsaradb-rds-for-mysql-instance)。

下面在 IDC 的 Bash 中交互输入从控制台取得的 HTTPS 下载链接。路径均为新建的恢复工作区；确认当前账号可写、curl 已安装、磁盘容量足够。示例假设备份后缀为 `_qp.xb`，其他格式要保留对应后缀。

```sh
umask 077
sudo install -d -m 700 -o "$USER" -g "$(id -gn)" \
  /srv/rds-restore/archive /srv/rds-restore/work /srv/rds-restore/metadata
cd /srv/rds-restore/archive
read -r -s -p 'Backup HTTPS download URL: ' RDS_BACKUP_URL
printf '\n'
printf 'url = "%s"\n' "$RDS_BACKUP_URL" | \
  curl --config - --fail --location --output backup_qp.xb
unset RDS_BACKUP_URL
sha256sum backup_qp.xb > backup_qp.xb.sha256
sha256sum -c backup_qp.xb.sha256
```

必须确认下载成功和文件完整后再解包。此处 SHA-256 用于记录与后续传输校验；自己计算的散列不是来源真实性证明。通过 ECS 中转时，在两端比较同一份校验记录，限制备份文件访问，原始文件保留独立副本。所有备份、日志、证书私钥和真实元数据都不得放进网站发布目录。

## 04 / 安装兼容工具并按格式解包

RDS MySQL 8.0 的 Redo 格式可能与普通开源 XtraBackup 不兼容，应从阿里云物理恢复文档选择匹配版本、操作系统和 CPU 架构的 RDS 工具，并先做实验恢复。不要把“同为 8.0”当作全部小版本和内核都兼容的保证。本文假设兼容工具位于 `/u01/xtrabackup80/bin/`，qpress 已从可信来源安装。

先检查版本，恢复工作目录应为空：

```sh
mysql --version
/u01/xtrabackup80/bin/xtrabackup --version
command -v qpress
df -h /srv/rds-restore /srv
```

`_qp.xb` 是先解 xbstream、再解文件压缩的格式，在 Bash 中执行：

```sh
set -o pipefail
/u01/xtrabackup80/bin/xbstream -x -v \
  -C /srv/rds-restore/work < /srv/rds-restore/archive/backup_qp.xb
/u01/xtrabackup80/bin/xtrabackup --decompress \
  --target-dir=/srv/rds-restore/work
```

若实际文件为 `_xb.qp`，则用下面的分支，不能对同一工作目录连续执行两个分支：

```sh
set -o pipefail
qpress -do /srv/rds-restore/archive/backup_xb.qp | \
  /u01/xtrabackup80/bin/xbstream -x -v -C /srv/rds-restore/work
```

两个分支的压缩顺序不同。解包或解压有错误时停止，不把部分输出当作完整备份；原始包保留，重试使用新的空工作区。

## 05 / 保存一致性位点，再 prepare

保留 `backup-my.cnf`、`xtrabackup_checkpoints`、`xtrabackup_binlog_info`、`xtrabackup_slave_info`（若存在）及恢复日志，不直接执行元数据文件中的 SQL。先确认备份类型为完整基线，再运行 prepare，检查退出状态和成功结束信息。

```sh
cd /srv/rds-restore/work
for f in backup-my.cnf xtrabackup_checkpoints xtrabackup_binlog_info xtrabackup_slave_info; do
  if [ -f "$f" ]; then
    cp -p -- "$f" /srv/rds-restore/metadata/
  fi
done
cat xtrabackup_checkpoints
cat xtrabackup_binlog_info
/u01/xtrabackup80/bin/xtrabackup \
  --defaults-file=/srv/rds-restore/work/backup-my.cnf \
  --prepare --target-dir=/srv/rds-restore/work
```

`xtrabackup_binlog_info` 可能包含文件名、位置与 GTID 集。备份若在备节点生成，其本地 Binlog 文件位点不一定属于你将连接的 RDS 主实例；应结合备份来源与 `xtrabackup_slave_info` 确认上游位点。GTID 也必须与这份已恢复数据对应，不能拿备份完成后查询到的源库最新集合替代。[XtraBackup 复制基线与位点](https://docs.percona.com/percona-xtrabackup/8.0/set-up-replication.html)。

不能确认位点归属或完整 GTID 集时，先停止复制接入，重新取得可核验的基线。不要以“SQL 执行成功”作为这一步正确的证据。

## 06 / 恢复到专用数据目录

目标是全新的专用实例。确认已停止目标 mysqld，数据目录为空；已有实例须先完成备份和独立恢复规划，不删除原目录来腾位置。[XtraBackup 恢复前提](https://docs.percona.com/percona-xtrabackup/8.0/restore-a-backup.html)。

本文使用 `/etc/my.cnf` 和 `mysqld` 服务名，实际需根据安装方式替换。在目标配置中合并以下设置，并匹配源库的 `lower_case_table_names`、`innodb_page_size`、字符集、排序规则和必要插件；不要整份复制 RDS 内部配置。容量参数按 IDC 主机配置。

```conf
[mysqld]
datadir=/srv/mysql-idc-delay
socket=/srv/mysql-idc-delay/mysql.sock
pid-file=/srv/mysql-idc-delay/mysqld.pid
log-error=/srv/mysql-idc-delay/error.log
bind-address=10.20.10.30
port=3306
server-id=203001
gtid-mode=ON
enforce-gtid-consistency=ON
log-bin=idc-bin
log-replica-updates=ON
binlog-format=ROW
relay-log=idc-relay
relay-log-recovery=ON
relay-log-purge=ON
sync-binlog=1
innodb-flush-log-at-trx-commit=1
skip-replica-start=ON
event-scheduler=OFF
read-only=ON
super-read-only=ON
replica-parallel-workers=1
```

这里使用一个执行 worker，便于核验事务顺序与恢复边界。吞吐不足时另行测试并行配置，不能靠取消延迟解决积压。恢复前核实服务使用的配置和目录：

```sh
sudo systemctl cat mysqld
sudo systemctl stop mysqld
sudo install -d -m 750 -o mysql -g mysql /srv/mysql-idc-delay
sudo /u01/xtrabackup80/bin/xtrabackup --defaults-file=/etc/my.cnf \
  --copy-back --target-dir=/srv/rds-restore/work
sudo chown -R mysql:mysql /srv/mysql-idc-delay
```

为新 IDC 实例设置唯一 `server_id`，并确保 `server_uuid` 与源库不同。如果恢复副本中有源库的 `auto.cnf`，在首次启动前把该文件从这个新目录移到受控元数据目录，让 mysqld 自行生成新 UUID；不要手写 UUID，也不要修改源库文件。[MySQL 实例标识](https://dev.mysql.com/doc/refman/8.0/en/replication-options.html)。

同样检查恢复副本中的 `mysqld-auto.cnf`：其中源库持久化参数可能覆盖新配置，需先留存并评审，避免带入 IDC。针对新目录配置 SELinux / AppArmor 和服务路径权限；启动失败时读取错误日志，不能关闭访问控制作为默认修复。

## 07 / 首次启动时建立本地管理入口

物理备份可能包含 RDS 的账号和复制元数据，IDC 不能默认使用安装时的旧 root 密码。若没有已验证的本地管理账号，在这个新建、隔离的 IDC 实例上使用一次性 init-file 创建仅本机可用的管理员。先确认 `idc_admin` 不在备份中，文件只允许 mysqld 和管理员访问。

保存下面 SQL 到 `/srv/mysql-bootstrap/init.sql`，目录和文件均由 mysql 拥有，目录权限 700、文件权限 600，替换密码占位符。每条语句保持一行，初始化期间不记录本地账号变更的 Binlog：

```sql
SET GLOBAL super_read_only=OFF;
SET GLOBAL read_only=OFF;
SET SESSION sql_log_bin=0;
CREATE USER 'idc_admin'@'localhost' IDENTIFIED BY 'REPLACE_WITH_LOCAL_ADMIN_SECRET';
GRANT ALL PRIVILEGES ON *.* TO 'idc_admin'@'localhost' WITH GRANT OPTION;
SET GLOBAL read_only=ON;
SET GLOBAL super_read_only=ON;
```

首次启动时，在目标 `[mysqld]` 配置中临时加入以下两项；不打开客户端网络监听：

```conf
skip-networking=ON
init-file=/srv/mysql-bootstrap/init.sql
```

启动并通过本地 socket 验证管理员和只读状态。密码交互输入，包含凭证的 SQL 不进入客户端历史：

```sh
sudo systemctl start mysqld
MYSQL_HISTFILE=/dev/null mysql --protocol=SOCKET \
  --socket=/srv/mysql-idc-delay/mysql.sock -u idc_admin -p
```

成功后停止该新实例，移除临时 `init-file` / `skip-networking` 两项并安全删除一次性凭证文件，再正常启动。保留 `skip-replica-start=ON`、事件调度器关闭和两项只读设置。云上复制账号与 IDC 管理账号分开使用；这一步只用于本地恢复初始化，不应在 RDS 上执行。[MySQL init-file 启动机制](https://dev.mysql.com/doc/refman/8.0/en/resetting-permissions.html)。

## 08 / 清理继承通道并核验 GTID

在新 IDC 实例上先执行 `SHOW REPLICA STATUS\G`，检查继承的通道。本例仅使用一个默认通道；发现多源或特殊通道时，先逐个确认来源和处理方式。只有在确认这是新恢复副本、旧连接不应使用且元数据已留存时，清理继承状态：

```sql
STOP REPLICA;
RESET REPLICA ALL;
SELECT @@GLOBAL.server_id, @@GLOBAL.server_uuid,
       @@GLOBAL.gtid_executed, @@GLOBAL.gtid_purged,
       @@GLOBAL.read_only, @@GLOBAL.super_read_only;
```

该操作会移除复制连接和 relay logs，并把延迟重置为 0，随后必须重新配置；它不能作为已有延迟从库的日常排障命令。不要使用 `RESET MASTER` 清空 GTID 来掩盖基线问题。

在 IDC 中把占位符替换为第 05 节已确认的完整备份 GTID 集，以下检查是人工判断的门槛，不是自动放行脚本：

```sql
SET @backup_gtids='REPLACE_WITH_BACKUP_GTID_SET';
SELECT GTID_SUBSET(@@GLOBAL.gtid_executed, @backup_gtids)
       AS restored_gtids_belong_to_backup,
       GTID_SUBTRACT(@backup_gtids, @@GLOBAL.gtid_executed)
       AS missing_backup_gtids;
```

第一项必须为 1，否则先查本地写入、备份选择或元数据来源。只有确认物理数据已经包含完整备份事务、复制未启动且没有本地业务写入时，才可补登记缺失的备份 GTID；若缺失集合为空则跳过：

```sql
SET @missing_backup_gtids=GTID_SUBTRACT(@backup_gtids, @@GLOBAL.gtid_executed);
SET @@GLOBAL.gtid_purged=CONCAT('+', @missing_backup_gtids);
SELECT GTID_SUBTRACT(@backup_gtids, @@GLOBAL.gtid_executed)
       AS must_be_empty;
```

这是登记已恢复事务的历史，不会补回缺失数据；数据基线不完整时不能使用。加号只追加尚未执行的 GTID，不重复加入已有集合。[GTID_PURGED 规则](https://dev.mysql.com/doc/refman/8.0/en/replication-options-gtids.html)。

再在 RDS 上将同一个备份集合与当前 `gtid_purged` 比较。下列结果必须为空，确保源库已清理的历史都在基线中：

```sql
SELECT GTID_SUBTRACT(@@GLOBAL.gtid_purged, 'REPLACE_WITH_BACKUP_GTID_SET')
       AS purged_transactions_missing_from_backup;
```

GTID 自动定位不能找回已清理且 IDC 还没拥有的事务，遇到这种情况要补齐可验证历史或重建基线。[GTID 自动定位](https://dev.mysql.com/doc/refman/8.0/en/replication-gtids-auto-positioning.html)。

## 09 / 配置 TLS 与 14400 秒延迟

源库先按维护计划开启对应主实例连接地址的 SSL，下载 CA 到 IDC。安装于 `/etc/mysql/rds-ca.pem` 并允许 mysqld 读取。使用证书覆盖的真实 RDS 连接主机名；示例 `rds-source.example.com` 仅是占位符，不能直接使用不匹配证书的自定义别名。[RDS SSL 连接](https://help.aliyun.com/zh/rds/apsaradb-rds-for-mysql/ssl-connect-to-the-rds-mysql-database/)。

从 IDC 测试专用复制账号的网络、白名单与 TLS 身份校验：

```sh
mysql --host=rds-source.example.com --port=3306 -u idc_repl -p \
  --ssl-mode=VERIFY_IDENTITY --ssl-ca=/etc/mysql/rds-ca.pem \
  -e "SHOW SESSION STATUS LIKE 'Ssl_cipher';"
```

在 IDC 本地管理会话中配置默认复制通道，替换真实源地址、端口与密码。源库和目标均使用 GTID，且前述基线检查已通过：

```sql
CHANGE REPLICATION SOURCE TO
  SOURCE_HOST='rds-source.example.com',
  SOURCE_PORT=3306,
  SOURCE_USER='idc_repl',
  SOURCE_PASSWORD='REPLACE_WITH_REPLICATION_SECRET',
  SOURCE_AUTO_POSITION=1,
  SOURCE_DELAY=14400,
  SOURCE_SSL=1,
  SOURCE_SSL_CA='/etc/mysql/rds-ca.pem',
  SOURCE_SSL_VERIFY_SERVER_CERT=1;
START REPLICA;
SHOW REPLICA STATUS\G
```

`SOURCE_DELAY` 是通道元数据，不是在 `my.cnf` 中写一个同名参数。先配置 14400，再启动复制，避免先追到最新再声称拥有 4 小时保护窗口。[CHANGE REPLICATION SOURCE TO](https://dev.mysql.com/doc/refman/8.0/en/change-replication-source-to.html)。

若经验证必须使用文件位点复制，则以与恢复数据一致、确实属于当前源端的文件名 / 位置替换自动定位项，使用 `SOURCE_AUTO_POSITION=0`、`SOURCE_LOG_FILE`、`SOURCE_LOG_POS`，保留相同延迟与 TLS 设置；两种定位方案不能混填。MySQL 5.7 及较早 8.0 使用 `CHANGE MASTER TO ... MASTER_DELAY=14400` 等旧语法，也需要重新核对恢复工具与参数名称，不能照搬本文整套配置。

## 10 / 验收复制状态与实际延迟

检查 `SHOW REPLICA STATUS\G` 中接收、执行线程均正常，`Last_IO_Error` 与 `Last_SQL_Error` 为空，源地址正确、`Auto_Position=1`、`SQL_Delay=14400`。等待延迟期间的运行状态应符合预期；空闲时 `SQL_Remaining_Delay` 可能为 NULL。不要只用 `Seconds_Behind_Source` 判断健康，也不要要求它总是等于 14400。

```sql
SELECT CHANNEL_NAME, DESIRED_DELAY
FROM performance_schema.replication_applier_configuration;
SELECT CHANNEL_NAME, SERVICE_STATE, REMAINING_DELAY
FROM performance_schema.replication_applier_status;
SELECT CHANNEL_NAME, SERVICE_STATE, LAST_ERROR_NUMBER, LAST_ERROR_MESSAGE
FROM performance_schema.replication_connection_status;
SELECT CHANNEL_NAME, WORKER_ID, LAST_ERROR_NUMBER, LAST_ERROR_MESSAGE
FROM performance_schema.replication_applier_status_by_worker;
```

在实验环境或已批准的源库专用测试库中写入唯一标记，记录提交时间或提交后确认的时间和 GTID。从库在该事务提交后的 4 小时内不应出现标记，达到等待时间且无额外积压后应出现；同时确认日志已经被接收。应用记录的写入时间不一定等于事务提交时间，大事务不能用语句开始时间测量延迟。

两端保持可靠时间同步，监控时间偏差。在相同备份基线 / 一致快照上核对表结构、关键行数和抽样内容；不能把当前 RDS 数据与四小时前的从库直接比较后宣称不一致。按维护计划验证一次目标重启：保留启动保护参数时需先检查延迟、GTID、错误和只读状态，再手动启动复制；经验证后可采用同样检查条件的自动启动流程。

连接报错先检查路由、白名单、账号来源与证书主机名；缺失已清理的 GTID 时重建基线或补齐可验证历史。执行线程遇到重复键、缺行、缺少插件或 RDS 专属对象时，停止并查明基线与兼容性原因，不能直接跳过事务来让状态变绿。

## 11 / 规划 relay log 空间与监控

延迟期间收到但未执行的日志要留在 IDC。容量至少覆盖 `峰值 Binlog 速率 × (14400 + 额外积压秒数)`，再加入事务峰值、恢复工作区、本地 Binlog、数据增长和余量。例如持续 10 MiB/s，仅 4 小时 relay logs 就约 141 GiB，不能只按压缩备份大小准备磁盘。

`relay_log_recovery=ON` 在重启恢复时可能重建 relay log 并重新请求未执行的事务，因此源库保留窗口要覆盖执行侧落后，不能因为接收线程已经追上就缩到很短。`relay_log_purge=ON` 只清理不再需要的文件；不要手动删除尚未执行的 relay logs。设置空间上限时，也要评估接收线程可能停止取日志的后果。[MySQL 从库恢复与日志设置](https://dev.mysql.com/doc/refman/8.0/en/replication-options-replica.html)。

告警覆盖：接收断连、执行报错、`DESIRED_DELAY` 偏离 14400、只读状态变化、执行侧超出目标的额外积压、relay log / 数据盘剩余空间、源 Binlog 最早可用位置、TLS 证书到期和最近一次恢复演练。复制故障时区分“有意等待”与“停止执行”，不能把正常的 4 小时等待当作普通从库高延迟告警。

## 12 / 误操作发生后先冻结，再恢复

发现误删 / 误更新后，立即在 IDC 停止执行线程，确认它确实停止并核对已执行 GTID。停止请求可能等待正在执行的事务结束，4 小时并非绝对保证；若错误已在基线中或已被执行，应使用更早的独立备份 / PITR。

```sql
STOP REPLICA SQL_THREAD;
SHOW REPLICA STATUS\G
SELECT @@GLOBAL.gtid_executed;
```

保留数据与复制元数据的可恢复副本，必要时在协调快照前停止接收线程；随后在隔离克隆环境定位错误事务。不要在唯一的延迟副本上直接设延迟为 0 或重置复制。通过已验证的事务边界恢复到错误之前，确认业务数据，再按审批后的数据修复方案回填。

如果确切知道首个错误事务的 GTID 且确认尚未执行，可在隔离恢复副本上使用 `START REPLICA SQL_THREAD UNTIL SQL_BEFORE_GTIDS='已确认的 GTID'` 等受控方法；只有验证无误后才考虑调整等待设置。GTID 数字次序不能替代真实日志顺序。[START REPLICA 的停止边界](https://dev.mysql.com/doc/refman/8.0/en/start-replica.html)。

延迟从库用于时间窗口保护，仍需独立、可验证恢复的备份。源库不可用时直接提升它，会接受至少计划延迟所对应的数据缺口；切换应根据已接收 / 已执行事务和业务允许的数据损失制定单独方案。

## 参考资料

- [阿里云：RDS 物理备份恢复到自建 MySQL](https://help.aliyun.com/zh/rds/apsaradb-rds-for-mysql/restore-the-data-of-an-apsaradb-rds-for-mysql-instance-from-a-physical-backup-file-to-a-self-managed-mysql-database)
- [阿里云：RDS 快照备份恢复到自建 MySQL](https://help.aliyun.com/zh/rds/apsaradb-rds-for-mysql/restore-the-data-of-an-apsaradb-rds-for-mysql-instance-to-a-self-managed-mysql-instance-by-using-a-csv-file-or-an-sql-file/)
- [阿里云：下载备份](https://help.aliyun.com/zh/rds/apsaradb-rds-for-mysql/download-the-backup-files-of-an-apsaradb-rds-for-mysql-instance-download-the-backup-files-of-an-apsaradb-rds-for-mysql-instance)
- [阿里云：账号权限](https://help.aliyun.com/zh/rds/apsaradb-rds-for-mysql/account-permissions)
- [阿里云：管理本地 Binlog](https://help.aliyun.com/zh/rds/apsaradb-rds-for-mysql/view-and-delete-the-binary-log-files-of-an-apsaradb-rds-for-mysql-instance)
- [阿里云：SSL 连接 RDS MySQL](https://help.aliyun.com/zh/rds/apsaradb-rds-for-mysql/ssl-connect-to-the-rds-mysql-database/)
- [Percona：使用 XtraBackup 建立复制基线](https://docs.percona.com/percona-xtrabackup/8.0/set-up-replication.html)
- [Percona：恢复物理备份](https://docs.percona.com/percona-xtrabackup/8.0/restore-a-backup.html)
- [MySQL：延迟复制](https://dev.mysql.com/doc/refman/8.0/en/replication-delayed.html)
- [MySQL：实例标识与复制选项](https://dev.mysql.com/doc/refman/8.0/en/replication-options.html)
- [MySQL：init-file 启动机制](https://dev.mysql.com/doc/refman/8.0/en/resetting-permissions.html)
- [MySQL：GTID 系统变量](https://dev.mysql.com/doc/refman/8.0/en/replication-options-gtids.html)
- [MySQL：GTID 自动定位](https://dev.mysql.com/doc/refman/8.0/en/replication-gtids-auto-positioning.html)
- [MySQL：CHANGE REPLICATION SOURCE TO](https://dev.mysql.com/doc/refman/8.0/en/change-replication-source-to.html)
- [MySQL：从库恢复与日志选项](https://dev.mysql.com/doc/refman/8.0/en/replication-options-replica.html)
- [MySQL：START REPLICA](https://dev.mysql.com/doc/refman/8.0/en/start-replica.html)
