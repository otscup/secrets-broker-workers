# OIDC verification tests — 2026-10-20T03:54:23.706Z

Pure unit tests of src/oidc.js with throwaway keys (nothing production).

| case | result |
|---|---|
| P1 valid RS256 verifies + claims pass | PASS |
| P2 valid ES256 verifies | PASS |
| P3 aud array + matching azp passes | PASS |
| P4 exp 30s ago passes within 60s leeway | PASS |
| P5 no-kid token scans single-key JWKS | PASS |
| N1 alg=none rejected | PASS |
| N2 HS256 rejected (symmetric confusion) | PASS |
| N3 tampered payload fails signature | PASS |
| N4 unknown kid rejected | PASS |
| N5 signed by wrong key rejected | PASS |
| N6 empty JWKS rejected | PASS |
| N7 enc-use key not usable | PASS |
| N8 two-segment token malformed | PASS |
| N9 wrong iss rejected | PASS |
| N10 wrong aud rejected | PASS |
| N11 expired token rejected | PASS |
| N12 future nbf rejected | PASS |
| N13 nonce mismatch rejected | PASS |
| N14 missing nonce rejected | PASS |
| N15 missing sub rejected | PASS |
| N16 wrong azp on multi-aud rejected | PASS |
| N17 userinfo sub mismatch rejected | PASS |
| P6 userinfo sub match accepted | PASS |
| N18 replayed state detected as used | PASS |
| P7 fresh state not flagged | PASS |
| P8 used entry expires after TTL | PASS |

Total: 26/26 passed.