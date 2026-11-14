create schema study;
revoke all on schema study from public, anon, authenticated;
create table study.members(id uuid primary key references auth.users on delete cascade, username text unique not null, name text not null, admin boolean not null default false);
create table study.requests(username text primary key, name text not null, reason text not null, credential text, state text not null default 'pending', created timestamptz not null default now());
create table study.banks(id text primary key, name text not null);
create table study.units(bank text references study.banks, id text, name text not null, ord int not null, primary key(bank,id));
create table study.questions(bank text, id text, unit text, ord int not null, body jsonb not null, primary key(bank,id), foreign key(bank,unit) references study.units);
create table study.plans(id uuid primary key default gen_random_uuid(), name text not null, bank text references study.banks, units jsonb not null, counts jsonb not null, minutes int not null check(minutes between 1 and 360));
create table study.sessions(id uuid primary key default gen_random_uuid(), owner uuid references study.members on delete cascade, mode text not null, scope text not null, bank text not null, items jsonb not null, pos int not null default 0, answers jsonb not null default '{}', deadline timestamptz, finished boolean not null default false, created timestamptz default now());
create unique index active_scope on study.sessions(owner,mode,scope) where not finished;
create table study.mistakes(owner uuid references study.members on delete cascade, bank text, question text, streak int not null default 0, primary key(owner,bank,question));
do $$ declare t text; begin foreach t in array array['members','requests','banks','units','questions','plans','sessions','mistakes'] loop execute format('alter table study.%I enable row level security',t); end loop; end $$;
-- Auth-level backstop even when hosted signup settings have not yet been applied.
create function study.provision() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if coalesce(new.raw_app_meta_data->>'provisioned','') <> 'true' then raise exception '仅接受管理员审批的账号'; end if;
 insert into study.members values(new.id,new.raw_app_meta_data->>'username',new.raw_app_meta_data->>'name',coalesce((new.raw_app_meta_data->>'admin')::boolean,false));
 return new;
end $$;
create trigger provision_member after insert on auth.users for each row execute function study.provision();

create function study.record_result(uid uuid, bankid text, qid text, correct boolean, retrain boolean) returns void language plpgsql as $$
begin
 if not correct then insert into study.mistakes values(uid,bankid,qid,0) on conflict(owner,bank,question) do update set streak=0;
 elsif retrain then update study.mistakes set streak=least(3,streak+1) where owner=uid and bank=bankid and question=qid;
 end if;
end $$;
create function study.finish(sid uuid) returns void language plpgsql as $$
declare s study.sessions; q jsonb; begin
 select * into strict s from study.sessions where id=sid for update;
 if s.finished then return; end if;
 for q in select value from jsonb_array_elements(s.items) loop
 perform study.record_result(s.owner,s.bank,q->>'id',coalesce(s.answers->(q->>'id')=q->'answer',false),false);
 end loop;
 update study.sessions set finished=true where id=sid;
end $$;
create function study.expire() returns void language plpgsql as $$
declare s uuid; begin
 for s in select id from study.sessions where not finished and deadline<=clock_timestamp() order by id for update skip locked loop perform study.finish(s); end loop;
end $$;
create index exam_deadlines on study.sessions(deadline) where not finished and deadline is not null;
create function study.present(s study.sessions) returns jsonb language sql stable as $$
select jsonb_build_object('id',s.id,'mode',s.mode,'pos',s.pos,'total',jsonb_array_length(s.items),'finished',s.finished,'deadline',s.deadline,'serverTime',clock_timestamp(),'answers',s.answers,'items',
 (select jsonb_agg(case when s.finished or (s.mode<>'exam' and s.answers ? (q->>'id')) then q else q-array['answer','explanation'] end order by n) from jsonb_array_elements(s.items) with ordinality a(q,n))) $$;

create function study.check_plan(b text, us jsonb, counts jsonb) returns void language plpgsql as $$
declare k text; available int; needed int; total int:=0; begin
 if jsonb_array_length(us)=0 or exists(select 1 from jsonb_array_elements_text(us) u where not exists(select 1 from study.units where bank=b and id=u)) then raise exception '请选择有效单元'; end if;
 foreach k in array array['single','multi','judge'] loop
 needed:=coalesce((counts->>k)::int,0);
 if needed<0 then raise exception '题数不能为负'; end if;
 select count(*) into available from study.questions where bank=b and us ? unit and body->>'type'=k;
 if available<needed then raise exception '% 缺少 % 道',case k when 'single' then '单选' when 'multi' then '多选' else '判断' end,needed-available; end if;
 total:=total+needed;
 end loop;
 if total<1 then raise exception '请至少抽取一道题'; end if;
