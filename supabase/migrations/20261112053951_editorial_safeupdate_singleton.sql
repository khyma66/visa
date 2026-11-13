-- Preserve production's safeupdate protection. Target the singleton row in the
-- existing implementations without changing authorization or publisher logic.
do $migration$
declare item record; definition text; updated text;
begin
  for item in select * from (values
    ('private.editorial_owner_action(text,jsonb)', 'update private.editorial_settings set enabled=(payload->>''enabled'')::boolean;', 'update private.editorial_settings set enabled=(payload->>''enabled'')::boolean where singleton=true;'),
    ('private.editorial_publish_due()', 'update private.editorial_settings set last_published_at=now();', 'update private.editorial_settings set last_published_at=now() where singleton=true;'),
    ('private.editorial_stop_all()', 'update private.editorial_settings set enabled=false;', 'update private.editorial_settings set enabled=false where singleton=true;')
  ) as replacements(signature, before_sql, after_sql)
  loop
    select pg_get_functiondef(to_regprocedure(item.signature)) into strict definition;
    if definition is null or position(item.before_sql in definition)=0 or
       (length(definition)-length(replace(definition,item.before_sql,'')))/length(item.before_sql)<>1 then
      raise exception 'Unexpected function definition: %', item.signature;
    end if;
    updated:=replace(definition,item.before_sql,item.after_sql);
    execute updated;
  end loop;
end
$migration$;
