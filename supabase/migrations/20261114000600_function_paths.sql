alter function study.expire() set search_path=pg_catalog,study;
alter function study.finish(uuid) set search_path=pg_catalog,study;
alter function study.present(study.sessions) set search_path=pg_catalog,study;
alter function study.check_plan(text,jsonb,jsonb) set search_path=pg_catalog,study;
alter function study.record_result(uuid,text,text,boolean,boolean) set search_path=pg_catalog,study;
