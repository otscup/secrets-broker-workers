# R1/R6 security tests — 2026-10-20T08:16:46.196Z

DO consume ran against the real BrokerState class with serialized fetch (DO single-thread model) + shared store across two instances; throwaway HMAC material only.

| case | result |
|---|---|
| R1-T1 20-way concurrent consume: exactly 1 ok, 19 replay | PASS |
| R1-T2 repeat consume rejected as replay | PASS |
| R1-T3 expired state rejected | PASS |
| R1-T4 tampered cookie rejected | PASS |
| R1-T5 independent fresh state consumes ok with fields | PASS |
| R1-T6 state mismatch rejected | PASS |
| R6-T1 read-only agent (no write flag concept) has no allowAll scope | PASS |
| R6-T2 write-capable but unscoped agent blocked from item | PASS |
| R6-T3 allow A cannot touch B | PASS |
| R6-T4 allow A can touch A | PASS |
| R6-T5 group g-x cannot touch g-y item | PASS |
| R6-T6 group g-x can touch g-x item | PASS |
| R6-T7 create into allowed group ok | PASS |
| R6-T8 create into forbidden group blocked | PASS |
| R6-T9 rename A->B blocked when B out of scope | PASS |
| R6-T10 move A to g-y blocked for g-x-only agent | PASS |
| R6-T11 allowAll=true touches anything | PASS |
| R6-T12 explicit allow beats allowAll=false | PASS |
| REG-OIDC valid token still accepted | PASS |
| REG-OIDC wrong aud rejected | PASS |
| REG-OIDC tampered payload rejected | PASS |
| REG-HTTP all policy markers present | PASS |

Total: 22/22 passed.