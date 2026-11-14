create or replace function study.present(s study.sessions) returns jsonb language sql stable as $$
select jsonb_build_object('id',s.id,'bank',s.bank,'mode',s.mode,'pos',s.pos,'total',jsonb_array_length(s.items),'finished',s.finished,'deadline',s.deadline,'serverTime',clock_timestamp(),'answers',s.answers,'items',
 (select jsonb_agg(case when s.finished or (s.mode<>'exam' and s.answers ? (q->>'id')) then q else q-array['answer','explanation'] end order by n) from jsonb_array_elements(s.items) with ordinality a(q,n))) $$;

