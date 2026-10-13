-- SPDX-License-Identifier: MIT
-- V6.2-to-Cal.diy admission only. This does NOT prove backup freshness or that
-- application writers are stopped; both remain deployment prerequisites.
-- Never emit row contents, credentials or identity values in this check.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '15s';
SET LOCAL search_path = pg_catalog;
DO $preflight$
DECLARE
  item record;
  table_name text;
  affected boolean;
  relation_id regclass;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'App_RoutingForms_Form', 'App_RoutingForms_FormResponse',
    'App_RoutingForms_IncompleteBookingActions', 'App_RoutingForms_QueuedFormResponse',
    'PendingRoutingTrace', 'RoutingFormResponseDenormalized', 'RoutingFormResponseField',
    'RoutingTrace', 'WorkflowsOnRoutingForms', 'WorkflowStepTranslation',
    'WorkflowReminder', 'WorkflowsOnEventTypes', 'WorkflowsOnTeams',
    'WorkflowOptOutContact', 'AIPhoneCallConfiguration', 'WorkflowStep',
    'Workflow', 'Impersonations', 'DomainWideDelegation'
  ] LOOP
    relation_id := to_regclass(format('public.%I', table_name));
    IF relation_id IS NOT NULL THEN
      IF EXISTS (SELECT 1 FROM pg_class WHERE oid = relation_id AND (relrowsecurity OR relforcerowsecurity)) THEN
        RAISE EXCEPTION 'Migration refused: legacy table % has row-security rules requiring independent review', table_name;
      END IF;
      EXECUTE format('SELECT EXISTS (SELECT 1 FROM public.%I)', table_name) INTO affected;
      IF affected THEN
        RAISE EXCEPTION 'Migration refused: legacy table % contains records that pending cleanup migrations would delete', table_name;
      END IF;
    END IF;
  END LOOP;

  FOR item IN SELECT * FROM (VALUES
    ('EventType', 'redirectUrlOnNoRoutingFormResponse', 'IS NOT NULL'),
    ('WrongAssignmentReport', 'routingFormId', 'IS NOT NULL'),
    ('users', 'whitelistWorkflows', 'IS DISTINCT FROM false'),
    ('users', 'disableImpersonation', 'IS DISTINCT FROM false'),
    ('Membership', 'disableImpersonation', 'IS DISTINCT FROM false'),
    ('BookingReference', 'domainWideDelegationCredentialId', 'IS NOT NULL'),
    ('DestinationCalendar', 'domainWideDelegationCredentialId', 'IS NOT NULL'),
    ('SelectedCalendar', 'domainWideDelegationCredentialId', 'IS NOT NULL'),
    ('AssignmentReason', 'reasonEnum', '::text IN (''ROUTING_FORM_ROUTING'', ''ROUTING_FORM_ROUTING_FALLBACK'')'),
    ('Webhook', 'eventTriggers', '::text[] && ARRAY[''ROUTING_FORM_FALLBACK_HIT'', ''INSTANT_MEETING'']::text[]')
  ) AS checks(table_name, column_name, predicate)
  LOOP
    relation_id := to_regclass(format('public.%I', item.table_name));
    IF relation_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM pg_attribute
      WHERE attrelid = relation_id AND attname = item.column_name AND NOT attisdropped
    ) THEN
      IF EXISTS (SELECT 1 FROM pg_class WHERE oid = relation_id AND (relrowsecurity OR relforcerowsecurity)) THEN
        RAISE EXCEPTION 'Migration refused: table % has row-security rules requiring independent review', item.table_name;
      END IF;
      -- Identifiers and predicates come only from the closed, source-owned list.
      EXECUTE format('SELECT EXISTS (SELECT 1 FROM public.%I WHERE %I %s)',
        item.table_name, item.column_name, item.predicate) INTO affected;
      IF affected THEN
        RAISE EXCEPTION 'Migration refused: %.% contains legacy values requiring explicit preservation before cleanup',
          item.table_name, item.column_name;
      END IF;
    END IF;
  END LOOP;
END;
$preflight$;
COMMIT;
