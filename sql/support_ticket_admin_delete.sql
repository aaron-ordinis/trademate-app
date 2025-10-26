-- Allow admin users to delete support tickets directly (no edge function needed)
create policy "Admin can delete support tickets"
  on public.support_tickets
  for delete
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and admin_owner = true
    )
  );

-- Allow admin users to delete support messages directly (if needed)
create policy "Admin can delete support messages"
  on public.support_messages
  for delete
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and admin_owner = true
    )
  );
