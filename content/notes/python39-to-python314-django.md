---
{"title":"Python 3.9.2 升级到 3.14：Django 架构与代码迁移操作","category":"Linux","kind":"迁移实践","date":"2026-10-13","summary":"以 Django 5.2 LTS 为目标，拆分旧环境盘点、框架过渡、Python 3.14 依赖重建、代码修改、数据库验收与灰度回退。","tags":["Python 3.14","Django","代码迁移","发布回退"]}
---
把 Python 3.9.2 升级到 3.14，涉及解释器、Django、第三方依赖和运行入口四层兼容性。本文以已有 Django 单体应用为例，给出可在独立测试环境执行的代码与命令；本站自身是 Node.js 静态网站，并未运行或迁移 Django 服务。`config`、`apps`、服务名称和路径均为示例，应替换为实际项目结构。

## 01 / 确定目标版本与兼容路线

截至 2026-10-13，Python 3.9 已于 2025 年 10 月结束维护，Django 4.2 已于 2026-04-07 结束支持。旧版本只用于隔离环境中的迁移验证，不作为新生产目标。本文选择 Django 5.2 LTS，其扩展支持到 2028 年 4 月；Python 使用经过依赖验证的 3.14 系列维护版本，采用常规带 GIL 的 CPython 构建。

- Django 4.2 是支持 Python 3.9 的最后一支；从 4.2.8 起支持 Python 3.12。
- Django 5.0 不支持 Python 3.9，不能在原解释器上直接升级到 Django 5.x。
- Django 5.2 从 5.2.8 起支持 Python 3.14；这里的 5.2.8 是兼容下限，发布时应选择并锁定该分支已验证的维护版本。
- 实际 Django 版本必须先盘点；Python 3.9.2 不能用来推断项目一定运行 Django 3.2。

以下路线假设起点为 Django 3.2；更早版本先逐个功能版本处理弃用项。各箭头之间执行完整测试并保存独立提交，旧版本阶段只在隔离环境运行。

```text
Python 3.9.2 + Django 3.2（旧环境基线）
  -> Python 3.9 + Django 4.0 -> 4.1 -> 4.2
  -> Python 3.12 + Django 4.2.8 或更高维护版
  -> Python 3.12 + Django 5.0 -> 5.1 -> 5.2.8 或更高维护版
  -> Python 3.14 + 相同 Django 5.2 维护版
```

