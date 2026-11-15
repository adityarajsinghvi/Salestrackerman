-- Salesman Bonus Tracker schema. All tables are prefixed st_ so they never collide with other apps.

create table st_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null,
  display_name text not null,
  role text not null default 'salesman' check (role in ('owner','salesman')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table st_items (
  id bigint generated always as identity primary key,
  name text not null,
  points int not null check (points >= 0),
  sort int not null default 0,
  active boolean not null default true
);

create table st_sales (
  id bigint generated always as identity primary key,
  salesman_id uuid not null references st_profiles(id) on delete cascade,
  item_id bigint references st_items(id) on delete set null,
  item_name text not null default '',
  points int not null default 0,
  sold_on date not null default current_date,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
create index st_sales_man_date on st_sales (salesman_id, sold_on);
create index st_sales_date on st_sales (sold_on);

create table st_settings (
  id int primary key default 1 check (id = 1),
  rate_per_point numeric not null default 0
);
insert into st_settings default values;

insert into st_items (name, points, sort) values
  ('Pant',1,1),('Shirt',1,2),('Suit',10,3),('Blazer',10,4),('Kurta',5,5),('Kothi',5,6);

-- Owner check used by the policies (security definer so it can read st_profiles without recursion).
create function st_is_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from st_profiles where id = auth.uid() and role = 'owner' and active)
$$;
revoke execute on function st_is_owner() from public, anon;
grant execute on function st_is_owner() to authenticated;

-- Snapshot name + points from the item when a sale is inserted, so rate changes never rewrite history
-- and the client cannot invent points.
create function st_sales_fill() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  select name, points into new.item_name, new.points from st_items where id = new.item_id;
  if not found then raise exception 'unknown item'; end if;
  new.created_by := auth.uid();
  return new;
end $$;
revoke execute on function st_sales_fill() from public, anon, authenticated;
create trigger st_sales_fill_trg before insert on st_sales
  for each row execute function st_sales_fill();

-- Monthly totals per salesman and item. security invoker => RLS applies:
-- a salesman only ever gets their own rows, the owner gets everyone.
create function st_month_summary(month_start date)
returns table (salesman_id uuid, item_name text, qty bigint, pts bigint)
language sql stable security invoker set search_path = public as $$
  select salesman_id, item_name, count(*), sum(points)
  from st_sales
  where sold_on >= month_start and sold_on < (month_start + interval '1 month')::date
  group by salesman_id, item_name
$$;
revoke execute on function st_month_summary(date) from public, anon;
grant execute on function st_month_summary(date) to authenticated;

alter table st_profiles enable row level security;
alter table st_items    enable row level security;
alter table st_sales    enable row level security;
alter table st_settings enable row level security;

-- profiles: you see yourself, the owner sees and edits everyone (rows are created by the edge function)
create policy profiles_select on st_profiles for select to authenticated
  using (id = (select auth.uid()) or (select st_is_owner()));
create policy profiles_owner_update on st_profiles for update to authenticated
  using ((select st_is_owner())) with check ((select st_is_owner()));

-- items & settings: everyone logged in can read, only the owner can change
create policy items_select on st_items for select to authenticated using (true);
create policy items_owner_write on st_items for all to authenticated
  using ((select st_is_owner())) with check ((select st_is_owner()));
create policy settings_select on st_settings for select to authenticated using (true);
create policy settings_owner_update on st_settings for update to authenticated
  using ((select st_is_owner())) with check ((select st_is_owner()));

-- sales: salesmen read only their own; only the owner can add or delete. Nobody can update.
create policy sales_select on st_sales for select to authenticated
  using (salesman_id = (select auth.uid()) or (select st_is_owner()));
create policy sales_owner_insert on st_sales for insert to authenticated
  with check ((select st_is_owner()));
create policy sales_owner_delete on st_sales for delete to authenticated
  using ((select st_is_owner()));
