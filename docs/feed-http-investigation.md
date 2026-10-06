# Feed HTTP limits and protocol compatibility

For [#47](https://github.com/mocha/thicket/issues/47), raise the feed response cap from 5 to 20 MiB. For [#48](https://github.com/mocha/thicket/issues/48), retain strict HTTP parsing and explain malformed responses accurately in import and add-feed failures. The public feed sample supports a larger bounded body budget, but shows no widespread need for parser leniency.

## Feed size measurements

Measurements on 2026-10-06 UTC used the updated HTTP client and feed parser:

| Feed | Body bytes | Parsed items |
| --- | ---: | ---: |
| [Baby Steps](https://smallcultfollowing.com/babysteps/atom.xml) | 7,030,057 | 350 |
| [METR](https://metr.org/feed.xml) | 9,039,638 | 103 |
| [Lameazoid](https://lameazoid.com/feed/) | 6,162,932 | See corpus sample |

Both reported feeds now download completely and parse successfully. Partial XML is unsuitable for importing or refreshing a feed. Twenty MiB gives these archives room to grow while keeping a finite budget; it is a policy choice, not a measured ecosystem maximum.

A random sample of 300 URLs from [Kagi Small Web](https://github.com/kagisearch/smallweb/blob/main/smallweb.txt), also used by the repository's seed tooling, produced 294 parsed feeds, three HTTP errors (two 404s and one 503), and three TLS failures. One response exceeded the old 5 MiB cap (0.33% of attempted feeds); none exceeded 20 MiB. The largest was Lameazoid. This sample describes a slice of the small web, not the entire feed ecosystem or thicket's production subscriptions.

The sample shuffled URL lines with Python's `random.Random(47)` and took 300. The upstream snapshot SHA-256 was `ed13bcf6e04316eae21e637c7a5d6fe3d50c90418ec3b5f0165a360bf7c9adb7`. [The measured URLs and results](feed-http-sample.txt) are retained so a repeat survey does not depend on an upstream list changing. The survey's byte metric is the UTF-8 size of the decoded text; the HTTP guard counts decoded response bytes before character decoding.

Page snippets requested with `truncate: true` keep the 5 MiB default. Binary downloads keep their 5 MiB default, and icon-specific limits remain in force. The 20-second timeout, host scheduling, and cancellation on overflow still apply. Both declared length and streamed body size are checked; compressed responses cannot evade the decoded-byte cap. Memory use can exceed the byte budget during concatenation, text decoding, and feed parsing; the larger cap increases worst-case memory per simultaneous feed request.

## HTTP protocol decision

`https://cr.yp.to/` returned HTTP 200 to curl, with both `Transfer-Encoding: chunked` and `Content-Length: 3674`. Node 24.21.0 rejected it with a nested parser error whose message describes the protocol violation but whose code is undefined. A survey through the updated client classified it as `protocol`. No protocol failures occurred in the separate 300-feed sample. This does not establish that such failures never occur elsewhere.

[RFC 9112 section 6.3](https://www.rfc-editor.org/rfc/rfc9112.html#section-6.3) gives Transfer-Encoding precedence and recommends treating the combination as an error because it can signal request smuggling or response splitting. Thicket consumes feed data rather than forwarding raw HTTP messages, which limits some intermediary risks. Nevertheless, accepting ambiguous framing on reusable connections introduces avoidable complexity, and Node's [HTTP client documentation](https://nodejs.org/api/http.html#httprequestoptions-callback) advises against its broad `insecureHTTPParser` option.

Keep the strict fetch transport. Recognize parser codes and nested protocol messages, and tell readers that the site answered with a malformed web response that thicket cannot safely read. The importer marks this as failed without an automatic retry. Survey output counts protocol failures separately, enabling a later compatibility decision based on additional evidence. A future exception would need narrow framing rules, isolated connections, and the same timeout, decompression, redirect, and byte safeguards; broad parser leniency is not justified by this sample.

## Reproduction and validation

From `packages/api`, with dependencies installed:

```sh
node --no-warnings=ExperimentalWarning --import tsx src/scripts/survey.ts ../../docs/feed-http-sample.txt --concurrency 12 --db /tmp/feed-http.sqlite
node --no-warnings=ExperimentalWarning --import tsx src/scripts/survey-stats.ts --db /tmp/feed-http.sqlite
node --import tsx --test src/**/*.test.ts
node node_modules/typescript/bin/tsc --noEmit
node node_modules/typescript/bin/tsc -p tsconfig.build.json
```

Use a fresh SQLite path to refetch; the survey skips already recorded URLs. Network responses change over time. The regression suite covers complete archives above the old cap, the exact new boundary, declared and streamed overflow cancellation, preserved snippet and binary limits, nested error recognition, and rejection and reader-facing explanations for a real malformed HTTP response over a local socket.
