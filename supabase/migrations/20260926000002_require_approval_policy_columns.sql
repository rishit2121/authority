-- Part 3B: columns backing the "require_approval" policy effect added in
-- the previous migration (which must land in its own transaction — a new
-- enum value cannot be referenced in the same transaction that adds it).

alter table public.policies
  add column required_approval_role public.tenant_role,
  add column required_approval_count integer;

alter table public.policies
  add constraint policies_required_approval_role_required
    check (effect = 'require_approval' or required_approval_role is null),
  add constraint policies_require_approval_needs_role
    check (effect <> 'require_approval' or required_approval_role is not null),
  add constraint policies_required_approval_count_bounded
    check (required_approval_count is null or (required_approval_count > 0 and required_approval_count <= 10)),
  add constraint policies_required_approval_count_scoped
    check (effect = 'require_approval' or required_approval_count is null);

comment on column public.policies.required_approval_role is
  'Only meaningful when effect = ''require_approval''. Minimum tenant role that may satisfy the resulting approval requirement.';
comment on column public.policies.required_approval_count is
  'Only meaningful when effect = ''require_approval''. Distinct qualifying approvals required; defaults to 1 in application code when null.';
