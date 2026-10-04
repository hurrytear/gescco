---
{"title":"DNS troubleshooting: separate authoritative records from caches","category":"Networking & proxies","kind":"Troubleshooting","date":"2026-10-04","summary":"Check NS, A/AAAA, CNAME and TTL to distinguish incorrect records, cache differences and connection failures.","tags":["DNS","dig","TLS"]}
---
When a domain fails to open, establish where resolution differs. The commands use the reserved example domain `example.com` and documentation address `192.0.2.10` to illustrate their format.

## 01 / Query each record type

```sh
dig example.com NS +noall +answer
dig example.com A +noall +answer
dig example.com AAAA +noall +answer
dig www.example.com CNAME +noall +answer
```

If the answer is empty, remove `+noall +answer` to inspect the full response. `NXDOMAIN`, `NOERROR` with no answer and `SERVFAIL` mean different things. An incorrect AAAA record can cause failures for clients that prefer IPv6.

## 02 / Compare recursive and authoritative answers

```sh
dig @1.1.1.1 example.com A
dig @8.8.8.8 example.com A
dig example.com NS
# Replace this hostname with an authoritative NS returned above
dig @ns1.example.com example.com A +norecurse
```

If the authoritative answer is correct but recursive answers differ, investigate TTL, negative caching and resolver policy. TTL defines cache lifetime; it does not promise a simultaneous global cutover. Some networks also restrict external DNS queries.

## 03 / Test DNS and HTTPS separately

When you know the correct origin IP, direct access is allowed and the certificate configuration matches, `--resolve` fixes the address while retaining the Host header and TLS hostname verification.

```sh
curl --resolve example.com:443:192.0.2.10 \
  --connect-timeout 5 --max-time 10 -I https://example.com/
```

If requests fail only through the CDN, check domain bindings, certificate status and the connection to the origin. If the fixed-address test also fails, investigate routing, firewalls, TLS and service listeners.

## 04 / Keep evidence for a rollback

Record old and new values, TTL, change time and answers from two resolvers. For planned migrations, lower TTL in advance and allow existing caches time to expire. Finish by testing the page and certificate from an actual client. A saved record in the dashboard does not establish that the complete access path has recovered.

## References

- [ISC BIND: dig manual](https://bind9.readthedocs.io/en/latest/manpages.html#dig-dns-lookup-utility)
- [Cloudflare Pages: custom domains](https://developers.cloudflare.com/pages/configuration/custom-domains/)
