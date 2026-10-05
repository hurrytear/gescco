---
{"title":"GRE tunnels and security: EG3210 and Linux with public IPs or NAT","category":"Networking & proxies","kind":"Practical notes","date":"2026-10-05","summary":"Annotated GRE examples for a Ruijie EG3210 and Linux, covering two public endpoints or one endpoint behind NAT, protocol 47 mappings, access control, IPsec protection, MTU validation and rollback.","tags":["GRE","EG3210","Linux","NAT","IPsec"]}
---
GRE connects networks through a Layer 3 tunnel and can carry routed traffic and certain multicast workloads. This article uses a Ruijie RG-EG3210 and Linux to explain two cases: public IP addresses on both endpoints, and a public Linux endpoint with the EG3210 behind NAT. Addresses are fictional. Sources were checked on 2026-10-05; no real gateway was accessed and no tunnel was deployed.

**GRE provides neither encryption nor peer authentication. Protect production traffic over the public Internet with IPsec or another suitable encrypted layer before connecting workloads. The native GRE examples below explain encapsulation and routing in a controlled lab; they are not a complete secure VPN deployment.**

## 01 / GRE protocol and security boundaries

Native GRE over IPv4 uses **IP protocol number 47**, not TCP port 47 or UDP port 47. Select GRE / IP protocol 47 in the firewall. A port-forwarding interface limited to TCP and UDP cannot provide this mapping. Ordinary GRE does not require the PPTP control connection or TCP port 1723. [GRE specification](https://www.rfc-editor.org/rfc/rfc2784.html).

Outer addresses deliver packets to the tunnel endpoints. Tunnel addresses support communication across the virtual link. Business subnets identify the internal networks to connect. These serve different purposes. This example uses Layer 3 `gre`, not Layer 2 `gretap`, and does not extend an office broadcast domain across the Internet.

A GRE key is an optional, visible flow identifier, not a password or pre-shared secret. A checksum is not cryptographic integrity protection. These examples omit key, checksum and sequence extensions to reduce initial interoperability variables. If required, both endpoints must support matching transmit and receive settings. [GRE key and sequence extensions](https://www.rfc-editor.org/rfc/rfc2890.html).

Restricting public source addresses reduces scanning and accidental access but does not replace cryptographic authentication. Controls should cover outer peer restrictions, decapsulated source validation and application ACLs, encryption, route boundaries and isolated management access.

## 02 / EG3210 model, firmware and prerequisites

Distinguish the RG-EG3210 from the RG-EG3210 V2. Record the actual RGOS version, interfaces, routes, NAT rules and security zones. The product specifications list GRE and IPsec capabilities, but **IPv4-over-IPv4 support, CLI syntax and encryption algorithms must be confirmed for the installed firmware**. A model name does not establish identical support for every mode and command. [RG-EG3210 specifications](https://www.ruijie.com.cn/cp/aq-zhwg/eg3210/).

The EG3200 implementation guide's VPN / GRE over IPsec chapter documents `interface tunnel`, `tunnel source`, `tunnel destination` and static routes. It configures GRE through the CLI. The examples below follow that basic structure; check the current release for a Web interface or an explicit GRE mode command. [Official EG3200 implementation guide](https://www.ruijie.com.cn/fw/wd/82344/).

- Step 1: Back up running and startup configurations. Retain Console or independent management access and the original remote access path.
- Step 2: Confirm GRE over IPv4 in device help and the matching firmware guide. If only other encapsulation modes are supported, stop applying this IPv4 example.
- Step 3: Check for conflicts in Tunnel numbers, Linux interface names, addresses and routes. LAN subnets must not overlap.
- Step 4: Prepare access controls and return routes before building the tunnel in a maintenance window. Save device configuration after validation.
- Step 5: Cloud security groups, host firewalls, edge devices and the carrier path must permit the chosen outer protocol. Working HTTPS does not establish GRE reachability.

Linux has iproute2 installed. Interface names are `wan0` and `lan0`; replace them with the actual names, such as `eth0` or `ens3`. A public IP must actually belong to the tunnel endpoint. If a cloud VM sees only a private address while its provider maps a public address, check it as a NAT case, including the provider's protocol support.

## 03 / Scenario A: two public IP addresses

Both endpoints already have working WAN and LAN configurations. Linux acts as the IDC Layer 3 gateway, with `10.60.0.1/24` already assigned to `lan0`. Public example addresses are from documentation ranges and **cannot be used on the Internet**. Replace addresses, gateways and subnets with your own plan.

```text
Office LAN 10.20.0.0/24
        |
        EG3210
        WAN: 198.51.100.10/24, gateway: 198.51.100.1
        Tunnel 1: 172.20.255.1/30
        |
        | Internet: IPv4 + GRE, protocol 47
        |
        Linux
        wan0: 203.0.113.20/24, gateway: 203.0.113.1
        gre-office: 172.20.255.2/30
        lan0: 10.60.0.1/24
        |
IDC LAN 10.60.0.0/24

EG3210 route: 10.60.0.0/24 -> Tunnel 1
Linux route: 10.20.0.0/24 -> 172.20.255.1 via gre-office
Public peer /32 routes remain on the physical WAN path.
```

The public GRE peer must remain reachable through the underlying WAN. Routing it into GRE causes recursive encapsulation or a black hole. Add only the remote LAN route here; keep the default route outside the tunnel. Resolve overlapping business subnets or design a separate translation scheme before adding conflicting routes.

## 04 / Scenario A: annotated EG3210 configuration

The following RGOS CLI structure follows the official guide. Use it after confirming that the current Tunnel default or selected mode is GRE over IPv4. Retain existing WAN addresses, default routes, NAT and security zones. Do not overwrite the device with another model's complete configuration.

```text
configure terminal
ip route 203.0.113.20 255.255.255.255 198.51.100.1
interface tunnel 1
 tunnel source 198.51.100.10
 tunnel destination 203.0.113.20
 ip address 172.20.255.1 255.255.255.252
 exit
ip route 10.60.0.0 255.255.255.0 tunnel 1
end
```

- The `203.0.113.20/32` route pins the public Linux peer to the real WAN next hop. Verify policy routing and egress selection when multiple WAN links exist.
- `tunnel source` is the EG3210's actual WAN address, not its tunnel address.
- `tunnel destination` is the Linux peer's reachable outer address.
- `ip address` assigns the internal tunnel address. The `/30` endpoints are `.1` and `.2`.
- `ip route 10.60.0.0 ... tunnel 1` sends only the IDC business subnet into the tunnel.

If the release requires `tunnel mode gre ip` or an interface enable command, use the syntax shown by device help. These version-specific commands are not presented as mandatory on every model. Coordinate the Tunnel's inner MTU with Linux at 1400 through the supported interface setting. If the command is `ip mtu 1400`, confirm it in interface help first. This is a starting value; see section 10 for measurement.

Exempt office-to-IDC traffic from Internet source NAT. Confirm that `10.20.0.0/24 → 10.60.0.0/24` retains its intended source address. Permit approved business traffic and necessary diagnostics in security zones / ACLs instead of trusting all Tunnel traffic. NAT exemption and ACL syntax depend on the installed RGOS release.

## 05 / Scenario A: temporary Linux configuration

Inspect the current configuration and verify that the example public address actually exists on `wan0`. The commands below configure runtime state, normally lost at reboot. Use a controlled lab first and retain the existing network management tool. `local` must be an address already assigned to this host. [Linux ip-tunnel manual](https://man7.org/linux/man-pages/man8/ip-tunnel.8.html).

```sh
# Inspect addresses, routes and existing tunnels before adding anything.
ip -br address
ip route show
ip tunnel show

# Load the GRE module without disabling the firewall.
sudo modprobe ip_gre

# Keep the outer public peer on WAN; use the actual next-hop gateway.
sudo ip route add 198.51.100.10/32 via 203.0.113.1 dev wan0

# local belongs to Linux; remote is the EG3210 public address.
# dev constrains outer egress; no key is used and TTL is fixed at 64.
sudo ip tunnel add gre-office mode gre \
  local 203.0.113.20 remote 198.51.100.10 dev wan0 ttl 64

# Use distinct inner addresses in the same /30 on the two endpoints.
sudo ip address add 172.20.255.2/30 dev gre-office
sudo ip link set dev gre-office mtu 1400 up

# Route office return traffic through GRE without changing the default.
sudo ip route add 10.20.0.0/24 via 172.20.255.1 dev gre-office
```

If a route or interface already exists, inspect its ownership and configuration. Do not blindly delete it or use `replace` to continue. Tunnel-address communication alone does not require IP forwarding. Connecting both LANs requires forwarding, FORWARD rules and return routes from all participating hosts.

```sh
# Record the original value. Enable forwarding only for a LAN gateway.
sysctl net.ipv4.ip_forward
sudo sysctl -w net.ipv4.ip_forward=1

# Inspect reverse-path validation first; symmetric routing needs no relaxation.
sysctl net.ipv4.conf.all.rp_filter
sysctl net.ipv4.conf.wan0.rp_filter
sysctl net.ipv4.conf.gre-office.rp_filter

# Consider loose mode only after proving strict mode rejects valid asymmetry.
# Change only affected interfaces; do not disable source validation globally.
# sudo sysctl -w net.ipv4.conf.wan0.rp_filter=2
# sudo sysctl -w net.ipv4.conf.gre-office.rp_filter=2
```

Linux `rp_filter=1` validates the best reverse path; `2` checks source reachability through any interface. The effective value is the maximum of `all` and the interface setting. Fix routing first. Changing `ip_forward` can also reset IPv4 host / router parameters, so recheck security settings afterward. [Linux forwarding and reverse-path validation](https://docs.kernel.org/networking/ip-sysctl.html).

Office hosts must return traffic for `10.60.0.0/24` through the EG3210. IDC hosts must return traffic for `10.20.0.0/24` through `10.60.0.1`, or their existing core gateway must have the equivalent route. Avoid blanket MASQUERADE as a substitute for correct return routing and source validation.

## 06 / Scenario B: public Linux, EG3210 behind NAT

This case adds a manageable upstream NAT gateway. The EG3210's real WAN address is `10.0.0.2`; the upstream gateway's inside address is `10.0.0.1` and its fixed public address is `198.51.100.30`. Linux remains at `203.0.113.20`. Tunnel addresses and LAN subnets stay the same as scenario A.

```text
Office LAN 10.20.0.0/24
        |
EG3210 WAN 10.0.0.2/24, gateway 10.0.0.1
Tunnel 1: 172.20.255.1/30
        |
Upstream NAT gateway
inside: 10.0.0.1/24
outside: 198.51.100.30 (fixed public IP)
GRE protocol mapping: 198.51.100.30 <-> 10.0.0.2
restricted public peer: 203.0.113.20
        |
Internet
        |
Linux wan0: 203.0.113.20
gre-office: 172.20.255.2/30
        |
IDC LAN 10.60.0.0/24

EG3210: source 10.0.0.2, destination 203.0.113.20
Linux: local 203.0.113.20, remote 198.51.100.30
```

**The upstream must forward and translate IP protocol 47 in both directions, with an unambiguous mapping to this EG3210.** Use GRE-specific static DNAT / SNAT, or dedicated one-to-one NAT with restrictive firewall rules. A “PPTP passthrough” switch alone does not establish ordinary GRE support: packet formats and connection tracking may differ.

Build the following in a separate lab setup. If switching from scenario A, first remove that lab tunnel and its routes using the rollback procedure. Do not stack both configurations under the same interface name.

```text
configure terminal
ip route 203.0.113.20 255.255.255.255 10.0.0.1
interface tunnel 1
 tunnel source 10.0.0.2
 tunnel destination 203.0.113.20
 ip address 172.20.255.1 255.255.255.252
 exit
ip route 10.60.0.0 255.255.255.0 tunnel 1
end
```

The EG3210 uses its own private WAN address for `tunnel source`. The public `198.51.100.30` belongs to the upstream NAT gateway and cannot simply be declared as an EG3210 local address. Linux uses that public NAT address as `remote`:

```sh
# Replace scenario A's creation commands; do not create the same tunnel twice.
sudo modprobe ip_gre
sudo ip route add 198.51.100.30/32 via 203.0.113.1 dev wan0
sudo ip tunnel add gre-office mode gre \
  local 203.0.113.20 remote 198.51.100.30 dev wan0 ttl 64
sudo ip address add 172.20.255.2/30 dev gre-office
sudo ip link set dev gre-office mtu 1400 up
sudo ip route add 10.20.0.0/24 via 172.20.255.1 dev gre-office
```

If Linux is behind NAT instead, reverse the arrangement: Linux `local` is its actual private interface address, EG3210 `tunnel destination` is the NAT public address, and the upstream directs GRE to Linux. Keep tunnel addresses and business routes paired consistently.

Ordinary PAT, unmanaged carrier-grade NAT, GRE filtering, competing mappings or changing public addresses provide no reliable guarantee for this fixed-peer native GRE design. Sending first or continuously pinging from behind NAT is not general NAT traversal. DDNS does not automatically refresh an already configured fixed tunnel endpoint. Consider NAT-T IPsec or a VPN / relay supported by both endpoints instead.

## 07 / Upstream NAT protocol mapping example

This nftables sample illustrates translation on the **third, upstream NAT gateway**, not on the public Linux tunnel server. Its WAN interface is `wan0`; it owns or is correctly routed the public address `198.51.100.30` and can reach EG3210 at `10.0.0.2`. It serves one explicit peer and one internal endpoint. Multiple endpoints sharing one public IP need separate mapping and conntrack validation. [nftables NAT](https://wiki.nftables.org/wiki-nftables/index.php/Performing_Network_Address_Translation_(NAT)).

```nft
# Illustrative upstream Linux NAT file; do not overwrite existing NAT rules.
table ip gre_nat_sample {
  chain prerouting {
    type nat hook prerouting priority dstnat; policy accept;
    # Deliver GRE only from the specified public peer to EG3210.
    iifname "wan0" ip saddr 203.0.113.20 ip daddr 198.51.100.30 ip protocol 47 counter dnat to 10.0.0.2
  }
  chain postrouting {
    type nat hook postrouting priority srcnat; policy accept;
    # Use the fixed public address for EG3210 GRE packets to this peer.
    oifname "wan0" ip saddr 10.0.0.2 ip daddr 203.0.113.20 ip protocol 47 counter snat to 198.51.100.30
  }
}
```

Save the lab example as `gre-nat-sample.nft`. Inspect existing rules and check the file before any loading:

```sh
# Run only on the upstream Linux NAT gateway; --check installs no rules.
sudo nft list ruleset
sudo nft --check --file gre-nat-sample.nft
```

The upstream also needs IPv4 forwarding and address-restricted FORWARD permissions. **NAT does not grant access.** After DNAT the filtered destination is `10.0.0.2`. Validate return routing, conntrack, existing NAT priorities and acceleration. Do not use an unrestricted DMZ or disable the entire firewall to get connectivity. This fragment has not been verified on every home router, cloud NAT or EG firmware.

## 08 / Filter outer GRE and inner applications separately

For a native GRE lab, Linux WAN INPUT permits protocol 47 only from the actual peer: `198.51.100.10` for scenario A, `198.51.100.30` for scenario B. A default-deny OUTPUT policy also needs the corresponding outbound rule. Security groups must support GRE / protocol numbers rather than a port entry.

The following are **fragments for existing nftables chains**, not a complete loadable file. Scenario A permits only TCP 443 on the IDC test server `10.60.0.10`; adapt application rules to the actual requirement. [nftables packet matching](https://wiki.nftables.org/wiki-nftables/index.php/Matching_packet_headers).

```nft
# INPUT: outer GRE on physical WAN, before existing terminal rejection rules.
iifname "wan0" ip saddr 198.51.100.10 ip daddr 203.0.113.20 ip protocol 47 counter accept
# Reject other GRE sources on this interface before broad bypassing allows.
iifname "wan0" ip protocol 47 counter drop

# INPUT: allow peer tunnel diagnostic requests / replies, reject other local services.
iifname "gre-office" ip saddr 172.20.255.1 ip daddr 172.20.255.2 icmp type { echo-request, echo-reply } counter accept
# Add any explicitly approved local applications and necessary ICMP errors before this drop.
iifname "gre-office" counter drop

# FORWARD: validate inner sources before existing state and application logic.
iifname "gre-office" ip saddr != 10.20.0.0/24 counter drop
# Allow office access only to the approved IDC HTTPS service.
iifname "gre-office" oifname "lan0" ip saddr 10.20.0.0/24 ip daddr 10.60.0.10 tcp dport 443 ct state { new, established } counter accept
# Bind return traffic to interfaces, addresses and established state.
iifname "lan0" oifname "gre-office" ip saddr 10.60.0.10 ip daddr 10.20.0.0/24 tcp sport 443 ct state established counter accept
# Reject unmatched tunnel forwarding in both directions.
iifname "gre-office" counter drop
oifname "gre-office" counter drop
```

INPUT and FORWARD are separate chains. Applications hosted on Linux need local INPUT permissions. The tunnel ping rule does not allow arbitrary pings from the remote LAN. Merge necessary ICMP errors / PMTU handling into existing policy to avoid large-packet black holes; do not reject all ICMP.

Inspect the position of `ct state established,related`, other base chains, UFW / firewalld, flowtables and hardware offload. Place each chain's tunnel restriction block before broad rules that might accept all tunnel traffic early. Arrange necessary ICMP error handling explicitly before the final tunnel drops. An `accept` in an earlier chain does not override a later chain's drop. Apply the same outer and inner separation on EG3210, keeping SSH, Web management and other management subnets inaccessible through GRE by default.

## 09 / Public production traffic: add IPsec first

The EG3200 guide demonstrates GRE over IPsec, but its historical chapter uses legacy 3DES, MD5 and DH2 parameters. This article references the GRE structure only and **does not recommend those algorithms or the sample password**. Check the shared capabilities of the actual RGOS release and Linux strongSwan. Prefer supported IKEv2, reliable peer authentication and algorithms allowed by current security policy.

- Step 1: Establish why GRE is needed. For ordinary unicast connectivity between IPv4 subnets, direct site-to-site IPsec may remove an unnecessary encapsulation layer.
- Step 2: If GRE is required, choose a mutually supported GRE over IPsec design. Specify transport / tunnel mode, GRE endpoints, identities and traffic selectors. Protecting the fixed public native GRE example means covering protocol 47 between outer endpoints, not mistakenly selecting the tunnel `/30` or only the business subnets.
- Step 3: For NAT, verify NAT-T and GRE nesting compatibility. The NAT-side endpoint usually initiates IKE. Another design protects a pair of private GRE endpoints inside an IPsec tunnel; this requires new GRE addresses, routes and selectors, rather than reusing section 06's native GRE mappings.
- Step 4: After authentication and negotiation, prove that GRE traffic increments the correct CHILD_SA's encryption and decryption counters in both directions. Established IKE alone does not prove protection.
- Step 5: Enforce fail-closed behavior so losing the SA cannot send the same GRE traffic unencrypted over WAN. Retain independent management access and test this failure in a controlled environment.

IPsec NAT-T encapsulates ESP in UDP 4500, normally with UDP 500 for initial IKE. ESP without UDP encapsulation uses IP protocol 50. **UDP 4500 provides IPsec NAT traversal; it does not turn native GRE into UDP.** Permit the selected IKE / ESP transport and reject public plaintext GRE. Do not retain section 08's native GRE allow rule unconditionally in the encrypted design. [ESP UDP encapsulation](https://www.rfc-editor.org/rfc/rfc3948.html), [strongSwan NAT-T](https://docs.strongswan.org/docs/latest/features/natTraversal.html).

On Linux, `swanctl --list-sas` shows negotiated SAs; inspect local XFRM policies and outer captures as well. Check GRE state, IPsec state and traffic counters on the device. Captures and XFRM state can contain business payloads or key material; keep them controlled and never publish complete outputs. The site's [strongSwan installation notes](/en/notes/strongswan-ikev2-vpn/) introduce Linux components, but their remote-access EAP configuration is not an EG3210 site-to-site configuration.

## 10 / MTU, MSS and tunnel health

IPv4 + GRE without optional fields adds at least 20 + 4 = 24 bytes. With an underlying IP MTU of 1500, a simple inner ceiling is 1476. PPPoE, GRE keys, additional encapsulation and IPsec change this budget. Do not use 1476 universally. Start with an **inner MTU of 1400**, coordinate both endpoints, measure the path and lower it further if needed.

```sh
# The public peer must use WAN; the business subnet must use GRE.
ip route get 198.51.100.10
ip route get 10.20.0.10
ip -d link show dev gre-office
ip -s link show dev gre-office

# Test from Linux's tunnel address; permit diagnostics on EG3210 first.
ping -I 172.20.255.2 -c 4 172.20.255.1

# IPv4 ICMP: 1372 payload + 20 IP + 8 ICMP = 1400 bytes.
# -M do forbids fragmentation. Investigate failures before lowering payload.
ping -I 172.20.255.2 -M do -s 1372 -c 4 172.20.255.1

# Observe native GRE only during controlled testing; do not publish raw captures.
sudo tcpdump -ni wan0 'ip proto 47 and host 198.51.100.10'
```

For scenario B, replace `198.51.100.10` with `198.51.100.30` in the two public-peer checks above. With IPsec, inspect its actual IKE / ESP outer traffic; protected business traffic should not appear as plaintext GRE on WAN. [Linux ping PMTU options](https://man7.org/linux/man-pages/man8/ping.8.html).

At MTU 1400, a starting MSS budget for standard IPv4 / TCP headers is 1360. If necessary, adjust TCP SYN MSS through the existing supported firewall configuration and test both directions. MSS affects TCP, not UDP or ICMP packet sizes. Preserve required ICMP fragmentation-needed feedback instead of first disabling PMTU or ignoring DF.

An UP interface indicates local state, not peer or application reachability. Linux GRE does not guarantee interoperability with every vendor's GRE keepalive. Use application probes, or BFD / dynamic routing when explicitly supported by both sides. Start with static routes and avoid distributing an entire office routing table without filters.

## 11 / Persistence and reboot validation

Runtime `ip` commands do not automatically become persistent configuration. This example is only for systems whose **WAN is already managed by systemd-networkd**. Retain NetworkManager, Netplan or cloud-init management where applicable instead of having competing tools manage the same interface.

For scenario A, create `/etc/systemd/network/30-gre-office.netdev`:

```ini
# Scenario A; change only Remote to 198.51.100.30 for scenario B.
[NetDev]
Name=gre-office
Kind=gre
MTUBytes=1400

[Tunnel]
Local=203.0.113.20
Remote=198.51.100.10
TTL=64
```

Create `/etc/systemd/network/30-gre-office.network` for the inner address and business route:

```ini
[Match]
Name=gre-office

[Network]
Address=172.20.255.2/30
LinkLocalAddressing=no

[Route]
Destination=10.20.0.0/24
Gateway=172.20.255.1
```

**Merge the following fields into the corresponding sections of the existing `.network` file that matches `wan0`.** Do not shadow the current configuration with an incomplete new WAN file. Retain its addresses, default route and DNS. Avoid duplicating an existing peer `/32` route.

```ini
# Merge into the existing WAN [Network]; this is not a complete standalone file.
[Network]
Tunnel=gre-office

# For scenario B, change Destination to 198.51.100.30/32.
[Route]
Destination=198.51.100.10/32
Gateway=203.0.113.1
```

See [systemd.netdev](https://man7.org/linux/man-pages/man5/systemd.netdev.5.html) and [systemd.network](https://man7.org/linux/man-pages/man5/systemd.network.5.html). After checking the configuration, reload and reconfigure relevant interfaces in a maintenance window with Console access. Reconfiguring WAN can interrupt remote access. Plan the handover from a manually created tunnel to networkd to avoid a same-name interface conflict.

Persist required forwarding and other sysctl settings through the host's existing configuration mechanism. Ensure firewall and IPsec fail-closed policy are effective before business traffic starts. Save EG3210 configuration through the current firmware's supported mechanism. Reboot each endpoint and the upstream NAT gateway separately, then recheck addresses, routes, encryption, restrictions and applications before accepting persistence.

## 12 / Validation, troubleshooting and rollback

- Step 1: Confirm local source addresses and physical egress. Public peer `/32` routes must not enter GRE. A failed public ping alone is inconclusive when ICMP is blocked.
- Step 2: Check protocol 47 for two public endpoints. For NAT, also inspect addresses before and after translation and counters in both directions.
- Step 3: Test tunnel `.1` and `.2` and MTU. If outer packets arrive without inner traffic, inspect endpoints, GRE extensions, ACLs and `rp_filter`.
- Step 4: Access the approved IDC service from a real office host and check return traffic. If tunnel ping works but LAN access fails, inspect forwarding, application ACLs, LAN gateways and NAT exemptions.
- Step 5: Verify rejection of unapproved services, other internal sources and management subnets. Production also requires verified encryption and no plaintext fallback when SAs fail.
- Step 6: In a controlled environment, test large packets, recovery after idle periods, upstream restart and endpoint reboots. Record application loss / latency and counter changes.

Small pings working while HTTPS or large transfers stall often calls for MTU / PMTU investigation. Idle disconnections or recovery only after initiating traffic suggest NAT state and timeout issues. For one-way traffic with multiple WANs or cloud hosting, check policy routing, reverse-path validation, security groups and per-egress translation.

Roll back new business routes first and restore the original application path, then remove the newly created tunnel. Remove only this change's NAT, ACL and persistent settings and restore recorded sysctl values. Do not flush the ruleset or disable existing interfaces. Scenario A's temporary Linux example rolls back as follows:

```sh
# Remove only entries created by this lab; do not delete pre-existing settings.
sudo ip route del 10.20.0.0/24 via 172.20.255.1 dev gre-office
sudo ip tunnel del gre-office
sudo ip route del 198.51.100.10/32 via 203.0.113.1 dev wan0
```

For scenario B, remove the newly added `198.51.100.30/32` peer route instead. Remove this change's route and Tunnel on EG3210 while retaining existing configuration. Withdraw persistent settings first or the network manager may recreate the interface. Verify restored Internet access, management and applications, with no continuing GRE / NAT counter growth.

## References

- [RFC 2784: GRE](https://www.rfc-editor.org/rfc/rfc2784.html)
- [RFC 2890: GRE key and sequence extensions](https://www.rfc-editor.org/rfc/rfc2890.html)
- [Ruijie RG-EG3210 specifications](https://www.ruijie.com.cn/cp/aq-zhwg/eg3210/)
- [EG3200 implementation guide, GRE over IPsec chapter](https://www.ruijie.com.cn/fw/wd/82344/)
- [Linux ip-tunnel](https://man7.org/linux/man-pages/man8/ip-tunnel.8.html)
- [Linux IP sysctl](https://docs.kernel.org/networking/ip-sysctl.html)
- [nftables NAT](https://wiki.nftables.org/wiki-nftables/index.php/Performing_Network_Address_Translation_(NAT))
- [nftables packet matching](https://wiki.nftables.org/wiki-nftables/index.php/Matching_packet_headers)
- [RFC 3948: ESP UDP encapsulation](https://www.rfc-editor.org/rfc/rfc3948.html)
- [strongSwan NAT Traversal](https://docs.strongswan.org/docs/latest/features/natTraversal.html)
- [Linux ping](https://man7.org/linux/man-pages/man8/ping.8.html)
- [systemd.netdev](https://man7.org/linux/man-pages/man5/systemd.netdev.5.html)
- [systemd.network](https://man7.org/linux/man-pages/man5/systemd.network.5.html)
