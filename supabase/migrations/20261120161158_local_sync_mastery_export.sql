-- Durable, idempotent batches and independently rated mastery.
alter table study.mistakes add column mastery int not null default 0 check(mastery between 0 and 3), add column mastery_source text not null default 'unrated', add column mastery_updated_at timestamptz;
update study.mistakes set mastery=3,mastery_source='legacy',mastery_updated_at=now() where streak=3;
create table study.sync_events(owner uuid references study.members on delete cascade, event_id text, session_id uuid references study.sessions on delete cascade, primary key(owner,event_id));
create table study.attempts(owner uuid references study.members on delete cascade, session_id uuid references study.sessions on delete cascade, bank text not null, question text not null, mode text not null, snapshot jsonb not null, answer jsonb not null, correct boolean not null, answered_at timestamptz, received_at timestamptz not null default clock_timestamp(), source text not null, event_id text, primary key(session_id,question));
alter table study.sync_events enable row level security;
alter table study.attempts enable row level security;
grant select,insert,update on study.sync_events,study.attempts to service_role;
create index attempts_owner_question on study.attempts(owner,bank,question);

create or replace function study.record_result(uid uuid, bankid text, qid text, correct boolean, retrain boolean) returns void language plpgsql set search_path=pg_catalog,study as $$
begin
 if not correct then insert into study.mistakes(owner,bank,question,streak) values(uid,bankid,qid,0) on conflict(owner,bank,question) do update set streak=0,mastery=0,mastery_source='wrong_answer',mastery_updated_at=clock_timestamp();
 elsif retrain then update study.mistakes set streak=least(3,streak+1) where owner=uid and bank=bankid and question=qid; end if;
end $$;

create function study.capture_attempts() returns trigger language plpgsql set search_path=pg_catalog,study as $$
declare q jsonb; begin
 for q in select value from jsonb_array_elements(new.items) loop
 if (new.mode='exam' and new.finished and not old.finished) or (new.mode<>'exam' and new.answers ? (q->>'id') and not old.answers ? (q->>'id')) then
 insert into attempts(owner,session_id,bank,question,mode,snapshot,answer,correct,answered_at,source,event_id)
 values(new.owner,new.id,new.bank,q->>'id',new.mode,q,coalesce(new.answers->(q->>'id'),'[]'),coalesce(new.answers->(q->>'id')=q->'answer',false),
 case when new.mode='exam' then null else nullif(current_setting('study.event_time',true),'')::timestamptz end,
 case when new.mode='exam' then 'exam_final' else 'recorded' end,nullif(current_setting('study.event_id',true),'')) on conflict do nothing;
 end if; end loop; return new;
end $$;
create trigger capture_attempts after update on study.sessions for each row execute function study.capture_attempts();
insert into study.attempts(owner,session_id,bank,question,mode,snapshot,answer,correct,source)
select s.owner,s.id,s.bank,q->>'id',s.mode,q,coalesce(s.answers->(q->>'id'),'[]'),coalesce(s.answers->(q->>'id')=q->'answer',false),'legacy_snapshot'
from study.sessions s cross join lateral jsonb_array_elements(s.items) q where (s.mode='exam' and s.finished) or (s.mode<>'exam' and s.answers ? (q->>'id'));

