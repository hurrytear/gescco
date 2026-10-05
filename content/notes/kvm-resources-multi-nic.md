---
{"title":"KVM 虚拟机配置：内存、CPU、网络与多网卡实践","category":"Linux","kind":"实践笔记","date":"2026-10-05","summary":"以 Ubuntu 和 libvirt 为例，配置 KVM 虚拟机的内存与 CPU，搭建 NAT、物理桥接和隔离网络，完成三网卡地址规划、策略路由、验收与回退。","tags":["KVM","libvirt","CPU","内存","多网卡","Netplan"]}
---
给 KVM 虚拟机增加内存、CPU 或网卡，需要同时检查宿主机容量、libvirt 的持久配置，以及来宾系统真正识别到的资源。本文以 Ubuntu Server 24.04 LTS、x86_64、QEMU/KVM 和 libvirt 为例，配置一台名为 `ops-lab` 的实验虚拟机，并用管理网、业务网、存储网三张网卡说明网络规划。

资料核对于 2026-10-05。命令是公开的配置示例，未在实际 KVM 宿主机执行；网段、MAC、接口名均须按自己的实验环境替换。

## 01 / 环境、连接与变更前的备份

假设来宾操作系统已经安装，虚拟机是持久定义，并有可用的图形或串口控制台。本文不涉及磁盘创建和系统安装。普通资源调整以停机维护为主；网络示例按一台尚未连接网卡的实验 VM 编排。已有网卡时先识别并复用，不能直接重复添加三张网卡。

以下命令在 **Ubuntu 宿主机** 上执行。已有环境先检查版本与服务状态；只有缺少组件时才安装软件包。BIOS/UEFI 需启用 Intel VT-x 或 AMD-V，嵌套虚拟化还需上层平台允许。

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

统一使用 `qemu:///system`，避免误连 `qemu:///session` 后看到另一组虚拟机。确认 `ops-lab` 是目标 VM、没有保存的运行状态需要恢复，并评估所有 VM 的内存峰值、宿主机缓存和 QEMU 开销。不要把全部物理内存分给来宾。

在没有并行修改的维护窗口备份 XML，再请求正常关机。`shutdown` 返回不代表已经关机；反复查询，直到状态为 `shut off`，再执行后续持久资源调整。若原本已关闭，跳过关机请求。

```sh
# Host: use the same shell for the backup path and later rollback.
umask 077
kvm_backup_dir=$(mktemp -d "$PWD/ops-lab-before.XXXXXX")
sudo virsh -c qemu:///system dumpxml ops-lab --inactive > "$kvm_backup_dir/domain.xml"
sudo virsh -c qemu:///system domiflist ops-lab --inactive
sudo virsh -c qemu:///system shutdown ops-lab
sudo virsh -c qemu:///system domstate ops-lab
```

XML 备份不包含磁盘数据、宿主机网络或来宾网络配置。另行保留磁盘备份，并在宿主机和来宾各自修改 Netplan 前保存完整配置。`--config` 修改下次启动使用的持久定义；`--live` 修改运行中的实例，两者可能不一致。涉及 CPU 模型、最大资源或拓扑时，通常需要真正关机后再 `start`，仅在来宾内 `reboot` 不会重建 QEMU 进程。

## 02 / 内存：固定容量、balloon 与热插拔

先配置最容易验收的固定 8 GiB。以下适用于未配置虚拟 NUMA、DIMM 热插拔或特殊内存后端的普通 VM，且当前已经关机、此次是扩容。先提高上限，再设定当前容量；复杂 NUMA 配置应同步调整各 cell，不能仅运行这两个命令。

```sh
# Host: persistent memory settings for a stopped, simple VM.
sudo virsh -c qemu:///system setmaxmem ops-lab 8192MiB --config
sudo virsh -c qemu:///system setmem ops-lab 8192MiB --config
sudo virsh -c qemu:///system dumpxml ops-lab --inactive
```

最终 XML 的相关字段应等价于下列内容。libvirt 可能规范化成 KiB，因此检查换算后的容量，而不是要求输出文字完全相同。XML 片段只用于说明现有定义中的字段，不能作为完整 domain 文件执行 `define`。

```xml
<memory unit='MiB'>8192</memory>
<currentMemory unit='MiB'>8192</currentMemory>
```

