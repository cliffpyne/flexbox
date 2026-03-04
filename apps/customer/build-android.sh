#!/bin/bash
# build-android.sh — place this at apps/customer/
# Run with: ./build-android.sh
# Or: ./build-android.sh release

set -e

MODE=${1:-debug}

# ── Java check ────────────────────────────────────────────────────────────────
if [ -z "$JAVA_HOME" ]; then
  # Try common Linux JDK 17 paths
  for jpath in \
    "/usr/lib/jvm/java-17-openjdk-amd64" \
    "/usr/lib/jvm/java-17-openjdk" \
    "/usr/lib/jvm/temurin-17"; do
    if [ -f "$jpath/bin/java" ]; then
      export JAVA_HOME="$jpath"
      export PATH="$JAVA_HOME/bin:$PATH"
      echo "✅ JAVA_HOME set to $JAVA_HOME"
      break
    fi
  done
fi

if [ -z "$JAVA_HOME" ] || [ ! -f "$JAVA_HOME/bin/java" ]; then
  echo "❌ Java 17 not found. Install it with:"
  echo "   sudo apt install openjdk-17-jdk"
  echo "Then add to ~/.bashrc:"
  echo "   export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64"
  echo "   export PATH=\$JAVA_HOME/bin:\$PATH"
  exit 1
fi

echo "☕ Java: $(java -version 2>&1 | head -1)"

# ── Build ─────────────────────────────────────────────────────────────────────
cd "$(dirname "$0")/android"

echo ""
echo "🧹 Cleaning..."
./gradlew clean

echo ""
if [ "$MODE" = "release" ]; then
  echo "🏗️  Building RELEASE APK..."
  ./gradlew assembleRelease
  echo ""
  echo "✅ Done! APK at:"
  echo "   apps/customer/android/app/build/outputs/apk/release/app-release.apk"
else
  echo "🏗️  Building DEBUG APK + installing on connected device..."
  ./gradlew installDebug
  echo ""
  echo "✅ Done! App installed on device."
fi
