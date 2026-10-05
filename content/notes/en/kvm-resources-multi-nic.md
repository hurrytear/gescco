---
{"title":"Configuring KVM VMs: memory, CPUs, networking and multiple NICs","category":"Linux","kind":"Practical guide","date":"2026-10-05","summary":"Configure KVM memory and CPUs with Ubuntu and libvirt, combine NAT, physical bridges and isolated networks, and validate a three-NIC setup with policy routing and rollback.","tags":["KVM","libvirt","CPU","Memory","Multiple NICs","Netplan"]}
---
Adding memory, CPUs or interfaces to a KVM virtual machine requires checking host capacity, persistent libvirt settings and what the guest actually recognizes. This walkthrough uses Ubuntu Server 24.04 LTS on x86_64 with QEMU/KVM and libvirt. An example VM named `ops-lab` receives separate management, application and storage interfaces.

Sources were checked on 2026-10-05. These are public configuration examples, not commands executed on a real KVM host. Replace networks, MAC addresses and interface names for your own lab.

## 01 / Environment, connection and preparation

The guest OS is already installed, the VM has a persistent definition, and a working graphical or serial console is available. Disk creation and OS installation are outside this walkthrough. Use a maintenance shutdown for the baseline changes. The network sequence assumes a lab VM without attached NICs; identify and reuse existing interfaces instead of blindly adding three more.

Run the following on the **Ubuntu host**. Inspect versions and service health in an existing environment; install packages only when needed. Enable Intel VT-x or AMD-V in firmware. Nested virtualization also requires support from the outer platform.

```sh
# Host: install only when the virtualization components are missing.
sudo apt update
sudo apt install qemu-kvm libvirt-daemon-system libvirt-clients

sudo virt-host-validate qemu
sudo virsh -c qemu:///system version
sudo virsh -c qemu:///system list --all
lscpu
free -h
ip -br address
ip route show
```

Use `qemu:///system` consistently: `qemu:///session` manages a different VM inventory. Confirm the target is `ops-lab`, that no saved execution state needs restoring, and that host capacity covers guest peaks, host caches and QEMU overhead. Leave memory for the host.

In a maintenance window without concurrent edits, back up XML and request a graceful shutdown. A successful `shutdown` request does not mean the VM is off. Repeat the state query until it reports `shut off` before changing persistent resources. Skip the shutdown request if already stopped.

```sh
# Host: use the same shell for the backup path and later rollback.
umask 077
kvm_backup_dir=$(mktemp -d "$PWD/ops-lab-before.XXXXXX")
sudo virsh -c qemu:///system dumpxml ops-lab --inactive > "$kvm_backup_dir/domain.xml"
sudo virsh -c qemu:///system domiflist ops-lab --inactive
sudo virsh -c qemu:///system shutdown ops-lab
sudo virsh -c qemu:///system domstate ops-lab
```

An XML backup does not include disk contents, host networking or guest networking. Maintain a separate disk backup and save each machine's complete Netplan configuration before editing it. `--config` updates the persistent definition for the next start; `--live` changes the running instance. These can differ. CPU models, maximum resources and topology generally require a full shutdown and `start`; rebooting inside the guest does not recreate the QEMU process.

## 02 / Memory: fixed allocation, ballooning and hotplug

Start with a straightforward fixed 8 GiB allocation. This example assumes a stopped VM, an increase from a smaller allocation, and no virtual NUMA, hotplugged DIMMs or special memory backing. Raise the limit before setting the current allocation. Complex NUMA configurations require corresponding cell changes instead of these two commands alone.

```sh
# Host: persistent memory settings for a stopped, simple VM.
sudo virsh -c qemu:///system setmaxmem ops-lab 8192MiB --config
sudo virsh -c qemu:///system setmem ops-lab 8192MiB --config
sudo virsh -c qemu:///system dumpxml ops-lab --inactive
```

The relevant XML should be equivalent to the following. Libvirt may normalize units to KiB, so compare capacities instead of literal text. This fragment explains fields in the existing definition; it is not a complete domain file for `define`.

```xml
<memory unit='MiB'>8192</memory>
<currentMemory unit='MiB'>8192</currentMemory>
```

