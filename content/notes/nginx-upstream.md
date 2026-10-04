---
{"title":"Nginx 502 与 504：沿请求链逐层定位","category":"网络与代理","kind":"排障手册","date":"2026-10-04","summary":"从错误日志判断连接阶段与响应阶段，再核对上游健康、连接数和超时配置。","tags":["Nginx","502","504"]}
---
客户端看到 502 或 504 时，先确认由哪一层网关返回。请求可能经过 CDN、负载均衡、Nginx 和应用；使用时间戳与请求 ID 关联每一层记录，避免只修改最外层超时。

## 01 / 读错误日志里的动作

- `connect() failed ... while connecting to upstream`：检查上游监听、目标地址、容器端口和网络策略。
- `upstream timed out ... while reading response header`：连接可能已经建立，继续查应用排队、依赖耗时及响应头等待。
- `upstream prematurely closed connection`：查看上游进程退出、连接关闭和协议匹配情况。

这些日志提供调查方向，最终状态码也会受到重试、错误拦截及其他网关行为影响。

## 02 / 在代理所在环境复现

以下示例假设上游就在当前主机的 8080 端口，且 `/health` 是已有的只读健康检查。跨容器环境请使用真实服务地址。

```sh
ss -lnt
curl --max-time 5 -sS -o /dev/null \
  -w 'status=%{http_code} connect=%{time_connect} first_byte=%{time_starttransfer} total=%{time_total}\n' \
  http://127.0.0.1:8080/health
```

健康检查成功后，仍需用安全的业务请求核对关键依赖。如果故障只发生在高流量时，补充上游连接数、线程池队列和数据库连接池数据。

## 03 / 给耗时留下可比较的日志

下面片段放在 `http` 上下文中。日志路径按系统调整，发布前检查权限与日志轮转；这里不记录查询参数和请求正文。

```nginx
log_format timings '$time_iso8601 request_id=$request_id '
                   'status=$status upstream=$upstream_status '
                   'request_time=$request_time '
                   'connect=$upstream_connect_time '
                   'header=$upstream_header_time '
                   'response=$upstream_response_time';
access_log /var/log/nginx/timings.log timings;
```

多次上游尝试可能产生多个时间值，应结合上游状态一起分析。连接慢和响应慢对应不同的问题范围。

## 04 / 超时改动要能解释原因

`proxy_read_timeout` 约束两次读取之间的等待，并非整个请求的总时长。盲目增大它可能增加并发占用。配置改动先经过 `nginx -t`，再按部署流程重载；随后观察错误率、延迟和连接数，确认没有把失败变成更长的等待。

## 参考资料

- [Nginx：代理模块与超时](https://nginx.org/en/docs/http/ngx_http_proxy_module.html)
- [Nginx：上游变量](https://nginx.org/en/docs/http/ngx_http_upstream_module.html#variables)
