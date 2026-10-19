package `in`.tooldeck.sheaf

import android.content.ContentValues
import android.net.Uri
import android.os.Bundle
import android.os.Environment
import android.provider.MediaStore
import android.util.Base64
import android.webkit.*
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.webkit.WebViewAssetLoader

class MainActivity : AppCompatActivity() {
    private lateinit var web: WebView
    private var chooserCallback: ValueCallback<Array<Uri>>? = null

    private val pickFiles = registerForActivityResult(
        androidx.activity.result.contract.ActivityResultContracts.StartActivityForResult()
    ) { res ->
        chooserCallback?.onReceiveValue(
            WebChromeClient.FileChooserParams.parseResult(res.resultCode, res.data)
        )
        chooserCallback = null
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Serves assets/sheaf/** at https://appassets.androidplatform.net/sheaf/** (secure origin,
        // so ES modules, workers and Blob URLs behave like the hosted site).
        val loader = WebViewAssetLoader.Builder()
            .addPathHandler("/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        web = WebView(this)
        setContentView(web)
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = true
        }
        web.addJavascriptInterface(Saver(), "AndroidSaver")
        web.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(
                w: WebView, cb: ValueCallback<Array<Uri>>, p: FileChooserParams
            ): Boolean {
                chooserCallback?.onReceiveValue(null)
                chooserCallback = cb
                pickFiles.launch(p.createIntent())
                return true
            }
        }
        // Sheaf saves via <a download href="blob:...">. WebView cannot download blobs itself,
        // so read the blob in JS and hand the bytes to the native saver.
        web.setDownloadListener { url, _, _, _, _ ->
            if (url.startsWith("blob:")) {
                web.evaluateJavascript(
                    """(async()=>{const b=await (await fetch('$url')).blob();
                    const r=new FileReader();r.onload=()=>AndroidSaver.save(
                    window.__sheafName||'sheaf-output',b.type,r.result.split(',')[1]);
                    r.readAsDataURL(b);})()""", null
                )
            }
        }
        // Remember the filename of the anchor being clicked (blob URLs lose it).
        web.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(v: WebView, r: WebResourceRequest) =
                loader.shouldInterceptRequest(r.url)

            override fun onPageFinished(v: WebView, url: String) {
                v.evaluateJavascript(
                    """document.addEventListener('click',e=>{const a=e.target.closest('a[download]');
                    if(a)window.__sheafName=a.download;},true)""", null
                )
            }
        }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (web.canGoBack()) web.goBack() else finish()
            }
        })

        if (savedInstanceState == null) web.loadUrl("https://appassets.androidplatform.net/sheaf/index.html")
        else web.restoreState(savedInstanceState)
    }

    override fun onSaveInstanceState(out: Bundle) {
        super.onSaveInstanceState(out)
        web.saveState(out)
    }

    inner class Saver {
        @JavascriptInterface
        fun save(name: String, mime: String, base64: String) {
            val bytes = Base64.decode(base64, Base64.DEFAULT)
            val values = ContentValues().apply {
                put(MediaStore.Downloads.DISPLAY_NAME, name)
                put(MediaStore.Downloads.MIME_TYPE, mime.ifEmpty { "application/octet-stream" })
                put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
            }
            val uri = contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
            runOnUiThread {
                if (uri == null) {
                    Toast.makeText(this@MainActivity, "Could not save $name", Toast.LENGTH_LONG).show()
                } else {
                    contentResolver.openOutputStream(uri)?.use { it.write(bytes) }
                    Toast.makeText(this@MainActivity, "Saved $name to Downloads", Toast.LENGTH_LONG).show()
                }
            }
        }
    }
}
