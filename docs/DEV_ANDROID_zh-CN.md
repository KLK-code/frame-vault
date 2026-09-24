# 安卓打包与调试操作手册

> 面向：本仓库的开发者（Windows 主开发机 + MuMu 模拟器 / 真机）。
> 权威契约仍是 `AGENTS.md`；本文只讲**怎么把安卓包打出来、装上去、看现象**。
> 最后更新：2026-09-24（当天从零打通：init → 出包 → 装机 → 跑起来）。

---

## 0. 一句话

```bash
# 前端 + Rust 都编好，出一个能装的 APK（约 48 MB）
bash apps/framevault/scripts/android-apk.sh x86_64

# 装到已经连上 adb 的设备（MuMu 或真机）
adb install -r apps/framevault/src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk
```

跑之前有两件事必须是通的，见下面第 1、2 节。

**在 PowerShell 里怎么跑**（Windows 上最容易踩的一步）：`.sh` 不是 Windows 可执行文件，PowerShell 不会自己认它；而 `bash` 在这个环境里解析到的是 `usr\bin\bash.exe`（Git 的"真 bash"），**从 PowerShell 直接起它不带 Git 的环境**，`dirname` / `sed` / `uname` 全找不到，脚本和 pnpm 都会当场挂掉。两个可用办法：

```powershell
# ① 不用脚本，直接敲原命令（最省事，效果一样）
$env:CARGO_PROFILE_DEV_DEBUG = "0"
pnpm tauri android build --debug --apk -t aarch64

# ② 起一个 Git Bash（要在管理员 PowerShell 里起，新窗口才继承管理员权限）
Start-Process "C:\Program Files\Git\git-bash.exe"
#    然后在那个窗口里： bash scripts/android-apk.sh aarch64
```

（也可以用 `& "C:\Program Files\Git\bin\bash.exe" ...` —— 注意是 `bin` 不是 `usr\bin`。）

---

## 1. 环境（一次性）

| 需要 | 我们用的 | 怎么确认 |
|---|---|---|
| JDK 17 | `C:\Program Files\Java\jdk-17` | `java -version` |
| Android SDK | `%LOCALAPPDATA%\Android\Sdk`（compileSdk 36） | 目录里要有 `platforms/`、`build-tools/`、`ndk/` |
| NDK | 29.0.13846066（`ndk/` 下那一版） | 目录存在即可 |
| Rust 交叉目标 | `aarch64-linux-android` / `armv7-linux-androideabi` / `i686-linux-android` / `x86_64-linux-android` | `rustup target list --installed` |
| Tauri CLI | `@tauri-apps/cli`（devDependency） | **永远不要** `cargo install tauri-cli` |

补交叉目标（缺哪个补哪个）：

```bash
rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android
```

`gen/android` 工程已经生成好了（`pnpm tauri android init` 的产物，**要提交进仓库**——将来 SAF 的 Kotlin 插件就写在里面）。
**重跑 `android init` 会冲掉它**：里面有两处手工改动会一起丢（Gradle 镜像、将来加的 Kotlin 桥），别随手重跑。

---

## 2. Windows 上那两道坎（都踩过）

### 坎一：建符号链接要权限

出包时会报：

```
Failed to create a symbolic link ... Creation symbolic link is not allowed for this system.
```

原因：Tauri 把编好的 `.so` **软链接**进 `gen/android/app/src/main/jniLibs/<abi>/`（省得每回搬 180 MB），而 Windows 默认只让管理员建符号链接。**它死在编译成功之后**，看起来像"代码编不过"，其实不是。

两条路：

- **（推荐，一劳永逸）开开发者模式**：设置 → 系统 → 开发者选项 → 开发人员模式。
  ⚠️ **这条权限是登录时写进令牌的**：开完必须**注销重登或重启**才生效（`whoami /priv` 里能看到 `SeCreateSymbolicLinkPrivilege` 才算成）。
- （临时）用**管理员身份**的终端跑构建命令。

