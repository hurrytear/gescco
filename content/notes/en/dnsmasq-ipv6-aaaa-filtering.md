---
{"title":"dnsmasq DNS forwarding: filtering versus keeping IPv6 answers","category":"Networking & proxies","kind":"Practical notes","date":"2026-10-26","summary":"Separate DNS forwarding, AAAA filtering and IPv6 routing; compare dnsmasq filter-AAAA with repeatable queries, appropriate uses and rollback steps.","tags":["dnsmasq","DNS","IPv6","AAAA","Dual stack"]}
---
When dnsmasq acts as a DNS forwarder, "filtering IPv6" usually means hiding **AAAA records** in DNS answers, not turning off the IPv6 protocol. This changes which addresses clients receive and may change their connection path; it does not configure routes or stop clients from using other resolvers. Sources were checked on 2026-10-26.

## 01 / Separate three independent paths

Clients query dnsmasq, which asks an upstream resolver: that is **DNS forwarding**. A records contain IPv4 addresses and AAAA records contain IPv6 addresses. The DNS packet itself can travel over IPv4 or IPv6 independently of the requested record type. [RFC 4472](https://www.rfc-editor.org/info/rfc4472/) explicitly allows querying AAAA over IPv4 and A over IPv6.

The eventual application connection follows a separate path. Dual-stack applications can look up both record types and try IPv6 or IPv4 according to connectivity; [Happy Eyeballs v2](https://www.rfc-editor.org/rfc/rfc8305.html) describes this behavior. An AAAA response does not prove that an IPv6 exit works. Filtering AAAA does not disable IPv6 on network interfaces, router advertisements, DHCPv6 or IPv6 firewall paths.

## 02 / Keep and filter AAAA with the same baseline

This isolated test forwarder listens only on `127.0.0.1:1053`. `192.0.2.54` is a documentation address and **must be replaced with a reachable test upstream** or both modes will fail. Check that the port is free, save any existing configuration and do not paste the example into a production gateway's global dnsmasq service. The [dnsmasq manual](https://dnsmasq.org/docs/dnsmasq-man.html) defines `no-resolv`, `server` and `filter-AAAA`.

```ini
# /path/to/lab-dnsmasq.conf (example path; replace the upstream address)
port=1053
listen-address=127.0.0.1
bind-interfaces
no-resolv
server=192.0.2.54
```

**No filter:** keep this configuration without `filter-AAAA`. dnsmasq forwards and caches common record types. If the name actually has an AAAA record, clients normally receive an IPv6 destination; application and system network policy then determine which address they connect to.

**Filter:** add the following line to the same configuration. `filter-AAAA` removes AAAA records from answers without deleting A records. It applies to answers from this instance, rather than defining a per-domain egress rule. Clients may still receive CNAME or other records. An empty AAAA answer does not mean the name does not exist: do not confuse an empty `NOERROR` answer with `NXDOMAIN`.

```ini
filter-AAAA
```

Only queries that pass through **this dnsmasq instance** are affected. Old client caches, direct queries to other DNS servers, application DoH, connections to literal IPv6 addresses and other address hints cannot be controlled by this option alone. IPv6-only / DNS64 / NAT64 environments can lose access to services that worked before AAAA filtering.

## 03 / Check upstream, forwarder and real clients

On a host where testing is permitted, first choose a domain **known to publish both A and AAAA** and replace `dual.example.com` with it; replace the example upstream too. Looking up `example.com` without confirming the upstream AAAA exists cannot establish whether filtering works. These commands only query and check syntax. Before starting a test instance, verify that the port and existing DNS services do not conflict and use an isolated environment.

```sh
dnsmasq --test --conf-file=/path/to/lab-dnsmasq.conf
dig @192.0.2.54 dual.example.com A +noall +comments +answer
dig @192.0.2.54 dual.example.com AAAA +noall +comments +answer
dig @127.0.0.1 -p 1053 dual.example.com A +noall +comments +answer
dig @127.0.0.1 -p 1053 dual.example.com AAAA +noall +comments +answer
```

The expected result: upstream has A and AAAA; the unfiltered forwarder returns both; after filtering it returns A but no AAAA. Check the full response status, CNAME and TTL rather than an empty `+short` line alone. From a real client, also confirm that DNS points at this forwarder, and inspect both IPv4 and IPv6 routes and connection results. A successful local `dig @127.0.0.1` says nothing about other devices' resolver selection.

## 04 / When to filter and how to roll back

- **Healthy dual stack:** usually keep AAAA and monitor both DNS and connections. Filtering hides IPv6 destinations globally and may break IPv6-only services.
- **Temporarily IPv4-only egress:** filtering AAAA may be a temporary compatibility policy that steers clients toward IPv4; verify that required services have A records first. It does not repair a broken IPv6 route.
- **Domain-based routing or dual WAN:** an IPv4 ipset plus IPv4 NAT may leave IPv6 connections on a different exit. Design IPv6 classification and routing separately, or restrict unsupported IPv6 paths at the gateway network layer. `filter-AAAA` is not a security boundary. See the site's [dual-WAN domain-routing guide](/en/notes/iptables-ipset-domain-dual-wan/).

To roll back, remove `filter-AAAA` from the test configuration, check syntax and the original listener, reload the relevant instance during a maintenance window, then retest both record types and connections from clients. Wait for or clear client DNS caches before comparing, so old answers are not mistaken for the new policy. Do not disable IPv6 across a network merely to change DNS answers.

## References

- [dnsmasq manual: forwarding, listening and filter-AAAA](https://dnsmasq.org/docs/dnsmasq-man.html)
- [RFC 4472: DNS record types and transport are independent](https://www.rfc-editor.org/info/rfc4472/)
- [RFC 8305: Happy Eyeballs v2](https://www.rfc-editor.org/rfc/rfc8305.html)
