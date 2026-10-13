---
{"title":"Python 3.9.2 to 3.14: Django Architecture and Code Migration","category":"Linux","kind":"Migration guide","date":"2026-10-13","summary":"Target Django 5.2 LTS through an inventory, framework transitions, Python 3.14 dependency rebuilds, code changes, database verification and staged rollback.","tags":["Python 3.14","Django","Code migration","Release rollback"]}
---
Moving from Python 3.9.2 to 3.14 involves four compatibility layers: the interpreter, Django, third-party dependencies and service entry points. This guide uses an existing Django monolith and provides code and commands for an isolated test environment. This website itself uses Node.js to generate static pages; no Django service has been migrated here. Replace the example package names, services and paths, including `config` and `apps`, with your application structure.

## 01 / Choose the target and compatibility route

As of October 13, 2026, Python 3.9 reached end of life in October 2025, and Django 4.2 support ended on April 7, 2026. Use those versions only for isolated migration verification, not as new production targets. This guide chooses Django 5.2 LTS, with extended support through April 2028, and a dependency-tested Python 3.14 maintenance release using a conventional CPython build with the GIL.

- Django 4.2 is the last series supporting Python 3.9; Python 3.12 support starts with 4.2.8.
- Django 5.0 does not support Python 3.9, so Django 5.x cannot be installed directly on the old interpreter.
- Django 5.2 supports Python 3.14 starting with 5.2.8. That is a compatibility minimum; select and pin a tested maintenance release for deployment.
- Inventory the actual Django version first. Python 3.9.2 does not imply the application runs Django 3.2.

The following route assumes Django 3.2 as the starting point. Earlier applications should first address deprecations one feature release at a time. Run the complete tests and retain a separate commit between arrows; unsupported stages run only in isolation.

```text
Python 3.9.2 + Django 3.2 (old environment baseline)
  -> Python 3.9 + Django 4.0 -> 4.1 -> 4.2
  -> Python 3.12 + Django 4.2.8 or a later maintenance release
  -> Python 3.12 + Django 5.0 -> 5.1 -> 5.2.8 or a later maintenance release
  -> Python 3.14 + the same Django 5.2 maintenance release
```

