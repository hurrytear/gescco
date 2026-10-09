---
{"title":"Bash command auditing, part 1: designing Shell collection","category":"Linux","kind":"Design notes","date":"2026-10-09","summary":"Define the questions an audit must answer before choosing history and Shell hooks, then design session correlation, status preservation and coverage checks.","tags":["Bash","Command auditing","Shell hooks"]}
---
Adding command records to Bash can provide context for interactive operations. Start by defining what a record means, then choose where to collect it. This note describes general implementation ideas without deployment scripts, focusing on scope, event semantics and acceptance checks.

## 01 / Define what one record represents

- Input records capture text submitted to the Shell to explain intent; this may include variables, functions and compound statements.
- Execution records describe internal Shell execution units or external program launches to establish the execution path.
- Result records describe Shell status, application responses or actual resource changes. Interpret these separately.
- Session records capture terminal input, output and interaction order, but do not automatically form a structured command list.

One input line may create several processes or invoke only a builtin. Define counting rules before equating the number of captured events with the number of commands executed. Mark missing fields explicitly instead of filling them through inference.

## 02 / Use history as supporting evidence

Bash history depends on `HISTCONTROL`, `HISTIGNORE`, capacity and write timing. Concurrent sessions introduce additional update concerns. History helps operators review activity, but should not alone support auditing that requires strong completeness or trustworthy attribution.

- Distinguish interactive from noninteractive and login from nonlogin Shells, then check which startup paths load the collector.
- Define how multiline input is stored, how sessions remain distinguishable and when records become persistent.
- Treat history text as one source without promising expanded arguments, a complete process tree or final outcomes.
- Document the trust boundary around Shell state and files that users can modify.

## 03 / Choose hooks by event granularity

`PROMPT_COMMAND` runs before an interactive primary prompt, making it useful for collecting context from the preceding interaction. It does not produce complete records for every step inside a script. A `DEBUG` trap runs before several kinds of execution nodes, offering finer detail with more opportunities for duplication, recursion and overhead. It is not an interface that fires exactly once per input line.

- Design status preservation at hook entry so collection logic does not overwrite `$?` or `PIPESTATUS`.
- Separate the overall pipeline status from individual stage statuses, accounting for `pipefail` when interpreting the overall result.
- Define how start, finish and unfinished events relate. An end hook alone does not establish accurate execution duration.
- Check functions, subshells, command substitutions and trap inheritance, including compatibility with existing prompt tools.
- Treat variables such as `BASH_COMMAND` as execution context rather than promising that one field reconstructs all original input.

## 04 / Design a minimal event that can be correlated

Define fields and their sources before choosing a storage format. Basic correlation data can include a host identifier, boot identifier, Shell session identifier, process and parent identifiers, a session sequence number, collection time and working directory.

- Record login identity separately from current effective identity; retain an unknown value when reliable attribution is unavailable.
- Give input text, execution context and result status separate fields, alongside source type and collector version.
- State when the working directory was captured so a directory after an operation is not mistaken for its starting location.
- PIDs and terminal names can be reused. Correlate them with the host, boot, session and time.
- Identity reported by the Shell is a client claim. Keep trusted connection identity separately at the receiver.

## 05 / Decouple collection from interactive operations

One implementation approach is to keep hooks limited to small local operations while a separate collector handles buffering, forwarding and retries. Contacting a remote service synchronously for every prompt brings logging network failures into the interactive path.

- Bound record size, local queue capacity and waiting time.
- Distinguish local acceptance, persistent storage and successful remote storage.
- Make queue exhaustion, collector termination and truncation observable instead of silently losing records.
- During a pilot, decide whether collection failures allow or restrict operations, including ownership of alerts and recovery.

## 06 / Validate against a coverage checklist

Cover builtins, external programs, multiline input, pipelines, functions, background jobs, multiple terminals, nested Shells, remote noninteractive execution and abnormal disconnects. Define expectations first: which events should appear, which fields are trustworthy and which stages may be absent.

Start with a few test accounts and compare prompt latency, duplication and missing events in known samples before expanding coverage. An exiting or abnormally terminated Shell may never display another prompt, and non-Bash workloads are not automatically covered. Hooks still run inside the user environment being observed and cannot independently prove that every operation was recorded.

For process execution and privilege escalation evidence, continue with [Linux Audit and sudo](/en/notes/bash-command-audit-linux-audit-sudo/). For delivery and storage design, read [central collection, redaction and acceptance checks](/en/notes/bash-command-audit-log-pipeline/).

## References

- [GNU Bash: history facilities](https://www.gnu.org/software/bash/manual/html_node/Bash-History-Facilities.html)
- [GNU Bash: startup files](https://www.gnu.org/software/bash/manual/html_node/Bash-Startup-Files.html)
- [GNU Bash: Shell variables](https://www.gnu.org/software/bash/manual/html_node/Bash-Variables.html)
- [GNU Bash: builtins and traps](https://www.gnu.org/software/bash/manual/html_node/Bourne-Shell-Builtins.html)
- [GNU Bash: pipelines and exit status](https://www.gnu.org/software/bash/manual/html_node/Pipelines.html)
