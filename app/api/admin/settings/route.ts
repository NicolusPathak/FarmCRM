// app/api/admin/settings/route.ts — Get + update retention thresholds.
import { NextRequest, NextResponse } from 'next/server';
import { apiAdmin } from '@/lib/auth';
import { getRetentionSettings, updateRetentionSettings, type RetentionSettings } from '@/lib/retention';
import { logAudit } from '@/lib/audit';

export async function GET() {
  const auth = await apiAdmin();
  if (auth.error) return auth.error;
  const settings = await getRetentionSettings();
  return NextResponse.json({ retention: settings });
}

export async function PUT(req: NextRequest) {
  const auth = await apiAdmin();
  if (auth.error) return auth.error;

  const body = await req.json().catch(() => ({}));
  const incoming = body.retention as Partial<RetentionSettings> | undefined;
  if (!incoming || typeof incoming !== 'object') {
    return NextResponse.json({ error: 'Missing retention payload' }, { status: 400 });
  }

  const before = await getRetentionSettings();
  // Owner IDs live in owner_credentials, not staff_users, so passing one
  // here would violate the FK on app_settings.updated_by. Use null instead;
  // the audit log still records who via actor_name/actor_role.
  const actorId = auth.user.role === 'owner' ? null : auth.user.id;
  const after = await updateRetentionSettings(incoming, actorId);

  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const k of Object.keys(after) as (keyof RetentionSettings)[]) {
    if (before[k] !== after[k]) changes[k] = { from: before[k], to: after[k] };
  }
  if (Object.keys(changes).length > 0) {
    await logAudit({
      actor: auth.user,
      action: 'updated',
      entity_type: 'settings',
      entity_label: 'Retention thresholds',
      changes,
    });
  }

  return NextResponse.json({ retention: after });
}
