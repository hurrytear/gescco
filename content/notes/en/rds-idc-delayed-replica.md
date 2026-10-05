---
{"title":"Restore an RDS backup in an IDC: build a MySQL replica with a four-hour delay","category":"Data & reliability","kind":"Practical notes","date":"2026-10-05","summary":"Download an Alibaba Cloud RDS MySQL physical backup, restore a consistent baseline in an IDC, verify GTIDs and configure a 14400-second replication delay. Covers log retention, TLS, validation and freezing the replica after an accidental change.","tags":["Alibaba Cloud RDS","MySQL","Backup restore","Delayed replication","IDC"]}
---
A delayed replica receives new source transactions in the IDC before applying them later, providing time to respond to accidental deletes or updates. This guide uses a full-instance physical backup from an RDS MySQL 8.0 High-availability Edition instance with local SSD storage. The destination is a new, dedicated IDC MySQL instance running 8.0.26 or a newer compatible 8.0 patch release. GTIDs are enabled on both servers, and version, data-format and plugin compatibility have been verified. References were checked on 2026-10-05; no actual backup was downloaded and no database was operated.

## 01 / Identify the backup format and what a four-hour delay means

Check the engine, version, instance edition and storage type on the RDS instance details page. The physical restore steps here apply only to eligible MySQL instances with local SSD storage. They cannot be directly applied to PostgreSQL, SQL Server, MySQL 8.4 or cloud-disk snapshots.[RDS physical restore requirements](https://help.aliyun.com/zh/rds/apsaradb-rds-for-mysql/restore-the-data-of-an-apsaradb-rds-for-mysql-instance-from-a-physical-backup-file-to-a-self-managed-mysql-database).

Advanced downloads of cloud-disk snapshots can export CSV / SQL, with different restore procedures, object coverage and field limitations. If the download page offers another format, verify its own official restore procedure rather than using either local-disk extraction branch below. An exported data file alone does not establish a consistent replication baseline: it also needs a complete GTID set or source Binlog coordinates corresponding to that data. If those are unavailable, use a verified consistent full initialization method; do not join an old export to the source's current position. A DTS full load plus real-time incremental synchronization does not automatically create the four-hour delayed channel described here.[Snapshot restore guidance](https://help.aliyun.com/zh/rds/apsaradb-rds-for-mysql/restore-the-data-of-an-apsaradb-rds-for-mysql-instance-to-a-self-managed-mysql-instance-by-using-a-csv-file-or-an-sql-file/).

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

`14400` seconds is four hours: a minimum transaction apply delay measured relative to commit on the immediate source. The receiver keeps fetching logs while the applier waits. Failures, backlog or large transactions can increase actual lag beyond four hours. This does not guarantee an exact four-hours-ago database state at every moment, and it cannot undo an accidental change already included in the initial backup.[MySQL delayed replication](https://dev.mysql.com/doc/refman/8.0/en/replication-delayed.html).

## 02 / Prepare connectivity, permissions and log retention

Reach the RDS primary's private endpoint over an accepted private circuit / BGP connection or another controlled private network path. Verify routes in both directions between the IDC and VPC. Add only the IDC source addresses actually observed by RDS to its whitelist, and allow those sources through the firewall to the RDS port. Use the primary's endpoint as the replication source; do not treat a read/write proxy or an arbitrary read-only instance as the same Binlog source.

Use a privileged RDS account to create a dedicated replication account. Replace the example IP with the source IP actually seen by RDS and replace the password placeholder; first verify that the account name is unused. This account can read the full replication log, so restrict its source and keep it separate from application accounts.[RDS account permissions](https://help.aliyun.com/zh/rds/apsaradb-rds-for-mysql/account-permissions).

```sql
CREATE USER 'idc_repl'@'10.20.10.30'
  IDENTIFIED BY 'REPLACE_WITH_REPLICATION_SECRET' REQUIRE SSL;
GRANT REPLICATION SLAVE, REPLICATION CLIENT ON *.*
  TO 'idc_repl'@'10.20.10.30';
SHOW GRANTS FOR 'idc_repl'@'10.20.10.30';
```

Inspect the source:

```sql
SELECT VERSION(), @@GLOBAL.server_id, @@GLOBAL.server_uuid,
       @@GLOBAL.gtid_mode, @@GLOBAL.enforce_gtid_consistency,
       @@GLOBAL.log_bin, @@GLOBAL.binlog_format;
SHOW MASTER STATUS;
SHOW BINARY LOGS;
```

The GTID procedure requires `gtid_mode=ON`, `enforce_gtid_consistency=ON` and binary logging enabled. Follow the existing change process for source parameter changes; do not alter a running replication topology merely to match this guide. These current values inventory the source and do not replace the backup's own coordinates.

Check local log retention under the RDS backup settings. Online Binlogs must cover the interval from the backup baseline to the first connection, as well as `four-hour delay + maximum interruption/restart recovery time + margin`. Choosing 72 hours after assessment is only a capacity-planning example. Check additional purge conditions based on storage occupancy, file count and free space: a retention duration does not prevent other conditions from triggering cleanup.[Manage local Binlogs](https://help.aliyun.com/zh/rds/apsaradb-rds-for-mysql/view-and-delete-the-binary-log-files-of-an-apsaradb-rds-for-mysql-instance).

Verify archive / OSS retention separately from online Binlog retention. A standard replication connection does not automatically fetch historical logs from OSS after they have been purged. If logs after the baseline are missing, rebuild a consistent baseline or devise a verified offline recovery procedure; do not skip to the latest position.

## 03 / Export the full backup and transfer it securely to the IDC

Select a completed full-instance physical backup on the RDS backup page. Record the backup set, start and end times, source instance, size, encryption status and download format. Create a manual full backup under the maintenance plan if needed. The extraction examples require an unencrypted backup. For an encrypted backup, obtain decryption capability through the official procedure; TDE also requires verified destination key and format compatibility. An extraction failure is not a reason to remove encryption markers.

Download links are temporary credentials. Keep them out of Git, website content, public ticket attachments and command history. Use an authorized public download URL from the IDC. Reaching the RDS private endpoint over a circuit does not imply that the backup's internal download URL is accessible from the IDC. Official internal downloads require an ECS instance in the same region and VPC. Alternatively, download on an eligible ECS instance and transfer to the IDC over an accepted secure channel.[Download backups](https://help.aliyun.com/zh/rds/apsaradb-rds-for-mysql/download-the-backup-files-of-an-apsaradb-rds-for-mysql-instance-download-the-backup-files-of-an-apsaradb-rds-for-mysql-instance).

In Bash on the IDC host, enter the HTTPS URL obtained from the console interactively. These paths are newly created restore workspaces. Confirm that the current account can write them, curl is installed and disk space is sufficient. The example assumes a `_qp.xb` suffix; retain the corresponding suffix for other formats.

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

Confirm a successful download and a complete file before extraction. This SHA-256 records a checksum for later transfer verification; a self-computed hash does not establish authenticity. When staging through ECS, compare the same checksum record at both ends, restrict file access and keep an independent copy of the original archive. Backups, logs, certificate private keys and real metadata must stay outside the website's publication directory.

## 04 / Install compatible tools and extract the correct format

RDS MySQL 8.0 Redo formats can differ from those supported by a standard open-source XtraBackup build. Select the RDS-compatible tools for the version, operating system and CPU architecture from Alibaba Cloud's physical restore guidance, then test a restore first. Sharing an 8.0 major version does not guarantee compatibility across all patches and kernels. This guide assumes compatible tools under `/u01/xtrabackup80/bin/` and qpress installed from a trusted source.

Check versions first; the restore work directory must be empty:

```sh
mysql --version
/u01/xtrabackup80/bin/xtrabackup --version
command -v qpress
df -h /srv/rds-restore /srv
```

For `_qp.xb`, extract xbstream first, then decompress its files. Run in Bash:

```sh
set -o pipefail
/u01/xtrabackup80/bin/xbstream -x -v \
  -C /srv/rds-restore/work < /srv/rds-restore/archive/backup_qp.xb
/u01/xtrabackup80/bin/xtrabackup --decompress \
  --target-dir=/srv/rds-restore/work
```

If the actual file is `_xb.qp`, use this branch instead. Do not run both branches into the same work directory:

```sh
set -o pipefail
qpress -do /srv/rds-restore/archive/backup_xb.qp | \
  /u01/xtrabackup80/bin/xbstream -x -v -C /srv/rds-restore/work
```

The two formats use different compression orders. Stop on extraction or decompression errors; partial output is not a complete backup. Preserve the original archive and retry in a new empty workspace.

## 05 / Preserve consistent coordinates before preparing the backup

Preserve `backup-my.cnf`, `xtrabackup_checkpoints`, `xtrabackup_binlog_info`, `xtrabackup_slave_info` if present, and restore logs. Do not directly execute SQL found in metadata files. Confirm a complete baseline backup before running prepare, and check its exit status and successful completion message.

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

`xtrabackup_binlog_info` can contain a filename, position and GTID set. If the backup was taken on a standby, its local Binlog coordinates may not belong to the RDS primary you will connect to. Verify upstream coordinates using the backup origin and `xtrabackup_slave_info`. The GTID set must also correspond to this restored data; do not substitute the source's latest set queried after the backup.[XtraBackup replication baselines and coordinates](https://docs.percona.com/percona-xtrabackup/8.0/set-up-replication.html).

If the coordinate origin or complete GTID set cannot be verified, stop before connecting replication and obtain a verifiable baseline. Successful SQL execution alone does not prove correctness here.

## 06 / Restore into a dedicated data directory

The destination is a new, dedicated instance. Verify that its mysqld is stopped and its data directory is empty. An existing instance requires a backup and an independent restore plan; do not delete its directory to make room.[XtraBackup restore prerequisites](https://docs.percona.com/percona-xtrabackup/8.0/restore-a-backup.html).

This example uses `/etc/my.cnf` and the `mysqld` service name; adapt both to the installation. Merge these settings into the destination configuration, matching source `lower_case_table_names`, `innodb_page_size`, character sets, collations and required plugins. Do not copy the entire RDS internal configuration. Size memory and capacity parameters for the IDC host.

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

One applier worker makes transaction order and recovery boundaries easier to verify. Test parallel settings separately if throughput is insufficient; removing the delay is not a backlog remedy. Before restoring, verify the service's configuration and paths:

```sh
sudo systemctl cat mysqld
sudo systemctl stop mysqld
sudo install -d -m 750 -o mysql -g mysql /srv/mysql-idc-delay
sudo /u01/xtrabackup80/bin/xtrabackup --defaults-file=/etc/my.cnf \
  --copy-back --target-dir=/srv/rds-restore/work
sudo chown -R mysql:mysql /srv/mysql-idc-delay
```

Give the new IDC instance a unique `server_id` and a `server_uuid` different from the source. If the restored copy contains the source's `auto.cnf`, move that file from this new directory to the controlled metadata directory before first startup, allowing mysqld to generate a new UUID. Do not handwrite a UUID or change the source's file.[MySQL instance identities](https://dev.mysql.com/doc/refman/8.0/en/replication-options.html).

Also inspect the restored `mysqld-auto.cnf`: source persisted variables can override the new configuration. Preserve and review it before carrying settings into the IDC. Configure SELinux / AppArmor and service path permissions for the new directory. Read the error log if startup fails; disabling access controls is not the default remedy.

## 07 / Establish local administration on first startup

A physical backup can contain RDS accounts and replication metadata, so the IDC cannot assume the old installation's root password still works. If no local administration account has been verified, use a one-time init-file on this new, isolated IDC instance to create a localhost-only administrator. First verify that `idc_admin` is absent from the backup; allow only mysqld and administrators to access the file.

Save this SQL as `/srv/mysql-bootstrap/init.sql`. Both the directory and file must be owned by mysql, with directory mode 700 and file mode 600. Replace the password placeholder. Keep each statement on one line and avoid logging the local account changes to the Binlog during initialization:

```sql
SET GLOBAL super_read_only=OFF;
SET GLOBAL read_only=OFF;
SET SESSION sql_log_bin=0;
CREATE USER 'idc_admin'@'localhost' IDENTIFIED BY 'REPLACE_WITH_LOCAL_ADMIN_SECRET';
GRANT ALL PRIVILEGES ON *.* TO 'idc_admin'@'localhost' WITH GRANT OPTION;
SET GLOBAL read_only=ON;
SET GLOBAL super_read_only=ON;
```

Temporarily add these two options under the destination's `[mysqld]` for first startup, keeping client network listening disabled:

```conf
skip-networking=ON
init-file=/srv/mysql-bootstrap/init.sql
```

Start the server and verify the administrator and read-only settings over its local socket. Enter the password interactively; keep credential-bearing SQL out of client history:

```sh
sudo systemctl start mysqld
MYSQL_HISTFILE=/dev/null mysql --protocol=SOCKET \
  --socket=/srv/mysql-idc-delay/mysql.sock -u idc_admin -p
```

After success, stop this new instance, remove the temporary `init-file` / `skip-networking` options, securely delete the one-time credential file, and start normally. Retain `skip-replica-start=ON`, disabled event scheduling and both read-only settings. Keep the cloud replication account separate from the IDC administrator. This is local restore initialization; do not run it on RDS.[MySQL init-file startup mechanism](https://dev.mysql.com/doc/refman/8.0/en/resetting-permissions.html).

## 08 / Clear inherited channels and verify GTIDs

First run `SHOW REPLICA STATUS\G` on the new IDC instance and inspect inherited channels. This example uses one default channel. Identify the origin and required treatment of any multisource or special channels separately. Clear inherited state only after confirming this is a newly restored copy, old connections must not be used, and metadata has been preserved:

```sql
STOP REPLICA;
RESET REPLICA ALL;
SELECT @@GLOBAL.server_id, @@GLOBAL.server_uuid,
       @@GLOBAL.gtid_executed, @@GLOBAL.gtid_purged,
       @@GLOBAL.read_only, @@GLOBAL.super_read_only;
```

This removes replication connections and relay logs and resets the delay to zero, so it must be configured again afterward. It is not a routine troubleshooting command for an established delayed replica. Do not use `RESET MASTER` to erase GTIDs and conceal a baseline problem.

On the IDC, replace the placeholder with the complete backup GTID set verified in section 05. These checks require human assessment; they are not an automatic approval script:

```sql
SET @backup_gtids='REPLACE_WITH_BACKUP_GTID_SET';
SELECT GTID_SUBSET(@@GLOBAL.gtid_executed, @backup_gtids)
       AS restored_gtids_belong_to_backup,
       GTID_SUBTRACT(@backup_gtids, @@GLOBAL.gtid_executed)
       AS missing_backup_gtids;
```

The first value must be 1. Otherwise, investigate local writes, backup selection or metadata origin. Register missing backup GTIDs only after proving that the physical data contains all backup transactions, replication has not started and no local business writes have occurred. Skip this step if the missing set is empty:

```sql
SET @missing_backup_gtids=GTID_SUBTRACT(@backup_gtids, @@GLOBAL.gtid_executed);
SET @@GLOBAL.gtid_purged=CONCAT('+', @missing_backup_gtids);
SELECT GTID_SUBTRACT(@backup_gtids, @@GLOBAL.gtid_executed)
       AS must_be_empty;
```

This registers the history of already restored transactions; it does not restore missing data. Do not use it with an incomplete data baseline. The plus sign appends only GTIDs that have not been executed, without adding existing entries again.[GTID_PURGED rules](https://dev.mysql.com/doc/refman/8.0/en/replication-options-gtids.html).

Then compare the same backup set with the current `gtid_purged` on RDS. The following result must be empty, proving that the baseline includes the history already purged from the source:

```sql
SELECT GTID_SUBTRACT(@@GLOBAL.gtid_purged, 'REPLACE_WITH_BACKUP_GTID_SET')
       AS purged_transactions_missing_from_backup;
```

GTID auto-positioning cannot recover transactions already purged and absent from the IDC. Recover verifiable history or rebuild the baseline in that situation.[GTID auto-positioning](https://dev.mysql.com/doc/refman/8.0/en/replication-gtids-auto-positioning.html).

## 09 / Configure TLS and the 14400-second delay

Enable SSL for the corresponding primary endpoint under the source maintenance plan, and download its CA to the IDC. Install it at `/etc/mysql/rds-ca.pem` with mysqld read access. Use the actual RDS hostname covered by the certificate. `rds-source.example.com` is a placeholder; do not substitute a custom alias that fails certificate hostname verification.[RDS SSL connections](https://help.aliyun.com/zh/rds/apsaradb-rds-for-mysql/ssl-connect-to-the-rds-mysql-database/).

From the IDC, test connectivity, the whitelist and TLS identity verification with the dedicated replication account:

```sh
mysql --host=rds-source.example.com --port=3306 -u idc_repl -p \
  --ssl-mode=VERIFY_IDENTITY --ssl-ca=/etc/mysql/rds-ca.pem \
  -e "SHOW SESSION STATUS LIKE 'Ssl_cipher';"
```

Configure the default replication channel in an IDC local administration session, replacing the source address, port and password. Both servers must use GTIDs and all preceding baseline checks must have passed:

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

`SOURCE_DELAY` is channel metadata, not a same-named `my.cnf` parameter. Configure 14400 before starting replication. Catching up to the present first does not provide a four-hour protection window.[CHANGE REPLICATION SOURCE TO](https://dev.mysql.com/doc/refman/8.0/en/change-replication-source-to.html).

If verified file-position replication is necessary, replace auto-positioning with a filename / position matching the restored data and belonging to the actual source. Use `SOURCE_AUTO_POSITION=0`, `SOURCE_LOG_FILE` and `SOURCE_LOG_POS`, retaining the same delay and TLS options; do not mix the two positioning methods. MySQL 5.7 and earlier 8.0 versions use older syntax such as `CHANGE MASTER TO ... MASTER_DELAY=14400`. Recheck restore tools and parameter names for those versions rather than copying this entire configuration.

## 10 / Validate replication health and the actual delay

In `SHOW REPLICA STATUS\G`, verify healthy receiver and applier threads, empty `Last_IO_Error` and `Last_SQL_Error`, the correct source endpoint, `Auto_Position=1` and `SQL_Delay=14400`. Runtime state should reflect the intended wait; `SQL_Remaining_Delay` can be NULL while idle. Do not assess health from `Seconds_Behind_Source` alone or require it to equal 14400 at all times.

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

In a lab or an approved dedicated source test database, write a unique marker and record its commit time, or the time immediately after confirmed commit, together with its GTID. The marker should remain absent from the replica during the four hours after commit, then appear once the wait is complete if there is no additional backlog. Also verify that the log was received. An application's recorded write time may differ from transaction commit time; do not measure a large transaction's delay from statement start.

Maintain reliable clock synchronization on both servers and monitor clock drift. Compare schemas, key row counts and samples at the same backup baseline / consistent snapshot. Comparing current RDS data with a four-hours-behind replica does not establish inconsistency. Test a destination restart under the maintenance plan. With the startup guard retained, inspect delay, GTIDs, errors and read-only settings before manually starting replication; a verified automatic startup procedure can use the same conditions.

For connection errors, inspect routes, the whitelist, account source matching and certificate hostnames first. For missing purged GTIDs, rebuild the baseline or recover verifiable history. Stop on duplicate keys, missing rows, missing plugins or RDS-specific objects, and investigate baseline or compatibility problems. Do not skip transactions merely to turn the status green.

## 11 / Plan relay-log space and monitoring

Received but unapplied logs must remain in the IDC throughout the delay. Allocate at least `peak Binlog rate × (14400 + additional backlog seconds)`, then account for transaction bursts, restore workspace, local Binlogs, data growth and margin. At a sustained 10 MiB/s, four hours of relay logs alone require about 141 GiB. The compressed backup size is not sufficient capacity guidance.

`relay_log_recovery=ON` can rebuild relay logs and request unapplied transactions again during restart recovery. Source retention must therefore cover applier lag; do not shorten it merely because the receiver has caught up. `relay_log_purge=ON` removes files no longer needed. Never manually delete unapplied relay logs. When setting a space limit, assess the effect of the receiver potentially stopping log retrieval.[MySQL replica recovery and log settings](https://dev.mysql.com/doc/refman/8.0/en/replication-options-replica.html).

Monitor receiver disconnects, applier errors, `DESIRED_DELAY` changing from 14400, read-only changes, backlog beyond the intended delay, relay-log / data disk free space, the earliest available source Binlog position, TLS certificate expiry and the latest restore drill. Distinguish intentional waiting from stopped execution; a normal four-hour wait should not trigger an ordinary replica-lag alarm.

## 12 / Freeze first after an accidental change, then recover

After detecting an accidental delete or update, immediately stop the IDC applier, verify that it has stopped and inspect executed GTIDs. A stop request may wait for an in-flight transaction to finish, so four hours is not an absolute guarantee. If the erroneous change is already in the baseline or has been applied, use an earlier independent backup / PITR.

```sql
STOP REPLICA SQL_THREAD;
SHOW REPLICA STATUS\G
SELECT @@GLOBAL.gtid_executed;
```

Preserve a recoverable copy of the data and replication metadata, stopping the receiver before a coordinated snapshot if necessary. Identify the erroneous transaction in an isolated clone. Do not set the delay to zero or reset replication on the only delayed copy. Recover to a verified boundary before the error, validate business data and apply the approved data repair plan.

If the first erroneous transaction's exact GTID is known and verified as unapplied, a controlled method such as `START REPLICA SQL_THREAD UNTIL SQL_BEFORE_GTIDS='verified GTID'` can be used on an isolated recovery copy. Consider changing wait settings only after verification. Numeric GTID order does not replace actual log order.[START REPLICA stop boundaries](https://dev.mysql.com/doc/refman/8.0/en/start-replica.html).

A delayed replica provides a time window and still requires independent backups with verified recovery. Promoting it immediately when the source is unavailable accepts a data gap corresponding to at least the intended delay. Plan promotion separately using received / executed transactions and the business's permitted data loss.

## References

- [Alibaba Cloud: restore an RDS physical backup to self-managed MySQL](https://help.aliyun.com/zh/rds/apsaradb-rds-for-mysql/restore-the-data-of-an-apsaradb-rds-for-mysql-instance-from-a-physical-backup-file-to-a-self-managed-mysql-database)
- [Alibaba Cloud: restore an RDS snapshot to self-managed MySQL](https://help.aliyun.com/zh/rds/apsaradb-rds-for-mysql/restore-the-data-of-an-apsaradb-rds-for-mysql-instance-to-a-self-managed-mysql-instance-by-using-a-csv-file-or-an-sql-file/)
- [Alibaba Cloud: download backups](https://help.aliyun.com/zh/rds/apsaradb-rds-for-mysql/download-the-backup-files-of-an-apsaradb-rds-for-mysql-instance-download-the-backup-files-of-an-apsaradb-rds-for-mysql-instance)
- [Alibaba Cloud: account permissions](https://help.aliyun.com/zh/rds/apsaradb-rds-for-mysql/account-permissions)
- [Alibaba Cloud: manage local Binlogs](https://help.aliyun.com/zh/rds/apsaradb-rds-for-mysql/view-and-delete-the-binary-log-files-of-an-apsaradb-rds-for-mysql-instance)
- [Alibaba Cloud: SSL connections to RDS MySQL](https://help.aliyun.com/zh/rds/apsaradb-rds-for-mysql/ssl-connect-to-the-rds-mysql-database/)
- [Percona: establish replication with XtraBackup](https://docs.percona.com/percona-xtrabackup/8.0/set-up-replication.html)
- [Percona: restore a physical backup](https://docs.percona.com/percona-xtrabackup/8.0/restore-a-backup.html)
- [MySQL: delayed replication](https://dev.mysql.com/doc/refman/8.0/en/replication-delayed.html)
- [MySQL: instance identities and replication options](https://dev.mysql.com/doc/refman/8.0/en/replication-options.html)
- [MySQL: init-file startup mechanism](https://dev.mysql.com/doc/refman/8.0/en/resetting-permissions.html)
- [MySQL: GTID system variables](https://dev.mysql.com/doc/refman/8.0/en/replication-options-gtids.html)
- [MySQL: GTID auto-positioning](https://dev.mysql.com/doc/refman/8.0/en/replication-gtids-auto-positioning.html)
- [MySQL: CHANGE REPLICATION SOURCE TO](https://dev.mysql.com/doc/refman/8.0/en/change-replication-source-to.html)
- [MySQL: replica recovery and log options](https://dev.mysql.com/doc/refman/8.0/en/replication-options-replica.html)
- [MySQL: START REPLICA](https://dev.mysql.com/doc/refman/8.0/en/start-replica.html)
