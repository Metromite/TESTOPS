-- Dashboard Home: restore the intended Valid Invoices definition and Fleet-based
-- vehicle filtering. Zero-box invoices remain available to the Zero Boxes
-- informational view, but are excluded from Home KPI/chart totals.
-- Pickup matching is normalized (Pick-Up / PICK-UP / PICKUP) and uses Fleet
-- Database vehicle type as the authoritative vehicle type.

do $migration$
declare
  def text;
begin
  select pg_get_functiondef('public.dispatchops_dashboard_home_snapshot(date,date,jsonb)'::regprocedure)
    into def;

  -- Valid Invoices: exclude rows with no boxes. The imported data uses boxes
  -- as the total physical-box count; zero-box rows are informational only.
  if position('coalesce(s.boxes,0) > 0' in def) = 0 then
    def := replace(
      def,
      $$and lower(trim(coalesce(s.division_desc,''))) not in ('','unknown','unclassified','n/a','na','not available','not available/unknown')$$,
      $$and lower(trim(coalesce(s.division_desc,''))) not in ('','unknown','unclassified','n/a','na','not available','not available/unknown')
    and coalesce(s.boxes,0) > 0$$
    );
  end if;

  -- Newer snapshot versions have a direct vehicle-type filter. Normalize the
  -- spelling so Pick-Up/PICKUP/PICK-UP all match the same Fleet type.
  def := replace(
    def,
    $$and (jsonb_array_length(coalesce(p_filters->'vehicle_type','[]'::jsonb))=0 or coalesce(nullif(f.vehicle_type,''),nullif(s.vehicle_type,''),'') in (select jsonb_array_elements_text(p_filters->'vehicle_type')))$$,
    $$and (jsonb_array_length(coalesce(p_filters->'vehicle_type','[]'::jsonb))=0 or regexp_replace(upper(trim(coalesce(nullif(f.vehicle_type,''),nullif(s.vehicle_type,''),''))),'[^A-Z0-9]','','g') in (select regexp_replace(upper(trim(jsonb_array_elements_text(p_filters->'vehicle_type'))),'[^A-Z0-9]','','g')))$$
  );

  -- Older/current deployed snapshot versions filter vehicle type through the
  -- Areas table. Replace that with Fleet Database vehicle matching and keep
  -- route_type independently tied to Areas.
  def := replace(
    def,
    $$and ((jsonb_array_length(coalesce(p_filters->'route_type','[]'::jsonb))=0 and jsonb_array_length(coalesce(p_filters->'vehicle_type','[]'::jsonb))=0) or exists(select 1 from public.areas a where coalesce(nullif(a.name,''),a.area_name)=s.area and (jsonb_array_length(coalesce(p_filters->'route_type','[]'::jsonb))=0 or a.route_type in (select jsonb_array_elements_text(p_filters->'route_type'))) and (jsonb_array_length(coalesce(p_filters->'vehicle_type','[]'::jsonb))=0 or a.vehicle_type in (select jsonb_array_elements_text(p_filters->'vehicle_type')))))$$,
    $$and (
      jsonb_array_length(coalesce(p_filters->'vehicle_type','[]'::jsonb))=0
      or exists (
        select 1 from public.vehicles v
        where regexp_replace(upper(trim(coalesce(nullif(v.number,''),v.vehicle_number,''))),'[^A-Z0-9]','','g')
          = regexp_replace(upper(trim(coalesce(nullif(s.vehicle_num,''),s.vehicle_key,''))),'[^A-Z0-9]','','g')
          and regexp_replace(upper(trim(coalesce(nullif(v.type,''),v.vehicle_type,''))),'[^A-Z0-9]','','g')
            in (select regexp_replace(upper(trim(jsonb_array_elements_text(p_filters->'vehicle_type'))),'[^A-Z0-9]','','g'))
      )
    )
    and (
      jsonb_array_length(coalesce(p_filters->'route_type','[]'::jsonb))=0
      or exists (
        select 1 from public.areas a
        where coalesce(nullif(a.name,''),a.area_name)=s.area
          and a.route_type in (select jsonb_array_elements_text(p_filters->'route_type'))
      )
    )$$
  );

  -- Where the snapshot displays vehicle_type directly from SAP, resolve it
  -- from Fleet by normalized vehicle number first.
  def := replace(
    def,
    $$coalesce(s.vehicle_type,'') vehicle_type$$,
    $$coalesce(
      (
        select nullif(trim(coalesce(nullif(v.type,''),v.vehicle_type,'')),'')
        from public.vehicles v
        where regexp_replace(upper(trim(coalesce(nullif(v.number,''),v.vehicle_number,''))),'[^A-Z0-9]','','g')
          = regexp_replace(upper(trim(coalesce(nullif(s.vehicle_num,''),s.vehicle_key,''))),'[^A-Z0-9]','','g')
        order by v.updated_at desc nulls last
        limit 1
      ),
      coalesce(s.vehicle_type,'')
    ) vehicle_type$$
  );

  execute def;
end
$migration$;
