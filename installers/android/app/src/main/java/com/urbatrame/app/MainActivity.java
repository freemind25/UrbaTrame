package com.urbatrame.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.DownloadManager;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.URLUtil;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.ProgressBar;
import android.widget.Toast;

import java.io.OutputStream;
import java.util.Locale;
import java.util.regex.Pattern;

public class MainActivity extends Activity {
    private static final long MAX_DOWNLOAD_BYTES = 64L * 1024L * 1024L;
    private static final Pattern INVALID_FILENAME = Pattern.compile("[\\\\/:*?\"<>|\\p{Cntrl}]");
    private WebView webView;
    private ProgressBar progressBar;
    private String appUrl;
    private String appHost;

    private static final String INJECT_DOWNLOAD_HANDLER = "(function(){"
        + "if(window.__urbatrameNativeHooks)return;window.__urbatrameNativeHooks=true;"
        + "document.addEventListener('click',function(ev){"
        + "var a=ev.target&&ev.target.closest?ev.target.closest('a'):null;if(!a||!a.href)return;"
        + "if(a.hasAttribute('download')&&a.href.indexOf('blob:')===0){"
        + "ev.preventDefault();ev.stopImmediatePropagation();"
        + "fetch(a.href).then(function(r){return r.blob()}).then(function(blob){"
        + "var reader=new FileReader();reader.onload=function(){"
        + "if(window.UrbaTrameNative)window.UrbaTrameNative.saveDataUrl(reader.result,a.download||'urbatrame-export',blob.type||'application/octet-stream')"
        + "};reader.onerror=function(){if(window.UrbaTrameNative)window.UrbaTrameNative.notify('Impossible de préparer le téléchargement.')}"
        + ";reader.readAsDataURL(blob);"
        + "}).catch(function(){if(window.UrbaTrameNative)window.UrbaTrameNative.notify('Impossible de préparer le téléchargement.')});"
        + "return;"
        + "}"
        + "if(a.target==='_blank'){try{var u=new URL(a.href,location.href);if(u.origin!==location.origin){"
        + "ev.preventDefault();ev.stopImmediatePropagation();if(window.UrbaTrameNative)window.UrbaTrameNative.openExternal(u.href);"
        + "}}catch(e){}}"
        + "},true);"
        + "})();";

    @SuppressLint({"SetJavaScriptEnabled", "JavascriptInterface"})
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        appUrl = getString(R.string.web_app_url);
        appHost = Uri.parse(appUrl).getHost();
        getWindow().setStatusBarColor(Color.rgb(21, 62, 61));
        getWindow().setNavigationBarColor(Color.rgb(21, 62, 61));

