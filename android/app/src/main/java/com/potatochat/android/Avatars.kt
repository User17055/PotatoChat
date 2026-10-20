package com.potatochat.android

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.BitmapShader
import android.graphics.Canvas
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Shader
import android.graphics.Typeface
import androidx.core.graphics.ColorUtils
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.security.MessageDigest
import java.util.concurrent.TimeUnit
import kotlin.math.cos
import kotlin.math.min
import kotlin.math.sin

/**
 * Fotos de perfil para as notificações, já redondas. O endereço da foto muda a cada troca (chave aleatória do
 * site), então cada uma é baixada uma vez e fica guardada no cache. Sem foto: a inicial com as cores do site.
 * Faz rede: chame fora da thread principal.
 */
object Avatars {
    private const val SIZE = 192
    private val http = OkHttpClient.Builder().connectTimeout(8, TimeUnit.SECONDS).readTimeout(12, TimeUnit.SECONDS).build()
    private val memory = mutableMapOf<String, Bitmap>()

    /** url: endereço absoluto ou relativo ao site (como vem na presença); null = sem foto. */
    @Synchronized
    fun get(context: Context, name: String, url: String?): Bitmap {
        val absolute = url?.let { if (it.startsWith("http")) it else "${MainActivity.SITE_ORIGIN}/${it.trimStart('/')}" }
        val key = absolute ?: "inicial:$name"
        memory[key]?.let { return it }
        val bitmap = absolute?.let { download(context, it) }?.let(::round) ?: initial(name)
        memory[key] = bitmap
        return bitmap
    }

    private fun download(context: Context, url: String): Bitmap? {
        val file = File(context.cacheDir, "avatars/${sha1(url)}")
        if (!file.exists()) {
            val bytes = runCatching {
                http.newCall(Request.Builder().url(url).build()).execute().use { response ->
                    if (response.isSuccessful) response.body?.bytes() else null
                }
            }.getOrNull() ?: return null
            file.parentFile?.mkdirs()
            runCatching { file.writeBytes(bytes) }
        }
        return BitmapFactory.decodeFile(file.path)
    }

    /** Corta o centro num quadrado e deixa redondo. */
    private fun round(source: Bitmap): Bitmap {
        val side = min(source.width, source.height)
        val square = Bitmap.createBitmap(source, (source.width - side) / 2, (source.height - side) / 2, side, side)
        val scaled = Bitmap.createScaledBitmap(square, SIZE, SIZE, true)
        val output = Bitmap.createBitmap(SIZE, SIZE, Bitmap.Config.ARGB_8888)
        val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { shader = BitmapShader(scaled, Shader.TileMode.CLAMP, Shader.TileMode.CLAMP) }
        Canvas(output).drawCircle(SIZE / 2f, SIZE / 2f, SIZE / 2f, paint)
        return output
    }

    /** A inicial no degradê da pessoa, igual ao avatar do site (hue() e .avatar no styles.css). */
    private fun initial(name: String): Bitmap {
        var hue = 7
        name.codePoints().forEach { point -> hue = (hue * 31 + String(Character.toChars(point))[0].code) % 360 }
        val from = ColorUtils.HSLToColor(floatArrayOf(hue.toFloat(), 0.85f, 0.72f))
        val to = ColorUtils.HSLToColor(floatArrayOf(((hue + 30) % 360).toFloat(), 0.75f, 0.58f))
        val ink = ColorUtils.HSLToColor(floatArrayOf(hue.toFloat(), 0.70f, 0.12f))
        val output = Bitmap.createBitmap(SIZE, SIZE, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(output)
        // Degradê a 140°, como o linear-gradient(140deg, …) do site.
        val angle = Math.toRadians(140.0 - 90.0)
        val dx = (cos(angle) * SIZE / 2).toFloat()
        val dy = (sin(angle) * SIZE / 2).toFloat()
        val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            shader = LinearGradient(SIZE / 2f - dx, SIZE / 2f - dy, SIZE / 2f + dx, SIZE / 2f + dy, from, to, Shader.TileMode.CLAMP)
        }
        canvas.drawCircle(SIZE / 2f, SIZE / 2f, SIZE / 2f, fill)
        val letter = name.trim().take(1).uppercase().ifEmpty { "?" }
        val text = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = ink
            textSize = SIZE * 0.42f
            textAlign = Paint.Align.CENTER
            typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
        }
        canvas.drawText(letter, SIZE / 2f, SIZE / 2f - (text.descent() + text.ascent()) / 2, text)
        return output
    }

    private fun sha1(text: String) = MessageDigest.getInstance("SHA-1").digest(text.toByteArray()).joinToString("") { "%02x".format(it) }
}