### 坎二：Gradle 守护进程占着旧产物

第二次构建可能报：

```
Execution failed for task ':app:packageUniversalDebug'.
  Failed to delete some children. This might happen because a process has files open ...
```

原因：上一次构建留下的 **Gradle 守护进程**开着文件监听，占着 `app/build/outputs` 不放（实测连改名都失败：`Device or resource busy`）。

修法：构建前先 `gradlew --stop`，必要时清掉旧产物（`scripts/android-apk.sh` 已经替你做了）。
**一劳永逸**的做法是把文件监听全局关掉（一次就够，写在你自己的 Gradle 配置里，不动仓库）：

```powershell
New-Item -ItemType Directory -Force "$env:USERPROFILE\.gradle" | Out-Null
Add-Content "$env:USERPROFILE\.gradle\gradle.properties" "org.gradle.vfs.watch=false"
```

### 附带一条：Gradle 发行包要换镜像

`services.gradle.org` 在国内基本必超时（`Downloading ... failed: timeout`）。已经改在
`gen/android/gradle/wrapper/gradle-wrapper.properties`：

```
distributionUrl=https\://mirrors.cloud.tencent.com/gradle/gradle-8.14.3-bin.zip
```

（版本号必须与原值一致；阿里云没有 gradle 镜像，实测 404。Maven 那边不用管：`dl.google.com` / Maven Central 实测都通。）

---

## 3. 出包：三种体积档位

体积的大头**只有一个**：Rust 编出来的 `.so`。debug 包默认**带完整调试符号**，两个 ABI 各 180 MB —— 这就是为什么原样的 debug 包有 352 MB。

| 档位 | 命令 | 体积 | 适合 |
|---|---|---|---|
| 原样（两个 ABI + 调试符号） | `pnpm tauri android build --debug --apk` | 352 MB | 要调 Rust 原生代码时 |
| **不带调试符号 + 单个 ABI** | `bash scripts/android-apk.sh x86_64` | **约 48 MB** | 日常调试（模拟器） |
| 不带调试符号 + 两个 ABI | `bash scripts/android-apk.sh both` | 约 80 MB | 一个包兼顾模拟器与真机 |
| `--split-per-abi` | 在上一行加 `--split-per-abi` | 各自约 40 MB | 分发前 |
| **release** | `pnpm tauri android build --apk` | 通常 20–40 MB | 正式给别人装 / 上架 |

不带调试符号靠一个环境变量，**不改仓库配置、也不影响桌面端的 dev 构建**：

```bash
CARGO_PROFILE_DEV_DEBUG=0 pnpm tauri android build --debug --apk -t x86_64
```

代价只有一条：调不了 Rust 原生代码的断点（前端调试完全不受影响）。

### release（正式包）要补一步签名

CLI 认 `gen/android/keystore.properties`。生成密钥与写配置：

```bash
keytool -genkey -v -keystore framevault.keystore -alias framevault \
  -keyalg RSA -keysize 2048 -validity 10000
```

```properties
# gen/android/keystore.properties（**不要提交**）
storeFile=/absolute/path/framevault.keystore
storePassword=...
keyAlias=framevault
keyPassword=...
```

⚠️ 另外：当前 `identifier` 是 `com.framevault.app`，tauri 会警告它**以 `.app` 结尾**（和 macOS 的 bundle 扩展名冲突）。**改 identifier 会连带改用户数据目录的位置**，所以要在还没有存量用户数据的时候改。

---

## 4. 装到设备上看

### MuMu 模拟器（x86_64 / Android 12，我们日常用它）

