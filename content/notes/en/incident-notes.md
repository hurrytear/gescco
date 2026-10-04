---
{"title":"What belongs in an actionable incident record?","category":"Data & reliability","kind":"Working methods","date":"2026-10-04","summary":"Organize investigation around impact, a timeline and tested hypotheses, then make improvements trackable.","tags":["Incident response","Runbooks","Postmortems"]}
---
During a shared investigation, repeated work and verbal conclusions cost time. Create a shared record that connects observations, hypotheses, actions and outcomes. This note describes a general working method, not an incident at any real organization.

## 01 / Start with facts that can be checked

- Symptoms: failed requests, increased latency or queued tasks, including how each was measured.
- Impact: services, regions, time window and scope. Mark unverified areas as pending confirmation.
- Roles: who coordinates, who performs operations and who maintains the record and progress updates.
- Objective: which capabilities to restore first and when the next checkpoint will occur.

“The database is broken” is an untested hypothesis. A more useful observation is “query P95 increased during this window, alongside connection pool waits,” with evidence locations and timestamps.

## 02 / Record the inputs to each decision

Use one time zone and record observations and actions. This fictional example illustrates the format; adjust it to your team's process.

```text
Time (UTC) | Observation / hypothesis | Action | Outcome / next step
09:00      | Entry-point 5xx increased | Compare metrics in two regions | Only region A is affected
09:05      | Suspect the new release  | Compare old and new logs | No matching errors seen in the old version yet
09:10      | Evaluate rollback        | Check database compatibility | Rollback prerequisites met
```

A correlation in time does not automatically establish causation. Record supporting evidence, counter-evidence and the next validation step for each hypothesis rather than treating the first clue as a root cause.

## 03 / Verify recovery and root cause separately

Recovery checks establish whether user functionality, error rate, latency and backlog are within acceptable bounds. Root cause investigation explains the trigger, propagation path and why existing protections did not contain the failure. State remaining unknowns clearly; do not fill gaps with speculation.

## 04 / Turn actions into tasks that can be completed

Give each improvement an owner role, deadline and verification criterion. Replace “improve monitoring” with a concrete task such as “add connection pool wait monitoring, reproduce the condition in a test environment and confirm the alert identifies the service.” Improve system constraints, rollback capability and access to information instead of relying only on people being more careful.

Public incident reviews should retain general mechanisms, example commands and methods. Remove credentials, internal addresses, customer data, business scale and unpublished organizational details. Check log screenshots and command outputs too.

## References

- [Google SRE: managing incidents](https://sre.google/sre-book/managing-incidents/)
- [Google SRE: postmortem culture](https://sre.google/sre-book/postmortem-culture/)
