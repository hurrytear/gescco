---
{"title":"Linux 负载升高，先收集哪些证据？","category":"Linux","kind":"排障手册","date":"2026-10-04","summary":"从负载、CPU、内存与 I/O 的交叉证据入手，区分计算拥塞和等待阻塞。","tags":["load average","CPU","I/O"],"featured":true}
---
负载升高是一个调查入口。先确定受影响的服务和时间范围，再用同一时间窗口的指标判断瓶颈。本文面向 Linux 主机；容器里看到的资源范围可能不同，需要结合节点和 cgroup 指标。

## 01 / 留下第一份现场

记录机器时间、CPU 数量和负载，再连续采样。以下命令只读取状态；`vmstat` 通常由 procps 提供，部分精简系统需要提前安装。

```sh
date -Is
nproc
uptime
vmstat 1 5
ps -eo pid,comm,state,%cpu,%mem --sort=-%cpu | head -20
```

`vmstat` 的第一行通常是开机以来的平均值，后续行才是采样间隔的数据。单次快照容易漏掉短暂尖峰，最好与监控曲线核对。

## 02 / 把现象分成三条线索

- CPU 使用率持续高：看运行队列、热点进程和请求量，检查流量增长或新版本引入的计算开销。
- CPU 不高但负载高：查看 D 状态进程与磁盘延迟。D 表示不可中断等待，常见于 I/O，也可能涉及其他内核等待。
- 内存紧张：检查可用内存、交换活动、内核 OOM 记录。缓存占用本身不能证明内存不足。

```sh
cat /proc/loadavg
cat /proc/meminfo
cat /proc/pressure/cpu
cat /proc/pressure/memory
cat /proc/pressure/io
ps -eo pid,comm,state,wchan:32 | awk '$3 == "D"'
```

Pressure Stall Information 依赖内核配置；文件不存在时，回到进程、系统日志和存储指标。`wchan` 可能受权限限制，只作为定位线索。

## 03 / 用时间相关性验证假设

把版本发布、流量变化、批任务启动和指标拐点放到一条时间线上。若怀疑磁盘，补充延迟、吞吐和设备错误；若怀疑进程，补充应用请求耗时、线程状态或受控的性能采样。先说明证据，再决定是否限流、扩容或回退。

## 04 / 恢复后再做一次比较

在相近请求量下比较修复前后的延迟、错误率和资源占用。负载下降但请求错误率上升，不代表问题解决。保留采样时间与操作记录，给后续复盘留下可核对的依据。

## 参考资料

- [Linux 内核：/proc 文件系统](https://docs.kernel.org/filesystems/proc.html)
- [Linux 内核：Pressure Stall Information](https://docs.kernel.org/accounting/psi.html)