- `memory`：启动时的最大内存分配；普通 balloon 调整不能凭空越过这个范围。
- `currentMemory`：当前分配目标，可小于 `memory`；它不是应用已使用内存，也不等同于 QEMU 的 RSS。
- `maxMemory`：另一个字段，用于内存设备热插拔的容量上限和插槽规划；`setmaxmem` 不是配置 DIMM 热插拔的捷径。

**可选的在线增长案例**：只有在之前已关机配置 `memory=16384 MiB`、`currentMemory=8192 MiB`，并重新启动 VM 后，才尝试增长到 12 GiB。宿主机需容纳最高容量及开销，来宾需有可工作的 virtio balloon 驱动；`<memballoon model='virtio'/>` 位于现有 `<devices>` 中。不要把它重复添加到已有 balloon 设备旁。

```sh
# Host: optional scenario, only with a live 16 GiB ceiling already in place.
sudo virsh -c qemu:///system setmem ops-lab 12288MiB --live
sudo virsh -c qemu:///system dommemstat ops-lab
# Persist only after the guest has accepted the change and remains healthy.
sudo virsh -c qemu:///system setmem ops-lab 12288MiB --config
```

在线命令返回后，还要在来宾用 `free -h` 检查，并观察内存压力与应用健康。balloon 不能当成宿主机容量保障，启动和回收过程中可能暂时需要更多内存。在线缩容会挤压来宾工作集，宜先停服务或改用冷调整；带 DIMM、virtio-mem、HugePages、锁页或 NUMA 绑定的方案需单独设计，不能直接套用这个案例。

## 03 / CPU：数量、拓扑、模型与绑定

为这台实验 VM 规划 4 个启动 vCPU、最多 8 个，采用 1 socket × 8 cores × 1 thread 的最大拓扑。vCPU 是宿主机调度的执行线程，不意味着独占物理核心；增加数量前先确认瓶颈确实在 CPU，并查看宿主机竞争和来宾 steal time。

在 VM 关机时使用 `virsh edit`，将原有 `vcpu` 与 `cpu` 元素修改为下列片段。保留磁盘、固件、控制器等其他配置；如果已有逐 vCPU 的 `<vcpus>`、虚拟 NUMA 或绑定策略，要一起核对。最大拓扑乘积应等于 8，而不是当前启用数 4。

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

`host-passthrough` 用于本例固定宿主机，尽量向来宾暴露宿主机 CPU 能力。需要迁移时，应先确定整个集群兼容的 CPU 基线和 QEMU、微码条件；换成 `host-model` 也不等于获得任意跨型号迁移保证。`placement='static'` 不代表已经独占或绑定物理 CPU。

下一次启动并完成来宾引导后，可在支持 CPU 热插拔的 QEMU 机型和来宾上试增至 6 个。先改运行实例，再在来宾 `lscpu` 确认在线 CPU；确认成功后持久化。失败时保留原配置，改在维护窗口冷调整。不要在基线设置后尚未启动时运行 `--live`。

```sh
# Host: optional hot-add after the VM has booted with the eight-vCPU maximum.
sudo virsh -c qemu:///system setvcpus ops-lab 6 --live
sudo virsh -c qemu:///system vcpucount ops-lab
# Persist only after checking online CPUs inside the guest.
sudo virsh -c qemu:///system setvcpus ops-lab 6 --config
```

对延迟敏感的场景，可再按 `lscpu -e=CPU,CORE,SOCKET,NODE` 的实际映射规划 `vcpupin`，同时考虑 emulator 线程、I/O 线程和 NUMA 内存位置。不要把同一物理核心的两个 SMT 线程误当成两个独立核心，也不要把所有 vCPU 随意绑到同一个逻辑 CPU。基础部署先使用默认调度，拿到监控和基准结果后再绑定。

## 04 / 先选网络模式，再分配网卡职责

- NAT：VM 经宿主机进行地址转换访问外部网络；外部主机通常不能主动访问 VM，除非另行设计转发。适合实验和管理出口。
- Linux bridge：VM 像物理交换机上的独立端口，直接接入所桥接的二层网络。地址、DHCP、路由与 ACL 由该网络的规划决定，桥接本身不提供 NAT。
- libvirt isolated network：没有 `<forward>`，适合只需宿主机与同网 VM 互通的网络。它不是相同网段内 VM 之间的微隔离，也不阻止多网卡来宾自行转发。
- Routed network：上游明确知道 VM 网段的回程，通常不做 NAT；需协调路由和防火墙。本文不用它代替物理桥。
- macvtap / direct：有直接接物理接口的用法，但常见模式下宿主机与来宾不能经该接口直接互通。管理访问依赖宿主机时先评估这个限制。

