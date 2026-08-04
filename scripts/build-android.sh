#!/usr/bin/env bash
# Dicefall Android build helper.
# Usage:  scripts/build-android.sh assembleDebug
#         scripts/build-android.sh bundleRelease   (signed Play Store AAB)
#         scripts/build-android.sh assembleRelease (signed APK)
set -euo pipefail

export JAVA_HOME="${JAVA_HOME:-$HOME/opt/jdk21}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/Sdk}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$JAVA_HOME/bin:$PATH"

cd "$(dirname "$0")/../android"
./gradlew "$@"
