# CI/CD: bfwonline.mrazrust.ru на выделенном Windows Server 2022

Репозиторий: https://github.com/megargan/bfwonline. Ветка workflow: `master`.

## Уточнение: сохранить существующий IIS

На сервере уже работает IIS с другим доменом; TCP 80/443 заняты и должны остаться у IIS. Предлагаемая схема для этого сервера: IIS обслуживает существующий домен и отдельный сайт `bfwonline.mrazrust.ru`; новый сайт проксирует HTTP и WebSocket в Ubuntu VM по внутренней сети через ARR + URL Rewrite. Сертификат нового домена устанавливается в IIS. Публичные порты нельзя целиком перенаправлять в VM.

В репозитории подготовлен `compose.iis.yml`: Caddy внутри VM слушает HTTP на частном интерфейсе VM, production API сохраняет HTTPS-origin и Secure cookies. Deployment script автоматически добавляет этот файл, когда в серверном `.env` задан `BFW_PROXY_BIND`. `compose.dev.yml` для production не подходит, потому что отключает production-настройки API. Установка Hyper-V потребует перезагрузки Windows с временной недоступностью существующих сайтов. Реальная работа через IIS ещё не проверена.

Проверить модули IIS без изменения конфигурации:

```powershell
Import-Module WebAdministration
Get-WebGlobalModule | Where-Object Name -match 'Rewrite|Routing|WebSocket' | Select-Object Name
Get-WindowsFeature Web-WebSockets
```

Предлагаемая схема: Windows Server → Hyper-V → Ubuntu Server 24.04 LTS → Docker Engine + Compose → Caddy, API и PostgreSQL. Установка выполняется на сервере, команды Ubuntu — внутри VM. Команды Windows — в PowerShell от администратора. Эта инструкция не означает, что сервер уже настроен.

## 1. Проверить сервер и подготовить VM

На Windows Server выполнить только диагностику:

```powershell
Get-WindowsFeature Hyper-V
Get-CimInstance Win32_Processor | Select-Object Name,VirtualizationFirmwareEnabled,SecondLevelAddressTranslationExtensions,VMMonitorModeExtensions
Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object LocalPort -in 22,80,443 | Select-Object LocalAddress,LocalPort,OwningProcess
```

Если Hyper-V ещё не установлен, аппаратная виртуализация доступна и можно перезагрузить сервер:

```powershell
Install-WindowsFeature -Name Hyper-V -IncludeManagementTools
```

После установки потребуется запланированная перезагрузка. Не перезагружать сервер с другими работающими сервисами без согласования. Для удалённого сервера сначала проверить доступ к консоли провайдера.

Создать VM с Ubuntu Server 24.04 LTS и OpenSSH Server. Стартовый ориентир для небольшого запуска: 2 vCPU, 4 GB RAM, 40 GB диска; это не оценка предельного онлайна. Включить автоматический старт VM после загрузки Windows.

Для этого сервера использовать внутренний Hyper-V switch и NAT: Windows сможет обращаться к VM по частному IP, VM — выходить в интернет. Частную подсеть выбрать после проверки существующих маршрутов, VPN и NAT, чтобы избежать пересечений. Не создавать внешний switch на единственном сетевом интерфейсе: это может оборвать RDP. Конкретные сетевые команды требуют текущей конфигурации сети сервера.

Нужна доступность Ubuntu по SSH из GitHub Actions. Workflow принимает секрет `DEPLOY_PORT` (если он не задан, используется 22); для этой установки указывать `2222`. TCP 80 и 443 остаются у IIS. API 3000, PostgreSQL 5432 и внутренний HTTP 8080 наружу не открывать; 8080 должен быть доступен только Windows-хосту через частную сеть VM. Для фильтрации опубликованных Docker-портов учитывать правила Docker/DOCKER-USER, не полагаться только на UFW.

## 2. Установить Docker в Ubuntu

Использовать официальный APT-репозиторий Docker:

```bash
sudo apt update
sudo apt install -y ca-certificates curl openssl openssh-server util-linux
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
sudo tee /etc/apt/sources.list.d/docker.sources > /dev/null <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $(. /etc/os-release && echo "$VERSION_CODENAME")
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker ssh
sudo adduser deploy
sudo usermod -aG docker deploy
sudo install -d -m 700 -o deploy -g deploy /srv/bfw
```

Членство в группе `docker` фактически даёт административный доступ. Пользователь `deploy` используется только для доверенной выкладки. После добавления в группу войти в новую SSH-сессию как `deploy`; проверить `docker version` и `docker compose version`.

## 3. DNS и конфигурация сайта

В DNS-зоне `mrazrust.ru` создать A-запись `bfwonline` → публичный IP Windows Server с IIS. AAAA-запись добавлять только при рабочем IPv6 до IIS.

Под пользователем `deploy` создать `/srv/bfw/.env`:

