---
{"title":"Bash command auditing, part 2: combining Linux Audit and sudo","category":"Linux","kind":"Design notes","date":"2026-10-09","summary":"Separate Shell input, program execution and privileged sessions, then combine Linux Audit, login identity and sudo logs within their coverage limits.","tags":["Bash","Linux Audit","sudo"]}
---
Shell records provide operational context, Linux Audit provides kernel events that match configured rules, and sudo provides evidence at privilege escalation entry points. Assign each source a clear question and retain uncertainty in relationships between them. This note describes design and validation ideas without audit rules or installation configuration.

## 01 / Separate program launches from original command text

Auditing around `execve` and `execveat` observes program execution requests that match the rules. Check the target kernel, architecture and actual workloads, including rule coverage for compatibility ABIs where they are used.

- Execution arguments are not the text originally entered by an operator; expansion, functions and scripts change their relationship.
- Shell builtins generally do not independently launch another program, so exec events alone cannot cover them completely.
- Success and return values in syscall records describe that syscall. Launching a program successfully does not establish that its later work succeeded.
- File changes or effective configuration require relevant file auditing, application logs or resource checks; they cannot be inferred from a launch record alone.

## 02 / Retain login and execution identities

Linux Audit's `auid` represents the audit login identity and should be interpreted alongside the current UID and effective UID. Verify that the login path establishes the identity correctly and that useful correlation survives privilege changes.

- Do not attribute every effective-root event to one person; check the login session and privilege escalation entry point.
- For services and automation without a set login identity, correlate workload, scheduling source and service identity, preserving attribution gaps.
- A shared account establishes which account was used; one identity field does not establish the individual operator.
- Container user and process identifiers may belong to different namespaces. State the host perspective and collection source during correlation.
- Usernames or source addresses from Shell environment variables can assist investigation but do not replace authenticated entry records.

## 03 / Assemble events before correlating sessions

One Linux Audit event can contain multiple records, such as `SYSCALL`, `EXECVE`, `CWD` and `PATH`. Group records by audit event identifier before correlating Shell, authentication and sudo sources, rather than treating every log line as a separate operation.

- Retain the source host and boot alongside event identifiers to avoid confusing identifiers across hosts or restarts.
- Use an assembly window and missing-record markers for incomplete events. Neither wait indefinitely nor invent absent fields.
- Keep controlled references to raw records and the parser version so field derivation remains explainable.
- Correlate process and parent IDs, terminals, sessions and time windows. Nearby timestamps alone do not establish a shared operation.
- Working directories, arguments and paths can contain sensitive information and need an explicit policy before entering search storage.

## 04 / Distinguish the layers of sudo logging

sudo event logs can record privilege requests, while configured input and output logging provides interaction context. Some versions also provide subcommand logging through features such as `log_subcmds`; check platform support and implementation limits before adopting them.

- Recording a request to launch a privileged Shell does not establish structured coverage of everything performed inside it.
- Terminal recording and program execution auditing are separate sources. Retain their meanings and avoid double counting.
- Subcommand logging concerns program execution and does not naturally fill every gap involving Shell builtins or application internals.
- Input and output recording can encounter password interactions and sensitive business content. Define scope, access and retention first.
- Remote delivery and failure handling depend on configuration. Specify what the local component, forwarder and receiver each acknowledge.

## 05 / Design rule scope and failure behavior

Derive rules from the audit questions, estimate event volume and overhead, then decide whether to expand coverage. Keeping only successful events can omit failed attempts, while restricting collection to one identity range leaves gaps for services or other entry points.

- Use representative workloads to assess frequent process launches, record size, kernel backlog and collection throughput.
- Monitor lost-event counts, rate limits and disk space, with explicit policies for backlog and storage failures.
- Retain rule versions, change history and load results so coverage for a given period can be explained.
- Before adopting configuration locking, establish its impact, maintenance window and recovery path; some locks require a reboot to release.
- Privileged host control remains a trust boundary. Enabling auditd does not justify a promise that all evidence is impossible to delete or fabricate.

## 06 / Validate the chain of evidence

Choose controlled scenarios for ordinary login, privilege escalation, privileged Shells, external programs, builtins, background services, automation and containers. Record expected events, identity fields and known gaps for every source rather than demonstrating only one successful log entry.

Then check event assembly, PID reuse, clock differences, rotation, collector restarts and forwarding outages. State which operations have mutually supporting evidence, which have only one source and which remain outside coverage.

This note follows [Shell collection design](/en/notes/bash-command-audit-design/). For transport across hosts and storage policy, see [central collection, redaction and acceptance checks](/en/notes/bash-command-audit-log-pipeline/).

## References

- [Linux Audit: official auditctl manual source](https://github.com/linux-audit/audit-userspace/blob/master/docs/auditctl.8)
- [Linux Audit: official ausearch manual source](https://github.com/linux-audit/audit-userspace/blob/master/docs/ausearch.8)
- [sudo: official sudoers manual source](https://github.com/sudo-project/sudo/blob/main/docs/sudoers.man.in)
