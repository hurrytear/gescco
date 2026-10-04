---
{"title":"Prometheus 延迟监控：先聚合桶，再算分位数","category":"可观测性","kind":"实践笔记","date":"2026-10-04","summary":"正确计算经典直方图的 P95，并把流量、错误率和延迟放到同一张排障地图里。","tags":["PromQL","P95","Histogram"]}
---
平均延迟可能掩盖慢请求。分位数适合观察分布，但需要知道指标类型、桶边界、样本数量和统计窗口。本文使用经典 Histogram 示例，假设应用暴露了对应指标；名称与标签需按实际埋点调整。

## 01 / 经典直方图的 P95

先计算每个桶的增长速率，跨实例按服务与桶上界 `le` 聚合，再计算分位数。

```promql
histogram_quantile(
  0.95,
  sum by (service, le) (
    rate(http_request_duration_seconds_bucket[5m])
  )
)
```

输出单位沿用指标单位，此例为秒。不能把各实例 P95 直接求平均来得到服务 P95。Summary 暴露的分位数也不能用这个桶公式跨实例合并；原生 Histogram 的写法不同。

## 02 / 同时看请求量与失败率

低流量窗口中的 P95 容易波动。并列展示请求速率，并在分母存在请求时计算失败率。以下假设 `status` 是 HTTP 状态码，且 5xx 被定义为本服务的失败。

```promql
sum by (service) (rate(http_requests_total[5m]))

sum by (service) (rate(http_requests_total{status=~"5.."}[5m]))
/
sum by (service) (rate(http_requests_total[5m]))
```

零请求时比值可能没有结果或出现非有限值，要单独显示无流量状态。不存在 5xx 时，部分埋点不会创建该标签序列；应预初始化指标或在查询中明确补零规则，避免把缺失数据当成正常。

## 03 / 桶边界围绕业务目标设计

如果关注 300 ms，桶应该在这个范围内有足够分辨率。经典 Histogram 的分位数估计受桶宽影响。调整桶要考虑时间序列数量：每个标签组合都会扩展桶序列，用户 ID 或完整 URL 不适合作为标签。

## 04 / 告警需要行动路径

为延迟告警补充服务名、时间范围、流量背景、仪表盘和手册。持续窗口能减少瞬时波动，但阈值和窗口应结合业务目标、流量与响应成本验证。对用户影响、采集缺失和容量趋势分别设计告警，收到通知的人才知道下一步做什么。

## 参考资料

- [Prometheus：Histogram 与 Summary](https://prometheus.io/docs/practices/histograms/)
- [Prometheus：告警实践](https://prometheus.io/docs/practices/alerting/)
