---
{"title":"Kubernetes releases: define rollback conditions before deployment","category":"Kubernetes","kind":"Practical notes","date":"2026-10-04","summary":"Prepare version history, an observation window and rollback actions for a release you can verify.","tags":["Deployment","Releases","Rollback"]}
---
Define success criteria and rollback thresholds before a release starts. Pod readiness is a baseline condition. Application request success, latency and critical task completion provide business validation. This note uses a Deployment; `demo` and `web` are example names throughout.

## 01 / Record the state before deployment

```sh
kubectl config current-context
kubectl -n demo get deployment web -o wide
kubectl -n demo rollout history deployment/web
kubectl -n demo get deployment web -o jsonpath='{.spec.template.spec.containers[*].image}{"\n"}'
```

Record the version, operator, change details and observation window. Use a traceable version or digest for production images so a mutable tag does not refer to different builds over time.

## 02 / Check rollout strategy and capacity

Inspect `maxSurge`, `maxUnavailable`, readiness and termination grace periods. Extra replicas require scheduling capacity. The allowed unavailability must fit service redundancy. Readiness should reflect the ability to serve requests; a shallow probe can admit traffic before an instance is ready.

Use your existing review and deployment process for the release. Then observe:

```sh
kubectl -n demo rollout status deployment/web --timeout=180s
kubectl -n demo get pods -l app=web -o wide
```

The selector `app=web` must match your actual labels. A wait timeout calls for investigation. It does not, by itself, establish either that rollback is required or that recovery has occurred.

## 03 / Establish what a rollback covers

The commands below modify a Deployment. Execute them only after confirming the revision, permissions and rollback conditions. Inspect history and choose a specific known-good revision; `2` is only an example.

```sh
kubectl -n demo rollout history deployment/web
kubectl -n demo rollout undo deployment/web --to-revision=2
kubectl -n demo rollout status deployment/web --timeout=180s
```

A Deployment rollback restores a Pod template revision. It does not automatically revert databases, external configuration or third-party interfaces. If the old image is incompatible with the new database schema, use a planned compatible migration or a forward fix.

## 04 / Close the release with evidence

Observe long enough to cover the relevant traffic cycle. Compare error rate, latency, restarts and critical application results with the baseline. Confirm that GitOps or a deployment controller will not overwrite a manual rollback. Carry findings and revised success criteria into the next change checklist.

## References

- [Kubernetes: Deployments and rollback](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/)
