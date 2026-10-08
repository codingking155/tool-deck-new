package in.tooldeck.sheaf;

import android.content.ActivityNotFoundException;
import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.OpenableColumns;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;

/**
 * Files arriving from other apps ("Share to Sheaf", "Open with Sheaf") and opening saved files
 * in another app. Incoming files are copied into the app's cache, so the web layer can read them
 * through Capacitor's local file URLs; the web layer is told with a "received" event, which is
 * kept until a listener is attached (the app may still be starting up).
 */
@CapacitorPlugin(name = "SharedFiles")
public class SharedFilesPlugin extends Plugin {

    @Override
    public void load() {
        take(getActivity().getIntent());
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        take(intent);
    }

    private void take(Intent intent) {
        if (intent == null || intent.getAction() == null) return;
        final ArrayList<Uri> uris = new ArrayList<>();
        String action = intent.getAction();
        if (Intent.ACTION_VIEW.equals(action) && intent.getData() != null) {
            uris.add(intent.getData());
        } else if (Intent.ACTION_SEND.equals(action)) {
            Uri u = streamOf(intent);
            if (u != null) uris.add(u);
        } else if (Intent.ACTION_SEND_MULTIPLE.equals(action)) {
            ArrayList<Uri> list = streamsOf(intent);
            if (list != null) uris.addAll(list);
        }
        if (uris.isEmpty()) return;
        // handled once: a later configuration change must not deliver the same files again
        getActivity().setIntent(new Intent(Intent.ACTION_MAIN));
        final ContentResolver cr = getContext().getContentResolver();
        final String fallbackType = intent.getType();
        new Thread(() -> {
            JSArray files = new JSArray();
            String failed = null;
            File root = new File(getContext().getCacheDir(), "incoming");
            sweep(root);
            File dir = new File(root, String.valueOf(System.currentTimeMillis()));
            dir.mkdirs();
            for (Uri uri : uris) {
                String name = displayName(cr, uri);
                try (InputStream in = cr.openInputStream(uri)) {
                    if (in == null) throw new java.io.IOException("no stream");
                    File out = new File(dir, name);
                    try (OutputStream os = new FileOutputStream(out)) {
                        byte[] buf = new byte[1 << 16];
                        int n;
                        while ((n = in.read(buf)) > 0) os.write(buf, 0, n);
                    }
                    String type = cr.getType(uri);
                    JSObject f = new JSObject();
                    f.put("path", out.getAbsolutePath());
                    f.put("name", name);
                    f.put("type", type != null ? type : (fallbackType != null ? fallbackType : ""));
                    files.put(f);
                } catch (Exception e) {
                    failed = name;
                }
            }
            JSObject ev = new JSObject();
            ev.put("files", files);
            if (failed != null) ev.put("failed", failed);
            notifyListeners("received", ev, true);
        }).start();
    }

    /** Drop copies from earlier shares once they are an hour old. */
    private static void sweep(File root) {
        File[] old = root.listFiles();
        if (old == null) return;
        long cutoff = System.currentTimeMillis() - 3600_000L;
        for (File d : old) {
            if (d.lastModified() > cutoff) continue;
            File[] inner = d.listFiles();
            if (inner != null) for (File f : inner) f.delete();
            d.delete();
        }
    }

    @SuppressWarnings("deprecation")
    private static Uri streamOf(Intent intent) {
        if (Build.VERSION.SDK_INT >= 33) return intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri.class);
        return intent.getParcelableExtra(Intent.EXTRA_STREAM);
    }

    @SuppressWarnings("deprecation")
    private static ArrayList<Uri> streamsOf(Intent intent) {
        if (Build.VERSION.SDK_INT >= 33) return intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri.class);
        return intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
    }

    private static String displayName(ContentResolver cr, Uri uri) {
        String name = null;
        if ("content".equals(uri.getScheme())) {
            try (Cursor c = cr.query(uri, new String[] { OpenableColumns.DISPLAY_NAME }, null, null, null)) {
                if (c != null && c.moveToFirst()) name = c.getString(0);
            } catch (Exception ignored) {
                // some providers refuse the query; fall back to the path
            }
        }
        if (name == null) name = uri.getLastPathSegment();
        if (name == null || name.isEmpty()) name = "file";
        name = name.replaceAll("[\\\\/:*?\"<>|]", "_");
        if (!name.contains(".")) {
            String type = cr.getType(uri);
            if ("application/pdf".equals(type)) name += ".pdf";
            else if ("image/png".equals(type)) name += ".png";
            else if (type != null && type.startsWith("image/")) name += ".jpg";
        }
        return name;
    }

    /** Open a saved file (a file:// URI or path) in whichever app the person picks. */
    @PluginMethod
    public void open(PluginCall call) {
        String where = call.getString("uri");
        String mime = call.getString("mime", "application/pdf");
        if (where == null) {
            call.reject("No file to open.");
            return;
        }
        File f = new File(where.startsWith("file:") ? Uri.parse(where).getPath() : where);
        if (!f.exists()) {
            call.reject("That file is no longer there.");
            return;
        }
        try {
            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", f);
            Intent view = new Intent(Intent.ACTION_VIEW);
            view.setDataAndType(uri, mime);
            view.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            getActivity().startActivity(Intent.createChooser(view, "Open with").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION));
            call.resolve();
        } catch (ActivityNotFoundException e) {
            call.reject("No app on this phone can open this file.");
        } catch (IllegalArgumentException e) {
            call.reject("This file cannot be shared with other apps.");
        }
    }
}
