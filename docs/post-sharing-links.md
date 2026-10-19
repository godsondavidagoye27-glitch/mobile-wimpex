# Public post and profile links

The app's default placeholder is `https://wimpex.example`. Set `EXPO_PUBLIC_WEB_BASE_URL` to the HTTPS domain you control before release. The placeholder must be replaced in `app.json`, the preview function's canonical URL, the hosted association files, and the build environment together.

## Web preview hosting

`post-preview` returns Open Graph HTML from:

```text
https://<supabase-project>.supabase.co/functions/v1/post-preview?id=<post-uuid>
```

Configure the chosen web host or CDN to route `/post/<uuid>` requests to this function and preserve the returned HTML. The preview checks `status`, audience, moderation state, account privacy, and age before including the caption or thumbnail. Do not cache a response longer than the response's short private cache policy.

## Android App Links

Host `/.well-known/assetlinks.json` on the chosen domain. Replace the fingerprint with the SHA-256 fingerprint for each signing certificate that ships the app:

```json
[
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "app.wimpex.mobile",
      "sha256_cert_fingerprints": ["REPLACE_WITH_EAS_ANDROID_SHA256_CERTIFICATE_FINGERPRINT"]
    }
  }
]
```

## iOS Universal Links

Host `/.well-known/apple-app-site-association` (no extension and `Content-Type: application/json`). Replace `TEAM_ID` with the Apple Developer Team ID:

```json
{
  "applinks": {
    "details": [
      {
        "appIDs": ["TEAM_ID.app.wimpex.mobile"],
        "components": [
          { "/": "/post/*", "comment": "Open a post in Wimpex" },
          { "/": "/user/*", "comment": "Open a profile in Wimpex" }
        ]
      }
    ]
  }
}
```

The domain and URL association changes require a new native build. Verify links with the actual EAS signing certificate and Apple Team ID before publishing.
