---
{"title":"Install and configure OpenVPN: UDP and TCP in practice","category":"Networking & proxies","kind":"Practical notes","date":"2026-10-04","summary":"Set up OpenVPN on Ubuntu with complete UDP and TCP server and client configurations, covering certificates, forwarding, DNS, full-tunnel egress and certificate revocation.","tags":["OpenVPN","UDP","TCP","VPN"]}
---
Installing OpenVPN is straightforward; making certificate identities, transport protocols, tunnel routing and client DNS work together takes more care. This guide targets a fresh Ubuntu 24.04 LTS host with distribution OpenVPN 2.6 and Easy-RSA 3. It provides separate UDP and TCP configurations for the community edition, without an Access Server management interface. Replace the examples and validate them in your own lab; no VPN service was deployed while preparing this article.

## 01 / Choose UDP, TCP and network ranges

Usually start with UDP. Consider TCP when the network does not permit UDP. Carrying TCP applications inside a TCP tunnel can amplify latency on lossy links through nested retransmissions and head-of-line blocking. Both transports still require the same certificate and encryption checks; TCP does not provide stronger identity authentication. See the [transport reference](https://build.openvpn.net/man/openvpn-2.6/openvpn.8.html).

```text
Public VPN hostname: vpn.example.com
Public endpoint: 192.0.2.20 (reserved documentation address; replace it)
Gateway LAN address: 10.20.0.10
Protected network: 10.20.0.0/24
Internal DNS: 10.20.0.53
Internal test service: app.corp.example.com → 10.20.0.80

UDP instance: UDP 1194 / tun-udp / pool 10.88.0.0/24
TCP instance: TCP 443  / tun-tcp / pool 10.89.0.0/24
```

Run either transport alone or two independent instances. Concurrent instances need distinct tunnel interfaces and pools to avoid routing conflicts. Pools must also avoid client LANs. The gateway needs an existing working route to the LAN, and internal DNS needs the test service record. This example initially tunnels only the specified private IPv4 network; full-tunnel egress is covered separately.

TCP 443 must be free on the intended listening address. If a website or another service already uses it, choose a separate address or another permitted port and update clients and firewalls. OpenVPN on TCP 443 is not an HTTPS website. Use a DNS-only VPN A record in Cloudflare; its ordinary website proxy does not carry these connections. See [Cloudflare proxy limitations](https://developers.cloudflare.com/dns/proxy-status/limitations/).

## 02 / Install packages and identify the service template

Run this on the gateway. Back up an existing VPN host before selecting new instance names; do not overwrite active configurations.

```sh
sudo apt update
sudo apt install openvpn easy-rsa openssl iptables
openvpn --version
test -c /dev/net/tun
systemctl cat openvpn-server@.service
sudo ss -lntup
```

Confirm that the running version belongs to the 2.6 series used here and install distribution security updates. If `/dev/net/tun` is unavailable, inspect host or container TUN access and network administration permissions first.

This guide maps `/etc/openvpn/server/udp.conf` to `openvpn-server@udp`, and `tcp.conf` to `openvpn-server@tcp`. Do not mix these with older `/etc/openvpn/*.conf` instructions using `openvpn@name`. Follow the installed template's working directory and startup arguments. See the [service template source](https://github.com/OpenVPN/openvpn/blob/release/2.6/distro/systemd/openvpn-server%40.service.in).

## 03 / Create separate CA, gateway and client keys

Install Easy-RSA on a controlled CA workstation and create a fresh signing directory. Protect the CA private key with a strong interactive passphrase and give the CA a recognizable name. Do not repeat `init-pki` against an existing PKI.

```sh
umask 077
make-cadir ~/openvpn-ca
cd ~/openvpn-ca
export EASYRSA_KEY_SIZE=3072
./easyrsa init-pki
./easyrsa build-ca
```

Keep the CA private key, issuance database and backups on the CA workstation, outside the public gateway. Next, generate a gateway key and request under its normal administrator account, keeping the CN as `vpn-server`:

```sh
umask 077
make-cadir ~/openvpn-server-pki
cd ~/openvpn-server-pki
export EASYRSA_KEY_SIZE=3072
./easyrsa init-pki
./easyrsa gen-req vpn-server nopass
```

The gateway key has no interactive passphrase so the service can start unattended; file permissions protect it. Install Easy-RSA on the Linux client itself or a controlled client-provisioning workstation and generate a distinct client key. Omit `nopass`, supply the key passphrase when connecting, and keep the CN as `client-01`.

```sh
umask 077
make-cadir ~/openvpn-client-pki
cd ~/openvpn-client-pki
export EASYRSA_KEY_SIZE=3072
./easyrsa init-pki
./easyrsa gen-req client-01
```

Issue different names and certificates for each device. Transfer only the two `pki/reqs/*.req` requests to the CA; retain gateway and client private keys on their respective machines. If a provisioning workstation creates client material, deliver it securely to the designated device. See the [Easy-RSA workflow](https://easy-rsa.readthedocs.io/en/latest/).

## 04 / Sign certificates and install gateway material

On the CA workstation, save incoming requests under `~/vpn-requests/`, verify their origin and requested identity, then run the following. Confirm signing prompts; use the server type for the gateway and client type for the device.

```sh
cd ~/openvpn-ca
./easyrsa import-req ~/vpn-requests/vpn-server.req vpn-server
./easyrsa sign-req server vpn-server
./easyrsa import-req ~/vpn-requests/client-01.req client-01
./easyrsa sign-req client client-01
./easyrsa gen-crl
openssl verify -CAfile pki/ca.crt -purpose sslserver pki/issued/vpn-server.crt
openssl verify -CAfile pki/ca.crt -purpose sslclient pki/issued/client-01.crt
```

Return `pki/ca.crt`, `pki/issued/vpn-server.crt` and `pki/crl.pem` to the gateway. Enter the receiving directory for these public files and install them below. The private-key path refers to the gateway's own PKI directory.

```sh
sudo install -d -m 755 /etc/openvpn/server /etc/openvpn/pki
sudo install -m 644 ca.crt /etc/openvpn/pki/ca.crt
sudo install -m 644 vpn-server.crt /etc/openvpn/pki/vpn-server.crt
sudo install -m 644 crl.pem /etc/openvpn/pki/crl.pem
sudo install -m 600 ~/openvpn-server-pki/pki/private/vpn-server.key \
  /etc/openvpn/pki/vpn-server.key
sudo openvpn --genkey tls-crypt /etc/openvpn/pki/tls-crypt.key
sudo chmod 600 /etc/openvpn/pki/tls-crypt.key
sudo -u nobody test -r /etc/openvpn/pki/crl.pem
```

The final check must pass: the daemon needs CRL access after dropping privileges. Public certificate directories must be traversable, while private keys and the tls-crypt file remain administrator-readable only. Do not point service configuration into an administrator's home directory; the service template may restrict access there.

Deliver `ca.crt`, `client-01.crt` and the gateway-generated `tls-crypt.key` through a trusted channel and verify the CA fingerprint. The client uses its own `client-01.key`. tls-crypt is a shared control-channel key in this example, not a replacement for individual client certificates, and needs no `key-direction`. See [TLS and identity options](https://github.com/OpenVPN/openvpn/blob/release/2.6/doc/man-sections/tls-options.rst).

## 05 / Configure the UDP server

Save this complete configuration as `/etc/openvpn/server/udp.conf` with permissions 600:

```conf
port 1194
proto udp4
dev tun-udp
dev-type tun
topology subnet
server 10.88.0.0 255.255.255.0

ca /etc/openvpn/pki/ca.crt
cert /etc/openvpn/pki/vpn-server.crt
key /etc/openvpn/pki/vpn-server.key
crl-verify /etc/openvpn/pki/crl.pem
dh none
remote-cert-tls client
verify-client-cert require
tls-crypt /etc/openvpn/pki/tls-crypt.key
tls-version-min 1.2
data-ciphers AES-256-GCM:AES-128-GCM
allow-compression no
disable-dco

push "route 10.20.0.0 255.255.255.0"
push "dhcp-option DNS 10.20.0.53"
keepalive 10 120
persist-key
persist-tun
user nobody
group nogroup
verb 3
```

This baseline uses the ordinary TUN data path with DCO offload explicitly disabled for straightforward troubleshooting. Validate DCO separately during performance tuning. The data channel negotiates only the listed AES-GCM algorithms, compression is disabled, and `dh none` uses ECDH. Avoid carrying forward legacy static shared-key mode or BF-CBC. Username/password authentication is not added in this setup.

## 06 / Configure the TCP server

Save this complete configuration as `/etc/openvpn/server/tcp.conf`, also with permissions 600. Both instances may share the gateway certificate and CA, while keeping instance names, interfaces and pools separate.

```conf
port 443
proto tcp4-server
dev tun-tcp
dev-type tun
topology subnet
server 10.89.0.0 255.255.255.0

ca /etc/openvpn/pki/ca.crt
cert /etc/openvpn/pki/vpn-server.crt
key /etc/openvpn/pki/vpn-server.key
crl-verify /etc/openvpn/pki/crl.pem
dh none
remote-cert-tls client
verify-client-cert require
tls-crypt /etc/openvpn/pki/tls-crypt.key
tls-version-min 1.2
data-ciphers AES-256-GCM:AES-128-GCM
allow-compression no
disable-dco

push "route 10.20.0.0 255.255.255.0"
push "dhcp-option DNS 10.20.0.53"
keepalive 10 120
persist-key
persist-tun
user nobody
group nogroup
verb 3
```

The server uses `tcp4-server`, and the client uses `tcp4-client`. Changing only the port is insufficient; avoid copying UDP-specific options into TCP configurations. Both transports require clients supporting these algorithms and certificate formats. Upgrade older clients before testing compatibility. See the [official server example](https://github.com/OpenVPN/openvpn/blob/release/2.6/sample/sample-config-files/server.conf).

## 07 / Enable forwarding, firewall access and return routing

Save `/etc/sysctl.d/91-openvpn-forward.conf` on the gateway and load it:

```conf
net.ipv4.ip_forward = 1
```

```sh
sudo sysctl -p /etc/sysctl.d/91-openvpn-forward.conf
ip route get 10.20.0.53
ip route get 10.20.0.80
```

Allow UDP 1194 and TCP 443 in cloud security groups and the gateway firewall. The following immediately changes an iptables-managed lab gateway. With UFW, firewalld or native nftables, implement equivalent rules in the current manager rather than mixing tools. Replace `ens3` with the public ingress interface. For a single instance, add only its rules, and preserve management access.

```sh
sudo iptables-save | sudo tee /root/iptables.before-openvpn.rules > /dev/null
sudo iptables -I INPUT 1 -i ens3 -p udp --dport 1194 -j ACCEPT
sudo iptables -I INPUT 1 -i ens3 -p tcp --dport 443 -j ACCEPT
sudo iptables -I FORWARD 1 -i tun-udp -s 10.88.0.0/24 -d 10.20.0.0/24 -j ACCEPT
sudo iptables -I FORWARD 1 -o tun-udp -s 10.20.0.0/24 -d 10.88.0.0/24 \
  -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
sudo iptables -I FORWARD 1 -i tun-tcp -s 10.89.0.0/24 -d 10.20.0.0/24 -j ACCEPT
sudo iptables -I FORWARD 1 -o tun-tcp -s 10.20.0.0/24 -d 10.89.0.0/24 \
  -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
```

These are allow rules, not a complete default-deny policy. Limit destinations and ports according to account authorization and inspect rule ordering in deployment. Pushing a route alone does not enforce access control.

The router used by internal services needs return routes. Run these only on the appropriate Linux LAN router, with the VPN gateway's LAN address as next hop. For a single instance, add only its pool route.

```sh
sudo ip route add 10.88.0.0/24 via 10.20.0.10
sudo ip route add 10.89.0.0/24 via 10.20.0.10
```

Persist settings through existing network and firewall managers, checking cloud forwarding restrictions and route tables. Prefer return routing for split-tunnel private access instead of unnecessary NAT that hides client addresses. See the [Ubuntu installation and forwarding guide](https://ubuntu.com/server/docs/how-to/security/install-openvpn/).

## 08 / Start instances and configure both clients

Start only the instances you need. This example runs both:

```sh
sudo chmod 600 /etc/openvpn/server/udp.conf /etc/openvpn/server/tcp.conf
sudo systemctl enable --now openvpn-server@udp openvpn-server@tcp
sudo systemctl status openvpn-server@udp openvpn-server@tcp --no-pager
sudo journalctl -u openvpn-server@udp -u openvpn-server@tcp \
  --since '-10 minutes' --no-pager
sudo ss -lunp 'sport = :1194'
sudo ss -ltnp 'sport = :443'
ip -br address show tun-udp
ip -br address show tun-tcp
```

Save the UDP profile as `client-udp.ovpn`. This targets the OpenVPN 2.6 community client, with certificate and key files beside the configuration:

```conf
client
dev tun
proto udp4
remote vpn.example.com 1194
resolv-retry infinite
nobind
persist-key
persist-tun
ca ca.crt
cert client-01.crt
key client-01.key
remote-cert-tls server
verify-x509-name vpn-server name
tls-crypt tls-crypt.key
tls-version-min 1.2
data-ciphers AES-256-GCM:AES-128-GCM
allow-compression no
verb 3
```

Save the TCP profile as `client-tcp.ovpn`:

```conf
client
dev tun
proto tcp4-client
remote vpn.example.com 443
resolv-retry infinite
nobind
persist-key
persist-tun
ca ca.crt
cert client-01.crt
key client-01.key
remote-cert-tls server
verify-x509-name vpn-server name
tls-crypt tls-crypt.key
tls-version-min 1.2
data-ciphers AES-256-GCM:AES-128-GCM
allow-compression no
verb 3
```

Here, `verify-x509-name` exactly checks the server certificate CN `vpn-server`, a separate field from the DNS connection address. If you changed the request CN, update the profile too. `remote-cert-tls server` checks server certificate usage. Keep both checks rather than bypassing certificate errors.

On Linux, enter the directory containing these files and start one connection, supplying the client key passphrase:

```sh
sudo openvpn --config ./client-udp.ovpn
```

Disconnect UDP before testing TCP:

```sh
sudo openvpn --config ./client-tcp.ovpn
```

Do not connect both profiles simultaneously on the same device; identical destination routes can interfere. The Windows community GUI uses these profiles and their files too. Import-oriented clients requiring a single file can embed the CA, client certificate, client private key and tls-crypt material with `<ca>`, `<cert>`, `<key>` and `<tls-crypt>` blocks. Inline profiles contain credentials and need private-key handling; keep them outside GitHub, websites and tickets.

## 09 / Configure and verify client DNS

Pushed DNS does not mean every platform applied it. Windows community clients can process these settings. Direct Linux OpenVPN usually needs DNS integration scripts or a network manager; a PUSH_REPLY log alone is insufficient.

For a Linux test client using systemd-resolved, with system resolution actually connected to that service, configure temporary split DNS below. Replace `tun0` with the client's actual tunnel interface, not a server interface name.

```sh
ip -br address
sudo resolvectl dns tun0 10.20.0.53
sudo resolvectl domain tun0 '~corp.example.com'
sudo resolvectl default-route tun0 no
resolvectl status tun0
resolvectl query app.corp.example.com
```

Only the specified domain uses the internal resolver; other names retain existing policy. These are temporary interface settings and must be reapplied after interface recreation. Deploy managed connect/disconnect integration for ongoing use. Revert manually with `sudo resolvectl revert tun0`; settings also disappear when the interface does. See the [resolvectl manual](https://manpages.ubuntu.com/manpages/noble/man1/resolvectl.1.html).

## 10 / Optional: use the gateway for full-tunnel egress

Internet access through the gateway requires additional egress forwarding and NAT. Add this to each server configuration intended to provide that capability:

```conf
push "redirect-gateway def1"
```

This example applies to the UDP instance with public egress interface `ens3`. Add it only when the gateway is approved to provide internet egress, rather than repurposing a private-access gateway without that planning.

```sh
sudo iptables -I FORWARD 1 -i tun-udp -o ens3 -s 10.88.0.0/24 -j ACCEPT
sudo iptables -I FORWARD 1 -i ens3 -o tun-udp -d 10.88.0.0/24 \
  -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
sudo iptables -t nat -I POSTROUTING 1 -s 10.88.0.0/24 ! -d 10.20.0.0/24 \
  -o ens3 -j MASQUERADE
```

For TCP egress, establish corresponding rules for `tun-tcp` and `10.89.0.0/24`. Changing the push directive alone is insufficient. The NAT rule excludes internal destinations, which still need return routing. Full-tunnel DNS must support external resolution and be configured on the client. The previous section provides private-domain split DNS only; it does not take over all DNS queries.

This example covers IPv4 only. `redirect-gateway def1` does not automatically tunnel IPv6, so it does not establish protection for all traffic. Design and validate IPv6 tunneling or the corresponding client restrictions separately.

## 11 / Validate UDP and TCP through application traffic

Connect each profile separately and record connection time, server instance, assigned address, negotiated algorithms and results. `Initialization Sequence Completed` indicates OpenVPN initialization, not verified routing, DNS and application access.

```sh
ip route get 10.20.0.80
dig @10.20.0.53 app.corp.example.com A
getent ahostsv4 app.corp.example.com
curl --connect-timeout 5 --max-time 15 https://app.corp.example.com/health
```

These Linux checks require the relevant tools and an HTTPS service certificate trusted by the client. Direct resolver queries prove DNS reachability only; system resolution and application access demonstrate the full client policy. Also test denied destination ports, route cleanup after disconnect and reconnection after server reboot. For full-tunnel mode, inspect actual egress and IPv6 behavior too.

Troubleshoot in this order:

- No connection: inspect the A record, listening process, security group and transport. TCP reachability proves neither UDP reachability nor certificate authentication.
- TLS handshake failure: check certificate usage, CA, CN verification, expiry, matching tls-crypt keys and host clocks.
- No common cipher: compare `data-ciphers` and client versions. Upgrade or establish explicit compatibility policy instead of restoring old compression or weak algorithms.
- Connected without private access: inspect pool overlaps, client routes, FORWARD counters, return routes and the internal service firewall.
- IP works but names fail: separate direct DNS queries, system resolution and application-specific DNS behavior. Check that integration survives reconnects.
- TCP stalls or large transfers stop: examine packet loss, nested TCP retransmissions, MTU and PMTUD. Compare UDP on a network permitting it rather than blindly adjusting every buffer.

## 12 / Revoke certificates, update and roll back

If a device is lost or its private key compromised, revoke that certificate and regenerate the CRL on the CA workstation:

```sh
cd ~/openvpn-ca
./easyrsa revoke client-01
./easyrsa gen-crl
openssl crl -in pki/crl.pem -noout -issuer -lastupdate -nextupdate
```

Transfer the new CRL to the gateway and inspect its validity in the receiving directory. Replace it through a temporary file to avoid reads of truncated content:

```sh
openssl crl -in crl.pem -noout -issuer -lastupdate -nextupdate
sudo install -m 644 crl.pem /etc/openvpn/pki/crl.pem.new
sudo mv /etc/openvpn/pki/crl.pem.new /etc/openvpn/pki/crl.pem
sudo -u nobody test -r /etc/openvpn/pki/crl.pem
```

OpenVPN reads the CRL during certificate verification. Publishing it does not immediately disconnect existing sessions. For immediate termination, use an already secured management interface to end the specific session, or stop/restart the relevant instance, affecting all its users. No management interface is enabled in this example.

Confirm that the revoked device cannot reconnect while valid devices can. Address missing, expired or unreadable CRLs rather than relying on the presence of `crl-verify`. Schedule certificate and CRL renewal, and back up issuance databases, server configurations and firewall rollback information. Restart only affected instances after configuration updates and retest both transports.

## References

- [OpenVPN 2.6 reference manual](https://build.openvpn.net/man/openvpn-2.6/openvpn.8.html)
- [OpenVPN: TLS and certificate options](https://github.com/OpenVPN/openvpn/blob/release/2.6/doc/man-sections/tls-options.rst)
- [OpenVPN: official server configuration example](https://github.com/OpenVPN/openvpn/blob/release/2.6/sample/sample-config-files/server.conf)
- [OpenVPN: systemd service template](https://github.com/OpenVPN/openvpn/blob/release/2.6/distro/systemd/openvpn-server%40.service.in)
- [OpenVPN: community setup guide](https://openvpn.net/community-docs/how-to.html)
- [Easy-RSA: keys, requests, signing and revocation](https://easy-rsa.readthedocs.io/en/latest/)
- [Easy-RSA 3.1.7: configuration variables](https://raw.githubusercontent.com/OpenVPN/easy-rsa/v3.1.7/easyrsa3/vars.example)
- [Ubuntu: OpenVPN installation and forwarding](https://ubuntu.com/server/docs/how-to/security/install-openvpn/)
- [Ubuntu 24.04: Easy-RSA package](https://packages.ubuntu.com/noble/easy-rsa)
- [Ubuntu: resolvectl manual](https://manpages.ubuntu.com/manpages/noble/man1/resolvectl.1.html)
- [Cloudflare: DNS proxy limitations](https://developers.cloudflare.com/dns/proxy-status/limitations/)
