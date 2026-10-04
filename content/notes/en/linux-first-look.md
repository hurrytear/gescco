---
{"title":"High Linux load: what evidence should you collect first?","category":"Linux","kind":"Troubleshooting","date":"2026-10-04","summary":"Use load, CPU, memory and I/O together to distinguish compute contention from blocked work.","tags":["load average","CPU","I/O"],"featured":true}
---
A rise in system load is a starting point for investigation. Identify the affected service and time window, then compare metrics from the same period to locate the bottleneck. This note covers Linux hosts. A container may see a different resource scope, so include node and cgroup metrics when relevant.

## 01 / Capture the initial state

Record the host time, CPU count and load, then collect several samples. These commands read system state. `vmstat` is usually provided by procps; prepare it in advance on minimal systems.

```sh
date -Is
nproc
uptime
vmstat 1 5
ps -eo pid,comm,state,%cpu,%mem --sort=-%cpu | head -20
```

The first `vmstat` row normally reports averages since boot. Later rows describe the sampling intervals. A single snapshot can miss a short spike, so compare the samples with monitoring charts.

## 02 / Follow three lines of evidence

- Sustained high CPU use: inspect the run queue, busy processes and request volume. Look for increased traffic or additional computation introduced by a new version.
- High load with low CPU use: inspect D-state processes and disk latency. D means uninterruptible wait, often related to I/O but also possible with other kernel waits.
- Memory pressure: inspect available memory, swap activity and kernel OOM records. A large cache alone does not prove a memory shortage.

```sh
cat /proc/loadavg
cat /proc/meminfo
cat /proc/pressure/cpu
cat /proc/pressure/memory
cat /proc/pressure/io
ps -eo pid,comm,state,wchan:32 | awk '$3 == "D"'
```

Pressure Stall Information depends on kernel configuration. If the files are absent, use process information, system logs and storage metrics. Access to `wchan` may be restricted; treat it as a clue rather than a conclusion.

## 03 / Test hypotheses against the timeline

Place releases, traffic changes, batch jobs and metric changes on the same timeline. If storage is a suspect, gather latency, throughput and device errors. If a process is a suspect, gather request timings, thread state or controlled performance samples. Explain the evidence before deciding to limit traffic, add capacity or roll back.

## 04 / Compare again after recovery

Compare latency, error rate and resource use under similar request volume before and after the change. Lower load with a higher request error rate does not establish recovery. Keep timestamps and an operation log so the incident review can check what happened.

## References

- [Linux kernel: the /proc filesystem](https://docs.kernel.org/filesystems/proc.html)
- [Linux kernel: Pressure Stall Information](https://docs.kernel.org/accounting/psi.html)
