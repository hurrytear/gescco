---
{"title":"CrashLoopBackOff: start with the previous exit","category":"Kubernetes","kind":"Troubleshooting","date":"2026-10-04","summary":"Connect termination reasons, previous logs, events and probes before restarting hides the evidence.","tags":["Pod","Container logs","Probes"]}
---
`CrashLoopBackOff` indicates restart backoff after repeated container failures. It describes the current restart state. Find the underlying cause in termination details, logs and Pod events. The namespace `demo`, container `web` and Pod name below are examples; replace them with your actual objects.

## 01 / Confirm the context and failing container

```sh
kubectl config current-context
kubectl -n demo get pod web-example -o wide
kubectl -n demo describe pod web-example
kubectl -n demo get pod web-example -o jsonpath='{range .status.containerStatuses[*]}{.name}{"\t"}{.lastState.terminated.reason}{"\t"}{.lastState.terminated.exitCode}{"\n"}{end}'
```

Also inspect init containers. Confirm the namespace and cluster first to avoid combining events from different environments. Events and Last State in `describe` can narrow the investigation.

## 02 / Read logs from the previous instance

```sh
kubectl -n demo logs web-example -c web --previous --tail=200 --timestamps
kubectl -n demo logs web-example -c web --tail=200 --timestamps
kubectl -n demo get events --field-selector involvedObject.name=web-example --sort-by=.metadata.creationTimestamp
```

`--previous` reads logs from the container's previous instance. They may be unavailable on its first start, after log rotation or after the object is replaced. Capture useful evidence promptly. Remove tokens, personal information and business request data before sharing it publicly.

## 03 / Choose the next step from exit evidence

- `OOMKilled`: compare the memory limit, working set trend and application heap settings. Exit code 137 can result from other SIGKILL cases too; the number alone does not prove OOM.
- Startup errors: check the entrypoint, mount paths, configuration keys and dependency connections. Confirm that image and configuration versions match.
- Probe failures: compare startup time with probe settings. Failed readiness makes a Pod unready; repeated liveness or startup probe failures can cause a restart.
- A successful exit followed by a restart: check whether the process is a one-time task and whether its workload type and restart policy fit that purpose.

## 04 / Verify both the fix and service recovery

After a controlled change, observe a window that covers startup and probe cycles. Confirm that restart counts stop growing, the Pod becomes ready and service endpoints are correct. Test real application requests. A Running status alone does not establish application availability.

## References

- [Kubernetes: debug Pods](https://kubernetes.io/docs/tasks/debug/debug-application/debug-pods/)
- [Kubernetes: liveness, readiness and startup probes](https://kubernetes.io/docs/concepts/configuration/liveness-readiness-startup-probes/)