- `memory` sets the maximum allocation at boot; ordinary balloon adjustments cannot exceed that range.
- `currentMemory` is an allocation target, not application usage or the QEMU process's RSS.
- `maxMemory` is a separate field for memory-device hotplug limits and slot planning. `setmaxmem` does not configure DIMM hotplug.

**Optional online growth scenario**: increase to 12 GiB only after previously configuring `memory=16384 MiB` and `currentMemory=8192 MiB` while stopped, then starting the VM again. The host must accommodate the maximum plus overhead. The guest needs a working virtio balloon driver, with `<memballoon model='virtio'/>` in the existing `<devices>` section. Do not duplicate an existing balloon device.

```sh
# Host: optional scenario, only with a live 16 GiB ceiling already in place.
sudo virsh -c qemu:///system setmem ops-lab 12288MiB --live
sudo virsh -c qemu:///system dommemstat ops-lab
# Persist only after the guest has accepted the change and remains healthy.
sudo virsh -c qemu:///system setmem ops-lab 12288MiB --config
```

After an online request, check `free -h` inside the guest, memory pressure and application health. Ballooning is not a host-capacity guarantee: boot and reclamation can temporarily require more memory. Online shrinking pressures the guest working set; stop workloads or use a cold change. DIMMs, virtio-mem, HugePages, locked memory and NUMA binding need separate planning.

## 03 / CPU: counts, topology, models and affinity

Plan four initially active vCPUs with a maximum of eight, using a maximum topology of one socket, eight cores and one thread per core. A vCPU is scheduled by the host; it is not an exclusively owned physical core. Check whether CPU is actually the bottleneck, including host contention and guest steal time.

With the VM stopped, use `virsh edit` to replace its existing `vcpu` and `cpu` elements with this fragment. Preserve disks, firmware and controllers. Review any existing per-vCPU `<vcpus>` definitions, virtual NUMA or affinity settings together. The maximum topology product is eight, not the initial active count of four.

```sh
# Host: edit persistent XML while the VM is stopped.
sudo virsh -c qemu:///system edit ops-lab
```

```xml
<vcpu placement='static' current='4'>8</vcpu>
<cpu mode='host-passthrough'>
  <topology sockets='1' cores='8' threads='1'/>
</cpu>
```

This fixed-host example uses `host-passthrough` to expose host CPU capabilities. Migration requires a compatible cluster CPU baseline plus appropriate QEMU and microcode conditions; switching to `host-model` does not guarantee arbitrary cross-model migration. `placement='static'` does not reserve or pin physical CPUs.

After the next start and completed guest boot, a compatible QEMU machine type and guest may allow an increase to six CPUs. Change the live instance first, confirm online CPUs with guest `lscpu`, then persist the result. If unsupported, retain the previous configuration and use a cold change during maintenance. Do not run `--live` before starting the VM.

```sh
# Host: optional hot-add after the VM has booted with the eight-vCPU maximum.
sudo virsh -c qemu:///system setvcpus ops-lab 6 --live
sudo virsh -c qemu:///system vcpucount ops-lab
# Persist only after checking online CPUs inside the guest.
sudo virsh -c qemu:///system setvcpus ops-lab 6 --config
```

For latency-sensitive workloads, plan `vcpupin` from the actual `lscpu -e=CPU,CORE,SOCKET,NODE` mapping, together with emulator threads, I/O threads and NUMA memory placement. Two SMT threads are not two independent physical cores. Avoid placing every vCPU on one logical CPU. Start with normal scheduling and use measurements before introducing affinity.

## 04 / Choose network modes and interface roles

- NAT lets a VM reach external networks through host address translation. External hosts generally need separate forwarding arrangements to initiate connections to the VM. It suits lab and management egress.
- A Linux bridge connects the VM as another port on the attached Layer 2 network. That network determines addressing, DHCP, routing and ACLs; bridging itself does not provide NAT.
- A libvirt isolated network omits `<forward>`. It supports communication with the host and VMs on the same network. It does not isolate those VMs from each other or prevent a multihomed guest from forwarding traffic.
- A routed network requires an upstream return route for the VM subnet and normally avoids NAT. Coordinate routing and firewall policy. It is not the physical bridge used here.
- macvtap / direct interfaces can attach to physical networking, but common modes prevent direct host-to-guest communication over that interface. Assess this limitation when host-based management is required.