本例三张网卡各司其职；管理接口提供唯一默认路由，业务与存储接口只承载指定网段。地址均为文档保留段，仅用于说明；真实部署前替换，并确保宿主机、VM、VPN 和物理 LAN 没有重叠网段。

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

三张虚拟网卡不要求宿主机有三张物理网卡。这里管理网走 NAT，存储网不出宿主机，只有业务网桥接独立物理端口。若存储设备在物理 SAN/LAN，应增加相应桥、VLAN 或路由设计，不能指望 isolated 网络自动连上机外存储。

## 05 / 建立管理 NAT 与隔离存储网络

以下在宿主机操作。先检查 `virsh net-list --all`、`ip link` 和路由，确认 `lab-mgmt`、`lab-storage`、`virmgmt`、`virstore` 及示例网段没有被使用。已有同名网络时先查看 `net-dumpxml`，不要覆盖未知定义。

将下面内容分别保存为当前工作目录的 `lab-mgmt.xml` 与 `lab-storage.xml`。管理网提供 `.100` 到 `.199` 的 DHCP 池；本文静态 VM 地址 `.10` 在池外。libvirt 的 DNS 服务可由管理网网关提供，但转发解析是否成功仍取决于宿主机 DNS 配置。

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

定义、启动并设置随宿主机启动。libvirt 会配置其管理网络需要的桥及转发过滤；检查与现有防火墙和其他虚拟化工具的兼容性，不要通过清空整个 nftables/iptables 规则集来解决冲突。`net-define` 写入持久配置，`net-start` 才激活网络。

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

默认安装里的 `default` / `virbr0` 也是常见 NAT 网络，但并非每台宿主机都已启用。可以复用经过核对的现有网络，此时同步替换后文的网络名称、网关与地址，不要再叠加同网段的新定义。

## 06 / 宿主机物理桥接与 VLAN 的位置

下面仅适用于 **Netplan + systemd-networkd 管理的 Ubuntu 宿主机**。`enp1s0` 已负责宿主机管理；`enp2s0` 是无 IP、无现有业务的专用有线端口，接入业务网交换机端口。不要在没有带外控制台时把当前 SSH 使用的物理口套进示例。

先备份 `/etc/netplan/`，确认 `enp2s0` 未被其他配置、NetworkManager、bond 或 cloud-init 重复管理，再新增 `/etc/netplan/60-kvm-app-bridge.yaml`，权限设为 600。保留其他文件中的宿主机管理配置。如果宿主机本身也要在业务网拥有 IP，应把 IP 配在 `br-app`，而不是其从属端口 `enp2s0`。

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

通过宿主机控制台检查并试应用，在计时期间确认管理通道和桥端口状态后再接受。STP 可能使端口短暂处于非转发状态。Netplan 对虚拟设备的回退存在限制，超时后也要实际确认原网络恢复，不能仅依赖自动回退。

```sh
# Host: after saving the bridge file and backing up existing Netplan files.
sudo chmod 600 /etc/netplan/60-kvm-app-bridge.yaml
sudo netplan generate
sudo netplan try --timeout 120
ip -br link
bridge link show
```

如果上游是 VLAN trunk，可在 Netplan 中先定义 `id: 120`、`link: enp2s0` 的 VLAN 子接口，再把它作为业务桥的成员；此时不要同时把物理父接口放进同一桥。交换机要放行相同 VLAN。VM 通常收到已解标签的业务流量，不要又在来宾重复打相同标签，除非设计的是端到端 trunk。

无线接口和限制源 MAC 数量的云平台 / 交换机端口，未必允许这种普通二层桥接。遇到外部不通，先检查物理链路、端口安全和 VLAN，再检查来宾。桥接 VM 暴露在物理 LAN，须在来宾和网络边界配置明确的访问控制。

## 07 / 在 libvirt 中连接三张 virtio 网卡

先确认两个 libvirt 网络处于 active 状态、`br-app` 已存在，并检查 `domiflist --inactive`。下面的 MAC 是固定实验示例，在所在二层网络必须唯一。以关机 VM 为基准：`type=network` 连接 libvirt 网络名称，`type=bridge` 连接宿主机 Linux bridge 名称，二者不要混用。

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

virtio 网卡要求来宾有相应驱动，Ubuntu 通常已提供。在线加网卡还取决于虚拟 PCI/PCIe 插槽、机型与来宾支持；可在确认这些条件后分别调整 live 和 persistent 定义，但本文用冷添加减少变量。不要因为 `--config` 已成功，就认为运行中的 VM 已经出现新设备。

