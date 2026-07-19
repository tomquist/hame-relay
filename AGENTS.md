# Agent guidelines

## Changelog

Entries in `CHANGELOG.md` are for end users. Describe **what changed from the
user's perspective**, not how it was implemented. Do not include implementation
details such as broker names, firmware thresholds, internal function or module
names, matching rules, or code-level specifics — those belong in
`docs/device-matrix.md`, code comments, and the commit message.

Keep entries short. Reference the relevant issue/PR number in parentheses.

Good: `Add support for the Marstek CT002 new generation (device type TPM2-0) (#201)`

Avoid: `Add a TPM2 device profile using the 2025 broker with salt-based topic-id
encryption (vidSupportVersion 0) …`