先在共同支持的解释器上修复框架差异，再更换解释器，便于定位是哪一层造成回归。迁移设计可以参考 [Django 版本升级指南](https://docs.djangoproject.com/en/5.2/howto/upgrade-version/)。

## 02 / 盘点代码、依赖与运行入口

在 Django 项目根目录、干净的迁移分支执行基线检查。`.venv-old` 表示已有旧环境；管理命令须连接专用测试数据库，测试账号不能拥有生产库的写权限。输出只留在本地，依赖清单可能含私有仓库地址，公开前需要清理。

```bash
git switch -c upgrade/python314-django52
mkdir -p artifacts/upgrade
.venv-old/bin/python -VV
.venv-old/bin/python -m django --version
.venv-old/bin/python -m pip freeze --all > artifacts/upgrade/baseline.txt
.venv-old/bin/python -m pip check
.venv-old/bin/python -Wa manage.py check
.venv-old/bin/python -Wa manage.py test
```

- 记录 WSGI / ASGI 服务、管理命令、定时任务、Celery worker / beat 各自的解释器和启动参数。
- 检查 Django REST framework、数据库驱动、Redis 客户端、存储后端、认证包、Pillow 和加密库的支持范围。
- 记录数据库服务端版本、客户端库、数据库扩展、操作系统、CPU 架构和编译工具链。
- 补齐登录、权限、关键写操作、文件上传和后台任务的基线测试，再开始大版本升级。

## 03 / 保留架构边界，重建运行环境

升级解释器不要求把 WSGI 改成 ASGI，也不要求把单体拆成微服务。先保持请求、后台任务和数据访问的职责不变，让 Web、worker、beat 与定时命令使用同一份已验证代码和依赖集合。

```text
反向代理 -> WSGI 或 ASGI 服务 -> Django 业务层 -> 数据库
                                    |
                                    -> 队列 -> 独立 worker

config/                 settings、urls、wsgi、asgi
apps/                   已有业务应用与历史 migrations
requirements/           分阶段输入清单与精确版本快照
tests/                  已有接口、权限、任务与数据回归测试
```

通过操作系统支持的软件源、受控镜像或已验证的安装流程提供 Python 3.12 和 3.14，不替换 `/usr/bin/python3`，不复制旧 `site-packages`。每个阶段新建 venv；原环境和发布产物保留作回退依据。首轮迁移不同时启用 free-threaded 构建或实验优化。

## 04 / 逐段升级 Django，清理弃用告警

先人工整理 `requirements/bridge39.in` 与 `requirements/bridge312.in`：保存该阶段第三方依赖约束，但不写 Django 约束。以下命令假设 Django 3.2 基线已通过，`python3.9` 指向旧环境同系列解释器；安装和测试仅在隔离工作区执行。若依赖解析或测试失败，停止在当前版本修复，不跳过中间版本。

```bash
set -eu
python3.9 -m venv .venv-bridge39
.venv-bridge39/bin/python -m pip install --upgrade pip
for target in 'Django>=4.0,<4.1' 'Django>=4.1,<4.2' 'Django>=4.2.8,<4.3'; do
  .venv-bridge39/bin/python -m pip install --upgrade "$target" -r requirements/bridge39.in
  .venv-bridge39/bin/python -m pip check
  .venv-bridge39/bin/python -Wa manage.py check
  .venv-bridge39/bin/python -Wa manage.py test
done
```

这是升级顺序示例。实际执行宜逐段运行循环中的命令，处理告警、审查差异、提交代码后再进入下一段；不把自动循环通过当作兼容性验收。4.2 阶段完成后，在 Python 3.12 上重复验证，并经过 5.0、5.1 到达 5.2。

```bash
set -eu
python3.12 -m venv .venv-bridge312
.venv-bridge312/bin/python -m pip install --upgrade pip
for target in 'Django>=4.2.8,<4.3' 'Django>=5.0,<5.1' 'Django>=5.1,<5.2' 'Django>=5.2.8,<5.3'; do
  .venv-bridge312/bin/python -m pip install --upgrade "$target" -r requirements/bridge312.in
  .venv-bridge312/bin/python -m pip check
  .venv-bridge312/bin/python -Wa manage.py check
  .venv-bridge312/bin/python -Wa manage.py test
done
.venv-bridge312/bin/python -m pip freeze > requirements/python312.txt
```

针对自有代码的弃用告警逐项修复；第三方包的告警记录来源与升级计划，不用全局关闭告警掩盖问题。不要改写 venv 内的包代码来制造一次性通过。

## 05 / 修改被移除的 Django API

先检索常见旧入口，再根据调用语义修改；检索命中只是线索。历史 migration 引用、字符串与第三方兼容分支也可能命中，不宜全仓库机械替换。

```bash
rg -n 'ugettext|force_text|django\.conf\.urls|DEFAULT_FILE_STORAGE|STATICFILES_STORAGE|USE_L10N|USE_DEPRECATED_PYTZ|is_ajax|index_together|PickleSerializer' config apps tests
```

- `ugettext_lazy` 改用 `gettext_lazy`，`force_text` 改用 `force_str`。
- `django.conf.urls.url` 改用 `django.urls.re_path`，或在保持路由合同的前提下改为 `path`。
- 当前模型的 PostgreSQL 专属旧 `JSONField` 改为 `models.JSONField`；核对字段差异，不删除已应用的 migration。
- `index_together` 转为明确的 `Meta.indexes`，迁移索引名称与执行计划需单独审查。
- `HttpRequest.is_ajax()` 没有可直接保留全部语义的替换；按接口合同判断请求头，不能以此决定权限。
- 检查退出登录由 GET 改 POST、CSRF trusted origins 需要 scheme，以及自定义中间件和认证后端签名变化。

例如，修改已有的导入与路由片段时，可以采用下面的目标 API；这里的 `health` 视图在后文定义。

```python
from datetime import timezone as datetime_timezone

from django.urls import path
from django.utils.encoding import force_str
from django.utils.translation import gettext_lazy as _

from .views import health

UTC = datetime_timezone.utc
STATUS_LABEL = _("Service status")
STATUS_CODE = force_str("ok")

urlpatterns = [
    path("healthz/", health, name="health"),
]
```

`datetime.timezone.utc` 可跨过渡阶段使用；`datetime.UTC` 要求 Python 3.11 及以上，不适合仍需在旧 Python 3.9 上验证的代码。示例只展示片段，合并时保留项目已有路由。

## 06 / 迁移存储、时区与主键配置

`DEFAULT_FILE_STORAGE` 和 `STATICFILES_STORAGE` 在 Django 5.1 被移除，改用 `STORAGES`，并保留 `default` 与 `staticfiles` 两个 alias。下面是本地文件存储的示例，放入已有 settings 且沿用项目的 `BASE_DIR`；使用对象存储的应用应迁移原后端及 OPTIONS，不能直接换成本地盘。

```python
MEDIA_ROOT = BASE_DIR / "var" / "media"
MEDIA_URL = "/media/"
STATIC_ROOT = BASE_DIR / "var" / "static"
STATIC_URL = "/static/"

STORAGES = {
    "default": {
        "BACKEND": "django.core.files.storage.FileSystemStorage",
    },
    "staticfiles": {
        "BACKEND": "django.contrib.staticfiles.storage.ManifestStaticFilesStorage",
    },
}
```

单独核对 `USE_TZ`、`TIME_ZONE` 和 `DEFAULT_AUTO_FIELD`，不要通过升级顺便改变数据语义。Django 5.0 的 `USE_TZ` 默认变成 True；原系统若使用无时区时间，应先确认数据库类型、原时区和历史数据转换方案。迁移 `pytz` 到 `zoneinfo` 时，夏令时的重复与不存在时刻需要独立测试，不能直接把 `localize()` 改成简单替换 `tzinfo`。

对于原来使用 AutoField 的应用，可以明确保留以下配置；若已有 BigAutoField 或应用级 `AppConfig.default_auto_field`，保持原值并分别核对。主键转换应作为独立数据库变更。

```python
DEFAULT_AUTO_FIELD = "django.db.models.AutoField"
SESSION_SERIALIZER = "django.contrib.sessions.serializers.JSONSerializer"
```

删除失效的 `USE_L10N` 与 `USE_DEPRECATED_PYTZ` 设置前，确认格式化和时区行为。JSON session 不能保存任意 Python 对象；原 session 使用 Pickle 时，应调整写入内容、验证旧 session 的处理方式，必要时安排重新登录，不承诺跨版本 session 完全兼容。

## 07 / 处理 Python 标准库与运行行为变化

升级跨度覆盖 3.10 到 3.14，按各版 What's New 中的移除项与 Porting 章节逐项核对。优先排查业务代码与第三方包对旧标准库、事件循环和进程启动方式的依赖。

```bash
rg -n '\b(distutils|imp|cgi|cgitb|crypt|imghdr|asyncore|asynchat)\b|get_event_loop|__annotations__|multiprocessing|ProcessPoolExecutor' config apps tests
```

- Python 3.12 移除了 `distutils`、`imp` 等模块；现代构建工具与 `importlib` 的替换需要按用途选择。
- Python 3.13 移除了 `cgi`、`crypt`、`imghdr` 等模块；优先升级引用它们的包，不临时拷贝旧标准库到项目。
- Python 3.14 默认延迟求值类型注解；反射、序列化或校验代码应使用合适的公共注解 API，并测试前向引用。
- Python 3.14 的 `asyncio.get_event_loop()` 在没有当前事件循环时会抛出 RuntimeError；独立同步入口可使用 `asyncio.run()`，异步上下文中使用 `get_running_loop()`。
- Unix 平台除 macOS 外，`multiprocessing` 与 `ProcessPoolExecutor` 默认改用 forkserver；检查顶层可导入函数、可序列化参数和 main 保护，不依赖父进程内存隐式继承。

以下是独立脚本的事件循环入口示例，可作为 `tools/async_probe.py`；不能把它直接放进已有事件循环的 ASGI 视图。

```python
import asyncio


async def main():
    await asyncio.sleep(0)
    return "ok"


if __name__ == "__main__":
    print(asyncio.run(main()))
```

标准库替换以功能合同为准。文件类型判定涉及内容验证，不能仅用扩展名代替；密码验证应沿用 Django 的密码哈希接口和已验证的旧哈希兼容路径。

## 08 / 重建 Python 3.14 依赖与发布产物

先整理 `requirements/application.in`：只列业务第三方依赖及经过审查的版本范围，不包含 Django 和 Gunicorn。`requirements/python314.in` 的示例内容如下；保留原数据库驱动和服务端选型，分别验证它们对 Python 3.14 的支持。

```text
-r application.in
Django>=5.2.8,<5.3
gunicorn
```

先尝试在 Python 3.14 上安装 `requirements/python312.txt`，以相同依赖集合隔离解释器差异。若旧锁定版本不支持 3.14，返回共同支持的 Python 3.12 环境升级该依赖并复测；确需不同版本时记录差异，不宣称这是一次纯解释器替换。以下命令是完成依赖审查后的重新解析流程。

```bash
python3.14 -m venv .venv314
.venv314/bin/python -m pip install --upgrade pip
.venv314/bin/python -m pip install -r requirements/python314.in
.venv314/bin/python -m pip check
.venv314/bin/python -m pip freeze > requirements/python314.txt
```

无约束输入只用于受控解析，生产发布使用审查后的精确版本快照。`pip freeze` 是环境快照，并不是带哈希的完整锁定方案；正式项目可使用已有锁定工具、哈希校验和制品仓库。不要把私有源凭证或可编辑的本机路径写入公共清单。

```bash
mkdir -p artifacts/wheelhouse
.venv314/bin/python -m pip download --only-binary=:all: -r requirements/python314.txt -d artifacts/wheelhouse
python3.14 -m venv .venv314-clean
.venv314-clean/bin/python -m pip install --no-index --find-links=artifacts/wheelhouse -r requirements/python314.txt
.venv314-clean/bin/python -m pip check
.venv314-clean/bin/python -VV
.venv314-clean/bin/python -m django --version
```

wheel 必须在目标生产 OS、CPU 架构和 Python ABI 对应的构建环境准备；macOS 下载结果不能直接交给 Linux。如果二进制下载失败，区分尚无 wheel、包不支持和网络问题；只有确认源码支持后才使用受控工具链构建，安装成功仍需运行验证。

## 09 / 校验数据库与历史 migration

Django 5.2 支持 PostgreSQL 14+、MySQL 8.0.11+ 和 MariaDB 10.5+，还需核对驱动及服务端自身的维护状态。数据库低于门槛时，先独立完成数据库升级与旧应用兼容验证，再推进框架升级；不要将解释器替换、数据库升级和破坏性表结构变更合成一次发布。

下列管理命令在配置明确指向恢复后的测试库时执行。`makemigrations --check --dry-run` 检测模型漂移，不生成迁移文件；计划输出仍需人工检查。验收既要覆盖空库从零迁移，也要覆盖旧版本备份恢复后升级。

```bash
set -eu
.venv314-clean/bin/python manage.py check
.venv314-clean/bin/python manage.py makemigrations --check --dry-run
.venv314-clean/bin/python manage.py showmigrations --plan
.venv314-clean/bin/python manage.py migrate --plan
```

确认备份可恢复、计划可接受、测试库连接正确后，再在该测试库应用已审查的迁移。不要用 `--fake` 跳过未知错误，也不要删除历史 migration 或重建迁移表来让检查通过。

```bash
set -eu
.venv314-clean/bin/python manage.py migrate --noinput
.venv314-clean/bin/python manage.py migrate --check
.venv314-clean/bin/python -Wa manage.py test
```

## 10 / 用接口合同验证代码修改

在 `config/views.py` 增加最小存活探针，并将路由合并到已有 `config/urls.py`。探针只确认 Web 进程能够处理请求；数据库、缓存和队列的就绪检查应另行实现，不能用这个 200 响应代表整套业务正常。

```python
from django.http import JsonResponse
from django.views.decorators.http import require_GET


@require_GET
def health(request):
    return JsonResponse({"status": "ok"})
```

在 `config/test_health.py` 编写合同测试，固定 JSON 字段和允许的方法；项目包名不是 `config` 时，相应修改测试命令。该测试仅是入口示例，不能替代原业务测试集。

```python
from django.test import Client, SimpleTestCase


class HealthContractTests(SimpleTestCase):
    def test_get_returns_stable_json(self):
        response = self.client.get("/healthz/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "ok"})

    def test_post_is_rejected(self):
        response = self.client.post("/healthz/")
        self.assertEqual(response.status_code, 405)

    def test_post_without_csrf_token_is_forbidden(self):
        client = Client(enforce_csrf_checks=True)
        response = client.post("/healthz/")
        self.assertEqual(response.status_code, 403)
```

Django 默认测试客户端不执行 CSRF 检查；真实服务中，缺少 CSRF token 的 POST 会先被中间件拒绝为 403，不能据此认为视图的方法限制失效。第三个测试明确启用 CSRF 检查，与真实请求链路对照。

```bash
.venv314-clean/bin/python -Wa manage.py test config.test_health
.venv314-clean/bin/python -Wa manage.py test
```

- 接口回归：状态码、字段类型、分页、排序、异常结构与重复请求幂等性。
- 认证回归：旧密码验证、登录、退出、CSRF、权限边界、SSO 回调与 session 到期。
- 数据回归：事务提交与回滚、约束、JSON 查询、时区、金额精度和真实数据库驱动。
- 文件回归：上传、读取、签名链接、静态资源 manifest 与缺失资源处理。
- 任务回归：消息序列化、重试、超时、连接释放、重复投递与 worker 重启。
- 性能回归：同负载下比较 p95/p99、错误率、内存、连接数和队列延迟，不预设升级一定更快。

## 11 / 验证服务启动与生产配置

先在独立候选环境收集静态文件并检查部署配置。`config.settings.production` 是示例模块，必须替换为实际配置，秘密通过现有密钥管理注入。`collectstatic` 会写入目标存储，测试时使用候选发布目录或测试 bucket，避免覆盖旧版本资源。

```bash
set -eu
.venv314-clean/bin/python manage.py check --deploy --settings=config.settings.production
.venv314-clean/bin/python manage.py collectstatic --noinput --settings=config.settings.production
DJANGO_SETTINGS_MODULE=config.settings.production .venv314-clean/bin/python -m gunicorn config.wsgi:application --check-config
```

WSGI 应用可在候选环境使用下列本机监听入口；不要同时启动到已有服务占用的端口。Gunicorn 从候选 venv 启动，应用加载真实运行配置；正式端口、进程数量与超时按现有架构验证后确定。

```bash
DJANGO_SETTINGS_MODULE=config.settings.production .venv314-clean/bin/python -m gunicorn config.wsgi:application --bind 127.0.0.1:8001 --workers 2
```

已有 ASGI 应用继续使用其经 Python 3.14 验证的服务器与 worker 类型，不用 WSGI 命令替代。systemd 的 ExecStart、容器入口、cron、worker 与 beat 都应显式指向候选环境；容器镜像锁定已验收的版本或 digest，venv 则在最终发布路径创建，避免移动后 shebang 失效。

## 12 / 灰度发布与回退

先完成候选环境验收与数据库恢复演练，再安排发布。发布前记录旧代码、解释器、依赖、配置、静态资源和数据库迁移状态，保证它们能够作为一个完整版本重新启动。

- 先执行兼容旧代码的扩展迁移，保留旧字段；删除字段、改类型等收缩迁移安排在回退窗口结束之后。
- 由单个发布任务执行数据库迁移，不让每个 Web / worker 副本启动时竞争执行。
- 将少量流量导入候选 Web 服务，对照错误率、延迟、数据库连接、认证和文件读写结果。
- 明确队列与 worker 的切换策略；不同版本共存前验证消息合同，beat 保持单一调度者，避免重复任务。
- 检查跨 Django 版本的 pickle 缓存、session 和数据载荷；按用途更换缓存版本或定向失效，不盲目清空共享 Redis。
- 回退触发条件、责任人和窗口预先确定；代码回退依赖旧代码仍能读取当前 schema 与消息。

失败时停止放量，按已验收的路由切换流程恢复完整旧发布。数据库迁移未必可逆，存在新写入时不能简单恢复旧备份；应评估前向修复或受控数据恢复，并明确可能的数据损失。不要在未知数据库状态下临时执行反向迁移。

## 13 / 常见故障与定位顺序

- `No matching distribution`：核对包的 Requires-Python、目标平台 wheel、版本约束和源访问，先处理依赖，不跳过安装错误。
- `ModuleNotFoundError: distutils` 或 `cgi`：从 traceback 找到实际引用者，升级或修复对应包，再重建干净环境。
- `cannot import name ugettext_lazy` 或旧 `url`：检查自有导入与第三方兼容性，按移除时间线逐项修正。
- 文件后端意外回到本地盘：检查失效的旧存储设置、`STORAGES` alias 和生产配置加载路径。
- `no current event loop`：定位同步启动逻辑或第三方任务代码，修正循环生命周期，不能在 ASGI 请求中嵌套 `asyncio.run()`。
- 自动生成大量主键迁移：对照原 `DEFAULT_AUTO_FIELD`、应用级配置和模型定义，审查差异后再生成文件。
- 切换后登录丢失或静态资源 404：核对 session serializer、旧签名兼容、存储 manifest、资源部署顺序与缓存版本。

可交付的结果应包括兼容矩阵、逐段代码提交、精确依赖清单、干净安装证据、业务回归、迁移演练和回退步骤。本文示例不能证明某个未提供源码的真实 Django 项目已经完成升级。

## 参考资料

- [Django Python 版本兼容性](https://docs.djangoproject.com/en/5.2/faq/install/)
- [Django 支持周期](https://www.djangoproject.com/download/)
- [Django 版本升级指南](https://docs.djangoproject.com/en/5.2/howto/upgrade-version/)
- [Django API 移除时间线](https://docs.djangoproject.com/en/5.2/internals/deprecation/)
- [Django settings 参考](https://docs.djangoproject.com/en/5.2/ref/settings/)
- [Django 数据库支持](https://docs.djangoproject.com/en/5.2/ref/databases/)
- [Django session 序列化](https://docs.djangoproject.com/en/5.2/topics/http/sessions/)
- [Django 部署检查清单](https://docs.djangoproject.com/en/5.2/howto/deployment/checklist/)
- [Python 3.10 What's New](https://docs.python.org/3.10/whatsnew/3.10.html)
- [Python 3.11 What's New](https://docs.python.org/3.11/whatsnew/3.11.html)
- [Python 3.12 What's New](https://docs.python.org/3.12/whatsnew/3.12.html)
- [Python 3.13 What's New](https://docs.python.org/3.13/whatsnew/3.13.html)
- [Python 3.14 What's New 与迁移说明](https://docs.python.org/3.14/whatsnew/3.14.html)
- [pip freeze 的能力边界](https://pip.pypa.io/en/stable/cli/pip_freeze/)
