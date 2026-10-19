# Jenang Gemi Store Ops Versioning

Current store version: `1.05.07`

Versioning rule:
- Default behavior: increment the last two digits by `+1`.
- Example: `1.00.00` -> `1.00.01`
- If a change is large enough to justify a broader release, increment the middle two digits and reset the last two digits to `00`.
- Example: `1.00.04` -> `1.01.00`
- If a change is huge enough to represent a major launch or major feature wave, increment the first digit and reset the others to `00.00`.
- Example: `1.04.09` -> `2.00.00`
