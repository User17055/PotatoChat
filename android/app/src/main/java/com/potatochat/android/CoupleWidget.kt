package com.potatochat.android

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.view.View
import android.widget.RemoteViews
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.temporal.ChronoUnit
import java.util.concurrent.TimeUnit

// Widget da tela inicial (como os de casal): os dias juntos (desde a primeira mensagem), a distância entre os dois (da
// localização de cada celular; o servidor só devolve os km), a contagem até o próximo encontro e o último desenho.
// Os dados vêm de api.php?action=widget com a sessão guardada pelo app; atualiza a cada 30 min e quando o app sai da tela.
class CoupleWidget : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        val pending = goAsync()
        Thread {
            try {
                val views = build(context.applicationContext)
                ids.forEach { manager.updateAppWidget(it, views) }
            } finally {
                pending.finish()
            }
        }.start()
    }

    companion object {
        private val http = OkHttpClient.Builder().connectTimeout(10, TimeUnit.SECONDS).readTimeout(15, TimeUnit.SECONDS).build()

        // Pede para os widgets já colocados se atualizarem (o app chama ao sair da tela).
        fun refresh(context: Context) {
            val manager = AppWidgetManager.getInstance(context)
            val ids = manager.getAppWidgetIds(ComponentName(context, CoupleWidget::class.java))
            if (ids.isEmpty()) return
            context.sendBroadcast(Intent(context, CoupleWidget::class.java).setAction(AppWidgetManager.ACTION_APPWIDGET_UPDATE).putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids))
        }

        private fun build(context: Context): RemoteViews {
            val views = RemoteViews(context.packageName, R.layout.couple_widget)
            val open = Intent(context, MainActivity::class.java).putExtra(CantinhoNotifications.EXTRA_OPEN, "nos").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            views.setOnClickPendingIntent(R.id.widget_root, PendingIntent.getActivity(context, 91, open, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
            val token = context.getSharedPreferences(MainActivity.PREFS, 0).getString("token", "").orEmpty()
            if (token.isBlank()) {
                views.setTextViewText(R.id.widget_days, "Potato")
                views.setTextViewText(R.id.widget_days_label, "Entre no app para ver")
                return views
            }
            val state = runCatching { fetch(token) }.getOrNull() ?: run {
                views.setTextViewText(R.id.widget_countdown, "Sem conexão agora")
                return views
            }
            val since = state.optString("since").takeIf { it.isNotBlank() && it != "null" }
            val days = since?.let { ChronoUnit.DAYS.between(OffsetDateTime.parse(it).atZoneSameInstant(ZoneId.systemDefault()).toLocalDate(), LocalDate.now()) + 1 }
            views.setTextViewText(R.id.widget_days, days?.let { "%,d".format(it).replace(',', '.') } ?: "—")
            views.setTextViewText(R.id.widget_days_label, if (days == 1L) "dia juntos" else "dias juntos")
            val distance = if (state.isNull("distance")) null else state.optInt("distance")
            views.setTextViewText(R.id.widget_distance, distance?.let { "${"%,d".format(it).replace(',', '.')} km entre vocês" } ?: "Ative a localização no app")
            views.setTextViewText(R.id.widget_countdown, countdownText(state.optJSONObject("countdown")))
            val drawing = state.optJSONArray("drawings")?.optJSONObject(0)
            val image = drawing?.optString("url")?.let { bitmap(it) }
            if (image != null) {
                views.setImageViewBitmap(R.id.widget_drawing, image)
                views.setViewVisibility(R.id.widget_drawing, View.VISIBLE)
            } else views.setViewVisibility(R.id.widget_drawing, View.GONE)
            return views
        }

        private fun fetch(token: String): JSONObject {
            val request = Request.Builder().url("${MainActivity.SITE_URL.trimEnd('/')}/api.php?action=widget")
                .post(JSONObject().put("token", token).toString().toRequestBody("application/json; charset=utf-8".toMediaType())).build()
            return http.newCall(request).execute().use { response ->
                if (!response.isSuccessful) error("HTTP ${response.code}")
                JSONObject(response.body?.string().orEmpty())
            }
        }

        // "16 dias, 7 h · Até a gente se ver"; no dia, "É hoje · …".
        private fun countdownText(countdown: JSONObject?): String {
            val day = countdown?.optString("day").orEmpty()
            if (day.isBlank()) return ""
            val time = countdown!!.optString("time").takeIf { it.isNotBlank() && it != "null" } ?: "00:00"
            val target = runCatching { LocalDateTime.parse("${day}T$time") }.getOrNull() ?: return ""
            val label = countdown.optString("label", "Até a gente se ver")
            val hours = ChronoUnit.HOURS.between(LocalDateTime.now(), target)
            if (hours < 0) return if (target.toLocalDate() == LocalDate.now()) "É hoje · $label" else ""
            val left = if (hours >= 24) "${hours / 24} ${if (hours / 24 == 1L) "dia" else "dias"}, ${hours % 24} h" else "$hours h"
            return "$left · $label"
        }

        // O desenho, reduzido para caber no widget (o Android limita o tamanho das imagens dele).
        private fun bitmap(path: String): Bitmap? = runCatching {
            val url = if (path.startsWith("http")) path else "${MainActivity.SITE_URL.trimEnd('/')}/$path"
            http.newCall(Request.Builder().url(url).build()).execute().use { response ->
                val bytes = response.body?.bytes() ?: return null
                val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
                var sample = 1
                while (bounds.outWidth / sample > 360) sample *= 2
                BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample })
            }
        }.getOrNull()
    }
}