Resolve framework changes on an interpreter supported by both stages before replacing it. This helps attribute regressions to the right layer. See the [Django upgrade guide](https://docs.djangoproject.com/en/5.2/howto/upgrade-version/) for the recommended process.

## 02 / Inventory code, dependencies and entry points

Run baseline checks from the Django project root on a clean migration branch. `.venv-old` represents the existing environment. Management commands must use a dedicated test database, with credentials unable to write to production. Keep output locally: dependency lists may contain private repository addresses and need review before publication.

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

- Record interpreters and startup arguments for WSGI / ASGI services, management commands, scheduled jobs and Celery worker / beat processes.
- Check support ranges for Django REST framework, database drivers, Redis clients, storage backends, authentication packages, Pillow and cryptography libraries.
- Record database server versions, client libraries, extensions, operating systems, CPU architectures and compiler toolchains.
- Establish baseline tests for authentication, permissions, critical writes, uploads and background jobs before major upgrades.

## 03 / Preserve architecture boundaries and rebuild runtimes

Replacing Python does not require changing WSGI to ASGI or splitting a monolith into microservices. Preserve request, job and data-access responsibilities initially. Web processes, workers, beat and scheduled commands should use the same tested code and dependency set.

```text
Reverse proxy -> WSGI or ASGI service -> Django business layer -> Database
                                               |
                                               -> Queue -> Separate worker

config/                 settings, urls, wsgi, asgi
apps/                   Existing business applications and historical migrations
requirements/           Stage-specific inputs and exact version snapshots
tests/                  Existing API, permission, job and data regression tests
```

Provide Python 3.12 and 3.14 through supported OS packages, controlled images or a verified installation procedure. Do not replace `/usr/bin/python3` or copy old `site-packages`. Create a new venv for every stage and retain the original environment and release artifacts for rollback. Keep free-threaded builds and experimental optimizations outside this initial migration.

## 04 / Upgrade Django in stages and resolve warnings

Prepare `requirements/bridge39.in` and `requirements/bridge312.in` manually. Each contains reviewed third-party constraints for its stage, excluding Django. The following commands assume the Django 3.2 baseline passes and `python3.9` identifies an interpreter in the old series. Run installation and tests only in an isolated workspace. Stop on dependency resolution or test failures rather than skipping the affected stage.

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

This illustrates the upgrade sequence. In practice, run the commands inside the loop one stage at a time, address warnings, review changes and commit before continuing. A passing automated loop is not full acceptance. After reaching 4.2, repeat verification on Python 3.12 and progress through 5.0 and 5.1 to 5.2.

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

Resolve deprecations in your own code individually. Track third-party warnings and an upgrade plan rather than suppressing warnings globally. Do not patch installed venv packages to manufacture a temporary passing result.

## 05 / Replace removed Django APIs

Search for common old entry points, then change them according to their semantics. Matches are only leads: historical migrations, strings and third-party compatibility branches may also match. Avoid mechanical repository-wide replacements.

```bash
rg -n 'ugettext|force_text|django\.conf\.urls|DEFAULT_FILE_STORAGE|STATICFILES_STORAGE|USE_L10N|USE_DEPRECATED_PYTZ|is_ajax|index_together|PickleSerializer' config apps tests
```

- Replace `ugettext_lazy` with `gettext_lazy`, and `force_text` with `force_str`.
- Replace `django.conf.urls.url` with `django.urls.re_path`, or use `path` while preserving route contracts.
- Replace old PostgreSQL-specific `JSONField` in current models with `models.JSONField`. Review field changes without deleting applied migrations.
- Replace `index_together` with explicit `Meta.indexes`; review index names and migration execution plans separately.
- `HttpRequest.is_ajax()` has no universal replacement preserving every use case. Interpret headers according to the API contract, never as an authorization decision.
- Check the logout transition from GET to POST, schemes in CSRF trusted origins and changed custom middleware or authentication backend signatures.

The following fragment illustrates target imports and routing APIs. The `health` view is defined later in this guide.

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

`datetime.timezone.utc` works across the intermediate stages. `datetime.UTC` requires Python 3.11 or newer and is unsuitable for code still tested on Python 3.9. This is a fragment: preserve existing routes when merging it.

## 06 / Migrate storage, time-zone and primary-key settings

`DEFAULT_FILE_STORAGE` and `STATICFILES_STORAGE` were removed in Django 5.1. Use `STORAGES`, preserving both the `default` and `staticfiles` aliases. This local-file example belongs in existing settings and uses the project's `BASE_DIR`. Applications with object storage must migrate their original backend and OPTIONS rather than switch to local disk.

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

Review `USE_TZ`, `TIME_ZONE` and `DEFAULT_AUTO_FIELD` separately; do not silently alter data semantics. Django 5.0 changed the default `USE_TZ` to True. For applications using naive times, establish the database type, original time zone and historical-data conversion plan first. Moving from `pytz` to `zoneinfo` needs tests for ambiguous and nonexistent daylight-saving times; replacing `localize()` with a simple `tzinfo` assignment is insufficient.

Applications originally using AutoField can explicitly preserve it as below. If the project already uses BigAutoField or application-level `AppConfig.default_auto_field`, retain those choices and check them individually. Primary-key conversion is a separate database change.

```python
DEFAULT_AUTO_FIELD = "django.db.models.AutoField"
SESSION_SERIALIZER = "django.contrib.sessions.serializers.JSONSerializer"
```

Confirm formatting and time-zone behavior before removing obsolete `USE_L10N` and `USE_DEPRECATED_PYTZ` settings. JSON sessions cannot store arbitrary Python objects. When replacing Pickle sessions, update stored values and test handling of existing sessions; schedule reauthentication if necessary rather than promising complete session compatibility.

## 07 / Address standard-library and runtime changes

This upgrade spans Python 3.10 through 3.14. Review the removed features and Porting sections for every release. Prioritize dependencies on old standard-library modules, event loops and process startup behavior in both application and third-party code.

```bash
rg -n '\b(distutils|imp|cgi|cgitb|crypt|imghdr|asyncore|asynchat)\b|get_event_loop|__annotations__|multiprocessing|ProcessPoolExecutor' config apps tests
```

- Python 3.12 removed modules including `distutils` and `imp`. Choose modern build tools and `importlib` replacements according to their purpose.
- Python 3.13 removed modules including `cgi`, `crypt` and `imghdr`. Upgrade their consumers instead of copying obsolete standard-library code into the project.
- Python 3.14 evaluates annotations lazily by default. Reflection, serialization and validation code need appropriate public annotation APIs and forward-reference tests.
- Python 3.14 raises RuntimeError from `asyncio.get_event_loop()` when no current loop exists. Use `asyncio.run()` at standalone synchronous entry points and `get_running_loop()` inside asynchronous contexts.
- On Unix except macOS, `multiprocessing` and `ProcessPoolExecutor` now default to forkserver. Check importable top-level functions, serializable arguments and main guards rather than relying on inherited parent memory.

The following event-loop entry point can be used as a standalone `tools/async_probe.py`. Do not place it directly inside an ASGI view already running on an event loop.

```python
import asyncio


async def main():
    await asyncio.sleep(0)
    return "ok"


if __name__ == "__main__":
    print(asyncio.run(main()))
```

Preserve functionality when replacing standard-library calls. File-type detection includes content validation, not just filename extensions. Password verification should retain Django's password-hashing interfaces and a tested compatibility path for existing hashes.

## 08 / Rebuild Python 3.14 dependencies and artifacts

Prepare `requirements/application.in` with reviewed business dependency ranges, excluding Django and Gunicorn. The following is an example `requirements/python314.in`. Retain the current database driver and service choices, verifying their Python 3.14 support individually.

```text
-r application.in
Django>=5.2.8,<5.3
gunicorn
```

First try installing `requirements/python312.txt` on Python 3.14 to isolate interpreter changes using the same dependencies. If a pinned version does not support 3.14, upgrade it on the shared Python 3.12 environment and retest. If different versions are necessary, record that difference rather than describing it as an interpreter-only change. The following resolves dependencies after this review.

```bash
python3.14 -m venv .venv314
.venv314/bin/python -m pip install --upgrade pip
.venv314/bin/python -m pip install -r requirements/python314.in
.venv314/bin/python -m pip check
.venv314/bin/python -m pip freeze > requirements/python314.txt
```

Unpinned inputs are for controlled resolution; production uses reviewed exact versions. `pip freeze` records an installed environment and is not a complete hashed lockfile solution. Use the project's existing lock tooling, hash verification and artifact repository where applicable. Never publish private index credentials or editable local paths in dependency files.

```bash
mkdir -p artifacts/wheelhouse
.venv314/bin/python -m pip download --only-binary=:all: -r requirements/python314.txt -d artifacts/wheelhouse
python3.14 -m venv .venv314-clean
.venv314-clean/bin/python -m pip install --no-index --find-links=artifacts/wheelhouse -r requirements/python314.txt
.venv314-clean/bin/python -m pip check
.venv314-clean/bin/python -VV
.venv314-clean/bin/python -m django --version
```

Prepare wheels in a build environment matching the production OS, CPU architecture and Python ABI; macOS downloads cannot be used directly on Linux. On binary download failures, distinguish missing wheels, unsupported packages and network errors. Build with a controlled toolchain only after confirming source compatibility. Successful installation still requires runtime verification.

## 09 / Verify databases and historical migrations

Django 5.2 supports PostgreSQL 14+, MySQL 8.0.11+ and MariaDB 10.5+. Also check driver compatibility and the database server's own maintenance status. If the database is below the minimum, complete a separate database upgrade and old-application compatibility check before upgrading Django. Keep interpreter replacement, database upgrades and destructive schema changes in separate releases.

Run these commands with configuration explicitly pointing to a restored test database. `makemigrations --check --dry-run` detects model drift without creating files; migration plans still require review. Test both migration from an empty database and upgrading a restored backup from the old release.

```bash
set -eu
.venv314-clean/bin/python manage.py check
.venv314-clean/bin/python manage.py makemigrations --check --dry-run
.venv314-clean/bin/python manage.py showmigrations --plan
.venv314-clean/bin/python manage.py migrate --plan
```

After confirming a restorable backup, acceptable plans and the correct test connection, apply reviewed migrations to that test database. Do not use `--fake`, delete historical migrations or recreate the migration table to bypass unexplained failures.

```bash
set -eu
.venv314-clean/bin/python manage.py migrate --noinput
.venv314-clean/bin/python manage.py migrate --check
.venv314-clean/bin/python -Wa manage.py test
```

## 10 / Verify code changes through interface contracts

Add a minimal liveness probe in `config/views.py` and merge its route into the existing `config/urls.py`. It confirms only that the Web process can handle requests. Database, cache and queue readiness require separate checks; this 200 response does not establish overall business health.

```python
from django.http import JsonResponse
from django.views.decorators.http import require_GET


@require_GET
def health(request):
    return JsonResponse({"status": "ok"})
```

Add contract tests in `config/test_health.py` to fix the response fields and allowed methods. Adapt the test command if the project package is not named `config`. These tests illustrate entry-point verification and do not replace the application suite.

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

Django's default test client skips CSRF checks. On a real service, middleware rejects a POST without a CSRF token as 403 before the method check; this does not imply that the view's method restriction failed. The third test explicitly enables CSRF checks to reflect the actual request pipeline.

```bash
.venv314-clean/bin/python -Wa manage.py test config.test_health
.venv314-clean/bin/python -Wa manage.py test
```

- API regressions: status codes, field types, pagination, sorting, error structures and repeated-request idempotency.
- Authentication: existing password hashes, login, logout, CSRF, permission boundaries, SSO callbacks and session expiry.
- Data: transaction commit and rollback, constraints, JSON queries, time zones, monetary precision and the actual database driver.
- Files: uploads, reads, signed URLs, static manifests and missing-resource handling.
- Jobs: serialization, retries, timeouts, connection cleanup, duplicate deliveries and worker restarts.
- Performance: compare p95/p99, error rate, memory, connections and queue latency under equal load without assuming an upgrade is faster.

## 11 / Verify service startup and production configuration

Collect static files and check deployment settings in a separate candidate environment. `config.settings.production` is an example module; use the actual configuration and existing secret management. `collectstatic` writes to storage, so use a candidate release directory or test bucket rather than overwrite old assets during testing.

```bash
set -eu
.venv314-clean/bin/python manage.py check --deploy --settings=config.settings.production
.venv314-clean/bin/python manage.py collectstatic --noinput --settings=config.settings.production
DJANGO_SETTINGS_MODULE=config.settings.production .venv314-clean/bin/python -m gunicorn config.wsgi:application --check-config
```

A WSGI candidate can listen locally using the following entry point. Use a port that does not conflict with an existing service. Gunicorn runs from the candidate venv and the application loads the actual runtime settings; determine production ports, process counts and timeouts through architecture-specific testing.

```bash
DJANGO_SETTINGS_MODULE=config.settings.production .venv314-clean/bin/python -m gunicorn config.wsgi:application --bind 127.0.0.1:8001 --workers 2
```

Existing ASGI applications should retain their Python 3.14-tested server and worker type rather than use this WSGI command. Explicitly point systemd ExecStart, container entry points, cron, workers and beat to the candidate runtime. Pin tested container versions or digests. Create venvs at their final release paths to avoid broken shebangs after moving them.

## 12 / Stage deployment and rollback

Complete candidate acceptance and database restore drills before release. Record the old code, interpreter, dependencies, configuration, assets and migration state so the complete previous release can start again.

- Apply additive migrations compatible with old code first; defer dropping fields or changing types until the rollback window closes.
- Execute database migrations from one release job, not concurrently from every starting Web or worker replica.
- Route a small share of traffic to candidate Web processes and compare errors, latency, connections, authentication and file access.
- Define queue and worker cutover behavior. Verify message contracts before mixing versions; retain a single beat scheduler to prevent duplicate jobs.
- Inspect cross-version pickle caches, sessions and payloads. Version or selectively invalidate caches according to their purpose rather than flush shared Redis indiscriminately.
- Establish rollback triggers, owners and timing. Code rollback requires old code to remain compatible with the current schema and messages.

On failure, stop expansion and restore the complete previous release using the tested routing procedure. Migrations may be irreversible, and new writes make blindly restoring an old backup unsafe. Evaluate forward fixes or controlled recovery with explicit data-loss implications. Do not improvise reverse migrations against an unknown database state.

## 13 / Common failures and investigation order

- `No matching distribution`: check Requires-Python, platform wheels, constraints and index access; resolve dependencies rather than skip installation failures.
- `ModuleNotFoundError: distutils` or `cgi`: identify the importing package from the traceback, upgrade or fix it and rebuild a clean environment.
- `cannot import name ugettext_lazy` or old `url`: inspect application imports and third-party compatibility against the removal timeline.
- Storage unexpectedly falls back to disk: inspect obsolete settings, `STORAGES` aliases and production configuration loading.
- `no current event loop`: locate synchronous startup or task code and fix lifecycle management; never nest `asyncio.run()` inside ASGI requests.
- Unexpected primary-key migrations: compare original `DEFAULT_AUTO_FIELD`, application settings and model definitions before generating files.
- Lost logins or static 404s: check session serializers, old signature compatibility, storage manifests, asset rollout order and cache versions.

Deliver a compatibility matrix, staged commits, exact dependency versions, clean installation evidence, business regressions, migration drills and rollback steps. These examples cannot establish that a real Django project whose source was not provided has already been upgraded.

## References

- [Django Python compatibility](https://docs.djangoproject.com/en/5.2/faq/install/)
- [Django support periods](https://www.djangoproject.com/download/)
- [Django upgrade guide](https://docs.djangoproject.com/en/5.2/howto/upgrade-version/)
- [Django deprecation timeline](https://docs.djangoproject.com/en/5.2/internals/deprecation/)
- [Django settings reference](https://docs.djangoproject.com/en/5.2/ref/settings/)
- [Django database support](https://docs.djangoproject.com/en/5.2/ref/databases/)
- [Django session serialization](https://docs.djangoproject.com/en/5.2/topics/http/sessions/)
- [Django deployment checklist](https://docs.djangoproject.com/en/5.2/howto/deployment/checklist/)
- [Python 3.10 What's New](https://docs.python.org/3.10/whatsnew/3.10.html)
- [Python 3.11 What's New](https://docs.python.org/3.11/whatsnew/3.11.html)
- [Python 3.12 What's New](https://docs.python.org/3.12/whatsnew/3.12.html)
- [Python 3.13 What's New](https://docs.python.org/3.13/whatsnew/3.13.html)
- [Python 3.14 What's New and porting notes](https://docs.python.org/3.14/whatsnew/3.14.html)
- [Limits of pip freeze](https://pip.pypa.io/en/stable/cli/pip_freeze/)