`vnet0` 等宿主机 tap 名称与来宾的 `ens3`、`enp1s0` 没有可靠的一一命名关系。用 MAC 串起 `domiflist`、来宾 `ip link` 和配置文件，避免重启或新增设备后配错网卡。

## 08 / 来宾系统按 MAC 配置地址与路由

以下文件配置在 **Ubuntu 来宾内部**，不是宿主机。先通过控制台备份 `/etc/netplan/`，使用 `ip -br link` 核对 MAC，再把这些接口的原有定义合并为一份配置，例如 `/etc/netplan/60-ops-lab.yaml`。Netplan 会合并目录中的 YAML；不同 ID 的旧定义可能继续匹配同一设备，不能只添加新文件就认为旧 DHCP 配置失效。

如果网络由 cloud-init 管理，先按平台流程修改其权威配置或停止网络自动生成，避免重启后被覆盖。不要不加区分地删除整个目录。下面只配置 IPv4，并在这三张网卡上关闭 DHCPv6、RA 和链路本地地址；需要 IPv6 时另行规划网关、来源路由与防火墙，不能留下一条未检查的 IPv6 默认路径。

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

业务路由要求 `198.51.100.1` 是真实存在的业务路由器，并且它及远端网络具有回到 `198.51.100.0/25` 的路由；没有该路由器时删除这条示例静态路由，不要填一个虚构下一跳。`store0` 访问同一 `/24` 不需要网关，管理 DNS 可达性通过管理口验收。

在来宾控制台检查、试应用并确认，保留控制台直到下一次启动验证完成。`set-name` 的重命名若因原接口正在使用而失败，通过控制台重启后核对，不能仅凭配置文件认定名称已改变。

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

普通业务 VM 不需要转发其他机器的流量，预期两个 forwarding 值均为 0。若来宾还承担容器网关、路由器或 VPN 职责，先设计转发 ACL 和回程，不要仅因为有三张网卡就开启转发。分别按管理、业务、存储接口限制服务监听地址和防火墙规则；不要把三张网卡一起加入无条件可信区域。

两张网卡接入同一个 IPv4 子网可能引入 ARP、源地址选择与回程歧义。需要链路冗余时，考虑有上游配合的 bond；需要网络隔离时，用不同子网和 VLAN。多张网卡本身不会自动叠加单条连接的带宽。

## 09 / 多出口时用策略路由控制回程

上一节的主路由表只有一条默认路由，已满足本例大部分流量。只有当业务地址还需要向其他网络发起连接，或接收未列入特定路由的远端连接，并且回程必须经业务网关时，才增加来源策略路由。两个不同 metric 的默认路由主要表达优先级，不会自动实现按源地址返回各自出口，也不是可靠的远端链路健康检查。

下面是可选替换项：用此 `app` 段替换同一来宾文件中 `network.ethernets.app` 的原定义，其他段保持不变；不要作为第二份同设备定义重复追加。确认表号 120 和规则优先级 120 未使用，业务网关确实能路由目标网络。

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

重新通过 `netplan generate` 和控制台 `netplan try` 应用后，检查规则及带来源的路由查询。表 120 只服务匹配的业务源地址，主表默认仍走管理网。应用若未绑定业务地址，普通选路仍可能选管理口。还要访问管理或存储子网的业务源流量，需在策略表中补齐相应直连 / 特定路由，否则其默认路由会把流量送到业务网关。

```sh
# Guest: run after applying the optional policy-routing configuration.
ip rule show
ip route show table 120
ip route get 198.51.100.130 from 198.51.100.10
sysctl net.ipv4.conf.all.rp_filter net.ipv4.conf.app0.rp_filter
```

先修正缺失的回程、ACL 与来源地址选择，再分析 `rp_filter`。确实存在合法非对称路径时才评估接口级 loose 模式；不要全局关闭来源校验来掩盖错误路由。Linux 对 `all` 与接口的 `rp_filter` 采用较大值，调整时需一起观察。双出口还要考虑连接跟踪、NAT 与应用监听地址，不是加一条规则就完成高可用。

## 10 / 从资源到链路逐层验收

以下宿主机命令核对运行状态、持久配置、虚拟网卡连接及物理桥。`domifaddr --source lease` 主要看到 libvirt DHCP 分配；本文静态地址可能不在其中。需要 `--source agent` 时，须另行正确安装和配置来宾代理及对应通道，不能把空输出当作 VM 没有 IP。

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

