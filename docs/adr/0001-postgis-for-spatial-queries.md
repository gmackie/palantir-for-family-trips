# PostGIS for spatial corridor queries

We installed PostGIS 3.6 on the production Postgres instance (hetzner-master, PostgreSQL 17) to support road trip corridor search — "find all POIs within 30 miles of a 1,800-mile route polyline." The alternative was bounding box approximation (180 sub-queries for a cross-country route, inaccurate at box corners) or application-side filtering (doesn't scale past a few thousand points). PostGIS handles this as a single `ST_DWithin` query against a geography index, which is the correct tool for the job.

## Considered Options

- **Bounding box approximation** — no extension needed, but O(n) queries per route where n = route_miles / sample_interval. Inaccurate at corners. Would have worked for MVP but becomes a bottleneck with multiple data sources.
- **Application-side filtering** — load all POIs into memory, filter by Haversine. Simple but doesn't scale and wastes bandwidth.

## Consequences

- All POI tables (`imported_pois`, `poiCache`, and existing `pins`) can add a `geography` column with a spatial index for O(1) corridor queries.
- Drizzle ORM doesn't have first-class PostGIS support — spatial queries will use `sql` tagged template literals rather than the query builder.
- Hyperdrive (Cloudflare's Postgres proxy) needs to be verified to pass through PostGIS query types correctly.
