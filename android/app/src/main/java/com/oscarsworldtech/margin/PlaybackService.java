package com.oscarsworldtech.margin;

import android.content.Intent;
import androidx.annotation.Nullable;
import androidx.annotation.OptIn;
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.session.MediaSession;
import androidx.media3.session.MediaSessionService;

import java.util.HashMap;
import java.util.Map;

/**
 * Hosts playback outside the WebView.
 *
 * <p>The WebView cannot do this job. An {@code <audio>} element cannot send an
 * Authorization header, so it cannot reach an authenticated Margin server, and the
 * bundle's https://localhost origin treats a plain http server as mixed content and
 * blocks it. ExoPlayer has neither limitation.
 *
 * <p>Running as a MediaSessionService is what keeps audio going with the screen off
 * and supplies the notification, lock-screen and headset controls.
 */
@OptIn(markerClass = UnstableApi.class)
public class PlaybackService extends MediaSessionService {

    /** Sent with every media request. Replaced when the app signs in or out. */
    private static final Map<String, String> requestHeaders = new HashMap<>();
    @Nullable private static DefaultHttpDataSource.Factory httpFactory;

    @Nullable private MediaSession session;

    /** Applies to data sources created after this call, which covers each new load. */
    static synchronized void setAuthorization(@Nullable String value) {
        requestHeaders.clear();
        if (value != null && !value.isEmpty()) {
            requestHeaders.put("Authorization", value);
        }
        if (httpFactory != null) {
            httpFactory.setDefaultRequestProperties(requestHeaders);
        }
    }

    @Override
    public void onCreate() {
        super.onCreate();
        DefaultHttpDataSource.Factory factory = new DefaultHttpDataSource.Factory()
                // The Margin server proxies media itself; it never redirects to another scheme.
                .setAllowCrossProtocolRedirects(false);
        factory.setDefaultRequestProperties(requestHeaders);
        synchronized (PlaybackService.class) {
            httpFactory = factory;
        }
        ExoPlayer player = new ExoPlayer.Builder(this)
                .setMediaSourceFactory(new DefaultMediaSourceFactory(factory))
                // Pause instead of playing out loud when headphones are unplugged.
                .setHandleAudioBecomingNoisy(true)
                .build();
        // Requesting audio focus is what makes a phone call pause playback and resume after.
        // Focus changes must never move the position; ExoPlayer pauses and ducks without seeking.
        player.setAudioAttributes(
                new AudioAttributes.Builder()
                        .setUsage(C.USAGE_MEDIA)
                        .setContentType(C.AUDIO_CONTENT_TYPE_SPEECH)
                        .build(),
                true);
        session = new MediaSession.Builder(this, player).build();
    }

    @Nullable
    @Override
    public MediaSession onGetSession(MediaSession.ControllerInfo controllerInfo) {
        return session;
    }

    @Override
    public void onTaskRemoved(@Nullable Intent rootIntent) {
        // Swiping the app away while paused should not leave a silent service running.
        MediaSession current = session;
        if (current == null || !current.getPlayer().getPlayWhenReady()) {
            stopSelf();
        }
    }

    @Override
    public void onDestroy() {
        MediaSession current = session;
        if (current != null) {
            current.getPlayer().release();
            current.release();
            session = null;
        }
        synchronized (PlaybackService.class) {
            httpFactory = null;
        }
        super.onDestroy();
    }
}
