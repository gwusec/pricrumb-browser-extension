# pricrumb-browser-extension

```mermaid
sequenceDiagram
    participant crawler as Crawler
    participant cookiedb as Database
    participant extension as BrowserExtension
    participant cookiecache as Browser.CookieCache
    participant localstorage as Browser.LocalStorageCache
    participant display as BrowserDisplay

    crawler->>cookiedb: Store all data on cookies
    extension->>cookiecache: Access browser cookie cache
    extension->>localstorage: Access localStorage cache
    extension->>cookiedb: Check cookie names in cookiedb
    cookiedb-->>extension: Return cookie names data
    extension->>display: Display list of cookies
```
