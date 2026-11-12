-- =====================================================================
-- RAQBO — the first partner territories
--
-- This is the coverage map the partner network needs before anyone can
-- apply: Punjab, its divisions, the districts and cities RAQBO works in,
-- and the Lahore societies where the first Area Partners will be placed.
--
-- These are real places, nothing invented. How many partners each area
-- allows is RAQBO's commercial decision — the numbers below follow your
-- document (one Area Partner per society, more in a large city) and an
-- admin can change any of them in Partner network → Territories.
--
-- Safe to run more than once: a place already on the map is left alone.
-- =====================================================================

do $$
declare
  v_punjab uuid; v_lhr_div uuid; v_lhr uuid; v_gjw_div uuid; v_fsd_div uuid;
  v_rwp_div uuid; v_mln_div uuid; v_sgd_div uuid;
  v_city uuid;
  r record;
begin
  if to_regclass('public.pn_territories') is null then
    raise notice 'The partner network is not installed yet. Run update_29 first.';
    return;
  end if;

  -- ---------- province ----------
  select id into v_punjab from public.pn_territories where level = 'province' and name = 'Punjab';
  if v_punjab is null then
    insert into public.pn_territories (level, name, province, status, max_partners, boundary_note)
    values ('province', 'Punjab', 'Punjab', 'reserved', 1,
            'Province level is held by RAQBO. Partners are appointed at city and society level beneath it.')
    returning id into v_punjab;
  end if;

  -- ---------- divisions ----------
  for r in select * from (values
    ('Lahore Division'), ('Gujranwala Division'), ('Faisalabad Division'),
    ('Rawalpindi Division'), ('Multan Division'), ('Sargodha Division')
  ) as t(nm) loop
    if not exists (select 1 from public.pn_territories where level = 'division' and name = r.nm) then
      insert into public.pn_territories (level, name, province, division, parent_id, status, max_partners, boundary_note)
      values ('division', r.nm, 'Punjab', r.nm, v_punjab, 'reserved', 1,
              'Division level is held by RAQBO while the network is being built.');
    end if;
  end loop;

  select id into v_lhr_div from public.pn_territories where level = 'division' and name = 'Lahore Division';
  select id into v_gjw_div from public.pn_territories where level = 'division' and name = 'Gujranwala Division';
  select id into v_fsd_div from public.pn_territories where level = 'division' and name = 'Faisalabad Division';
  select id into v_rwp_div from public.pn_territories where level = 'division' and name = 'Rawalpindi Division';
  select id into v_mln_div from public.pn_territories where level = 'division' and name = 'Multan Division';
  select id into v_sgd_div from public.pn_territories where level = 'division' and name = 'Sargodha Division';

  -- ---------- the cities RAQBO starts in ----------
  -- max_partners follows the size of the city, as in your own plan: the
  -- pilot city takes several Area Partners, the others start with one.
  for r in select * from (values
    ('Lahore',      'Lahore Division',      6),
    ('Gujranwala',  'Gujranwala Division',  2),
    ('Sialkot',     'Gujranwala Division',  1),
    ('Faisalabad',  'Faisalabad Division',  2),
    ('Rawalpindi',  'Rawalpindi Division',  2),
    ('Multan',      'Multan Division',      2),
    ('Sargodha',    'Sargodha Division',    1)
  ) as t(nm, div, cap) loop
    if not exists (select 1 from public.pn_territories where level = 'city' and name = r.nm) then
      insert into public.pn_territories (level, name, province, division, district, city, parent_id, status, max_partners, boundary_note)
      values ('city', r.nm, 'Punjab', r.div, r.nm, r.nm,
              (select id from public.pn_territories where level = 'division' and name = r.div),
              'available', r.cap,
              'Whole-city territory. A city partner covers areas not already held by a society partner.');
    end if;
  end loop;

  select id into v_lhr from public.pn_territories where level = 'city' and name = 'Lahore';

  -- ---------- Lahore societies and areas ----------
  -- One Area Partner each, which is what your document sets out. These are
  -- the areas RAQBO's listings already come from.
  for r in select * from (values
    ('DHA Lahore'), ('Bahria Town Lahore'), ('Johar Town'), ('Model Town'),
    ('Wapda Town'), ('Valencia Town'), ('Askari Housing'), ('Gulberg'),
    ('Faisal Town'), ('Garden Town'), ('Iqbal Town'), ('Township'),
    ('Cantt'), ('Raiwind Road'), ('Ferozepur Road'), ('Multan Road'),
    ('Canal Road'), ('Paragon City'), ('Lake City'), ('State Life Housing')
  ) as t(nm) loop
    if not exists (select 1 from public.pn_territories where level = 'society' and name = r.nm) then
      insert into public.pn_territories (level, name, province, division, district, city, parent_id, status, max_partners, boundary_note)
      values ('society', r.nm, 'Punjab', 'Lahore Division', 'Lahore', 'Lahore', v_lhr, 'available', 1,
              'One Area Partner for this society. A second may be allowed later if the volume supports it.');
    end if;
  end loop;

  -- ---------- Lahore commercial areas ----------
  -- Commercial leasing works differently from housing, so these are held
  -- separately and can be given to a partner who handles commercial only.
  for r in select * from (values
    ('Blue Area Lahore'), ('Gulberg Main Boulevard'), ('MM Alam Road'),
    ('Mall Road'), ('Hall Road'), ('Badami Bagh'), ('Sundar Industrial Estate')
  ) as t(nm) loop
    if not exists (select 1 from public.pn_territories where level = 'commercial_area' and name = r.nm) then
      insert into public.pn_territories (level, name, province, division, district, city, parent_id, status, max_partners, boundary_note)
      values ('commercial_area', r.nm, 'Punjab', 'Lahore Division', 'Lahore', 'Lahore', v_lhr, 'available', 1,
              'Commercial territory. May be held by a partner who handles commercial property only.');
    end if;
  end loop;

  raise notice 'Territories on the map now: %', (select count(*) from public.pn_territories);
end $$;