The three interfaces have distinct roles. Only management supplies the default route; application and storage carry specific networks. These documentation ranges illustrate an isolated lab. Replace them for deployment and check for overlap with the host, VMs, VPNs and physical LANs.

```text
Host management: enp1s0 (existing configuration, kept as-is)

ops-lab
  mgmt0   52:54:00:70:00:10  192.0.2.10/24
    -> lab-mgmt / virmgmt -> host NAT -> upstream
    -> default gateway 192.0.2.1

  app0    52:54:00:70:00:20  198.51.100.10/25
    -> br-app -> dedicated enp2s0 -> application LAN
    -> 198.51.100.128/25 via application router 198.51.100.1

  store0  52:54:00:70:00:30  203.0.113.10/24
    -> lab-storage / virstore -> host and local storage VMs
    -> no default gateway
```

Three virtual NICs do not require three physical NICs. Management uses NAT, storage stays on the host, and only the application bridge uses a dedicated physical port. Storage outside the host needs its own bridge, VLAN or routed design; an isolated network cannot automatically reach an external SAN or LAN.

## 05 / Define management NAT and isolated storage networks

Run these steps on the host. Inspect `virsh net-list --all`, `ip link` and routes first. Ensure the names `lab-mgmt`, `lab-storage`, `virmgmt`, `virstore` and their subnets are unused. Inspect existing definitions with `net-dumpxml` instead of overwriting them.

Save the following as `lab-mgmt.xml` and `lab-storage.xml` in the working directory. Management allocates DHCP addresses from `.100` through `.199`; the example static VM address `.10` is outside that pool. Libvirt DNS can serve the management gateway address, but forwarding still depends on working host DNS.

```xml
<network>
  <name>lab-mgmt</name>
  <forward mode='nat'/>
  <bridge name='virmgmt' stp='on' delay='0'/>
  <ip address='192.0.2.1' netmask='255.255.255.0'>
    <dhcp>
      <range start='192.0.2.100' end='192.0.2.199'/>
    </dhcp>
  </ip>
</network>
```

```xml
<network>
  <name>lab-storage</name>
  <bridge name='virstore' stp='on' delay='0'/>
  <dns enable='no'/>
  <ip address='203.0.113.1' netmask='255.255.255.0'/>
</network>
```

Define, start and enable autostart for the networks. Libvirt configures bridges and forwarding filters for its managed networks. Check compatibility with existing firewalls and virtualization tools instead of flushing nftables or iptables. `net-define` saves a persistent definition; `net-start` activates it.

```sh
# Host: only create networks after checking names and subnet conflicts.
sudo virsh -c qemu:///system net-define lab-mgmt.xml
sudo virsh -c qemu:///system net-start lab-mgmt
sudo virsh -c qemu:///system net-autostart lab-mgmt

sudo virsh -c qemu:///system net-define lab-storage.xml
sudo virsh -c qemu:///system net-start lab-storage
sudo virsh -c qemu:///system net-autostart lab-storage
sudo virsh -c qemu:///system net-list --all
```

The commonly supplied `default` / `virbr0` network is another NAT option, but it is not active on every host. You can reuse an inspected existing network by updating subsequent names, gateways and addresses together. Do not define an overlapping replacement.

## 06 / Host physical bridging and VLAN placement

This example is for an **Ubuntu host managed by Netplan and systemd-networkd**. `enp1s0` already provides host management. `enp2s0` is a dedicated wired port with no IP or existing workload, connected to an application-network switch port. Do not apply this to the current SSH uplink without out-of-band access.

Back up `/etc/netplan/` and confirm that no other file, NetworkManager profile, bond or cloud-init definition manages `enp2s0`. Then add `/etc/netplan/60-kvm-app-bridge.yaml` with mode 600, preserving management settings in other files. If the host also needs an application-network IP, place it on `br-app`, not its member `enp2s0`.

```yaml
network:
  version: 2
  ethernets:
    enp2s0:
      renderer: networkd
      dhcp4: false
      dhcp6: false
      accept-ra: false
      link-local: []
  bridges:
    br-app:
      renderer: networkd
      interfaces: [enp2s0]
      dhcp4: false
      dhcp6: false
      accept-ra: false
      link-local: []
      parameters:
        stp: true
        forward-delay: 4
```

