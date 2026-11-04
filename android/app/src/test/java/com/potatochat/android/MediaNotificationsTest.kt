package com.potatochat.android

import android.app.Application
import android.app.Notification
import android.app.NotificationManager
import android.content.Context
import android.media.session.PlaybackState
import android.media.session.MediaSession
import android.media.MediaMetadata
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.drawable.BitmapDrawable
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.TextView
import android.widget.ImageButton
import android.view.View
import android.view.ViewGroup
import kotlin.math.abs
import java.io.File
import java.io.ByteArrayOutputStream
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.MockResponse
import okio.Buffer
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
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
import org.robolectric.annotation.GraphicsMode
import org.robolectric.shadow.api.Shadow
import org.robolectric.shadows.ShadowMediaSession

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33], shadows = [RecordingMediaSession::class])
class MediaNotificationsTest {
    private val app: Application get() = RuntimeEnvironment.getApplication()
    private val notifications get() = app.getSystemService(NotificationManager::class.java)
    private fun music() = MusicService.State("song-one", "room-one", "Uma música", "Artista", "", 180000, 25000, true, false, false, true)
    private fun assertImageColors(expected: Bitmap, actual: Bitmap) {
        // O Android pode redimensionar os bitmaps ao montar a notificação.
        for ((x, y) in listOf(0.1 to 0.2, 0.35 to 0.5, 0.9 to 0.8)) {
            val before = expected.getPixel((expected.width * x).toInt(), (expected.height * y).toInt())
            val after = actual.getPixel((actual.width * x).toInt(), (actual.height * y).toInt())
            for (channel in listOf(16, 8, 0)) assertTrue("a imagem deve preservar suas cores após o redimensionamento", abs(((before shr channel) and 255) - ((after shr channel) and 255)) <= 8)
        }
    }

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
            assertEquals(R.drawable.ic_notification, shown.smallIcon.resId)
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

    @Test @GraphicsMode(GraphicsMode.Mode.NATIVE)
    fun downloadsAndDecodesJpegBeforePreparingArtwork() {
        val original = Bitmap.createBitmap(600, 600, Bitmap.Config.ARGB_8888).apply { eraseColor(Color.rgb(40, 150, 70)) }
        val bytes = ByteArrayOutputStream().apply { assertTrue(original.compress(Bitmap.CompressFormat.JPEG, 90, this)) }.toByteArray()
        val server = MockWebServer()
        server.enqueue(MockResponse().setHeader("Content-Type", "image/jpeg").setBody(Buffer().write(bytes)))
        server.start()
        val worker = Executors.newSingleThreadExecutor()
        val url = "http://localhost:${server.port}/cover.jpg"
        try {
            val images = worker.submit<MusicArtwork.Images?> { MusicArtwork.load(url) }.get(30, TimeUnit.SECONDS)
            assertNotNull("o JPEG baixado deve ser decodificado, sem divisão por zero", images)
            assertEquals(600, images!!.cover.width)
            assertEquals(600, images.cover.height)
            assertEquals(512, images.background.width)
            assertSame(images, MusicArtwork.load(url))
            assertEquals("a imagem já carregada deve vir do cache", 1, server.requestCount)
            val live = System.getenv("POTATO_TEST_COVER_URL")
            if (!live.isNullOrBlank()) {
                val downloaded = worker.submit<MusicArtwork.Images?> { MusicArtwork.load(live) }.get(30, TimeUnit.SECONDS)
                assertNotNull("a capa real também deve carregar pelo cliente nativo", downloaded)
                assertTrue(downloaded!!.cover.width in 1..1024)
                File("build/outputs/previews/real-album-background.png").apply {
                    parentFile?.mkdirs()
                    outputStream().use { downloaded.background.compress(Bitmap.CompressFormat.PNG, 100, it) }
                }
                MusicArtwork.cache.remove(live)
            }
        } finally { worker.shutdownNow(); server.shutdown(); MusicArtwork.cache.remove(url) }
    }

