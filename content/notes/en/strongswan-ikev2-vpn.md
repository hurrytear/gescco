---
{"title":"Build a strongSwan IKEv2 VPN: certificates, routing and DNS validation","category":"Networking & proxies","kind":"Practical notes","date":"2026-10-04","summary":"Build a password-authenticated remote-access VPN with swanctl, covering certificates, address pools, firewall rules, split routing and DNS, with lessons from maintaining older installations.","tags":["strongSwan","IKEv2","VPN","DNS"]}
---
Historical maintenance notes repeatedly exposed two gaps: a running service without a usable client tunnel, and successful authentication without a route to the intended network. This guide turns those lessons into a reproducible setup and validation workflow. All names, accounts and addresses are examples; no original environment configuration or logs are reproduced.

## 01 / Define the topology and scope

This guide targets a fresh Ubuntu 24.04 LTS host with IKEv2, a server certificate and EAP-MSCHAPv2 account authentication, managed through swanctl. Use distribution security updates rather than copying historical source-upgrade steps onto a new server. Run each command on the machine specified and replace the example values.

```text
Client → vpn.example.com → VPN gateway → Protected network
Public endpoint: 192.0.2.10 (documentation address; replace it)
Gateway LAN address: 10.20.0.10
Protected network: 10.20.0.0/24
Internal DNS: 10.20.0.53
Client address pool: 10.77.0.0/24
Internal test service: app.corp.example.com → 10.20.0.80
```

The gateway must already reach the protected network and DNS server. Choose a pool that overlaps neither server networks nor common client LANs. This is an IPv4 split-tunnel setup: only the specified private network enters the tunnel; other traffic uses the client's existing connection. It does not provide full-tunnel or IPv6 protection.

