import postgres from "postgres";

const DB_URL =
  process.env.DATABASE_URL ??
  "postgres://trip_app:ecc75b4aa5d2b3c8ada5886d244a5263ad71e23a162aa6c94dcc31528fc26a3e@100.101.32.120:5432/trip?sslmode=disable";

const sql = postgres(DB_URL, { max: 1 });

async function seed() {
  console.log("Seeding family reunion trip...\n");

  const existingTrip = await sql`
    SELECT id FROM trip WHERE name = 'Mackie Family Reunion 2026'
  `;
  if (existingTrip.length > 0) {
    console.log("Trip already exists, skipping seed.");
    await sql.end();
    return;
  }

  const users = await sql`SELECT id, email FROM "user" LIMIT 1`;
  if (users.length === 0) {
    console.log("No users found. Sign in first, then re-run this script.");
    await sql.end();
    return;
  }
  const userId = users[0]!.id as string;
  console.log(`Using user: ${users[0]!.email} (${userId})`);

  const [ws] = await sql`
    INSERT INTO workspace (name, slug, owner_user_id)
    VALUES ('Mackie Family', 'mackie-family', ${userId})
    ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
    RETURNING id
  `;
  const workspaceId = ws!.id as string;
  console.log(`Workspace: ${workspaceId}`);

  await sql`
    INSERT INTO workspace_membership (workspace_id, user_id, role)
    VALUES (${workspaceId}, ${userId}, 'owner')
    ON CONFLICT (workspace_id, user_id) DO NOTHING
  `;

  const [trip] = await sql`
    INSERT INTO trip (
      workspace_id, name, created_by_user_id, status, group_mode, trip_mode,
      claim_mode, destination_name, destination_lat, destination_lng,
      default_zoom, start_date, end_date, tz
    ) VALUES (
      ${workspaceId},
      'Mackie Family Reunion 2026',
      ${userId},
      'planning',
      true,
      'destination',
      'tap',
      'Omaha, NE',
      '41.2565',
      '-95.9345',
      11,
      '2026-06-10',
      '2026-06-15',
      'America/Chicago'
    )
    RETURNING id
  `;
  const tripId = trip!.id as string;
  console.log(`Trip: ${tripId}`);

  await sql`
    INSERT INTO trip_member (trip_id, user_id, role, display_name)
    VALUES (${tripId}, ${userId}, 'organizer', 'Graham')
  `;

  const [seg1] = await sql`
    INSERT INTO trip_segment (
      trip_id, name, destination_name, destination_lat, destination_lng,
      default_zoom, start_date, end_date, tz, sort_order
    ) VALUES (
      ${tripId}, 'Des Moines Arrival', 'Des Moines, IA',
      '41.5868', '-93.6250', 12,
      '2026-06-10', '2026-06-10', 'America/Chicago', 0
    ) RETURNING id
  `;

  const [seg2] = await sql`
    INSERT INTO trip_segment (
      trip_id, name, destination_name, destination_lat, destination_lng,
      default_zoom, start_date, end_date, tz, sort_order
    ) VALUES (
      ${tripId}, 'Omaha Reunion', 'Omaha, NE',
      '41.2565', '-95.9345', 12,
      '2026-06-11', '2026-06-14', 'America/Chicago', 1
    ) RETURNING id
  `;

  const [seg3] = await sql`
    INSERT INTO trip_segment (
      trip_id, name, destination_name, destination_lat, destination_lng,
      default_zoom, start_date, end_date, tz, sort_order
    ) VALUES (
      ${tripId}, 'Departure', 'Omaha, NE',
      '41.2565', '-95.9345', 12,
      '2026-06-15', '2026-06-15', 'America/Chicago', 2
    ) RETURNING id
  `;

  console.log(`Segments: ${seg1!.id}, ${seg2!.id}, ${seg3!.id}`);

  const pinData = [
    {
      segmentId: seg2!.id,
      type: "lodging",
      title: "Lake Manawa Lake House",
      lat: "41.0345",
      lng: "-95.8935",
      notes: "Main reunion venue — lake house on Lake Manawa",
    },
    {
      segmentId: seg2!.id,
      type: "custom",
      title: "Aunt Karen & Uncle Dave",
      lat: "41.2580",
      lng: "-95.9380",
      notes: "Family home — overflow lodging",
    },
    {
      segmentId: seg2!.id,
      type: "custom",
      title: "Aunt Linda & Uncle Bob",
      lat: "41.2520",
      lng: "-95.9410",
      notes: "Family home",
    },
    {
      segmentId: seg1!.id,
      type: "lodging",
      title: "Des Moines Hotel",
      lat: "41.5868",
      lng: "-93.6250",
      notes: "Night before — TBD booking",
    },
    {
      segmentId: seg2!.id,
      type: "activity",
      title: "Lake Manawa State Park",
      lat: "41.0290",
      lng: "-95.8850",
      notes: "Beach, trails, kayaking",
    },
    {
      segmentId: seg2!.id,
      type: "meal",
      title: "Reunion BBQ",
      lat: "41.0345",
      lng: "-95.8935",
      notes: "Saturday BBQ at the lake house",
    },
  ];

  for (const pin of pinData) {
    await sql`
      INSERT INTO pin (
        trip_id, segment_id, type, title, lat, lng, notes, created_by_user_id
      ) VALUES (
        ${tripId}, ${pin.segmentId}, ${pin.type}, ${pin.title},
        ${pin.lat}, ${pin.lng}, ${pin.notes}, ${userId}
      )
    `;
  }

  console.log(`Pins: ${pinData.length} created`);
  console.log("\nSeed complete!");

  await sql.end();
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
