package com.potatochat.android

import android.app.Application
import android.app.Notification
import android.app.NotificationManager
import android.content.Context
import android.media.session.PlaybackState
import android.media.session.MediaSession
import android.media.MediaMetadata
import android.os.Handler
import org.junit.After
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.Implements
import org.robolectric.annotation.Implementation
import org.robolectric.shadow.api.Shadow
import org.robolectric.shadows.ShadowMediaSession

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33], shadows = [RecordingMediaSession::class])
class MediaNotificationsTest {
    private val app: Application get() = RuntimeEnvironment.getApplication()
    private val notifications get() = app.getSystemService(NotificationManager::class.java)
    private fun music() = MusicService.State("song-one", "room-one", "Uma música", "Artista", "", 180000, 25000, true, false, false, true)

    @After fun clear() {
        MusicService.stop(app)
        CallService.stop(app)
        MusicBridge.page = null
        CallBridge.page = null
    }

    @Test fun mediaNotificationHasTrackSessionAndControls() {
        val lifecycle = Robolectric.buildService(MusicService::class.java).create()
        val service = lifecycle.get()
        try {
            MusicService.update(app, music())
            val shown = shadowOf(notifications).getNotification(MusicService.NOTIFICATION_ID)
            assertEquals("Uma música", shown.extras.getCharSequence(Notification.EXTRA_TITLE))
            assertEquals("Artista", shown.extras.getCharSequence(Notification.EXTRA_TEXT))
            assertNotNull(shown.extras.getParcelable<android.media.session.MediaSession.Token>(Notification.EXTRA_MEDIA_SESSION))
            assertEquals(listOf("Voltar ao início", "Pausar", "Próxima", "Silenciar música", "Parar música"), shown.actions.map { it.title.toString() })
            assertArrayEquals(intArrayOf(0, 1, 2), shown.extras.getIntArray("android.compactActions"))
            val session = Shadow.extract<RecordingMediaSession>(service.mediaSession)
            assertEquals(PlaybackState.STATE_PLAYING, session.playback?.state)
            assertEquals(25000L, session.playback?.position)
            assertEquals("Uma música", session.publishedMetadata?.getString(MediaMetadata.METADATA_KEY_TITLE))
            MusicService.update(app, music().copy(playing = false, muted = true, canSkip = false))
            val paused = shadowOf(notifications).getNotification(MusicService.NOTIFICATION_ID)
            assertEquals("Reproduzir", paused.actions[1].title)
            assertEquals("Ativar som", paused.actions[3].title)
            assertNull(paused.actions[2].actionIntent)
            assertEquals(PlaybackState.STATE_PAUSED, session.playback?.state)
            MusicService.stop(app)
            assertNull(shadowOf(notifications).getNotification(MusicService.NOTIFICATION_ID))
        } finally { lifecycle.destroy() }
    }

    @Test fun musicActionsControlOnlyTheTrackShownAndSessionSupportsSeek() {
        val lifecycle = Robolectric.buildService(MusicService::class.java).create()
        val service = lifecycle.get()
        val received = mutableListOf<String>()
        MusicBridge.page = { action, uid, room, position -> received += "$action:$uid:$room:$position" }
        try {
            MusicService.update(app, music())
            val shown = shadowOf(notifications).getNotification(MusicService.NOTIFICATION_ID)
            for (index in listOf(1, 3, 4)) {
                shown.actions[index].actionIntent.send()
                service.onStartCommand(shadowOf(app).nextStartedService, 0, 1)
            }
            assertEquals(listOf("pause:song-one:room-one:null", "mute:song-one:room-one:null", "stop:song-one:room-one:null"), received)
            Shadow.extract<RecordingMediaSession>(service.mediaSession).callback?.onSeekTo(70000)
            assertEquals("seek:song-one:room-one:70000", received.last())
            val before = received.size
            MusicService.update(app, music().copy(uid = "song-two"))
            shown.actions[4].actionIntent.send()
            service.onStartCommand(shadowOf(app).nextStartedService, 0, 2)
            assertEquals(before, received.size)
        } finally { lifecycle.destroy() }
    }

    @Test fun callNotificationMuteHangupAndStaleCallGuard() {
        val lifecycle = Robolectric.buildService(CallService::class.java).create()
        val service = lifecycle.get()
        val received = mutableListOf<String>()
        CallBridge.page = { action, id -> received += "$action:$id" }
        val active = CallService.State("call-one", "Duda", null, "audio", true, 1000, true)
        try {
            CallService.update(app, active)
            val shown = shadowOf(notifications).getNotification(CallNotifications.ONGOING_ID)
            assertTrue(shown.flags and Notification.FLAG_ONGOING_EVENT != 0)
            val mute = shown.actions.first { it.title.toString() == "Silenciar" }
            mute.actionIntent.send()
            service.onStartCommand(shadowOf(app).nextStartedService, 0, 1)
            val hangup = shown.actions.first { shadowOf(it.actionIntent).savedIntent.action == CallService.ACTION_HANGUP }
            hangup.actionIntent.send()
            service.onStartCommand(shadowOf(app).nextStartedService, 0, 2)
            assertEquals(listOf("mute:call-one", "hangup:call-one"), received)
            CallService.update(app, active.copy(id = "call-two", mic = false))
            assertTrue(shadowOf(notifications).getNotification(CallNotifications.ONGOING_ID).actions.any { it.title.toString() == "Ativar microfone" })
            mute.actionIntent.send()
            service.onStartCommand(shadowOf(app).nextStartedService, 0, 3)
            assertEquals(2, received.size)
        } finally { lifecycle.destroy() }
    }
}

// Robolectric não transporta o estado por Binder; registra as publicações reais da sessão.
@Implements(MediaSession::class)
class RecordingMediaSession : ShadowMediaSession() {
    var playback: PlaybackState? = null
    var publishedMetadata: MediaMetadata? = null
    var callback: MediaSession.Callback? = null
    @Implementation fun setPlaybackState(value: PlaybackState?) { playback = value }
    @Implementation fun setMetadata(value: MediaMetadata?) { publishedMetadata = value }
    @Implementation fun setCallback(value: MediaSession.Callback?, handler: Handler?) { callback = value }
}
