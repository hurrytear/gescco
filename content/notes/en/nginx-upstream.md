---
{"title":"Nginx 502 and 504: trace the request through each layer","category":"Networking & proxies","kind":"Troubleshooting","date":"2026-10-04","summary":"Use error logs to distinguish connection and response failures, then check upstream health, connections and timeouts.","tags":["Nginx","502","504"]}
---
When a client receives 502 or 504, first identify the gateway that returned it. A request may pass through a CDN, load balancer, Nginx and application. Correlate timestamps and request IDs across layers before changing the outermost timeout.

## 01 / Read the action in the error log

- `connect() failed ... while connecting to upstream`: check upstream listeners, target addresses, container ports and network policies.
- `upstream timed out ... while reading response header`: a connection may already exist. Inspect application queues, dependency latency and the wait for response headers.
- `upstream prematurely closed connection`: check upstream process exits, closed connections and protocol compatibility.

These messages guide the investigation. Retries, error interception and other gateways can also affect the final status code.

## 02 / Reproduce from the proxy environment

This example assumes the upstream listens on port 8080 of the current host and `/health` is an existing read-only health endpoint. Use the actual service address when working across containers.

```sh
ss -lnt
curl --max-time 5 -sS -o /dev/null \
  -w 'status=%{http_code} connect=%{time_connect} first_byte=%{time_starttransfer} total=%{time_total}\n' \
  http://127.0.0.1:8080/health
```

Even when the health endpoint succeeds, verify critical dependencies with a safe application request. For failures under high traffic, collect upstream connection counts, thread pool queues and database connection pool metrics.

## 03 / Log timings you can compare

Place this snippet in the `http` context. Adjust the log path for your system, and check permissions and rotation before deployment. It omits query parameters and request bodies.

```nginx
log_format timings '$time_iso8601 request_id=$request_id '
                   'status=$status upstream=$upstream_status '
                   'request_time=$request_time '
                   'connect=$upstream_connect_time '
                   'header=$upstream_header_time '
                   'response=$upstream_response_time';
access_log /var/log/nginx/timings.log timings;
```

Multiple upstream attempts can produce multiple timing values. Interpret them alongside upstream statuses. Slow connection establishment and slow responses point to different areas of investigation.

## 04 / Explain timeout changes

`proxy_read_timeout` limits the wait between successive reads, rather than the total request duration. Increasing it without evidence can increase concurrency and resource use. Validate configuration changes with `nginx -t`, then reload through your deployment process. Watch error rate, latency and connection counts to confirm that failures have not simply become longer waits.

## References

- [Nginx: proxy module and timeouts](https://nginx.org/en/docs/http/ngx_http_proxy_module.html)
- [Nginx: upstream variables](https://nginx.org/en/docs/http/ngx_http_upstream_module.html#variables)