```bash
# 1) 起模拟器（或者直接双击 MuMu 图标）
"/e/Game Client/MuMuPlayer/nx_main/MuMuManager.exe" control -v 0 launch

# 2) 接 adb（用 SDK 的 platform-tools，别用 MuMu 自带那个，版本容易打架）
export PATH="$PATH:/c/Users/Rei82/AppData/Local/Android/Sdk/platform-tools"
adb connect 127.0.0.1:16384
adb devices            # 会同时看到 127.0.0.1:16384 与 emulator-5554，是同一台

# 3) 装 / 起 / 看
adb -s 127.0.0.1:16384 install -r <apk 路径>
adb -s 127.0.0.1:16384 shell am start -n com.framevault.app/.MainActivity
adb -s 127.0.0.1:16384 exec-out screencap -p > shot.png
adb -s 127.0.0.1:16384 logcat -d | grep -i framevault
```

**`adb install -r` 是覆盖安装、保留数据** —— 你之前的仓库与写的内容都还在。
也可以把 APK 直接**拖进 MuMu 窗口**让它自己装（最省事）。

### 直接读写 app 里的文件（只有 debug 包能这么干）

```bash
adb shell "run-as com.framevault.app ls -la /data/user/0/com.framevault.app/files/vault-demo"
adb shell "run-as com.framevault.app cat '/data/user/0/com.framevault.app/files/vault-demo/晨跑/2026-09-24 xx/note.md'"
```

两个坑：

- **app 数据目录是 `/data/user/0/com.framevault.app`**，`vaults.json` 就在这一层 —— **不是 `files/` 那层**
  （Tauri 的 `app_data_dir()` 走 Kotlin 的 `getDataDir`，实现是 `activity.dataDir`）。放错地方的表现是"什么都没有"，而且 `load()` 静默通过，毫无线索。
- **Android 上现在还建不了仓库**（选目录要等 SAF，见 `PROPOSAL_mobile_vault_saf_zh-CN.md`）。
  想在真机环境里用起来，就用 `run-as` 把一份仓库塞进去、再写 `vaults.json` 指向它。

---

## 5. 快循环：`tauri android dev`

改一行看一眼，比"打包→装"快一个数量级（前端走 vite HMR，Rust 改动自动重编）：

```bash
pnpm tauri android dev
```

前提同样是第 2 节的符号链接权限。它加载 `devUrl`，所以要 dev server 在跑（CLI 会自己拉起来）。

---

## 6. 踩过的坑速查

| 现象 | 真因 | 修法 |
|---|---|---|
| `Creation symbolic link is not allowed` | 非管理员不能建软链接；**死在编译成功之后** | 开开发者模式**并注销重登**，或用管理员终端 |
| 开发者模式开了还是失败 | 权限在**登录时**写进令牌，已存在的会话拿不到 | 注销重登 / 重启 |
| `Failed to delete some children`（packageUniversalDebug） | 上一次的 Gradle 守护进程占着旧产物 | 构建前 `gradlew --stop`；`GRADLE_OPTS=-Dorg.gradle.vfs.watch=false` |
| `Downloading services.gradle.org ... failed: timeout` | 国内直连该域名超时 | 换腾讯云镜像（见 §2） |
| `Port 1420 is already in use`（`tauri dev`） | 上一次的 vite 子进程没死（**杀外层 shell 不会连带杀子进程**） | `netstat -ano \| findstr :1420` 找 PID → `taskkill /F /PID <pid>` |
| `/data/user/0/...` 被拼成 `C:\Program Files\Git\data\...` | Git Bash 的路径转换 | 命令前加 `MSYS_NO_PATHCONV=1` |
| `no method named center/closable/decorations found for WebviewWindowBuilder` | 这三个方法在 tauri 里是 `#[cfg(desktop)]`，安卓没有 | 包进 `#[cfg(desktop)]`（AGENTS §9 有这一行） |
| 窗口里只有"localhost 拒绝连接" | 调试构建指向 vite dev server | 一律 `pnpm tauri dev`，别直接跑 exe |

---

## 7. 还没做的

- **真机（aarch64）验证**：只装过 x86_64 那个包。
- **Android Vault 访问（SAF）**：现在装完只能看空态，或手工塞仓库。设计见
  `docs/PROPOSAL_mobile_vault_saf_zh-CN.md`。
- **系统相机**：推迟到需要时再写 Kotlin 插件。
