# Changelog

All notable changes to Dark 2026 Green are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.0.2] - Unreleased

### Changed

- Extension icon. Version bumped from 0.0.1 solely to force VS Code to refresh its
  cached extension icon — reinstalling the same version with `--force` updates the
  file on disk but leaves the icon shown in the Extensions view stale.

## [0.0.1] - Unreleased

### Added

- Initial theme, derived from VS Code's built-in **Dark 2026**.
- Luminance-preserving hue rotation of the UI accent palette from blue (hue 190–220°)
  to green (hue 145°). Saturation is carried through untouched so Dark 2026's
  saturation-step hierarchy survives intact; HSL lightness is re-solved per colour
  so perceived brightness matches the original to within 0.002 relative luminance
  (worst case measured: 0.00177 across 61 rotated colours).
- Syntax highlighting (`tokenColors`, `semanticTokenColors`) reproduced byte-for-byte
  from Dark 2026 — no changes.
- Terminal ANSI colours, error/warning colours, the chart palette (`charts.blue` and
  friends — a swatch named "blue" should stay blue), and neutral greys left untouched.
