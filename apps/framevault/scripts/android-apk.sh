#!/usr/bin/env bash
# 打一个 Android debug 安装包。
#
# 用法（在 apps/framevault 下）：
#   bash scripts/android-apk.sh                # 默认 x86_64（模拟器，约 48 MB）
#   bash scripts/android-apk.sh aarch64        # 真机
#   bash scripts/android-apk.sh both           # 两个 ABI，一个通用包（约 80 MB）
#   APK_INSTALL=1 bash scripts/android-apk.sh  # 编完顺手装到已连接的设备
#
# 前置条件见 docs/DEV_ANDROID_zh-CN.md §1/§2：
#   - JAVA_HOME / ANDROID_HOME 已设置；
#   - Windows 上要能建符号链接（开发者模式 + **注销重登**，或用管理员终端）。
set -euo pipefail

TARGET="${1:-x86_64}"
case "$TARGET" in
  x86_64 | aarch64) TARGETS=(-t "$TARGET") ;;
  both) TARGETS=(-t x86_64 -t aarch64) ;;
  *)
    echo "未知目标：$TARGET（可选 x86_64 / aarch64 / both）" >&2
    exit 2
    ;;
esac

: "${JAVA_HOME:?请先设置 JAVA_HOME（JDK 17）}"
: "${ANDROID_HOME:?请先设置 ANDROID_HOME（Android SDK）}"

# 前端产物与 Rust 交叉编译都由 tauri CLI 负责；这里只补两件它会踩的事。
# 1) 不把调试符号打进 .so：352 MB → 约 48 MB（不改仓库配置，桌面 dev 构建不受影响）
export CARGO_PROFILE_DEV_DEBUG=0
# 2) 别让 Gradle 的文件监听占住上一次的产物（不然后面 packageUniversalDebug 删不掉旧 APK）
export GRADLE_OPTS="-Dorg.gradle.vfs.watch=false"

cd "$(dirname "$0")/.."

echo "== 停掉可能占着旧产物的 Gradle 守护进程 =="
(cd src-tauri/gen/android && ./gradlew --stop >/dev/null 2>&1 || true)

# 产物目录必须清干净：不清会出现"包体虚胖"——实测一次 70 MB 的包里，
# 条目只占 38 MB，中间夹着一段 ~31 MB 的零填充（正好是 .so 的大小），
# 是旧产物没被替换掉留下的空洞（与"Failed to delete some children"是同一个根）。
# 需要更彻底时用 CLEAN=1（连中间产物一起删，代价是重编一遍）。
if [[ "${CLEAN:-}" == "1" ]]; then
  echo "== CLEAN=1：清掉整个 app/build =="
  rm -rf src-tauri/gen/android/app/build
else
  rm -rf src-tauri/gen/android/app/build/outputs
fi

echo "== 开始构建（$TARGET）=="
pnpm tauri android build --debug --apk "${TARGETS[@]}"

APK="src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk"
ls -lh "$APK"

if [[ "${APK_INSTALL:-}" == "1" ]]; then
  echo "== 装到设备 =="
  adb install -r "$APK"
fi