Validate and trial the change through the host console. Confirm management access and bridge-port state before accepting it. STP may delay forwarding briefly. Netplan rollback has limitations with virtual devices; verify the original network actually returned after any timeout rather than relying solely on automatic rollback.

```sh
# Host: after saving the bridge file and backing up existing Netplan files.
sudo chmod 600 /etc/netplan/60-kvm-app-bridge.yaml
sudo netplan generate
sudo netplan try --timeout 120
ip -br link
bridge link show
```

For an upstream VLAN trunk, define a Netplan VLAN interface with `id: 120` and `link: enp2s0`, then use that interface as the application bridge member. Do not also add the physical parent to the same bridge. Permit the VLAN on the switch. The guest normally receives untagged application traffic; avoid tagging it again unless an end-to-end trunk is intentional.

Wireless links and cloud or switch ports that restrict source MAC addresses may not support ordinary bridging. For external connectivity failures, inspect link state, port security and VLANs before guest configuration. A bridged VM is exposed to its physical LAN and needs explicit guest and network-boundary access controls.

## 07 / Attach three virtio interfaces in libvirt

Confirm both libvirt networks are active, that `br-app` exists, and inspect `domiflist --inactive`. The example MAC addresses must be unique on their Layer 2 networks. For a stopped VM, `type=network` selects a libvirt network name and `type=bridge` selects a host Linux bridge name. These are different namespaces.

```sh
# Host: stopped lab VM without existing NICs; reuse existing NICs when present.
sudo virsh -c qemu:///system attach-interface --domain ops-lab \
  --type network --source lab-mgmt --model virtio \
  --mac 52:54:00:70:00:10 --config
sudo virsh -c qemu:///system attach-interface --domain ops-lab \
  --type bridge --source br-app --model virtio \
  --mac 52:54:00:70:00:20 --config
sudo virsh -c qemu:///system attach-interface --domain ops-lab \
  --type network --source lab-storage --model virtio \
  --mac 52:54:00:70:00:30 --config

sudo virsh -c qemu:///system domiflist ops-lab --inactive
sudo virsh -c qemu:///system start ops-lab
sudo virsh -c qemu:///system domiflist ops-lab
```

The guest needs virtio network drivers, normally available in Ubuntu. Online attachment additionally depends on virtual PCI/PCIe slots, machine type and guest support. Live and persistent definitions can be changed separately once those conditions are verified; this walkthrough uses cold attachment. A successful `--config` request does not add a device to an already running VM.

Host tap names such as `vnet0` do not reliably correspond to guest names such as `ens3` or `enp1s0`. Match MAC addresses across `domiflist`, guest `ip link` and configuration files to avoid configuring the wrong interface after device changes.

## 08 / Configure guest addressing and routes by MAC

This file belongs **inside the Ubuntu guest**, not on the host. Through the console, back up `/etc/netplan/` and verify MAC addresses with `ip -br link`. Consolidate existing definitions for these devices into a file such as `/etc/netplan/60-ops-lab.yaml`. Netplan merges YAML files; an old definition under a different ID can still match the same device. Adding a new file does not necessarily remove old DHCP settings.

If cloud-init manages networking, update its authoritative configuration or disable its network generation through the platform's process to prevent replacement on reboot. Do not indiscriminately delete the entire directory. This IPv4 example disables DHCPv6, RA and link-local addressing on these three interfaces. Plan IPv6 gateways, source routing and firewall rules explicitly if needed.

```yaml
network:
  version: 2
  renderer: networkd
  ethernets:
    mgmt:
      match:
        macaddress: "52:54:00:70:00:10"
      set-name: mgmt0
      dhcp4: false
      dhcp6: false
      accept-ra: false
      link-local: []
      addresses: [192.0.2.10/24]
      nameservers:
        addresses: [192.0.2.1]
      routes:
        - to: default
          via: 192.0.2.1
          metric: 100
    app:
      match:
        macaddress: "52:54:00:70:00:20"
      set-name: app0
      dhcp4: false
      dhcp6: false
      accept-ra: false
      link-local: []
      addresses: [198.51.100.10/25]
      routes:
        - to: 198.51.100.128/25
          via: 198.51.100.1
    storage:
      match:
        macaddress: "52:54:00:70:00:30"
      set-name: store0
      dhcp4: false
      dhcp6: false
      accept-ra: false
      link-local: []
      addresses: [203.0.113.10/24]
```

