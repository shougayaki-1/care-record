import 'server-only';

import { supabaseAdmin } from './auth';

// Purpose-specific entry points make every service-role use reviewable. The
// underlying client is never imported directly outside auth.ts and this file.
export const serviceRoleForAuthManagement = () => supabaseAdmin;
export const serviceRoleForBackup = () => supabaseAdmin;
export const serviceRoleForIncidentResponse = () => supabaseAdmin;
export const serviceRoleForPlatformMetadata = () => supabaseAdmin;
export const serviceRoleForAuditPreservation = () => supabaseAdmin;
export const serviceRoleForLoginSecurity = () => supabaseAdmin;
export const serviceRoleForOAuthNonce = () => supabaseAdmin;
export const serviceRoleForServerSessions = () => supabaseAdmin;
export const serviceRoleForRetentionDryRun = () => supabaseAdmin;