    @Test @GraphicsMode(GraphicsMode.Mode.NATIVE)
    fun blurredBackgroundKeepsOriginalCoverAndClearsOnTrackChange() {
        val original = Bitmap.createBitmap(64, 64, Bitmap.Config.ARGB_8888)
        val pixels = IntArray(64 * 64) { if (it % 64 < 32) Color.RED else Color.BLUE }
        original.setPixels(pixels, 0, 64, 0, 0, 64, 64)
        val images = MusicArtwork.prepare(original)
        assertSame(original, images.cover)
        assertEquals(Color.RED, original.getPixel(0, 0))
        assertEquals(Color.BLUE, original.getPixel(63, 0))
        val middle = images.background.width / 2
        val center = images.background.getPixel(middle, middle)
        assertTrue("o fundo deve misturar as cores da capa", Color.red(center) > 20 && Color.blue(center) > 20)
        assertTrue(Color.red(images.background.getPixel(32, middle)) > Color.blue(images.background.getPixel(32, middle)))
        assertTrue(Color.blue(images.background.getPixel(images.background.width - 32, middle)) > Color.red(images.background.getPixel(images.background.width - 32, middle)))
        val url = "https://test.invalid/cover"
        MusicArtwork.cache.put(url, images)
        val lifecycle = Robolectric.buildService(MusicService::class.java).create()
        try {
            MusicService.update(app, music().copy(cover = url))
            val session = Shadow.extract<RecordingMediaSession>(lifecycle.get().mediaSession)
            assertTrue(original.sameAs(session.publishedMetadata?.getBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART)))
            assertTrue(images.background.sameAs(session.publishedMetadata?.getBitmap(MediaMetadata.METADATA_KEY_ART)))
            val shown = shadowOf(notifications).getNotification(MusicService.NOTIFICATION_ID)
            assertImageColors(original, (shown.getLargeIcon().loadDrawable(app) as BitmapDrawable).bitmap)
            MusicService.update(app, music().copy(uid = "new-song", cover = ""))
            assertNull(session.publishedMetadata?.getBitmap(MediaMetadata.METADATA_KEY_ART))
            assertNull(shadowOf(notifications).getNotification(MusicService.NOTIFICATION_ID).getLargeIcon())
        } finally { lifecycle.destroy(); MusicArtwork.cache.remove(url) }
    }

    @Test @Config(sdk = [32]) @GraphicsMode(GraphicsMode.Mode.NATIVE)
    fun olderAndroidShowsBlurredExpandedBodyAndWorkingControls() {
        val original = Bitmap.createBitmap(64, 64, Bitmap.Config.ARGB_8888).apply { eraseColor(Color.rgb(180, 70, 120)) }
        Canvas(original).drawRect(32f, 0f, 64f, 64f, Paint().apply { color = Color.BLUE })
        val images = MusicArtwork.prepare(original)
        val url = "https://test.invalid/legacy-cover"
        MusicArtwork.cache.put(url, images)
        val lifecycle = Robolectric.buildService(MusicService::class.java).create()
        val received = mutableListOf<String>()
        MusicBridge.page = { action, _, _, _ -> received += action }
        try {
            MusicService.update(app, music().copy(cover = url))
            val shown = shadowOf(notifications).getNotification(MusicService.NOTIFICATION_ID)
            val view = Notification.Builder.recoverBuilder(app, shown).createBigContentView().apply(app, FrameLayout(app))
            assertEquals("Uma música", view.findViewById<TextView>(R.id.music_title).text)
            assertImageColors(images.background, (view.findViewById<ImageView>(R.id.music_background).drawable as BitmapDrawable).bitmap)
            assertImageColors(original, (view.findViewById<ImageView>(R.id.music_cover).drawable as BitmapDrawable).bitmap)
            val labels = shown.actions.map { it.title.toString() }
            fun countButtons(node: View): Int = (if (node is ImageButton && node.contentDescription?.toString() in labels) 1 else 0) +
                (if (node is ViewGroup) (0 until node.childCount).sumOf { countButtons(node.getChildAt(it)) } else 0)
            assertEquals("o corpo expandido deve ter um único conjunto de controles", 5, countButtons(view))
            view.measure(View.MeasureSpec.makeMeasureSpec(420, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED))
            view.layout(0, 0, view.measuredWidth, view.measuredHeight)
            val preview = Bitmap.createBitmap(view.measuredWidth, view.measuredHeight, Bitmap.Config.ARGB_8888)
            view.draw(Canvas(preview))
            File("build/outputs/previews/music-notification-legacy.png").apply {
                parentFile?.mkdirs()
                outputStream().use { preview.compress(Bitmap.CompressFormat.PNG, 100, it) }
            }
            shown.actions[1].actionIntent.send()
            lifecycle.get().onStartCommand(shadowOf(app).nextStartedService, 0, 1)
            assertEquals(listOf("pause"), received)
        } finally { lifecycle.destroy(); MusicArtwork.cache.remove(url) }
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
