---
{"title":"Kubernetes 发布：把回退条件写在发布之前","category":"Kubernetes","kind":"实践笔记","date":"2026-10-04","summary":"准备版本记录、观察窗口和回退动作，让滚动发布成为可验证的变更。","tags":["Deployment","发布","回退"]}
---
发布开始前就写清楚成功标准与回退阈值。Pod 就绪只是基础条件；用户请求成功率、延迟和关键任务完成情况才是业务验证。本文以 Deployment 为例，所有 `demo` 与 `web` 都是示例名称。

## 01 / 保存发布前状态

```sh
kubectl config current-context
kubectl -n demo get deployment web -o wide
kubectl -n demo rollout history deployment/web
kubectl -n demo get deployment web -o jsonpath='{.spec.template.spec.containers[*].image}{"\n"}'
```

记录本次版本、操作者、变更内容与观察窗口。生产镜像宜使用可追踪的版本或 digest，避免同一个可变标签对应不同构建。

## 02 / 核对滚动策略与容量

检查 `maxSurge`、`maxUnavailable`、readiness 和终止宽限期。额外副本需要调度容量；允许不可用的比例要符合服务冗余。readiness 应反映能否处理请求，过于简单的探针可能让尚未准备好的实例接入流量。

发布动作走现有审核与部署流程。部署后观察：

```sh
kubectl -n demo rollout status deployment/web --timeout=180s
kubectl -n demo get pods -l app=web -o wide
```

标签 `app=web` 必须与实际标签匹配。等待超时意味着需要调查，不能直接证明必须回退或已经恢复。

## 03 / 先确定回退适用范围

以下命令会改变 Deployment，仅在确认修订号、权限及回退条件后执行。先看历史，使用明确的稳定修订号；此处 `2` 只是示例。

```sh
kubectl -n demo rollout history deployment/web
kubectl -n demo rollout undo deployment/web --to-revision=2
kubectl -n demo rollout status deployment/web --timeout=180s
```

Deployment 回退针对 Pod 模板修订，不会自动回退数据库、外部配置或第三方接口。若旧镜像不兼容新数据库结构，应使用预先设计的兼容迁移或向前修复方案。

## 04 / 结束发布需要证据

观察足够覆盖流量周期的窗口，将错误率、延迟、重启情况和关键业务结果与基线比较。确认 GitOps 或部署控制器不会再次覆盖人工回退。把发现的问题和调整后的发布标准写入下次变更的检查项。

## 参考资料

- [Kubernetes：Deployment 与回退](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/)
