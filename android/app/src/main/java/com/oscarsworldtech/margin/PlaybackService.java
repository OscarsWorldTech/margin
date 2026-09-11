package com.oscarsworldtech.margin;

import android.content.Intent;
import android.net.Uri;

import androidx.annotation.Nullable;
import androidx.annotation.OptIn;
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.Player;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.datasource.DataSource;
import androidx.media3.datasource.DataSpec;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.datasource.ResolvingDataSource;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.session.MediaSession;
import androidx.media3.session.MediaSessionService;

import java.util.Collections;

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

    @Nullable private static volatile String authorization;
    /** scheme://host:port of the configured Margin server, the only place the token may go. */
    @Nullable private static volatile String credentialOrigin;

    @Nullable private MediaSession session;

    static void setAuthorization(@Nullable String value, @Nullable String serverBase) {
        authorization = value == null || value.isEmpty() ? null : value;
        credentialOrigin = originOf(serverBase);
    }

    /** Normalised scheme://host:port, with the default port made explicit. */
    @Nullable
    private static String originOf(@Nullable String url) {
        if (url == null || url.isEmpty()) return null;
        Uri uri = Uri.parse(url);
        String scheme = uri.getScheme();
        String host = uri.getHost();
        if (scheme == null || host == null) return null;
        scheme = scheme.toLowerCase(java.util.Locale.ROOT);
        int port = uri.getPort();
        if (port == -1) port = "https".equals(scheme) ? 443 : 80;
        return scheme + "://" + host.toLowerCase(java.util.Locale.ROOT) + ":" + port;
    }

    /**
     * The session is necessarily exported, so any app on the device can bind it and ask
     * this player to load a URI of its choosing. The token therefore travels per request
     * and only to the configured Margin server, never as a blanket default property.
     */
    private static DataSource.Factory authenticatedSource() {
        DefaultHttpDataSource.Factory http = new DefaultHttpDataSource.Factory()
                // The Margin server proxies media itself; it never redirects to another scheme.
                .setAllowCrossProtocolRedirects(false);
        return new ResolvingDataSource.Factory(http, (ResolvingDataSource.Resolver) dataSpec -> {
            String token = authorization;
            String allowed = credentialOrigin;
            if (token == null || allowed == null || !allowed.equals(originOf(dataSpec.uri.toString()))) {
                return dataSpec;
            }
            return dataSpec.withRequestHeaders(Collections.singletonMap("Authorization", token));
        });
    }

    @Override
    public void onCreate() {
        super.onCreate();
        ExoPlayer player = new ExoPlayer.Builder(this)
                .setMediaSourceFactory(new DefaultMediaSourceFactory(authenticatedSource()))
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
        session = new MediaSession.Builder(this, player)
                .setCallback(new MediaSession.Callback() {
                    @Override
                    public MediaSession.ConnectionResult onConnect(
                            MediaSession session, MediaSession.ControllerInfo controller) {
                        if (getPackageName().equals(controller.getPackageName())) {
                            return new MediaSession.ConnectionResult.AcceptedResultBuilder(session).build();
                        }
                        // Outside controllers are the system, headset and lock screen. They may
                        // transport-control, but must never choose what this player loads.
                        return new MediaSession.ConnectionResult.AcceptedResultBuilder(session)
                                .setAvailablePlayerCommands(
                                        new Player.Commands.Builder()
                                                .addAllCommands()
                                                .removeAll(
                                                        Player.COMMAND_SET_MEDIA_ITEM,
                                                        Player.COMMAND_CHANGE_MEDIA_ITEMS)
                                                .build())
                                .build();
                    }
                })
                .build();
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
        super.onDestroy();
    }
}
