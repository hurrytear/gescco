---
{"title":"Prometheus latency: aggregate buckets before calculating quantiles","category":"Observability","kind":"Practical notes","date":"2026-10-04","summary":"Calculate P95 correctly for classic histograms and investigate traffic, errors and latency together.","tags":["PromQL","P95","Histogram"]}
---
Average latency can hide slow requests. Quantiles help describe a distribution, but you need to understand the metric type, bucket boundaries, sample count and observation window. This note uses a classic Histogram and assumes your application exposes the corresponding metrics. Adjust names and labels to your instrumentation.

## 01 / Calculate P95 from a classic histogram

Calculate the rate for each bucket, aggregate across instances by service and bucket upper bound `le`, then calculate the quantile.

```promql
histogram_quantile(
  0.95,
  sum by (service, le) (
    rate(http_request_duration_seconds_bucket[5m])
  )
)
```

The output retains the metric's unit: seconds in this example. Averaging instance-level P95 values does not produce service-level P95. Summary quantiles cannot be combined across instances with this bucket formula either. Native Histograms use a different expression.

## 02 / Include request volume and error rate

P95 can fluctuate in low-traffic windows. Display request rate alongside it and calculate failure rate when the denominator contains requests. This example assumes `status` contains HTTP status codes and defines 5xx as service failures.

```promql
sum by (service) (rate(http_requests_total[5m]))

sum by (service) (rate(http_requests_total{status=~"5.."}[5m]))
/
sum by (service) (rate(http_requests_total[5m]))
```

With no requests, the ratio may be absent or non-finite. Show a separate no-traffic state. Some instrumentation creates no 5xx series until a failure occurs. Pre-initialize metrics or define explicit zero-fill rules in the query so missing data is not mistaken for healthy behavior.

## 03 / Design buckets around the service objective

If 300 ms matters, include enough resolution near that threshold. Classic Histogram quantile estimates depend on bucket width. Consider time-series count when changing buckets: every label combination adds bucket series. User IDs and full URLs are poor choices for labels.

## 04 / Give alerts an action path

Include the service name, time window, traffic context, dashboard and runbook with latency alerts. A sustained condition can reduce transient noise. Validate thresholds and windows against service objectives, traffic and response cost. Design separate alerts for user impact, missing collection and capacity trends so responders know what to investigate.

## References

- [Prometheus: histograms and summaries](https://prometheus.io/docs/practices/histograms/)
- [Prometheus: alerting practices](https://prometheus.io/docs/practices/alerting/)
