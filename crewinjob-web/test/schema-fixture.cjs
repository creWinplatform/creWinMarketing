// Disposable migration fixtures only; never loaded by application code.
exports.removeCoachSchema=db=>db.exec('DROP TABLE IF EXISTS platform_growth_coach_actions; DROP TABLE IF EXISTS platform_growth_coach; DELETE FROM platform_migrations WHERE version=31;');
exports.removeCompassSchema=db=>{exports.removeCoachSchema(db);db.exec('DROP TABLE IF EXISTS platform_compass_preferences; DELETE FROM platform_migrations WHERE version=30;');};
exports.removeMobileSchema=db=>{exports.removeCompassSchema(db);db.exec(`DROP TABLE IF EXISTS platform_mobile_costs; DROP TABLE IF EXISTS platform_mobile_links; DROP TABLE IF EXISTS platform_mobile_deliveries; DROP TABLE IF EXISTS platform_mobile_messages; DROP TABLE IF EXISTS platform_mobile_contacts; DROP TABLE IF EXISTS platform_mobile_event_details; DROP INDEX IF EXISTS platform_mobile_event_identity; DROP TABLE IF EXISTS platform_mobile_store_snapshots; DROP TABLE IF EXISTS platform_mobile_integrations; DROP TABLE IF EXISTS platform_mobile_apps; DELETE FROM platform_migrations WHERE version=29;`);};
exports.removeEngagementSchema=db=>{exports.removeMobileSchema(db);db.exec(`DROP TABLE IF EXISTS platform_social_engagement; DELETE FROM platform_migrations WHERE version=28;`);};
exports.removeWorkerObservationSchema=db=>{exports.removeEngagementSchema(db);db.exec(`DROP TABLE IF EXISTS platform_worker_observations; DROP TABLE IF EXISTS platform_operation_metadata; DELETE FROM platform_migrations WHERE version=27;`);};
exports.removeBillingCheckSchema=db=>{exports.removeWorkerObservationSchema(db);db.exec(`DROP TABLE IF EXISTS platform_billing_checks; DROP INDEX IF EXISTS platform_billing_order_identity; ALTER TABLE platform_billing_orders DROP COLUMN settlement_source; ALTER TABLE platform_billing_orders DROP COLUMN revision; DELETE FROM platform_migrations WHERE version=26;`);};
exports.removeEntitlementSchema=db=>{exports.removeBillingCheckSchema(db);db.exec(`DROP TABLE IF EXISTS platform_plan_preferences; DROP TABLE IF EXISTS platform_project_entitlements; DELETE FROM platform_migrations WHERE version=25;`);};
exports.removeBillingSchema=db=>{exports.removeEntitlementSchema(db);db.exec(`DROP TABLE IF EXISTS platform_billing_orders; DELETE FROM platform_migrations WHERE version=24;`);};
exports.removeUsageSchema=db=>{exports.removeBillingSchema(db);db.exec(`DROP TABLE IF EXISTS platform_usage_reservations; DELETE FROM platform_migrations WHERE version=23;`);};
exports.removeIdentitySchema=db=>{exports.removeUsageSchema(db);db.exec(`DROP TABLE IF EXISTS platform_identity_challenges; DROP TABLE IF EXISTS platform_account_emails; DELETE FROM platform_migrations WHERE version=22;`);};
exports.removeInstagramSchema=db=>{exports.removeIdentitySchema(db);db.exec(`ALTER TABLE platform_social_publications DROP COLUMN preparation_started_at; ALTER TABLE platform_social_publications DROP COLUMN provider_container_id; ALTER TABLE platform_social_publications DROP COLUMN next_check_at; ALTER TABLE platform_social_publications DROP COLUMN image_bytes; DELETE FROM platform_migrations WHERE version=21;`);};
exports.removeSocialPublicationSchema=db=>{exports.removeIdentitySchema(db);db.exec(`DROP TABLE platform_social_publish_checks; DROP TABLE platform_social_publications; DELETE FROM platform_migrations WHERE version IN (20,21);`);};
exports.removeMeasurementSchema=db=>{exports.removeSocialPublicationSchema(db);db.exec(`
 DROP TABLE platform_measurement_syncs;
 DROP INDEX platform_metric_automatic_identity;
 ALTER TABLE platform_metric_entries DROP COLUMN provenance_json;
 ALTER TABLE platform_metric_entries DROP COLUMN period_to;
 ALTER TABLE platform_metric_entries DROP COLUMN period_from;
 ALTER TABLE platform_metric_entries DROP COLUMN binding_version;
 ALTER TABLE platform_metric_entries DROP COLUMN binding_id;
 DROP TABLE platform_measurement_bindings;
 DELETE FROM platform_migrations WHERE version=19;
`);};
