# Security hardening status

Based on the audit of `8695777` dated 2026-09-14. This is development status, not a
release announcement or evidence of compromise. No v0.1.6 release has been created.

| Audit finding | This patch |
| --- | --- |
| MARGIN-001: network HTTP | Requires verified HTTPS or explicit HTTP acknowledgement; loopback development exception, Secure HTTPS cookies, updated installation guidance |
| MARGIN-002: password/throttle | Minimum password checks, bounded expiring source map, per-source/global budgets, failure backoff, explicit proxy trust, bounded session count |
| MARGIN-003: supply chain | Validation Actions pinned to existing release-workflow SHAs; npm lifecycle scripts disabled in validation/publishing. Image/source/model integrity and provenance still pending |
| MARGIN-004: native token storage | Pending native Keystore bridge design; do not claim localStorage has been replaced |
| MARGIN-005: policy headers | CSP and Permissions Policy added; HSTS documented at the HTTPS terminator |
| MARGIN-006: FileProvider | External-storage grant removed; cache access limited to shared-exports/ |
| MARGIN-007: credential ignores | Android signing keys and private service/signing settings excluded |
| MARGIN-008: quality gates | Existing lint debt and additional security CI remain pending; not silently suppressed |
| MARGIN-009: dev advisory | Pending tested upstream fix; no forced downgrade |
| MARGIN-010: parser isolation | Further container resource/filesystem/network isolation remains pending |

Before publishing an image containing the new transport defaults, direct existing
installations to [HTTPS migration](HTTPS.md). Maintain first-install and upgrade
instructions together; do not tell users an older image includes these fixes.

Further work should independently validate immutable model hashes/source/image
pins, native token handling, and container isolation rather than inferring safety
from successful application tests. Require actual Android and container validation
for those changes before claiming support.