```bash
umask 077
cat > /srv/bfw/.env <<EOF
APP_DOMAIN=bfwonline.mrazrust.ru
BFW_PROXY_BIND=REPLACE_WITH_PRIVATE_VM_IPV4
POSTGRES_DB=bfw
POSTGRES_BOOTSTRAP_USER=bfw_bootstrap
POSTGRES_BOOTSTRAP_PASSWORD=$(openssl rand -hex 32)
APP_DB_PASSWORD=$(openssl rand -hex 32)
MIGRATION_DB_PASSWORD=$(openssl rand -hex 32)
BACKUP_DB_PASSWORD=$(openssl rand -hex 32)
EOF
chmod 600 /srv/bfw/.env
```

Заменить `REPLACE_WITH_PRIVATE_VM_IPV4` на фактический частный IPv4 Ubuntu до выкладки. Не указывать `0.0.0.0` или публичный IP. Выполнить создание `.env` один раз до первого деплоя: повторный запуск перезапишет пароли и нарушит доступ к существующей БД. Значения образов deployment script получает из GitHub Actions; в этом серверном `.env` они не нужны. Не копировать файл в GitHub. Нужен Compose версии не ниже 2.24.4 для `!override`.

### IP посетителей и лимиты регистрации

Caddy и API используют общий список `BFW_TRUSTED_PROXIES` из Compose: внутренние сети прокси и официальные IPv4/IPv6 диапазоны Cloudflare. Caddy сохраняет `X-Forwarded-For` только от доверенного узла и разбирает цепочку справа налево; API останавливается на первом недоверенном адресе. Поэтому лимит регистрации (5 попыток в час) применяется к IP посетителя, а не ко всем пользователям за одним контейнером. API-порт 3000 не публиковать наружу.

При другой сети список можно переопределить в `/srv/bfw/.env` через `BFW_TRUSTED_PROXIES` (IP/CIDR через пробел). Включить адреса всех своих промежуточных прокси и, если домен проксируется Cloudflare, её актуальные диапазоны: https://www.cloudflare.com/ips-v4/ и https://www.cloudflare.com/ips-v6/. Не использовать доверие ко всем адресам. После изменения пересоздать `api` и `web`; обновлённые образы и Compose применяются обычным deployment workflow. Лимиты хранятся в памяти API и сбрасываются при его перезапуске.

### Отдельный сайт IIS

1. Сохранить резервную копию конфигурации IIS перед изменениями. Например, в Windows PowerShell администратора: `& "$env:windir\system32\inetsrv\appcmd.exe" add backup ("Before-BFW-" + (Get-Date -Format yyyyMMdd-HHmmss))`.
2. Установить/получить сертификат с именем `bfwonline.mrazrust.ru` тем способом, которым уже обслуживаются сертификаты сервера; обеспечить его продление.
3. Создать отдельный каталог, например `C:\inetpub\bfwonline`, и новый сайт `BFW Online` с HTTPS binding: порт 443, hostname `bfwonline.mrazrust.ru`, SNI включён, сертификат нового домена. Существующий сайт и его bindings сохранить.
4. Скопировать `docker/iis/web.config.example` в новый каталог как `web.config`, заменив `VM_PRIVATE_IP` на тот же IP, что задан в `BFW_PROXY_BIND`. Не помещать этот файл в корень существующего сайта карт.
5. В IIS Manager проверить ARR → Server Proxy Settings → Enable proxy. Это настройка уровня сервера: перед её изменением учесть уже работающие правила проксирования. Никакие глобальные rewrite rules для BFW не создавать: правило находится только в новом сайте.
6. Проверить `Get-WindowsFeature Web-WebSockets`: нужен статус `Installed`. Имена модулей сами по себе не подтверждают статус роли. Если компонент отсутствует, добавить его в согласованное время.

Проверить маршрут HTTP из Windows в VM (`Test-NetConnection PRIVATE_VM_IP -Port 8080`) после запуска контейнеров. На первой выкладке IIS, сертификат и DNS уже должны быть настроены: deployment script проверяет внешний HTTPS и `/ws`, иначе откатит/остановит первый релиз. При необходимости добавить отдельно HTTP binding только нового hostname с перенаправлением на HTTPS; для основного сценария используется HTTPS URL. Внутренний Caddy не выпускает сертификаты — TLS заканчивается на IIS.

## 4. SSH-ключ выкладки

На своём компьютере создать отдельный ключ:

```powershell
ssh-keygen -t ed25519 -f "$env:USERPROFILE\.ssh\bfw_deploy" -C "bfw-github-deploy"
```

Текущий workflow использует ключ без passphrase. Публичный файл `bfw_deploy.pub` добавить в `/home/deploy/.ssh/authorized_keys` в Ubuntu. Владелец каталога и файла — `deploy`, права `700` на `.ssh`, `600` на `authorized_keys`.

