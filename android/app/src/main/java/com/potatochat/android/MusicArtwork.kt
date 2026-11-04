package com.potatochat.android

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Rect
import android.graphics.Shader
import android.util.LruCache
import android.util.Log
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.ByteArrayOutputStream
import java.util.concurrent.TimeUnit

/** A capa original e o fundo são preparados juntos, fora da thread da interface. */
internal object MusicArtwork {
    data class Images(val cover: Bitmap, val background: Bitmap, val color: Int)
    val cache = LruCache<String, Images>(8)
    private val http = OkHttpClient.Builder().connectTimeout(8, TimeUnit.SECONDS).readTimeout(12, TimeUnit.SECONDS).build()

    fun load(url: String): Images? = runCatching {
        cache.get(url)?.let { return it }
        val bytes = http.newCall(Request.Builder().url(url).build()).execute().use { response ->
            if (!response.isSuccessful) {
                Log.w("PotatoMusic", "Capa indisponível: HTTP ${response.code}")
                return null
            }
            response.body?.byteStream()?.use { input ->
                val output = ByteArrayOutputStream()
                val buffer = ByteArray(8192)
                while (output.size() <= 2 * 1024 * 1024) {
                    val count = input.read(buffer)
                    if (count < 0) break
                    output.write(buffer, 0, count)
                }
                output.toByteArray()
            }
        } ?: return null
        if (bytes.size > 2 * 1024 * 1024) return null
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        val options = BitmapFactory.Options().apply {
            inSampleSize = 1
            while (bounds.outWidth / inSampleSize > 1024 || bounds.outHeight / inSampleSize > 1024) inSampleSize *= 2
        }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)?.let(::prepare)?.also { cache.put(url, it) }
    }.onFailure { Log.w("PotatoMusic", "Não foi possível carregar a capa da música.", it) }.getOrNull()

    fun prepare(cover: Bitmap): Images {
        val size = 384
        val small = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
        val side = minOf(cover.width, cover.height)
        val left = (cover.width - side) / 2
        val top = (cover.height - side) / 2
        Canvas(small).apply {
            drawColor(Color.rgb(24, 25, 29))
            drawBitmap(cover, Rect(left, top, left + side, top + side), Rect(0, 0, size, size), Paint(Paint.FILTER_BITMAP_FLAG))
        }
        var pixels = IntArray(size * size)
        small.getPixels(pixels, 0, size, 0, 0, size, size)
        // Suavização leve em resolução maior: mantém os contornos e as letras da capa reconhecíveis.
        repeat(2) {
            for (horizontal in listOf(true, false)) {
                val output = IntArray(pixels.size)
                for (y in 0 until size) for (x in 0 until size) {
                    var red = 0; var green = 0; var blue = 0
                    for (offset in -1..1) {
                        val px = if (horizontal) (x + offset).coerceIn(0, size - 1) else x
                        val py = if (horizontal) y else (y + offset).coerceIn(0, size - 1)
                        val color = pixels[py * size + px]
                        red += Color.red(color); green += Color.green(color); blue += Color.blue(color)
                    }
                    output[y * size + x] = Color.rgb(red / 3, green / 3, blue / 3)
                }
                pixels = output
            }
        }
        small.setPixels(pixels, 0, size, 0, 0, size, size)
        val averageRed = pixels.sumOf { Color.red(it).toLong() } / pixels.size
        val averageGreen = pixels.sumOf { Color.green(it).toLong() } / pixels.size
        val averageBlue = pixels.sumOf { Color.blue(it).toLong() } / pixels.size
        val color = Color.rgb((averageRed * 0.4).toInt(), (averageGreen * 0.4).toInt(), (averageBlue * 0.4).toInt())
        val background = Bitmap.createBitmap(512, 512, Bitmap.Config.ARGB_8888)
        Canvas(background).apply {
            drawBitmap(small, null, Rect(0, 0, 512, 512), Paint(Paint.FILTER_BITMAP_FLAG))
            val shade = Paint().apply { shader = LinearGradient(0f, 0f, 0f, 512f, 0x10000000, 0x50000000, Shader.TileMode.CLAMP) }
            drawRect(0f, 0f, 512f, 512f, shade)
        }
        small.recycle()
        return Images(cover, background, color)
    }
}
