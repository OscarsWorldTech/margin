package com.oscarsworldtech.margin;

import android.content.ComponentName;
import android.os.Handler;
import android.os.Looper;

import androidx.annotation.Nullable;
import androidx.annotation.OptIn;
import androidx.core.content.ContextCompat;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MediaMetadata;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.session.MediaController;
import androidx.media3.session.SessionToken;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.common.util.concurrent.ListenableFuture;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * Bridges the reader to {@link PlaybackService}.
 *
 * <p>Every position crossing this boundary is seconds from the start of the whole
 * book, matching caption timestamps and saved notes. ExoPlayer works in per-track
 * milliseconds, so this class is the only place that conversion happens.
 */
@OptIn(markerClass = UnstableApi.class)
@CapacitorPlugin(name = "MarginPlayer")
public class MarginPlayerPlugin extends Plugin {

    @Nullable private MediaController controller;
    private double[] offsets = new double[0];
    private double[] durations = new double[0];
    @Nullable private String bookId;
    private double bookDuration;
    private boolean muted;
    private double volume = 1;
    @Nullable private String lastError;

    private interface ControllerAction {
        void run(MediaController controller);
    }

    private final Handler ticker = new Handler(Looper.getMainLooper());

    /**
     * ExoPlayer reports events, not elapsed time, so nothing would move the scrubber or
     * the read-along captions between a play and the next state change. The browser gets
     * this for free from the audio element's timeupdate; this is the equivalent.
     */
    private final Runnable tick = new Runnable() {
        @Override
        public void run() {
            MediaController current = controller;
            if (current == null || !current.isPlaying()) return;
            emit();
            ticker.postDelayed(this, 250);
        }
    };

    private void scheduleTicker() {
        ticker.removeCallbacks(tick);
        MediaController current = controller;
        if (current != null && current.isPlaying()) ticker.postDelayed(tick, 250);
    }

    private final Player.Listener playerListener = new Player.Listener() {
        @Override
        public void onEvents(Player player, Player.Events events) {
            // One notification per batch of changes rather than one per property.
            emit();
            scheduleTicker();
        }

        @Override
        public void onPlayerError(PlaybackException error) {
            // 401 and 403 arrive here as a source error; say something a person can act on.
            lastError = describe(error);
            emit();
        }
    };

    private static String describe(PlaybackException error) {
        Throwable cause = error.getCause();
        String detail = cause == null ? error.getMessage() : cause.getMessage();
        if (detail != null && (detail.contains("401") || detail.contains("403"))) {
            return "The Margin server rejected this request. Sign in again.";
        }
        if (detail != null && detail.contains("Cleartext")) {
            return "This build cannot use a plain http server. Use https.";
        }
        return detail == null ? "Audio could not be played." : detail;
    }

    /** Resolves the controller, starting the playback service on first use. */
    private void ensureController(PluginCall call, ControllerAction action) {
        getActivity().runOnUiThread(() -> {
            MediaController existing = controller;
            if (existing != null && existing.isConnected()) {
                action.run(existing);
                return;
            }
            SessionToken token =
                    new SessionToken(getContext(), new ComponentName(getContext(), PlaybackService.class));
            ListenableFuture<MediaController> pending =
                    new MediaController.Builder(getContext(), token).buildAsync();
            pending.addListener(
                    () -> {
                        try {
                            MediaController ready = pending.get();
                            ready.addListener(playerListener);
                            controller = ready;
                            action.run(ready);
                        } catch (Exception e) {
                            call.reject("Could not start playback: " + e.getMessage());
                        }
                    },
                    ContextCompat.getMainExecutor(getContext()));
        });
    }

    private double bookPosition(MediaController c) {
        int index = c.getCurrentMediaItemIndex();
        double base = index >= 0 && index < offsets.length ? offsets[index] : 0;
        return base + Math.max(0, c.getCurrentPosition()) / 1000.0;
    }

    private JSObject snapshot(@Nullable MediaController c) {
        JSObject state = new JSObject();
        state.put("bookId", bookId);
        state.put("position", c == null ? 0 : bookPosition(c));
        state.put("duration", bookDuration);
        state.put("playing", c != null && c.isPlaying());
        state.put("buffering", c != null && c.getPlaybackState() == Player.STATE_BUFFERING);
        state.put("ended", c != null && c.getPlaybackState() == Player.STATE_ENDED);
        state.put("speed", c == null ? 1 : c.getPlaybackParameters().speed);
        state.put("volume", volume);
        state.put("muted", muted);
        state.put("error", lastError);
        return state;
    }

