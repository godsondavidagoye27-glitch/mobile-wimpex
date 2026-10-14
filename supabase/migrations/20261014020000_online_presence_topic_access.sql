grant select, insert on realtime.messages to authenticated;

create policy "Users can read their own online presence topic"
on realtime.messages for select to authenticated
using (
  extension = 'presence'
  and realtime.topic() = 'presence:' || auth.uid()::text
);
