---
{"title":"A backup is accepted when a restore succeeds","category":"Data & reliability","kind":"Practical notes","date":"2026-10-04","summary":"Use PostgreSQL logical backups to connect integrity checks, restore drills and RPO / RTO.","tags":["PostgreSQL","Backups","Restore drills"]}
---
A successful backup task establishes that a task finished. You still need to verify its coverage, readability, restore duration and application consistency after recovery. This note demonstrates a logical backup in an isolated test environment. It does not replace a production backup design.

## 01 / Define two objectives

- RPO: how much recent data you can afford to lose. This informs backup frequency and whether continuous log archiving is needed.
- RTO: how long recovery can take. This informs recovery resources, procedures and drills.

“At most 15 minutes of data loss and recovery within two hours” is an example objective. A daily logical backup alone generally cannot meet that RPO; additional protection is required.

## 02 / Create a backup and check readability

Assume the local test database is `demo` and access is provided by controlled PostgreSQL authentication settings. Do not put database passwords in scripts or commit them to a repository.

```sh
umask 077
pg_dump --format=custom --file=demo.dump demo
pg_restore --list demo.dump
sha256sum demo.dump > demo.dump.sha256
sha256sum --check demo.dump.sha256
```

On macOS, use `shasum -a 256` instead. A checksum detects byte changes; it does not establish data completeness or application consistency. `pg_dump` handles one database. Include roles, tablespaces, external objects and keys separately in your protection plan. Check client and server version compatibility.

## 03 / Perform a restore in isolation

These commands create a test database and import data. Run them only on a dedicated test instance. Confirm the connection target, available disk space and database name first. Do not point them at production.

```sh
createdb demo_restore_check
pg_restore --exit-on-error --single-transaction \
  --dbname=demo_restore_check demo.dump
```

Missing roles, extensions or permissions can cause a drill to fail. Document those prerequisites as steps instead of improvising during an incident. Ignoring every error does not make a drill pass.

## 04 / Validate and record the drill

- Check key table counts, required indexes and critical application queries using read-only business validation.
- Record the backup time, restore start and finish, file size and errors.
- Verify recovery remains possible if the backup account or storage fails. Apply encryption and access restrictions according to policy.
- Repeat drills and track how restore time changes as data grows, until measured results meet RPO and RTO.

## References

- [PostgreSQL: SQL dump](https://www.postgresql.org/docs/current/backup-dump.html)
- [PostgreSQL: pg_restore](https://www.postgresql.org/docs/current/app-pgrestore.html)