    private void emit() {
        notifyListeners("snapshot", snapshot(controller));
    }

    /** The bearer token for media requests. Called on sign-in, sign-out and resume. */
    @PluginMethod
    public void configure(PluginCall call) {
        String token = call.getString("token");
        PlaybackService.setAuthorization(token == null || token.isEmpty() ? null : "Bearer " + token);
        call.resolve();
    }

    /** Loads a book paused. Never starts a different book silently. */
    @PluginMethod
    public void load(PluginCall call) {
        JSArray tracks = call.getArray("tracks");
        if (tracks == null || tracks.length() == 0) {
            call.reject("This book has no audio tracks.");
            return;
        }
        String id = call.getString("bookId", "");
        String title = call.getString("title", "");
        String author = call.getString("author", "");
        double startAt = call.getDouble("position", 0.0);

        List<MediaItem> items = new ArrayList<>();
        double[] starts = new double[tracks.length()];
        double[] lengths = new double[tracks.length()];
        try {
            for (int i = 0; i < tracks.length(); i++) {
                JSONObject track = tracks.getJSONObject(i);
                String url = track.getString("url");
                starts[i] = track.optDouble("startOffset", 0);
                lengths[i] = track.optDouble("duration", 0);
                items.add(
                        new MediaItem.Builder()
                                .setUri(url)
                                .setMediaMetadata(
                                        new MediaMetadata.Builder()
                                                .setTitle(title)
                                                .setArtist(author)
                                                .setIsPlayable(true)
                                                .build())
                                .build());
            }
        } catch (Exception e) {
            call.reject("Could not read the track list: " + e.getMessage());
            return;
        }

        ensureController(
                call,
                c -> {
                    offsets = starts;
                    durations = lengths;
                    bookId = id;
                    bookDuration = starts[starts.length - 1] + lengths[lengths.length - 1];
                    lastError = null;
                    int index = indexFor(startAt);
                    c.setMediaItems(items, index, (long) Math.max(0, (startAt - starts[index]) * 1000));
                    // Load paused. The reader decides when playback begins.
                    c.setPlayWhenReady(false);
                    c.prepare();
                    call.resolve(snapshot(c));
                });
    }

    private int indexFor(double position) {
        int index = 0;
        for (int i = 0; i < offsets.length; i++) {
            if (position >= offsets[i]) index = i;
        }
        return index;
    }

    @PluginMethod
    public void play(PluginCall call) {
        ensureController(call, c -> {
            lastError = null;
            c.play();
            call.resolve(snapshot(c));
        });
    }

    @PluginMethod
    public void pause(PluginCall call) {
        ensureController(call, c -> {
            c.pause();
            call.resolve(snapshot(c));
        });
    }

    @PluginMethod
    public void seek(PluginCall call) {
        double position = call.getDouble("position", 0.0);
        ensureController(call, c -> {
            int index = indexFor(position);
            c.seekTo(index, (long) Math.max(0, (position - offsets[index]) * 1000));
            call.resolve(snapshot(c));
        });
    }

    /** Changing speed must not seek or pause. */
    @PluginMethod
    public void setSpeed(PluginCall call) {
        float speed = call.getFloat("speed", 1f);
        ensureController(call, c -> {
            c.setPlaybackSpeed(speed);
            call.resolve(snapshot(c));
        });
    }

    /** Changing volume must not seek or pause. Mute keeps the level to restore. */
    @PluginMethod
    public void setVolume(PluginCall call) {
        double level = call.getDouble("volume", 1.0);
        boolean silent = Boolean.TRUE.equals(call.getBoolean("muted", false));
        ensureController(call, c -> {
            volume = level;
            muted = silent;
            c.setVolume(silent ? 0f : (float) level);
            call.resolve(snapshot(c));
        });
    }

    /** Read the real player time before updating captions or progress on resume. */
    @PluginMethod
    public void snapshot(PluginCall call) {
        ensureController(call, c -> call.resolve(snapshot(c)));
    }

    @PluginMethod
    public void dispose(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            ticker.removeCallbacks(tick);
            MediaController current = controller;
            if (current != null) {
                current.removeListener(playerListener);
                current.release();
                controller = null;
            }
            bookId = null;
            call.resolve();
        });
    }

    @Override
    protected void handleOnDestroy() {
        ticker.removeCallbacks(tick);
        MediaController current = controller;
        if (current != null) {
            current.removeListener(playerListener);
            current.release();
            controller = null;
        }
        super.handleOnDestroy();
    }
}
