# Production migration audit for issue #208

Audited at **2026-10-09T20:25:37.544Z**, before deploying the hash-based runner.

Source: the **Thicket** Railway project, **production** environment, via the
running **thicket** service's private database connection. Only
`drizzle.__drizzle_migrations` was read. No migrations or database writes ran.

The export used `BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`,
then `SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id`,
then `COMMIT`. A temporary SSH key was registered with permission and removed
after the export.

Compared all 29 checked-in SQL files with all 29 recorded rows, using
the same SHA-256 identity calculation as Drizzle and the new runner.
Migration directory Git tree: `df82d3395fa81de81c69a308e34237f7342f18ed`.

Result: **29 applied, 0 pending, 0 previously skipped, 0 unmatched ledger records.**

The production ledger accounts for every checked-in migration. No past skip
was found, and the new runner has no SQL pending against this audited snapshot.

| Migration | Recorded timestamp | SHA-256 | Status |
|---|---:|---|---|
| 0000_spicy_emma_frost | 1789128629533 | `d12f3f3e39e3cd86b1625cfa05f28e996825d0a3bea9272d6a60971082f4fa87` | applied |
| 0001_handy_garia | 1789234547034 | `6fa4e192f3a9fd61b2495e3ebf879a87c6acff206a34e6d6997bf998f1696ec4` | applied |
| 0002_unsorted_exclusive | 1789241158258 | `a29339bef72b9e79f5267d7f7608ec09798d4a02c9bbd22615e2ab958604da9f` | applied |
| 0003_collections_required | 1789309740738 | `2b1fbfa32108375e3f6ddad849428d10c7e4b1a603d067a5d392582b5ddeebbe` | applied |
| 0004_river_per_feed_merge | 1789327194432 | `bb2eae4e1da397a6928486756eba42b9b01e4e0adc3d8ed86f2956133c9e0557` | applied |
| 0005_collection_slugs_unique_per_user | 1789327360762 | `2bdbc85b4e07a013030ef59a47618301128331eca07b5ca21592b79eb6e68f69` | applied |
| 0006_share_levels | 1789336487957 | `c6df7804c50e3e54bf26c9fe2e223a364f995655a5da83ca49be4171ef94c939` | applied |
| 0007_search_index | 1789430000000 | `554d3e53ce7c3264cc530a72c7d584dda43b8d3cacb2cad992823e1343bd6c18` | applied |
| 0008_feed_settings | 1789450000000 | `6c2144881e642c339ef38513eaf49621e6bc66d5da35ed080319d9edfc394469` | applied |
| 0009_host_cooldowns | 1789460000000 | `0ea5ebc65df24af30b5a8d743b03c43f41515fe3ce9c2f2962d040abb136619c` | applied |
| 0010_shorts_default | 1789470000000 | `e9adf0795f3e855f58e4c092b76b9d2b514525cbe0cef81b86948423bc779385` | applied |
| 0011_item_repeats | 1789480000000 | `7e77c4aae423de9d560f0ec387f348d6fcbe4f2ab0d6bfd3e3fad9a1293f9880` | applied |
| 0012_account_icons | 1789490000000 | `5246942a78ee2b5fdd36694cd52a6f73274748359aad77cfb694d3544399544d` | applied |
| 0013_collection_share_levels | 1789500000000 | `f7c6f68cf97602fdfd877e1c4034e021bd662f7becf1bc640d7dff50d001f9e9` | applied |
| 0014_activity_visibility | 1789510000000 | `e4c2672d49a470ca00d89c14b63d94b278fcffed72131c12ac0d6e35fa4310fa` | applied |
| 0015_avatars | 1789520000000 | `bc30ae58fedcb9c10971d4691d450eebde840be14e80fe03113cf74efc1fe6a0` | applied |
| 0016_collections_parent_fk | 1790116986237 | `e3a47367c90d2e2b01235ee12beec47cfc42efc0fbf5de0792e77631fdbf3082` | applied |
| 0017_item_link | 1790124191553 | `54c01355be9de643cfe735d5cfcd3b450aa33a60d960c370692d3d447e41cd2c` | applied |
| 0018_notes_into_bookmarks | 1790181409827 | `6aa7cadab1ce3a9df50f7e0e76561dd1a1d8ceefd24e1c11bf95917b7786e8f6` | applied |
| 0019_email | 1790694785231 | `0b75d97559dc28b3af491d0934962af7f7da842895e66aab7305bdb5d3d2767b` | applied |
| 0020_api_tokens | 1790882277622 | `5b2ef9c85da33811fa1bfa577ee9b766438651a8e9c404d42ec8cca7e240471d` | applied |
| 0021_feedback | 1790951020198 | `d4c7303dc2466ac45087d2e9f473d1747e4ddd593c0378661d1438369118e9ec` | applied |
| 0022_bookmark_search | 1791079321801 | `39909c267cc730dfd47c2b88c36d614538ad6405365b885bd9fe25bb0d642c96` | applied |
| 0023_feed_language | 1791080825234 | `3a4dc494b8f712ee66f5d59fcbb44ed5816a4e6b2f0670bdd9944838cba3dea5` | applied |
| 0024_notifications | 1791083816742 | `4c5c1a1e9a582477a380a61a54839d1a9ea62fdc3ea15da37890f116078bdf93` | applied |
| 0025_feed_requires_subscription | 1791240445067 | `8bb1ea034d63cf8ae45ec6b69807d82d011427f451dcae9d5070d70dca53ec31` | applied |
| 0026_tour_seen_at | 1791298680319 | `3fd444b986434fccd112c5f6e9159f0270dacb1c39b74f1d1eaa1787df90c47a` | applied |
| 0027_saved_display | 1791309646258 | `c5ad8f9be85bc2b604f7f88206c2adcc0a36659805c3ceee2e44009e93cdab8c` | applied |
| 0028_display_source | 1791313144304 | `d430b03f7d913e8bde7e30cf53e6dcd9832d592045f97122bd004c5f94dcbc16` | applied |

Re-run the read-only audit if either the database history or migration files
change before deployment. See [DEPLOY.md](DEPLOY.md#auditing-migrations-before-an-upgrade).
