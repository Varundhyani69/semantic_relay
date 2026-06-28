# Changelog

All notable changes to this project are documented here.
This project adheres to [Semantic Versioning](https://semver.org/).

## [1.1.0]

### Added
- `relay.resolve(req)` and a standalone `resolve(req)` export — returns the
  effective `{ filter, skip, limit, aggregated, groupSize }` for a request with
  the leader/follower fallback already applied, removing per-handler boilerplate.
- Configurable normalization conventions, applied consistently to both grouping
  and `resolve()`:
  - `pageParam` (default `'page'`)
  - `limitParam` (default `'limit'`)
  - `filterFields` (default `null` — every non-pagination param is a filter)
- TypeScript definitions for the new options and `ResolvedQuery`.
- Property-based tests covering partition correctness across randomized groups.

### Notes
- Fully backward compatible. With no new options set, behavior is identical to
  1.0.x.

## [1.0.1]

### Fixed
- Requests with differing filters can no longer be grouped at any `threshold`
  value; the similarity scorer now returns `0` for mismatched filters, and the
  superset builder rejects mixed-filter groups as a defense-in-depth guard. This
  removes a latent correctness risk where a low `threshold` could return one
  caller another caller's data.

### Changed
- README wording clarified: "similar" means same route + identical filter set,
  differing only in pagination.

## [1.0.0]

### Added
- Initial release: Express middleware that coalesces similar GET requests within
  a time window, executes a single superset query per group, and partitions the
  result back to each caller.
