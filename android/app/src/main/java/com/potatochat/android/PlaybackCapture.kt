package com.potatochat.android

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioPlaybackCaptureConfiguration
import android.media.AudioRecord
import android.media.projection.MediaProjection
import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import androidx.annotation.RequiresApi
import java.nio.ByteBuffer
import java.util.concurrent.atomic.AtomicBoolean

/** PCM de playback em blocos de 10 ms, injetado no ADM sem abrir outro microfone. */
internal class PlaybackCapture(private val onError: (String) -> Unit) {
    @Volatile private var record: AudioRecord? = null
    @Volatile private var stopped = false
    private val reported = AtomicBoolean(false)

    @RequiresApi(29)
    fun start(context: Context, projection: MediaProjection) {
        if (context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED)
            throw SecurityException("Permita o áudio para transmitir o som interno.")
        val config = AudioPlaybackCaptureConfiguration.Builder(projection)
            .addMatchingUsage(AudioAttributes.USAGE_MEDIA)
            .addMatchingUsage(AudioAttributes.USAGE_GAME)
            .addMatchingUsage(AudioAttributes.USAGE_UNKNOWN)
            // Evita devolver ao interlocutor a própria voz e o áudio recebido pelo WebView.
            .excludeUid(android.os.Process.myUid()).build()
        val format = AudioFormat.Builder().setEncoding(AudioFormat.ENCODING_PCM_16BIT)
            .setSampleRate(48000).setChannelMask(AudioFormat.CHANNEL_IN_STEREO).build()
        val minimum = AudioRecord.getMinBufferSize(48000, AudioFormat.CHANNEL_IN_STEREO, AudioFormat.ENCODING_PCM_16BIT)
        check(minimum > 0)
        val input = AudioRecord.Builder().setAudioFormat(format)
            .setBufferSizeInBytes(maxOf(minimum * 2, 19200))
            .setAudioPlaybackCaptureConfig(config).build()
        record = input
        check(input.state == AudioRecord.STATE_INITIALIZED)
        input.startRecording()
        check(input.recordingState == AudioRecord.RECORDSTATE_RECORDING)
    }

    fun read(buffer: ByteBuffer, channels: Int, rate: Int): Long {
        buffer.clear()
        val input = record
        val count = if (!stopped && input != null && channels == 2 && rate == 48000)
            runCatching { input.read(buffer, buffer.capacity(), AudioRecord.READ_BLOCKING) }.getOrDefault(-1) else 0
        if (count <= 0) {
            if (!stopped && input != null && reported.compareAndSet(false, true))
                onError("O Android interrompeu o som interno. A transmissão de vídeo continua.")
            // O ADM externo não tem relógio de microfone; silêncio também precisa ser cadenciado.
            try { Thread.sleep(10) } catch (_: InterruptedException) { Thread.currentThread().interrupt() }
        }
        buffer.position(count.coerceAtLeast(0).coerceAtMost(buffer.capacity()))
        while (buffer.hasRemaining()) buffer.put(0)
        buffer.rewind()
        return System.nanoTime()
    }

    fun stop() { stopped = true; runCatching { record?.stop() } }
    fun release() { record?.release(); record = null }
}
