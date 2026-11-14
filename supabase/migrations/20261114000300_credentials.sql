create extension if not exists pgcrypto with schema extensions;
create table study.keyring (singleton boolean primary key default true check(singleton), secret text not null);
alter table study.keyring enable row level security;
insert into study.keyring values(true,encode(extensions.gen_random_bytes(32),'hex'));
create function public.study_apply(uname text,display_name text,reason_text text,pwd text) returns void language plpgsql security definer set search_path='' as $$
begin
perform public.study_api(null,'apply',jsonb_build_object('username',uname,'name',display_name,'reason',reason_text,'credential',encode(extensions.pgp_sym_encrypt(pwd,(select secret from study.keyring)),'base64')));
end $$;
create function public.study_claim(actor uuid,uname text) returns jsonb language plpgsql security definer set search_path='' as $$
declare r jsonb; begin
r:=public.study_api(actor,'claim',jsonb_build_object('username',uname));
if r='null' then return null;end if;
return jsonb_build_object('username',uname,'name',r->>'name','exists',exists(select 1 from study.members where username=uname),'password',extensions.pgp_sym_decrypt(decode(r->>'credential','base64'),(select secret from study.keyring)));
end $$;
revoke all on function public.study_apply(text,text,text,text),public.study_claim(uuid,text) from public,anon,authenticated;
grant execute on function public.study_apply(text,text,text,text),public.study_claim(uuid,text) to service_role;
