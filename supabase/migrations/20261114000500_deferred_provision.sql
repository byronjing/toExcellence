-- GoTrue may write admin app_metadata in a second statement of the creation transaction.
drop trigger provision_member on auth.users;
create or replace function study.provision() returns trigger language plpgsql security definer set search_path='' as $$
declare meta jsonb;
begin
 select raw_app_meta_data into meta from auth.users where id=new.id;
 if coalesce(meta->>'provisioned','') <> 'true' then raise exception '仅接受管理员审批的账号'; end if;
 insert into study.members values(new.id,meta->>'username',meta->>'name',coalesce((meta->>'admin')::boolean,false));
 return new;
end $$;
create constraint trigger provision_member after insert on auth.users deferrable initially deferred for each row execute function study.provision();
