---
{"title":"CrashLoopBackOff：从上一次退出开始查","category":"Kubernetes","kind":"排障手册","date":"2026-10-04","summary":"把退出原因、上次日志、事件与探针串起来，避免重复重启掩盖真正的问题。","tags":["Pod","容器日志","探针"]}
---
`CrashLoopBackOff` 表示容器反复失败后进入重启退避。它描述当前重启状态，具体原因要看容器终止信息、日志和 Pod 事件。以下 `demo`、`web` 和 Pod 名都是示例，请替换为实际对象。

## 01 / 固定上下文，确定哪个容器退出

```sh
kubectl config current-context
kubectl -n demo get pod web-example -o wide
kubectl -n demo describe pod web-example
kubectl -n demo get pod web-example -o jsonpath='{range .status.containerStatuses[*]}{.name}{"\t"}{.lastState.terminated.reason}{"\t"}{.lastState.terminated.exitCode}{"\n"}{end}'
```

同时检查 init container。先确认命名空间和集群，避免把不同环境的事件混在一起。`describe` 的 Events 与 Last State 能帮助缩小调查范围。

## 02 / 优先读取上一次运行的日志

```sh
kubectl -n demo logs web-example -c web --previous --tail=200 --timestamps
kubectl -n demo logs web-example -c web --tail=200 --timestamps
kubectl -n demo get events --field-selector involvedObject.name=web-example --sort-by=.metadata.creationTimestamp
```

`--previous` 读取该容器上一个实例的日志；首次启动、日志已轮转或对象被替换时可能取不到。及时记录到事故材料中，公开分享前去掉令牌、个人信息与业务请求数据。

## 03 / 按退出证据选择下一步

- `OOMKilled`：核对内存限制、工作集走势和应用堆配置。退出码 137 也可能来自其他 SIGKILL 场景，不能单凭数字判断 OOM。
- 启动报错：检查入口命令、挂载路径、配置键和依赖服务连接，注意镜像版本与配置是否匹配。
- 探针失败：比较启动耗时与探针设置。readiness 失败会使 Pod 不就绪；liveness 或 startup 探针连续失败可能触发重启。
- 正常退出后又重启：确认进程是否本来是一次性任务，以及工作负载类型和重启策略是否符合预期。

## 04 / 验证修复与业务恢复

在受控变更后观察至少覆盖启动及探针周期的窗口。确认重启计数不再增长、Pod 就绪、服务端点正确，并通过实际业务请求检查结果。只看到 Running，还不足以证明应用可用。

## 参考资料

- [Kubernetes：调试 Pod](https://kubernetes.io/docs/tasks/debug/debug-application/debug-pods/)
- [Kubernetes：存活、就绪与启动探针](https://kubernetes.io/docs/concepts/configuration/liveness-readiness-startup-probes/)