再在来宾内核对实际资源和路由。基础案例预期 4 个在线 vCPU、约 8 GiB 内存，以及三张 MAC 对应的网卡；内核保留会使 `free` 的总量与 XML 略有差异。如果执行了可选在线扩容，按实际目标验收，不再用基础值判断失败。

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

- 管理网：确认网关、DNS 和批准的外部服务；NAT 出网成功不代表外部能够主动连接 VM。
- 业务网：确认桥端口进入 forwarding、上游允许 VM 的 MAC、VLAN 一致、网关及远端回程正确，再验证实际服务端口。
- 存储网：确认同桥目标可达、应用使用存储地址、VM 没有意外开启转发；ping 宿主机桥地址不等于存储服务已经正常。
- 性能：观察宿主机内存压力、来宾 CPU steal、接口丢包和实际工作负载。virtio 多队列、CPU pinning、HugePages 与 jumbo frame 都应在基线测量后逐项引入；MTU 需要整条路径匹配。
- 持久性：在维护窗口完整关机再启动，确认 CPU、内存、MAC、IP、路由与服务仍正确；宿主机重启后的桥和 libvirt 网络也应单独验收。

网关可能禁用 ICMP，应结合获准的 TCP/UDP 服务测试判断；不要仅因 ping 失败就关闭防火墙。必要时在具体 tap、bridge 或物理口抓取限定目标的流量，逐段判断包在哪里消失。

## 11 / 回退时同时恢复两层网络配置

先通过控制台保存当前状态、恢复来宾原有 Netplan 文件，再正常关闭 VM。确认已经关机后，使用第 1 节的备份恢复原始持久定义；若更换过 shell，将 `kvm_backup_dir` 指向实际备份目录。这样会恢复原有 CPU、内存与网卡定义，但不会回滚磁盘内容或来宾文件。

```sh
# Host: VM must be stopped; confirm the backup path before restoring.
sudo virsh -c qemu:///system define "$kvm_backup_dir/domain.xml"
sudo virsh -c qemu:///system domiflist ops-lab --inactive
```

再恢复宿主机原有 Netplan 配置，通过控制台 `netplan generate` / `netplan try` 验证。若这是原本无网卡的实验 VM，恢复后也会无网卡，需要继续使用控制台。确认原配置所需网络都存在后再启动。

只有当下面两个 libvirt 网络是本次新建、且没有任何运行或关闭的 VM 引用时，才移除它们。`net-destroy` 会立即停掉对应虚拟网络；它不是删除 VM，但会中断依赖该网络的连接。物理桥 `br-app` 由 Netplan 管理，不属于这两条 `net-undefine` 的范围，按备份恢复并核对实际接口状态。

```sh
# Host: only after confirming these newly created networks have no users.
sudo virsh -c qemu:///system net-autostart lab-mgmt --disable
sudo virsh -c qemu:///system net-destroy lab-mgmt
sudo virsh -c qemu:///system net-undefine lab-mgmt
sudo virsh -c qemu:///system net-autostart lab-storage --disable
sudo virsh -c qemu:///system net-destroy lab-storage
sudo virsh -c qemu:///system net-undefine lab-storage
```

回退结束后再次检查管理入口、默认路由、应用监听、资源数量和开机持久性。不要用 `virsh destroy` 强制断电代替正常关机，也不要用 `undefine --remove-all-storage` 处理资源配置问题。

## 参考资料

- [Ubuntu Server：libvirt 安装与使用](https://documentation.ubuntu.com/server/how-to/virtualisation/libvirt/)
- [libvirt：virsh 命令手册](https://libvirt.org/manpages/virsh.html)
- [libvirt：Domain XML、内存、CPU 与网络设备](https://libvirt.org/formatdomain.html)
- [libvirt：虚拟网络 XML 与转发模式](https://libvirt.org/formatnetwork.html)
- [libvirt：macvtap 的宿主机访问限制](https://wiki.libvirt.org/TroubleshootMacvtapHostFail.html)
- [Netplan：YAML、地址匹配、桥与策略路由](https://netplan.readthedocs.io/en/stable/netplan-yaml/)
- [Netplan：配置示例](https://netplan.readthedocs.io/en/stable/examples/)
- [Netplan：netplan try 与回退限制](https://netplan.readthedocs.io/en/stable/netplan-try/)
- [Linux：IP 转发与 rp_filter](https://docs.kernel.org/networking/ip-sysctl.html)
