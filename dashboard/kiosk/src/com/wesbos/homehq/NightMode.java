package com.wesbos.homehq;

import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.util.Log;
import android.view.MotionEvent;
import android.view.WindowManager;
import java.io.File;
import java.util.Calendar;

/**
 * Optional night schedule: between two hours the backlight is switched off while the kiosk is in
 * front, and any touch turns it back on for a minute. Off unless both hours are set:
 *   adb shell am start -n com.wesbos.homehq/.MainActivity --ei night_from 22 --ei night_to 7
 * (--ei night_from -1 turns it off again). Android's own brightness can't go below its minimum
 * (20/255 on an Allwinner A33 Frameo), so the backlight is written through the display driver
 * with the frame's shipped su. Without that, it falls back to the lowest window brightness.
 * The touch that wakes the screen is passed on to the page, which keeps its own blackout.
 */
class NightMode {
  static final String TAG = "HomeHQ";
  static final String PREF_FROM = "night_from";
  static final String PREF_TO = "night_to";
  static final long AWAKE_MS = 60_000;
  static final long TICK_MS = 15_000;
  // Allwinner sunxi display driver; other frames may differ (then the fallback is used).
  static final String BACKLIGHT = "/sys/class/disp/disp/attr/lcdbl";

  private final Activity activity;
  private final SharedPreferences prefs;
  private final Handler handler = new Handler(Looper.getMainLooper());
  private long awakeUntil;
  private boolean dark;
  private boolean running;

  private final Runnable tick = new Runnable() {
    @Override
    public void run() {
      update();
      handler.postDelayed(this, TICK_MS);
    }
  };

  NightMode(Activity activity, SharedPreferences prefs) {
    this.activity = activity;
    this.prefs = prefs;
  }

  /** Reads night_from / night_to extras, if present, and saves them. */
  void apply(Intent intent) {
    if (!intent.hasExtra(PREF_FROM) && !intent.hasExtra(PREF_TO)) return;
    int from = intent.getIntExtra(PREF_FROM, prefs.getInt(PREF_FROM, -1));
    int to = intent.getIntExtra(PREF_TO, prefs.getInt(PREF_TO, -1));
    prefs.edit().putInt(PREF_FROM, from).putInt(PREF_TO, to).apply();
    Log.i(TAG, "Night mode " + (from < 0 || to < 0 ? "off" : from + ":00-" + to + ":00"));
    update();
  }

  void start() {
    running = true;
    handler.removeCallbacks(tick);
    handler.post(tick);
  }

  /** Called when the kiosk leaves the front: never leave another app in the dark. */
  void stop() {
    running = false;
    handler.removeCallbacks(tick);
    setDark(false);
  }

  /** Any touch keeps the screen on for a minute. Never consumes the event. */
  void onTouch(MotionEvent e) {
    if (e.getActionMasked() != MotionEvent.ACTION_DOWN) return;
    awakeUntil = System.currentTimeMillis() + AWAKE_MS;
    if (dark) setDark(false);
  }

  private boolean isNight() {
    int from = prefs.getInt(PREF_FROM, -1);
    int to = prefs.getInt(PREF_TO, -1);
    if (from < 0 || to < 0 || from == to) return false;
    int h = Calendar.getInstance().get(Calendar.HOUR_OF_DAY);
    return from > to ? h >= from || h < to : h >= from && h < to;
  }

  private void update() {
    setDark(running && isNight() && System.currentTimeMillis() > awakeUntil);
  }

  private void setDark(boolean on) {
    if (on == dark) return;
    dark = on;
    int level = 0;
    if (!on) {
      level = Settings.System.getInt(activity.getContentResolver(), Settings.System.SCREEN_BRIGHTNESS, 255);
      level = Math.max(20, Math.min(255, level));
    }
    final int value = level;
    boolean viaDriver = new File(BACKLIGHT).exists();
    if (viaDriver) {
      new Thread(() -> {
        try {
          Process p = Runtime.getRuntime().exec(new String[] {"su", "0", "sh", "-c", "echo " + value + " > " + BACKLIGHT});
          if (p.waitFor() != 0) throw new Exception("su exit " + p.exitValue());
        } catch (Exception err) {
          Log.w(TAG, "Backlight write failed, using window brightness: " + err);
          handler.post(() -> windowBrightness(on));
        }
      }).start();
    } else {
      windowBrightness(on);
    }
    Log.i(TAG, on ? "Night: backlight off" : "Night: backlight on (" + value + ")");
  }

  private void windowBrightness(boolean on) {
    WindowManager.LayoutParams lp = activity.getWindow().getAttributes();
    lp.screenBrightness = on ? 0.01f : WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE;
    activity.getWindow().setAttributes(lp);
  }
}