The application route requires a real router at `198.51.100.1` and return routes from it and the remote network to `198.51.100.0/25`. Remove this illustrative route if that router does not exist. `store0` needs no gateway for its local `/24`. Verify management DNS over the management interface.

Validate, trial and confirm the configuration through the guest console, keeping console access until a subsequent boot has been checked. If `set-name` cannot rename an interface already in use, reboot through the console and verify the result. A name in YAML does not prove the rename succeeded.

```sh
# Guest: after saving the consolidated file and backing up prior settings.
sudo chmod 600 /etc/netplan/60-ops-lab.yaml
sudo netplan generate
sudo netplan try --timeout 120
ip -br address
ip route show
ip -6 route show
resolvectl status
sysctl net.ipv4.ip_forward net.ipv6.conf.all.forwarding
```

An ordinary application VM should not forward other machines' traffic; both forwarding values should be zero. If it also acts as a container gateway, router or VPN, design forwarding ACLs and return routes first. Three NICs alone are not a reason to enable forwarding. Apply interface-specific firewall policies and service bindings instead of treating all interfaces as unconditionally trusted.

Two NICs on the same IPv4 subnet can create ARP, source-address and return-path ambiguity. For redundancy, consider bonding with suitable upstream support. For separation, use distinct subnets and VLANs. Multiple NICs do not automatically combine bandwidth for a single connection.

## 09 / Use policy routing when multiple egress paths are required

The previous section uses one default route in the main table, sufficient for most traffic in this example. Add source policy routing only when the application address must originate traffic to other networks, or receive connections from destinations without specific routes, and replies must leave through the application gateway. Different default-route metrics express preference; they do not automatically select an egress by source address or provide reliable remote-path health checks.

Optionally replace `network.ethernets.app` in the same guest file with the following mapping, retaining the other sections. Do not append a second definition for the same device. Verify that table 120 and priority 120 are unused and that the application gateway can route the intended traffic.

```yaml
app:
  match:
    macaddress: "52:54:00:70:00:20"
  set-name: app0
  dhcp4: false
  dhcp6: false
  accept-ra: false
  link-local: []
  addresses: [198.51.100.10/25]
  routes:
    - to: 198.51.100.128/25
      via: 198.51.100.1
    - to: 198.51.100.0/25
      scope: link
      table: 120
    - to: default
      via: 198.51.100.1
      table: 120
  routing-policy:
    - from: 198.51.100.10/32
      table: 120
      priority: 120
```

Revalidate with `netplan generate` and trial through the console, then inspect rules and source-specific lookups. Table 120 serves the matching application source; the main default remains management. An application that does not bind the application address may still use management. Add connected or specific routes to the policy table if this source must also reach management or storage subnets; otherwise the table's default sends that traffic to the application gateway.

```sh
# Guest: run after applying the optional policy-routing configuration.
ip rule show
ip route show table 120
ip route get 198.51.100.130 from 198.51.100.10
sysctl net.ipv4.conf.all.rp_filter net.ipv4.conf.app0.rp_filter
```

Fix return routes, ACLs and source selection before investigating `rp_filter`. Consider per-interface loose mode only for a verified legitimate asymmetric path; do not globally disable validation to hide routing mistakes. Linux uses the larger of the `all` and interface values. Multiple egress paths also require attention to connection tracking, NAT and service bindings; one rule does not create high availability.

## 10 / Validate resources and connectivity in layers

Use these host commands to compare runtime state, persistent configuration, virtual NIC attachment and the physical bridge. `domifaddr --source lease` mainly reports libvirt DHCP assignments; the static addresses used here may be absent. `--source agent` requires a separately configured guest agent and channel. Empty output does not prove the guest lacks an IP.

```sh
# Host: runtime, persistent definition and Layer 2 attachment.
sudo virsh -c qemu:///system dominfo ops-lab
sudo virsh -c qemu:///system vcpucount ops-lab
sudo virsh -c qemu:///system dommemstat ops-lab
sudo virsh -c qemu:///system domiflist ops-lab
sudo virsh -c qemu:///system dumpxml ops-lab --inactive
sudo virsh -c qemu:///system net-dhcp-leases lab-mgmt
ip -s link show br-app
bridge link show
```