        FrameLayout root = new FrameLayout(this);
        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(246, 247, 244));
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        webView.setWebViewClient(new UrbaTrameWebViewClient());
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int progress) {
                progressBar.setProgress(progress);
                progressBar.setVisibility(progress >= 100 ? View.GONE : View.VISIBLE);
            }
        });
        webView.setDownloadListener((url, userAgent, contentDisposition, mimeType, contentLength) ->
            enqueueDownload(url, userAgent, contentDisposition, mimeType));

        webView.getSettings().setJavaScriptEnabled(true);
        webView.getSettings().setDomStorageEnabled(true);
        webView.getSettings().setDatabaseEnabled(true);
        webView.getSettings().setLoadsImagesAutomatically(true);
        webView.getSettings().setSupportMultipleWindows(false);
        webView.getSettings().setJavaScriptCanOpenWindowsAutomatically(false);
        webView.getSettings().setMixedContentMode(android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        webView.addJavascriptInterface(new NativeBridge(this), "UrbaTrameNative");
        CookieManager.getInstance().setAcceptCookie(true);

        progressBar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progressBar.setMax(100);
        progressBar.setProgressTintList(android.content.res.ColorStateList.valueOf(Color.rgb(45, 112, 87)));
        progressBar.setBackgroundColor(Color.rgb(232, 237, 231));
        FrameLayout.LayoutParams webParams = new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT);
        FrameLayout.LayoutParams progressParams = new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, dp(3), Gravity.TOP);
        root.addView(webView, webParams);
        root.addView(progressBar, progressParams);
        setContentView(root);
        webView.loadUrl(appUrl);
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private boolean isAppUrl(String url) {
        Uri uri = Uri.parse(url);
        return "https".equalsIgnoreCase(uri.getScheme()) && appHost != null &&
            appHost.equalsIgnoreCase(uri.getHost());
    }

    private void openExternal(String url) {
        Uri uri = Uri.parse(url);
        String scheme = uri.getScheme();
        if (!"https".equalsIgnoreCase(scheme) && !"mailto".equalsIgnoreCase(scheme) &&
            !"tel".equalsIgnoreCase(scheme)) return;
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (Exception exception) {
            showToast("Aucune application ne peut ouvrir ce lien.");
        }
    }

    private String safeFilename(String name) {
        String cleaned = INVALID_FILENAME.matcher(name == null ? "" : name).replaceAll("_").trim();
        while (cleaned.startsWith(".")) cleaned = cleaned.substring(1);
        if (cleaned.isEmpty()) cleaned = "urbatrame-export";
        if (cleaned.length() > 160) cleaned = cleaned.substring(0, 160);
        return cleaned;
    }

    private String safeMimeType(String mime) {
        if (mime == null || !mime.matches("[A-Za-z0-9.+-]+/[A-Za-z0-9.+-]+"))
            return "application/octet-stream";
        return mime.toLowerCase(Locale.ROOT);
    }

    private void saveDataUrl(String dataUrl, String filename, String mimeType) {
        try {
            int comma = dataUrl == null ? -1 : dataUrl.indexOf(',');
            if (comma < 0 || !dataUrl.substring(0, comma).contains("base64")) {
                showToast("Format d’export non pris en charge.");
                return;
            }
            byte[] bytes = Base64.decode(dataUrl.substring(comma + 1), Base64.DEFAULT);
            if (bytes.length == 0 || bytes.length > MAX_DOWNLOAD_BYTES) {
                showToast("L’export est vide ou dépasse la limite de 64 Mo.");
                return;
            }

            String name = safeFilename(filename);
            String mime = safeMimeType(mimeType);
            ContentValues values = new ContentValues();
            values.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
            values.put(MediaStore.MediaColumns.MIME_TYPE, mime);
            values.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/UrbaTrame");
            values.put(MediaStore.MediaColumns.IS_PENDING, 1);
            Uri item = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
            if (item == null) throw new IllegalStateException("Le stockage des téléchargements est indisponible.");
            try (OutputStream output = getContentResolver().openOutputStream(item)) {
                if (output == null) throw new IllegalStateException("Impossible d’ouvrir le fichier de destination.");
                output.write(bytes);
                output.flush();
            } catch (Exception exception) {
                getContentResolver().delete(item, null, null);
                throw exception;
            }
            ContentValues published = new ContentValues();
            published.put(MediaStore.MediaColumns.IS_PENDING, 0);
            getContentResolver().update(item, published, null, null);
            showToast("Fichier enregistré dans Téléchargements/UrbaTrame.");
        } catch (Exception exception) {
            showToast("Échec de l’enregistrement du fichier.");
        }
    }

    private void enqueueDownload(String url, String userAgent, String contentDisposition, String mimeType) {
        try {
            Uri uri = Uri.parse(url);
            if (!"https".equalsIgnoreCase(uri.getScheme())) {
                showToast("Téléchargement sécurisé HTTPS requis.");
                return;
            }
            DownloadManager manager = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
            String filename = safeFilename(URLUtil.guessFileName(url, contentDisposition, mimeType));
            DownloadManager.Request request = new DownloadManager.Request(uri)
                .setTitle(filename)
                .setDescription("Téléchargement UrbaTrame")
                .setMimeType(safeMimeType(mimeType))
                .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, "UrbaTrame/" + filename);
            String cookie = CookieManager.getInstance().getCookie(url);
            if (cookie != null && !cookie.isEmpty()) request.addRequestHeader("Cookie", cookie);
            if (userAgent != null && !userAgent.isEmpty()) request.addRequestHeader("User-Agent", userAgent);
            if (manager != null) {
                manager.enqueue(request);
                showToast("Téléchargement ajouté à la file.");
            } else {
                showToast("Le gestionnaire de téléchargements Android est indisponible.");
            }
        } catch (Exception exception) {
            showToast("Impossible de lancer le téléchargement.");
        }
    }

    private void showToast(String message) {
        new Handler(Looper.getMainLooper()).post(() ->
            Toast.makeText(MainActivity.this, message, Toast.LENGTH_LONG).show());
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.removeJavascriptInterface("UrbaTrameNative");
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    private final class UrbaTrameWebViewClient extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            String url = uri.toString();
            if (isAppUrl(url) || "about".equalsIgnoreCase(uri.getScheme()) ||
                "blob".equalsIgnoreCase(uri.getScheme())) return false;
            openExternal(url);
            return true;
        }

        @Override
        @SuppressWarnings("deprecation")
        public boolean shouldOverrideUrlLoading(WebView view, String url) {
            if (isAppUrl(url) || url.startsWith("about:") || url.startsWith("blob:")) return false;
            openExternal(url);
            return true;
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            super.onPageFinished(view, url);
            if (isAppUrl(url)) view.evaluateJavascript(INJECT_DOWNLOAD_HANDLER, null);
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, android.webkit.WebResourceError error) {
            if (request.isForMainFrame()) {
                String html = "<!doctype html><html lang='fr'><meta name='viewport' content='width=device-width,initial-scale=1'>"
                    + "<meta charset='utf-8'><body style='margin:0;background:#f6f7f4;color:#24443a;font:16px system-ui;display:grid;min-height:100vh;place-items:center'>"
                    + "<main style='max-width:420px;padding:28px;text-align:center'><h1>UrbaTrame</h1>"
                    + "<p>Connexion Internet nécessaire pour ouvrir l’application.</p>"
                    + "<button onclick=\"location.href='" + appUrl + "'\" style='border:0;border-radius:8px;padding:12px 18px;background:#286b53;color:white;font:inherit'>Réessayer</button></main></body></html>";
                view.loadDataWithBaseURL(appUrl, html, "text/html", "UTF-8", null);
            }
        }
    }

    public final class NativeBridge {
        private final Context context;

        NativeBridge(Context context) { this.context = context.getApplicationContext(); }

        @JavascriptInterface
        public void saveDataUrl(String dataUrl, String filename, String mimeType) {
            MainActivity.this.saveDataUrl(dataUrl, filename, mimeType);
        }

        @JavascriptInterface
        public void openExternal(String url) {
            runOnUiThread(() -> MainActivity.this.openExternal(url));
        }

        @JavascriptInterface
        public void notify(String message) {
            if (message == null) return;
            String safe = message.length() > 140 ? message.substring(0, 140) : message;
            runOnUiThread(() -> Toast.makeText(context, safe, Toast.LENGTH_LONG).show());
        }
    }
}
