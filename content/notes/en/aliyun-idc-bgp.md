---
{"title":"Alibaba Cloud and IDC connectivity: private networking with BGP","category":"Networking & proxies","kind":"Practical notes","date":"2026-10-04","summary":"Connect an on-premises IDC to an Alibaba Cloud VPC through redundant circuits, VBRs and ECR. Configure prefix filtering and bidirectional failover, then verify return routes, BFD and application recovery.","tags":["Alibaba Cloud","IDC","BGP","Express Connect","Hybrid cloud"]}
---
Private connectivity requires a working physical circuit, BGP route exchange, cloud forwarding and application access. This guide uses a same-region, same-account IPv4 connection between an on-premises IDC and an Alibaba Cloud VPC. It starts with a new VBR + Express Connect Router (ECR) deployment, then covers existing Cloud Enterprise Network (CEN) / Transit Router (TR) networks. All addresses, ASNs and device names are examples. References were checked on 2026-10-04; no configuration or failover test was performed on an actual cloud or IDC network.

## 01 / Choose the network path

Express Connect provides the physical circuit, a Virtual Border Router (VBR) peers with the on-premises customer premises equipment (CPE), and ECR connects VBRs to cloud networks. This example uses two CPEs, two circuits and two VBRs. Traffic normally prefers circuit A while the BGP session on circuit B stays established. A single-circuit deployment can start with the same A-side steps, but it provides no circuit redundancy.[Express Connect getting started](https://help.aliyun.com/zh/express-connect/getting-started/getting-started-guide).

```text
IDC LAN 10.20.0.0/16 / AS 65050
        |
  IDC core: iBGP + reachable next hops
        |
        +-- CPE-A -- Circuit A / VLAN 110 -- VBR-A --+
        |                                         |
        +-- CPE-B -- Circuit B / VLAN 120 -- VBR-B --+-- ECR / AS 65010
                                                         |
                                                  VPC 10.60.0.0/16

Existing CEN network:
CPE -- Circuit -- VBR -- ECR -- Enterprise TR -- VPCs
Existing direct attachment:
CPE -- Circuit -- VBR ------- Enterprise TR -- VPCs
```

An existing direct VBR-to-TR attachment can remain in its current architecture. There is no need to migrate merely to match this guide. With multiple VPCs behind TR, check attachment associations, route propagation and the actual VPC route tables. The old VBR-to-VPC connection product is no longer sold; plan new deployments around current options such as ECR.[VBR-to-VPC connection notice](https://help.aliyun.com/zh/express-connect/user-guide/create-and-manage-a-vbr-to-vpc-connection).

## 02 / Plan addresses, ASNs and advertised prefixes

Inventory IDC, VPC, container, VPN and interconnect networks before configuring routing. BGP alone cannot resolve overlapping addresses: renumber them or design address translation separately. This example advertises no default route and does not treat all RFC 1918 space as a business network that must be reachable.

```text
IDC business prefix:       10.20.0.0/16
Cloud business prefix:     10.60.0.0/16
IDC ASN:                   65050
ECR / VBR local ASN:       65010

Circuit A: VLAN 110 / 172.20.255.0/30
  Alibaba Cloud VBR-A:     172.20.255.1
  Customer CPE-A:          172.20.255.2
Circuit B: VLAN 120 / 172.20.255.4/30
  Alibaba Cloud VBR-B:     172.20.255.5
  Customer CPE-B:          172.20.255.6
Interconnect subnet mask:  255.255.255.252

CPE-A router ID:           192.0.2.11
CPE-B router ID:           192.0.2.12
IDC test host / DNS:       10.20.10.10 / 10.20.0.53
Cloud test host:           10.60.10.20
Test hostname:             app.corp.example.com
```

The documentation addresses `192.0.2.11` and `192.0.2.12` illustrate distinct router IDs. Replace them with planned unique identifiers in production; they are not BGP peer addresses. Peering uses the interconnect IPs in the corresponding /30. Advertised prefixes use network addresses.

ECR supports a custom ASN. This example uses `65010` for ECR and `65050` for the IDC; avoid collisions with existing autonomous systems. Alibaba Cloud reserves `65025`. With a non-default ECR ASN, attach VBRs that have no BGP configuration before configuring their sessions so that they inherit the correct ASN.[Create and manage ECR](https://help.aliyun.com/zh/express-connect/user-guide/create-and-manage-the-leased-line-gateway-ecr).

## 03 / Deliver the circuits and configure VBRs

Circuit ordering, carrier construction, data-center cross-connects and cloud port activation are actual delivery work. Before Layer 3 configuration, check port status, optical levels, error counters and contracted bandwidth. For redundant circuits, verify separate equipment, access points and physical paths: two circuit identifiers do not establish independent failure domains.

Create VBR-A and VBR-B in the Express Connect console. Select the corresponding physical ports and enter the VLANs, cloud-side IPs, customer-side IPs and /30 masks from section 02. IDC subinterfaces and carrier VLAN delivery must match the VBR configuration. For shared circuits, use the carrier's delivery parameters instead of copying these example VLANs.[Create and manage VBRs](https://help.aliyun.com/zh/express-connect/user-guide/create-and-manage-a-vbr).

First check peer reachability from the CPE interconnect interface, then TCP 179. These commands are for a Linux / FRR device whose interfaces are already configured; replace the interface name. If ICMP is restricted, use ARP, interface counters and carrier tests as additional evidence.

```sh
ip -br address
ip -s link show dev eth1.110
ping -I 172.20.255.2 -c 4 172.20.255.1
sudo tcpdump -ni eth1.110 -c 20 'arp or tcp port 179'
sysctl net.ipv4.ip_forward
```

Keep BGP access limited to the corresponding interconnect IPs on TCP 179. Linux CPEs also need persistent forwarding configured through the distribution's supported mechanism, with forwarding-chain and reverse-path checks reviewed. Use packet captures for controlled diagnostics and avoid retaining application payloads unnecessarily.

## 04 / Attach ECR before creating BGP peers

Complete the cloud configuration in this order:

- Create ECR with ASN `65010`. Check that both VBRs support the MPBGP capability required by ECR.
- Add VBR-A and VBR-B on ECR's VBR tab, then verify their BGP local ASN is `65010`.
- Associate the target VPC with ECR. For this example, use matching mode for allowed prefixes and advertise the verified reachable `10.60.0.0/16`.
- Create an IPv4 BGP group on each VBR. Set Peer AS to IDC ASN `65050`, and configure the planned route limit and BGP shared secret.
- Set VBR-A's BGP peer IP to customer-side `172.20.255.2`, and VBR-B's to `172.20.255.6`. The IDC-side neighbors are instead the cloud-side `.1` and `.5` addresses.

The common cloud-side default ASN is `45104`, but this example uses the actual local ASN after ECR attachment. Direct VBR-to-ECR or VBR-to-TR connections do not require the separate BGP network advertisement step found in older VBR-to-VPC tutorials.[Configure BGP](https://help.aliyun.com/zh/express-connect/user-guide/configure-and-manage-bgp/).

ECR's allowed-prefix configuration changes advertisements to the IDC, including aggregation and withdrawal of more-specific routes. Treat it as routing policy rather than an ordinary firewall allowlist. Save the existing advertisement list, verify reachability within an aggregate and align CPE import policy before changing it. This example accepts the exact `/16` only. Configure identical BGP secrets at both ends through a controlled channel; keep actual secrets out of notes and Git.[ECR circuit path selection example](https://help.aliyun.com/zh/express-connect/use-cases/local-idc-can-use-ecr-to-route-leased-line-link-to-the-cloud).

## 05 / Example IDC BGP configuration

The following uses syntax documented for FRRouting 10.4 and covers only circuit eBGP and prefix policies. It is not a universal configuration for Huawei, H3C, Cisco or Juniper, nor a complete installation, interface or IDC internal-routing guide. Check the installed version and replace the secret placeholder with the agreed value before use.

Both CPEs must already reach IDC business networks and have an exact route for `10.20.0.0/16` in the routing table. This example explicitly enables `bgp network import-check`. If only individual `/24` routes exist, advertise approved actual prefixes instead. Do not add a permanent discard aggregate merely to make a `network` statement originate a route.[FRR BGP network origination](https://docs.frrouting.org/en/stable-10.4/bgp.html).

Merge this configuration fragment on CPE-A:

```conf
ip prefix-list IDC-EXPORT seq 10 permit 10.20.0.0/16
ip prefix-list CLOUD-IMPORT seq 10 permit 10.60.0.0/16
!
route-map FROM-CLOUD permit 10
 match ip address prefix-list CLOUD-IMPORT
 set local-preference 200
!
route-map TO-CLOUD permit 10
 match ip address prefix-list IDC-EXPORT
!
router bgp 65050
 bgp router-id 192.0.2.11
 bgp network import-check
 neighbor 172.20.255.1 remote-as 65010
 neighbor 172.20.255.1 password REPLACE_WITH_SHARED_SECRET
 address-family ipv4 unicast
  network 10.20.0.0/16
  neighbor 172.20.255.1 activate
  neighbor 172.20.255.1 route-map FROM-CLOUD in
  neighbor 172.20.255.1 route-map TO-CLOUD out
 exit-address-family
!
```

Use the corresponding fragment on CPE-B:

```conf
ip prefix-list IDC-EXPORT seq 10 permit 10.20.0.0/16
ip prefix-list CLOUD-IMPORT seq 10 permit 10.60.0.0/16
!
route-map FROM-CLOUD permit 10
 match ip address prefix-list CLOUD-IMPORT
 set local-preference 100
!
route-map TO-CLOUD permit 10
 match ip address prefix-list IDC-EXPORT
 set as-path prepend 65050 65050
!
router bgp 65050
 bgp router-id 192.0.2.12
 bgp network import-check
 neighbor 172.20.255.5 remote-as 65010
 neighbor 172.20.255.5 password REPLACE_WITH_SHARED_SECRET
 address-family ipv4 unicast
  network 10.20.0.0/16
  neighbor 172.20.255.5 activate
  neighbor 172.20.255.5 route-map FROM-CLOUD in
  neighbor 172.20.255.5 route-map TO-CLOUD out
 exit-address-family
!
```

Without `le` or `ge`, these prefix lists match only the stated network and prefix length. The policies reject unmatched routes. Review and add new business prefixes individually instead of permitting `0.0.0.0/0 le 32` or unconditionally redistributing all connected / static routes.[FRR prefix filtering](https://docs.frrouting.org/en/stable-10.4/filter.html).

## 06 / Design failover in both directions

IDC to cloud: set LOCAL_PREF 200 for cloud routes received on A and 100 on B. The two CPEs and IDC core need existing iBGP or route-reflector connectivity to exchange candidate routes, with reachable next hops. Use mechanisms such as `next-hop-self` according to that design. LOCAL_PREF values are not automatically shared between independent devices; the IDC cannot make this common choice until internal routing carries the routes.

Cloud to IDC: prepend `65050` twice on B's advertisement of the same IDC prefix. With other priorities equal, the cloud can prefer A's shorter AS_PATH. Cloud policies and more-specific routes also affect selection, so verify the active path in ECR / TR.[FRR route maps](https://docs.frrouting.org/en/stable-10.4/routemap.html).

Both circuits must advertise identical business prefixes for these attributes to select between them. If A advertises a `/16` while B advertises a contained `/24`, traffic to that `/24` follows the more-specific route; prepending cannot reverse longest-prefix matching. The IDC core must not retain an untracked static cloud route permanently pointing to A. Inspect forward and return paths, including session state on stateful firewalls.

## 07 / Check cloud and return routes table by table

For this direct ECR-to-VPC example, verify:

- CPE-A / CPE-B receive `10.60.0.0/16`, advertise `10.20.0.0/16` to their VBRs and have reachable forwarding next hops.
- VBR-A / VBR-B learn the IDC prefix, with circuit-side next hops `.2` and `.6` respectively.
- ECR shows the IDC routes from both VBRs, the selected path and business routes toward the VPC.
- The route table actually used by the target ECS instance's vSwitch has an effective return route matching `10.20.0.0/16` toward ECR.
- The IDC core and hosts have usable forwarding routes to the cloud, and returning IDC traffic can reach the correct internal gateways from the CPEs.

With existing CEN / Enterprise TR, do not attach the same VPC directly to ECR without reviewing its current dynamic source. A VPC attached to TR with route synchronization enabled cannot simultaneously receive another dynamic route source. Use ECR → TR → VPC or preserve VBR → TR → VPC as appropriate after inventorying existing attachments and route sources.

On TR, association selects the route table consulted for an incoming attachment, while propagation determines which attachments contribute routes to that table. Check ECR / VBR and VPC attachment associations and propagation, as well as cloud-route advertisement toward ECR / VBR.[TR route propagation](https://help.aliyun.com/zh/cen/user-guide/route-learning/), [VBR attachment settings](https://help.aliyun.com/zh/cen/user-guide/connect-vbrs).

When creating a VPC attachment, TR can add three private-space aggregate routes toward TR to the VPC route tables by default. This differs from automatically synchronizing every dynamic more-specific route into the VPC. Whether using aggregates, dynamic synchronization or explicit static routes, verify longest-prefix matching and conflicts in the table used by the application subnet. Seeing the IDC prefix on TR alone is insufficient.[VPC attachment and route settings](https://help.aliyun.com/en/cen/user-guide/connect-vpcs/).

## 08 / Allow application access and internal DNS

After routes reach forwarding tables, configure ECS security groups, network ACLs, IDC firewalls and host firewalls for the required application ports. Use approved IDC / VPC source networks. Stateless ACLs also need the response direction and client ephemeral ports accounted for. Routing allowlists do not replace application access controls.

Here, an accessible internal DNS server resolves `app.corp.example.com` to `10.60.10.20`. DNS queries and responses need working routes too. A successful private-IP ping does not establish working hostname access. Retaining source addresses aids auditing; this example applies no SNAT to IDC-to-VPC traffic.

A physical circuit provides a private transport path; that alone does not establish end-to-end application encryption. Continue using TLS or separately design a supported encryption tunnel according to data requirements. Keep application certificate validation enabled during connectivity diagnosis.

## 09 / BFD, alerts and application probes

Stabilize BGP and basic application access before enabling mutually compatible BFD. Confirm single-hop / multihop operation, control-packet mode and timing against the real circuit. The shortest available interval is not a universal setting. Alibaba Cloud's ECR primary / backup example uses 1000ms transmit and receive intervals with multiplier 3. Actual values depend on both peers' capabilities and negotiation; they do not promise an application recovery time.[Official BFD parameter example](https://help.aliyun.com/zh/express-connect/use-cases/local-idc-can-use-ecr-to-route-leased-line-link-to-the-cloud).

FRR also requires bfdd enabled and running, with BFD associated with the corresponding BGP neighbor. Check session state and negotiated parameters. BFD accelerates link failure detection but does not assess application health or prove reachability of every remote business network.[FRR BFD](https://docs.frrouting.org/en/stable-10.4/bfd.html).

Alert on neighbor Down, unexpected route counts, BFD changes, interface errors / drops, utilization and bidirectional application probes. Set receive limits and warning headroom from the approved advertisement inventory. Account for possible more-specific routes during aggregate-policy changes; an undersized hard limit can repeatedly tear down a session.

## 10 / Validate each layer and test failover

On CPE-A, inspect sessions, advertisements and forwarding. On CPE-B, substitute neighbor `172.20.255.5`:

```sh
sudo vtysh -c 'show bgp ipv4 unicast summary'
sudo vtysh -c 'show bgp ipv4 unicast 10.60.0.0/16'
sudo vtysh -c 'show bgp ipv4 unicast neighbors 172.20.255.1 advertised-routes'
sudo vtysh -c 'show ip route 10.60.10.20'
sudo vtysh -c 'show bfd peers'
```

Skip the last command if BFD is not enabled. Record prefixes, next hops, best paths and session uptime in both directions. `Established` means the session is up; compare it with cloud-console routes and actual host access.

From the IDC test host, validate application access. Install the diagnostic tools beforehand and create the internal DNS record. This HTTPS example uses a trusted CA; install a private CA into the trust store through the supported process when needed.

```sh
ip route get 10.60.10.20
ping -c 4 10.60.10.20
dig @10.20.0.53 app.corp.example.com A
curl --connect-timeout 5 --max-time 15 \
  --resolve app.corp.example.com:443:10.60.10.20 \
  https://app.corp.example.com/health
```

`--resolve` isolates IP connectivity, TLS and application access; it does not replace the DNS test above. From the cloud test host, check `ip route get 10.20.10.10` and access an approved IDC test service. If small packets work but larger requests stall, inspect path MTU and PMTUD instead of blindly reducing application-host MTU.

In a maintenance window or lab, confirm B is usable before performing an approved A-side failure test. Alibaba Cloud provides an Express Connect failover-test function to simulate circuit failures. Also test IDC border-device and internal-routing failures separately.[Express Connect failover tests](https://help.aliyun.com/zh/express-connect/user-guide/failover-test).

- A fails: record neighbor / BFD Down, cloud and IDC best-path transitions to B, and application failure rate.
- Service recovers: test new connections and sustained requests in both directions; do not assume existing TCP sessions survive without interruption.
- A returns: confirm the intended primary path is restored, routes do not keep flapping, and B remains available as backup.
- Keep evidence: measure detection, route convergence and application recovery separately, then compare them with recovery objectives.

## 11 / Troubleshoot by layer

- Idle / Active peers: check interfaces, VLANs, /30 addressing, TCP 179, ASNs and shared secrets before changing business routes.
- Established without IDC prefixes: check the exact route on the CPE, the `network` statement and export policy.
- No cloud routes at the IDC: check ECR / TR attachments, cloud advertisements and matching CPE import rules.
- One-way connectivity: inspect the application VPC table, IDC core return routes, firewalls, stateful sessions and reverse-path checks.
- IP works but hostname fails: inspect internal DNS records, resolver routes and DNS firewall rules.
- Traffic still uses failed A: inspect internal static routes, stale next hops, missing withdrawals and more-specific routes still pointing to A.
- BFD keeps going Down: inspect modes, negotiated timers, control-packet policies and congestion before broadening access rules.

## 12 / Change records and rollback

Save cloud attachment relationships, active routes, CPE configuration and bidirectional probe baselines before changes. Establish and validate the backup path first, then adjust primary-path preference. Avoid changing addresses, ASNs, VLANs and advertisement scope together during one cutover.

Rollback restores the previous route policies and advertisement inventory. Confirm the original path works, withdraw newly introduced prefixes or restore preferences, validate applications and DNS from both sides, then clean up unused attachments. Remove replacement routes only once the rollback path has been verified. Keep prefix ownership, circuit delivery details, configuration versions and the latest failover-test results for ongoing operations.

## References

- [Alibaba Cloud: Express Connect getting started](https://help.aliyun.com/zh/express-connect/getting-started/getting-started-guide)
- [Alibaba Cloud: VBR-to-VPC connections and current alternatives](https://help.aliyun.com/zh/express-connect/user-guide/create-and-manage-a-vbr-to-vpc-connection)
- [Alibaba Cloud: Create and manage VBRs](https://help.aliyun.com/zh/express-connect/user-guide/create-and-manage-a-vbr)
- [Alibaba Cloud: Create and manage ECR](https://help.aliyun.com/zh/express-connect/user-guide/create-and-manage-the-leased-line-gateway-ecr)
- [Alibaba Cloud: Configure and manage BGP](https://help.aliyun.com/zh/express-connect/user-guide/configure-and-manage-bgp/)
- [Alibaba Cloud: ECR circuit path selection](https://help.aliyun.com/zh/express-connect/use-cases/local-idc-can-use-ecr-to-route-leased-line-link-to-the-cloud)
- [Alibaba Cloud: TR route propagation](https://help.aliyun.com/zh/cen/user-guide/route-learning/)
- [Alibaba Cloud: VBR attachments](https://help.aliyun.com/zh/cen/user-guide/connect-vbrs)
- [Alibaba Cloud: VPC attachments](https://help.aliyun.com/en/cen/user-guide/connect-vpcs/)
- [Alibaba Cloud: Express Connect failover tests](https://help.aliyun.com/zh/express-connect/user-guide/failover-test)
- [FRRouting 10.4: BGP](https://docs.frrouting.org/en/stable-10.4/bgp.html)
- [FRRouting 10.4: Filtering](https://docs.frrouting.org/en/stable-10.4/filter.html)
- [FRRouting 10.4: Route Maps](https://docs.frrouting.org/en/stable-10.4/routemap.html)
- [FRRouting 10.4: BFD](https://docs.frrouting.org/en/stable-10.4/bfd.html)