Inside the guest, inspect actual resources and routes. The baseline expects four online vCPUs, roughly 8 GiB of memory and three matching NICs. Kernel reservations can make `free` totals slightly smaller than XML allocations. If optional online increases were applied, validate against those targets instead of the baseline.

```sh
# Guest: resources, addresses, route selection and approved diagnostics.
lscpu
free -h
ip -br address
ip route show
ip rule show
ip route get 198.51.100.130 from 198.51.100.10
ip route get 203.0.113.1 from 203.0.113.10
resolvectl status
ping -c 3 -I mgmt0 192.0.2.1
ping -c 3 -I app0 198.51.100.1
ping -c 3 -I store0 203.0.113.1
```

- Management: verify the gateway, DNS and approved external services. Working outbound NAT does not establish inbound reachability.
- Application: check forwarding bridge ports, permitted VM MACs, matching VLANs, gateway reachability and return routes, then test actual service ports.
- Storage: verify peers on the bridge, application use of storage addresses and absence of unintended forwarding. Pinging the host bridge does not validate a storage service.
- Performance: observe host memory pressure, guest CPU steal, interface drops and representative workloads. Introduce virtio multiqueue, CPU pinning, HugePages or jumbo frames separately after baseline measurements; MTU must match the entire path.
- Persistence: in a maintenance window, fully shut down and start the VM, then check resources, MACs, addresses, routes and services again. Validate bridge and libvirt-network recovery after a host reboot separately.

Gateways may block ICMP; use approved TCP/UDP service checks alongside ping. Do not disable the firewall solely because ping fails. If necessary, capture narrowly scoped traffic on the relevant tap, bridge or physical interface to locate the loss.

## 11 / Roll back both host and guest network changes

Through the console, record the current state, restore the guest's previous Netplan files and gracefully stop the VM. Once it is off, restore its persistent definition from section 1. If using a new shell, set `kvm_backup_dir` to the actual backup directory. This restores CPU, memory and interface definitions, not disk contents or guest files.

```sh
# Host: VM must be stopped; confirm the backup path before restoring.
sudo virsh -c qemu:///system define "$kvm_backup_dir/domain.xml"
sudo virsh -c qemu:///system domiflist ops-lab --inactive
```

Restore the host's previous Netplan files and validate them through the console with `netplan generate` / `netplan try`. If the original lab VM had no NICs, it will again require console access. Confirm that networks required by the restored definition exist before starting it.

Remove the following libvirt networks only if this exercise created them and no running or stopped VM references them. `net-destroy` immediately stops a virtual network and interrupts its users; it does not delete a VM. Netplan manages `br-app`, which these `net-undefine` commands do not remove. Restore its original configuration and inspect actual interface state.

```sh
# Host: only after confirming these newly created networks have no users.
sudo virsh -c qemu:///system net-autostart lab-mgmt --disable
sudo virsh -c qemu:///system net-destroy lab-mgmt
sudo virsh -c qemu:///system net-undefine lab-mgmt
sudo virsh -c qemu:///system net-autostart lab-storage --disable
sudo virsh -c qemu:///system net-destroy lab-storage
sudo virsh -c qemu:///system net-undefine lab-storage
```

After rollback, recheck management access, default routes, service bindings, resource counts and boot persistence. Do not substitute `virsh destroy` for graceful shutdown or use `undefine --remove-all-storage` to fix resource configuration.

## References

- [Ubuntu Server: installing and using libvirt](https://documentation.ubuntu.com/server/how-to/virtualisation/libvirt/)
- [libvirt: virsh command reference](https://libvirt.org/manpages/virsh.html)
- [libvirt: domain XML, memory, CPUs and network devices](https://libvirt.org/formatdomain.html)
- [libvirt: virtual network XML and forwarding modes](https://libvirt.org/formatnetwork.html)
- [libvirt: macvtap host connectivity limitation](https://wiki.libvirt.org/TroubleshootMacvtapHostFail.html)
- [Netplan: YAML, matching, bridges and policy routing](https://netplan.readthedocs.io/en/stable/netplan-yaml/)
- [Netplan: configuration examples](https://netplan.readthedocs.io/en/stable/examples/)
- [Netplan: netplan try and rollback limitations](https://netplan.readthedocs.io/en/stable/netplan-try/)
- [Linux: IP forwarding and rp_filter](https://docs.kernel.org/networking/ip-sysctl.html)
