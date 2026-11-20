---
{"title":"Alibaba Cloud same-region VPC peering: private connectivity and IDC access","category":"Networking & proxies","kind":"Practical notes","date":"2026-11-20","summary":"Configure same-region VPC peering, bidirectional routes and access rules, understand its transit limitations, and use a shared ECR or CEN/TR to connect multiple VPCs with additional IDCs.","tags":["Alibaba Cloud","VPC","Peering","ECR","CEN","IDC"]}
---
Same-region VPC peering provides a direct private path between two VPCs. If one VPC already has a dedicated circuit, its peer does not automatically gain IDC access: peering does not provide transit routing. Attach both VPCs separately to an Express Connect Router (ECR), or organize forwarding through an enterprise Transit Router (TR) in Cloud Enterprise Network (CEN). This guide covers all three paths and the return routes for additional IDCs.

References were checked on November 20, 2026. Examples use IPv4 and invented networks, hosts and names. These are implementation and acceptance instructions; no actual Alibaba Cloud account, circuit or IDC was configured. For physical circuits, VBRs and device BGP configuration, also see the [Alibaba Cloud and IDC BGP guide](/en/notes/aliyun-idc-bgp/).

## 01 / Define addresses and access requirements

Both VPCs are in one region, such as Hangzhou; their vSwitches may use different availability zones. IDC1 already has a cloud circuit, while IDC2 reaches IDC1 through an existing inter-site WAN. Same-region connectivity does not require the same availability zone.

```text
Region: cn-hangzhou
VPC-A:       10.60.0.0/16
  vSwitch-A: 10.60.10.0/24
  ECS-A:     10.60.10.10
VPC-B:       10.70.0.0/16
  vSwitch-B: 10.70.10.0/24
  Service-B: 10.70.10.20:443
IDC1:        10.20.0.0/16
IDC2:        10.30.0.0/16
  Service-2: 10.30.10.30:443

Initial cloud path:
VPC-A <---- VPC peering ----> VPC-B

Existing on-premises path:
VBR ---- Circuit ---- CPE / IDC1 ---- Existing WAN ---- IDC2
```

List approved flows first: A to B over HTTPS, A and B to specific IDC1 / IDC2 services, and authorized connections initiated from the IDCs. Reachability does not mean every network and port should be open. Check VPC, IDC, container, VPN and interconnect addresses for conflicts; overlapping addressing is outside this guide.

## 02 / Check prerequisites

- Verify each VPC's region, account, ID, primary and secondary CIDRs, and the actual route table associated with the test ECS vSwitch.
- Inventory existing NAT, VPN, ECR, TR, default and more-specific routes. Save the current route tables, access rules and associations.
- Prepare account permissions and enable Cloud Data Transfer (CDT) as required by the console. Cross-account work requires both parties. Enabling a product and incurring charges are separate matters.
- Prepare B's health endpoint and narrowly scoped source rules before scheduling a small test.