end $$;

-- Called exclusively by the Edge function after verifying the access token.
create function public.study_api(uid uuid, op text, p jsonb) returns jsonb language plpgsql security invoker set search_path=study,pg_catalog as $$
declare m members; r requests; s sessions; pl plans; b text:=p->>'bank'; mode text:=p->>'mode'; scopeid text; qs jsonb; q jsonb; u jsonb; a jsonb; i int; j int; added int:=0; changed int:=0; sid uuid; begin
 if op='apply' then
 if exists(select 1 from members where username=p->>'username') then raise exception '账号已被使用'; end if;
 insert into requests(username,name,reason,credential) values(p->>'username',p->>'name',p->>'reason',p->>'credential') on conflict(username) do update set name=excluded.name,reason=excluded.reason,credential=excluded.credential,state='pending',created=now() where requests.state='rejected';
 if not found then raise exception '账号已被使用或正在审批'; end if; return 'true';
 end if;
 select * into m from members where id=uid; if not found then raise exception '请先登录'; end if;
 if op in ('requests','claim','approved','reject','direct','import','preview','plan') and not m.admin then raise exception '需要管理员权限' using errcode='42501'; end if;
 if op='direct' then
 if exists(select 1 from requests where username=p->>'username' and state in ('pending','processing')) then raise exception '该账号已有申请，请在审批列表处理'; end if;return 'true';
 elsif op='requests' then return coalesce((select jsonb_agg(to_jsonb(t) order by created desc) from (select username,name,reason,state,created from requests) t),'[]');
 elsif op='claim' then
 update requests set state='processing' where username=p->>'username' and state in ('pending','processing') returning * into r;
 if not found then if exists(select 1 from requests where username=p->>'username' and state='approved') then return 'null'; end if; raise exception '申请状态已变更'; end if;return to_jsonb(r);
 elsif op='approved' then
 update requests set state='approved',credential=null where username=p->>'username' and state='processing' and exists(select 1 from members where username=requests.username);return 'true';
 elsif op='reject' then
 update requests set state='rejected',credential=null where username=p->>'username' and state='pending'; if not found then raise exception '申请状态已变更'; end if;return 'true';
 elsif op in ('preview','import') then
 b:=p->>'id'; if op='import' then insert into banks values(b,p->>'name') on conflict(id) do update set name=excluded.name; end if;
 i:=0;for u in select value from jsonb_array_elements(p->'units') loop
 i:=i+1;if op='import' then insert into units values(b,u->>'id',u->>'name',i) on conflict(bank,id) do update set name=excluded.name,ord=excluded.ord;end if;
 j:=0;for q in select value from jsonb_array_elements(u->'questions') loop
 j:=j+1;if exists(select 1 from questions where bank=b and id=q->>'id') then changed:=changed+1;else added:=added+1;end if;
 if op='import' then insert into questions values(b,q->>'id',u->>'id',j,q) on conflict(bank,id) do update set unit=excluded.unit,ord=excluded.ord,body=excluded.body;end if;
 end loop;end loop;return jsonb_build_object('added',added,'updated',changed);
 elsif op='plan' then perform check_plan(b,p->'units',p->'counts');insert into plans(name,bank,units,counts,minutes) values(p->>'name',b,p->'units',p->'counts',(p->>'minutes')::int);return 'true';
 end if;
 perform pg_advisory_xact_lock(hashtextextended(uid::text,0));
 for sid in select id from sessions where owner=uid and not finished and deadline<=clock_timestamp() order by id loop perform finish(sid); end loop;
 if op='home' then return jsonb_build_object('user',to_jsonb(m),'banks',coalesce((select jsonb_agg(to_jsonb(k) || jsonb_build_object('units',(select jsonb_agg(jsonb_build_object('id',un.id,'name',un.name,'count',(select count(*) from questions where bank=k.id and unit=un.id)) order by un.ord) from units un where un.bank=k.id))) from banks k),'[]'),'plans',coalesce((select jsonb_agg(to_jsonb(t)) from plans t),'[]'),'mistakes',coalesce((select jsonb_agg(jsonb_build_object('bank',w.bank,'id',w.question,'stem',h.body->>'stem','streak',w.streak) order by w.question) from mistakes w join questions h on h.bank=w.bank and h.id=w.question where w.owner=uid),'[]'),'history',coalesce((select jsonb_agg(to_jsonb(t) order by created desc) from (select id,sessions.mode,bank,finished,pos,created,jsonb_array_length(items) as total from sessions where owner=uid order by created desc limit 100) t),'[]'));
 elsif op='start' then
 if mode not in ('unit','random','exam','wrong') then raise exception '未知模式';end if;
 scopeid:=case mode when 'exam' then p->>'plan' when 'unit' then b||'/'||(p->>'unit') else b end;
 select * into s from sessions where owner=uid and sessions.mode=p->>'mode' and scope=scopeid and not finished;
 if found then return present(s);end if;
 if mode='exam' then select * into strict pl from plans where id=(p->>'plan')::uuid;b:=pl.bank;perform check_plan(b,pl.units,pl.counts);
 select jsonb_agg(body order by random()) into qs from (select body,row_number() over(partition by body->>'type' order by random()) n from questions where bank=b and pl.units ? unit) t where n<=(pl.counts->>(body->>'type'))::int;
 else
 select jsonb_agg(h.body order by case when mode='unit' then h.ord end,random()) into qs from questions h where h.bank=b and (mode<>'unit' or h.unit=p->>'unit') and (mode<>'wrong' or exists(select 1 from mistakes w where w.owner=uid and w.bank=b and w.question=h.id and w.streak<3));
 end if;
 if qs is null then raise exception '当前范围暂无可练习题目'; end if;
 insert into sessions(owner,mode,scope,bank,items,deadline) values(uid,mode,scopeid,b,qs,case when mode='exam' then clock_timestamp()+make_interval(mins=>pl.minutes) end) returning * into s;
 else
 select * into s from sessions where id=(p->>'id')::uuid and owner=uid for update;
 if not found then raise exception '记录不存在';end if;
 if not s.finished and s.deadline<=clock_timestamp() then perform finish(s.id);select * into s from sessions where id=s.id;end if;
 if not s.finished then
 if op='answer' then
 q:=s.items->s.pos;if q->>'id' is distinct from p->>'question' then raise exception '进度已变更，请刷新';end if;
 if jsonb_typeof(p->'answer') is distinct from 'array' then raise exception '答案格式有误';end if;
 select coalesce(jsonb_agg(distinct v order by v),'[]') into a from jsonb_array_elements_text(p->'answer') v;
 if exists(select 1 from jsonb_array_elements_text(a) v where length(v)<>1 or ascii(v)<65 or ascii(v)>=65+jsonb_array_length(q->'options')) or (q->>'type'<>'multi' and jsonb_array_length(a)>1) or (s.mode<>'exam' and a='[]') then raise exception '选项无效';end if;
 if s.mode='exam' or not s.answers ? (q->>'id') then
 update sessions set answers=jsonb_set(answers,array[q->>'id'],a) where id=s.id;
 if s.mode<>'exam' then perform record_result(uid,s.bank,q->>'id',a=q->'answer',s.mode='wrong');end if; end if;
 elsif op='move' then
 i:=(p->>'pos')::int;if i<0 or i>=jsonb_array_length(s.items) or (s.mode<>'exam' and i>s.pos and (i<>s.pos+1 or not s.answers ? ((s.items->s.pos)->>'id'))) then raise exception '无效题号';end if;
 update sessions set pos=i where id=s.id;
 elsif op='finish' then
 if s.mode='exam' then perform finish(s.id);
 elsif (select count(*) from jsonb_object_keys(s.answers))=jsonb_array_length(s.items) then update sessions set finished=true where id=s.id;
 else raise exception '本轮仍有未答题目';end if;
 elsif op<>'get' then raise exception '未知操作'; end if;end if;
 select * into s from sessions where id=s.id;
 end if;return present(s);
end $$;
revoke all on function public.study_api(uuid,text,jsonb) from public, anon, authenticated;
grant execute on function public.study_api(uuid,text,jsonb) to service_role;
grant usage on schema study to service_role;
grant select,insert,update on all tables in schema study to service_role;
revoke execute on all functions in schema study from public;
grant execute on all functions in schema study to service_role;
