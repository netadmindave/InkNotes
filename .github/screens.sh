#!/bin/bash
# Installs the debug build and screenshots each screen (opened directly with a "demo" extra).
set -x
mkdir -p shots
adb install -r app2/build/outputs/apk/debug/app2-debug.apk
adb shell pm grant com.netadmindave.inknotes2 android.permission.RECORD_AUDIO || true
adb shell settings put system user_rotation 1
for d in main train0 train1 train2 review review-edit formula settings; do
  adb shell am force-stop com.netadmindave.inknotes2
  adb logcat -c
  if [ "$d" = main ]; then adb shell am start -W -n com.netadmindave.inknotes2/.MainActivity
  else adb shell am start -W -n com.netadmindave.inknotes2/.MainActivity --es demo "$d"; fi
  sleep 12
  adb exec-out screencap -p > "shots/$d.png"
  adb logcat -d -v brief '*:V' | grep -iE "InkMath|AndroidRuntime|FATAL|inknotes2 .*(E|exception)" | tail -80 > "shots/$d-log.txt"
done
ls -la shots