create or replace function study.present(s study.sessions) returns jsonb language sql stable set search_path=pg_catalog,study as $$
select jsonb_build_object('id',s.id,'bank',s.bank,'mode',s.mode,'pos',s.pos,'total',jsonb_array_length(s.items),'finished',s.finished,'deadline',s.deadline,'serverTime',clock_timestamp(),'answers',s.answers,
'mastery',coalesce((select jsonb_object_agg(question,mastery) from study.mistakes where owner=s.owner and bank=s.bank),'{}'),
'items',(select jsonb_agg(case when s.finished or (s.mode<>'exam' and (current_setting('study.client_version',true)='2' or s.answers ? (q->>'id'))) then q else q-array['answer','explanation'] end order by n) from jsonb_array_elements(s.items) with ordinality a(q,n))) $$;
create or replace function public.study_api(uid uuid, op text, p jsonb) returns jsonb language plpgsql security invoker set search_path=study,pg_catalog as $$
declare m members; r requests; s sessions; pl plans; b text:=p->>'bank'; mode text:=p->>'mode'; scopeid text; qs jsonb; q jsonb; u jsonb; a jsonb; i int; j int; added int:=0; changed int:=0; sid uuid; ev jsonb; ack jsonb:='[]'; rejected jsonb:='[]'; result jsonb; begin
 perform set_config('study.client_version',coalesce(p->>'clientVersion','1'),true);
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

 if op='sync' then
   select * into s from sessions where id=(p->>'id')::uuid and owner=uid for update;
   if not found then raise exception '记录不存在'; end if;
   if jsonb_typeof(p->'events') is distinct from 'array' or jsonb_array_length(p->'events')>100 then raise exception '批量记录格式有误'; end if;
   for ev in select value from jsonb_array_elements(p->'events') loop
     if coalesce(ev->>'eventId','')='' or length(ev->>'eventId')>300 or ev->>'op' not in ('answer','move','rate') then raise exception '操作格式有误'; end if;
     if exists(select 1 from sync_events where owner=uid and event_id=ev->>'eventId' and session_id=s.id) then
       ack:=ack||jsonb_build_array(ev->>'eventId'); continue;
     end if;
     select * into s from sessions where id=s.id;
     if ev->>'op'<>'rate' and (s.finished or s.deadline<=clock_timestamp()) then
       if s.mode='exam' and not s.finished then perform finish(s.id); end if;
       rejected:=rejected||jsonb_build_array(ev->>'eventId'); continue;
     end if;
     perform set_config('study.event_time',coalesce(ev->>'occurredAt',''),true);
     perform set_config('study.event_id',ev->>'eventId',true);
     result:=public.study_api(uid,ev->>'op', (ev-'eventId'-'occurredAt')||jsonb_build_object('id',s.id,'clientVersion',p->'clientVersion'));
     insert into sync_events(owner,event_id,session_id) values(uid,ev->>'eventId',s.id);
     ack:=ack||jsonb_build_array(ev->>'eventId');
   end loop;
   perform set_config('study.event_time','',true); perform set_config('study.event_id','',true);
   select * into s from sessions where id=(p->>'id')::uuid;
   return present(s)||jsonb_build_object('acknowledged',ack,'rejected',rejected);
 elsif op='export' then
   if jsonb_typeof(p->'questions') is distinct from 'array' then raise exception '请选择错题'; end if;
   return coalesce((select jsonb_agg(jsonb_build_object(
     'id',w.question,'bank',w.bank,'bankName',bk.name,'unit',h.unit,'unitName',un.name,
     'question',h.body,'mastery',w.mastery,'masterySource',w.mastery_source,'masteryUpdatedAt',w.mastery_updated_at,'streak',w.streak,
     'attempts',coalesce((select jsonb_agg(to_jsonb(attempt)-'owner' order by attempt.received_at,attempt.session_id) from attempts attempt where attempt.owner=uid and attempt.bank=w.bank and attempt.question=w.question),'[]')) order by w.mastery,w.question)
     from mistakes w join questions h on h.bank=w.bank and h.id=w.question join banks bk on bk.id=w.bank join units un on un.bank=h.bank and un.id=h.unit
     where w.owner=uid and w.bank=p->>'bank' and p->'questions' ? w.question),'[]');
 end if;
 for sid in select id from sessions where owner=uid and not finished and deadline<=clock_timestamp() order by id loop perform finish(sid); end loop;
 if op='home' then return jsonb_build_object('user',to_jsonb(m),'banks',coalesce((select jsonb_agg(to_jsonb(k) || jsonb_build_object('units',(select jsonb_agg(jsonb_build_object('id',un.id,'name',un.name,'count',(select count(*) from questions where bank=k.id and unit=un.id)) order by un.ord) from units un where un.bank=k.id))) from banks k),'[]'),'plans',coalesce((select jsonb_agg(to_jsonb(t)) from plans t),'[]'),'mistakes',coalesce((select jsonb_agg(jsonb_build_object('bank',w.bank,'id',w.question,'stem',h.body->>'stem','streak',w.streak,'unit',h.unit,'mastery',w.mastery,'masterySource',w.mastery_source,'masteryUpdatedAt',w.mastery_updated_at) order by w.question) from mistakes w join questions h on h.bank=w.bank and h.id=w.question where w.owner=uid),'[]'),'history',coalesce((select jsonb_agg(to_jsonb(t) order by created desc) from (select id,sessions.mode,bank,finished,pos,created,jsonb_array_length(items) as total from sessions where owner=uid order by created desc limit 100) t),'[]'));
 elsif op='start' then
 if mode not in ('unit','random','exam','wrong') then raise exception '未知模式';end if;
 scopeid:=case mode when 'exam' then p->>'plan' when 'unit' then b||'/'||(p->>'unit') else b end;
 select * into s from sessions where owner=uid and sessions.mode=p->>'mode' and scope=scopeid and not finished;
 if found then return present(s);end if;
 if mode='exam' then select * into strict pl from plans where id=(p->>'plan')::uuid;b:=pl.bank;perform check_plan(b,pl.units,pl.counts);
 select jsonb_agg(body order by random()) into qs from (select body,row_number() over(partition by body->>'type' order by random()) n from questions where bank=b and pl.units ? unit) t where n<=(pl.counts->>(body->>'type'))::int;
 else
 select jsonb_agg(h.body||jsonb_build_object('unit',h.unit) order by case when mode='wrong' then (select w.mastery from mistakes w where w.owner=uid and w.bank=b and w.question=h.id) end,case when mode='wrong' then h.id end,case when mode='unit' then h.ord end,random()) into qs from questions h where h.bank=b and (mode<>'unit' or h.unit=p->>'unit') and (mode<>'wrong' or exists(select 1 from mistakes w where w.owner=uid and w.bank=b and w.question=h.id and w.mastery<3));
 end if;
 if qs is null then raise exception '当前范围暂无可练习题目'; end if;
 insert into sessions(owner,mode,scope,bank,items,deadline) values(uid,mode,scopeid,b,qs,case when mode='exam' then clock_timestamp()+make_interval(mins=>pl.minutes) end) returning * into s;
 else
 select * into s from sessions where id=(p->>'id')::uuid and owner=uid for update;
 if not found then raise exception '记录不存在';end if;
 if not s.finished and s.deadline<=clock_timestamp() then perform finish(s.id);select * into s from sessions where id=s.id;end if;
 if op='rate' then
 if s.mode<>'wrong' or not s.answers ? (p->>'question') then raise exception '请在错题重刷作答后评分'; end if;
 if (p->>'mastery')::int not between 1 and 3 or p->>'mastery' is null then raise exception '评分必须为1至3星'; end if;
 update mistakes set mastery=(p->>'mastery')::int,mastery_source='manual',mastery_updated_at=clock_timestamp() where owner=uid and bank=s.bank and question=p->>'question';
 if not found then raise exception '错题不存在'; end if;
 elsif not s.finished then
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

revoke execute on function study.capture_attempts() from public,anon,authenticated;
grant execute on function study.capture_attempts() to service_role;