Use the current [VPC peering guide](https://help.aliyun.com/zh/vpc/vpc-peer-to-peer-connection/) for activation and cross-account acceptance requirements. Same-region peering pricing does not determine ECR, TR, circuit port, carrier or diagnostic-tool costs; check these separately before implementation.

## 03 / Create the same-region peering connection

- Step 1: Open VPC peering in the VPC console and select VPC-A's region.
- Step 2: Name the connection and select VPC-A. Select VPC-B in the same region as the accepter, supplying verified account information for a cross-account connection.
- Step 3: Same-account connections are accepted automatically. For cross-account peering, B's owner verifies the requester and accepts.
- Step 4: Confirm the connection is established, record its real ID, and inspect routes on both sides.

For same-account creation, the option to add peer CIDR routes to VPC system route tables still requires read-back. It targets system tables; inspect and complete routes separately when workload vSwitches use custom tables. Successful creation only establishes the connection resource.

## 04 / Configure both directions in workload route tables

In A's effective workload route table, add B's business prefix with the next-hop type set to VPC peering and select the new connection. Configure B's return route to A in B's effective table. This is a route plan, not executable CLI:

```text
Effective VPC-A route table:
  10.70.0.0/16 -> VPC peering peer-a-b

Effective VPC-B route table:
  10.60.0.0/16 -> VPC peering peer-a-b

Expected flow:
  10.60.10.10 -> peer-a-b -> 10.70.10.20
  10.70.10.20 -> peer-a-b -> 10.60.10.10
```

If access is authorized only to one vSwitch, narrow the destination to its `/24`, while ensuring the return route covers the real source. Do not duplicate an equivalent route or point a default route or all of `10.0.0.0/8` at peering for convenience.

Inspect longest-prefix matches, route status and conflicts with existing entries. A Linux guest route shows its path to the virtual gateway; it cannot replace inspection of cloud route tables. [VPC route tables](https://help.aliyun.com/zh/vpc/vpc-route-table/).

## 05 / Permit services and configure private DNS

B's ECS security group should allow TCP 443 from `10.60.10.0/24` as required. A's outbound rules, relevant network ACLs, host firewalls and application listeners must also permit the flow. Check network ACL rules for both request and return traffic. Cross-VPC connectivity does not automatically grant security-group membership or application access; managed services such as RDS also need their own allowlist or security-group review. [ECS security-group practices](https://help.aliyun.com/zh/acsg/best-practices-for-ecs-security-groups-1).

Validate the network with a fixed IP and the correct TLS hostname before testing DNS. PrivateZone resolution scope must cover authorized VPCs; peering does not create cross-network resolution rules. Cloud-to-IDC DNS can use an outbound endpoint and conditional forwarding; IDC-to-cloud private DNS can use an inbound endpoint. Permit the required paths and UDP / TCP 53. [Hybrid DNS resolution](https://help.aliyun.com/zh/dns/pvtz-implementation-of-on-cloud-off-cloud-domain-name-resolution-exchange-based-on-intranet-dns-resolution).

## 06 / Why the peer cannot share its circuit through transit

The following paths are outside native peering transit capabilities. Adding an IDC destination route through peering in A does not make the first path work:

```text
Unsupported native transit:
VPC-A -- peering --> VPC-B -- VBR / ECR -- Circuit -- IDC

Also not provided by peering:
VPC-A -- peering --> VPC-B -- peering --> VPC-C
```

Alibaba Cloud's architecture guide explicitly excludes reaching an IDC through a peer's VBR. Peering connects two VPCs and does not automatically propagate B's other routes to A. Enabling `ip_forward` on an ordinary ECS instance in B does not automatically add that transit capability to the cloud service. [Combined peering and TR architecture](https://help.aliyun.com/zh/landing-zone/solution-135).

For access to a particular proxy service in B, an application proxy can initiate its own IDC connection. Design its authentication, access controls, capacity and availability separately; source addressing and audit semantics may change. This does not transparently connect all of A's networks to the circuit. Use the ECR or TR paths below for routed private connectivity.

## 07 / Option one: attach both VPCs directly to one ECR

For a small number of VPCs already connected by peering, retain peering and associate A and B separately with the circuit's ECR. A's IDC traffic enters ECR directly without passing through B.

```text
VPC-A <---------- peering ----------> VPC-B
  |                                    |
  +---------------- ECR ---------------+
                     |
                    VBR
                     |
                  Circuit
                     |
                 CPE / IDC1 ---- WAN ---- IDC2

A -> B:    peering
A -> IDC:  A -> ECR -> VBR -> Circuit -> IDC
B -> IDC:  B -> ECR -> VBR -> Circuit -> IDC
```

ECR supports BGP dynamic routing only; do not copy a legacy static VBR-to-VPC design. VPCs attached to one ECR cannot communicate through ECR, so A-to-B peering still serves a purpose. ECR also does not provide cloud transit between its attached VPCs and TRs. [ECR capabilities and limitations](https://help.aliyun.com/zh/express-connect/user-guide/ecr/).

- Step 1: Confirm the existing circuit, VBR and BGP work. Check the VBR's MPBGP capability and matching ECR / VBR local ASNs.
- Step 2: Associate A and B from ECR's VPC tab, completing resource authorization first for cross-account attachments.
- Step 3: Review allowed prefixes advertised to the IDC for both approved cloud networks. Matching and incremental modes differ; clearing prefixes restores detailed advertisements rather than denying all routes.
- Step 4: Advertise only authorized, reachable IDC1 / IDC2 prefixes from the CPE. Read back A's and B's effective tables and confirm the dynamic IDC paths correspond to their ECR associations.
- Step 5: Confirm CPE and internal IDC return routes to both VPCs before admitting test traffic.

A VPC accepts routes from only one dynamic source at a time. A VPC already attached to TR with route synchronization enabled cannot also be directly associated with ECR. Plan a migration window and replacement routes before changing existing synchronization. [Create and manage ECR](https://help.aliyun.com/zh/express-connect/user-guide/create-and-manage-the-leased-line-gateway-ecr). Cross-account peering acceptance and ECR resource authorization are separate operations. [Cross-account ECR authorization](https://help.aliyun.com/zh/express-connect/user-guide/cross-account-ecr-authorization).

Assess migration of existing point-to-point VBR-to-VPC connections against their live architecture. This legacy product is no longer sold and should not be the basis of a new shared-circuit design. [Legacy VBR-to-VPC connections](https://help.aliyun.com/zh/express-connect/user-guide/create-and-manage-a-vbr-to-vpc-connection).

## 08 / Option two: forward through CEN enterprise TR

For more VPCs, isolated groups or centralized route policies, attach A and B to an enterprise TR in the same region, then associate ECR with TR. Existing supported direct VBR-to-TR architectures can remain in their current form; this diagram does not require an immediate migration.

```text
VPC-A -- attachment-A --+
                        +-- Enterprise TR -- ECR -- VBR -- Circuit -- IDC1 -- IDC2
VPC-B -- attachment-B --+

Illustrative shared TR route table:
  10.60.0.0/16 -> attachment-A
  10.70.0.0/16 -> attachment-B
  10.20.0.0/16 -> ECR attachment
  10.30.0.0/16 -> ECR attachment

Effective VPC-A / VPC-B route tables:
  10.20.0.0/16 -> TR attachment
  10.30.0.0/16 -> TR attachment
```

- Step 1: Create VPC attachments for A and B, select vSwitches according to regional availability-zone requirements, and reserve interface addresses. Associate ECR with TR and inspect default route relationships.
- Step 2: Choose each attachment's associated forwarding table. Traffic entering from A uses A's associated table; returning IDC traffic uses the ECR attachment's table. Both must provide the correct exit.
- Step 3: Configure route learning so the intended TR tables receive authorized cloud and IDC prefixes. System and custom VPC routes have different publication rules; B's custom peering route does not automatically create shared transit.
- Step 4: Configure route synchronization or reviewed static VPC routes so VPCs know the IDC exit, and advertise approved cloud prefixes to the IDC through ECR / BGP.

The VPC attachment option that automatically adds TR routes to all VPC route tables installs three RFC 1918 summaries: `10.0.0.0/8`, `172.16.0.0/12` and `192.168.0.0/16`. These may redirect unrelated private traffic; review specific IDC prefixes first in this example. [Create VPC attachments](https://help.aliyun.com/zh/cen/user-guide/connect-vpcs/).

Associated forwarding selects the lookup table for ingress traffic. Route learning brings network routes into selected TR tables. Route synchronization sends TR routes to attached networks. A route visible in an arbitrary TR table does not establish end-to-end reachability. [Associated forwarding](https://help.aliyun.com/zh/cen/user-guide/associated-forwarding), [route learning](https://help.aliyun.com/zh/cen/user-guide/route-learning).

Enabling VPC route synchronization affects all its route tables. Allowed prefixes on an ECR attachment also require inspection of the actual synchronized and advertised scope. The shared TR table above represents this example's authorized connectivity domain; design separate tables, propagation policies and access rules for isolation. [Route synchronization](https://help.aliyun.com/zh/cen/user-guide/route-synchronization).

## 09 / Complete the path to additional IDCs

IDC2 in this example reaches the cloud through IDC1's existing WAN, rather than another VPC peering connection. Verify every segment:

- IDC1's CPE reaches `10.30.0.0/16` through the internal core / WAN with a reachable next hop.
- CPE outbound BGP policy advertises the approved IDC1 and IDC2 prefixes, and the cloud sees the correct next hops.
- The CPE receives A and B prefixes and propagates them to the IDC1 core and IDC2 as designed; routes must not stop in the edge router's BGP table.
- IDC2 returns traffic for `10.60.0.0/16` and `10.70.0.0/16` through IDC1's circuit exit. WAN devices and firewalls permit both directions.

```text
Forward path:
ECS-A -> ECR / TR -> VBR -> Circuit -> CPE -> IDC1 WAN -> IDC2 service

Return path:
IDC2 service -> IDC2 gateway -> WAN -> IDC1 CPE -> Circuit -> VBR -> ECR / TR -> ECS-A

Expected CPE route plan:
  10.30.0.0/16 -> existing IDC WAN
  10.60.0.0/16 -> cloud circuit, learned through BGP
  10.70.0.0/16 -> cloud circuit, learned through BGP

Expected IDC2 route plan:
  10.60.0.0/16 -> IDC1 WAN / CPE
  10.70.0.0/16 -> IDC1 WAN / CPE
```

These are routing objectives, not instructions to redistribute all BGP / IGP routes. Validate reachability across an aggregate before announcing it, and limit prefixes to approved services to avoid blackholes or leaks. An Established BGP session does not prove that IDC2's prefix is advertised, selected or permitted for application traffic.

If IDC2 has its own circuit and VBR, it can also attach to ECR subject to support requirements, providing a direct cloud-to-IDC2 path. IDC1-to-IDC2 transit through ECR is a separate requirement: the VBR option allowing inter-IDC business access is not available by default and requires application and eligibility checks. Cloud reachability to both IDCs does not imply mutual IDC reachability.

## 10 / Avoid route conflicts when retaining peering

Keep peering for direct A-to-B traffic and use ECR or TR for IDC prefixes, with a clear destination-based split. If synchronization also introduces the peer VPC prefix, resolve conflicts and selection policy before publishing. Two paths for an identical prefix should not be treated as automatic primary and backup routes.

```text
Desired VPC-A forwarding intent:
  10.70.0.0/16 -> peering
  10.20.0.0/16 -> ECR-derived path OR TR attachment
  10.30.0.0/16 -> ECR-derived path OR TR attachment

Desired VPC-B forwarding intent:
  10.60.0.0/16 -> peering
  10.20.0.0/16 -> ECR-derived path OR TR attachment
  10.30.0.0/16 -> ECR-derived path OR TR attachment
```

OR means selecting one planned architecture. Check actual next hops, longest-prefix matches, route status and return paths rather than counting entries. Native private connectivity normally preserves the workload source address. Adding SNAT to hide a missing return route changes auditing, access controls and troubleshooting.

## 11 / Validate cloud routes and real services separately

First inspect peering state, effective workload tables, ECR / TR associations, sent and received BGP prefixes, and IDC2's return path. Network Intelligence Service (NIS) path analysis can help inspect routes, security groups and network ACLs. It does not send application data; analyze the reverse path separately and finish with real service tests.

On an authorized Linux test ECS, these commands only inspect guest addressing and kernel route selection. They do not show every hop inside Alibaba Cloud's virtual network:

```sh
ip -br address
ip route get 10.70.10.20
ip route get 10.30.10.30
```

After configuring matching certificates and `/healthz` endpoints for the example domains, use `--resolve` to pin private destination IPs while preserving hostnames, SNI and certificate validation. `--noproxy` avoids accidentally testing an inherited proxy path. Replace domains and addresses with your own authorized services.

```sh
curl --noproxy '*' --connect-timeout 3 --max-time 10 \
  --resolve app-b.example.com:443:10.70.10.20 \
  https://app-b.example.com/healthz

curl --noproxy '*' --connect-timeout 3 --max-time 10 \
  --resolve service-idc2.example.com:443:10.30.10.30 \
  https://service-idc2.example.com/healthz
```

Then query the test host's actual DNS and verify the expected private addresses. If `dig` is unavailable, install the distribution's DNS diagnostic package first.

```sh
dig app-b.example.com A
dig service-idc2.example.com A
```

Record the source, destination, time, port and application response. Test IDC-initiated cloud connections separately when required. Responses must match the service contract; an arbitrary HTTP 200, successful ping or TCP handshake does not validate every business flow. See the [ip-route manual](https://man7.org/linux/man-pages/man8/ip-route.8.html) and [curl manual](https://curl.se/docs/manpage.html).

## 12 / Troubleshoot in path order

- A cannot reach B: verify acceptance, effective vSwitch tables, forward and return routes, then access rules and listeners.
- A reaches B but not the IDC: first exclude the unsupported path through B's circuit; then inspect A's direct ECR or TR attachment.
- IDC1 works but IDC2 fails: check CPE advertisement and cloud selection of IDC2's prefix, IDC2 return routes to A / B, and WAN firewalls.
- A TR table has the route but traffic fails: inspect the table associated with the actual ingress attachment, then routes synchronized into the VPC.
- A VPC cannot associate with ECR: inspect its existing dynamic route source, resource authorization and product restrictions, then plan migration.
- IP connectivity works but names fail: inspect private DNS scope, forwarding rules and DNS reachability; public resolution is not evidence of private connectivity.
- Handshakes work but larger requests stall: investigate circuit / WAN MTU, path MTU discovery and device counters. Small successful pings do not exclude path issues.

## 13 / Change control, rollback and availability

- Save effective VPC / TR routes, ECR prefix modes and advertisements, CPE BGP policies, IDC core return routes and access rules. Mark entries added by this change.
- Prepare return paths and precise access rules first, then introduce test prefixes or sources according to the change plan. Static-route trials and dynamic synchronization have different scopes; inspect each.
- Expand only after acceptance, checking existing VPN, circuit, internet and other VPC traffic for changes.
- Restore changed route relationships, advertisements and rules for rollback. Confirm the old path works before removing new resources; do not empty route tables or dismantle the original circuit.

Two VPCs sharing one physical circuit still share a circuit failure risk. Critical services need a separate design for diverse circuits, access points and devices, BGP selection, convergence and failure drills. Two logical connections do not establish physical redundancy. Validate this topology and checklist in the target account and devices before relying on them.

## References

- [Alibaba Cloud: VPC peering](https://help.aliyun.com/zh/vpc/vpc-peer-to-peer-connection/)
- [Alibaba Cloud: VPC route tables](https://help.aliyun.com/zh/vpc/vpc-route-table/)
- [Alibaba Cloud: combined peering and TR architecture and transit limits](https://help.aliyun.com/zh/landing-zone/solution-135)
- [Alibaba Cloud: ECR capabilities and limitations](https://help.aliyun.com/zh/express-connect/user-guide/ecr/)
- [Alibaba Cloud: create and manage ECR](https://help.aliyun.com/zh/express-connect/user-guide/create-and-manage-the-leased-line-gateway-ecr)
- [Alibaba Cloud: cross-account ECR authorization](https://help.aliyun.com/zh/express-connect/user-guide/cross-account-ecr-authorization)
- [Alibaba Cloud: legacy VBR-to-VPC connections](https://help.aliyun.com/zh/express-connect/user-guide/create-and-manage-a-vbr-to-vpc-connection)
- [Alibaba Cloud: connect VPCs to enterprise TR](https://help.aliyun.com/zh/cen/user-guide/connect-vpcs/)
- [Alibaba Cloud: associated forwarding](https://help.aliyun.com/zh/cen/user-guide/associated-forwarding)
- [Alibaba Cloud: route learning](https://help.aliyun.com/zh/cen/user-guide/route-learning)
- [Alibaba Cloud: route synchronization](https://help.aliyun.com/zh/cen/user-guide/route-synchronization)
- [Alibaba Cloud: ECS security-group practices](https://help.aliyun.com/zh/acsg/best-practices-for-ecs-security-groups-1)
- [Alibaba Cloud: hybrid DNS resolution](https://help.aliyun.com/zh/dns/pvtz-implementation-of-on-cloud-off-cloud-domain-name-resolution-exchange-based-on-intranet-dns-resolution)
- [ip-route manual](https://man7.org/linux/man-pages/man8/ip-route.8.html)
- [curl manual](https://curl.se/docs/manpage.html)
