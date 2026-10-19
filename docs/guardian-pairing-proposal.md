# Future guardian pairing proposal

This proposal is intentionally not implemented. Guardian accounts must not be linked until the consent, age-assurance, and jurisdiction-specific legal design has been reviewed.

## Proposed flow

1. A teen opens Teen Safety and requests a guardian link, then receives a short-lived, single-use invitation code or QR link.
2. The adult signs in to a separate account, confirms they are an adult, reviews the exact controls and data visible to them, and explicitly accepts.
3. The teen confirms the adult identity and consent a second time. Either person can revoke the link at any time; revocation stops all guardian access immediately.
4. A link must not grant private-message or media access. It may expose only the teen's selected safety settings and coarse activity summaries.

## Data to store

- Guardian-pair identifier, teen and guardian user IDs, consent timestamps/version, verification method, current status, and revocation timestamp.
- A minimal audit record for consent changes and safety-setting changes.
- No message content, precise location, contact list, or third-party social graph.

## Legal and safety risks

- A user may falsely claim to be a guardian; an invitation link alone is not proof of legal authority.
- Some jurisdictions require verifiable parental consent, age assurance, notices, or rights to access/delete data.
- Family conflict, coercive control, custody disputes, and unsafe household situations can make guardian visibility harmful.
- The design needs a separate abuse response and appeals process, and must not expose a teen's hidden or restricted content to a guardian by default.

Obtain child-privacy counsel and conduct a safeguarding review before implementation. Document age-verification retention, consent withdrawal, data-subject request handling, and incident response.