When managing the domain through Cloudflare, use a DNS-only A record for the VPN hostname. The normal website proxy does not carry this IKE/IPsec traffic. Do not publish an AAAA record for an unavailable IPv6 endpoint. See [proxy limitations](https://developers.cloudflare.com/dns/proxy-status/limitations/).

## 02 / Install and identify the running service

Install these packages on the new server. Do not run a second starter/charon service on the same ports. Inventory and back up an existing VPN host before choosing a migration path.

```sh
sudo apt update
sudo apt install charon-systemd strongswan-swanctl strongswan-pki \
  libcharon-extra-plugins libcharon-extauth-plugins \
  libstrongswan-standard-plugins
systemctl cat strongswan
systemctl show strongswan -p ExecStart -p FragmentPath -p DropInPaths
dpkg-query -W charon-systemd strongswan-swanctl
```

The charon-systemd service is named `strongswan` and accepts swanctl configuration through VICI. Check both the installed package version and the executable actually started by the service. Distribution versions can lag upstream major releases while carrying backported security fixes. See the [service documentation](https://docs.strongswan.org/docs/latest/daemons/charon-systemd.html).

EAP-MSCHAPv2 needs `eap-identity`, `eap-mschapv2` and a crypto plugin providing MD4/DES. The explicit standard-plugin package includes OpenSSL. MD4 is used internally by account authentication here; it is not a recommended IKE/ESP integrity algorithm. See [plugin dependencies](https://docs.strongswan.org/docs/6.0/interop/windowsClients.html).

## 03 / Issue the server certificate

Install `strongswan-pki` on an offline or controlled signing workstation and run this example there. Put the gateway name in both CN and SAN and include serverAuth usage. The client's remote identity must match that name. See [certificate requirements](https://docs.strongswan.org/docs/6.0/interop/windowsCertRequirements.html).

```sh
umask 077
mkdir -p vpn-pki
cd vpn-pki
pki --gen --type rsa --size 4096 --outform pem > ca-key.pem
pki --self --ca --lifetime 3652 --in ca-key.pem --type rsa \
  --dn "CN=Example VPN Root CA" --outform pem > ca-cert.pem
pki --gen --type rsa --size 3072 --outform pem > server-key.pem
pki --req --type priv --in server-key.pem \
  --dn "CN=vpn.example.com" --san vpn.example.com \
  --outform pem > server-request.pem
pki --issue --type pkcs10 --in server-request.pem \
  --cacert ca-cert.pem --cakey ca-key.pem --lifetime 365 \
  --flag serverAuth --outform pem > server-cert.pem
pki --print --in server-cert.pem
```

Securely transfer only `ca-cert.pem`, `server-cert.pem` and `server-key.pem` to the gateway. Keep the CA private key on the signing workstation. On the gateway, enter the temporary directory containing those three files and install them below. Keep private keys outside repositories and website directories.

```sh
sudo install -d -m 700 /etc/swanctl/private
sudo install -d -m 755 /etc/swanctl/x509 /etc/swanctl/x509ca
sudo install -m 600 server-key.pem /etc/swanctl/private/server-key.pem
sudo install -m 644 server-cert.pem /etc/swanctl/x509/server-cert.pem
sudo install -m 644 ca-cert.pem /etc/swanctl/x509ca/ca-cert.pem
```

Distribute the public CA certificate through a trusted channel and verify its fingerprint. With this private CA setup, clients need the CA certificate and account credentials, not the server's private key. Record the expiry date and renewal owner. See the [PKI guide](https://docs.strongswan.org/docs/latest/pki/pkiQuickstart.html).

## 04 / Configure the connection, pool and accounts

Edit `/etc/swanctl/swanctl.conf` on the new gateway. Do not overwrite existing connections on an older installation.

```conf
connections {
  remote-access {
    version = 2
    local_addrs = %any
    pools = vpn-pool
    send_cert = always
    encap = yes
    fragmentation = yes
    dpd_delay = 30s
    local {
      auth = pubkey
      id = vpn.example.com
      certs = server-cert.pem
    }
    remote {
      auth = eap-mschapv2
      eap_id = %any
    }
    children {
      private-net {
        local_ts = 10.20.0.0/24
        remote_ts = dynamic
        dpd_action = clear
      }
    }
  }
}
pools {
  vpn-pool {
    addrs = 10.77.0.0/24
    dns = 10.20.0.53
  }
}
include conf.d/vpn-secrets.conf
```

`local_ts` defines destinations the server permits through the tunnel; `remote_ts = dynamic` uses the negotiated client virtual address. `encap = yes` forces UDP encapsulation of ESP, matching the UDP 500/4500 firewall rules below. Default proposals provide an initial interoperability baseline. For deployment, establish a client-compatible crypto policy and inspect the negotiated algorithms. See the [configuration reference](https://docs.strongswan.org/docs/latest/swanctl/swanctlConf.html).

First create the account-file directory:

```sh
sudo install -d -m 700 /etc/swanctl/conf.d
```

Create `/etc/swanctl/conf.d/vpn-secrets.conf`, replace the placeholder with a unique, randomly generated strong password for each user, and restrict permissions. Never use the literal placeholder or share accounts.

```conf
secrets {
  eap-demo {
    id = vpn-demo
    secret = "REPLACE_WITH_A_UNIQUE_RANDOM_PASSWORD"
  }
}
```

```sh
sudo chmod 600 /etc/swanctl/conf.d/vpn-secrets.conf
sudo chmod 600 /etc/swanctl/swanctl.conf
```

This EAP-MSCHAPv2 setup depends on correct server certificate validation. Plan RADIUS or EAP-TLS separately when centralized account management or user certificates are required; changing the authentication name alone does not complete that migration.

## 05 / Enable forwarding and the return route

Save this as `/etc/sysctl.d/90-vpn-forward.conf` on the gateway:

```conf
net.ipv4.ip_forward = 1
```

```sh
sudo sysctl -p /etc/sysctl.d/90-vpn-forward.conf
ip route get 10.20.0.53
ip route get 10.20.0.80
```

The protected network's router also needs a route back to the client pool. The following is for a Linux LAN router, with the VPN gateway's LAN address as next hop. Do not blindly run it on a client or public router.

```sh
sudo ip route add 10.77.0.0/24 via 10.20.0.10
```

Persist the return route through that router's network manager. For cloud instances, check platform forwarding restrictions and route tables too. Prefer preserving client source addresses. If return routing is unavailable, evaluate narrowly scoped SNAT; internal services will then lose the original client IP. See [forwarding and return routing](https://docs.strongswan.org/docs/latest/howtos/forwarding.html).

## 06 / Permit VPN and protected traffic

Allow UDP 500 and 4500 in the cloud security group or upstream firewall. Gateway INPUT rules permit negotiation; FORWARD rules permit decrypted traffic. Opening negotiation ports alone does not enable application access.

The commands below immediately change rules on an iptables-managed lab gateway. Save existing rules and preserve management access first. If using UFW, firewalld or native nftables, express the same policy in that manager rather than mixing tools. Replace `ens3` with the interface receiving VPN packets. This example permits access to the entire protected subnet; restrict destinations and ports according to account permissions in your environment.

```sh
sudo iptables-save | sudo tee /root/iptables.before-vpn.rules > /dev/null
sudo iptables -I INPUT 1 -i ens3 -p udp -m multiport \
  --dports 500,4500 -j ACCEPT
sudo iptables -I FORWARD 1 -s 10.77.0.0/24 -d 10.20.0.0/24 \
  -m policy --dir in --pol ipsec -j ACCEPT
sudo iptables -I FORWARD 1 -s 10.20.0.0/24 -d 10.77.0.0/24 \
  -m policy --dir out --pol ipsec \
  -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
```

The `policy` match permits traffic associated with IPsec, rather than ordinary packets merely claiming a pool source address. Ensure existing NAT rules do not rewrite return traffic destined for IPsec. If a broad MASQUERADE rule exists, place an outbound IPsec exemption before it. Persist validated rules through the current firewall manager and test again after reboot. See the [policy match manual](https://man7.org/linux/man-pages/man8/iptables-extensions.8.html).

If this gateway has broad NAT rules, add the following exemption for encrypted return traffic in this example. It is unnecessary when no NAT is configured:

```sh
sudo iptables -t nat -I POSTROUTING 1 -s 10.20.0.0/24 -d 10.77.0.0/24 \
  -m policy --dir out --pol ipsec -j ACCEPT
```

## 07 / Handle split DNS and legacy attributes

The pool's `dns` setting supplies a resolver address, but adoption depends on client policy. For clients supporting IKEv2 split-DNS attributes, merge the following into the existing `charon` configuration in `/etc/strongswan.conf`. Preserve existing plugin and include settings; do not replace the whole file.

```conf
charon {
  plugins {
    attr {
      25 = corp.example.com
    }
  }
}
```

Attribute 25 is `INTERNAL_DNS_DOMAIN`. iOS/macOS split DNS must also satisfy their configuration rules. Clients that do not support this attribute need a managed profile or system DNS policy for domain routing. Sending an attribute does not prove it took effect. See [client DNS behavior](https://docs.strongswan.org/docs/latest/interop/ios.html).

Unity 28675 in legacy configurations is an IKEv1 split-DNS attribute, not an interchangeable IKEv2 domain-routing setting. Likewise, `rightdns` from `ipsec.conf` does not belong in a swanctl connection. Establish the protocol, configuration interface and client capabilities before choosing settings. See the [attribute plugin](https://docs.strongswan.org/docs/latest/plugins/attr.html).

## 08 / Start and inspect loaded configuration

After configuring certificates, accounts, forwarding and firewall rules, run:

```sh
sudo systemctl enable --now strongswan
sudo swanctl --reload-settings
sudo swanctl --load-all
sudo swanctl --stats
sudo swanctl --list-conns
sudo swanctl --list-certs
sudo swanctl --list-pools
sudo ss -lunp 'sport = :500 or sport = :4500'
sudo journalctl -u strongswan --since '-10 minutes' --no-pager
```

`--load-all` loads configuration and credentials into the running daemon. It is a live change, not an offline syntax check. Inspect each load result and the logs, confirming connections, pools, certificates and required plugins. Zero SAs is normal before a client connects; it proves neither login nor application access.

Reload after subsequent connection or account changes. Disconnect and reconnect the test client after DNS changes. Upgrades or plugin changes requiring a restart need a maintenance window because restarting interrupts existing connections. For runtime settings, see [reload-settings](https://docs.strongswan.org/docs/latest/swanctl/swanctlReloadSettings.html).

## 09 / Configure a client and validate the actual path

Create an IKEv2 connection with server and remote identity `vpn.example.com`, username/password authentication and user `vpn-demo`. Install the trusted CA and keep server-name and certificate validation enabled. In Windows EAP settings, select EAP-MSCHAPv2 and restrict the trusted CA and server name. Never distribute CA or server private keys.

After creating a current-user Windows connection named `GesccoLab`, explicitly enable split tunneling and add the destination route. All-user connections require the corresponding parameters and permissions. These commands modify that connection:

```powershell
Set-VpnConnection -Name "GesccoLab" -SplitTunneling $true
Add-VpnConnectionRoute -ConnectionName "GesccoLab" -DestinationPrefix "10.20.0.0/24"
```

Inspect the actual client route rather than relying solely on server `local_ts`. Use supported managed configuration methods on other clients. See [split-tunnel settings](https://learn.microsoft.com/en-us/powershell/module/vpnclient/set-vpnconnection?view=windowsserver2025-ps) and [connection routes](https://learn.microsoft.com/en-us/powershell/module/vpnclient/add-vpnconnectionroute?view=windowsserver2025-ps).

After the test client connects, inspect the server:

```sh
sudo swanctl --list-sas
sudo ip -s xfrm policy
```

Expect an established IKE_SA, an installed CHILD_SA, an address from the pool and correct selectors at both ends. Counters should increase during application access. Test the protected service and resolver from the actual client. This Linux example requires curl, dig and system resolver tools:

```sh
ip route get 10.20.0.80
dig @10.20.0.53 app.corp.example.com A
getent ahostsv4 app.corp.example.com
curl --connect-timeout 5 --max-time 15 https://app.corp.example.com/health
```

A successful direct DNS query proves resolver reachability and record availability only. Correct system resolution and an application connection demonstrate the required client policy. The test service needs an HTTPS certificate trusted by the client. Also test permitted and denied destination ports, route cleanup after disconnect, and reconnection after a reboot. Record the client version, negotiated algorithms, pool, networks and results.

## 10 / Troubleshoot and migrate using evidence

- Negotiation only retransmits: check public DNS, UDP 500/4500, upstream security groups and the listening process. A TCP probe cannot prove IKE UDP reachability.
- `NO_PROPOSAL_CHOSEN`: compare actual algorithms and loaded plugins at both ends. Align client policy before adjusting proposals; avoid blind downgrades.
- Authentication fails: check certificate SAN, validity, trust chain, EAP method and account identity separately. Windows domain-prefixed usernames may differ from configured credentials.
- Login works but private access fails: compare negotiated CHILD_SA selectors, client routes, destination-port rules and return routing. With RADIUS, inspect returned group attributes and the selected connection. Class-based grouping requires checking settings such as `class_group`; authentication does not prove correct network authorization.
- IP access works but names fail: query the resolver directly, then inspect client DNS domain policy. Reconnect and retest rather than drawing conclusions from stale leases or caches.
- Small packets work but HTTPS or large transfers stall: investigate MTU, PMTUD and filtered ICMP before considering a targeted MSS adjustment.

In historical installations, a separate installation directory and systemd override could leave packages reporting an old version while the service ran a newer binary. Before migration, preserve configuration, certificates, permissions, actual startup commands, plugin lists and firewall rules. Change one boundary at a time and retain a rollback installation and startup configuration. `ipsec.conf/stroke` and `swanctl.conf/VICI` are different interfaces; copying option names is insufficient. A source build's inherited `load_modular` setting is not a universal default.

This is a general guide assembled from historical experience and official documentation. These examples were not executed on the original production VPN, and past server-only checks are not presented as successful client validation. Delivery depends on complete path testing in the target environment.

## References

- [Cloudflare: DNS proxy limitations](https://developers.cloudflare.com/dns/proxy-status/limitations/)
- [strongSwan: charon-systemd](https://docs.strongswan.org/docs/latest/daemons/charon-systemd.html)
- [Ubuntu 24.04: charon-systemd package](https://packages.ubuntu.com/noble-updates/net/charon-systemd)
- [Ubuntu: EAP-MSCHAPv2 plugin files](https://packages.ubuntu.com/noble-updates/amd64/libcharon-extauth-plugins/filelist)
- [Ubuntu: standard crypto plugin files](https://packages.ubuntu.com/noble/armhf/libstrongswan-standard-plugins/filelist)
- [strongSwan: Windows clients and EAP dependencies](https://docs.strongswan.org/docs/6.0/interop/windowsClients.html)
- [strongSwan: Windows certificate requirements](https://docs.strongswan.org/docs/6.0/interop/windowsCertRequirements.html)
- [strongSwan: certificate quickstart](https://docs.strongswan.org/docs/latest/pki/pkiQuickstart.html)
- [strongSwan: swanctl.conf reference](https://docs.strongswan.org/docs/latest/swanctl/swanctlConf.html)
- [strongSwan: forwarding, NAT and MTU](https://docs.strongswan.org/docs/latest/howtos/forwarding.html)
- [Linux: iptables extension manual](https://man7.org/linux/man-pages/man8/iptables-extensions.8.html)
- [strongSwan: iOS/macOS and split DNS](https://docs.strongswan.org/docs/latest/interop/ios.html)
- [strongSwan: attr plugin](https://docs.strongswan.org/docs/latest/plugins/attr.html)
- [strongSwan: runtime settings reload](https://docs.strongswan.org/docs/latest/swanctl/swanctlReloadSettings.html)
- [strongSwan: RADIUS attributes and groups](https://docs.strongswan.org/docs/latest/plugins/eap-radius.html)
- [Microsoft: change a VPN connection](https://learn.microsoft.com/en-us/powershell/module/vpnclient/set-vpnconnection?view=windowsserver2025-ps)
- [Microsoft: add a VPN connection route](https://learn.microsoft.com/en-us/powershell/module/vpnclient/add-vpnconnectionroute?view=windowsserver2025-ps)