Приватный ключ `bfw_deploy` сохранить только в GitHub Environment secret `DEPLOY_SSH_KEY`. Не отправлять ключ в чат или репозиторий.

Проверить вход с компьютера: `ssh -p 2222 -i ~/.ssh/bfw_deploy deploy@PUBLIC_IP`. Для нестандартного порта `DEPLOY_KNOWN_HOSTS` должна содержать строку вида `[PUBLIC_IP]:2222 ssh-ed25519 AAAA...`; `ssh-keyscan -p 2222 -t ed25519 PUBLIC_IP` формирует её, но fingerprint обязательно сверить по доверенной консоли Ubuntu:

```bash
sudo ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
```

Можно получить строку через `ssh-keyscan -t ed25519 PUBLIC_IP`, но fingerprint обязательно сверить с консолью сервера. Не принимать результат сканирования без проверки.

## 5. Настройки GitHub

В `megargan/bfwonline` → Settings → Environments создать `production`. Для контроля выкладки можно включить required reviewer, если это доступно для текущего тарифа/репозитория. Добавить Environment secrets:

| Имя | Значение |
| --- | --- |
| DEPLOY_HOST | Публичный IP или hostname SSH до Ubuntu, без `https://` |
| DEPLOY_PORT | Внешний SSH-порт до Ubuntu; здесь `2222` |
| DEPLOY_USER | `deploy` |
| DEPLOY_SSH_KEY | Полный приватный SSH-ключ, включая BEGIN/END |
| DEPLOY_KNOWN_HOSTS | Проверенная строка SSH host key для DEPLOY_HOST |
| GHCR_DEPLOY_USER | `megargan` либо отдельный пользователь с доступом к образам |
| GHCR_READ_TOKEN | GitHub personal access token **classic**, право `read:packages`, доступ к нужным пакетам |

`GITHUB_TOKEN` для публикации образов предоставляется самим Actions: отдельный секрет с таким именем не создавать. Разрешить Actions и используемые actions согласно настройкам репозитория/организации.

## 6. Загрузить код и выполнить первую выкладку

Локально пока нет настроенного remote и первого коммита. Перед загрузкой просмотреть `git status` и состав файлов; `.env`, `.run*`, локальные базы, дампы и кеш pnpm исключены через `.gitignore`. Учесть, что репозиторий может быть публичным.

Из каталога проекта после просмотра файлов:

```powershell
git remote add origin https://github.com/megargan/bfwonline.git
git add .
git diff --cached --stat
git commit -m "Initial BFW Online application and deployment"
git push -u origin master
```

Если remote уже добавлен, использовать существующий; не перезаписывать его автоматически. Если локальный репозиторий уже имеет историю или на GitHub появились коммиты, сначала согласовать истории, не использовать force push. Команды в этом разделе — инструкция, агент их не выполнял.

После push вкладка Actions запустит проверки и публикацию `ghcr.io/megargan/bfwonline/api`, `/web`, `/db`. Устранить все ошибки verify перед выкладкой. Затем Actions → **CI and release images** → **Run workflow** → ветка `master`.

Ручной запуск повторит проверки, опубликует образы и выполнит job `deploy-production`. При включённом reviewer подтвердить Environment deployment. Выкладка делает backup, запускает миграции, обновляет API/web по immutable digest и проверяет HTTPS, readiness и маршрут WebSocket. При ошибке пытается вернуть предыдущие API/web образы; миграции БД автоматически не откатываются. Первый неудачный деплой не имеет предыдущих образов для возврата.

Открыть https://bfwonline.mrazrust.ru и проверить регистрацию, вход и партию с двух аккаунтов. На Ubuntu состояние контейнеров можно посмотреть из каталога последнего релиза:

```bash
cd /srv/bfw/releases/COMMIT_SHA
set -a
. /srv/bfw/current-images.env
set +a
docker compose --env-file /srv/bfw/.env -f compose.yml -f compose.iis.yml ps
docker compose --env-file /srv/bfw/.env -f compose.yml -f compose.iis.yml logs --tail 100 api web
```

Обновления выкладываются тем же ручным запуском из `master`; обычный push только проверяет код и публикует образы. Обновление API прерывает активные партии. Аккаунты, аватары и колоды хранятся в постоянном PostgreSQL volume; не удалять его через `down -v`. Предмиграционные backup лежат в `/srv/bfw/backups`; отдельно настроить регулярное копирование за пределы сервера и проверку восстановления.

## Документация

- Hyper-V на Windows Server: https://learn.microsoft.com/en-us/windows-server/virtualization/hyper-v/get-started/install-hyper-v
- Docker Engine на Ubuntu: https://docs.docker.com/engine/install/ubuntu/
- Токен GHCR: https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry
- Buildx и кеш GitHub Actions: https://docs.docker.com/build/ci/github-actions/cache/
